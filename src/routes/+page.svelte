<script lang="ts">
  import { isHydrated } from '$lib/stores/session';
</script>

{#if !$isHydrated}
  <div class="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
    <p class="text-sm uppercase tracking-widest text-fg-muted">Loading…</p>
  </div>
{/if}
