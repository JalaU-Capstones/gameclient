<script lang="ts">
  import { isHydrated } from '$lib/stores/session';
</script>

{#if !$isHydrated}
  <div class="flex min-h-[60vh] items-center justify-center">
    <p class="text-sm uppercase tracking-widest text-[var(--text-muted)]">Loading…</p>
  </div>
{/if}
