import { randomSource } from './corpus.mjs';
import { createModel } from './models.mjs';

const WORKLOADS = [
  { name: '125Hz', sampleMs: 8, timeQuantum: 0 },
  { name: '1000Hz', sampleMs: 1, timeQuantum: 0 },
  { name: '8000Hz', sampleMs: 0.125, timeQuantum: 0 },
  { name: '8000Hz-quantized', sampleMs: 0.125, timeQuantum: 1 },
];

function samplesFor(workload, count) {
  const random = randomSource(0x2c78a1);

  return Array.from({ length: count }, (_, index) => {
    const time = index * workload.sampleMs;

    return {
      x: 256 + time * 0.4 + random.normal() * 0.25,
      y: 256 + 40 * Math.sin(time / 300) + random.normal() * 0.25,
      timeStamp:
        workload.timeQuantum === 0
          ? time
          : Math.floor(time / workload.timeQuantum) * workload.timeQuantum,
    };
  });
}

function timing(values) {
  const sorted = values.toSorted((a, b) => a - b);

  return {
    medianUs: sorted[Math.floor(sorted.length / 2)],
    p95BatchMeanUs: sorted[Math.floor((sorted.length - 1) * 0.95)],
    minUs: sorted[0],
  };
}

function updateBatch(config, samples, seed, copies) {
  // Construction stays outside the timer. Each copy receives a fresh ordered trace
  const instances = Array.from({ length: copies }, () => createModel(config, seed));
  const started = performance.now();

  for (const instance of instances) {
    for (const sample of samples) {
      instance.update(sample);
    }
  }

  return { elapsed: performance.now() - started, model: instances.at(-1) };
}

function predictBatch(model, now, count) {
  let checksum = 0;
  const started = performance.now();

  for (let iteration = 0; iteration < count; iteration++) {
    const forecast = model.predict(now, 120);

    if (forecast === null) {
      throw new Error('Timing workload unexpectedly produced no forecast.');
    }

    checksum += forecast.points[1].x;
  }

  return { elapsed: performance.now() - started, checksum };
}

export function benchmarkModels(models, rounds = 15) {
  const results = [];
  let sink = 0;

  for (const workload of WORKLOADS) {
    const samples = samplesFor(workload, 1000);

    const measurements = models.map((model) => ({
      model: model.name,
      update: [],
      predict: [],
      updateCopies: 1,
      predictIterations: 1000,
      minUpdateBatchMs: Infinity,
      minPredictBatchMs: Infinity,
    }));

    for (let round = -3; round < rounds; round++) {
      for (let offset = 0; offset < models.length; offset++) {
        const index = (offset + round + models.length * 3) % models.length;
        const measurement = measurements[index];
        let update;

        for (;;) {
          update = updateBatch(
            models[index].config,
            samples,
            0x18ab39 + round,
            measurement.updateCopies,
          );

          if (update.elapsed >= 20 || measurement.updateCopies >= 2048) {
            break;
          }

          measurement.updateCopies *= 2;
        }

        const updateUs = (update.elapsed * 1000) / (samples.length * measurement.updateCopies);
        const now = samples.at(-1).timeStamp + 8;
        let prediction;

        for (;;) {
          prediction = predictBatch(update.model, now, measurement.predictIterations);
          sink += prediction.checksum;

          if (prediction.elapsed >= 20 || measurement.predictIterations >= 8_192_000) {
            break;
          }

          measurement.predictIterations *= 2;
        }

        const predictUs = (prediction.elapsed * 1000) / measurement.predictIterations;

        if (round >= 0) {
          measurement.update.push(updateUs);
          measurement.predict.push(predictUs);
          measurement.minUpdateBatchMs = Math.min(measurement.minUpdateBatchMs, update.elapsed);
          measurement.minPredictBatchMs = Math.min(
            measurement.minPredictBatchMs,
            prediction.elapsed,
          );
        }
      }
    }

    for (const measurement of measurements) {
      results.push({
        model: measurement.model,
        workload: workload.name,
        eventsPerSecond: 1000 / workload.sampleMs,
        update: timing(measurement.update),
        predict: timing(measurement.predict),
        finalUpdateCallsPerBatch: samples.length * measurement.updateCopies,
        finalPredictCallsPerBatch: measurement.predictIterations,
        minUpdateBatchMs: measurement.minUpdateBatchMs,
        minPredictBatchMs: measurement.minPredictBatchMs,
      });
    }
  }

  return {
    rounds,
    warmupRounds: 3,
    samplesPerTrace: 1000,
    targetBatchMs: 20,
    sink,
    results,
  };
}
