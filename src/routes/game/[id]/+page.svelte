<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { bootstrapSession, handleAuthFailure } from '$lib/auth/bootstrap';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { httpClient } from '$lib/api/client';
  import { sounds } from '$lib/audio/sounds';
  import { pushToast } from '$lib/stores/toasts';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import { currentUser } from '$lib/stores/session';
  import type { WebSocketClient } from '$lib/api/ws';
  import type { InvitationState, PublicUser, Gameplay } from '$lib/types/api';
  import { userFacingMessage } from '$lib/errors/messages';
  import OnlinePlayersMenu from '$lib/components/OnlinePlayersMenu.svelte';
  import CountdownButton from '$lib/components/CountdownButton.svelte';
  import { isUuid, safeRandomUuid } from '$lib/utils/uuid';
  import { sanitizeDisplayName } from '$lib/utils/text';

  let gameplaysClient: WebSocketClient;
  let unsubscribers: (() => void)[] = [];
  let hostUser = $state<PublicUser | null>(null);
  let guestUser = $state<PublicUser | null>(null);
  let board = $state<number[][]>([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]);
  let invitationState = $state<InvitationState>('accepted');
  let retryInFlight = $state(false);
  let retryAttempt = $state(0);
  let retryRemainingAttempts = $state<number | undefined>(undefined);
  let retryAfterSeconds = $state<number | undefined>(undefined);
  let turn = $state<string>('');
  let winner = $state<string | null>(null);
  let endReason = $state<string | null>(null);
  let gameEnded = $state(false);
  let error = $state<string>('');
  let isLoading = $state(true);
  let waitingForRematch = $state(false);
  let lastInviteSentAt = 0;
  let moveInFlight = false;
  let currentGameId = $state('');
  let authRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let authRetryUsed = false;
  let moveDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMoveRequestId: string | null = null;
  let lastRetryUpdatedAt: string | null = null;

  const MOVE_DEADLINE_MS = 8_000;

  function applyBoardSnapshot(snapshot: number[][]) {
    board = snapshot.map((row) => [...row]);
  }

  function clearMoveInFlight() {
    if (moveDeadlineTimer) {
      clearTimeout(moveDeadlineTimer);
      moveDeadlineTimer = undefined;
    }
    moveInFlight = false;
    lastMoveRequestId = null;
  }

  function armMoveDeadline() {
    if (moveDeadlineTimer) clearTimeout(moveDeadlineTimer);
    moveDeadlineTimer = setTimeout(() => {
      if (!moveInFlight) return;
      clearMoveInFlight();
      pushToast('warning', userFacingMessage('MOVE_TIMEOUT'));
    }, MOVE_DEADLINE_MS);
  }

  let isGameOver = $derived(gameEnded || winner !== null || endReason !== null);
  let isDraw = $derived(
    endReason === 'draw' || (isGameOver && (winner === null || winner === 'None'))
  );
  let canPlay = $derived(
    invitationState === 'accepted' && $currentUser?.id === turn && !isGameOver
  );
  let isWaiting = $derived(invitationState === 'pending' || invitationState === 'queued');
  let canRetry = $derived(
    invitationState === 'rejected' ||
      invitationState === 'expired' ||
      invitationState === 'canceled'
  );
  let isHost = $derived(!!hostUser && hostUser.id === $currentUser?.id);
  let showRetryButton = $derived(canRetry && isHost && !isGameOver);

  function handleGameplayAuthFailure(failure: unknown, gameId: string) {
    handleAuthFailure(
      failure,
      (message) => {
        error = message;
        if (
          (failure instanceof NetworkError || failure instanceof TimeoutError) &&
          !authRetryUsed
        ) {
          authRetryUsed = true;
          authRetryTimer = setTimeout(() => {
            authRetryTimer = undefined;
            void bootstrapSession()
              .then(({ accessToken }) => {
                if (!accessToken) throw new Error('No access token from session bootstrap');
                gameplaysClient.connect(accessToken);
              })
              .catch((retryFailure: unknown) => {
                handleAuthFailure(retryFailure, (retryMessage) => (error = retryMessage), gameId);
              });
          }, 1200);
        }
      },
      `/game/${gameId}`,
      'Failed to connect to game.'
    );
  }

  let winLine = $derived.by(() => {
    if (!winner || endReason !== 'line') return null;
    for (let r = 0; r < 3; r++) {
      if (board[r][0] !== 0 && board[r][0] === board[r][1] && board[r][1] === board[r][2])
        return { type: 'row', index: r };
    }
    for (let c = 0; c < 3; c++) {
      if (board[0][c] !== 0 && board[0][c] === board[1][c] && board[1][c] === board[2][c])
        return { type: 'col', index: c };
    }
    if (board[0][0] !== 0 && board[0][0] === board[1][1] && board[1][1] === board[2][2])
      return { type: 'diag1' };
    if (board[0][2] !== 0 && board[0][2] === board[1][1] && board[1][1] === board[2][0])
      return { type: 'diag2' };
    return null;
  });

  let lineCoords = $derived.by(() => {
    if (!winLine) return null;
    if (winLine.type === 'row') {
      const y = winLine.index! * 33.333 + 16.666;
      return { x1: 5, y1: y, x2: 95, y2: y };
    }
    if (winLine.type === 'col') {
      const x = winLine.index! * 33.333 + 16.666;
      return { x1: x, y1: 5, x2: x, y2: 95 };
    }
    if (winLine.type === 'diag1') {
      return { x1: 5, y1: 5, x2: 95, y2: 95 };
    }
    if (winLine.type === 'diag2') {
      return { x1: 95, y1: 5, x2: 5, y2: 95 };
    }
    return null;
  });

  async function loadGame(id: string) {
    unsubscribers.forEach((unsub) => unsub());
    unsubscribers = [];

    applyBoardSnapshot([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]);
    turn = '';
    winner = null;
    endReason = null;
    gameEnded = false;
    clearMoveInFlight();
    error = '';
    lastMoveRequestId = null;
    retryInFlight = false;
    retryAttempt = 0;
    retryRemainingAttempts = undefined;
    retryAfterSeconds = undefined;
    lastRetryUpdatedAt = null;
    isLoading = true;
    waitingForRematch = false;

    try {
      const { accessToken } = await bootstrapSession();
      if (!accessToken)
        throw new Error('No access token is available for the WebSocket connection');

      const gameplay = await httpClient.get<Gameplay>(`/api/v2/gameplays/${id}`);
      invitationState =
        gameplay.invitationState ??
        (gameplay.guestPlayer !== null && gameplay.matchResult === null ? 'accepted' : 'pending');

      const positions = gameplay.currentPositions
        ? JSON.parse(gameplay.currentPositions as string)
        : {
            board: [
              [0, 0, 0],
              [0, 0, 0],
              [0, 0, 0]
            ]
          };
      applyBoardSnapshot(positions.board);
      turn = gameplay.playerTurn as string;

      if (gameplay.matchResult && gameplay.matchResult !== null) {
        let result: Record<string, unknown> = gameplay.matchResult as unknown as Record<
          string,
          unknown
        >;
        if (typeof gameplay.matchResult === 'string') {
          result = JSON.parse(gameplay.matchResult) as Record<string, unknown>;
        }
        if (result.winner === 'host') winner = gameplay.hostPlayer as string;
        else if (result.winner === 'guest') winner = gameplay.guestPlayer as string;
        else if (result.winner) winner = result.winner as string;
        endReason = result.reason as string;
      }

      if (gameplay.hostPlayer) {
        hostUser = await httpClient
          .get<PublicUser>(`/api/v2/users/${gameplay.hostPlayer}`)
          .catch(() => null);
      }
      if (gameplay.guestPlayer) {
        guestUser = await httpClient
          .get<PublicUser>(`/api/v2/users/${gameplay.guestPlayer}`)
          .catch(() => null);
      }

      isLoading = false;
      gameplaysClient = globalGameplaysClient.getOrCreate();
      const setupClient = (client: WebSocketClient) => {
        unsubscribers.push(
          client.on(
            'board_updated',
            (
              payload: { board?: number[][]; turn?: string; client_request_id?: string } | undefined
            ) => {
              if (payload?.client_request_id && payload.client_request_id === lastMoveRequestId) {
                lastMoveRequestId = null;
              }
              if (gameEnded) {
                clearMoveInFlight();
                return;
              }
              if (payload?.board) applyBoardSnapshot(payload.board);
              if (payload?.turn) turn = payload.turn;
              clearMoveInFlight();
              lastMoveRequestId = null;
            }
          )
        );
        unsubscribers.push(
          client.on(
            'game_over',
            (payload: { winner?: string | null; reason?: string } | undefined) => {
              gameEnded = true;
              winner = payload?.winner ?? null;
              endReason = payload?.reason ?? null;
              clearMoveInFlight();
              if (winner === $currentUser?.id) sounds.play('win');
              else if (winner) sounds.play('lose');
              else sounds.play('draw');
            }
          )
        );
        unsubscribers.push(
          client.on(
            'game_ended',
            (
              payload: { winner?: string | null; reason?: string; board?: number[][] } | undefined
            ) => {
              gameEnded = true;
              if (payload?.board) applyBoardSnapshot(payload.board);
              winner = payload?.winner ?? null;
              endReason = payload?.reason ?? null;
              clearMoveInFlight();
              if (winner === $currentUser?.id) sounds.play('win');
              else if (winner) sounds.play('lose');
              else sounds.play('draw');
            }
          )
        );
        unsubscribers.push(
          client.on('auth_ok', () => {
            gameplaysClient.send('subscribe_game', { game_id: id });
          })
        );
        unsubscribers.push(
          client.on('invitation_queued', (payload: { game_id?: string } | undefined) => {
            if (payload?.game_id && payload.game_id !== currentGameId) return;
            if (invitationState !== 'pending' && invitationState !== 'queued') return;
            invitationState = 'queued';
            pushToast(
              'info',
              'Invitation queued. You will be notified when the player is available.'
            );
          })
        );
        unsubscribers.push(
          client.on(
            'invitation_accepted',
            (payload: { game_id?: string; board?: number[][]; turn?: string } | undefined) => {
              if (payload?.game_id && payload.game_id !== currentGameId) return;
              if (gameEnded || (invitationState !== 'pending' && invitationState !== 'queued')) {
                return;
              }
              invitationState = 'accepted';
              if (payload?.board) applyBoardSnapshot(payload.board);
              if (payload?.turn) turn = payload.turn;
              waitingForRematch = false;
              error = '';
              clearMoveInFlight();
            }
          )
        );
        unsubscribers.push(
          client.on('invitation_rejected', (payload: { game_id?: string } | undefined) => {
            if (payload?.game_id && payload.game_id !== currentGameId) return;
            if (gameEnded || (invitationState !== 'pending' && invitationState !== 'queued'))
              return;
            invitationState = 'rejected';
            waitingForRematch = false;
            clearMoveInFlight();
            pushToast('warning', userFacingMessage('INVITATION_REJECTED'));
          })
        );
        unsubscribers.push(
          client.on(
            'invitation_expired',
            (payload: { game_id?: string; reason?: string; updated_at?: string } | undefined) => {
              if (payload?.game_id && payload.game_id !== currentGameId) return;
              if (
                lastRetryUpdatedAt &&
                payload?.updated_at &&
                payload.updated_at <= lastRetryUpdatedAt
              ) {
                return;
              }
              if (gameEnded || (invitationState !== 'pending' && invitationState !== 'queued'))
                return;
              invitationState = 'expired';
              waitingForRematch = false;
              clearMoveInFlight();
              pushToast('warning', userFacingMessage('INVITATION_EXPIRED'));
            }
          )
        );
        unsubscribers.push(
          client.on('invitation_canceled', (payload: { game_id?: string } | undefined) => {
            if (payload?.game_id && payload.game_id !== currentGameId) return;
            if (gameEnded || (invitationState !== 'pending' && invitationState !== 'queued'))
              return;
            invitationState = 'canceled';
            waitingForRematch = false;
            clearMoveInFlight();
            pushToast('warning', userFacingMessage('INVITATION_CANCELED'));
          })
        );
        unsubscribers.push(
          client.on(
            'invitation_replaced',
            (payload: { game_id?: string; reason?: string } | undefined) => {
              if (payload?.game_id && payload.game_id !== currentGameId) return;
              pushToast('warning', 'Another player accepted the invitation first.');
              clearMoveInFlight();
              retryInFlight = false;
              setTimeout(() => {
                if ($standbyMode) return;
                goto(resolve('/lobby'));
              }, 2500);
            }
          )
        );
        unsubscribers.push(
          client.on(
            'invitation_retry_accepted',
            (
              payload:
                | {
                    game_id?: string;
                    attempt?: number;
                    remaining_attempts?: number;
                    idempotent?: boolean;
                    updated_at?: string;
                  }
                | undefined
            ) => {
              if (!payload || !payload.game_id) return;
              if (payload.game_id !== currentGameId) return;
              retryInFlight = false;
              retryAttempt = payload.attempt ?? 0;
              retryRemainingAttempts = payload.remaining_attempts ?? undefined;
              retryAfterSeconds = undefined;
              if (payload.updated_at) lastRetryUpdatedAt = payload.updated_at;
              invitationState = 'pending';
              pushToast(
                'info',
                payload.idempotent === true
                  ? 'This invitation was already pending. Your view is synced.'
                  : 'Retry sent. Waiting for the guest to respond...'
              );
            }
          )
        );
        unsubscribers.push(
          client.on(
            'error',
            (
              payload: { code?: string; message?: string; retry_after_seconds?: number } | undefined
            ) => {
              clearMoveInFlight();
              if (payload?.code && payload.code !== 'OPPONENT_OFFLINE') {
                waitingForRematch = false;
              }
              if (payload?.code === 'RETRY_LIMIT_EXCEEDED') {
                retryInFlight = false;
                const seconds = payload.retry_after_seconds ?? 60;
                retryAfterSeconds = seconds;
                error = `Retry limit reached. Wait ${seconds} seconds.`;
                setTimeout(() => (error = ''), 3000);
                return;
              }
              if (payload?.code === 'CREATE_GAME_RATE_LIMITED') {
                retryInFlight = false;
                const seconds = payload.retry_after_seconds ?? 60;
                error = `Too many invitations. Wait ${seconds} seconds.`;
                setTimeout(() => (error = ''), 3000);
                return;
              }
              if (payload?.code === 'GAME_NOT_ACTIVE') {
                error = userFacingMessage(payload.code, 'That game has already ended.');
                return;
              }
              error = userFacingMessage(payload?.code, 'Something went wrong. Please try again.');
              setTimeout(() => (error = ''), 3000);
            }
          )
        );
        unsubscribers.push(
          client.on('auth_failed', (payload: { code?: number; reason?: string } | undefined) => {
            const failure =
              payload?.code === 4401 || payload?.reason === 'auth_error'
                ? new ApiError('Gameplay authentication failed', 401, 'AUTH_FAILED')
                : new TimeoutError('Gameplay authentication timed out');
            handleGameplayAuthFailure(failure, id);
          })
        );
      };

      setupClient(gameplaysClient);
      const isConnected = get(gameplaysClient.state) === 'connected' && gameplaysClient.isAlive();
      if (isConnected) {
        gameplaysClient.send('subscribe_game', { game_id: id });
      } else {
        gameplaysClient.connect(accessToken);
      }
    } catch (err: unknown) {
      handleAuthFailure(
        err,
        (message) => (error = message),
        `/game/${id}`,
        userFacingMessage(err instanceof ApiError ? err.code : undefined, 'Failed to load game')
      );
      isLoading = false;
    }
  }

  $effect(() => {
    const id = $page.params.id;
    if (id && id !== currentGameId) {
      currentGameId = id;
      loadGame(id);
    }
  });

  let gameplayClientSubscription: (() => void) | null = null;

  onMount(() => {
    if (import.meta.env.DEV) console.debug('[game] mount');
    gameplayClientSubscription = globalGameplaysClient.subscribe((client) => {
      if (!client || !currentGameId) return;
      if (gameplaysClient && client !== gameplaysClient) {
        if (import.meta.env.DEV) console.debug('[game] gameplay client replaced; resyncing');
        clearMoveInFlight();
        void loadGame(currentGameId);
      }
    });
  });

  function leaveCurrentGameOnDestroy() {
    if (!currentGameId || !gameplaysClient) return;
    gameplaysClient.send('leave_game', { game_id: currentGameId });
  }

  onDestroy(() => {
    if (import.meta.env.DEV) console.debug('[game] destroy; retaining gameplay socket');
    gameplayClientSubscription?.();
    gameplayClientSubscription = null;
    if (authRetryTimer) clearTimeout(authRetryTimer);
    clearMoveInFlight();
    leaveCurrentGameOnDestroy();
    unsubscribers.forEach((unsub) => unsub());
  });

  function playMove(row: number, col: number) {
    if ($standbyMode || moveInFlight || !canPlay || board[row][col] !== 0) return;
    if (!hostUser || !guestUser) return;
    if (!currentGameId) return;

    const clientRequestId = safeRandomUuid();
    lastMoveRequestId = clientRequestId;
    moveInFlight = true;
    armMoveDeadline();

    sounds.play('click');
    gameplaysClient.send('play_move', {
      game_id: currentGameId,
      row,
      col,
      client_request_id: clientRequestId
    });
  }

  function handlePlayAgain() {
    if ($standbyMode) return;
    const opponent = hostUser?.id === $currentUser?.id ? guestUser : hostUser;
    if (!opponent || !isUuid(opponent.id)) {
      error = 'Opponent is not available';
      setTimeout(() => (error = ''), 3000);
      return;
    }

    const now = Date.now();
    if (now - lastInviteSentAt < 500) return;
    lastInviteSentAt = now;

    sounds.play('click');
    waitingForRematch = true;
    invitationState = 'queued';
    gameplaysClient.send('create_game', {
      guest_id: opponent.id,
      client_request_id: safeRandomUuid()
    });
  }

  function handleCancelInvitation() {
    if ($standbyMode || !currentGameId) return;
    gameplaysClient.send('leave_game', { game_id: currentGameId });
    goto(resolve('/lobby'));
  }

  function handleRetry() {
    if ($standbyMode || retryInFlight || !currentGameId || !isHost) return;
    if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) return;

    retryInFlight = true;
    retryAttempt += 1;
    retryRemainingAttempts = undefined;
    retryAfterSeconds = undefined;
    sounds.play('click');
    gameplaysClient.send('retry_invitation', { game_id: currentGameId });
  }

  function handleInviteOnlinePlayer(userId: string) {
    if ($standbyMode || isWaiting || !isUuid(userId)) return;

    const now = Date.now();
    if (now - lastInviteSentAt < 500) return;
    lastInviteSentAt = now;

    sounds.play('click');
    invitationState = 'queued';
    gameplaysClient.send('create_game', {
      guest_id: userId,
      client_request_id: safeRandomUuid()
    });
  }

  function goLobby() {
    if ($standbyMode) return;
    goto(resolve('/lobby'));
  }
</script>

<svelte:head>
  <title>Game - Tic Tac Toe</title>
</svelte:head>

<section class="max-w-2xl mx-auto space-y-8 animate-fade-in relative">
  {#if error}
    <div
      class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center absolute top-[-60px] left-0 right-0 z-10"
    >
      {error}
    </div>
  {/if}

  {#if isLoading}
    <div class="flex items-center justify-center h-64 text-[var(--neon-cyan)]">
      <div class="animate-pulse tracking-[0.25em] uppercase text-xl">Loading Game...</div>
    </div>
  {:else}
    <h2 class="text-2xl uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Game</h2>
    <div
      class="flex justify-between items-center bg-[var(--cell)] p-6 rounded-2xl border-2 border-[var(--border-color)] shadow-xl"
    >
      <div class="text-center flex-1">
        <div class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-2">Host (X)</div>
        <div
          class="text-xl font-bold"
          class:text-[var(--neon-magenta)]={hostUser?.id === turn}
          class:text-glow-magenta={hostUser?.id === turn}
        >
          {hostUser ? sanitizeDisplayName(hostUser.name) || 'Unknown' : 'Unknown'}
        </div>
      </div>

      <div class="text-3xl font-black text-[var(--text-muted)] px-8 opacity-50">VS</div>

      <div class="text-center flex-1">
        <div class="text-xs uppercase tracking-widest text-[var(--text-muted)] mb-2">Guest (O)</div>
        <div
          class="text-xl font-bold"
          class:text-[var(--neon-cyan)]={guestUser?.id === turn}
          class:text-glow-cyan={guestUser?.id === turn}
        >
          {guestUser ? sanitizeDisplayName(guestUser.name) || 'Unknown' : 'Unknown'}
        </div>
      </div>
    </div>

    <div class="text-center">
      {#if isGameOver}
        {#if isDraw}
          <div
            class="text-3xl font-black text-amber-400 animate-pulse tracking-widest text-glow-amber"
          >
            DRAW
          </div>
        {:else if winner === $currentUser?.id}
          <div
            class="text-3xl font-black text-green-400 animate-bounce tracking-widest text-glow-green"
          >
            YOU WON!
          </div>
        {:else}
          <div class="text-3xl font-black text-red-400 tracking-widest text-glow-red">YOU LOST</div>
        {/if}
        <div class="text-sm text-[var(--text-muted)] mt-2 uppercase tracking-widest">
          Reason: {endReason}
        </div>
      {:else}
        <div
          class="text-xl tracking-[0.25em] uppercase transition-all duration-300 font-black"
          class:text-[var(--neon-cyan)]={canPlay}
          class:text-glow-cyan={canPlay}
          class:text-[var(--text-primary)]={!canPlay}
          class:opacity-75={!canPlay}
        >
          {canPlay ? 'Your Turn' : "Opponent's Turn"}
        </div>
      {/if}
    </div>

    <div class="flex justify-center relative">
      <div
        class="grid grid-cols-3 grid-rows-3 gap-3 bg-[var(--text-muted)]/10 p-3 rounded-2xl w-[min(90vw,400px)] aspect-square shadow-2xl relative"
      >
        {#each board as row, rIndex (rIndex)}
          {#each row as cell, cIndex (cIndex)}
            <button
              class="w-full h-full rounded-2xl flex items-center justify-center transition-all duration-300
                {cell === 0 && canPlay
                ? 'hover:border-[var(--neon-cyan)] hover:border-2 cursor-pointer bg-[var(--cell)] shadow-lg'
                : ''}
                {cell === 0 && !canPlay ? 'cursor-default bg-[var(--cell)] shadow-lg' : ''}
              "
              class:cell-symbol={cell !== 0}
              class:cell-x={cell === 1}
              class:cell-o={cell === 2}
              onclick={() => playMove(rIndex, cIndex)}
              disabled={$standbyMode || !canPlay || cell !== 0}
              aria-label="Cell {rIndex} {cIndex}"
            >
              {#if cell === 1}
                X
              {:else if cell === 2}
                O
              {/if}
            </button>
          {/each}
        {/each}

        {#if lineCoords}
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10 drop-shadow-2xl">
            <line
              x1="{lineCoords.x1}%"
              y1="{lineCoords.y1}%"
              x2="{lineCoords.x2}%"
              y2="{lineCoords.y2}%"
              stroke={winner === hostUser?.id ? 'var(--neon-magenta)' : 'var(--neon-cyan)'}
              stroke-width="14"
              stroke-linecap="round"
              stroke-opacity="0.6"
              class="animate-draw-line"
            />
          </svg>
        {/if}
      </div>
    </div>

    {#if isGameOver}
      <div class="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8 animate-fade-in">
        <button
          class="w-full sm:w-auto px-8 py-3 bg-[var(--cell)] border-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)] rounded-xl hover:bg-[var(--neon-cyan)] hover:text-black font-bold uppercase tracking-widest transition-all duration-200 shadow-[var(--glow-cyan)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          onclick={handlePlayAgain}
          disabled={waitingForRematch || $standbyMode}
        >
          {#if waitingForRematch}
            <span
              class="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full mr-2"
            ></span>
            Waiting for Opponent...
          {:else}
            Play Again
          {/if}
        </button>

        <button
          class="w-full sm:w-auto px-8 py-3 bg-[var(--cell)] border-2 border-[var(--neon-magenta)] text-[var(--neon-magenta)] rounded-xl hover:bg-[var(--neon-magenta)] hover:text-black font-bold uppercase tracking-widest transition-all duration-200 shadow-[var(--glow-magenta)] cursor-pointer active:scale-95"
          disabled={$standbyMode}
          onclick={goLobby}
        >
          Return to Lobby
        </button>
      </div>
    {:else}
      <div class="mt-8 space-y-4">
        {#if showRetryButton}
          <div
            class="rounded-2xl border border-[var(--neon-magenta)] bg-[var(--cell)] p-4 shadow-[var(--glow-magenta)]"
          >
            <p class="text-sm text-[var(--text-secondary)] mb-3">
              The invitation ended as <span class="font-bold uppercase">{invitationState}</span>.
              {#if isHost}
                You can retry with the same guest.
              {/if}
            </p>
            {#if retryAfterSeconds !== undefined && retryAfterSeconds > 0}
              {#key retryAttempt}
                <CountdownButton
                  seconds={retryAfterSeconds}
                  disabled={$standbyMode || retryInFlight}
                  onclick={handleRetry}
                  label="Retry in"
                  class="w-full px-6 py-3 bg-[var(--cell)] border-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)] rounded-xl font-bold uppercase tracking-widest transition disabled:opacity-50 disabled:cursor-not-allowed"
                />
              {/key}
            {:else}
              <button
                type="button"
                disabled={$standbyMode || retryInFlight}
                onclick={handleRetry}
                class="w-full px-6 py-3 bg-[var(--cell)] border-2 border-[var(--neon-cyan)] text-[var(--neon-cyan)] rounded-xl hover:bg-[var(--neon-cyan)] hover:text-black font-bold uppercase tracking-widest transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {retryInFlight ? 'Retrying…' : 'Retry'}
              </button>
            {/if}
            {#if retryRemainingAttempts !== undefined}
              <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mt-2">
                {retryRemainingAttempts === 0
                  ? 'No retries left'
                  : `${retryRemainingAttempts} ${retryRemainingAttempts === 1 ? 'retry' : 'retries'} left`}
              </p>
            {/if}
          </div>
        {/if}

        {#if isWaiting}
          <div
            class="rounded-2xl border border-[var(--neon-magenta)] bg-[var(--cell)] p-4 shadow-[var(--glow-magenta)]"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">Invite</p>
                <p class="text-lg font-bold text-[var(--neon-magenta)]">Invitation pending</p>
              </div>
              <button
                class="px-4 py-2 rounded-xl border border-[var(--neon-magenta)] text-[var(--neon-magenta)] font-bold uppercase tracking-widest hover:bg-[var(--neon-magenta)] hover:text-black transition"
                disabled={$standbyMode}
                onclick={handleCancelInvitation}
              >
                Cancel
              </button>
            </div>
            {#if isWaiting && retryRemainingAttempts !== undefined}
              <p class="text-xs uppercase tracking-widest text-[var(--text-muted)] mt-2">
                {retryRemainingAttempts === 0
                  ? 'No retries left'
                  : `${retryRemainingAttempts} ${retryRemainingAttempts === 1 ? 'retry' : 'retries'} left`}
              </p>
            {/if}
          </div>
        {/if}

        {#if isWaiting || invitationState === 'rejected' || invitationState === 'expired' || invitationState === 'canceled'}
          <OnlinePlayersMenu
            title={isWaiting ? 'Waiting for opponent — Online players' : 'Challenge a player'}
            disabled={$standbyMode || isWaiting}
            onInvite={(user) => handleInviteOnlinePlayer(user.id)}
          />
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .cell-symbol {
    font-size: clamp(2.5rem, 12vw, 4.5rem);
    font-weight: 900;
    font-family: 'Courier New', monospace;
    line-height: 1;
    text-shadow:
      2px 0 0 currentColor,
      -2px 0 0 currentColor,
      0 2px 0 currentColor,
      0 -2px 0 currentColor,
      2px 2px 0 currentColor,
      -2px -2px 0 currentColor,
      2px -2px 0 currentColor,
      -2px 2px 0 currentColor;
    letter-spacing: 0.05em;
  }

  .text-glow-magenta {
    text-shadow:
      0 0 10px var(--neon-magenta),
      0 0 20px var(--neon-magenta);
  }
  .text-glow-cyan {
    text-shadow:
      0 0 10px var(--neon-cyan),
      0 0 20px var(--neon-cyan);
  }
  .text-glow-amber {
    text-shadow:
      0 0 10px rgba(251, 191, 36, 0.8),
      0 0 20px rgba(251, 191, 36, 0.5);
  }
  .text-glow-green {
    text-shadow:
      0 0 10px rgba(74, 222, 128, 0.8),
      0 0 20px rgba(74, 222, 128, 0.5);
  }
  .text-glow-red {
    text-shadow:
      0 0 10px rgba(248, 113, 113, 0.8),
      0 0 20px rgba(248, 113, 113, 0.5);
  }

  .cell-x {
    color: var(--neon-magenta);
    text-shadow: var(--glow-magenta);
    background-color: color-mix(in srgb, var(--neon-magenta) 10%, var(--cell));
    border: 2px solid var(--neon-magenta);
    box-shadow:
      0 0 15px color-mix(in srgb, var(--neon-magenta) 30%, transparent) inset,
      0 0 10px color-mix(in srgb, var(--neon-magenta) 30%, transparent);
  }

  .cell-o {
    color: var(--neon-cyan);
    text-shadow: var(--glow-cyan);
    background-color: color-mix(in srgb, var(--neon-cyan) 10%, var(--cell));
    border: 2px solid var(--neon-cyan);
    box-shadow:
      0 0 15px color-mix(in srgb, var(--neon-cyan) 30%, transparent) inset,
      0 0 10px color-mix(in srgb, var(--neon-cyan) 30%, transparent);
  }

  .animate-draw-line {
    stroke-dasharray: 600;
    stroke-dashoffset: 600;
    animation: draw 0.6s ease-out forwards;
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
</style>
