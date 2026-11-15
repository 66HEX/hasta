import type { DebugOptions } from './debug/types.js';
import type { HastaOptions, IntersectsCondition } from './types.js';

export type NormalizedHastaOptions = Required<
  Pick<HastaOptions, 'horizonMs' | 'maxSampleAgeMs' | 'bounds' | 'debug'>
> &
  Pick<HastaOptions, 'document' | 'onError'>;

export function normalizeHastaOptions(options: HastaOptions): NormalizedHastaOptions {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Options must be an object.');
  }

  if (options.bounds !== undefined && options.bounds !== 'frame' && options.bounds !== 'cached') {
    throw new TypeError('bounds must be cached or frame.');
  }

  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new TypeError('onError must be a function.');
  }

  const normalized: NormalizedHastaOptions = {
    horizonMs: positive(options.horizonMs ?? 120, 'horizonMs'),
    maxSampleAgeMs: positive(options.maxSampleAgeMs ?? 100, 'maxSampleAgeMs'),
    bounds: options.bounds ?? 'cached',
    // oxlint-disable-next-line typescript/prefer-nullish-coalescing -- Null is invalid input and must reach validation
    debug: debugConfiguration(options.debug === undefined ? false : options.debug),
  };

  if (options.document !== undefined) {
    Object.assign(normalized, { document: options.document });
  }

  if (options.onError !== undefined) {
    Object.assign(normalized, { onError: options.onError });
  }

  return normalized;
}

export function normalizeIntersectsCondition(
  condition: IntersectsCondition,
): Required<IntersectsCondition> {
  if (condition?.type !== 'intersects') {
    throw new TypeError('Unknown condition type.');
  }

  positive(condition.withinMs, 'withinMs');
  const marginPx = condition.marginPx ?? 0;

  if (!Number.isFinite(marginPx) || marginPx < 0) {
    throw new RangeError('marginPx must be finite and nonnegative.');
  }

  if (condition.includeCurrent !== undefined && typeof condition.includeCurrent !== 'boolean') {
    throw new TypeError('includeCurrent must be a boolean.');
  }

  return Object.freeze({
    type: 'intersects',
    withinMs: condition.withinMs,
    marginPx,
    includeCurrent: condition.includeCurrent ?? false,
  });
}

export function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }

  return value;
}

export function debugOptionEnabled(options: DebugOptions, key: keyof DebugOptions): boolean {
  return key === 'samples' ? options.samples === true : options[key] !== false;
}

export function debugConfiguration(value: boolean | DebugOptions): DebugOptions | false {
  if (value === false) {
    return false;
  }

  if (value === true) {
    return Object.freeze({});
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('debug must be a boolean or an options object.');
  }

  const next = { ...value };

  for (const key of [
    'bounds',
    'trajectory',
    'samples',
    'intersections',
    'labels',
    'panel',
  ] as const) {
    if (next[key] !== undefined && typeof next[key] !== 'boolean') {
      throw new TypeError(`debug.${key} must be a boolean.`);
    }
  }

  return Object.freeze(next);
}
