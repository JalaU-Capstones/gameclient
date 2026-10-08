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
  broadcastLogout,
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

async function refreshAccessToken(generation: number): Promise<string> {
  let accessToken: string;
  try {
    ({ access_token: accessToken } = await authApi.refresh());
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      throw new ApiError('Session ended during authentication', 401, error.code);
    }
    throw error;
  }
  if (!accessToken) throw new Error('No access token from refresh');
  ensureSessionGeneration(generation);
  localAccessToken = accessToken;
  broadcastSessionRefreshed();
  if (import.meta.env.DEV) console.debug('[auth] refresh complete', !!accessToken);
  return accessToken;
}

async function bootstrap(generation: number): Promise<BootstrapResult> {
  const release = await acquireSessionLock();
  let lockReleased = false;
  const releaseLock = () => {
    if (lockReleased) return;
    lockReleased = true;
    release();
  };
  try {
    let user: User;
    try {
      if (import.meta.env.DEV) console.debug('[auth] bootstrap requesting current user');
      user = await httpClient.get<User>('/api/v2/auth/me');
      ensureSessionGeneration(generation);
    } catch (error) {
      if (!(error instanceof ApiError && error.isUnauthorized)) throw error;
      ensureSessionGeneration(generation);

      try {
        if (import.meta.env.DEV) console.debug('[auth] delaying before current-user retry');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
        ensureSessionGeneration(generation);
        if (import.meta.env.DEV) console.debug('[auth] retrying current user after lock wait');
        user = await httpClient.get<User>('/api/v2/auth/me');
        ensureSessionGeneration(generation);
      } catch (secondAttempt) {
        if (!(secondAttempt instanceof ApiError && secondAttempt.isUnauthorized)) {
          throw secondAttempt;
        }
        ensureSessionGeneration(generation);
        if (import.meta.env.DEV) console.debug('[auth] current user unauthorized after retry');
        const accessToken = await refreshAccessToken(generation);
        user = await httpClient.get<User>('/api/v2/auth/me');
        ensureSessionGeneration(generation);
        return { accessToken, user };
      }
    }

    if (localAccessToken) return { accessToken: localAccessToken, user };

    const lastRefreshAt = getLastSessionRefreshAt();
    if (lastRefreshAt && Date.now() - lastRefreshAt < 30_000) {
      releaseLock();
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.max(1, lastRefreshAt + 30_000 - Date.now()))
      );
      ensureSessionGeneration(generation);
      return bootstrap(generation);
    }

    if (import.meta.env.DEV)
      console.debug('[auth] requesting WebSocket token for authenticated session');
    const accessToken = await refreshAccessToken(generation);
    return { accessToken, user };
  } finally {
    releaseLock();
  }
}

export function bootstrapSession(): Promise<BootstrapResult> {
  if (!inFlight) {
    const generation = sessionGeneration;
    const request = bootstrap(generation).then((result) => {
      ensureSessionGeneration(generation);
      return result;
    });
    const trackedRequest = request.finally(() => {
      if (inFlight === trackedRequest) inFlight = null;
    });
    inFlight = trackedRequest;
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
    broadcastLogout();
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
  inFlight = null;
  setLastPresenceToken(null);
}
