<script lang="ts">
  import type { ComponentType } from 'svelte';

  export let show = false;
  export let component: ComponentType | null = null;
  export let componentProps: Record<string, unknown> = {};
</script>

<div class="w-full overflow-hidden" data-testid="chart-shell">
  {#if show && component}
    <svelte:component this={component} {...componentProps} />
  {/if}
</div>
