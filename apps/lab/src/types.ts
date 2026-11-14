import type { Point, Rect, TrajectoryPoint } from 'hasta/core';

export interface Provenance {
  revision: string;
  sourceHash: string;
  collectorHash?: string;
}

export interface Plan {
  index: number;
  seed: number;
  count: number;
  mode: 'select' | 'none';
  layout: 'grid' | 'scatter' | 'rows';
  intended: string | null;
  phase?: 'warmup' | 'main';
  approach?: 'left' | 'right' | 'top' | 'bottom';
  passage?: 'through' | 'above' | 'below';
}

export interface Target {
  id: string;
  label: string;
  rect: Rect;
}

export interface Sample extends Point {
  timeStamp: number;
  arrivedAt: number;
  batch: number;
  buttons: number;
}

export interface Frame {
  at: number;
  measuredAt: number;
  forecast: TrajectoryPoint[];
  hits: { target: string; etaMs: number }[];
}

export interface Callback {
  target: string;
  at: number;
  evaluatedAt: number;
  etaMs: number;
}

export interface TrialEvent {
  type: 'enter' | 'leave' | 'reset';
  target: string | null;
  at: number;
  cause?: string;
}

export interface Quality {
  version: 1;
  eligible: boolean;
  flags: string[];
  preTargetSamples: number;
  maxInputGapMs: number;
  maxFrameGapMs: number;
  maxDeliveryDelayMs: number;
}

export interface TrialContext {
  attempt: number;
  start: Point;
  startRect: Rect;
  finishRect: Rect | null;
  end: (Point & { at: number; timeStamp: number }) | null;
  viewport: { width: number; height: number; dpr: number; scrollX: number; scrollY: number };
}

export type Outcome = 'selected' | 'none' | 'timeout' | 'interrupted';

export interface Trial {
  id: string;
  plan: Plan;
  startedAt: string;
  timeOrigin: number;
  startTime: number;
  duration: number;
  board: Rect;
  targets: Target[];
  gate: Rect | null;
  gatePassedAt: number | null;
  samples: Sample[];
  frames: Frame[];
  ticks: number[];
  callbacks: Callback[];
  events: TrialEvent[];
  outcome: Outcome;
  selected: string | null;
  reason: string | null;
  context?: TrialContext;
  quality?: Quality;
}

export interface Collection {
  studyId: 'intent-5p-v1';
  recordingId: string;
  number: 1 | 2;
  phase: 'instructions' | 'warmup' | 'main';
  warmupNext: number;
  acknowledgedBoundary: number;
  revision: number;
  exports: { at: string; sha256: string; trialCount: number }[];
}

export interface Session {
  id: string;
  protocolVersion: 1 | 2 | 3;
  collection?: Collection;
  createdAt: string;
  participant: string;
  device: 'mouse' | 'trackpad';
  seed: number;
  total: number;
  nextIndex: number;
  provenance: Provenance;
  environment: {
    userAgent: string;
    width: number;
    height: number;
    dpr: number;
    coalesced: boolean;
    automated?: boolean;
  };
  baseline: { horizonMs: number; stableForMs: number; maxSampleAgeMs: number; once: boolean };
  trials: Trial[];
}

declare global {
  const HASTA_BUILD: Provenance;
}
