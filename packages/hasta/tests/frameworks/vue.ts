import { useHasta, useHastaTarget } from '@66hex/hasta/vue';
import type {
  HastaController,
  IntersectionTargetOptions,
  VueTargetBinding,
} from '@66hex/hasta/vue';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type { ComponentPublicInstance, PropType } from 'vue';

let now = 1000;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();

Object.defineProperty(performance, 'now', { configurable: true, value: () => now });

window.requestAnimationFrame = (callback) => {
  frames.set(++nextFrame, callback);

  return nextFrame;
};

window.cancelAnimationFrame = (id) => {
  frames.delete(id);
};

const debug = ref(true);
const horizonMs = ref(120);
const maxSampleAgeMs = ref(100);
const withinMs = ref(120);
const marginPx = ref(0);
const callbackVersion = ref(1);
const targetVersion = ref(0);
const showTarget = ref(true);
const targetActive = ref(true);
const ownerActive = ref(true);
const mounted = ref(true);
const once = ref(false);
const stableForMs = ref(0);
const cooldownMs = ref(0);
const errors: string[] = [];
const events: { version: number; etaMs: number; signal: AbortSignal }[] = [];
let controller: HastaController | null = null;
let binding: VueTargetBinding | null = null;

const Empty = defineComponent({ setup: () => () => h('span', 'Inactive') });

const Target = defineComponent({
  /** SAFETY: Vue validates Object at runtime while PropType describes the controller methods */
  props: { controller: { type: Object as PropType<HastaController>, required: true } },
  setup(props) {
    const target = useHastaTarget(props.controller, (): IntersectionTargetOptions => {
      const version = callbackVersion.value;

      return {
        when: { type: 'intersects', withinMs: withinMs.value, marginPx: marginPx.value },
        once: once.value,
        stableForMs: stableForMs.value,
        cooldownMs: cooldownMs.value,
        onPredict: (event) => {
          events.push({ version, etaMs: event.etaMs, signal: event.signal });
        },
      };
    });

    binding = target;

    return () =>
      showTarget.value
        ? h(
            'button',
            {
              key: targetVersion.value,
              id: `vue-target-${targetVersion.value}`,
              'data-testid': 'vue-target',
              ref: target.ref,
              style: {
                position: 'absolute',
                left: '100px',
                top: '100px',
                width: '40px',
                height: '40px',
              },
            },
            'Vue target',
          )
        : null;
  },
});

const Owner = defineComponent({
  setup() {
    const hasta = useHasta(() => ({
      debug: debug.value,
      horizonMs: horizonMs.value,
      maxSampleAgeMs: maxSampleAgeMs.value,
    }));

    controller = hasta;

    return () =>
      h(KeepAlive, null, {
        default: () => (targetActive.value ? h(Target, { controller: hasta }) : h(Empty)),
      });
  },
});

const App = defineComponent({
  setup: () => () =>
    mounted.value
      ? h(KeepAlive, null, {
          default: () => (ownerActive.value ? h(Owner) : h(Empty)),
        })
      : null,
});

const app = createApp(App);

app.config.errorHandler = (error) =>
  errors.push(error instanceof Error ? error.message : String(error));

app.mount('#app');

const fixture = {
  frame(time = now) {
    now = time;

    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) {
        callback(now);
      }
    }
  },
  pointer(time: number, x: number, y = 110) {
    now = time;

    const event = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 0,
      clientX: x,
      clientY: y,
      bubbles: true,
    });

    Object.defineProperty(event, 'timeStamp', { value: time });
    document.dispatchEvent(event);
  },
  async change(
    values: Partial<{
      debug: boolean;
      horizonMs: number;
      maxSampleAgeMs: number;
      withinMs: number;
      marginPx: number;
      callbackVersion: number;
      targetVersion: number;
      showTarget: boolean;
      targetActive: boolean;
      ownerActive: boolean;
      mounted: boolean;
      once: boolean;
      stableForMs: number;
      cooldownMs: number;
    }>,
  ) {
    if (values.debug !== undefined) {
      debug.value = values.debug;
    }

    if (values.horizonMs !== undefined) {
      horizonMs.value = values.horizonMs;
    }

    if (values.maxSampleAgeMs !== undefined) {
      maxSampleAgeMs.value = values.maxSampleAgeMs;
    }

    if (values.withinMs !== undefined) {
      withinMs.value = values.withinMs;
    }

    if (values.marginPx !== undefined) {
      marginPx.value = values.marginPx;
    }

    if (values.callbackVersion !== undefined) {
      callbackVersion.value = values.callbackVersion;
    }

    if (values.targetVersion !== undefined) {
      targetVersion.value = values.targetVersion;
    }

    if (values.showTarget !== undefined) {
      showTarget.value = values.showTarget;
    }

    if (values.targetActive !== undefined) {
      targetActive.value = values.targetActive;
    }

    if (values.ownerActive !== undefined) {
      ownerActive.value = values.ownerActive;
    }

    if (values.mounted !== undefined) {
      mounted.value = values.mounted;
    }

    if (values.once !== undefined) {
      once.value = values.once;
    }

    if (values.stableForMs !== undefined) {
      stableForMs.value = values.stableForMs;
    }

    if (values.cooldownMs !== undefined) {
      cooldownMs.value = values.cooldownMs;
    }

    await nextTick();
  },
  state: () => ({
    errors: [...errors],
    events: events.map((event) => ({
      version: event.version,
      etaMs: event.etaMs,
      aborted: event.signal.aborted,
    })),
    snapshot: controller?.getDebugSnapshot() ?? null,
    bounds: binding?.getBounds() ?? null,
    pendingFrames: frames.size,
  }),
  invalidUsage() {
    const errors: string[] = [];

    for (const value of [
      document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math'),
      // SAFETY: Deliberately incomplete Vue instance tests rejection by the DOM ref boundary
      { $el: document.querySelector('[data-testid="vue-target"]') } as ComponentPublicInstance,
    ]) {
      try {
        binding?.ref(value);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    try {
      useHasta();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    return errors;
  },
  destroy: () => app.unmount(),
};

Object.assign(window, { vueHarness: fixture });
