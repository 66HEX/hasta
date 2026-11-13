import { createHasta } from '/dist/index.js';

const manual = new URLSearchParams(location.search).has('manual');
let now = 1000;
let nextFrame = 0;
const frames = new Map();

if (manual) {
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);

    return nextFrame;
  };

  window.cancelAnimationFrame = (id) => frames.delete(id);
}

window.harness = {
  createHasta,
  frame(time = now) {
    now = time;
    const current = [...frames];

    for (const [id, callback] of current) {
      if (frames.delete(id)) {
        callback(now);
      }
    }
  },
  pendingFrames: () => frames.size,
  now: () => now,
  element({ x = 100, y = 100, width = 10, height = 20, parent = document.body } = {}) {
    const element = document.createElement('div');
    element.className = 'target';
    Object.assign(element.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    parent.append(element);

    return element;
  },
  pointer(time, x, y = 110, options = {}) {
    now = time;
    const { target = document, type = 'pointermove', coalesced, predicted, ...init } = options;

    const event = new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: 0,
      ...init,
    });

    Object.defineProperty(event, 'timeStamp', { value: time });

    if (coalesced !== undefined) {
      Object.defineProperty(event, 'getCoalescedEvents', {
        value: () =>
          coalesced.map((sample) => {
            const item = new PointerEvent('pointermove', {
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              clientX: sample.x,
              clientY: sample.y ?? y,
            });

            Object.defineProperty(item, 'timeStamp', { value: sample.timeStamp });

            return item;
          }),
      });
    }

    if (predicted !== undefined) {
      Object.defineProperty(event, 'getPredictedEvents', { value: () => predicted });
    }

    target.dispatchEvent(event);
  },
};

window.ready = true;
