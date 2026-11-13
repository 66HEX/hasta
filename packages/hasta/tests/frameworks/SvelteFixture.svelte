<script lang="ts">
  import { attachHastaTarget, hastaTarget, useHasta } from 'hasta/svelte';
  import type { HastaActionOptions, IntersectionEvent } from 'hasta/svelte';

  const hasta = useHasta({ debug: { panel: false } });
  const alternate = useHasta({ debug: { panel: false } });
  let horizon = $state(120);
  let callbackVersion = $state(1);
  let show = $state(true);
  let key = $state(0);
  let switchController = $state(false);
  let attachment = $state(false);
  let mutable = $state(false);
  let debug = $state(true);
  let clicks = $state(0);
  let aborted = $state(0);
  let calls = $state.raw<{ version: number; etaMs: number }[]>([]);

  function callback(version: number) {
    return (event: IntersectionEvent) => {
      calls = [...calls, { version, etaMs: event.etaMs }];
      event.signal.addEventListener(
        'abort',
        () => {
          aborted++;
        },
        { once: true },
      );
    };
  }

  const onPredict = $derived(callback(callbackVersion));

  const options: HastaActionOptions = $derived({
    hasta: switchController ? alternate : hasta,
    when: { type: 'intersects', withinMs: horizon },
    onPredict,
  });

  const mutableOptions = $state({
    hasta,
    when: { type: 'intersects' as const, withinMs: 120 },
    onPredict: callback(1),
  });

  const actionOptions = $derived(mutable ? mutableOptions : options);
  const attachTarget = attachHastaTarget(() => actionOptions);

  $effect(() => {
    hasta.updateOptions({ debug: debug ? { panel: false } : false });
    alternate.updateOptions({ debug: debug ? { panel: false } : false });
  });

  export function configure(next: {
    horizon?: number;
    callbackVersion?: number;
    show?: boolean;
    replace?: boolean;
    switchController?: boolean;
    attachment?: boolean;
    mutable?: boolean;
    debug?: boolean;
  }) {
    if (next.horizon !== undefined) {
      horizon = next.horizon;
      mutableOptions.when.withinMs = next.horizon;
    }

    if (next.callbackVersion !== undefined) {
      callbackVersion = next.callbackVersion;
      mutableOptions.onPredict = callback(next.callbackVersion);
    }

    if (next.show !== undefined) {
      show = next.show;
    }

    if (next.replace) {
      key++;
    }

    if (next.switchController !== undefined) {
      switchController = next.switchController;
      mutableOptions.hasta = next.switchController ? alternate : hasta;
    }

    if (next.attachment !== undefined) {
      attachment = next.attachment;
    }

    if (next.mutable !== undefined) {
      mutable = next.mutable;
    }

    if (next.debug !== undefined) {
      debug = next.debug;
    }
  }

  export function read() {
    return {
      calls: [...calls],
      aborted,
      clicks,
      snapshot: hasta.getDebugSnapshot(),
      alternateSnapshot: alternate.getDebugSnapshot(),
    };
  }

  export function pause() {
    hasta.pause();
    alternate.pause();
  }

  export function resume() {
    hasta.resume();
    alternate.resume();
  }
</script>

{#if show}
  {#key key}
    {#if attachment}
      <button
        data-testid="svelte-target"
        type="button"
        {@attach attachTarget}
        onclick={() => {
          clicks++;
        }}>Svelte attachment target</button
      >
    {:else}
      <button
        data-testid="svelte-target"
        type="button"
        use:hastaTarget={actionOptions}
        onclick={() => {
          clicks++;
        }}>Svelte action target</button
      >
    {/if}
  {/key}
{/if}
<output data-testid="svelte-calls">{calls.length}</output>
<output data-testid="svelte-clicks">{clicks}</output>

<style>
  button {
    position: absolute;
    left: 100px;
    top: 100px;
    width: 100px;
    height: 30px;
  }
</style>
