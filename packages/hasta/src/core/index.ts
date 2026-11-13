export {
  firstSegmentRectIntersection,
  firstTrajectoryRectIntersection,
  intersectsRect,
} from './geometry.js';

export { LinearSpatialIndex } from './linear-spatial-index.js';

export { ConstantVelocityPredictor } from './prediction/constant-velocity.js';

export type {
  ConstantVelocityOptions,
  ConstantVelocityPrediction,
} from './prediction/constant-velocity.js';

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
