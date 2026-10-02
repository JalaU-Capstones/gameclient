import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  setUser: vi.fn(),
  clear: vi.fn(),
  goto: vi.fn(),
  resolve: (path: string) => path
}));

vi.mock('$lib/api/client', () => ({
  httpClient: { get: mocks.get }
}));

vi.mock('$lib/stores/session', () => ({
  session: {
    setUser: mocks.setUser,
    clear: mocks.clear
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
  resolve: mocks.resolve
}));

describe('Root page', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.setUser.mockReset();
    mocks.clear.mockReset();
    mocks.goto.mockReset();
    mocks.resolve = (path: string) => path;
  });

  it('sets the current user and redirects to the lobby when authenticated', async () => {
    const user = {
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    };
    mocks.get.mockResolvedValue(user);

    render(Page);

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/lobby'));
    expect(mocks.get).toHaveBeenCalledWith('/api/v2/auth/me');
    expect(mocks.setUser).toHaveBeenCalledWith(user);
  });

  it('clears the session and redirects to login when unauthenticated', async () => {
    mocks.get.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(Page);

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login'));
    expect(mocks.clear).toHaveBeenCalledOnce();
  });
});
