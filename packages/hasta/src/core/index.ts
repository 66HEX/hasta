export {
  firstSegmentRectIntersection,
  firstTrajectoryRectIntersection,
  intersectsRect,
} from './geometry.js';

export { LinearSpatialIndex } from './linear-spatial-index.js';

export { KalmanPredictor } from './prediction/kalman-predictor.js';

export type { KalmanOptions, KalmanPrediction } from './prediction/kalman-predictor.js';

export type {
  Point,
  PointerSample,
  Prediction,
  Predictor,
  Rect,
  SegmentHit,
  SpatialId,
  SpatialIndex,
  TrajectoryHit,
  TrajectoryPoint,
} from './types.js';
