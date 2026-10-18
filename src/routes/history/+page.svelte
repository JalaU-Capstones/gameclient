<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { ApiError } from '$lib/api/errors';
  import { gameplaysApi } from '$lib/api/gameplays';
  import type { GameplayRecord } from '$lib/api/gameplays';
  import { usersApi } from '$lib/api/user';
  import { userFacingMessage } from '$lib/errors/messages';
  import { currentUser } from '$lib/stores/session';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import { pushToast } from '$lib/stores/toasts';
  import { getOutcome } from '$lib/utils/outcome';
  import type { Outcome } from '$lib/utils/outcome';
  import { sanitizeDisplayName } from '$lib/utils/text';
  import CountdownButton from '$lib/components/CountdownButton.svelte';

  interface RetryState {
    inFlight: boolean;
    retryAfter?: number;
    remaining?: number;
    attempt?: number;
    key: number;
  }

  let gamesList = $state<GameplayRecord[]>([]);
  let isLoading = $state(true);
  let error = $state('');
  let names = $state<Record<string, string>>({});
  let retryStates = new SvelteMap<string, RetryState>();
  let currentRetryGameId: string | null = null;
  let unsubscribers: (() => void)[] = [];
  let stopClient: (() => void) | null = null;

  const myId = $derived($currentUser?.id ?? '');

  const outcomeLabel: Record<Outcome, string> = {
    won: 'You won',
    lost: 'You lost',
    draw: 'Draw',
    in_progress: 'In progress',
    pending: 'Waiting for response',
    rejected: 'Rejected',
    expired: 'Expired',
    canceled: 'Canceled',
    busy: 'Player busy'
  };

  const outcomeClasses: Record<Outcome, string> = {
    won: 'border-neon-cyan text-neon-cyan shadow-glow-cyan',
    lost: 'border-neon-magenta text-neon-magenta',
    draw: 'border-neon-yellow text-neon-yellow shadow-glow-yellow',
    in_progress: 'border-fg-muted text-fg-muted',
    pending: 'border-fg-muted text-fg-muted',
    rejected: 'border-fg-muted text-fg-muted',
    expired: 'border-fg-muted text-fg-muted',
    canceled: 'border-fg-muted text-fg-muted',
    busy: 'border-fg-muted text-fg-muted'
  };

  function formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso)
    );
  }

  function rivalName(game: GameplayRecord): string {
    const rivalId = game.hostPlayer === myId ? game.guestPlayer : game.hostPlayer;
    return (rivalId && names[rivalId] && sanitizeDisplayName(names[rivalId])) || 'Unknown player';
  }

  function mobileOutcomeLabel(game: GameplayRecord): string {
    const outcome = getOutcome(game, myId);
    switch (outcome) {
      case 'won':
        return 'Victory';
      case 'lost':
        return 'Defeat';
      case 'draw':
        return 'Draw';
      case 'in_progress':
        return 'Ongoing';
      case 'pending':
        return 'Pending';
      case 'rejected':
        return 'Rejected';
      case 'expired':
        return 'Expired';
      case 'canceled':
        return 'Canceled';
      case 'busy':
        return 'Busy';
      default:
        return outcomeLabel[outcome];
    }
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

  function handleRetry(game: GameplayRecord) {
    if (!game.id) return;
    if (game.hostPlayer !== myId) return;
    if (
      game.invitationState !== 'rejected' &&
      game.invitationState !== 'expired' &&
      game.invitationState !== 'canceled'
    )
      return;
    const current = retryStates.get(game.id);
    if (current?.inFlight) return;
    if (current?.retryAfter !== undefined && current.retryAfter > 0) return;

    currentRetryGameId = game.id;
    retryStates.set(game.id, {
      inFlight: true,
      key: (current?.key ?? 0) + 1
    });
    const client = globalGameplaysClient.getOrCreate();
    if (!client.isAlive()) {
      pushToast('warning', 'Unable to retry. Please log in again.');
      retryStates.delete(game.id);
      currentRetryGameId = null;
      return;
    }
    client.send('retry_invitation', { game_id: game.id });
  }

  onMount(() => {
    loadGames();
    stopClient = globalGameplaysClient.subscribe((client) => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      if (!client) return;

      unsubscribers.push(
        client.on(
          'invitation_retry_accepted',
          (
            payload: { game_id?: string; attempt?: number; remaining_attempts?: number } | undefined
          ) => {
            if (!payload?.game_id) return;
            const state = retryStates.get(payload.game_id);
            if (!state) return;
            retryStates.set(payload.game_id, {
              inFlight: false,
              remaining: payload.remaining_attempts ?? 0,
              attempt: payload.attempt ?? 0,
              key: state.key + 1
            });
            gamesList = gamesList.map((game) =>
              game.id === payload.game_id
                ? { ...game, invitationState: 'pending', matchResult: null }
                : game
            );
          }
        )
      );

      unsubscribers.push(
        client.on(
          'error',
          (payload: { code?: string; retry_after_seconds?: number } | undefined) => {
            if (!payload || payload.code !== 'RETRY_LIMIT_EXCEEDED') return;
            const gameId = currentRetryGameId;
            if (!gameId) return;
            const state = retryStates.get(gameId);
            if (!state) return;
            retryStates.set(gameId, {
              inFlight: false,
              retryAfter: payload.retry_after_seconds ?? 60,
              remaining: 0,
              attempt: state.attempt ?? 0,
              key: state.key + 1
            });
          }
        )
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      stopClient?.();
      stopClient = null;
    };
  });

  onDestroy(() => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    stopClient?.();
    stopClient = null;
  });
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-neon-cyan">History</h2>

  <div class="bg-cell rounded-xl border border-neon-cyan p-6 shadow-glow-cyan">
    <div class="mb-6 border-b border-neon-cyan pb-2">
      <h3 class="text-2xl font-bold text-fg">Your games</h3>
    </div>

    {#if isLoading}
      <p class="text-fg-muted text-center py-8 text-xl">Loading games...</p>
    {:else if error}
      <div
        class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
      >
        {error}
      </div>
    {:else if gamesList.length === 0}
      <p class="font-(family-name:--font-title) text-fg-muted text-center py-8">
        No games played yet.
      </p>
    {:else}
      <div class="hidden md:block">
        <ul class="space-y-4">
          {#each gamesList as game (game.id)}
            <li
              class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-4 bg-bg border border-neon-cyan/30 rounded-lg hover:border-neon-cyan transition"
            >
              <div class="min-w-0">
                <p class="text-xl font-mono truncate">{rivalName(game)}</p>
                <p class="text-sm text-fg-muted">{formatDate(game.createdDate)}</p>
              </div>
              <div class="flex flex-col items-start gap-2 md:items-end">
                <span
                  class="self-start md:self-auto px-6 py-2 uppercase tracking-widest text-sm rounded-full border whitespace-nowrap {outcomeClasses[
                    getOutcome(game, myId)
                  ]}"
                >
                  {outcomeLabel[getOutcome(game, myId)]}
                </span>
                {#if game.hostPlayer === myId && (getOutcome(game, myId) === 'rejected' || getOutcome(game, myId) === 'expired' || getOutcome(game, myId) === 'canceled')}
                  {@const retryState = retryStates.get(game.id)}
                  {#if retryState?.retryAfter !== undefined && retryState.retryAfter > 0}
                    {#key retryState.key}
                      <CountdownButton
                        seconds={retryState.retryAfter}
                        disabled={retryState.inFlight || $standbyMode}
                        onclick={() => handleRetry(game)}
                        label="Retry in"
                        class="self-start md:self-auto px-4 py-2 rounded-full border border-neon-cyan text-neon-cyan uppercase tracking-widest text-sm transition hover:bg-neon-cyan hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    {/key}
                  {:else}
                    <button
                      type="button"
                      disabled={retryState?.inFlight || $standbyMode}
                      onclick={() => handleRetry(game)}
                      class="self-start md:self-auto px-4 py-2 rounded-full border border-neon-cyan text-neon-cyan uppercase tracking-widest text-sm transition hover:bg-neon-cyan hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {retryState?.inFlight ? 'Retrying…' : 'Retry'}
                    </button>
                  {/if}
                  {#if retryState?.remaining !== undefined}
                    <span class="text-xs uppercase tracking-widest text-fg-muted">
                      {retryState.remaining === 0
                        ? 'No retries left'
                        : `${retryState.remaining} remaining`}
                    </span>
                  {/if}
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>

      <div class="md:hidden flex flex-col gap-3">
        {#each gamesList as game (game.id)}
          <div class="flex flex-col gap-2 rounded-xl border border-neon-cyan/40 bg-cell p-4">
            <div class="flex justify-between text-sm">
              <span class="text-fg-muted">Opponent</span>
              <span class="font-bold text-fg">{rivalName(game)}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-fg-muted">Status</span>
              <span class="font-bold text-fg">{mobileOutcomeLabel(game)}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-fg-muted">Date</span>
              <span class="font-bold text-fg">{formatDate(game.createdDate)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
