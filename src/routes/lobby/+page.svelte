<script lang="ts">
  import { onMount } from 'svelte';
  import { bootstrapSession, handleAuthFailure } from '$lib/auth/bootstrap';
  import { sounds } from '$lib/audio/sounds';
  import OnlinePlayersMenu from '$lib/components/OnlinePlayersMenu.svelte';
  import { userFacingMessage } from '$lib/errors/messages';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import type { WebSocketClient } from '$lib/api/ws';
  import { isUuid, safeRandomUuid } from '$lib/utils/uuid';

  let gameplaysClient: WebSocketClient | undefined;
  let waitingForAccept = $state(false);
  let error = $state('');
  let mounted = false;
  let lastInviteSentAt = 0;

  function handleInvite(userId: string) {
    if ($standbyMode || waitingForAccept || !isUuid(userId)) return;

    const now = Date.now();
    if (now - lastInviteSentAt < 500) return;
    lastInviteSentAt = now;

    sounds.play('click');
    waitingForAccept = true;
    gameplaysClient?.send('create_game', {
      guest_id: userId,
      client_request_id: safeRandomUuid()
    });
  }

  onMount(() => {
    mounted = true;
    gameplaysClient = globalGameplaysClient.getOrCreate();

    const offAuth = gameplaysClient.on('auth_ok', () => {
      waitingForAccept = false;
    });
    const offInvitationQueued = gameplaysClient.on('invitation_queued', () => {
      waitingForAccept = true;
    });
    const offError = gameplaysClient.on(
      'error',
      (payload: { code?: string; message?: string } | undefined) => {
        waitingForAccept = false;
        error = userFacingMessage(payload?.code, 'Something went wrong. Please try again.');
      }
    );

    void (async () => {
      try {
        const { accessToken } = await bootstrapSession();
        if (!mounted) return;
        if (!accessToken) {
          throw new Error('No access token is available for the gameplay connection');
        }
        gameplaysClient = globalGameplaysClient.getOrCreate();
        gameplaysClient.connect(accessToken);
      } catch (caught) {
        handleAuthFailure(caught, (message) => (error = message), '/lobby');
      }
    })();

    return () => {
      mounted = false;
      offAuth();
      offInvitationQueued();
      offError();
    };
  });
</script>

<section class="space-y-10 py-8 mx-auto max-w-4xl relative">
  <h2 class="text-4xl text-center uppercase tracking-[0.25em] text-neon-cyan mb-12">Lobby</h2>

  {#if error}
    <div
      class="bg-red-500/10 border border-red-500 text-red-500 font-bold p-4 rounded-xl text-center"
    >
      {error}
    </div>
  {/if}

  <OnlinePlayersMenu
    title="Online Players"
    disabled={$standbyMode || waitingForAccept}
    emptyMessage="Waiting for challengers..."
    onInvite={(user) => handleInvite(user.id)}
  />
</section>
