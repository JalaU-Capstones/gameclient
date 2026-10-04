<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { authApi } from '$lib/api/auth';
  import { httpClient } from '$lib/api/client';
  import { globalPresenceClient, globalGameplaysClient } from '$lib/stores/ws';
  import type { WebSocketClient } from '$lib/api/ws';
  import { sounds } from '$lib/audio/sounds';
  import { currentUser } from '$lib/stores/session';
  import { ApiError } from '$lib/api/errors';
  import type { User } from '$lib/types/api';

  let onlineUsers = $state<User[]>([]);

  let presenceClient: WebSocketClient;
  let gameplaysClient: WebSocketClient;
  let unsubscribers: (() => void)[] = [];

  // incoming invitation state
  let incomingInvite = $state<{ game_id: string; host: { id: string; name: string } } | null>(null);
  let isSubmitting = $state(false);
  let waitingForAccept = $state(false);
  let error = $state('');
  let presenceRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let latestPresenceList = 0;
  let accessToken = '';
  let handleVisibilityChange: (() => void) | undefined;

  onMount(async () => {
    try {
      const { access_token } = await authApi.refresh();
      accessToken = access_token;

      presenceClient = globalPresenceClient.getOrCreate();
      gameplaysClient = globalGameplaysClient.getOrCreate();

      async function fetchUsers(userIds: string[]): Promise<User[]> {
        const uniqueIds = [...new Set(userIds)];
        const results = await Promise.allSettled(
          uniqueIds.map((id) => httpClient.get<User>(`/api/v2/users/${id}`))
        );
        return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      }

      unsubscribers.push(
        presenceClient.on('online_users', (payload: { users: string[] }) => {
          const requestId = ++latestPresenceList;
          void fetchUsers(payload.users || []).then((users) => {
            if (requestId === latestPresenceList) onlineUsers = users;
          });
        })
      );

      const connectionState = get(presenceClient.state);
      if (connectionState === 'connected') {
        presenceClient.send('list_online_users');
      } else {
        unsubscribers.push(
          presenceClient.on('auth_ok', () => {
            presenceClient.send('list_online_users');
          })
        );
      }

      unsubscribers.push(
        presenceClient.on('user_online', () => {
          schedulePresenceRefresh();
        })
      );

      unsubscribers.push(
        presenceClient.on('user_offline', () => {
          schedulePresenceRefresh();
        })
      );

      // Gameplays Events
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
        gameplaysClient.on('game_created', () => {
          // Wait for guest to accept. The host will be redirected when invitation_accepted fires.
        })
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
        gameplaysClient.on('error', (payload: { message?: string }) => {
          waitingForAccept = false;
          error = payload.message || 'An error occurred';
          setTimeout(() => (error = ''), 3000);
        })
      );

      presenceClient.connect(access_token);
      gameplaysClient.connect(access_token);
      handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return;
        const connectionState = get(presenceClient.state);
        if (connectionState === 'connected') {
          presenceClient.send('list_online_users');
        } else if (connectionState === 'disconnected') {
          presenceClient.connect(accessToken);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        error = 'Unauthorized. Please log in again.';
      } else {
        error = 'Failed to connect to lobby.';
      }
    }
  });

  onDestroy(() => {
    unsubscribers.forEach((unsub) => unsub());
    if (presenceRefreshTimer) clearTimeout(presenceRefreshTimer);
    if (handleVisibilityChange) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  });

  function schedulePresenceRefresh() {
    if (presenceRefreshTimer) clearTimeout(presenceRefreshTimer);
    presenceRefreshTimer = setTimeout(() => {
      presenceClient?.send('list_online_users');
      presenceRefreshTimer = undefined;
    }, 300);
  }

  function handleInvite(userId: string) {
    sounds.play('click');
    waitingForAccept = true;
    gameplaysClient.send('create_game', { guest_id: userId });
  }

  function handleAccept() {
    if (!incomingInvite) return;
    sounds.play('click');
    isSubmitting = true;
    gameplaysClient.send('accept_invitation', { game_id: incomingInvite.game_id });
  }

  function handleReject() {
    if (!incomingInvite) return;
    sounds.play('click');
    gameplaysClient.send('reject_invitation', { game_id: incomingInvite.game_id });
    incomingInvite = null;
    isSubmitting = false;
    error = 'Invitation declined.';
    setTimeout(() => (error = ''), 3000);
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

    {#if onlineUsers.length === 0 || (onlineUsers.length === 1 && onlineUsers[0].id === $currentUser?.id)}
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
      </ul>
    {/if}
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
