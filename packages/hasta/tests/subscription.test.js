import assert from 'node:assert/strict';
import test from 'node:test';

import { Subscription } from '../dist/runtime/triggers/subscription.js';

const context = { etaMs: 30 };

const noError = (error) => {
  throw error;
};

const flushPromises = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function evaluate(subscription, matches, now, value = context, canStart = true) {
  const invoke = subscription.evaluate(matches, now, value, canStart);
  invoke?.();

  return invoke;
}

test('fires once per matching episode and preserves the signal until invalidation', () => {
  const events = [];
  const subscription = new Subscription((event) => events.push(event), {}, noError);
  evaluate(subscription, true, 0);
  assert.equal(subscription.latched, true);
  assert.equal(Object.isFrozen(events[0]), true);
  evaluate(subscription, true, 10);
  evaluate(subscription, true, 20, context, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal.aborted, false);
  evaluate(subscription, false, 30);
  assert.equal(subscription.latched, false);
  assert.equal(events[0].signal.aborted, true);
});

test('requires stable observations and cooldown before a new episode can fire', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => {
      events.push(event);
    },
    {
      stableForMs: 20,
      cooldownMs: 100,
    },
    noError,
  );

  assert.equal(evaluate(subscription, true, 0), null);
  assert.equal(evaluate(subscription, true, 19), null);
  evaluate(subscription, true, 20);
  evaluate(subscription, false, 30);
  assert.equal(evaluate(subscription, true, 40), null);
  assert.equal(evaluate(subscription, true, 60), null);
  assert.equal(evaluate(subscription, true, 119), null);
  evaluate(subscription, true, 120);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].signal, events[1].signal);
});

test('canStart gates the start without accumulating stability or cancelling an active episode', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => {
      events.push(event);
    },
    { stableForMs: 20 },
    noError,
  );

  evaluate(subscription, true, 0, context, false);
  evaluate(subscription, true, 100, context, false);
  assert.equal(evaluate(subscription, true, 110), null);
  evaluate(subscription, true, 130);
  evaluate(subscription, true, 140, context, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal.aborted, false);
});

test('once prevents refiring but its signal remains cancellable', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => {
      events.push(event);
    },
    { once: true },
    noError,
  );

  evaluate(subscription, true, 0);
  evaluate(subscription, true, 10);
  evaluate(subscription, false, 20);
  assert.equal(events[0].signal.aborted, true);
  evaluate(subscription, true, 30);
  assert.equal(events.length, 1);
  subscription.dispose();
  subscription.dispose();
});

test('null context breaks stability and invalidates a queued invocation', () => {
  let calls = 0;

  const subscription = new Subscription(
    () => {
      calls += 1;
    },
    { stableForMs: 10 },
    noError,
  );

  evaluate(subscription, true, 0);
  const stale = subscription.evaluate(true, 10, context);
  assert.equal(typeof stale, 'function');
  evaluate(subscription, true, 11, null);
  stale();
  assert.equal(calls, 0);
  assert.equal(evaluate(subscription, true, 20), null);
  evaluate(subscription, true, 30);
  assert.equal(calls, 1);
});

test('a callback can dispose another subscription before its queued invocation runs', () => {
  const calls = [];

  const second = new Subscription(
    () => {
      calls.push('second');
    },
    {},
    noError,
  );

  const first = new Subscription(
    () => {
      calls.push('first');
      second.dispose();
    },
    {},
    noError,
  );

  const firstInvoke = first.evaluate(true, 0, context);
  const secondInvoke = second.evaluate(true, 0, context);
  firstInvoke();
  secondInvoke();
  assert.deepEqual(calls, ['first']);
  assert.equal(second.evaluate(true, 1, context), null);
});

test('a queued invocation is single use and does not consume once until invoked', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => {
      events.push(event);
    },
    { once: true },
    noError,
  );

  const discarded = subscription.evaluate(true, 0, context);
  subscription.invalidate();
  discarded();
  const invoke = subscription.evaluate(true, 10, context);
  invoke();
  invoke();
  assert.equal(events.length, 1);
  subscription.dispose();
  assert.equal(events[0].signal.aborted, true);
});

test('aborted work must settle before the next callback can start', async () => {
  const events = [];
  let settle;

  const subscription = new Subscription(
    (event) => {
      events.push(event);

      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    {},
    noError,
  );

  evaluate(subscription, true, 0);
  evaluate(subscription, false, 10);
  assert.equal(events[0].signal.aborted, true);
  assert.equal(evaluate(subscription, true, 20), null);
  settle();
  await flushPromises();
  evaluate(subscription, true, 30);
  assert.equal(events.length, 2);
  assert.equal(events[1].signal.aborted, false);
  subscription.dispose();
  settle();
  await flushPromises();
});

test('a synchronous return value does not keep the callback running until a microtask', () => {
  const events = [];
  const subscription = new Subscription((event) => events.push(event), {}, noError);
  evaluate(subscription, true, 0);
  evaluate(subscription, false, 10);
  evaluate(subscription, true, 20);
  assert.equal(events.length, 2);
});

test('a rejected thenable is handled and does not prevent a later episode', async () => {
  const errors = [];
  let calls = 0;
  const failure = new Error('thenable rejected');

  const subscription = new Subscription(
    () => {
      calls += 1;

      return {
        then(_resolve, reject) {
          reject(failure);
        },
      };
    },
    {},
    (error) => {
      errors.push(error);
    },
  );

  evaluate(subscription, true, 0);
  await flushPromises();
  evaluate(subscription, false, 10);
  evaluate(subscription, true, 20);
  await flushPromises();
  assert.equal(calls, 2);
  assert.deepEqual(errors, [failure, failure]);
});

test('sync throws, async rejections and throwing error handlers do not break cleanup', async () => {
  const errors = [];
  const failure = new Error('callback failed');

  const sync = new Subscription(
    () => {
      throw failure;
    },
    {},
    (error) => {
      errors.push(error);
      throw new Error('reporter failed');
    },
  );

  assert.doesNotThrow(() => evaluate(sync, true, 0));
  sync.dispose();

  const async = new Subscription(
    () => Promise.reject(failure),
    {},
    async (error) => {
      errors.push(error);
      throw new Error('async reporter failed');
    },
  );

  evaluate(async, true, 0);
  await flushPromises();
  async.dispose();
  assert.deepEqual(errors, [failure, failure]);
});

test('rejects invalid durations, callback types and evaluation timestamps', () => {
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => new Subscription(() => {}, { stableForMs: value }, noError), RangeError);
    assert.throws(() => new Subscription(() => {}, { cooldownMs: value }, noError), RangeError);
  }

  assert.throws(() => new Subscription(null, {}, noError), TypeError);
  assert.throws(() => new Subscription(() => {}, {}, null), TypeError);
  assert.throws(() => new Subscription(() => {}, { once: 1 }, noError), TypeError);
  const subscription = new Subscription(() => {}, {}, noError);
  assert.throws(() => subscription.evaluate(true, NaN, context), RangeError);
});

test('assimilates a stateful then getter once with its original receiver and first-settlement semantics', async () => {
  let reads = 0;
  let calls = 0;
  let settlements = 0;
  const errors = [];

  const thenable = {
    get then() {
      reads++;

      if (reads > 1) {
        throw new Error('then was read again');
      }

      return function (resolve, reject) {
        assert.equal(this, thenable);
        calls++;
        resolve();
        reject(new Error('late rejection'));
        throw new Error('throw after resolution');
      };
    },
  };

  const subscription = new Subscription(
    () => thenable,
    {},
    (error) => errors.push(error),
    () => {
      settlements++;
    },
  );

  evaluate(subscription, true, 0);
  assert.equal(subscription.getDebugState().running, true);
  subscription.invalidate();
  assert.equal(evaluate(subscription, true, 1), null);
  await flushPromises();
  assert.equal(reads, 1);
  assert.equal(calls, 1);
  assert.equal(settlements, 1);
  assert.equal(subscription.getDebugState().running, false);
  assert.deepEqual(errors, []);
});

test('a throwing then getter reports once and leaves the next episode usable', () => {
  const failure = new Error('then getter failed');
  const errors = [];
  let calls = 0;

  const subscription = new Subscription(
    () => {
      calls++;

      if (calls === 1) {
        return {
          get then() {
            throw failure;
          },
        };
      }
    },
    {},
    (error) => errors.push(error),
  );

  evaluate(subscription, true, 0);
  assert.equal(subscription.getDebugState().running, false);
  subscription.invalidate();
  evaluate(subscription, true, 1);
  assert.equal(calls, 2);
  assert.deepEqual(errors, [failure]);
});

test('native Promise callbacks settle after one microtask without rereading an own then getter', async () => {
  const promise = Promise.resolve();
  let reads = 0;
  Object.defineProperty(promise, 'then', {
    get() {
      reads++;

      if (reads > 1) {
        throw new Error('then was read again');
      }

      return Promise.prototype.then;
    },
  });
  const errors = [];

  const subscription = new Subscription(
    () => promise,
    {},
    (error) => errors.push(error),
  );

  evaluate(subscription, true, 0);
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(subscription.getDebugState().running, false);
  assert.deepEqual(errors, []);
});

test('a throwing settlement observer is reported instead of creating an unhandled rejection', async () => {
  const failure = new Error('observer failed');
  const errors = [];

  const subscription = new Subscription(
    () => Promise.resolve(),
    {},
    (error) => errors.push(error),
    () => {
      throw failure;
    },
  );

  evaluate(subscription, true, 0);
  await flushPromises();
  assert.equal(subscription.getDebugState().running, false);
  assert.deepEqual(errors, [failure]);
  subscription.dispose();
});

test('an abort listener can start a new episode without the old invalidation discarding its signal', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => {
      events.push(event);

      if (events.length === 1) {
        event.signal.addEventListener('abort', () => evaluate(subscription, true, 10), {
          once: true,
        });
      }
    },
    {},
    noError,
  );

  evaluate(subscription, true, 0);
  subscription.invalidate();
  assert.equal(events.length, 2);
  assert.equal(events[0].signal.aborted, true);
  assert.equal(events[1].signal.aborted, false);
  assert.equal(subscription.latched, true);
  subscription.dispose();
  assert.equal(events[1].signal.aborted, true);
});

test('disposing pending async work never allows a later invocation or mutates older diagnostic state', async () => {
  let resolve;
  let calls = 0;

  const subscription = new Subscription(
    () => {
      calls++;

      return new Promise((settle) => {
        resolve = settle;
      });
    },
    { once: true },
    noError,
  );

  evaluate(subscription, true, 0);
  const previous = subscription.getDebugState();
  subscription.dispose();
  resolve();
  await flushPromises();
  assert.equal(evaluate(subscription, true, 1), null);
  assert.equal(calls, 1);
  assert.equal(previous.running, true);
  assert.equal(previous.latched, true);
  assert.equal(Object.isFrozen(previous), true);
  assert.equal(subscription.getDebugState().running, false);
  assert.equal(subscription.getDebugState().latched, false);
});

test('observation timestamps corroborate stability while repeated frames cannot start an action', () => {
  const events = [];

  const subscription = new Subscription(
    (event) => events.push(event),
    { stableForMs: 30 },
    noError,
  );

  const observed = (matches, now, timeStamp) =>
    subscription.evaluate(matches, now, context, true, timeStamp)?.();

  observed(false, 100, 100);
  observed(true, 132, 100);
  observed(true, 164, 100);
  assert.equal(events.length, 0);
  observed(true, 170, 150);
  observed(true, 210, 150);
  assert.equal(events.length, 0);
  observed(true, 215, 180);
  assert.equal(events.length, 1);
  subscription.invalidate();
  observed(true, 216, 180);
  observed(true, 250, 180);
  assert.equal(events.length, 1);
  observed(true, 260, 250);
  observed(true, 290, 280);
  assert.equal(events.length, 2);
});

test('new evidence is required after a miss even with zero stability duration', () => {
  const events = [];
  const subscription = new Subscription((event) => events.push(event), {}, noError);
  subscription.evaluate(false, 100, null, true, 100);
  subscription.evaluate(true, 120, context, true, 100)?.();
  assert.equal(events.length, 0);
  subscription.evaluate(true, 121, context, true, 101)?.();
  assert.equal(events.length, 1);
  subscription.evaluate(false, 122, null, true, 101);
  subscription.evaluate(true, 123, context, true, 101)?.();
  assert.equal(events.length, 1);
});

test('explicit evidence times must be finite and no later than evaluation', () => {
  const subscription = new Subscription(() => {}, {}, noError);

  for (const value of [NaN, Infinity, 11]) {
    assert.throws(() => subscription.evaluate(true, 10, context, true, value), RangeError);
  }
});

test('contact dwell does not turn an old measurement into fresh forecast evidence', () => {
  const events = [];

  const subscription = new Subscription((event) => events.push(event), { cooldownMs: 50 }, noError);

  subscription.evaluate(true, 100, context, true, 100)?.();
  subscription.evaluate(false, 110, null, true, 110);
  subscription.evaluate(true, 120, context, true, 111, true)?.();
  subscription.evaluate(true, 130, context, true, 111, true)?.();
  subscription.evaluate(true, 150, context, true, 111)?.();
  assert.equal(events.length, 1);
  subscription.evaluate(true, 151, context, true, 151)?.();
  assert.equal(events.length, 2);
});

test('invalidation and disposal expose distinct AbortSignal reasons', () => {
  const signals = [];
  const subscription = new Subscription((event) => signals.push(event.signal), {}, noError);

  subscription.evaluate(true, 100, context, true, 100)?.();
  subscription.evaluate(false, 110, null, true, 110);
  assert.equal(signals[0].reason, 'miss');

  subscription.evaluate(true, 120, context, true, 120)?.();
  subscription.invalidate('paused');
  assert.equal(signals[1].reason, 'paused');

  subscription.evaluate(true, 130, context, true, 130)?.();
  subscription.dispose('untracked');
  assert.equal(signals[2].reason, 'untracked');
});
