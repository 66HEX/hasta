import type { Plan, Target } from './types.ts';

export function random(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function planFor(seed: number, index: number): Plan {
  const rng = random(seed + Math.floor(index / 12) * 7919);
  const block: { count: number; mode: 'none' | 'select' }[] = [];

  for (const count of [4, 8, 12]) {
    for (let slot = 0; slot < 4; slot++) {
      block.push({ count, mode: slot === 0 ? 'none' : 'select' });
    }
  }

  for (let i = block.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = block[i];
    const b = block[j];

    if (a && b) {
      block[i] = b;
      block[j] = a;
    }
  }

  const item = block[index % 12] ?? { count: 4, mode: 'select' };
  const trialSeed = (Math.floor(rng() * 4294967296) + index) >>> 0;
  // Separate random streams keep the requested target independent of target sizes and placement
  const target = Math.floor(random(trialSeed ^ 0x43b0d7e5)() * item.count);
  const layouts = ['grid', 'scatter', 'rows'] as const;

  return {
    index,
    seed: trialSeed,
    count: item.count,
    mode: item.mode,
    layout: layouts[index % 3] ?? 'grid',
    intended: item.mode === 'select' ? String(target) : null,
  };
}

export function sceneFor(plan: Plan, width: number, height: number) {
  const rng = random(plan.seed ^ 0x976fd421);
  const approach = plan.approach ?? 'left';
  const vertical = approach === 'top' || approach === 'bottom';
  const length = vertical ? height : width;
  const cross = vertical ? width : height;
  const rows = plan.count / 2;
  const gap = plan.layout === 'rows' ? 16 : 12;
  const cellWidth = 40 + rng() * 4;
  const cellHeight = Math.min(44, (260 - (rows - 1) * gap - 24) / rows);
  const groupDepth = cellWidth * 2 + gap;
  const groupHeight = rows * cellHeight + (rows - 1) * gap + 24;
  const center = cross / 2 + (rng() - 0.5) * Math.min(48, cross - groupHeight - 140);
  const left = length - 80 - groupDepth;
  const top = center - groupHeight / 2;

  const point = (u: number, v: number) => {
    switch (approach) {
      case 'right':
        return { x: width - u, y: v };
      case 'top':
        return { x: v, y: u };
      case 'bottom':
        return { x: v, y: height - u };
      case 'left':
        return { x: u, y: v };
    }

    throw new Error('Unknown approach direction.');
  };

  const rectangle = (u: number, v: number, w: number, h: number) => {
    const a = point(u, v);
    const b = point(u + w, v + h);

    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
  };

  const targets: Target[] = [];

  for (let index = 0; index < plan.count; index++) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const inset = plan.layout === 'scatter' ? rng() * 2 : 0;
    const stagger = plan.layout === 'rows' && row % 2 === 1 ? 3 : 0;
    const targetWidth = cellWidth - inset * 2 - 3;
    const x = left + column * (cellWidth + gap) + inset + stagger;
    const y = top + row * (cellHeight + gap) + inset + (row >= rows / 2 ? 24 : 0);
    const targetHeight = cellHeight - inset * 2;

    targets.push({
      id: String(index),
      label: String.fromCodePoint(65 + index),
      rect: rectangle(x, y, targetWidth, targetHeight),
    });
  }

  const gateU = left + groupDepth / 2;

  const gateV =
    plan.passage === 'above'
      ? top - 20
      : plan.passage === 'below'
        ? top + groupHeight + 20
        : center;

  const startRng = random(plan.seed ^ 0xa34f0c91);

  return {
    targets,
    start: point(44, cross / 2 + (startRng() - 0.5) * cross * 0.4),
    gate: rectangle(gateU - 16, gateV - 14, 32, 28),
    finish: point(length - 34, gateV),
  };
}
