import type { Point, Rect } from '@66hex/hasta/core';

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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rectFromCenter(center: Point, w: number, h: number): Rect {
  return {
    minX: center.x - w / 2,
    minY: center.y - h / 2,
    maxX: center.x + w / 2,
    maxY: center.y + h / 2,
  };
}

function boundingBox(rects: Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
  }

  return { minX, minY, maxX, maxY };
}

function legacySceneFor(plan: Plan, width: number, height: number) {
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

function placeTargets(plan: Plan, width: number, height: number, rng: () => number): Rect[] {
  const approach = plan.approach ?? 'left';
  const count = plan.count;
  const pad = 16;

  if (plan.layout === 'navbar') {
    const rows = count === 4 ? 1 : 2;
    const cols = count / rows;
    const gapX = 8 + Math.floor(rng() * 10);
    const gapY = 10 + Math.floor(rng() * 8);
    const itemHeight = 30 + Math.floor(rng() * 14);
    const maxRowWidth = width - 48;

    const rawWidths = Array.from({ length: count }, () =>
      count === 12 ? 46 + Math.floor(rng() * 34) : 52 + Math.floor(rng() * 58),
    );

    const rects: Rect[] = [];
    const totalHeight = rows * itemHeight + (rows - 1) * gapY;
    const onTop = approach === 'bottom' || approach === 'right';

    const baseY = onTop
      ? 24 + Math.floor(rng() * 36)
      : height - 24 - totalHeight - Math.floor(rng() * 36);

    for (let r = 0; r < rows; r++) {
      const slice = rawWidths.slice(r * cols, (r + 1) * cols);
      const sum = slice.reduce((acc, w) => acc + w, 0) + (cols - 1) * gapX;

      const scale =
        sum > maxRowWidth ? (maxRowWidth - (cols - 1) * gapX) / (sum - (cols - 1) * gapX) : 1;

      const widths = slice.map((w) => Math.max(36, Math.floor(w * scale)));
      const rowWidth = widths.reduce((acc, w) => acc + w, 0) + (cols - 1) * gapX;
      const slackX = Math.max(0, width - rowWidth - 32);
      let cursorX = 16 + Math.floor(slackX * (0.2 + rng() * 0.6));

      for (const w of widths) {
        const y = baseY + r * (itemHeight + gapY);
        rects.push({ minX: cursorX, minY: y, maxX: cursorX + w, maxY: y + itemHeight });
        cursorX += w + gapX;
      }
    }

    return rects;
  }

  if (plan.layout === 'sidebar') {
    const cols = count === 12 ? 2 : count === 8 && rng() < 0.45 ? 2 : 1;
    const rows = count / cols;
    const gapX = 12 + Math.floor(rng() * 10);
    const gapY = 6 + Math.floor(rng() * 6);
    const itemWidth = cols === 1 ? 116 + Math.floor(rng() * 44) : 104 + Math.floor(rng() * 32);
    const maxItemHeight = Math.floor((height - 48 - (rows - 1) * gapY) / rows);
    const itemHeight = clamp(28 + Math.floor(rng() * 12), 26, Math.min(42, maxItemHeight));
    const groupWidth = cols * itemWidth + (cols - 1) * gapX;
    const groupHeight = rows * itemHeight + (rows - 1) * gapY;
    const onLeft = approach === 'right' || approach === 'bottom';

    const baseX = onLeft
      ? 24 + Math.floor(rng() * 32)
      : width - 24 - groupWidth - Math.floor(rng() * 32);

    const slackY = Math.max(0, height - groupHeight - 32);
    const baseY = 16 + Math.floor(slackY * (0.15 + rng() * 0.7));
    const rects: Rect[] = [];

    for (let i = 0; i < count; i++) {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = baseX + col * (itemWidth + gapX);
      const y = baseY + row * (itemHeight + gapY);
      rects.push({ minX: x, minY: y, maxX: x + itemWidth, maxY: y + itemHeight });
    }

    return rects;
  }

  if (plan.layout === 'cards') {
    const cols = count === 4 ? 2 : 4;
    const rows = count / cols;

    const regionW =
      plan.startKind === 'far' && (approach === 'left' || approach === 'right')
        ? Math.max(320, width - 160)
        : width - pad * 2;

    const regionH =
      plan.startKind === 'far' && (approach === 'top' || approach === 'bottom')
        ? Math.max(240, height - 120)
        : height - pad * 2;

    const offsetX =
      approach === 'left'
        ? width - pad - regionW
        : approach === 'right'
          ? pad
          : Math.floor((width - regionW) / 2);

    const offsetY =
      approach === 'top'
        ? height - pad - regionH
        : approach === 'bottom'
          ? pad
          : Math.floor((height - regionH) / 2);

    const cellW = regionW / cols;
    const cellH = regionH / rows;
    const rects: Rect[] = [];

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const maxW = Math.min(132, Math.floor(cellW - 14));
      const maxH = Math.min(78, Math.floor(cellH - 14));
      const minW = Math.min(52, maxW);
      const minH = Math.min(32, maxH);
      const w = minW + Math.floor(rng() * (maxW - minW + 1));
      const h = minH + Math.floor(rng() * (maxH - minH + 1));
      const cellX = offsetX + col * cellW;
      const cellY = offsetY + row * cellH;

      const x = clamp(
        cellX + 7 + Math.floor(rng() * Math.max(1, cellW - w - 14)),
        pad,
        width - pad - w,
      );

      const y = clamp(
        cellY + 7 + Math.floor(rng() * Math.max(1, cellH - h - 14)),
        pad,
        height - pad - h,
      );

      rects.push({ minX: x, minY: y, maxX: x + w, maxY: y + h });
    }

    return rects;
  }

  if (plan.layout === 'cluster') {
    const cols = count === 4 ? 2 : count === 8 ? 4 : 4;
    const rows = count / cols;
    const gap = 8 + Math.floor(rng() * 7);
    const itemW = 36 + Math.floor(rng() * 18);
    const itemH = 32 + Math.floor(rng() * 16);
    const groupW = cols * itemW + (cols - 1) * gap;
    const groupH = rows * itemH + (rows - 1) * gap;
    const marginX = approach === 'left' || approach === 'right' ? 76 : 36;
    const marginY = approach === 'top' || approach === 'bottom' ? 68 : 36;

    const baseX =
      approach === 'left'
        ? width - marginX - groupW
        : approach === 'right'
          ? marginX
          : clamp(Math.floor((width - groupW) / 2 + (rng() - 0.5) * 140), 24, width - groupW - 24);

    const baseY =
      approach === 'top'
        ? height - marginY - groupH
        : approach === 'bottom'
          ? marginY
          : clamp(
              Math.floor((height - groupH) / 2 + (rng() - 0.5) * 100),
              24,
              height - groupH - 24,
            );

    const rects: Rect[] = [];

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = baseX + col * (itemW + gap);
      const y = baseY + row * (itemH + gap);
      rects.push({ minX: x, minY: y, maxX: x + itemW, maxY: y + itemH });
    }

    return rects;
  }

  // Default v4 'grid': varied card grid (2x2, 4x2, 4x3)
  const cols = count === 4 ? 2 : 4;
  const rows = count / cols;
  const gapX = 12 + Math.floor(rng() * 10);
  const gapY = 12 + Math.floor(rng() * 10);
  const maxCardW = Math.min(114, Math.floor((width - 150 - (cols - 1) * gapX) / cols));
  const maxCardH = Math.min(76, Math.floor((height - 140 - (rows - 1) * gapY) / rows));
  const cardW = clamp(Math.floor(maxCardW * (0.76 + rng() * 0.24)), 54, maxCardW);
  const cardH = clamp(Math.floor(maxCardH * (0.76 + rng() * 0.24)), 40, maxCardH);
  const groupW = cols * cardW + (cols - 1) * gapX;
  const groupH = rows * cardH + (rows - 1) * gapY;

  const baseX =
    approach === 'left'
      ? width - 32 - groupW
      : approach === 'right'
        ? 32
        : clamp(Math.floor((width - groupW) / 2 + (rng() - 0.5) * 80), 24, width - groupW - 24);

  const baseY =
    approach === 'top'
      ? height - 32 - groupH
      : approach === 'bottom'
        ? 32
        : clamp(Math.floor((height - groupH) / 2 + (rng() - 0.5) * 60), 24, height - groupH - 24);

  const rects: Rect[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = baseX + col * (cardW + gapX);
    const y = baseY + row * (cardH + gapY);
    rects.push({ minX: x, minY: y, maxX: x + cardW, maxY: y + cardH });
  }

  return rects;
}

function findBestPoint(
  width: number,
  height: number,
  boxW: number,
  boxH: number,
  obstacles: Rect[],
  pad: number,
  score: (x: number, y: number) => number,
) {
  const minX = Math.ceil(boxW / 2 + 10);
  const maxX = Math.floor(width - boxW / 2 - 10);
  const minY = Math.ceil(boxH / 2 + 10);
  const maxY = Math.floor(height - boxH / 2 - 10);
  const halfW = boxW / 2;
  const halfH = boxH / 2;
  const step = 20;
  let best: Point | null = null;
  let bestScore = -Infinity;

  for (let x = minX; x <= maxX; x += step) {
    const cMinX = x - halfW;
    const cMaxX = x + halfW;

    for (let y = minY; y <= maxY; y += step) {
      const cMinY = y - halfH;
      const cMaxY = y + halfH;
      let blocked = false;

      for (const obstacle of obstacles) {
        if (
          cMinX < obstacle.maxX + pad &&
          cMaxX + pad > obstacle.minX &&
          cMinY < obstacle.maxY + pad &&
          cMaxY + pad > obstacle.minY
        ) {
          blocked = true;
          break;
        }
      }

      if (blocked) {
        continue;
      }

      const value = score(x, y);

      if (value > bestScore) {
        bestScore = value;
        best = { x, y };
      }
    }
  }

  return best;
}

export function sceneFor(plan: Plan, width: number, height: number) {
  if (plan.startKind === undefined) {
    return legacySceneFor(plan, width, height);
  }

  const rng = random(plan.seed ^ 0x976fd421);
  const targetRects = placeTargets(plan, width, height, rng);

  const targets: Target[] = targetRects.map((rect, index) => ({
    id: String(index),
    label: String.fromCodePoint(65 + index),
    rect,
  }));

  const group = boundingBox(targetRects);

  const groupCenter = {
    x: (group.minX + group.maxX) / 2,
    y: (group.minY + group.maxY) / 2,
  };

  const approach = plan.approach ?? 'left';
  const startRng = random(plan.seed ^ 0xa34f0c91);
  const startJitterX = (startRng() - 0.5) * 60;
  const startJitterY = (startRng() - 0.5) * 60;

  const preferredDir =
    approach === 'left'
      ? { x: -1, y: 0 }
      : approach === 'right'
        ? { x: 1, y: 0 }
        : approach === 'top'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };

  const targetDist = plan.startKind === 'near' ? 58 : plan.startKind === 'medium' ? 128 : 230;
  const minDist = plan.startKind === 'near' ? 24 : plan.startKind === 'medium' ? 80 : 165;
  const maxDist = plan.startKind === 'near' ? 95 : plan.startKind === 'medium' ? 180 : 500;

  const start = findBestPoint(width, height, 84, 40, targetRects, 8, (x, y) => {
    let nearest = Infinity;

    for (const rect of targetRects) {
      const dx = Math.max(rect.minX - x, x - rect.maxX, 0);
      const dy = Math.max(rect.minY - y, y - rect.maxY, 0);
      const d = Math.hypot(dx, dy);

      if (d < nearest) {
        nearest = d;
      }
    }

    const inBand = nearest >= minDist && nearest <= maxDist ? 1000 : 0;
    const distPenalty = -Math.abs(nearest - targetDist) * 2.5;
    const vx = x - (groupCenter.x + startJitterX);
    const vy = y - (groupCenter.y + startJitterY);
    const len = Math.hypot(vx, vy) || 1;
    const alignment = ((vx * preferredDir.x + vy * preferredDir.y) / len) * 60;

    return inBand + distPenalty + alignment;
  }) ?? { x: 56, y: Math.floor(height / 2) };

  if (plan.mode !== 'none') {
    return {
      targets,
      start,
      gate: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      finish: { x: width - 54, y: height - 34 },
    };
  }

  const startRect = rectFromCenter(start, 84, 40);
  const gateObstacles = [...targetRects, startRect];

  const desiredGate =
    plan.passage === 'above'
      ? { x: groupCenter.x, y: group.minY - 26 }
      : plan.passage === 'below'
        ? { x: groupCenter.x, y: group.maxY + 26 }
        : { x: groupCenter.x, y: groupCenter.y };

  const gateCenter =
    plan.noneVariant === 'away'
      ? { x: 0, y: 0 }
      : (findBestPoint(width, height, 36, 28, gateObstacles, 8, (x, y) => {
          const distToDesired = Math.hypot(x - desiredGate.x, y - desiredGate.y);
          const distToStart = Math.hypot(x - start.x, y - start.y);
          const farEnough = distToStart >= 64 ? 400 : 0;

          return farEnough - distToDesired * 2;
        }) ?? { x: width - 64, y: 40 });

  const gate = rectFromCenter(gateCenter, 36, 28);

  const finishObstacles =
    plan.noneVariant === 'away' ? [...targetRects, startRect] : [...targetRects, startRect, gate];

  const finish =
    plan.noneVariant === 'away'
      ? (findBestPoint(width, height, 72, 36, finishObstacles, 10, (x, y) => {
          const distToStart = Math.hypot(x - start.x, y - start.y);

          const distToGroup = Math.hypot(
            Math.max(group.minX - x, x - group.maxX, 0),
            Math.max(group.minY - y, y - group.maxY, 0),
          );

          const farEnough = distToStart >= 130 ? 800 : distToStart * 3;
          // Prefer moving away from or orthogonally to the target cluster
          const awayFromGroup = Math.min(distToGroup, 180) * 1.8;

          return farEnough + awayFromGroup - Math.abs(distToStart - 220);
        }) ?? { x: width - 54, y: height - 34 })
      : (findBestPoint(width, height, 72, 36, finishObstacles, 8, (x, y) => {
          const sgx = gateCenter.x - start.x;
          const sgy = gateCenter.y - start.y;
          const sgLen = Math.hypot(sgx, sgy) || 1;
          const gfx = x - gateCenter.x;
          const gfy = y - gateCenter.y;
          const gfLen = Math.hypot(gfx, gfy) || 1;
          const forward = (sgx * gfx + sgy * gfy) / (sgLen * gfLen);
          const distFromGate = Math.hypot(gfx, gfy);
          const goodDist = distFromGate >= 48 && distFromGate <= 220 ? 500 : 0;

          return goodDist + forward * 250 - Math.abs(distFromGate - 110);
        }) ?? { x: width - 54, y: height - 34 });

  return { targets, start, gate, finish };
}
