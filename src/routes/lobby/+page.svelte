<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { authApi } from '$lib/api/auth';
  import { createPresenceClient, createGameplaysClient } from '$lib/api/ws';
  import { sounds } from '$lib/audio/sounds';
  import { currentUser } from '$lib/stores/session';
  import { ApiError } from '$lib/api/errors';

  let onlineUserIds = $state<string[]>([]);
  let presenceClient = $state<ReturnType<typeof createPresenceClient> | null>(null);
  let gameplaysClient = $state<ReturnType<typeof createGameplaysClient> | null>(null);

  // Incoming invitation state
  let incomingInvite = $state<{ game_id: string; host: { id: string; name: string } } | null>(null);
  let isSubmitting = $state(false);
  let error = $state('');

  onMount(async () => {
    try {
      const { access_token } = await authApi.refresh();

      presenceClient = createPresenceClient();
      gameplaysClient = createGameplaysClient();

      presenceClient.on('auth_ok', () => {
        presenceClient?.send('list_online_users');
      });

      presenceClient.on('online_users', (payload: { users: string[] }) => {
        onlineUserIds = payload.users || [];
      });

      presenceClient.on('user_online', (payload: { user_id: string }) => {
        if (!onlineUserIds.includes(payload.user_id)) {
          onlineUserIds = [...onlineUserIds, payload.user_id];
        }
      });

      presenceClient.on('user_offline', (payload: { user_id: string }) => {
        onlineUserIds = onlineUserIds.filter((id) => id !== payload.user_id);
      });

      // Gameplays Events
      gameplaysClient.on(
        'invitation_received',
        (payload: { game_id: string; host: { id: string; name: string } }) => {
          sounds.play('click');
          incomingInvite = payload;
        }
      );

      gameplaysClient.on('game_created', (payload: { game_id: string }) => {
        goto(resolve(`/game/${payload.game_id}`));
      });

      gameplaysClient.on('invitation_accepted', (payload: { game_id: string }) => {
        goto(resolve(`/game/${payload.game_id}`));
      });

      gameplaysClient.on('invitation_rejected', () => {
        error = 'Invitation was rejected.';
        setTimeout(() => (error = ''), 3000);
      });

      gameplaysClient.on('error', (payload: { message?: string }) => {
        error = payload.message || 'An error occurred';
        setTimeout(() => (error = ''), 3000);
      });

      presenceClient.connect(access_token);
      gameplaysClient.connect(access_token);
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) {
        error = 'Unauthorized. Please log in again.';
      } else {
        error = 'Failed to connect to lobby.';
      }
    }
  });

  onDestroy(() => {
    presenceClient?.disconnect();
    gameplaysClient?.disconnect();
  });

  function handleInvite(userId: string) {
    sounds.play('click');
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
  }
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl relative">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-[var(--neon-cyan)] mb-12">
    Lobby
  </h2>

  {#if error}
    <div class="bg-red-500/20 border border-red-500 text-red-200 p-4 rounded-xl text-center">
      {error}
    </div>
  {/if}

  <div
    class="bg-[var(--cell)] rounded-xl border border-[var(--neon-cyan)] p-6 shadow-[var(--glow-cyan)]"
  >
    <h3
      class="text-2xl font-bold mb-6 text-[var(--text-primary)] border-b border-[var(--neon-cyan)] pb-2"
    >
      Online Players
    </h3>

    {#if onlineUserIds.length === 0 || (onlineUserIds.length === 1 && onlineUserIds[0] === $currentUser?.id)}
      <p class="text-[var(--text-muted)] text-center py-8 text-xl">Waiting for challengers...</p>
    {:else}
      <ul class="space-y-4">
        {#each onlineUserIds as userId (userId)}
          {#if userId !== $currentUser?.id}
            <li
              class="flex items-center justify-between p-4 bg-[var(--bg)] border border-[var(--neon-cyan)]/30 rounded-lg hover:border-[var(--neon-cyan)] transition"
            >
              <span class="text-xl font-mono truncate mr-4">{userId}</span>
              <button
                class="px-6 py-2 uppercase tracking-widest text-sm rounded-full border border-[var(--neon-magenta)] text-[var(--neon-magenta)] hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] transition active:scale-95 whitespace-nowrap"
                onclick={() => handleInvite(userId)}
              >
                Invite
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>

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
