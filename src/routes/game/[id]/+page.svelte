<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { bootstrapSession, handleAuthFailure } from '$lib/auth/bootstrap';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { httpClient } from '$lib/api/client';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import type { WebSocketClient } from '$lib/api/ws';
  import { currentUser } from '$lib/stores/session';
  import { userFacingMessage } from '$lib/errors/messages';
  import { sounds } from '$lib/audio/sounds';
  import type { User, Gameplay } from '$lib/types/api';

  let gameplaysClient: WebSocketClient;
  let unsubscribers: (() => void)[] = [];
  let hostUser = $state<User | null>(null);
  let guestUser = $state<User | null>(null);

  let board = $state<number[][]>([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]);
  let turn = $state<string>('');
  let winner = $state<string | null>(null);
  let endReason = $state<string | null>(null);
  let error = $state<string>('');

  let isLoading = $state(true);
  let incomingInvite = $state<{ game_id: string; host: { id: string; name: string } } | null>(null);
  let waitingForRematch = $state(false);
  let currentGameId = $state('');
  let authRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let authRetryUsed = false;

  // Derived state
  let isGameOver = $derived(winner !== null || endReason !== null);
  let isDraw = $derived(
    endReason === 'draw' || (isGameOver && (winner === null || winner === 'None'))
  );
  let isMyTurn = $derived($currentUser?.id === turn && !isGameOver);

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

    board = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    turn = '';
    winner = null;
    endReason = null;
    error = '';
    isLoading = true;
    incomingInvite = null;
    waitingForRematch = false;

    try {
      const { accessToken } = await bootstrapSession();
      if (!accessToken)
        throw new Error('No access token is available for the WebSocket connection');

      const gameplay = await httpClient.get<Gameplay>(`/api/v2/gameplays/${id}`);

      const positions = gameplay.currentPositions
        ? JSON.parse(gameplay.currentPositions as string)
        : {
            board: [
              [0, 0, 0],
              [0, 0, 0],
              [0, 0, 0]
            ]
          };
      board = positions.board;
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
          .get<User>(`/api/v2/users/${gameplay.hostPlayer}`)
          .catch(() => null);
      }
      if (gameplay.guestPlayer) {
        guestUser = await httpClient
          .get<User>(`/api/v2/users/${gameplay.guestPlayer}`)
          .catch(() => null);
      }

      isLoading = false;

      gameplaysClient = globalGameplaysClient.getOrCreate();

      unsubscribers.push(
        gameplaysClient.on('auth_ok', () => {
          if (import.meta.env.DEV) console.debug('[game] gameplay auth_ok');
          authRetryUsed = false;
          if (authRetryTimer) clearTimeout(authRetryTimer);
          authRetryTimer = undefined;
          gameplaysClient.send('subscribe_game', { game_id: id });
        })
      );

      unsubscribers.push(
        gameplaysClient.on('board_updated', (payload: { board: number[][]; turn: string }) => {
          board = payload.board;
          turn = payload.turn;
          sounds.play('click');
        })
      );

      unsubscribers.push(
        gameplaysClient.on(
          'game_ended',
          async (payload: { winner: string | null; reason: string; board?: number[][] }) => {
            if (payload.board) {
              board = payload.board;
            } else {
              try {
                const updated = await httpClient.get<Gameplay>(`/api/v2/gameplays/${id}`);
                if (updated.currentPositions) {
                  const pos =
                    typeof updated.currentPositions === 'string'
                      ? (JSON.parse(updated.currentPositions) as { board: number[][] })
                      : (updated.currentPositions as { board: number[][] });
                  if (pos.board) {
                    board = pos.board;
                  }
                }
              } catch (err: unknown) {
                void err;
              }
            }
            winner = payload.winner;
            endReason = payload.reason;

            if (winner === $currentUser?.id) sounds.play('win');
            else if (winner) sounds.play('lose');
            else sounds.play('draw');
          }
        )
      );

      unsubscribers.push(
        gameplaysClient.on(
          'invitation_received',
          (payload: { game_id: string; host: { id: string; name: string } }) => {
            sounds.play('click');
            incomingInvite = payload;
          }
        )
      );

      unsubscribers.push(
        gameplaysClient.on('invitation_accepted', (payload: { game_id: string }) => {
          waitingForRematch = false;
          goto(resolve(`/game/${payload.game_id}`));
        })
      );

      unsubscribers.push(
        gameplaysClient.on('invitation_rejected', () => {
          waitingForRematch = false;
          error = 'Rematch request was declined.';
          setTimeout(() => (error = ''), 3000);
        })
      );

      unsubscribers.push(
        gameplaysClient.on('error', (payload: { code?: string; message?: string } | undefined) => {
          if (payload?.code && payload.code !== 'OPPONENT_OFFLINE') {
            waitingForRematch = false;
          }
          error = userFacingMessage(payload?.code, 'Something went wrong. Please try again.');
          setTimeout(() => (error = ''), 3000);
        })
      );

      unsubscribers.push(
        gameplaysClient.on(
          'auth_failed',
          (payload: { code?: number; reason?: string } | undefined) => {
            const failure =
              payload?.code === 4401 || payload?.reason === 'auth_error'
                ? new ApiError('Gameplay authentication failed', 401, 'AUTH_FAILED')
                : new TimeoutError('Gameplay authentication timed out');
            handleGameplayAuthFailure(failure, id);
          }
        )
      );

      const isConnected = get(gameplaysClient.state) === 'connected' && gameplaysClient.isAlive();
      if (isConnected) {
        if (import.meta.env.DEV) console.debug('[game] reusing connected gameplay socket');
        gameplaysClient.send('subscribe_game', { game_id: id });
      } else {
        if (import.meta.env.DEV) console.debug('[game] connecting gameplay socket');
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

  onMount(() => {
    if (import.meta.env.DEV) console.debug('[game] mount');
  });

  onDestroy(() => {
    if (import.meta.env.DEV) console.debug('[game] destroy; retaining gameplay socket');
    if (authRetryTimer) clearTimeout(authRetryTimer);
    unsubscribers.forEach((unsub) => unsub());
  });

  function playMove(row: number, col: number) {
    if ($standbyMode || !isMyTurn || board[row][col] !== 0 || isGameOver) return;

    board[row][col] = turn === hostUser?.id ? 1 : 2;
    board = [...board];

    sounds.play('click');
    turn = turn === hostUser?.id ? guestUser?.id || '' : hostUser?.id || '';

    gameplaysClient.send('play_move', {
      game_id: currentGameId || $page.params.id,
      row,
      col
    });
  }

  function handlePlayAgain() {
    if ($standbyMode) return;
    const opponent = hostUser?.id === $currentUser?.id ? guestUser : hostUser;
    if (!opponent) {
      error = 'Opponent is not available';
      setTimeout(() => (error = ''), 3000);
      return;
    }
    sounds.play('click');
    waitingForRematch = true;
    gameplaysClient.send('create_game', { guest_id: opponent.id });
  }

  function handleAcceptRematch() {
    if ($standbyMode) return;
    if (!incomingInvite) return;
    sounds.play('click');
    gameplaysClient.send('accept_invitation', { game_id: incomingInvite.game_id });
  }

  function handleRejectRematch() {
    if ($standbyMode) return;
    if (!incomingInvite) return;
    sounds.play('click');
    gameplaysClient.send('reject_invitation', { game_id: incomingInvite.game_id });
    incomingInvite = null;
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
    <!-- Players Header -->
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
          {hostUser?.name || 'Unknown'}
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
          {guestUser?.name || 'Unknown'}
        </div>
      </div>
    </div>

    <!-- Turn Indicator -->
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
          class:text-[var(--neon-cyan)]={isMyTurn}
          class:text-glow-cyan={isMyTurn}
          class:text-[var(--text-primary)]={!isMyTurn}
          class:opacity-75={!isMyTurn}
        >
          {isMyTurn ? 'Your Turn' : "Opponent's Turn"}
        </div>
      {/if}
    </div>

    <!-- Board -->
    <div class="flex justify-center relative">
      <div
        class="grid grid-cols-3 grid-rows-3 gap-3 bg-[var(--text-muted)]/10 p-3 rounded-2xl w-[min(90vw,400px)] aspect-square shadow-2xl relative"
      >
        {#each board as row, rIndex (rIndex)}
          {#each row as cell, cIndex (cIndex)}
            <button
              class="w-full h-full rounded-2xl flex items-center justify-center transition-all duration-300
                {cell === 0 && isMyTurn
                ? 'hover:border-[var(--neon-cyan)] hover:border-2 cursor-pointer bg-[var(--cell)] shadow-lg'
                : ''}
                {cell === 0 && !isMyTurn ? 'cursor-default bg-[var(--cell)] shadow-lg' : ''}
              "
              class:cell-symbol={cell !== 0}
              class:cell-x={cell === 1}
              class:cell-o={cell === 2}
              onclick={() => playMove(rIndex, cIndex)}
              disabled={$standbyMode || !isMyTurn || cell !== 0 || isGameOver}
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
    {/if}
  {/if}

  {#if incomingInvite}
    <div
      class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
    >
      <div
        class="bg-[var(--cell)] border-2 border-[var(--neon-magenta)] p-6 rounded-2xl max-w-sm w-full text-center shadow-[var(--glow-magenta)] space-y-4"
      >
        <h3 class="text-xl font-bold uppercase tracking-wider text-white">Rematch Request</h3>
        <p class="text-[var(--text-muted)]">
          <span class="font-bold text-[var(--neon-magenta)]">{incomingInvite.host.name}</span>
          wants to play again!
        </p>
        <div class="flex gap-4 justify-center">
          <button
            class="flex-1 py-3 bg-[var(--cell)] border-2 border-[var(--neon-magenta)] text-[var(--neon-magenta)] hover:bg-[var(--neon-magenta)] hover:text-black font-bold uppercase tracking-wider rounded-xl shadow-[var(--glow-magenta)] transition-all cursor-pointer active:scale-95"
            disabled={$standbyMode}
            onclick={handleAcceptRematch}
          >
            Accept
          </button>
          <button
            class="flex-1 py-3 bg-[var(--cell)] border-2 border-[var(--text-muted)] text-[var(--text-muted)] hover:bg-[var(--text-muted)] hover:text-black font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer active:scale-95"
            disabled={$standbyMode}
            onclick={handleRejectRematch}
          >
            Decline
          </button>
        </div>
      </div>
    </div>
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
