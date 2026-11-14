export interface SubscriptionOptions {
  readonly once?: boolean;
  readonly stableForMs?: number;
  readonly cooldownMs?: number;
}

export function normalizeSubscriptionOptions(
  options: SubscriptionOptions,
): Required<SubscriptionOptions> {
  if (options.once !== undefined && typeof options.once !== 'boolean') {
    throw new TypeError('once must be a boolean.');
  }

  const stableForMs = options.stableForMs ?? 0;
  const cooldownMs = options.cooldownMs ?? 0;

  for (const duration of [stableForMs, cooldownMs]) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError('Subscription durations must be finite and nonnegative.');
    }
  }

  return { once: options.once ?? false, stableForMs, cooldownMs };
}

export class Subscription<T extends object> {
  readonly #callback: (event: T & { readonly signal: AbortSignal }) => void | Promise<void>;
  readonly #reportError: (cause: unknown) => void | Promise<void>;
  readonly #once: boolean;
  readonly #stableForMs: number;
  readonly #cooldownMs: number;
  readonly #onSettled: (() => void) | undefined;
  #fireCount = 0;
  #active = true;
  #latched = false;
  #fired = false;
  #running = false;
  #stableSince: number | null = null;
  #lastEvidenceTime: number | null = null;
  #lastFired = -Infinity;
  #controller: AbortController | null = null;
  #pending: symbol | null = null;

  constructor(
    callback: (event: T & { readonly signal: AbortSignal }) => void | Promise<void>,
    options: SubscriptionOptions,
    reportError: (cause: unknown) => void | Promise<void>,
    onSettled?: () => void,
  ) {
    if (typeof callback !== 'function' || typeof reportError !== 'function') {
      throw new TypeError('Callback and error handler must be functions.');
    }

    const normalized = normalizeSubscriptionOptions(options);
    this.#stableForMs = normalized.stableForMs;
    this.#cooldownMs = normalized.cooldownMs;
    this.#callback = callback;
    this.#reportError = reportError;
    this.#once = normalized.once;
    this.#onSettled = onSettled;
  }

  get latched(): boolean {
    return this.#latched;
  }

  getDebugState() {
    return Object.freeze({
      latched: this.#latched,
      running: this.#running,
      once: this.#once,
      stableForMs: this.#stableForMs,
      cooldownMs: this.#cooldownMs,
      fireCount: this.#fireCount,
      lastFiredAt: this.#fired ? this.#lastFired : null,
    });
  }

  evaluate(
    matches: boolean,
    now: number,
    context: T | null,
    canStart = true,
    evidenceTime?: number,
    observedContact = false,
  ): (() => void) | null {
    if (!this.#active) {
      return null;
    }

    if (!Number.isFinite(now)) {
      throw new RangeError('Evaluation time must be finite.');
    }

    if (evidenceTime !== undefined && (!Number.isFinite(evidenceTime) || evidenceTime > now)) {
      throw new RangeError('Evidence time must be finite and no later than evaluation time.');
    }

    const observationTime = observedContact ? now : (evidenceTime ?? now);

    const corroborated =
      observedContact || evidenceTime === undefined || evidenceTime !== this.#lastEvidenceTime;

    if (evidenceTime !== undefined) {
      this.#lastEvidenceTime = evidenceTime;
    }

    if (!matches || context === null) {
      this.invalidate();

      return null;
    }

    if (this.#latched) {
      return null;
    }

    if (!canStart) {
      this.invalidate();

      return null;
    }

    if (!corroborated) {
      return null;
    }

    if (this.#stableSince === null || observationTime < this.#stableSince) {
      this.#stableSince = observationTime;
    }

    if (
      this.#pending !== null ||
      this.#running ||
      (this.#once && this.#fired) ||
      observationTime - this.#stableSince < this.#stableForMs ||
      now - this.#lastFired < this.#cooldownMs
    ) {
      return null;
    }

    const pending = Symbol('pending subscription');
    this.#pending = pending;
    const snapshot = { ...context };

    return () => {
      if (!this.#active || this.#pending !== pending) {
        return;
      }

      this.#pending = null;
      this.#latched = true;
      this.#fired = true;
      this.#fireCount++;
      this.#lastFired = now;
      this.#running = true;
      const controller = new AbortController();
      this.#controller = controller;

      try {
        const result = this.#callback(Object.freeze({ ...snapshot, signal: controller.signal }));

        const then =
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          // oxlint-disable-next-line typescript/unbound-method -- Capture once and call with result as this below
          result.then;

        if (typeof then === 'function') {
          const fulfilled = () => {
            this.#running = false;
            this.#notifySettled();
          };

          const rejected = (cause: unknown) => {
            this.#running = false;
            this.#handleError(cause);
            this.#notifySettled();
          };

          // Capture `then` once: getters may change or throw on a second read
          if (result instanceof Promise && then === Promise.prototype.then) {
            void then.call(result, fulfilled, rejected);
          } else {
            // oxlint-disable-next-line unicorn/no-thenable -- Assimilate the captured getter without reading it again
            void Promise.resolve({ then: then.bind(result) }).then(fulfilled, rejected);
          }
        } else {
          this.#running = false;
        }
      } catch (error) {
        this.#running = false;
        this.#handleError(error);
      }
    };
  }

  invalidate(): void {
    this.#pending = null;
    this.#latched = false;
    this.#stableSince = null;
    const controller = this.#controller;
    this.#controller = null;
    controller?.abort();
  }

  dispose(): void {
    this.#active = false;
    this.invalidate();
  }

  #handleError(cause: unknown): void {
    try {
      void Promise.resolve(this.#reportError(cause)).catch(() => {});
    } catch {
      // A user error handler must not interrupt other subscriptions or cleanup
    }
  }

  #notifySettled(): void {
    try {
      this.#onSettled?.();
    } catch (error) {
      this.#handleError(error);
    }
  }
}
