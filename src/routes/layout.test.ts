import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Snippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationHistory } from '$lib/navigation/history';
import { ApiError } from '$lib/api/errors';
import Layout from './+layout.svelte';
import LoginLayoutHarness from '../tests/harnesses/LoginLayoutHarness.svelte';
import { session } from '$lib/stores/session';

interface PageSnapshot {
  url: {
    pathname: string;
    search: string;
    searchParams: URLSearchParams;
  };
  params: { id?: string };
}

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  goto: vi.fn(),
  resolve: vi.fn((path: string) => path),
  login: vi.fn(),
  logout: vi.fn(),
  play: vi.fn(),
  unlock: vi.fn(),
  afterNavigateCallbacks: [] as Array<
    (navigation: { to: { url: { pathname: string } } | null }) => void
  >,
  subscribers: [] as Array<(value: PageSnapshot) => void>,
  gameplayConnected: false,
  gameplayHandlers: new Map<string, (payload?: unknown) => void>(),
  gameplayClient: {
    state: {
      subscribe: (fn: (value: string) => void) => {
        fn(mocks.gameplayConnected ? 'connected' : 'disconnected');
        return () => {};
      }
    },
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      mocks.gameplayHandlers.set(event, handler);
      return () => mocks.gameplayHandlers.delete(event);
    }),
    send: vi.fn()
  }
}));

const stubChild = (() => 'content') as unknown as Snippet;

let currentPath = '/lobby';
let currentSearch = '';

function getPageSnapshot(): PageSnapshot {
  return {
    url: {
      pathname: currentPath,
      search: currentSearch,
      searchParams: new URLSearchParams(currentSearch)
    },
    params: { id: currentPath.split('/')[2] }
  };
}

function publishPage() {
  for (const subscriber of mocks.subscribers) {
    subscriber(getPageSnapshot());
  }
}

function publishNavigation(pathname: string) {
  currentPath = pathname;
  currentSearch = '';
  publishPage();
  for (const callback of mocks.afterNavigateCallbacks) {
    callback({ to: { url: { pathname } } });
  }
}

function mockNavigation() {
  mocks.goto.mockImplementation(async (target: string) => {
    const url = new URL(target, 'http://localhost');
    currentPath = url.pathname;
    currentSearch = url.search;
    publishPage();
    for (const callback of mocks.afterNavigateCallbacks) {
      callback({ to: { url: { pathname: url.pathname } } });
    }
  });
}

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (value: PageSnapshot) => void) => {
      mocks.subscribers.push(fn);
      fn(getPageSnapshot());
      return () => {
        const subscriberIndex = mocks.subscribers.indexOf(fn);
        if (subscriberIndex !== -1) mocks.subscribers.splice(subscriberIndex, 1);
      };
    }
  }
}));

vi.mock('$lib/api/client', () => ({
  httpClient: {
    get: mocks.get
  }
}));

vi.mock('$lib/api/auth', () => ({
  authApi: {
    login: mocks.login,
    logout: mocks.logout
  }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: {
    unlock: mocks.unlock,
    play: mocks.play
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
  afterNavigate: (callback: (navigation: { to: { url: { pathname: string } } | null }) => void) => {
    mocks.afterNavigateCallbacks.push(callback);
  }
}));

vi.mock('$app/paths', () => ({
  resolve: mocks.resolve
}));

vi.mock('$lib/stores/ws', () => ({
  globalGameplaysClient: { getOrCreate: () => mocks.gameplayClient }
}));

describe('layout auth guard', () => {
  beforeEach(() => {
    currentPath = '/lobby';
    currentSearch = '';
    mocks.subscribers.length = 0;
    mocks.afterNavigateCallbacks.length = 0;
    session.reset();
    navigationHistory.reset();
    mocks.get.mockReset();
    mocks.goto.mockReset();
    mocks.login.mockReset();
    mocks.logout.mockReset();
    mocks.play.mockReset();
    mocks.resolve.mockImplementation((path: string) => path);
    mocks.unlock.mockReset();
    mocks.gameplayConnected = false;
    mocks.gameplayHandlers.clear();
    mocks.gameplayClient.send.mockReset();
    mocks.gameplayClient.on.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.get.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Flobby'));
    expect(warning).not.toHaveBeenCalled();
  });

  it('unlocks audio on the first pointer or keyboard interaction only once', async () => {
    mocks.get.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(Layout, { props: { children: stubChild } });

    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
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

  it.each([
    ['/login', '', '/lobby'],
    ['/login', '?redirect=%2Fhistory', '/history'],
    ['/login', '?redirect=https%3A%2F%2Fevil.com', '/lobby'],
    ['/register', '', '/lobby']
  ])(
    'redirects an authenticated user at %s%s to %s without clearing the session',
    async (path, search, destination) => {
      currentPath = path;
      currentSearch = search;
      const clearSpy = vi.spyOn(session, 'clear');
      session.setUser({
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      });

      render(Layout, { props: { children: stubChild } });

      await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(destination));
      expect(clearSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('logout-button')).toBeInTheDocument();
      let currentUser: string | null = null;
      const unsubscribe = session.subscribe((state) => {
        currentUser = state.user?.id ?? null;
      });
      unsubscribe();
      expect(currentUser).toBe('1');
    }
  );

  it('hydrates an existing session on public routes and honors its redirect destination', async () => {
    currentPath = '/login';
    currentSearch = '?redirect=%2Fhistory';
    mocks.get.mockResolvedValue({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/v2/auth/me'));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/history'));
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('renders the logout button while an authenticated user is on the login page', () => {
    currentPath = '/login';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
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

  it('returns to the previous protected route and hides the back button', async () => {
    currentPath = '/lobby';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    publishNavigation('/lobby');
    publishNavigation('/history');
    await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());

    mockNavigation();
    await fireEvent.click(screen.getByTestId('back-button'));

    await waitFor(() => expect(currentPath).toBe('/lobby'));
    expect(mocks.goto).toHaveBeenCalledWith('/lobby');
    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
  });

  it('sends leave_game and waits for game_ended before navigating back', async () => {
    currentPath = '/lobby';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    mocks.gameplayConnected = true;
    render(Layout, { props: { children: stubChild } });

    publishNavigation('/lobby');
    publishNavigation('/game/game-123');
    await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('back-button'));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('leave_game', { game_id: 'game-123' });
    expect(mocks.goto).not.toHaveBeenCalled();

    mocks.gameplayHandlers.get('game_ended')?.({ game_id: 'game-123' });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/lobby'));
  });

  it('resets history on logout and allows back navigation after a fresh login', async () => {
    currentPath = '/lobby';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    mocks.logout.mockResolvedValue(undefined);

    render(Layout, { props: { children: stubChild } });

    publishNavigation('/lobby');
    publishNavigation('/history');
    await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());

    mockNavigation();
    await userEvent.setup().click(screen.getByTestId('logout-button'));

    await waitFor(() => expect(currentPath).toBe('/login'));
    expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
    let entries: string[] = [];
    const unsubscribe = navigationHistory.subscribe((current) => {
      entries = current;
    });
    unsubscribe();
    expect(entries).toEqual([]);

    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    publishNavigation('/lobby');
    publishNavigation('/game/xyz');
    await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());

    await userEvent.setup().click(screen.getByTestId('back-button'));

    await waitFor(() => expect(currentPath).toBe('/lobby'));
    expect(mocks.goto).toHaveBeenCalledWith('/lobby');
    expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
  });

  it('keeps a successful login on the intended destination', async () => {
    currentPath = '/login';
    currentSearch = '?redirect=%2Fhistory';
    mocks.get.mockRejectedValue({ status: 401, isUnauthorized: true });
    mocks.login.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: {
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      }
    });
    mocks.goto.mockImplementation(async (target: string) => {
      const url = new URL(target, 'http://localhost');
      currentPath = url.pathname;
      currentSearch = url.search;
      publishPage();
    });
    const clearSpy = vi.spyOn(session, 'clear');
    const user = userEvent.setup();
    render(LoginLayoutHarness);

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/v2/auth/me'));
    clearSpy.mockClear();
    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(currentPath).toBe('/history'));
    expect(mocks.goto).toHaveBeenCalledWith('/history');
    expect(mocks.goto).not.toHaveBeenCalledWith('/lobby');
    expect(clearSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });
});
