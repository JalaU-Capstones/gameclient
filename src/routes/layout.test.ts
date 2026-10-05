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
  sessionMessageHandlers: new Set<(message: { type: string }) => void>(),
  presenceHandlers: new Map<string, (payload?: unknown) => void>(),
  presenceAlive: false,
  presenceConnect: vi.fn(),
  presenceSend: vi.fn(),
  claimPresenceOwnership: vi.fn(),
  claimGameplayOwnership: vi.fn(),
  releaseGameplayOwnership: vi.fn(),
  setPresenceReconnectRequest: vi.fn(),
  requestPresenceReconnect: vi.fn(),
  presenceReconnectRequest: null as (() => void) | null,
  broadcastPresenceUsers: vi.fn(),
  bootstrap: vi.fn(),
  presenceDisconnect: vi.fn(),
  gameplayDisconnect: vi.fn(),
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
  },
  presenceClient: {
    isAlive: () => mocks.presenceAlive,
    connect: vi.fn(),
    send: vi.fn(),
    on: vi.fn()
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

vi.mock('$lib/auth/bootstrap', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/auth/bootstrap')>();
  return { ...original, bootstrapSession: mocks.bootstrap };
});

vi.mock('$lib/auth/sessionLock', () => ({
  openSessionChannel: vi.fn(() => vi.fn()),
  createTabId: vi.fn(() => 'tab-test'),
  claimPresenceOwnership: mocks.claimPresenceOwnership,
  claimGameplayOwnership: mocks.claimGameplayOwnership,
  releasePresenceOwnership: vi.fn(),
  releaseGameplayOwnership: mocks.releaseGameplayOwnership,
  announcePresenceRelease: vi.fn(),
  broadcastPresenceUsers: mocks.broadcastPresenceUsers,
  broadcastLogout: vi.fn(),
  onRemoteLogout: (handler: () => void) => {
    const callback = (message: { type: string }) => {
      if (message.type === 'logout') handler();
    };
    mocks.sessionMessageHandlers.add(callback);
    return () => mocks.sessionMessageHandlers.delete(callback);
  },
  subscribeSessionMessages: (handler: (message: { type: string }) => void) => {
    mocks.sessionMessageHandlers.add(handler);
    return () => mocks.sessionMessageHandlers.delete(handler);
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
  globalGameplaysClient: {
    getOrCreate: () => mocks.gameplayClient,
    disconnect: mocks.gameplayDisconnect
  },
  globalPresenceClient: {
    getOrCreate: () => mocks.presenceClient,
    disconnect: mocks.presenceDisconnect
  },
  requestPresenceReconnect: mocks.requestPresenceReconnect,
  setLastPresenceToken: vi.fn(),
  setPresenceReconnectRequest: mocks.setPresenceReconnectRequest
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
    mocks.sessionMessageHandlers.clear();
    mocks.gameplayClient.send.mockReset();
    mocks.gameplayClient.on.mockClear();
    mocks.bootstrap.mockReset().mockImplementation(async () => {
      const user = await mocks.get('/api/v2/auth/me');
      return { user, accessToken: 'access-token' };
    });
    mocks.presenceDisconnect.mockReset();
    mocks.presenceDisconnect.mockImplementation(() => {
      mocks.presenceAlive = false;
    });
    mocks.gameplayDisconnect.mockReset();
    mocks.presenceHandlers.clear();
    mocks.broadcastPresenceUsers.mockReset();
    mocks.presenceClient.connect.mockReset().mockImplementation(() => {
      mocks.presenceAlive = true;
      mocks.presenceConnect();
    });
    mocks.presenceClient.on.mockReset().mockImplementation((event, handler) => {
      mocks.presenceHandlers.set(event, handler);
      return () => mocks.presenceHandlers.delete(event);
    });
    mocks.presenceClient.send.mockReset().mockImplementation((...args) => {
      mocks.presenceSend(...args);
    });
    mocks.presenceConnect.mockReset().mockImplementation(() => {
      mocks.presenceAlive = true;
    });
    mocks.presenceSend.mockReset();
    mocks.presenceAlive = false;
    mocks.claimPresenceOwnership.mockReset().mockResolvedValue(vi.fn());
    mocks.claimGameplayOwnership.mockReset().mockResolvedValue(vi.fn());
    mocks.releaseGameplayOwnership.mockReset();
    mocks.presenceReconnectRequest = null;
    mocks.requestPresenceReconnect.mockReset().mockImplementation(() => {
      mocks.presenceReconnectRequest?.();
    });
    mocks.setPresenceReconnectRequest.mockReset().mockImplementation((request) => {
      mocks.presenceReconnectRequest = request;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates the session through the shared bootstrap helper', async () => {
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

    expect(mocks.bootstrap).toHaveBeenCalledOnce();
    expect(session).toBeDefined();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('owns presence in the layout and requests the online list after auth_ok', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    expect(mocks.claimPresenceOwnership).toHaveBeenCalledOnce();
    mocks.presenceHandlers.get('auth_ok')?.();
    expect(mocks.presenceSend).toHaveBeenCalledWith('list_online_users');
    mocks.presenceHandlers.get('online_users')?.({ users: ['other-user'] });
    expect(mocks.broadcastPresenceUsers).toHaveBeenCalledWith(['other-user']);

    publishNavigation('/game/game-1');
    expect(mocks.presenceDisconnect).not.toHaveBeenCalled();
  });

  it('reconnects the owned presence client when the visible tab has a dead socket', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceAlive = false;
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledTimes(2));
  });

  it('clears the session and redirects to /login when /auth/me returns 401', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.bootstrap.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Flobby'));
    expect(warning).not.toHaveBeenCalled();
  });

  it('unlocks audio on the first pointer or keyboard interaction only once', async () => {
    mocks.bootstrap.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(Layout, { props: { children: stubChild } });

    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
  });

  it('preserves the intended destination when redirecting an unauthenticated user', async () => {
    currentPath = '/history';
    mocks.bootstrap.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Fhistory'));
  });

  it('redirects the root route to login without a return destination', async () => {
    currentPath = '/';
    mocks.bootstrap.mockRejectedValue(new ApiError('Unauthorized', 401));

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

    await waitFor(() => expect(mocks.bootstrap).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/history'));
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('clears the session and redirects when another tab broadcasts logout', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    render(Layout, { props: { children: stubChild } });

    mocks.sessionMessageHandlers.forEach((handler) => handler({ type: 'logout' }));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login'));
    expect(mocks.presenceDisconnect).toHaveBeenCalledOnce();
    expect(mocks.gameplayDisconnect).toHaveBeenCalledOnce();
    let currentUser: string | null = '1';
    const unsubscribe = session.subscribe((state) => {
      currentUser = state.user?.id ?? null;
    });
    unsubscribe();
    expect(currentUser).toBeNull();
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
