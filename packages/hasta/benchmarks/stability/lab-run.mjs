import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { replayTrace, evaluateActions, aggregateActions, selectPolicy } from './evaluate.mjs';
import { loadLabTraces } from './lab.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    'allow-automated': { type: 'boolean', default: false },
  },
});

if (!values.output || positionals.length === 0) {
  throw new Error(
    'Usage: node benchmarks/stability/lab-run.mjs --output FILE [--allow-automated] BACKUP...',
  );
}

const { traces, sources, counts } = await loadLabTraces(positionals, {
  allowAutomated: values['allow-automated'],
});

const participants = [...new Set(traces.map((trace) => trace.participant))];
const automated = traces.some((trace) => trace.source !== 'human');

if (traces.length === 0 || (!automated && participants.length < 3)) {
  throw new Error('Human evaluation requires eligible trials from at least three participants.');
}

const result = {
  purpose: automated
    ? 'Automated pipeline smoke check only; no human efficacy claim.'
    : 'Held-out participant evaluation of frozen motion models and action policies.',
  sources,
  participants,
  traces: traces.length,
  counts,
  uncertainty:
    'No latent trajectory ground truth in pointer recordings. Variance-scale fitting and nominal coverage are not inferred from these labels.',
  policySelection:
    'Each participant and both sessions are held out together. Thresholds use only the other participants. Motion parameters remain fixed.',
  models: {},
};

for (const name of ['frozen', 'current']) {
  const replay = traces.map((trace) => replayTrace(trace, name));

  const policies = [60, 120, 160].flatMap((horizonMs) =>
    [0, 16, 30, 50].map((stableForMs) => ({
      horizonMs,
      stableForMs,
      evidence: name === 'frozen' ? 'legacy' : 'fresh',
    })),
  );

  const fixed = {
    horizonMs: 160,
    stableForMs: 30,
    evidence: name === 'frozen' ? 'legacy' : 'fresh',
  };

  const folds = automated
    ? []
    : participants.map((participant) => {
        const validation = replay.filter(({ trace }) => trace.participant !== participant);
        const heldOut = replay.filter(({ trace }) => trace.participant === participant);

        const candidates = policies.map((policy) => ({
          policy,
          metrics: aggregateActions(validation.map((trace) => evaluateActions(trace, policy))),
        }));

        return {
          participant,
          validationParticipants: participants.filter((id) => id !== participant),
          budgets: [0, 2, 5, 10].map((budget) => {
            const selected = selectPolicy(candidates, budget);

            return {
              budget,
              selected,
              rows:
                selected === null
                  ? heldOut.map(({ trace }) => ({
                      id: trace.id,
                      selected: trace.selected !== null,
                      correct: 0,
                      wrong: 0,
                      abstained: 1,
                      leadMs: null,
                      actions: 0,
                      wrongStarts: 0,
                      aborts: 0,
                      restarts: 0,
                    }))
                  : heldOut.map((trace) => evaluateActions(trace, selected.policy)),
            };
          }),
        };
      });

  const fixedRows = replay.map((trace) => evaluateActions(trace, fixed));
  result.models[name] = {
    fixed: { policy: fixed, metrics: aggregateActions(fixedRows), rows: fixedRows },
    folds,
    heldOut: automated
      ? null
      : [0, 2, 5, 10].map((budget) => ({
          budget,
          metrics: aggregateActions(
            folds.flatMap((fold) => fold.budgets.find((item) => item.budget === budget).rows),
          ),
        })),
  };
}

const output = resolve(values.output);

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    output,
    purpose: result.purpose,
    participants,
    traces: traces.length,
    fixed: Object.fromEntries(
      Object.entries(result.models).map(([name, model]) => [name, model.fixed.metrics]),
    ),
  }),
);
