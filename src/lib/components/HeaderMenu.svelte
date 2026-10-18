<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import ThemeToggle from './ThemeToggle.svelte';

  interface Props {
    isAuthenticated: boolean;
    canGoBack: boolean;
    showGoToLobby: boolean;
    isLeavingGame: boolean;
    disabled: boolean;
    onBack: () => void;
    onLogout: () => void;
  }

  let {
    isAuthenticated,
    canGoBack,
    showGoToLobby,
    isLeavingGame,
    disabled,
    onBack,
    onLogout
  }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement>();
  let panelEl = $state<HTMLDivElement>();

  let backLabel = $derived(isLeavingGame ? 'Leaving...' : canGoBack ? 'Back' : 'Go to lobby');
  let showBackItem = $derived(isAuthenticated && (canGoBack || showGoToLobby));

  $effect(() => {
    if (disabled) open = false;
  });

  $effect(() => {
    if (!open || !panelEl) return;
    const first = panelEl.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  });

  afterNavigate(() => {
    open = false;
  });

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleBack() {
    close();
    onBack();
  }

  function handleLogout() {
    close();
    onLogout();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      close();
      triggerEl?.focus();
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (!open) return;

    const target = event.target as Node;
    if (triggerEl?.contains(target) || panelEl?.contains(target)) return;

    close();
  }
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onPointerDown} />

<div class="relative md:hidden">
  <button
    bind:this={triggerEl}
    type="button"
    aria-label={open ? 'Close menu' : 'Open menu'}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="header-menu-panel"
    {disabled}
    onclick={toggle}
    class="flex h-10 w-10 items-center justify-center rounded-full border border-neon-cyan text-neon-cyan shadow-glow-cyan transition active:scale-95 disabled:opacity-60"
  >
    {#if open}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-5 w-5">
        <path
          d="M6 6l12 12M18 6L6 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-5 w-5">
        <path
          d="M4 6h16M4 12h16M4 18h16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    {/if}
  </button>

  {#if open}
    <div
      bind:this={panelEl}
      id="header-menu-panel"
      role="menu"
      aria-label="Main menu"
      class="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-neon-cyan/50 bg-bg p-2 shadow-glow-cyan"
    >
      {#if showBackItem}
        <button
          type="button"
          role="menuitem"
          onclick={handleBack}
          disabled={disabled || isLeavingGame}
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm uppercase tracking-widest text-neon-cyan transition hover:bg-neon-cyan/10 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-4 w-4">
            <path
              d="M19 12H5M12 19l-7-7 7-7"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {backLabel}
        </button>
      {/if}

      <div class="flex items-center justify-between rounded-lg px-3 py-2">
        <span class="text-xs uppercase tracking-widest text-fg-muted">Theme</span>
        <ThemeToggle {disabled} />
      </div>

      {#if isAuthenticated}
        <button
          type="button"
          role="menuitem"
          onclick={handleLogout}
          {disabled}
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm uppercase tracking-widest text-neon-magenta transition hover:bg-neon-magenta/10 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-4 w-4">
            <path
              d="M15 12H3M9 6l-6 6 6 6M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Logout
        </button>
      {/if}
    </div>
  {/if}
</div>
