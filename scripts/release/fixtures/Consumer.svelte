<script>
  import { useHasta } from '@66hex/hasta/svelte';

  const hasta = useHasta({ debug: true });
</script>

<button type="button">{hasta.getDebugSnapshot() === null ? 'Svelte consumer' : 'connected'}</button>
