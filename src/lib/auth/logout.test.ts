import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  logout: vi.fn(),
  clear: vi.fn(),
  resetHistory: vi.fn(),
  goto: vi.fn(),
  resolve: vi.fn((path: string) => path),
  disconnectGameplays: vi.fn(),
  disconnectPresence: vi.fn(),
  broadcastLogout: vi.fn()
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
  resolve: mocks.resolve
}));

vi.mock('$lib/api/auth', () => ({
  authApi: {
    logout: mocks.logout
  }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: {
    play: mocks.play
  }
}));

vi.mock('$lib/navigation/history', () => ({
  navigationHistory: {
    reset: mocks.resetHistory
  }
}));

vi.mock('$lib/stores/session', () => ({
  session: {
    clear: mocks.clear
  }
}));

vi.mock('$lib/stores/ws', () => ({
  globalGameplaysClient: { disconnect: mocks.disconnectGameplays },
  globalPresenceClient: { disconnect: mocks.disconnectPresence },
  setLastPresenceToken: vi.fn()
}));

vi.mock('./sessionLock', () => ({
  broadcastLogout: mocks.broadcastLogout,
  acquireSessionLock: vi.fn(),
  broadcastSessionRefreshed: vi.fn(),
  getLastSessionRefreshAt: vi.fn()
}));

import { performLogout } from './logout';

describe('performLogout', () => {
  beforeEach(() => {
    mocks.play.mockReset();
    mocks.logout.mockReset();
    mocks.clear.mockReset();
    mocks.resetHistory.mockReset();
    mocks.goto.mockReset();
    mocks.resolve.mockImplementation((path: string) => path);
    mocks.goto.mockResolvedValue(undefined);
    mocks.disconnectGameplays.mockReset();
    mocks.disconnectPresence.mockReset();
    mocks.broadcastLogout.mockReset();
  });

  it('plays the click sound and logs the user out cleanly', async () => {
    mocks.logout.mockResolvedValue(undefined);

    await performLogout();

    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectGameplays).toHaveBeenCalledOnce();
    expect(mocks.disconnectPresence).toHaveBeenCalledOnce();
    expect(mocks.disconnectGameplays.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.logout.mock.invocationCallOrder[0]
    );
    expect(mocks.disconnectPresence.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.logout.mock.invocationCallOrder[0]
    );
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastLogout).toHaveBeenCalledOnce();
    expect(mocks.resetHistory).toHaveBeenCalledTimes(1);
    expect(mocks.goto).toHaveBeenCalledWith('/login');
  });

  it('still clears the session and redirects when the backend logout fails', async () => {
    mocks.logout.mockRejectedValue(new Error('boom'));

    await performLogout();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastLogout).toHaveBeenCalledOnce();
    expect(mocks.disconnectGameplays).toHaveBeenCalledOnce();
    expect(mocks.disconnectPresence).toHaveBeenCalledOnce();
    expect(mocks.resetHistory).toHaveBeenCalledTimes(1);
    expect(mocks.goto).toHaveBeenCalledWith('/login');
  });

  it('continues logout when both WebSocket disconnects throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.disconnectGameplays.mockImplementation(() => {
      throw new Error('gameplay disconnected');
    });
    mocks.disconnectPresence.mockImplementation(() => {
      throw new Error('presence disconnected');
    });
    mocks.logout.mockRejectedValue(new Error('backend unavailable'));

    await expect(performLogout()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.resetHistory).toHaveBeenCalledOnce();
    expect(mocks.goto).toHaveBeenCalledWith('/login');
    warn.mockRestore();
  });
});
