<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { Pathname } from '$app/types';
  import { page } from '$app/stores';
  import { httpClient } from '$lib/api/client';
  import { ApiError } from '$lib/api/errors';
  import { sounds } from '$lib/audio/sounds';
  import { performLogout } from '$lib/auth/logout';
  import { navigationHistory } from '$lib/navigation/history';
  import { globalGameplaysClient } from '$lib/stores/ws';
  import { resolveRedirect } from '$lib/auth/redirect';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { isAuthenticated, isHydrated, session, currentUser } from '$lib/stores/session';
  import type { User } from '$lib/types/api';
  import '../app.css';

  const PUBLIC_ROUTES = ['/login', '/register'];

  let { children } = $props();
  let isLeavingGame = $state(false);
  let isPublicRoute = $derived(PUBLIC_ROUTES.includes($page.url.pathname));
  let canGoBack = $derived($navigationHistory.length >= 2 && navigationHistory.canGoBack());

  afterNavigate(({ to }) => {
    if (to?.url.pathname) {
      navigationHistory.record(to.url.pathname);
    }
  });

  async function handleBack() {
    if (isLeavingGame) return;
    sounds.play('click');
    const target = navigationHistory.back();
    if (!target) return;

    if (/^\/game\//.test($page.url.pathname)) {
      const gameId = $page.params.id;
      if (gameId) {
        isLeavingGame = true;
        try {
          const gameplaysClient = globalGameplaysClient.getOrCreate();
          const isConnected = get(gameplaysClient.state) === 'connected';

          if (isConnected) {
            await new Promise<void>((resolveLeave) => {
              let unsubscribe = () => {};
              const timeout = setTimeout(finish, 1000);
              function finish() {
                clearTimeout(timeout);
                unsubscribe();
                resolveLeave();
              }

              unsubscribe = gameplaysClient.on(
                'game_ended',
                (payload: { game_id?: string } | undefined) => {
                  if (payload?.game_id && payload.game_id !== gameId) return;
                  finish();
                }
              );
              gameplaysClient.send('leave_game', { game_id: gameId });
            });
          } else {
            gameplaysClient.send('leave_game', { game_id: gameId });
          }
        } catch (err) {
          console.warn('[game] failed to confirm leaving game', err);
        }
      }
    }

    goto(resolve(target as Pathname));
    isLeavingGame = false;
  }

  onMount(() => {
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void Promise.resolve(sounds.unlock()).catch((err: unknown) => {
        console.warn('[audio] failed to unlock audio', err);
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  });

  onMount(async () => {
    if ($isHydrated) return;

    session.setLoading(true);
    try {
      const user = await httpClient.get<User>('/api/v2/auth/me');
      session.setUser(user);
    } catch (err) {
      if (!(err instanceof ApiError && err.isUnauthorized)) {
        console.warn('[auth] session hydration failed', err);
      }
      session.clear();
    } finally {
      session.setLoading(false);
    }
  });

  $effect(() => {
    if (!$isHydrated) return;
    if ($isAuthenticated) return;
    if (isPublicRoute) return;

    if ($page.url.pathname === '/') {
      goto(resolve('/login'));
      return;
    }

    const redirectTo = $page.url.pathname + $page.url.search;
    const url = resolve(`/login?redirect=${encodeURIComponent(redirectTo)}`);
    goto(url);
  });

  // Redirect authenticated users away from public routes without discarding their intended destination.
  $effect(() => {
    if (!$isHydrated) return;
    if (!$isAuthenticated) return;
    if (!isPublicRoute) return;

    const redirectParam = $page.url.searchParams.get('redirect');
    const destination = resolveRedirect(redirectParam);
    goto(resolve(destination));
  });
</script>

<svelte:head>
  <title>GameClient</title>
</svelte:head>

<div class="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-200">
  <header class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
    <div class="flex flex-col">
      <GameTitle text="TIC TAC TOE" />
      {#if $isAuthenticated && $currentUser && !$page.url.pathname.startsWith('/game')}
        <span class="text-[var(--neon-cyan)] text-xs uppercase tracking-widest mt-1 opacity-80">
          Welcome, {$currentUser.name}
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      {#if $isAuthenticated && canGoBack}
        <button
          type="button"
          onclick={handleBack}
          disabled={isLeavingGame}
          class="rounded-full border border-[var(--neon-magenta)] px-6 py-2 text-sm uppercase tracking-widest text-[var(--neon-magenta)] shadow-[var(--glow-magenta)] transition-all duration-200 hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95 disabled:opacity-60"
          data-testid="back-button"
        >
          {isLeavingGame ? 'Leaving...' : '← Back'}
        </button>
      {/if}
      {#if $isAuthenticated}
        <button
          type="button"
          onclick={performLogout}
          class="rounded-full border border-[var(--neon-magenta)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-magenta)] transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95"
          data-testid="logout-button"
        >
          Logout
        </button>
      {/if}
      <ThemeToggle />
    </div>
  </header>
  <main class="mx-auto max-w-6xl px-6 pb-10">
    {@render children?.()}
  </main>
</div>
