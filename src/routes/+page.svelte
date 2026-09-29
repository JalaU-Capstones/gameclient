<script lang="ts">
  import { onMount } from 'svelte';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { healthApi } from '$lib/api/health';

  type Status = 'checking' | 'ok' | 'error';

  let status = $state<Status>('checking');
  let errorMessage = $state<string | null>(null);

  async function check(): Promise<void> {
    status = 'checking';
    errorMessage = null;

    try {
      await healthApi.check();
      status = 'ok';
    } catch (err) {
      status = 'error';
      if (err instanceof ApiError) {
        errorMessage = `HTTP ${err.status}: ${err.message}`;
      } else if (err instanceof TimeoutError) {
        errorMessage = 'Request timed out';
      } else if (err instanceof NetworkError) {
        errorMessage = 'Backend unreachable';
      } else {
        errorMessage = err instanceof Error ? err.message : 'Unknown error';
      }
    }
  }

  onMount(check);
</script>

<main class="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
  <GameTitle text="GAME CLIENT" />

  <section class="rounded-2xl border border-[var(--cell)] bg-[var(--cell)] px-6 py-4 text-center">
    <p class="text-sm uppercase tracking-widest text-[var(--text-muted)]">Backend</p>
    <p class="mt-2 text-2xl">
      {#if status === 'checking'}CHECKING…{:else if status === 'ok'}ONLINE{:else}OFFLINE{/if}
    </p>
    {#if errorMessage}
      <p class="mt-2 text-xs text-[var(--text-muted)]">{errorMessage}</p>
    {/if}
    <button
      type="button"
      onclick={check}
      class="mt-4 rounded-full border border-[var(--neon-magenta)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-magenta)] hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)]"
    >
      Retry
    </button>
  </section>
</main>
