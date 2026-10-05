<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { Pathname } from '$app/types';
  import { page } from '$app/stores';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { sounds } from '$lib/audio/sounds';
  import { performLogout } from '$lib/auth/logout';
  import {
    bootstrapSession,
    clearBootstrapSessionCache,
    handleAuthFailure
  } from '$lib/auth/bootstrap';
  import { navigationHistory } from '$lib/navigation/history';
  import {
    globalGameplaysClient,
    globalPresenceClient,
    requestPresenceReconnect,
    setLastPresenceToken,
    setPresenceReconnectRequest
  } from '$lib/stores/ws';
  import {
    broadcastPresenceUsers,
    claimGameplayOwnership,
    claimPresenceOwnership,
    createTabId,
    onRemoteLogout,
    openSessionChannel,
    releaseGameplayOwnership,
    releasePresenceOwnership,
    subscribeSessionMessages
  } from '$lib/auth/sessionLock';
  import { userFacingMessage } from '$lib/errors/messages';
  import { resolveRedirect } from '$lib/auth/redirect';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import { isAuthenticated, isHydrated, session, currentUser } from '$lib/stores/session';
  import '../app.css';

  const PUBLIC_ROUTES = ['/login', '/register'];

  let { children } = $props();
  let isLeavingGame = $state(false);
  let authError = $state('');
  let layoutMounted = false;
  let presenceStarting: Promise<void> | null = null;
  let presenceOwnerRelease: (() => void) | null = null;
  let gameplayOwnerRelease: (() => void) | null = null;
  let presenceClient: ReturnType<typeof globalPresenceClient.getOrCreate> | null = null;
  let presenceUnsubscribers: (() => void)[] = [];
  let presenceRetryUsed = false;
  let presenceAccessToken = '';
  const tabId = createTabId();
  let isPublicRoute = $derived(PUBLIC_ROUTES.includes($page.url.pathname));
  let canGoBack = $derived($navigationHistory.length >= 2 && navigationHistory.canGoBack());

  function safeDiagnosticMessage(message: string | undefined): string | undefined {
    if (!message) return message;
    return message
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
      .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
      .replace(
        /\b(access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*["']?[^\s,;]+/gi,
        (_match, label: string) => `${label}=[redacted]`
      )
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]');
  }

  afterNavigate(({ to }) => {
    if (to?.url.pathname) {
      navigationHistory.record(to.url.pathname);
    }
  });

  function detachPresenceHandlers() {
    presenceUnsubscribers.forEach((unsubscribe) => unsubscribe());
    presenceUnsubscribers = [];
    presenceClient = null;
  }

  function releaseAllPresenceAndGameplay() {
    if (gameplayOwnerRelease && typeof releaseGameplayOwnership === 'function') {
      releaseGameplayOwnership();
      gameplayOwnerRelease = null;
    }
    if (presenceOwnerRelease) {
      releasePresenceOwnership();
      presenceOwnerRelease = null;
    }
    setPresenceReconnectRequest(null);
    detachPresenceHandlers();
    globalPresenceClient.disconnect();
    globalGameplaysClient.disconnect();
  }

  function releaseLayoutPresence(disconnect: boolean) {
    const hadPresenceOwnership = presenceOwnerRelease !== null;
    const hadPresenceClient = presenceClient !== null;
    if (disconnect && (hadPresenceOwnership || hadPresenceClient)) {
      detachPresenceHandlers();
      globalPresenceClient.disconnect();
    }
    if (presenceOwnerRelease) {
      presenceOwnerRelease();
      presenceOwnerRelease = null;
    }
    setPresenceReconnectRequest(null);
  }

  function retryPresenceAfterFailure(err: unknown) {
    handleAuthFailure(
      err,
      (message) => {
        authError = message;
        if ((err instanceof NetworkError || err instanceof TimeoutError) && !presenceRetryUsed) {
          presenceRetryUsed = true;
          setTimeout(() => void ensurePresence(true), 1200);
        }
      },
      $page.url.pathname
    );
  }

  async function ensurePresence(forceRefresh = false): Promise<void> {
    if (import.meta.env.DEV) console.debug('[layout] ensurePresence start', { forceRefresh });
    if (presenceStarting) return presenceStarting;
    presenceStarting = (async () => {
      const result =
        forceRefresh || !presenceAccessToken
          ? await bootstrapSession()
          : { accessToken: presenceAccessToken };
      const accessToken = result?.accessToken;
      if (import.meta.env.DEV)
        console.debug('[layout] presence bootstrap result', { accessToken: !!accessToken });
      if (!accessToken) throw new Error('No access token is available for the presence connection');
      if (!layoutMounted || !get(isAuthenticated)) return;
      presenceAccessToken = accessToken;
      setLastPresenceToken(accessToken);
      setPresenceReconnectRequest(() => void ensurePresence());

      if (!gameplayOwnerRelease && typeof claimGameplayOwnership === 'function') {
        const releaseGameplay = await claimGameplayOwnership(tabId);
        if (!layoutMounted || !get(isAuthenticated)) {
          releaseGameplay();
          return;
        }
        gameplayOwnerRelease = releaseGameplay;
      }

      if (!presenceOwnerRelease) {
        const release = await claimPresenceOwnership(tabId);
        if (!layoutMounted || !get(isAuthenticated)) {
          release();
          return;
        }
        presenceOwnerRelease = release;
      }

      const client = globalPresenceClient.getOrCreate();
      if (presenceClient !== client) {
        detachPresenceHandlers();
        presenceClient = client;
        presenceUnsubscribers.push(
          client.on('auth_ok', () => {
            if (import.meta.env.DEV) console.debug('[layout] presence auth_ok');
            client.send('list_online_users');
          })
        );
        presenceUnsubscribers.push(
          client.on('online_users', (payload: { users?: string[] } | undefined) =>
            broadcastPresenceUsers(payload?.users ?? [])
          )
        );
        presenceUnsubscribers.push(
          client.on('user_online', () => client.send('list_online_users'))
        );
        presenceUnsubscribers.push(
          client.on('user_offline', () => client.send('list_online_users'))
        );
        presenceUnsubscribers.push(
          client.on('error', (payload: { code?: string; message?: string } | undefined) => {
            if (!get(isAuthenticated)) return;
            if (import.meta.env.DEV) {
              console.debug('[layout] presence error', {
                code: payload?.code,
                message: safeDiagnosticMessage(payload?.message)
              });
            }
            if (payload?.code === 'AUTH_FAILED') {
              retryPresenceAfterFailure(
                new ApiError(
                  userFacingMessage(payload?.code, 'Presence authentication failed'),
                  401,
                  payload.code
                )
              );
            } else {
              authError = 'Connection lost. Reconnecting…';
            }
          })
        );
        presenceUnsubscribers.push(
          client.on('auth_failed', (payload: { code?: number; reason?: string } | undefined) => {
            if (!get(isAuthenticated)) return;
            if (import.meta.env.DEV) {
              console.debug('[layout] presence auth_failed', {
                code: payload?.code,
                reason: payload?.reason
              });
            }
            if (payload?.code === 4401 || payload?.reason === 'auth_error') {
              retryPresenceAfterFailure(
                new ApiError('Presence authentication failed', 401, 'AUTH_FAILED')
              );
            } else {
              retryPresenceAfterFailure(new TimeoutError('Presence authentication timed out'));
            }
          })
        );
      }
      if (!client.isAlive()) {
        if (import.meta.env.DEV) console.debug('[layout] connecting presence');
        client.connect(accessToken);
      }
    })()
      .catch((err: unknown) => {
        console.error('[layout] ensurePresence failure', err);
        retryPresenceAfterFailure(err);
      })
      .finally(() => {
        if (import.meta.env.DEV)
          console.debug('[layout] ensurePresence end', { hasOwner: !!presenceOwnerRelease });
        presenceStarting = null;
      });
    return presenceStarting;
  }

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
    layoutMounted = true;
    if (import.meta.env.DEV) console.debug('[layout] mount');
    const unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void Promise.resolve(sounds.unlock()).catch((err: unknown) => {
        console.warn('[audio] failed to unlock audio', err);
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    const onPageHide = () => {
      if (import.meta.env.DEV) console.debug('[layout] pagehide');
      releaseAllPresenceAndGameplay();
      if (presenceOwnerRelease) {
        presenceClient?.send('ping');
        releaseLayoutPresence(true);
      }
    };
    const onVisibilityChange = () => {
      if (import.meta.env.DEV)
        console.debug('[layout] visibilitychange', {
          state: document.visibilityState,
          authenticated: get(isAuthenticated),
          hasOwner: !!presenceOwnerRelease
        });
      if (document.visibilityState === 'visible' && !presenceClient?.isAlive()) {
        if (import.meta.env.DEV) console.debug('[layout] visible with dead presence socket');
        if (presenceOwnerRelease) requestPresenceReconnect();
        else void ensurePresence();
      }
    };
    const onBeforeUnload = () => {
      if (import.meta.env.DEV) console.debug('[layout] beforeunload');
      releaseAllPresenceAndGameplay();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  onMount(() => {
    const closeChannel = openSessionChannel();
    const unsubscribe = onRemoteLogout(() => {
      detachPresenceHandlers();
      globalPresenceClient.disconnect();
      releaseLayoutPresence(false);
      globalGameplaysClient.disconnect();
      clearBootstrapSessionCache();
      session.clear();
      navigationHistory.reset();
      void goto(resolve('/login'));
    });
    const unsubscribeMessages = subscribeSessionMessages((message) => {
      if (message.type === 'presence-list-request') {
        if (import.meta.env.DEV) {
          console.debug('[layout] presence-list-request received', {
            hasOwner: !!presenceOwnerRelease
          });
        }
        if (presenceOwnerRelease !== null && presenceClient?.isAlive()) {
          presenceClient.send('list_online_users');
        }
      }
    });
    return () => {
      unsubscribe();
      unsubscribeMessages();
      closeChannel();
    };
  });

  onDestroy(() => {
    layoutMounted = false;
    releasePresenceOwnership();
    presenceOwnerRelease = null;
    setPresenceReconnectRequest(null);
    detachPresenceHandlers();
    if (!get(isAuthenticated)) globalPresenceClient.disconnect();
  });

  onMount(async () => {
    if ($isHydrated) return;

    if (import.meta.env.DEV) console.debug('[layout] hydration start');
    session.setLoading(true);
    try {
      const { user, accessToken } = await bootstrapSession();
      presenceAccessToken = accessToken;
      setLastPresenceToken(accessToken);
      session.setUser(user);
    } catch (err) {
      handleAuthFailure(err, (message) => (authError = message), $page.url.pathname);
    } finally {
      session.setLoading(false);
      if (import.meta.env.DEV) console.debug('[layout] hydration done', !!get(session).user);
    }
  });

  $effect(() => {
    if (import.meta.env.DEV) {
      console.debug('[layout] authentication state', {
        path: $page.url.pathname,
        hydrated: $isHydrated,
        authenticated: $isAuthenticated
      });
    }
    if (!$isHydrated) return;
    if (!$isAuthenticated) {
      releaseLayoutPresence(true);
      presenceAccessToken = '';
      setLastPresenceToken(null);
      return;
    }
    void ensurePresence();
  });

  $effect(() => {
    if (!$isHydrated) return;
    if ($isAuthenticated) return;
    if (isPublicRoute) return;

    if (import.meta.env.DEV) {
      console.debug('[layout] unauthenticated redirect', {
        path: $page.url.pathname,
        target:
          $page.url.pathname === '/'
            ? '/login'
            : `/login?redirect=${encodeURIComponent($page.url.pathname + $page.url.search)}`
      });
    }
    if ($page.url.pathname === '/') {
      goto(resolve('/login'));
      return;
    }

    const redirectTo = $page.url.pathname + $page.url.search;
    const url = resolve(`/login?redirect=${encodeURIComponent(redirectTo)}`);
    goto(url);
  });

  $effect(() => {
    if (!$isHydrated) return;
    if (!$isAuthenticated) return;
    if ($page.url.pathname !== '/') return;
    goto(resolve('/lobby'));
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
    {#if authError}
      <div
        class="mb-4 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-amber-400"
        role="status"
      >
        {authError}
      </div>
    {/if}
    {@render children?.()}
  </main>
</div>
