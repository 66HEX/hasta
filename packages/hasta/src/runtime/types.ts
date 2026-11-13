import type { Point, Prediction, Rect } from '../core/types.js';
import type { DebugOptions, DebugSnapshot } from './debug/types.js';
import type { SubscriptionOptions } from './triggers/subscription.js';

export interface HastaOptions {
  readonly document?: Document;
  readonly horizonMs?: number;
  readonly maxSampleAgeMs?: number;
  readonly bounds?: 'frame';
  readonly onError?: (cause: unknown) => void | Promise<void>;
  readonly debug?: boolean | DebugOptions;
}

export interface BoundsSnapshot {
  readonly rect: Rect;
  readonly measuredAt: number;
}

export interface IntersectsCondition {
  readonly type: 'intersects';
  readonly withinMs: number;
  readonly marginPx?: number;
  readonly includeCurrent?: boolean;
}

export interface Intersection {
  readonly etaMs: number;
  readonly point: Point;
}

export interface PredictionContext extends BoundsSnapshot {
  readonly element: HTMLElement;
  readonly evaluatedAt: number;
  readonly forecast: Prediction;
  readonly intersection: Intersection | null;
}

export interface PredictionEvent extends PredictionContext {
  readonly signal: AbortSignal;
}

export interface IntersectionEvent extends PredictionEvent {
  readonly intersection: Intersection;
  readonly etaMs: number;
  readonly predictedAt: number;
}

export type PredictionCondition = (context: PredictionContext) => boolean;

export interface TrackedTarget {
  getBounds(): BoundsSnapshot | null;
  invalidate(): void;
  when(
    condition: IntersectsCondition,
    callback: (event: IntersectionEvent) => void | Promise<void>,
    options?: SubscriptionOptions,
  ): () => void;
  when(
    condition: PredictionCondition,
    callback: (event: PredictionEvent) => void | Promise<void>,
    options?: SubscriptionOptions,
  ): () => void;
  untrack(): void;
}

export interface Hasta {
  track(element: HTMLElement): TrackedTarget;
  setDebug(options: boolean | DebugOptions): void;
  getDebugSnapshot(): DebugSnapshot | null;
  pause(): void;
  resume(): void;
  destroy(): void;
}
