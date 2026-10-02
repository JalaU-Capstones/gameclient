<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { httpClient } from '$lib/api/client';
  import { session } from '$lib/stores/session';
  import type { User } from '$lib/types/api';
  import GameTitle from '$lib/components/GameTitle.svelte';

  let checking = $state(true);

  onMount(async () => {
    try {
      const user = await httpClient.get<User>('/api/v2/auth/me');
      session.setUser(user);
      await goto(resolve('/lobby'));
    } catch {
      session.clear();
      await goto(resolve('/login'));
    } finally {
      checking = false;
    }
  });
</script>

<main class="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
  <GameTitle text="GAME CLIENT" />
  {#if checking}
    <p class="text-sm uppercase tracking-widest text-[var(--text-muted)]">Loading…</p>
  {/if}
</main>
