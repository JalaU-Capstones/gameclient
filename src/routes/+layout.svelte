<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { Pathname } from '$app/types';
  import { page } from '$app/stores';
  import { httpClient } from '$lib/api/client';
  import { ApiError } from '$lib/api/errors';
  import { sounds } from '$lib/audio/sounds';
  import { performLogout } from '$lib/auth/logout';
  import { navigationHistory } from '$lib/navigation/history';
  import { resolveRedirect } from '$lib/auth/redirect';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { isAuthenticated, isHydrated, session } from '$lib/stores/session';
  import type { User } from '$lib/types/api';
  import '../app.css';

  const PUBLIC_ROUTES = ['/login', '/register'];

  let { children } = $props();
  let isPublicRoute = $derived(PUBLIC_ROUTES.includes($page.url.pathname));
  let canGoBack = $derived($navigationHistory.length >= 2 && navigationHistory.canGoBack());

  afterNavigate(({ to }) => {
    if (to?.url.pathname) {
      navigationHistory.record(to.url.pathname);
    }
  });

  function handleBack() {
    sounds.play('click');
    const target = navigationHistory.back();
    if (target) {
      goto(resolve(target as Pathname));
    }
  }

  onMount(() => {
    const unlock = () => void sounds.unlock();
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
      if (err instanceof ApiError && err.isUnauthorized) {
        session.clear();
      } else {
        console.warn('[auth] session hydration failed', err);
        session.clear();
      }
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
    <GameTitle text="TIC TAC TOE" />

    <div class="flex items-center gap-3">
      {#if $isAuthenticated && canGoBack}
        <button
          type="button"
          onclick={handleBack}
          class="rounded-full border border-[var(--neon-cyan)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-cyan)] transition hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] active:scale-95"
          data-testid="back-button"
        >
          ← Back
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
