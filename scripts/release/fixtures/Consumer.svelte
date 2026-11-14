<script>
  import { useHasta } from 'hasta/svelte';

  const hasta = useHasta({ debug: true });
</script>

<button type="button">{hasta.getDebugSnapshot() === null ? 'Svelte consumer' : 'connected'}</button>
