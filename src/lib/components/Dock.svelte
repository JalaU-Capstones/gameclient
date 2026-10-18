<script lang="ts">
  import { sounds } from '$lib/audio/sounds';
  import { dockItems } from '$lib/navigation/dockItems';

  interface Props {
    visible: boolean;
    currentPath: string;
    onNavigate: (path: string) => void;
    disabled?: boolean;
  }

  let { visible, currentPath, onNavigate, disabled = false }: Props = $props();

  function handleClick(path: string) {
    if (disabled) return;
    sounds.play('click');
    onNavigate(path);
  }
</script>

{#if visible}
  <nav
    aria-label="Main navigation"
    data-testid="dock"
    class="fixed bottom-0 left-1/2 z-30 -translate-x-1/2 translate-y-0 rounded-t-2xl border border-b-0 border-neon-cyan/50 bg-bg/95 px-3 py-2 shadow-glow-cyan backdrop-blur transition-transform duration-200 ease-out sm:translate-y-[calc(100%-12px)] sm:hover:translate-y-0 sm:focus-within:translate-y-0"
  >
    <ul class="flex items-center gap-2">
      {#each dockItems as item (item.id)}
        {@const isActive = currentPath === item.path}
        <li>
          <button
            type="button"
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive}
            data-testid={`dock-item-${item.id}`}
            {disabled}
            onclick={() => handleClick(item.path)}
            class="flex h-12 w-12 items-center justify-center rounded-xl border transition-all duration-150 enabled:hover:scale-125 enabled:focus-visible:scale-125 enabled:active:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan disabled:cursor-not-allowed disabled:opacity-60"
            class:border-neon-cyan={isActive}
            class:border-transparent={!isActive}
            class:bg-cell={isActive}
            class:shadow-glow-cyan={isActive}
            class:text-neon-cyan={isActive}
            class:text-fg={!isActive}
            class:opacity-70={!isActive}
          >
            {#if item.id === 'lobby'}
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6">
                <path
                  d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10.5Z"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if item.id === 'history'}
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
                <path
                  d="M12 7v5l3 2"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else if item.id === 'profile'}
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6">
                <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8" />
                <path
                  d="M5.5 18c1.5-2.5 4-3.8 6.5-3.8S17 15.5 18.5 18"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-6 w-6">
                <path
                  d="M8 6.5h9M8 10.5h9M8 14.5h6M6 6.5h.01M6 10.5h.01M6 14.5h.01"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M4 4.5h12a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
