<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { sounds } from '$lib/audio/sounds';
  import { userFacingMessage } from '$lib/errors/messages';
  import { currentUser } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toasts';
  import { globalGameplaysClient, standbyMode } from '$lib/stores/ws';
  import { isUuid } from '$lib/utils/uuid';

  interface IncomingInvite {
    game_id: string;
    host: { id: string; name: string };
  }

  let incomingInvite = $state<IncomingInvite | null>(null);
  let isSubmitting = $state(false);
  let dialogElement = $state<HTMLDivElement | undefined>();
  let previouslyFocused: HTMLElement | null = null;
  let unsubscribers: (() => void)[] = [];

  function closeModal() {
    incomingInvite = null;
    isSubmitting = false;
    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function openModal(invite: IncomingInvite) {
    previouslyFocused = document.activeElement as HTMLElement | null;
    incomingInvite = invite;
    queueMicrotask(() => {
      dialogElement?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
  }

  function reject() {
    if (!incomingInvite || $standbyMode || !isUuid(incomingInvite.game_id) || isSubmitting) return;
    sounds.play('click');
    globalGameplaysClient.getOrCreate().send('reject_invitation', {
      game_id: incomingInvite.game_id
    });
    closeModal();
  }

  function accept() {
    if (!incomingInvite || $standbyMode || !isUuid(incomingInvite.game_id) || isSubmitting) return;
    sounds.play('click');
    isSubmitting = true;
    globalGameplaysClient.getOrCreate().send('accept_invitation', {
      game_id: incomingInvite.game_id
    });
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

  onMount(() => {
    const client = globalGameplaysClient.getOrCreate();
    document.addEventListener('keydown', handleKeydown);

    unsubscribers.push(
      client.on('invitation_received', (payload: unknown) => {
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('game_id' in payload) ||
          !('host' in payload)
        ) {
          return;
        }

        const invite = payload as IncomingInvite;

        if (!isUuid(invite.game_id)) return;
        if (!invite.host || typeof invite.host.name !== 'string' || invite.host.name.length === 0) {
          return;
        }
        if (invite.host.id === $currentUser?.id) return;

        sounds.play('click');
        openModal(invite);
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
        closeModal();
        pushToast('warning', userFacingMessage('INVITATION_CANCELED'));
      })
    );
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
  });
</script>

{#if incomingInvite}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-labelledby="invite-title"
  >
    <div
      bind:this={dialogElement}
      class="w-full max-w-md space-y-6 rounded-2xl border-2 border-[var(--neon-magenta)] bg-[var(--cell)] p-8 text-center shadow-[var(--glow-magenta)]"
    >
      <h3
        id="invite-title"
        class="text-2xl font-bold uppercase tracking-widest text-[var(--neon-magenta)]"
      >
        Challenger Approaching!
      </h3>
      <p class="text-lg text-[var(--text-secondary)]">
        <span class="font-bold text-[var(--neon-cyan)]">{incomingInvite.host.name}</span> wants to play.
      </p>
      <div class="flex gap-4">
        <button
          type="button"
          disabled={$standbyMode || isSubmitting}
          onclick={reject}
          class="flex-1 rounded-full border border-[var(--text-muted)] px-4 py-3 text-sm uppercase tracking-widest text-[var(--text-muted)] transition hover:bg-[var(--text-muted)] hover:text-[var(--bg)]"
        >
          Decline
        </button>
        <button
          type="button"
          disabled={$standbyMode || isSubmitting}
          onclick={accept}
          class="flex-1 rounded-full border border-[var(--neon-cyan)] px-4 py-3 text-sm uppercase tracking-widest text-[var(--neon-cyan)] shadow-[var(--glow-cyan)] transition hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)]"
        >
          Accept
        </button>
      </div>
    </div>
  </div>
{/if}
