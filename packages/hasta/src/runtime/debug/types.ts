import type { Point, PointerSample, Prediction, Rect } from '../../core/types.js';

export interface DebugOptions {
  readonly bounds?: boolean;
  readonly trajectory?: boolean;
  readonly samples?: boolean;
  readonly intersections?: boolean;
  readonly labels?: boolean;
  readonly panel?: boolean;
}

export interface DebugRule {
  readonly id: number;
  readonly kind: 'intersects' | 'predicate';
  readonly withinMs: number;
  readonly marginPx: number;
  readonly includeCurrent: boolean;
  readonly matches: boolean;
  readonly eligible: boolean;
  readonly latched: boolean;
  readonly running: boolean;
  readonly once: boolean;
  readonly stableForMs: number;
  readonly cooldownMs: number;
  readonly fireCount: number;
  readonly lastFiredAt: number | null;
  readonly intersection: { readonly etaMs: number; readonly point: Point } | null;
}

export interface DebugTarget {
  readonly id: number;
  readonly label: string;
  readonly rect: Rect | null;
  readonly measuredAt: number | null;
  readonly candidate: boolean;
  readonly rules: readonly DebugRule[];
}

export interface DebugSnapshot {
  readonly timeStamp: number;
  readonly status: 'idle' | 'warming-up' | 'pending' | 'tracking' | 'paused' | 'hidden';
  readonly samples: readonly PointerSample[];
  readonly forecast: Prediction | null;
  readonly pointer: PointerSample | null;
  readonly velocity: { readonly x: number; readonly y: number; readonly speed: number } | null;
  readonly sampleAgeMs: number | null;
  readonly horizonMs: number;
  readonly maxSampleAgeMs: number;
  readonly targets: readonly DebugTarget[];
}
