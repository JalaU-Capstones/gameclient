<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { get } from 'svelte/store';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { Pathname } from '$app/types';
  import { page } from '$app/stores';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { authApi } from '$lib/api/auth';
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
    setPresenceReconnectRequest,
    standbyMode
  } from '$lib/stores/ws';
  import {
    broadcastSessionTakeoverRequest,
    broadcastPresenceUsers,
    broadcastSessionTakeoverDismissed,
    broadcastTakeoverAck,
    broadcastTakeoverConfirmed,
    broadcastTakeoverFailed,
    broadcastTakeoverReady,
    claimGameplayOwnership,
    claimPresenceOwnership,
    createTabId,
    onRemoteLogout,
    onSessionTakeoverRequest,
    openSessionChannel,
    releaseGameplayOwnership,
    releasePresenceOwnership,
    subscribeSessionMessages,
    type SessionMessage
  } from '$lib/auth/sessionLock';
  import { userFacingMessage } from '$lib/errors/messages';
  import { resolveRedirect } from '$lib/auth/redirect';
  import type { WebSocketClient } from '$lib/api/ws';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import SessionConflictModal from '$lib/components/SessionConflictModal.svelte';
  import SessionReplacedBanner from '$lib/components/SessionReplacedBanner.svelte';
  import { isAuthenticated, isHydrated, session, currentUser } from '$lib/stores/session';
  import '../app.css';

  const PUBLIC_ROUTES = ['/login', '/register'];

  let { children } = $props();
  let headerElement: HTMLElement | undefined = $state();
  let mainElement: HTMLElement | undefined = $state();
  let isLeavingGame = $state(false);
  let authError = $state('');
  let sessionConflict = $state(false);
  let sessionReplaced = $state(false);
  let isStandby = $state(false);
  let takeoverError = $state('');
  let isTakingOver = $state(false);
  let isRetryingSession = $state(false);
  let sessionReplacedRef = false;
  let takeoverSessionUpdated = false;
  const shownCloseCodes = new SvelteSet<number>();
  let genericConnectionAlertShown = false;
  let takeoverAttempt = 0;
  let layoutMounted = false;
  let presenceStarting: Promise<void> | null = null;
  let presenceOwnerRelease: (() => void) | null = null;
  let gameplayOwnerRelease: (() => void) | null = null;
  let presenceClient: ReturnType<typeof globalPresenceClient.getOrCreate> | null = null;
  let presenceUnsubscribers: (() => void)[] = [];
  const monitoredSocketClients = new WeakSet<object>();
  const sessionConflictPaths = new SvelteSet<string>();
  const sessionRetryingPaths = new SvelteSet<string>();
  const socketMonitorUnsubscribers: (() => void)[] = [];
  let presenceRetryUsed = false;
  let presenceAccessToken = '';
  let standbyOwnerTabId: string | null = null;
  const pendingTakeoverRequesters = new SvelteMap<string, string>();
  let takeoverHandshake: {
    requestId: string;
    acknowledgement: Promise<string | null>;
    cancel: () => void;
  } | null = null;
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
    setPresenceReconnectRequest(null);
    detachPresenceHandlers();
    globalPresenceClient.disconnect();
    globalGameplaysClient.disconnect();
    if (gameplayOwnerRelease && typeof releaseGameplayOwnership === 'function') {
      releaseGameplayOwnership();
      gameplayOwnerRelease = null;
    }
    if (presenceOwnerRelease) {
      releasePresenceOwnership();
      presenceOwnerRelease = null;
    }
  }

  function releaseAllLocalLocks() {
    if (gameplayOwnerRelease) {
      releaseGameplayOwnership();
      gameplayOwnerRelease = null;
    }
    if (presenceOwnerRelease) {
      releasePresenceOwnership();
      presenceOwnerRelease = null;
    }
    setPresenceReconnectRequest(null);
  }

  function setStandbyMode(enabled: boolean) {
    isStandby = enabled;
    standbyMode.set(enabled);
    setReadOnlyMode(enabled);
  }

  function setReadOnlyMode(enabled: boolean) {
    globalPresenceClient.setReadOnlyMode(enabled);
    globalGameplaysClient.setReadOnlyMode(enabled);
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
        if (
          !isTakingOver &&
          (err instanceof NetworkError || err instanceof TimeoutError) &&
          !presenceRetryUsed
        ) {
          presenceRetryUsed = true;
          setTimeout(() => void ensurePresence(true), 1200);
        }
      },
      $page.url.pathname
    );
  }

  function clearConnectionAlerts() {
    shownCloseCodes.clear();
    genericConnectionAlertShown = false;
    if (authError === 'Connection lost. Reconnecting…') authError = '';
  }

  function showConnectionAlertOnce(code?: number) {
    if (code !== undefined && shownCloseCodes.has(code)) return;
    if (code !== undefined) shownCloseCodes.add(code);
    if (genericConnectionAlertShown) return;
    genericConnectionAlertShown = true;
    authError = 'Connection lost. Reconnecting…';
  }

  function monitorSocket(client: WebSocketClient, path: string): void {
    if (monitoredSocketClients.has(client)) return;
    monitoredSocketClients.add(client);
    socketMonitorUnsubscribers.push(client.on('closed', handleWsClose));
    socketMonitorUnsubscribers.push(
      client.on('session_retrying', () => {
        sessionRetryingPaths.add(path);
        isRetryingSession = true;
      })
    );
    socketMonitorUnsubscribers.push(
      client.on('session_retry_exhausted', (event: { reason?: string } | undefined) => {
        sessionRetryingPaths.delete(path);
        isRetryingSession = sessionRetryingPaths.size > 0;
        if (event?.reason === 'release_timeout') {
          takeoverError = 'Session transfer timed out. Dismiss this tab or try again.';
        }
      })
    );
    socketMonitorUnsubscribers.push(
      client.state.subscribe((state) => {
        if (state === 'connected') {
          clearConnectionAlerts();
          sessionRetryingPaths.delete(path);
          sessionConflictPaths.delete(path);
          isRetryingSession = sessionRetryingPaths.size > 0;
          if (sessionConflictPaths.size === 0 && !isTakingOver) sessionConflict = false;
        }
      })
    );
  }

  function handleWsClose({
    code,
    reason,
    path
  }: { code?: number; reason?: string; path?: string } = {}) {
    if (code !== 4409) {
      if (!sessionConflict && !sessionReplaced && get(isAuthenticated)) {
        showConnectionAlertOnce(code);
      }
      return;
    }

    if (reason === 'session_already_active') {
      sessionConflict = true;
      sessionReplaced = false;
      if (path) sessionConflictPaths.add(path);
      beginTakeoverRequest();
    } else if (reason === 'session_replaced') {
      takeoverHandshake?.cancel();
      takeoverHandshake = null;
      sessionReplaced = true;
      setStandbyMode(true);
      sessionConflict = false;
      sessionReplacedRef = true;
      isTakingOver = false;
      takeoverAttempt += 1;
    }
  }

  async function ensurePresence(
    forceRefresh = false,
    expectedTakeoverAttempt?: number
  ): Promise<void> {
    if (!isTakingOver && (sessionReplacedRef || sessionConflict)) return;
    const isStaleTakeover = () =>
      expectedTakeoverAttempt !== undefined && expectedTakeoverAttempt !== takeoverAttempt;
    if (import.meta.env.DEV) console.debug('[layout] ensurePresence start', { forceRefresh });
    if (presenceStarting) return presenceStarting;
    presenceStarting = (async () => {
      const result =
        forceRefresh || !presenceAccessToken
          ? await bootstrapSession()
          : { accessToken: presenceAccessToken };
      const accessToken = result?.accessToken;
      if (isStaleTakeover()) return;
      if (isTakingOver && !takeoverSessionUpdated) return;
      if (import.meta.env.DEV)
        console.debug('[layout] presence bootstrap result', { accessToken: !!accessToken });
      if (!accessToken) throw new Error('No access token is available for the presence connection');
      if (!layoutMounted || !get(isAuthenticated)) return;
      presenceAccessToken = accessToken;
      setLastPresenceToken(accessToken);
      setPresenceReconnectRequest(() => void ensurePresence());

      if (!gameplayOwnerRelease && typeof claimGameplayOwnership === 'function') {
        const releaseGameplay = await claimGameplayOwnership(tabId);
        if (
          !layoutMounted ||
          !get(isAuthenticated) ||
          isStaleTakeover() ||
          (isTakingOver && !takeoverSessionUpdated)
        ) {
          releaseGameplay();
          return;
        }
        gameplayOwnerRelease = releaseGameplay;
      }

      if (!presenceOwnerRelease) {
        const release = await claimPresenceOwnership(tabId);
        if (
          !layoutMounted ||
          !get(isAuthenticated) ||
          isStaleTakeover() ||
          (isTakingOver && !takeoverSessionUpdated)
        ) {
          release();
          return;
        }
        presenceOwnerRelease = release;
      }

      const wasStandby = isStandby;
      if (wasStandby || (sessionConflict && !isTakingOver)) {
        setStandbyMode(false);
        sessionReplaced = false;
        sessionReplacedRef = false;
        sessionConflict = false;
        sessionConflictPaths.clear();
      } else if (sessionConflict && isTakingOver) {
        setReadOnlyMode(false);
      }

      const client = globalPresenceClient.getOrCreate();
      monitorSocket(client, '/api/v2/ws/presence');
      if (presenceClient !== client) {
        detachPresenceHandlers();
        presenceClient = client;
        presenceUnsubscribers.push(
          client.on('auth_ok', () => {
            if (import.meta.env.DEV) console.debug('[layout] presence auth_ok');
            if (isTakingOver) {
              takeoverError = '';
            }
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
              showConnectionAlertOnce();
            }
          })
        );
        presenceUnsubscribers.push(
          client.on('auth_failed', (payload: { code?: number; reason?: string } | undefined) => {
            if (!get(isAuthenticated)) return;
            if (payload?.code === 4409) return;
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
      if (wasStandby) {
        const gameplayClient = globalGameplaysClient.getOrCreate();
        monitorSocket(gameplayClient, '/api/v2/ws/gameplays');
        if (!gameplayClient.isAlive()) gameplayClient.connect(accessToken);
      }
    })()
      .catch((err: unknown) => {
        console.error('[layout] ensurePresence failure', err);
        if (expectedTakeoverAttempt === undefined) retryPresenceAfterFailure(err);
      })
      .finally(() => {
        if (import.meta.env.DEV)
          console.debug('[layout] ensurePresence end', { hasOwner: !!presenceOwnerRelease });
        presenceStarting = null;
      });
    return presenceStarting;
  }

  function waitForSocketAuth(client: WebSocketClient, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let unsubscribeAuth = () => {};
      let unsubscribeRetry = () => {};
      let unsubscribeFailure = () => {};
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        unsubscribeAuth();
        unsubscribeRetry();
        unsubscribeFailure();
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(() => {
        finish(new TimeoutError('WebSocket authentication timed out during session takeover'));
      }, timeoutMs);
      unsubscribeAuth = client.on('auth_ok', () => finish());
      unsubscribeRetry = client.on(
        'session_retry_exhausted',
        (event: { path?: string; reason?: string } | undefined) =>
          finish(
            event?.reason === 'release_timeout'
              ? new TimeoutError('Timed out waiting for the active tab to release')
              : new Error(`Session conflict retries exhausted for ${event?.path ?? 'WebSocket'}`)
          )
      );
      unsubscribeFailure = client.on('auth_failed', () =>
        finish(new Error('WebSocket authentication failed during session takeover'))
      );
    });
  }

  function waitForTakeoverSignal<
    T extends Extract<SessionMessage, { type: 'takeover-ack' | 'takeover-ready' }>
  >(
    type: T['type'],
    matches: (message: T) => boolean
  ): {
    promise: Promise<T | null>;
    cancel: () => void;
  } {
    let settled = false;
    let unsubscribe = () => {};
    let resolveSignal: (signal: T | null) => void = () => {};
    const promise = new Promise<T | null>((resolve) => {
      resolveSignal = resolve;
    });
    const finish = (signal: T | null) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolveSignal(signal);
    };
    unsubscribe = subscribeSessionMessages((message) => {
      if (message.type !== type) return;
      const signal = message as T;
      if (matches(signal)) finish(signal);
    });
    return { promise, cancel: () => finish(null) };
  }

  function beginTakeoverRequest() {
    if (takeoverHandshake) return takeoverHandshake;
    const requestId = createTabId();
    const ackWaiter = waitForTakeoverSignal(
      'takeover-ack',
      (message) => message.requesterTabId === tabId && message.requestId === requestId
    );
    takeoverHandshake = {
      requestId,
      acknowledgement: ackWaiter.promise.then((message) => message?.tabId ?? null),
      cancel: ackWaiter.cancel
    };
    broadcastSessionTakeoverRequest(tabId, requestId);
    return takeoverHandshake;
  }

  async function handleTakeover() {
    isTakingOver = true;
    takeoverSessionUpdated = false;
    takeoverError = '';
    const attempt = ++takeoverAttempt;
    let requestId = '';
    let ownerTabId: string | null = null;
    let takeoverReady = false;
    let cancelReadyWait = () => {};
    try {
      const handshake = beginTakeoverRequest();
      requestId = handshake.requestId;
      ownerTabId = await handshake.acknowledgement;
      if (!ownerTabId) throw new Error('The active tab did not acknowledge the takeover request');

      const readyWait = waitForTakeoverSignal(
        'takeover-ready',
        (message) =>
          message.requesterTabId === tabId &&
          message.tabId === ownerTabId &&
          message.requestId === requestId
      );
      cancelReadyWait = readyWait.cancel;
      broadcastTakeoverConfirmed(tabId, ownerTabId, requestId);
      const ready = await readyWait.promise;
      if (!ready) throw new Error('The active tab did not complete the session handover');
      takeoverReady = true;
      cancelReadyWait = () => {};
      takeoverHandshake = null;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new TimeoutError('Session transfer timed out'));
        }, 15_000);
        void authApi
          .takeoverSession()
          .then(() => {
            takeoverSessionUpdated = true;
            resolve();
          }, reject)
          .finally(() => clearTimeout(timeout));
      });
      clearBootstrapSessionCache();
      sessionReplacedRef = false;
      releaseAllLocalLocks();
      globalPresenceClient.disconnect();
      globalGameplaysClient.disconnect();

      const pendingPresenceStart = presenceStarting;
      if (pendingPresenceStart) await pendingPresenceStart;
      if (attempt !== takeoverAttempt) return;

      const client = globalPresenceClient.getOrCreate();
      const authenticated = waitForSocketAuth(client);
      await ensurePresence(true, attempt);
      await authenticated;

      const accessToken = presenceAccessToken;
      if (!accessToken) throw new Error('No access token is available after session takeover');
      const gameplayClient = globalGameplaysClient.getOrCreate();
      monitorSocket(gameplayClient, '/api/v2/ws/gameplays');
      const gameplayAuthenticated = waitForSocketAuth(gameplayClient);
      gameplayClient.connect(accessToken);
      await gameplayAuthenticated;
      sessionConflict = false;
      sessionConflictPaths.clear();
      sessionRetryingPaths.clear();
      isRetryingSession = false;
      sessionReplaced = false;
    } catch (err) {
      if (attempt !== takeoverAttempt) return;
      takeoverAttempt += 1;
      takeoverSessionUpdated = false;
      takeoverHandshake?.cancel();
      takeoverHandshake = null;
      cancelReadyWait();
      sessionConflict = true;
      setStandbyMode(true);
      sessionReplaced = false;
      sessionReplacedRef = false;
      releaseAllLocalLocks();
      globalPresenceClient.disconnect();
      globalGameplaysClient.disconnect();
      if (ownerTabId && takeoverReady) {
        broadcastTakeoverFailed(tabId, ownerTabId, requestId);
      }
      if (err instanceof TimeoutError) {
        console.error('[layout] Takeover timed out — returning to original tab as active', err);
      } else {
        console.error('[layout] session takeover failed', err);
      }
      takeoverError =
        err instanceof TimeoutError
          ? 'Session transfer timed out. The original tab is active again.'
          : 'Failed to take over session. Please try again.';
    } finally {
      isTakingOver = false;
    }
  }

  function handleConflictDismiss() {
    takeoverAttempt += 1;
    takeoverHandshake?.cancel();
    takeoverHandshake = null;
    sessionConflict = false;
    sessionReplaced = false;
    sessionReplacedRef = false;
    releaseAllLocalLocks();
    sessionRetryingPaths.clear();
    isRetryingSession = false;
    broadcastSessionTakeoverDismissed(tabId);
    setStandbyMode(true);
    void ensurePresence();
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
      if (isTakingOver) return;
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
    monitorSocket(globalPresenceClient.getOrCreate(), '/api/v2/ws/presence');
    monitorSocket(globalGameplaysClient.getOrCreate(), '/api/v2/ws/gameplays');
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
      setStandbyMode(false);
      sessionReplaced = false;
      sessionConflict = false;
      detachPresenceHandlers();
      globalPresenceClient.disconnect();
      releaseLayoutPresence(false);
      globalGameplaysClient.disconnect();
      clearBootstrapSessionCache();
      session.clear();
      navigationHistory.reset();
      void goto(resolve('/login'));
    });
    const unsubscribeSessionRelease = onSessionTakeoverRequest((requesterTabId, requestId) => {
      if (requesterTabId === tabId) return;
      if (!presenceOwnerRelease && !gameplayOwnerRelease) return;
      pendingTakeoverRequesters.set(requestId, requesterTabId);
      broadcastTakeoverAck(tabId, requesterTabId, requestId);
    });
    const unsubscribeMessages = subscribeSessionMessages((message) => {
      if (message.type === 'takeover-confirmed' && message.ownerTabId === tabId) {
        if (pendingTakeoverRequesters.get(message.requestId) !== message.tabId) return;
        sessionReplaced = true;
        setStandbyMode(true);
        sessionConflict = false;
        sessionReplacedRef = true;
        isTakingOver = false;
        takeoverAttempt += 1;
        authError = '';
        void (async () => {
          const closeResults = await Promise.allSettled([
            globalPresenceClient.getOrCreate().disconnectAndWait(),
            globalGameplaysClient.getOrCreate().disconnectAndWait()
          ]);
          const closeFailure = closeResults.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          );
          if (closeFailure) throw closeFailure.reason;

          detachPresenceHandlers();
          releaseAllLocalLocks();
          globalPresenceClient.disconnect();
          globalGameplaysClient.disconnect();
          broadcastTakeoverReady(tabId, message.tabId, message.requestId);
        })().catch((error: unknown) => {
          sessionReplaced = false;
          sessionReplacedRef = false;
          setStandbyMode(false);
          console.error('[layout] failed to release session ownership', error);
        });
      } else if (
        message.type === 'takeover-failed' &&
        message.ownerTabId === tabId &&
        pendingTakeoverRequesters.get(message.requestId) === message.tabId
      ) {
        pendingTakeoverRequesters.delete(message.requestId);
        sessionReplaced = false;
        sessionReplacedRef = false;
        sessionConflict = false;
        void ensurePresence(true);
      } else if (
        (message.type === 'presence-owner' || message.type === 'gameplay-owner') &&
        message.tabId !== tabId
      ) {
        sessionConflict = true;
        setReadOnlyMode(true);
        sessionReplaced = false;
        beginTakeoverRequest();
      } else if (message.type === 'presence-list-request') {
        if (import.meta.env.DEV) {
          console.debug('[layout] presence-list-request received', {
            hasOwner: !!presenceOwnerRelease
          });
        }
        if (presenceOwnerRelease !== null && presenceClient?.isAlive()) {
          presenceClient.send('list_online_users');
        }
      } else if (message.type === 'presence-takeover' && message.tabId !== tabId) {
        standbyOwnerTabId = message.tabId;
      } else if (
        message.type === 'presence-release' &&
        message.tabId === standbyOwnerTabId &&
        isStandby
      ) {
        standbyOwnerTabId = null;
        sessionReplaced = false;
        sessionReplacedRef = false;
        sessionConflict = false;
        void ensurePresence(true);
      } else if (
        message.type === 'session-takeover-dismissed' &&
        message.tabId !== tabId &&
        (presenceOwnerRelease !== null || gameplayOwnerRelease !== null)
      ) {
        for (const [requestId, requesterTabId] of pendingTakeoverRequesters) {
          if (requesterTabId === message.tabId) pendingTakeoverRequesters.delete(requestId);
        }
        sessionConflict = false;
        sessionConflictPaths.clear();
        sessionRetryingPaths.clear();
        isRetryingSession = false;
      }
    });
    return () => {
      unsubscribe();
      unsubscribeSessionRelease();
      unsubscribeMessages();
      closeChannel();
    };
  });

  onDestroy(() => {
    layoutMounted = false;
    socketMonitorUnsubscribers.forEach((unsubscribe) => unsubscribe());
    socketMonitorUnsubscribers.length = 0;
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
      setStandbyMode(false);
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

  $effect(() => {
    const isInteractionBlocked = isStandby || sessionConflict;
    if (headerElement) headerElement.inert = isInteractionBlocked;
    if (mainElement) mainElement.inert = isInteractionBlocked;
  });
</script>

<svelte:head>
  <title>GameClient</title>
</svelte:head>

<div class="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-200">
  {#if isStandby}
    <SessionReplacedBanner />
  {/if}
  <header
    bind:this={headerElement}
    class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"
    inert={isStandby || sessionConflict}
  >
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
          disabled={isLeavingGame || isStandby || sessionConflict}
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
          disabled={isStandby || sessionConflict}
          class="rounded-full border border-[var(--neon-magenta)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-magenta)] transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95"
          data-testid="logout-button"
        >
          Logout
        </button>
      {/if}
      <ThemeToggle disabled={isStandby || sessionConflict} />
    </div>
  </header>
  {#if sessionConflict}
    <SessionConflictModal
      onTakeover={handleTakeover}
      onDismiss={handleConflictDismiss}
      {isTakingOver}
      isRetrying={isRetryingSession}
      {takeoverError}
    />
  {/if}
  <main
    bind:this={mainElement}
    class="mx-auto max-w-6xl px-6 pb-10"
    inert={isStandby || sessionConflict}
  >
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
