import { expect, test } from '@playwright/test';

for (const frameMs of [8, 16, 33, 66]) {
  for (const sampleMs of [4, 16, 40]) {
    for (const withinMs of [60, 160, 400]) {
      test(`continuous paths: ${sampleMs} ms samples, ${frameMs} ms frames, ${withinMs} ms horizon`, async ({
        page,
      }) => {
        await page.goto('/?manual=1');
        await page.waitForFunction(() => window.ready);

        const failures = await page.evaluate(
          ({ frameMs, sampleMs, withinMs }) => {
            const h = window.harness;
            const failures = [];
            let clock = 1000;

            const scenarios = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].flatMap(([dx, dy]) =>
              [0, 8, 40].flatMap((marginPx) =>
                [0, Math.floor(frameMs / 2)].map((phase) => ({ dx, dy, marginPx, phase })),
              ),
            );

            for (const { dx, dy, marginPx, phase } of scenarios) {
              const signals = [];
              const calls = [];

              const engine = h.createHasta({
                onError: (error) => failures.push(error.message),
              });

              const elements = [0, -120, 120].map((offset) =>
                h.element({
                  x: 368 - dy * offset,
                  y: 268 + dx * offset,
                  width: 64,
                  height: 64,
                }),
              );

              elements.forEach((element, index) => {
                engine
                  .track(element)
                  .when(
                    { type: 'intersects', withinMs, marginPx, includeCurrent: true },
                    (event) => {
                      calls.push(index);
                      signals.push(event.signal);

                      if (
                        !Number.isFinite(event.etaMs) ||
                        event.etaMs < 0 ||
                        event.etaMs > withinMs ||
                        event.predictedAt !== event.evaluatedAt + event.etaMs
                      ) {
                        failures.push({
                          reason: 'invalid timing',
                          frameMs,
                          sampleMs,
                          withinMs,
                          event: {
                            etaMs: event.etaMs,
                            predictedAt: event.predictedAt,
                            evaluatedAt: event.evaluatedAt,
                          },
                        });
                      }
                    },
                  );
              });

              let earlyAbort = false;

              for (let cycle = 0; cycle < 2; cycle++) {
                const base = clock + cycle * 1500;
                let observed = -200;

                for (let time = 0; time <= 1000; time++) {
                  if (time % sampleMs === 0) {
                    observed = -200 + time * 0.4;
                    h.pointer(base + time, 400 + dx * observed, 300 + dy * observed);
                  }

                  if ((time + phase) % frameMs === 0) {
                    h.frame(base + time);

                    if (Math.abs(observed) <= 32 + marginPx && signals.at(-1)?.aborted) {
                      earlyAbort = true;
                    }
                  }
                }

                h.frame(base + 1100);
              }

              if (
                calls.length !== 2 ||
                calls.some((index) => index !== 0) ||
                earlyAbort ||
                signals.some((signal) => !signal.aborted)
              ) {
                failures.push({
                  dx,
                  dy,
                  marginPx,
                  phase,
                  calls,
                  earlyAbort,
                  aborted: signals.map((signal) => signal.aborted),
                });
              }

              engine.destroy();
              elements.forEach((element) => element.remove());

              if (h.pendingFrames() !== 0) {
                failures.push({ reason: 'leaked frame', frameMs, sampleMs, withinMs });
              }

              clock += 4000;
            }

            return failures;
          },
          { frameMs, sampleMs, withinMs },
        );

        expect(failures).toEqual([]);
      });
    }
  }
}
