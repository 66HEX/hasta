import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

// An optional dist path allows before/after runs against the same scenarios
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url)));

const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><style>body{margin:0}</style>');

    return;
  }

  const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);

  if (!path.startsWith(root + sep)) {
    response.writeHead(404).end();

    return;
  }

  try {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((ready) => {
  server.listen(0, '127.0.0.1', ready);
});

let browser;

try {
  browser = await chromium.launch();

  const scenarios = [
    { targets: 100, rules: 1, debug: false, offscreen: false },
    { targets: 1000, rules: 1, debug: false, offscreen: true },
    { targets: 100, rules: 10, debug: false, offscreen: false },
    { targets: 100, rules: 1, debug: { labels: false, panel: true }, offscreen: true },
    { targets: 100, rules: 1, debug: false, offscreen: false, inputBurst: 128 },
    { targets: 1000, rules: 1, debug: false, offscreen: true, inputBurst: 128 },
  ];

  const results = [];

  for (const benchmark of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    results.push(
      await page.evaluate(async (scenario) => {
        const { createHasta } = await import('/index.js');
        const realNow = performance.now.bind(performance);
        let now = 1000;
        let sequence = 0;
        const frames = new Map();
        Object.defineProperty(performance, 'now', { value: () => now });
        window.requestAnimationFrame = (callback) => {
          frames.set(++sequence, callback);

          return sequence;
        };

        window.cancelAnimationFrame = (id) => frames.delete(id);
        let reads = 0;
        let callbacks = 0;
        const engine = createHasta({ debug: scenario.debug });

        for (let index = 0; index < scenario.targets; index++) {
          const element = document.createElement('div');
          Object.assign(element.style, {
            position: 'absolute',
            left: '100px',
            top: scenario.offscreen ? `${1000 + index * 30}px` : '100px',
            width: '100px',
            height: '20px',
          });
          document.body.append(element);
          const getBounds = element.getBoundingClientRect.bind(element);
          element.getBoundingClientRect = () => {
            reads++;

            return getBounds();
          };

          const target = engine.track(element);

          for (let rule = 0; rule < scenario.rules; rule++) {
            target.when(
              { type: 'intersects', withinMs: 120, includeCurrent: Boolean(scenario.inputBurst) },
              () => {
                callbacks++;
              },
            );
          }
        }

        const sample = (timeStamp, clientX) => {
          const event = new PointerEvent('pointermove', {
            pointerType: 'mouse',
            pointerId: 1,
            isPrimary: true,
            clientX,
            clientY: 110,
            bubbles: true,
          });

          Object.defineProperty(event, 'timeStamp', { value: timeStamp });
          document.dispatchEvent(event);
        };

        const step = () => {
          now += 16;

          if (scenario.inputBurst) {
            for (let index = 0; index < scenario.inputBurst; index++) {
              const progress = index / (scenario.inputBurst - 1);
              sample(now - 15 + progress * 15, progress * 400);
            }
          } else {
            sample(now - 1, 0);
            sample(now, 2);
          }

          for (const [id, callback] of [...frames]) {
            if (frames.delete(id)) {
              callback(now);
            }
          }
        };

        for (let count = 0; count < 30; count++) {
          step();
        }

        const batches = [];
        const readsBefore = reads;

        for (let batch = 0; batch < 30; batch++) {
          const started = realNow();

          for (let count = 0; count < 10; count++) {
            step();
          }

          batches.push((realNow() - started) / 10);
        }

        const measuredReads = reads - readsBefore;
        engine.destroy();
        batches.sort((a, b) => a - b);

        return {
          ...scenario,
          frames: 300,
          measuredReads,
          callbacks,
          medianMs: Number(batches[15].toFixed(3)),
          p95Ms: Number(batches[28].toFixed(3)),
          pendingAfterDestroy: frames.size,
        };
      }, benchmark),
    );
    await page.close();
  }

  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        batchSize: 10,
        warmupFrames: 30,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((closed) => {
    server.close(closed);
  });
}
