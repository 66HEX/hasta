export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface PointerSample extends Point {
  readonly timeStamp: number;
}

export interface TrajectoryPoint extends Point {
  readonly offsetMs: number;
}

export interface Prediction {
  readonly generatedAt: number;
  readonly points: readonly TrajectoryPoint[];
}

export interface Predictor {
  update(sample: PointerSample): void;
  predict(now: number, horizonMs: number): Prediction | null;
  reset(): void;
}

export interface SegmentHit {
  readonly fraction: number;
  readonly point: Point;
}

export interface TrajectoryHit {
  readonly offsetMs: number;
  readonly point: Point;
}

export type SpatialId = string | number;

export interface SpatialIndex<Id extends SpatialId = SpatialId> {
  readonly size: number;
  set(id: Id, rect: Rect): void;
  delete(id: Id): boolean;
  query(rect: Rect): Id[];
  clear(): void;
}
