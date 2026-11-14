import { replayTrace, evaluateActions } from './evaluate.mjs';

function trace(id, targets, batches, frames, coalesced = false) {
  return {
    id,
    family: id,
    profile: coalesced ? 'coalesced' : 'direct',
    selected: null,
    cutoff: frames.at(-1) + 1,
    targets,
    samples: batches.flatMap((batch) =>
      batch.map((sample) => ({
        ...sample,
        arrivedAt: coalesced ? batch.at(-1).timeStamp : sample.timeStamp,
        buttons: 0,
      })),
    ),
    frames,
    resets: [],
    changeAt: null,
  };
}

export function precisionTraces() {
  const targets = [
    { id: 'right', rect: { minX: 200, maxX: 201, minY: 99.984375, maxY: 100.015625 } },
    { id: 'down', rect: { minX: 159.984375, maxX: 160.015625, minY: 140, maxY: 141 } },
    { id: 'diagonal', rect: { minX: 170, maxX: 171, minY: 110, maxY: 111 } },
  ];

  const batches = [
    [
      { x: 140, y: 100, timeStamp: 1000 },
      { x: 150, y: 100, timeStamp: 1010 },
    ],
    [
      { x: 160, y: 100, timeStamp: 1020 },
      { x: 160, y: 110, timeStamp: 1030 },
    ],
    Array.from({ length: 20 }, (_, index) => ({ x: 160, y: 111 + index, timeStamp: 1031 + index })),
    [{ x: 160, y: 100, timeStamp: 1060 }],
    [{ x: 150, y: 100, timeStamp: 1070 }],
    [
      { x: 160, y: 100, timeStamp: 1080 },
      { x: 168, y: 100, timeStamp: 1088 },
    ],
    Array.from({ length: 24 }, (_, index) => ({ x: 169 + index, y: 100, timeStamp: 1089 + index })),
  ];

  return [
    ...[false, true].map((coalesced) =>
      trace(
        'narrow-channel',
        targets,
        batches,
        [1010, 1030, 1050, 1060, 1070, 1088, 1112, 1113],
        coalesced,
      ),
    ),
    trace(
      'reversal-reapproach',
      [{ id: 'target', rect: { minX: 100, maxX: 110, minY: 100, maxY: 120 } }],
      [
        [
          { x: 0, y: 110, timeStamp: 1000 },
          { x: 20, y: 110, timeStamp: 1020 },
          { x: 10, y: 110, timeStamp: 1050 },
          { x: 20, y: 110, timeStamp: 1060 },
        ],
      ],
      [1020, 1030, 1040, 1050, 1060],
    ),
  ];
}

export function precisionReport(factory, traces = precisionTraces()) {
  const scenarios = traces.map((scenario) => {
    const replay = replayTrace(scenario, 'candidate', factory);

    const { episodes } = evaluateActions(
      replay,
      { horizonMs: 120, stableForMs: 0, evidence: 'fresh' },
      1,
      true,
    );

    const targets = episodes.map((episode) => episode.target);

    const passes =
      scenario.id === 'narrow-channel'
        ? JSON.stringify(targets) === JSON.stringify(['right', 'down', 'right']) &&
          episodes.every((episode) => episode.etaMs > 0) &&
          episodes[0].abortedAt === 1030 &&
          episodes[1].abortedAt === 1060 &&
          episodes[1].at - 1030 <= 32 &&
          episodes[2].at - 1080 <= 32
        : episodes.length === 2 && episodes[0].abortedAt === 1050 && episodes[1].at === 1060;

    return { id: scenario.id, profile: scenario.profile, episodes, passes };
  });

  return {
    source:
      'Exact pointer/target paths from browser prediction-precision sustained-turn and hasta reversal/reapproach regressions. Pointer samples stay outside targets, so includeCurrent does not affect these paths. Full browser tests remain required.',
    passes: scenarios.every((scenario) => scenario.passes),
    scenarios,
  };
}
