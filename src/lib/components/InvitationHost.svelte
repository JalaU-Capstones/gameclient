<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { WebSocketClient } from '$lib/api/ws';
  import { sounds } from '$lib/audio/sounds';
  import { userFacingMessage } from '$lib/errors/messages';
  import { currentUser } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toasts';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import { sanitizeDisplayName } from '$lib/utils/text';
  import { isUuid } from '$lib/utils/uuid';

  interface IncomingInvite {
    game_id: string;
    host: { id: string; name: string };
    promoted?: boolean;
  }

  interface Props {
    disabled?: boolean;
  }

  let { disabled = false }: Props = $props();

  let incomingInvite = $state<IncomingInvite | null>(null);
  let isSubmitting = $state(false);
  let dialogElement = $state<HTMLDivElement | undefined>();
  let previouslyFocused: HTMLElement | null = null;
  let boundClient: WebSocketClient | null = null;
  let unsubscribers: (() => void)[] = [];
  let modalTimeout: ReturnType<typeof setTimeout> | undefined;
  let pendingInvite: IncomingInvite | null = null;
  let stopCurrentUser: (() => void) | undefined;

  // Wait beyond the server TTL and expiry-loop interval so its notification can close the modal first.
  const MODAL_TIMEOUT_MS = 70_000;
  const isDisabled = $derived(disabled || $standbyMode);

  function closeModal() {
    if (modalTimeout) {
      clearTimeout(modalTimeout);
      modalTimeout = undefined;
    }
    incomingInvite = null;
    isSubmitting = false;
    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function openModal(invite: IncomingInvite) {
    if (!incomingInvite) previouslyFocused = document.activeElement as HTMLElement | null;
    incomingInvite = invite;
    if (modalTimeout) clearTimeout(modalTimeout);
    modalTimeout = setTimeout(() => {
      if (!incomingInvite) return;
      if (import.meta.env.DEV) console.debug('[invitation-host] timeout');
      if (isSubmitting) {
        closeModal();
        pushToast('warning', userFacingMessage('INVITATION_EXPIRED'));
        return;
      }
      closeModal();
    }, MODAL_TIMEOUT_MS);
    queueMicrotask(() => {
      dialogElement?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
  }

  function displayInvite(invite: IncomingInvite, userId: string | undefined) {
    if (!userId) {
      pendingInvite = invite;
      return;
    }
    pendingInvite = null;
    if (invite.host.id === userId || isDisabled) return;
    sounds.play('click');
    openModal(invite);
  }

  function handleInvitation(payload: unknown, options: { promoted?: boolean } = {}): void {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('game_id' in payload) ||
      !('host' in payload)
    ) {
      return;
    }

    const rawInvite = payload as {
      game_id?: unknown;
      host?: { id?: unknown; name?: unknown } | null;
    };
    if (
      !isUuid(rawInvite.game_id) ||
      !rawInvite.host ||
      typeof rawInvite.host.id !== 'string' ||
      typeof rawInvite.host.name !== 'string'
    ) {
      return;
    }

    const invite: IncomingInvite = {
      game_id: rawInvite.game_id,
      host: {
        id: rawInvite.host.id,
        name: sanitizeDisplayName(rawInvite.host.name)
      },
      promoted: options.promoted ?? false
    };
    if (!invite.host.name) return;

    if (import.meta.env.DEV) {
      console.debug('[invitation-host] received', {
        hasGameId: true,
        hasHostId: true
      });
    }
    displayInvite(invite, $currentUser?.id);
  }

  function reject(): void {
    if (!incomingInvite || isDisabled || !boundClient || isSubmitting) return;
    sounds.play('click');
    if (import.meta.env.DEV) console.debug('[invitation-host] reject');
    boundClient.send('reject_invitation', { game_id: incomingInvite.game_id });
    closeModal();
  }

  function accept() {
    if (!incomingInvite || isDisabled || !boundClient || isSubmitting) return;
    if (import.meta.env.DEV) console.debug('[invitation-host] accept');
    sounds.play('click');
    isSubmitting = true;
    boundClient.send('accept_invitation', { game_id: incomingInvite.game_id });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      reject();
      return;
    }

    if (event.key !== 'Tab' || !dialogElement) return;

    const focusable = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function unbindClient() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    if (boundClient && import.meta.env.DEV) {
      console.debug('[invitation-host] client unbound');
    }
    boundClient = null;
    pendingInvite = null;
    closeModal();
  }

  function bindClient(client: WebSocketClient) {
    if (client === boundClient) return;
    if (boundClient) unbindClient();
    boundClient = client;
    if (import.meta.env.DEV) console.debug('[invitation-host] client bound');

    unsubscribers.push(client.on('invitation_received', handleInvitation));
    unsubscribers.push(
      client.on('invitation_promoted', (payload: unknown) => {
        handleInvitation(payload, { promoted: true });
      })
    );
    unsubscribers.push(
      client.on('invitation_accepted', (payload: { game_id?: string } | undefined) => {
        if (!payload || !isUuid(payload.game_id)) {
          closeModal();
          return;
        }

        closeModal();
        goto(resolve(`/game/${payload.game_id}`));
      })
    );
    unsubscribers.push(
      client.on('invitation_rejected', () => {
        closeModal();
        pushToast('warning', userFacingMessage('INVITATION_REJECTED'));
      })
    );
    unsubscribers.push(
      client.on('invitation_expired', () => {
        closeModal();
        pushToast('warning', userFacingMessage('INVITATION_EXPIRED'));
      })
    );
    unsubscribers.push(
      client.on('invitation_canceled', () => {
        if (import.meta.env.DEV) console.debug('[invitation-host] cancel');
        closeModal();
        pushToast('warning', userFacingMessage('INVITATION_CANCELED'));
      })
    );
  }

  $effect(() => {
    if (isDisabled) closeModal();
  });

  onMount(() => {
    if (import.meta.env.DEV) console.debug('[invitation-host] mount');
    document.addEventListener('keydown', handleKeydown);
    const stopClientSubscription = globalGameplaysClient.subscribe((client) => {
      if (!client) {
        unbindClient();
        return;
      }
      bindClient(client);
    });
    stopCurrentUser = currentUser.subscribe((user) => {
      if (!user) {
        pendingInvite = null;
        closeModal();
        return;
      }
      if (pendingInvite) displayInvite(pendingInvite, user.id);
    });

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      stopClientSubscription();
      stopCurrentUser?.();
      stopCurrentUser = undefined;
      unbindClient();
    };
  });

  onDestroy(() => {
    if (import.meta.env.DEV) console.debug('[invitation-host] unmount');
    if (modalTimeout) clearTimeout(modalTimeout);
  });
</script>

{#if incomingInvite}
  <div
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-labelledby="invite-title"
    inert={isDisabled}
  >
    <div
      bind:this={dialogElement}
      class="w-full max-w-[calc(100vw-2rem)] space-y-6 rounded-2xl border-2 border-neon-magenta bg-cell p-6 text-center shadow-glow-magenta sm:max-w-md sm:p-8"
    >
      <h3
        id="invite-title"
        class="break-words text-2xl font-bold uppercase tracking-widest text-neon-magenta sm:text-3xl"
      >
        Challenger Approaching!
      </h3>
      <p class="break-words text-lg text-fg-secondary">
        <span class="font-bold text-neon-cyan">{incomingInvite.host.name}</span> wants to play.
      </p>
      {#if incomingInvite.promoted}
        <p class="break-words text-sm text-fg-muted italic">
          This invitation was waiting in the queue.
        </p>
      {/if}
      <div class="flex w-full flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={isDisabled || isSubmitting}
          onclick={reject}
          class="w-full rounded-full border border-fg-muted px-4 py-3 text-sm uppercase tracking-widest text-fg-muted transition hover:bg-fg-muted hover:text-bg sm:flex-1"
        >
          Decline
        </button>
        <button
          type="button"
          disabled={isDisabled || isSubmitting}
          onclick={accept}
          class="w-full rounded-full border border-neon-cyan px-4 py-3 text-sm uppercase tracking-widest text-neon-cyan shadow-glow-cyan transition hover:bg-neon-cyan hover:text-bg sm:flex-1"
        >
          Accept
        </button>
      </div>
    </div>
  </div>
{/if}
