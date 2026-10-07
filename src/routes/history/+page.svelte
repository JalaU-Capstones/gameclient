<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { gameplaysApi } from '$lib/api/gameplays';
  import type { GameplayRecord } from '$lib/api/gameplays';
  import { usersApi } from '$lib/api/user';
  import { userFacingMessage } from '$lib/errors/messages';
  import { currentUser } from '$lib/stores/session';
  import { getOutcome } from '$lib/utils/outcome';
  import type { Outcome } from '$lib/utils/outcome';

  let gamesList = $state<GameplayRecord[]>([]);
  let isLoading = $state(true);
  let error = $state('');
  let names = $state<Record<string, string>>({});

  const myId = $derived($currentUser?.id ?? '');

  const outcomeLabel: Record<Outcome, string> = {
    won: 'You won',
    lost: 'You lost',
    draw: 'Draw',
    in_progress: 'In progress',
    pending: 'Pending',
    rejected: 'Rejected'
  };

  const outcomeClasses: Record<Outcome, string> = {
    won: 'border-[var(--neon-cyan)] text-[var(--neon-cyan)] shadow-[var(--glow-cyan)]',
    lost: 'border-[var(--neon-magenta)] text-[var(--neon-magenta)]',
    draw: 'border-[var(--neon-yellow)] text-[var(--neon-yellow)] shadow-[var(--glow-yellow)]',
    in_progress: 'border-[var(--text-muted)] text-[var(--text-muted)]',
    pending: 'border-[var(--text-muted)] text-[var(--text-muted)]',
    rejected: 'border-[var(--text-muted)] text-[var(--text-muted)]'
  };

  function formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso)
    );
  }

  function rivalName(game: GameplayRecord): string {
    const rivalId = game.hostPlayer === myId ? game.guestPlayer : game.hostPlayer;
    return (rivalId && names[rivalId]) || 'Unknown player';
  }

  async function loadGames() {
    isLoading = true;
    error = '';
    try {
      const games = await gameplaysApi.listMine();
      const playerIds = games
        .flatMap((game) => [game.hostPlayer, game.guestPlayer])
        .filter((id): id is string => id !== null && id !== myId);
      names = await usersApi.getNames(playerIds);
      gamesList = games;
    } catch (err) {
      error = userFacingMessage(err instanceof ApiError ? err.code : undefined);
    } finally {
      isLoading = false;
    }
  }

  onMount(loadGames);
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-[var(--neon-cyan)]">History</h2>

  <div
    class="bg-[var(--cell)] rounded-xl border border-[var(--neon-cyan)] p-6 shadow-[var(--glow-cyan)]"
  >
    <div class="mb-6 border-b border-[var(--neon-cyan)] pb-2">
      <h3 class="text-2xl font-bold text-[var(--text-primary)]">Your games</h3>
    </div>

    {#if isLoading}
      <p class="text-[var(--text-muted)] text-center py-8 text-xl">Loading games...</p>
    {:else if error}
      <div
        class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
      >
        {error}
      </div>
    {:else if gamesList.length === 0}
      <p class="font-(family-name:--font-title) text-[var(--text-muted)] text-center py-8">
        No games played yet.
      </p>
    {:else}
      <ul class="space-y-4">
        {#each gamesList as game (game.id)}
          <li
            class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 bg-[var(--bg)] border border-[var(--neon-cyan)]/30 rounded-lg hover:border-[var(--neon-cyan)] transition"
          >
            <div class="min-w-0">
              <p class="text-xl font-mono truncate">{rivalName(game)}</p>
              <p class="text-sm text-[var(--text-muted)]">{formatDate(game.createdDate)}</p>
            </div>
            <span
              class="self-start md:self-auto px-6 py-2 uppercase tracking-widest text-sm rounded-full border whitespace-nowrap {outcomeClasses[
                getOutcome(game, myId)
              ]}"
            >
              {outcomeLabel[getOutcome(game, myId)]}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
