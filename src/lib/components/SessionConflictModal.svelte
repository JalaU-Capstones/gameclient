<script lang="ts">
  import { onMount } from 'svelte';

  let {
    onTakeover,
    onDismiss
  }: {
    onTakeover: () => Promise<void>;
    onDismiss: () => void;
  } = $props();

  let dialogEl: HTMLDivElement | null = null;
  let primaryButtonEl: HTMLButtonElement | null = null;
  let isTakingOver = $state(false);

  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !dialogEl) return;

    const focusable = Array.from(
      dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute('disabled'));

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

  function handleEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    }
  }

  function handleTakeover() {
    isTakingOver = true;
    void onTakeover().finally(() => {
      isTakingOver = false;
    });
  }

  onMount(() => {
    primaryButtonEl?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      trapFocus(event);
      handleEscape(event);
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
>
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="session-conflict-title"
    class="w-full max-w-md rounded-2xl border border-[var(--neon-magenta)] bg-[var(--bg)] p-6 shadow-[var(--glow-magenta)]"
  >
    <h2 id="session-conflict-title" class="text-xl font-semibold text-[var(--text-primary)]">
      Session already active
    </h2>
    <p class="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
      You are signed in here but have an active session in another tab or browser.
    </p>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
      <button
        bind:this={primaryButtonEl}
        type="button"
        onclick={handleTakeover}
        disabled={isTakingOver}
        class="rounded-full border border-[var(--neon-magenta)] bg-[var(--neon-magenta)] px-4 py-2 text-sm font-medium text-[var(--bg)] transition disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isTakingOver ? 'Using this tab…' : 'Use this tab'}
      </button>
      <button
        type="button"
        onclick={onDismiss}
        class="rounded-full border border-[var(--text-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--neon-cyan)] hover:text-[var(--neon-cyan)]"
      >
        Dismiss
      </button>
    </div>
  </div>
</div>
