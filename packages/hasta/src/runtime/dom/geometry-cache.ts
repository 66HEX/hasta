export const GEOMETRY_EVENTS = [
  'load',
  'error',
  'input',
  'change',
  'toggle',
  'slotchange',
  'focusin',
  'focusout',
  'pointerover',
  'pointerout',
  'pointerdown',
  'pointerup',
  'transitionrun',
  'transitionend',
  'transitioncancel',
  'animationstart',
  'animationend',
  'animationcancel',
] as const;

const EMPTY_TARGETS = new Set<number>();

/** Tracks layout invalidation without treating observer rectangles as current measurements */
export class GeometryCache {
  readonly #document: Document;
  readonly #invalidate: () => void;
  readonly #observer: MutationObserver;
  readonly #Observer: typeof MutationObserver;
  readonly #roots = new Map<ShadowRoot, MutationObserver>();
  readonly #animations = new Map<Animation, CSSNumberish | null>();
  readonly #onRootEvent = () => this.invalidate();
  #dirty = true;
  #targets = new Set<number>();

  constructor(document: Document, invalidate: () => void) {
    this.#document = document;
    this.#invalidate = invalidate;
    const view = document.defaultView;

    if (view === null) {
      throw new Error('Geometry tracking requires an active document.');
    }

    this.#Observer = view.MutationObserver;
    this.#observer = new this.#Observer(() => this.invalidate());
    this.#observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  markDirty(): void {
    this.#dirty = true;
  }

  invalidate(): void {
    this.#dirty = true;
    this.#invalidate();
  }

  invalidateTarget(id: number): void {
    this.#targets.add(id);
    this.#invalidate();
  }

  observeRoots(roots: ReadonlySet<ShadowRoot>): void {
    if (roots.size === 0 && this.#roots.size === 0) {
      return;
    }

    for (const [root, observer] of this.#roots) {
      if (!roots.has(root)) {
        observer.disconnect();

        for (const type of GEOMETRY_EVENTS) {
          root.removeEventListener(type, this.#onRootEvent, true);
        }

        this.#roots.delete(root);
      }
    }

    for (const root of roots) {
      if (!this.#roots.has(root)) {
        const observer = new this.#Observer(() => this.invalidate());
        observer.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        this.#roots.set(root, observer);

        for (const type of GEOMETRY_EVENTS) {
          root.addEventListener(type, this.#onRootEvent, { capture: true, passive: true });
        }
      }
    }
  }

  consume(): ReadonlySet<number> | null {
    // Synchronous mutations must be visible before observer callbacks run
    if (this.#observer.takeRecords().length > 0) {
      this.#dirty = true;
    }

    for (const observer of this.#roots.values()) {
      if (observer.takeRecords().length > 0) {
        this.#dirty = true;
      }
    }

    const docAnimations = this.#document.getAnimations?.();
    const docAnimationCount = docAnimations?.length ?? 0;

    if (docAnimationCount > 0 || this.#roots.size > 0 || this.#animations.size > 0) {
      const current = new Set<Animation>(docAnimations);

      for (const root of this.#roots.keys()) {
        const rootAnimations = root.getAnimations?.();

        if (rootAnimations !== undefined) {
          for (const animation of rootAnimations) {
            current.add(animation);
          }
        }
      }

      for (const animation of this.#animations.keys()) {
        if (!current.has(animation)) {
          this.#dirty = true;
          this.#animations.delete(animation);
        }
      }

      for (const animation of current) {
        if (
          animation.playState === 'running' ||
          !this.#animations.has(animation) ||
          this.#animations.get(animation) !== animation.currentTime
        ) {
          this.#dirty = true;
        }

        this.#animations.set(animation, animation.currentTime);
      }
    }

    if (this.#dirty) {
      if (this.#targets.size > 0) {
        this.#targets.clear();
      }

      this.#dirty = false;

      return null;
    }

    if (this.#targets.size === 0) {
      return EMPTY_TARGETS;
    }

    const targets = this.#targets;
    this.#targets = new Set();

    return targets;
  }

  destroy(): void {
    this.#observer.disconnect();

    for (const [root, observer] of this.#roots) {
      observer.disconnect();

      for (const type of GEOMETRY_EVENTS) {
        root.removeEventListener(type, this.#onRootEvent, true);
      }
    }

    this.#roots.clear();
    this.#animations.clear();
    this.#targets.clear();
  }
}
