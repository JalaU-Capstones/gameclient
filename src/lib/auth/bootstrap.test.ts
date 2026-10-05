import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  refresh: vi.fn(),
  broadcastLogout: vi.fn()
}));

vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
vi.mock('$lib/api/auth', () => ({ authApi: { refresh: mocks.refresh } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('./sessionLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionLock')>()),
  broadcastLogout: mocks.broadcastLogout
}));
vi.mock('$lib/stores/ws', () => ({
  globalPresenceClient: { disconnect: vi.fn() },
  globalGameplaysClient: { disconnect: vi.fn() },
  setLastPresenceToken: vi.fn()
}));

import { bootstrapSession, clearBootstrapSessionCache } from './bootstrap';
import { session } from '$lib/stores/session';
import { broadcastSessionRefreshed, openSessionChannel } from './sessionLock';
import { ApiError, NetworkError } from '$lib/api/errors';

const user = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};

describe('bootstrapSession', () => {
  let closeChannel: (() => void) | undefined;
  let testTime = Date.now();

  beforeEach(() => {
    closeChannel?.();
    closeChannel = openSessionChannel();
    clearBootstrapSessionCache();
    testTime += 31_000;
    vi.spyOn(Date, 'now').mockReturnValue(testTime);
    session.reset();
    mocks.get.mockReset().mockResolvedValue(user);
    mocks.refresh.mockReset().mockResolvedValue({ access_token: 'access-token' });
    mocks.broadcastLogout.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeChannel?.();
    closeChannel = undefined;
    vi.restoreAllMocks();
  });

  it('deduplicates parallel bootstrap calls and refreshes once', async () => {
    let resolveUser!: (value: typeof user) => void;
    mocks.get.mockReturnValue(
      new Promise<typeof user>((resolve) => {
        resolveUser = resolve;
      })
    );

    const first = bootstrapSession();
    const second = bootstrapSession();
    resolveUser(user);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessToken: 'access-token', user },
      { accessToken: 'access-token', user }
    ]);
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('refreshes and retries /me when the initial request is unauthorized', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError('Unauthorized', 401)).mockResolvedValueOnce(user);

    const result = await bootstrapSession();

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ accessToken: 'access-token', user });
  });

  it('runs one refresh for concurrent bootstrap calls recovering from unauthorized /me', async () => {
    let attempts = 0;
    mocks.get.mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) throw new ApiError('Unauthorized', 401);
      return user;
    });

    const results = await Promise.all([bootstrapSession(), bootstrapSession()]);

    expect(results).toEqual([
      { accessToken: 'access-token', user },
      { accessToken: 'access-token', user }
    ]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it('uses the successful refresh token on a later /me check without refreshing again', async () => {
    await expect(bootstrapSession()).resolves.toEqual({
      accessToken: 'access-token',
      user
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();

    mocks.get.mockClear().mockResolvedValue(user);
    await expect(bootstrapSession()).resolves.toEqual({
      accessToken: 'access-token',
      user
    });

    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('does not broadcast logout for a transient bootstrap error', async () => {
    mocks.get.mockRejectedValue(new NetworkError());

    await expect(bootstrapSession()).rejects.toBeInstanceOf(NetworkError);

    expect(mocks.broadcastLogout).not.toHaveBeenCalled();
  });

  it('throws an unauthorized ApiError when refresh is unauthorized', async () => {
    mocks.get
      .mockRejectedValueOnce(new ApiError('Unauthorized', 401))
      .mockRejectedValueOnce(new ApiError('Unauthorized', 401));
    mocks.refresh.mockRejectedValueOnce(new ApiError('Unauthorized', 401));

    await expect(bootstrapSession()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401
    });
    expect(mocks.broadcastLogout).not.toHaveBeenCalled();
  });

  it('aborts an in-flight refresh after the session cache is cleared', async () => {
    let finishRefresh!: (value: { access_token: string }) => void;
    mocks.refresh.mockReturnValue(
      new Promise<{ access_token: string }>((resolve) => {
        finishRefresh = resolve;
      })
    );
    const pending = bootstrapSession();

    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    clearBootstrapSessionCache();
    finishRefresh({ access_token: 'discarded-access-token' });

    await expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      status: 401
    });
  });

  it('waits for a recent refresh from another tab before refreshing without a local token', async () => {
    vi.useFakeTimers({ now: testTime });
    vi.spyOn(Date, 'now').mockRestore();
    vi.setSystemTime(testTime);
    broadcastSessionRefreshed(testTime);

    const result = bootstrapSession();
    await vi.advanceTimersByTimeAsync(75);
    expect(mocks.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toEqual({ accessToken: 'access-token', user });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
