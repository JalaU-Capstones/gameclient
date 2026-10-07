<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { httpClient } from '$lib/api/client';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { bootstrapSession, handleAuthFailure } from '$lib/auth/bootstrap';
  import {
    announcePresenceListRequest,
    createTabId,
    subscribeSessionMessages
  } from '$lib/auth/sessionLock';
  import { userFacingMessage } from '$lib/errors/messages';
  import { sounds } from '$lib/audio/sounds';
  import {
    globalGameplaysClient,
    globalPresenceClient,
    requestPresenceReconnect
  } from '$lib/stores/ws';
  import { currentUser } from '$lib/stores/session';
  import type { WebSocketClient } from '$lib/api/ws';
  import type { User } from '$lib/types/api';

  let onlineUsers = $state<User[]>([]);
  let isLoadingOnlineUsers = $state(true);
  let incomingInvite = $state<{ game_id: string; host: { id: string; name: string } } | null>(null);
  let isSubmitting = $state(false);
  let waitingForAccept = $state(false);
  let error = $state('');
  let presenceClient: WebSocketClient;
  let gameplaysClient: WebSocketClient | undefined;
  let unsubscribers: (() => void)[] = [];
  let fallbackRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let isLobbyMounted = false;
  let latestPresenceList = 0;
  const tabId = createTabId();
  let authRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let authRetryUsed = false;

  function handleGameplayAuthFailure(failure: unknown) {
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
                if (!isLobbyMounted) return;
                if (!accessToken)
                  throw new Error('No access token is available for the gameplay connection');
                gameplaysClient?.connect(accessToken);
              })
              .catch((retryFailure: unknown) => {
                handleAuthFailure(retryFailure, (retryMessage) => (error = retryMessage), '/lobby');
              });
          }, 1200);
        }
      },
      '/lobby'
    );
  }

  onMount(() => {
    isLoadingOnlineUsers = true;
    isLobbyMounted = true;
    if (import.meta.env.DEV) console.debug('[lobby] mount entry');

    let receivedPresenceList = false;
    loadingTimeoutTimer = setTimeout(() => {
      loadingTimeoutTimer = undefined;
      if (isLobbyMounted && isLoadingOnlineUsers) {
        if (!receivedPresenceList) console.warn('[lobby] Timed out waiting for online players');
        isLoadingOnlineUsers = false;
      }
    }, 2500);
    fallbackRefreshTimer = setTimeout(() => {
      fallbackRefreshTimer = undefined;
      if (!isLobbyMounted || !isLoadingOnlineUsers) return;
      if (import.meta.env.DEV) console.debug('[lobby] fallback timer');
      requestPresenceReconnect();
      if (presenceClient.isAlive()) presenceClient.send('list_online_users');
      else {
        if (import.meta.env.DEV) {
          console.debug('[lobby] presence-list-request fallback fired');
          console.debug('[lobby] announcePresenceListRequest called');
        }
        announcePresenceListRequest(tabId);
      }
    }, 1200);

    presenceClient = globalPresenceClient.getOrCreate();
    const requestOnlineUsers = () => presenceClient.send('list_online_users');

    async function fetchUsers(userIds: string[]): Promise<User[]> {
      const uniqueIds = [...new Set(userIds)];
      const results = await Promise.allSettled(
        uniqueIds.map((id) => httpClient.get<User>(`/api/v2/users/${id}`))
      );
      const users = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      if (import.meta.env.DEV) console.debug('[lobby] fetchUsers resolved', users.length);
      return users;
    }

    function processOnlineUsers(userIds: string[]) {
      receivedPresenceList = true;
      isLoadingOnlineUsers = false;
      if (fallbackRefreshTimer) clearTimeout(fallbackRefreshTimer);
      fallbackRefreshTimer = undefined;
      if (loadingTimeoutTimer) clearTimeout(loadingTimeoutTimer);
      loadingTimeoutTimer = undefined;
      const requestId = ++latestPresenceList;
      void fetchUsers(userIds).then((users) => {
        if (isLobbyMounted && requestId === latestPresenceList) onlineUsers = users;
      });
    }

    unsubscribers.push(
      presenceClient.on('online_users', (payload: { users?: string[] } | undefined) => {
        if (import.meta.env.DEV) {
          console.debug('[lobby] online_users received', payload?.users?.length ?? 0);
        }
        processOnlineUsers(payload?.users ?? []);
      })
    );
    unsubscribers.push(
      subscribeSessionMessages((message) => {
        if (message.type === 'presence-users') processOnlineUsers(message.userIds);
        if (message.type === 'presence-users-direct' && message.tabId === tabId) {
          processOnlineUsers(message.userIds);
        }
      })
    );
    unsubscribers.push(presenceClient.on('user_online', requestOnlineUsers));
    unsubscribers.push(presenceClient.on('user_offline', requestOnlineUsers));
    unsubscribers.push(
      presenceClient.on('error', (payload: { code?: string; message?: string } | undefined) => {
        error = userFacingMessage(payload?.code, 'Connection lost. Reconnecting…');
      })
    );
    unsubscribers.push(
      presenceClient.state.subscribe((state) => {
        if (state === 'connected') requestOnlineUsers();
      })
    );
    if (!presenceClient.isAlive()) {
      if (import.meta.env.DEV) console.debug('[lobby] announcePresenceListRequest called');
      announcePresenceListRequest(tabId);
    }
    if (get(presenceClient.state) !== 'connected') requestPresenceReconnect();
    else requestOnlineUsers();

    void (async () => {
      try {
        if (import.meta.env.DEV) console.debug('[lobby] bootstrapping gameplay connection');
        const { accessToken } = await bootstrapSession();
        if (!isLobbyMounted) return;
        if (!accessToken)
          throw new Error('No access token is available for the gameplay connection');
        gameplaysClient = globalGameplaysClient.getOrCreate();
        unsubscribers.push(
          gameplaysClient.on('auth_ok', () => {
            authRetryUsed = false;
            if (authRetryTimer) clearTimeout(authRetryTimer);
            authRetryTimer = undefined;
          })
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
            waitingForAccept = false;
            goto(resolve(`/game/${payload.game_id}`));
          })
        );
        unsubscribers.push(
          gameplaysClient.on('invitation_rejected', () => {
            waitingForAccept = false;
            error = 'Invitation was rejected.';
            setTimeout(() => (error = ''), 3000);
          })
        );
        unsubscribers.push(
          gameplaysClient.on(
            'error',
            (payload: { code?: string; message?: string } | undefined) => {
              waitingForAccept = false;
              error = userFacingMessage(payload?.code, 'Something went wrong. Please try again.');
              setTimeout(() => (error = ''), 3000);
            }
          )
        );
        unsubscribers.push(
          gameplaysClient.on(
            'auth_failed',
            (payload: { code?: number; reason?: string } | undefined) => {
              const failure =
                payload?.code === 4401 || payload?.reason === 'auth_error'
                  ? new ApiError('Gameplay authentication failed', 401, 'AUTH_FAILED')
                  : new TimeoutError('Gameplay authentication timed out');
              handleGameplayAuthFailure(failure);
            }
          )
        );
        if (!gameplaysClient.isAlive()) gameplaysClient.connect(accessToken);
      } catch (caught) {
        handleAuthFailure(caught, (message) => (error = message), '/lobby');
      }
    })();
  });

  onDestroy(() => {
    isLobbyMounted = false;
    if (import.meta.env.DEV) console.debug('[lobby] destroy');
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    if (fallbackRefreshTimer) clearTimeout(fallbackRefreshTimer);
    if (loadingTimeoutTimer) clearTimeout(loadingTimeoutTimer);
    if (authRetryTimer) clearTimeout(authRetryTimer);
  });

  function handleInvite(userId: string) {
    sounds.play('click');
    waitingForAccept = true;
    gameplaysClient?.send('create_game', { guest_id: userId });
  }

  function handleAccept() {
    if (!incomingInvite) return;
    sounds.play('click');
    isSubmitting = true;
    gameplaysClient?.send('accept_invitation', { game_id: incomingInvite.game_id });
  }

  function handleReject() {
    if (!incomingInvite) return;
    sounds.play('click');
    gameplaysClient?.send('reject_invitation', { game_id: incomingInvite.game_id });
    incomingInvite = null;
    isSubmitting = false;
    error = 'Invitation declined.';
    setTimeout(() => (error = ''), 3000);
  }
  function handleOpenHistory() {
    sounds.play('click');
    goto(resolve('/history'));
  }
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl relative">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-[var(--neon-cyan)] mb-12">
    Lobby
  </h2>

  {#if error}
    <div
      class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
    >
      {error}
    </div>
  {/if}

  <div
    class="bg-[var(--cell)] rounded-xl border border-[var(--neon-cyan)] p-6 shadow-[var(--glow-cyan)]"
  >
    <div class="flex items-center justify-between mb-6 border-b border-[var(--neon-cyan)] pb-2">
      <h3 class="text-2xl font-bold text-[var(--text-primary)]">Online Players</h3>
    </div>

    {#if isLoadingOnlineUsers}
      <p class="text-[var(--text-muted)] text-center py-8 text-xl">Loading players...</p>
    {:else if onlineUsers.length === 0}
      <p class="text-[var(--text-muted)] text-center py-8 text-xl">Waiting for challengers...</p>
    {:else}
      <ul class="space-y-4">
        {#each onlineUsers as user (user.id)}
          {#if user.id !== $currentUser?.id}
            <li
              class="flex items-center justify-between p-4 bg-[var(--bg)] border border-[var(--neon-cyan)]/30 rounded-lg hover:border-[var(--neon-cyan)] transition"
            >
              <span class="text-xl font-mono truncate mr-4">{user.name}</span>
              <button
                class="px-6 py-2 uppercase tracking-widest text-sm rounded-full border border-[var(--neon-magenta)] text-[var(--neon-magenta)] hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] transition active:scale-95 whitespace-nowrap"
                onclick={() => handleInvite(user.id)}
              >
                Invite
              </button>
            </li>
          {/if}
        {/each}
        {#if onlineUsers.every((user) => user.id === $currentUser?.id)}
          <li class="text-[var(--text-muted)] text-center py-4 text-lg">
            You are the only player online.
          </li>
        {/if}
      </ul>
    {/if}
  </div>
  <div class="text-center">
    <button
      type="button"
      class="px-6 py-2 uppercase tracking-widest text-sm rounded-full border border-[var(--neon-cyan)] text-[var(--neon-cyan)] shadow-[var(--glow-cyan)] hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] transition active:scale-95 whitespace-nowrap"
      onclick={handleOpenHistory}
    >
      View history
    </button>
  </div>
  {#if waitingForAccept}
    <div
      class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <div
        class="bg-[var(--cell)] border-2 border-[var(--neon-cyan)] shadow-[var(--glow-cyan)] rounded-2xl p-8 max-w-md w-full text-center space-y-6 animate-pulse"
      >
        <h3 class="text-2xl font-bold uppercase tracking-widest text-[var(--neon-cyan)]">
          Waiting for opponent...
        </h3>
        <p class="text-[var(--text-secondary)]">The challenge has been sent.</p>
      </div>
    </div>
  {/if}

  <!-- Incoming Invite Modal -->
  {#if incomingInvite}
    <div
      class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <div
        class="bg-[var(--cell)] border-2 border-[var(--neon-magenta)] shadow-[var(--glow-magenta)] rounded-2xl p-8 max-w-md w-full text-center space-y-8 animate-in fade-in zoom-in duration-200"
      >
        <div class="space-y-2">
          <h3 class="text-3xl font-bold uppercase tracking-widest text-[var(--neon-magenta)]">
            Challenger Approaching!
          </h3>
          <p class="text-[var(--text-secondary)] text-lg">
            <span class="font-bold text-[var(--neon-cyan)]">{incomingInvite.host.name}</span> wants to
            play Tic Tac Toe.
          </p>
        </div>

        <div class="flex gap-4">
          <button
            disabled={isSubmitting}
            onclick={handleReject}
            class="flex-1 py-3 px-4 rounded-full border border-[var(--text-muted)] text-[var(--text-muted)] hover:bg-[var(--text-muted)] hover:text-[var(--bg)] transition uppercase tracking-widest text-sm"
          >
            Decline
          </button>
          <button
            disabled={isSubmitting}
            onclick={handleAccept}
            class="flex-1 py-3 px-4 rounded-full border border-[var(--neon-cyan)] text-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] transition uppercase tracking-widest text-sm shadow-[var(--glow-cyan)]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
