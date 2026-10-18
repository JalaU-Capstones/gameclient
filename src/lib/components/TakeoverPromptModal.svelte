<script lang="ts">
  import CountdownButton from '$lib/components/CountdownButton.svelte';

  interface Props {
    show: boolean;
    isSubmitting: boolean;
    errorMessage?: string;
    retryAfterSeconds?: number;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { show, isSubmitting, errorMessage, retryAfterSeconds, onConfirm, onCancel }: Props =
    $props();

  let primaryButton: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (!show) return;
    queueMicrotask(() => {
      primaryButton?.focus();
    });
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!show || isSubmitting) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <div
    class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    data-testid="takeover-modal"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="takeover-title"
      class="w-full max-w-md rounded-2xl border border-neon-cyan bg-bg p-6 shadow-glow-cyan"
      inert={isSubmitting}
    >
      <h2 id="takeover-title" class="text-2xl font-bold uppercase tracking-widest text-neon-cyan">
        Another session is active
      </h2>
      <p class="mt-4 text-base text-fg">
        Another session is active in another tab or browser. If you continue here, that session will
        be closed.
      </p>

      {#if errorMessage}
        <div
          class="mt-4 rounded border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300"
          role="alert"
        >
          {errorMessage}
        </div>
      {/if}

      <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        {#if retryAfterSeconds !== undefined && retryAfterSeconds > 0}
          <CountdownButton
            seconds={retryAfterSeconds}
            disabled={isSubmitting}
            onclick={onConfirm}
            label="Retry in"
            dataTestId="takeover-confirm"
            class="flex-1 rounded-full border border-neon-cyan bg-neon-cyan px-4 py-3 text-sm uppercase tracking-widest text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          />
        {:else}
          <button
            bind:this={primaryButton}
            type="button"
            disabled={isSubmitting}
            onclick={onConfirm}
            data-testid="takeover-confirm"
            class="flex-1 rounded-full border border-neon-cyan bg-neon-cyan px-4 py-3 text-sm uppercase tracking-widest text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue here
          </button>
        {/if}

        <button
          type="button"
          disabled={isSubmitting}
          onclick={onCancel}
          data-testid="takeover-cancel"
          class="rounded-full border border-fg-muted bg-transparent px-4 py-3 text-sm uppercase tracking-widest text-fg-muted transition hover:border-fg hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}
