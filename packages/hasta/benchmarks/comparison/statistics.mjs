import { randomSource, HORIZONS } from './corpus.mjs';
import { summarize } from './evaluate.mjs';

const mean = (numbers) => numbers.reduce((total, value) => total + value, 0) / numbers.length;

const rowError = (row) =>
  mean(row.accuracy.filter((metric) => metric.mean !== null).map((metric) => metric.mean));

export function pairedInterval(rows, baseline) {
  const baselineErrors = new Map(baseline.map((row) => [row.traceId, rowError(row)]));
  const clusters = new Map();

  for (const runs of Map.groupBy(rows, (row) => row.traceId).values()) {
    const first = runs[0];
    const stratum = `${first.split}/${first.family}`;
    let seeds = clusters.get(stratum);

    if (!seeds) {
      seeds = new Map();
      clusters.set(stratum, seeds);
    }

    let differences = seeds.get(first.seed);

    if (!differences) {
      differences = [];
      seeds.set(first.seed, differences);
    }

    differences.push(mean(runs.map((row) => rowError(row))) - baselineErrors.get(first.traceId));
  }

  if ([...clusters.values()].some((seeds) => seeds.size < 2)) {
    return { lowerPx: null, upperPx: null, resamples: 0, insufficientClusters: true };
  }

  const random = randomSource(0x8459e21);
  const bootstrap = [];

  for (let repeat = 0; repeat < 2000; repeat++) {
    const differences = [];

    for (const seeds of clusters.values()) {
      const blocks = [...seeds.values()];

      for (let index = 0; index < blocks.length; index++) {
        differences.push(...blocks[Math.floor(random.uniform() * blocks.length)]);
      }
    }

    bootstrap.push(mean(differences));
  }

  const sorted = bootstrap.toSorted((a, b) => a - b);

  return { lowerPx: sorted[49], upperPx: sorted[1949], resamples: 2000 };
}

export function aggregate(rows) {
  const byTrace = Map.groupBy(rows, (row) => row.traceId);
  const errors = [];
  const horizonErrors = HORIZONS.map(() => []);
  const horizonMse = HORIZONS.map(() => []);
  const horizonP95 = HORIZONS.map(() => []);
  const postChange = HORIZONS.map(() => []);
  const horizonCounts = HORIZONS.map(() => ({ tp: 0, fp: 0, fn: 0, tn: 0 }));
  const etaMeans = [];
  const etaP95 = [];
  const jitterMeans = [];
  let etaPairs = 0;
  let arrivalPairs = 0;
  let totalFrames = 0;
  let eligibleFrames = 0;
  let availableFrames = 0;

  for (const runs of byTrace.values()) {
    const validErrors = runs.map((row) => rowError(row)).filter((value) => Number.isFinite(value));

    if (validErrors.length > 0) {
      errors.push(mean(validErrors));
    }

    totalFrames += mean(runs.map((row) => row.totalFrames));
    eligibleFrames += mean(runs.map((row) => row.eligibleFrames));
    availableFrames += mean(runs.map((row) => row.availableFrames));
    etaPairs += mean(runs.map((row) => row.etaError.count));
    arrivalPairs += mean(runs.map((row) => row.arrivalJitter.count));
    const etaRuns = runs.filter((row) => row.etaError.count > 0);
    const jitterRuns = runs.filter((row) => row.arrivalJitter.count > 0);

    if (etaRuns.length > 0) {
      etaMeans.push(mean(etaRuns.map((row) => row.etaError.mean)));
      etaP95.push(mean(etaRuns.map((row) => row.etaError.p95)));
    }

    if (jitterRuns.length > 0) {
      jitterMeans.push(mean(jitterRuns.map((row) => row.arrivalJitter.mean)));
    }

    for (const [index] of HORIZONS.entries()) {
      const validRuns = runs.filter((row) => row.accuracy[index].count > 0);

      if (validRuns.length > 0) {
        horizonErrors[index].push(mean(validRuns.map((row) => row.accuracy[index].mean)));
        horizonMse[index].push(mean(validRuns.map((row) => row.accuracy[index].rmse ** 2)));
        horizonP95[index].push(mean(validRuns.map((row) => row.accuracy[index].p95)));
      }

      const transitionRuns = runs.filter((row) => row.postChange[index].count > 0);

      if (transitionRuns.length > 0) {
        postChange[index].push(mean(transitionRuns.map((row) => row.postChange[index].mean)));
      }

      for (const key of Object.keys(horizonCounts[index])) {
        horizonCounts[index][key] += mean(runs.map((row) => row.confusion[index][key]));
      }
    }
  }

  const counts = { tp: 0, fp: 0, fn: 0, tn: 0 };

  for (const horizon of horizonCounts) {
    for (const key of Object.keys(counts)) {
      counts[key] += horizon[key];
    }
  }

  return {
    traces: byTrace.size,
    algorithmRuns: rows.length,
    meanErrorPx: errors.length === 0 ? null : mean(errors),
    perHorizon: HORIZONS.map((horizon, index) => {
      const { tp, fp, fn } = horizonCounts[index];

      return {
        horizon,
        meanErrorPx: horizonErrors[index].length === 0 ? null : mean(horizonErrors[index]),
        rmsePx: horizonMse[index].length === 0 ? null : Math.sqrt(mean(horizonMse[index])),
        meanTraceP95Px: horizonP95[index].length === 0 ? null : mean(horizonP95[index]),
        postChangeMeanErrorPx: postChange[index].length === 0 ? null : mean(postChange[index]),
        precision: tp + fp === 0 ? null : tp / (tp + fp),
        recall: tp + fn === 0 ? null : tp / (tp + fn),
        confusion: horizonCounts[index],
      };
    }),
    precision: counts.tp + counts.fp === 0 ? null : counts.tp / (counts.tp + counts.fp),
    recall: counts.tp + counts.fn === 0 ? null : counts.tp / (counts.tp + counts.fn),
    confusion: counts,
    etaHorizonMs: 120,
    etaMeanErrorMs: etaMeans.length === 0 ? null : mean(etaMeans),
    etaMeanTraceP95ErrorMs: etaP95.length === 0 ? null : mean(etaP95),
    etaTruePositiveCount: etaPairs,
    arrivalMeanJitterMs: jitterMeans.length === 0 ? null : mean(jitterMeans),
    arrivalPairCount: arrivalPairs,
    predictionFlipsPerTrace: mean(rows.map((row) => row.predictionFlips)),
    truthFlipsPerTrace: mean(rows.map((row) => row.truthFlips)),
    availability: eligibleFrames === 0 ? null : availableFrames / eligibleFrames,
    dataEligibility: totalFrames === 0 ? null : eligibleFrames / totalFrames,
    totalFrames,
    eligibleFrames,
    invalidForecasts: rows.reduce((sum, row) => sum + row.invalidForecasts, 0),
    particleSeedSpreadPx: summarize(
      [...byTrace.values()].map((runs) => {
        const seedErrors = runs.map((row) => rowError(row));

        return Math.max(...seedErrors) - Math.min(...seedErrors);
      }),
    ),
  };
}
