import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Snippet } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './+layout.svelte';
import { session } from '$lib/stores/session';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  goto: vi.fn(),
  resolve: vi.fn((path: string) => path),
  unlock: vi.fn(),
  performLogout: vi.fn(),
  page: { pathname: '/lobby' }
}));

const stubChild = (() => 'content') as unknown as Snippet;

let currentPath = '/lobby';
let currentSearch = '';

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (value: { url: { pathname: string; search: string } }) => void) => {
      fn({ url: { pathname: currentPath, search: currentSearch } });
      return () => {};
    }
  }
}));

vi.mock('$lib/api/client', () => ({
  httpClient: {
    get: mocks.get
  }
}));

vi.mock('$lib/auth/logout', () => ({
  performLogout: mocks.performLogout
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: {
    unlock: mocks.unlock,
    play: vi.fn()
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
  resolve: mocks.resolve
}));

describe('layout auth guard', () => {
  beforeEach(() => {
    currentPath = '/lobby';
    currentSearch = '';
    session.reset();
    mocks.get.mockReset();
    mocks.goto.mockReset();
    mocks.resolve.mockImplementation((path: string) => path);
    mocks.performLogout.mockReset();
    mocks.unlock.mockReset();
  });

  it('hydrates the session when /auth/me succeeds', async () => {
    const user = {
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    };
    mocks.get.mockResolvedValue(user);

    render(Layout, { props: { children: stubChild } });

    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.get).toHaveBeenCalledWith('/api/v2/auth/me');
    expect(session).toBeDefined();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('clears the session and redirects to /login when /auth/me returns 401', async () => {
    mocks.get.mockRejectedValue({ status: 401, isUnauthorized: true });

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Flobby'));
  });

  it('preserves the intended destination when redirecting an unauthenticated user', async () => {
    currentPath = '/history';
    mocks.get.mockRejectedValue({ status: 401, isUnauthorized: true });

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Fhistory'));
  });

  it('redirects the root route to login without a return destination', async () => {
    currentPath = '/';
    mocks.get.mockRejectedValue({ status: 401, isUnauthorized: true });

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login'));
  });

  it('skips the hydration check on public routes', async () => {
    currentPath = '/login';
    render(Layout, { props: { children: stubChild } });

    await Promise.resolve();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('does not render the logout button on the login page', () => {
    currentPath = '/login';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    expect(screen.queryByTestId('logout-button')).not.toBeInTheDocument();
  });

  it('renders the logout button on protected routes for authenticated users', () => {
    currentPath = '/lobby';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('calls performLogout when the logout button is clicked', async () => {
    currentPath = '/lobby';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    await fireEvent.click(screen.getByTestId('logout-button'));

    expect(mocks.performLogout).toHaveBeenCalledTimes(1);
  });
});
