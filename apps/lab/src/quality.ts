import type { Quality, Trial } from './types.ts';

function biggestGap(times: number[]) {
  let maximum = 0;

  for (let index = 1; index < times.length; index++) {
    maximum = Math.max(maximum, (times[index] ?? 0) - (times[index - 1] ?? 0));
  }

  return maximum;
}

export function assessTrial(trial: Trial): Quality {
  const flags: string[] = [];
  const times = trial.samples.map((sample) => sample.timeStamp);

  const hover =
    trial.events.find((event) => event.type === 'enter' && event.target === trial.selected)?.at ??
    trial.duration;

  const preTarget = trial.samples.filter((sample) => sample.arrivedAt < hover);
  const distinct = new Set(preTarget.map((sample) => sample.timeStamp)).size;
  const maxInputGapMs = biggestGap(times);
  const maxFrameGapMs = biggestGap(trial.ticks);
  let maxDeliveryDelayMs = 0;
  let clockIssue = false;
  let previous = -Infinity;

  for (const sample of trial.samples) {
    maxDeliveryDelayMs = Math.max(maxDeliveryDelayMs, sample.arrivedAt - sample.timeStamp);
    clockIssue ||= sample.timeStamp < previous || sample.timeStamp > sample.arrivedAt + 5;
    previous = sample.timeStamp;
  }

  const resolved = trial.outcome === 'selected' || trial.outcome === 'none';

  const matches =
    trial.plan.mode === 'free'
      ? trial.outcome === 'selected' && trial.selected !== null
      : trial.selected === trial.plan.intended;

  if (!resolved) {
    flags.push(trial.outcome);
  }

  if (trial.samples.length === 0) {
    flags.push('no-motion');
  }

  if (distinct < 2) {
    flags.push('insufficient-pre-target-history');
  }

  if (resolved && !matches) {
    flags.push('instruction-mismatch');
  }

  if (clockIssue) {
    flags.push('sample-clock');
  }

  if (maxInputGapMs > 150) {
    flags.push('input-gap');
  }

  if (maxFrameGapMs > 100) {
    flags.push('frame-gap');
  }

  if (maxDeliveryDelayMs > 100) {
    flags.push('delayed-input');
  }

  return {
    version: 1,
    eligible: resolved && matches && distinct >= 2 && !clockIssue,
    flags,
    preTargetSamples: preTarget.length,
    maxInputGapMs,
    maxFrameGapMs,
    maxDeliveryDelayMs,
  };
}
