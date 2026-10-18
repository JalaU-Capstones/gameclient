<script lang="ts">
  import { dismissToast, toasts } from '$lib/stores/toasts';

  const toastList = $derived($toasts);

  const toneClasses: Record<string, string> = {
    info: 'border-cyan-400/70 bg-cell text-fg',
    success: 'border-emerald-400/70 bg-cell text-fg',
    warning: 'border-amber-400/70 bg-cell text-fg',
    error: 'border-red-400/70 bg-cell text-fg'
  };

  const accentClasses: Record<string, string> = {
    info: 'bg-cyan-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400'
  };

  const dotClasses: Record<string, string> = {
    info: 'bg-cyan-400',
    success: 'bg-emerald-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400'
  };
</script>

{#if toastList.length > 0}
  <div
    class="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-3"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {#each toastList as toast (toast.id)}
      <div
        class={`relative overflow-hidden rounded-xl border-2 shadow-glow-cyan backdrop-blur-sm ${toneClasses[toast.tone]}`}
      >
        <div class="flex items-start gap-3 p-3 pr-10">
          <span class={`mt-1 h-2.5 w-2.5 rounded-full ${dotClasses[toast.tone]}`}></span>
          <p class="text-sm leading-5 font-medium">{toast.message}</p>
          <button
            type="button"
            class="absolute right-2 top-2 text-xs font-bold opacity-75 transition hover:opacity-100"
            aria-label="Dismiss notification"
            onclick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
        <div class="h-1 w-full overflow-hidden bg-white/10">
          <div
            class={`h-full ${accentClasses[toast.tone]}`}
            style="animation: toast-shrink 5s linear forwards;"
          ></div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  @keyframes toast-shrink {
    from {
      transform: scaleX(1);
      transform-origin: left;
    }
    to {
      transform: scaleX(0);
      transform-origin: left;
    }
  }
</style>
