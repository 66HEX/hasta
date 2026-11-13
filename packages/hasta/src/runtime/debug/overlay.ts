import type { Rect } from '../../core/types.js';
import { debugOptionEnabled } from '../options.js';
import type { DebugOptions, DebugRule, DebugSnapshot, DebugTarget } from './types.js';

const SVG = 'http://www.w3.org/2000/svg';
const ACCENT = 'var(--hasta-accent)';
const SURFACE = 'var(--hasta-surface)';
const INK = 'var(--hasta-ink)';
const MUTED = 'var(--hasta-muted)';
const MAX_LABELS = 24;

const visible = (rect: Rect, width: number, height: number) =>
  rect.maxX >= 0 && rect.minX <= width && rect.maxY >= 0 && rect.minY <= height;

const overlaps = (a: Rect, b: Rect) =>
  a.minX < b.maxX + 4 && a.maxX > b.minX - 4 && a.minY < b.maxY + 4 && a.maxY > b.minY - 4;

interface TargetView {
  target: DebugTarget;
  rect: Rect;
  margin: number;
  expanded: Rect;
  active: boolean;
  contact: DebugRule | null;
}

function targetView(target: DebugTarget, forecast: boolean): TargetView | null {
  const rect = target.rect;

  if (!rect) {
    return null;
  }

  let margin = 0;
  let active = false;
  let contact: DebugRule | null = null;

  for (const rule of target.rules) {
    if (rule.matches || rule.latched || rule.running) {
      active = true;
    }

    if (
      forecast &&
      rule.intersection &&
      (contact?.intersection === undefined ||
        contact.intersection === null ||
        rule.intersection.etaMs < contact.intersection.etaMs)
    ) {
      contact = rule;
    }

    if (
      rule.marginPx > margin &&
      [
        rect.minX - rule.marginPx,
        rect.minY - rule.marginPx,
        rect.maxX + rule.marginPx,
        rect.maxY + rule.marginPx,
      ].every((value) => Number.isFinite(value))
    ) {
      margin = rule.marginPx;
    }
  }

  return {
    target,
    rect,
    margin,
    expanded: {
      minX: rect.minX - margin,
      minY: rect.minY - margin,
      maxX: rect.maxX + margin,
      maxY: rect.maxY + margin,
    },
    active,
    contact,
  };
}

function setText(element: Element, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function reconcile(parent: Element, children: readonly Element[]): void {
  let cursor = parent.firstChild;

  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(child, cursor);
    }
  }

  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

function shortLabel(value: string) {
  let text = '';
  let columns = 0;

  for (const character of value) {
    const size = (character.codePointAt(0) ?? 0) > 255 ? 2 : 1;

    if (columns + size > 20) {
      return { text: `${text}…`, columns: columns + 1 };
    }

    text += character;
    columns += size;
  }

  return { text, columns };
}

export interface DebugOverlay {
  render(snapshot: DebugSnapshot): void;
  setOptions(options: DebugOptions): void;
  destroy(): void;
}

export function createDebugOverlay(document: Document, initialOptions: DebugOptions): DebugOverlay {
  const view = document.defaultView;

  if (!view) {
    throw new Error('A debug overlay requires a document with a browser window.');
  }

  const window = view;
  let options = { ...initialOptions };
  let latest: DebugSnapshot | null = null;
  let destroyed = false;
  let labelsKey = '';
  const targetCache = new Map<number, { key: string; group: SVGGElement }>();
  const host = document.createElement('div');
  host.dataset.hastaDebug = '';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'all:initial;position:fixed;inset:0;display:block;overflow:hidden;contain:strict;z-index:2147483647;user-select:none;';
  host.style.setProperty('pointer-events', 'none', 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --hasta-surface: var(--card, #fff);
      --hasta-ink: var(--foreground, #18181b);
      --hasta-muted: var(--muted-foreground, #71717a);
      --hasta-border: var(--border, #e4e4e7);
      --hasta-accent: #059669;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --hasta-surface: var(--card, #18181b);
        --hasta-ink: var(--foreground, #fafafa);
        --hasta-muted: var(--muted-foreground, #a1a1aa);
        --hasta-border: var(--border, #3f3f46);
      }
    }
    :host, :host * { pointer-events: none !important; box-sizing: border-box; }
    svg { display: block; position: absolute; inset: 0; overflow: hidden; }
    .panel {
      position: absolute; right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      width: min(240px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow: hidden;
      padding: 12px; border: 1px solid var(--hasta-border); border-radius: 0;
      background: var(--hasta-surface); color: var(--hasta-ink);
      box-shadow: 0 1px 3px #0000000d;
      font: 12px/16px var(--font-sans, ui-sans-serif, system-ui, sans-serif);
      font-variant-numeric: tabular-nums; letter-spacing: 0; text-align: left;
    }
    .panel[hidden] { display: none; }
    .heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .brand { font-weight:600; }
    .status, .summary { color:var(--hasta-muted); }
    .status { display:flex; align-items:center; gap:6px; }
    .status::before { content:''; width:5px; height:5px; border-radius:0; background:currentColor; }
    .status[data-hasta-status="tracking"] { color:var(--hasta-accent); }
    .summary { margin-top:8px; }
    .label {
      fill:var(--hasta-muted); stroke:var(--hasta-surface); stroke-width:3px;
      stroke-linejoin:round; paint-order:stroke fill;
      font:11px/14px var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      font-variant-numeric:tabular-nums;
    }
  `;

  function node<K extends keyof SVGElementTagNameMap>(
    name: K,
    attributes: Record<string, string | number>,
  ): SVGElementTagNameMap[K] {
    const item = document.createElementNS(SVG, name);

    for (const [key, value] of Object.entries(attributes)) {
      item.setAttribute(key, String(value));
    }

    return item;
  }

  const svg = node('svg', {
    'aria-hidden': 'true',
    focusable: 'false',
    'data-hasta-layer': 'geometry',
  });

  const labels = node('g', { 'data-hasta-layer': 'labels' });
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.hastaLayer = 'panel';
  const heading = document.createElement('div');
  heading.className = 'heading';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'hasta';
  const status = document.createElement('span');
  status.className = 'status';
  const summary = document.createElement('div');
  summary.className = 'summary';
  heading.append(brand, status);
  panel.append(heading, summary);
  shadow.append(style, svg, panel);
  document.documentElement.append(host);

  function box(rect: Rect, attributes: Record<string, string | number>): SVGRectElement {
    return node('rect', {
      x: rect.minX,
      y: rect.minY,
      width: Math.max(0, rect.maxX - rect.minX),
      height: Math.max(0, rect.maxY - rect.minY),
      rx: 0,
      fill: 'none',
      stroke: ACCENT,
      'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke',
      ...attributes,
    });
  }

  function drawTarget(item: TargetView, width: number, height: number): SVGGElement {
    const { target, rect, expanded, margin, active, contact } = item;

    const group = node('g', {
      'data-hasta-target': target.id,
      'data-candidate': String(target.candidate),
    });

    if (debugOptionEnabled(options, 'bounds')) {
      if (visible(rect, width, height)) {
        group.append(
          box(rect, {
            'data-hasta-bounds': target.id,
            'stroke-opacity': margin > 0 ? 0.3 : active ? 1 : 0.65,
            'stroke-dasharray': margin > 0 ? 'none' : '3 3',
            fill: ACCENT,
            'fill-opacity': active ? 0.06 : 0.025,
          }),
        );
      }

      if (margin > 0 && visible(expanded, width, height)) {
        group.append(
          box(expanded, {
            'data-hasta-margin': margin,
            'stroke-dasharray': '3 3',
            'stroke-opacity': active ? 1 : 0.65,
          }),
        );
      }
    }

    const hit = contact?.intersection;

    if (
      debugOptionEnabled(options, 'intersections') &&
      hit &&
      visible(
        { minX: hit.point.x, maxX: hit.point.x, minY: hit.point.y, maxY: hit.point.y },
        width,
        height,
      )
    ) {
      group.append(
        node('circle', {
          cx: hit.point.x,
          cy: hit.point.y,
          r: 4,
          fill: SURFACE,
          stroke: ACCENT,
          'stroke-width': 1.5,
          'data-hasta-intersection': contact.id,
        }),
      );
    }

    return group;
  }

  function drawLabels(items: readonly TargetView[], width: number, height: number): void {
    const shown = debugOptionEnabled(options, 'labels') && debugOptionEnabled(options, 'bounds');

    const key = JSON.stringify([
      shown,
      width,
      height,
      debugOptionEnabled(options, 'panel'),
      items.map((item) => [item.target.id, item.target.label, item.rect, item.expanded]),
    ]);

    if (key === labelsKey) {
      return;
    }

    labelsKey = key;
    labels.replaceChildren();

    if (!shown || width < 80 || height < 56) {
      return;
    }

    const obstacles = items.map((item) => item.expanded);
    const placed: Rect[] = [];

    if (debugOptionEnabled(options, 'panel')) {
      placed.push({
        minX: Math.max(0, width - 264),
        minY: Math.max(0, height - 96),
        maxX: width,
        maxY: height,
      });
    }

    let attempts = 0;

    for (const { target, rect, expanded } of items) {
      if (
        !visible(rect, width, height) ||
        labels.childElementCount >= MAX_LABELS ||
        attempts >= MAX_LABELS * 2
      ) {
        continue;
      }

      attempts++;
      const name = shortLabel(target.label);
      const dimensions = `${Math.round(rect.maxX - rect.minX)} × ${Math.round(rect.maxY - rect.minY)}`;

      const labelWidth = Math.min(
        width - 16,
        Math.max(64, Math.max(name.columns, dimensions.length) * 6.8 + 16),
      );

      const labelHeight = 40;
      const left = Math.max(8, Math.min(expanded.minX, width - labelWidth - 8));
      const right = Math.max(8, Math.min(expanded.maxX - labelWidth, width - labelWidth - 8));

      const candidates = [
        [left, expanded.minY - labelHeight - 8],
        [left, expanded.maxY + 8],
        [right, expanded.minY - labelHeight - 8],
        [right, expanded.maxY + 8],
        [expanded.maxX + 8, expanded.minY],
        [expanded.minX - labelWidth - 8, expanded.minY],
      ];

      let position: Rect | null = null;

      for (const [x = 0, y = 0] of candidates) {
        const candidate = { minX: x, minY: y, maxX: x + labelWidth, maxY: y + labelHeight };

        if (
          x >= 8 &&
          y >= 8 &&
          candidate.maxX <= width - 8 &&
          candidate.maxY <= height - 8 &&
          !obstacles.some((obstacle) => overlaps(candidate, obstacle)) &&
          !placed.some((obstacle) => overlaps(candidate, obstacle))
        ) {
          position = candidate;
          break;
        }
      }

      if (!position) {
        continue;
      }

      placed.push(position);
      const label = node('g', { 'data-hasta-label': '', 'data-hasta-target-label': target.id });
      label.append(
        node('rect', {
          x: position.minX,
          y: position.minY,
          width: labelWidth,
          height: labelHeight,
          fill: 'none',
        }),
      );
      const text = node('text', { class: 'label', x: position.minX + 8, y: position.minY + 16 });
      const title = node('tspan', { x: position.minX + 8, dy: 0, fill: INK });
      title.textContent = name.text;
      const detail = node('tspan', { x: position.minX + 8, dy: 14 });
      detail.textContent = dimensions;
      text.append(title, detail);
      label.append(text);
      labels.append(label);
    }
  }

  function drawMotion(snapshot: DebugSnapshot): SVGGElement {
    const group = node('g', { 'data-hasta-layer': 'motion' });

    if (debugOptionEnabled(options, 'samples')) {
      const samples = snapshot.samples.slice(-16);

      if (samples.length > 1) {
        group.append(
          node('polyline', {
            points: samples.map((point) => `${point.x},${point.y}`).join(' '),
            fill: 'none',
            stroke: MUTED,
            'stroke-width': 1,
            'stroke-opacity': 0.25,
            'data-hasta-samples': samples.length,
          }),
        );
      }

      for (const sample of samples) {
        group.append(
          node('circle', { cx: sample.x, cy: sample.y, r: 2, fill: MUTED, 'fill-opacity': 0.4 }),
        );
      }
    }

    if (
      snapshot.pointer &&
      (debugOptionEnabled(options, 'samples') || debugOptionEnabled(options, 'trajectory'))
    ) {
      group.append(
        node('circle', {
          cx: snapshot.pointer.x,
          cy: snapshot.pointer.y,
          r: 4,
          fill: INK,
          stroke: SURFACE,
          'stroke-width': 2,
          'data-hasta-pointer': '',
        }),
      );
    }

    const points = snapshot.forecast?.points;
    const last = points?.at(-1);

    if (debugOptionEnabled(options, 'trajectory') && points && last) {
      group.append(
        node('polyline', {
          points: points.map((point) => `${point.x},${point.y}`).join(' '),
          fill: 'none',
          stroke: ACCENT,
          'stroke-width': 1.5,
          'stroke-dasharray': '4 4',
          'data-hasta-trajectory': '',
        }),
      );
      group.append(
        node('circle', {
          cx: last.x,
          cy: last.y,
          r: 4,
          fill: SURFACE,
          stroke: ACCENT,
          'stroke-width': 1.5,
          'data-hasta-endpoint': '',
        }),
      );
    }

    return group;
  }

  function render(snapshot: DebugSnapshot): void {
    if (destroyed) {
      return;
    }

    latest = snapshot;
    const width = window.innerWidth;
    const height = window.innerHeight;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    host.dataset.hastaStatus = snapshot.status;
    panel.hidden = !debugOptionEnabled(options, 'panel');
    status.dataset.hastaStatus = snapshot.status;
    setText(
      status,
      snapshot.status === 'warming-up' || snapshot.status === 'pending'
        ? 'Waiting'
        : snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1),
    );
    setText(
      summary,
      `${snapshot.targets.length} ${snapshot.targets.length === 1 ? 'target' : 'targets'} · ${Math.round(snapshot.horizonMs)} ms ahead`,
    );
    const items: TargetView[] = [];
    const children: Element[] = [];
    const live = new Set<number>();

    for (const target of snapshot.targets) {
      const item = targetView(target, snapshot.forecast !== null);
      const point = item?.contact?.intersection?.point;

      if (
        !item ||
        (!visible(item.expanded, width, height) &&
          !(
            point &&
            visible({ minX: point.x, maxX: point.x, minY: point.y, maxY: point.y }, width, height)
          ))
      ) {
        continue;
      }

      items.push(item);
      live.add(target.id);

      const key = JSON.stringify([
        item.rect,
        item.expanded,
        item.margin,
        item.active,
        target.candidate,
        item.contact?.id,
        point,
        width,
        height,
      ]);

      let cached = targetCache.get(target.id);

      if (cached?.key !== key) {
        cached = { key, group: drawTarget(item, width, height) };
        targetCache.set(target.id, cached);
      }

      children.push(cached.group);
    }

    for (const id of targetCache.keys()) {
      if (!live.has(id)) {
        targetCache.delete(id);
      }
    }

    drawLabels(items, width, height);
    children.push(drawMotion(snapshot), labels);
    reconcile(svg, children);
  }

  return {
    render,
    setOptions(value) {
      if (destroyed) {
        return;
      }

      options = { ...value };
      targetCache.clear();
      labelsKey = '';

      if (latest) {
        render(latest);
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      latest = null;
      targetCache.clear();
      labelsKey = '';
      svg.replaceChildren();
      panel.replaceChildren();
      host.remove();
    },
  };
}
