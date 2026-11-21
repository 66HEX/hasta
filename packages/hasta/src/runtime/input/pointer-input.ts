import type { PointerSample } from '../../core/types.js';
import type { PointerInputType } from '../types.js';

export function listenToPointer(
  document: Document,
  sample: (value: PointerSample) => boolean,
  reset: () => void,
  wake: () => void,
  accepts: (value: PointerSample) => boolean,
  pointerTypes: readonly PointerInputType[] = ['mouse'],
): () => void {
  const window = document.defaultView;

  if (window === null) {
    throw new Error('Pointer input requires an active browser window.');
  }

  const allowedTypes = new Set<string>(pointerTypes);
  let pointerId: number | null = null;
  const removers: (() => void)[] = [];

  const listenDocument = <K extends keyof DocumentEventMap>(
    name: K,
    callback: (event: DocumentEventMap[K]) => void,
  ) => {
    document.addEventListener(name, callback, { capture: true, passive: true });
    removers.push(() => document.removeEventListener(name, callback, true));
  };

  const listenWindow = <K extends keyof WindowEventMap>(
    name: K,
    callback: (event: WindowEventMap[K]) => void,
  ) => {
    window.addEventListener(name, callback, { capture: true, passive: true });
    removers.push(() => window.removeEventListener(name, callback, true));
  };

  const clear = () => {
    pointerId = null;
    reset();
  };

  listenDocument('pointermove', (event) => {
    if (!allowedTypes.has(event.pointerType)) {
      return;
    }

    if (event.buttons !== 0 || document.hidden || document.pointerLockElement !== null) {
      clear();

      return;
    }

    let samples: readonly PointerEvent[] = [];

    if (typeof event.getCoalescedEvents === 'function') {
      samples = event.getCoalescedEvents();
    }

    if (samples.length === 0) {
      samples = [event];
    }

    for (const item of samples) {
      if (
        !Number.isFinite(item.clientX) ||
        !Number.isFinite(item.clientY) ||
        !Number.isFinite(item.timeStamp) ||
        item.timeStamp < 0
      ) {
        continue;
      }

      const point = { x: item.clientX, y: item.clientY, timeStamp: item.timeStamp };

      if (!accepts(point)) {
        continue;
      }

      if (pointerId !== null && pointerId !== event.pointerId) {
        clear();

        if (pointerId !== null || !accepts(point)) {
          return;
        }
      }

      if (!sample(point)) {
        break;
      }

      pointerId = event.pointerId;
    }
  });

  const resetMouse = (event: PointerEvent) => {
    if (
      allowedTypes.has(event.pointerType) &&
      (pointerId === null || event.pointerId === pointerId)
    ) {
      clear();
    }
  };

  for (const name of ['pointercancel', 'pointerdown', 'pointerup', 'lostpointercapture'] as const) {
    listenDocument(name, resetMouse);
  }

  listenDocument('pointerout', (event) => {
    if (event.relatedTarget === null) {
      resetMouse(event);
    }
  });
  listenWindow('blur', (event) => {
    if (event.target === window) {
      clear();
    }
  });
  listenWindow('pagehide', clear);
  listenWindow('pageshow', wake);
  listenDocument('pointerlockchange', clear);
  listenDocument('visibilitychange', () => {
    if (document.hidden) {
      clear();
    } else {
      wake();
    }
  });

  return () => {
    for (const remove of removers) {
      remove();
    }

    pointerId = null;
  };
}
