import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  logout: vi.fn(),
  clear: vi.fn(),
  resetHistory: vi.fn(),
  goto: vi.fn(),
  resolve: vi.fn((path: string) => path)
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
  });

  it('plays the click sound and logs the user out cleanly', async () => {
    mocks.logout.mockResolvedValue(undefined);

    await performLogout();

    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.resetHistory).toHaveBeenCalledTimes(1);
    expect(mocks.goto).toHaveBeenCalledWith('/login');
  });

  it('still clears the session and redirects when the backend logout fails', async () => {
    mocks.logout.mockRejectedValue(new Error('boom'));

    await performLogout();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.resetHistory).toHaveBeenCalledTimes(1);
    expect(mocks.goto).toHaveBeenCalledWith('/login');
  });
});
