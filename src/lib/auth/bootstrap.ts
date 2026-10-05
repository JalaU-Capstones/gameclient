import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
import { authApi } from '$lib/api/auth';
import { httpClient } from '$lib/api/client';
import { globalGameplaysClient, globalPresenceClient, setLastPresenceToken } from '$lib/stores/ws';
import { session } from '$lib/stores/session';
import type { User } from '$lib/types/api';
import {
  acquireSessionLock,
  broadcastSessionRefreshed,
  getLastSessionRefreshAt
} from './sessionLock';

interface BootstrapResult {
  accessToken: string;
  user: User;
}

let inFlight: Promise<BootstrapResult> | null = null;
let localAccessToken = '';
let sessionGeneration = 0;

function ensureSessionGeneration(generation: number): void {
  if (generation !== sessionGeneration) {
    throw new ApiError('Session ended during authentication', 401);
  }
}

async function bootstrap(forceRefresh: boolean, generation: number): Promise<BootstrapResult> {
  const release = await acquireSessionLock();
  let lockReleased = false;
  const releaseLock = () => {
    if (lockReleased) return;
    lockReleased = true;
    release();
  };
  try {
    let user: User;
    let refreshedToken: string | null = null;
    try {
      if (import.meta.env.DEV) console.debug('[auth] bootstrap requesting current user');
      user = await httpClient.get<User>('/api/v2/auth/me');
      ensureSessionGeneration(generation);
    } catch (error) {
      if (!(error instanceof ApiError && error.isUnauthorized)) throw error;
      ensureSessionGeneration(generation);

      try {
        if (import.meta.env.DEV)
          console.debug('[auth] rechecking current user after lock contention');
        user = await httpClient.get<User>('/api/v2/auth/me');
        ensureSessionGeneration(generation);
      } catch (secondAttempt) {
        if (!(secondAttempt instanceof ApiError && secondAttempt.isUnauthorized)) {
          throw secondAttempt;
        }
        ensureSessionGeneration(generation);
        if (import.meta.env.DEV)
          console.debug('[auth] current user unauthorized after recheck; refreshing session');
        const { access_token } = await authApi.refresh();
        if (!access_token) throw new Error('No access token from refresh');
        ensureSessionGeneration(generation);
        refreshedToken = access_token;
        user = await httpClient.get<User>('/api/v2/auth/me');
        ensureSessionGeneration(generation);
      }
    }

    if (refreshedToken) {
      localAccessToken = refreshedToken;
      broadcastSessionRefreshed();
      if (import.meta.env.DEV) console.debug('[auth] refresh complete', !!refreshedToken);
      return { accessToken: refreshedToken, user };
    }

    const lastRefreshAt = getLastSessionRefreshAt();
    if (!forceRefresh && lastRefreshAt && Date.now() - lastRefreshAt < 30_000) {
      if (localAccessToken) return { accessToken: localAccessToken, user };

      releaseLock();
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.max(1, lastRefreshAt + 30_000 - Date.now()))
      );
      ensureSessionGeneration(generation);
      return bootstrap(forceRefresh, generation);
    }

    if (import.meta.env.DEV) console.debug('[auth] refreshing session');
    const { access_token } = await authApi.refresh();
    if (!access_token) throw new Error('No access token from refresh');
    ensureSessionGeneration(generation);
    localAccessToken = access_token;
    broadcastSessionRefreshed();
    if (import.meta.env.DEV) console.debug('[auth] refresh complete', !!access_token);
    return { accessToken: access_token, user };
  } finally {
    releaseLock();
  }
}

export function bootstrapSession(forceRefresh = false): Promise<BootstrapResult> {
  if (!inFlight) {
    const generation = sessionGeneration;
    inFlight = bootstrap(forceRefresh, generation)
      .then((result) => {
        ensureSessionGeneration(generation);
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function handleAuthFailure(
  error: unknown,
  onTransient?: (message: string) => void,
  redirectPath = '/lobby',
  failureMessage = 'Failed to connect to lobby.'
): void {
  if (import.meta.env.DEV) {
    console.debug('[auth] bootstrap failed', {
      name: error instanceof Error ? error.name : typeof error,
      status: error instanceof ApiError ? error.status : undefined,
      code: error instanceof ApiError ? error.code : undefined
    });
  }

  if (error instanceof ApiError && error.isUnauthorized) {
    globalPresenceClient.disconnect();
    globalGameplaysClient.disconnect();
    clearBootstrapSessionCache();
    session.clear();
    void goto(resolve(`/login?redirect=${encodeURIComponent(redirectPath)}`));
    return;
  }

  const message =
    error instanceof NetworkError || error instanceof TimeoutError
      ? 'Connection lost. Trying to reconnect…'
      : failureMessage;
  onTransient?.(message);
}

export function clearBootstrapSessionCache(): void {
  sessionGeneration += 1;
  localAccessToken = '';
  setLastPresenceToken(null);
}
