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
  takeoverSession: vi.fn(),
  broadcastSessionTakeoverRequest: vi.fn(),
  broadcastTakeoverAck: vi.fn(),
  broadcastTakeoverConfirmed: vi.fn(),
  broadcastTakeoverReady: vi.fn(),
  broadcastTakeoverFailed: vi.fn(),
  broadcastSessionTakeoverDismissed: vi.fn(),
  play: vi.fn(),
  unlock: vi.fn(),
  afterNavigateCallbacks: [] as Array<
    (navigation: { to: { url: { pathname: string } } | null }) => void
  >,
  subscribers: [] as Array<(value: PageSnapshot) => void>,
  gameplayConnected: false,
  gameplayHandlers: new Map<string, (payload?: unknown) => void>(),
  sessionMessageHandlers: new Set<
    (message: {
      type: string;
      tabId?: string;
      requesterTabId?: string;
      ownerTabId?: string;
      requestId?: string;
    }) => void
  >(),
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
  standbyMode: (() => {
    let value = false;
    const subscribers = new Set<(nextValue: boolean) => void>();
    return {
      subscribe: (subscriber: (nextValue: boolean) => void) => {
        subscriber(value);
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      },
      set: (nextValue: boolean) => {
        value = nextValue;
        subscribers.forEach((subscriber) => subscriber(value));
      }
    };
  })(),
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
    isAlive: () => mocks.gameplayConnected,
    connect: vi.fn(),
    disconnectAndWait: vi.fn(async () => undefined),
    setReadOnlyMode: vi.fn(),
    send: vi.fn()
  },
  presenceClient: {
    state: {
      subscribe: (fn: (value: string) => void) => {
        fn(mocks.presenceAlive ? 'connected' : 'disconnected');
        return () => {};
      }
    },
    isAlive: () => mocks.presenceAlive,
    connect: vi.fn(),
    disconnectAndWait: vi.fn(async () => undefined),
    setReadOnlyMode: vi.fn(),
    send: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      mocks.presenceHandlers.set(event, handler);
      return () => mocks.presenceHandlers.delete(event);
    })
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
  broadcastSessionTakeoverDismissed: mocks.broadcastSessionTakeoverDismissed,
  broadcastLogout: vi.fn(),
  broadcastSessionTakeoverRequest: mocks.broadcastSessionTakeoverRequest,
  broadcastTakeoverAck: mocks.broadcastTakeoverAck,
  broadcastTakeoverConfirmed: mocks.broadcastTakeoverConfirmed,
  broadcastTakeoverReady: mocks.broadcastTakeoverReady,
  broadcastTakeoverFailed: mocks.broadcastTakeoverFailed,
  onSessionTakeoverRequest: (handler: (requesterTabId: string, requestId: string) => void) => {
    const callback = (message: {
      type: string;
      tabId?: string;
      requesterTabId?: string;
      ownerTabId?: string;
      requestId?: string;
    }) => {
      if (message.type === 'session-takeover-request' && message.tabId && message.requestId) {
        handler(message.tabId, message.requestId);
      }
    };
    mocks.sessionMessageHandlers.add(callback);
    return () => mocks.sessionMessageHandlers.delete(callback);
  },
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
    logout: mocks.logout,
    takeoverSession: mocks.takeoverSession
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
    disconnect: mocks.gameplayDisconnect,
    setReadOnlyMode: mocks.gameplayClient.setReadOnlyMode
  },
  globalPresenceClient: {
    getOrCreate: () => mocks.presenceClient,
    disconnect: mocks.presenceDisconnect,
    setReadOnlyMode: mocks.presenceClient.setReadOnlyMode
  },
  requestPresenceReconnect: mocks.requestPresenceReconnect,
  setLastPresenceToken: vi.fn(),
  setPresenceReconnectRequest: mocks.setPresenceReconnectRequest,
  standbyMode: mocks.standbyMode
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
    mocks.takeoverSession.mockReset().mockResolvedValue(undefined);
    mocks.broadcastSessionTakeoverRequest
      .mockReset()
      .mockImplementation((requesterTabId, requestId) => {
        [...mocks.sessionMessageHandlers].forEach((handler) =>
          handler({
            type: 'takeover-ack',
            tabId: 'active-tab',
            requesterTabId,
            requestId
          })
        );
      });
    mocks.broadcastTakeoverAck.mockReset();
    mocks.broadcastTakeoverConfirmed
      .mockReset()
      .mockImplementation((requesterTabId, ownerTabId, requestId) => {
        [...mocks.sessionMessageHandlers].forEach((handler) =>
          handler({
            type: 'takeover-ready',
            tabId: ownerTabId,
            requesterTabId,
            requestId
          })
        );
      });
    mocks.broadcastTakeoverReady.mockReset();
    mocks.broadcastTakeoverFailed.mockReset();
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
    mocks.presenceClient.disconnectAndWait.mockReset().mockResolvedValue(undefined);
    mocks.gameplayClient.disconnectAndWait.mockReset().mockResolvedValue(undefined);
    mocks.broadcastSessionTakeoverDismissed.mockReset();
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
    mocks.standbyMode.set(false);
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

  it.each(['presence', 'gameplay'])(
    'shows the conflict modal and stops presence retries after a %s session conflict',
    async (socket) => {
      session.setUser({
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      });

      render(Layout, { props: { children: stubChild } });
      await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());

      const closeHandler =
        socket === 'presence'
          ? mocks.presenceHandlers.get('closed')
          : mocks.gameplayHandlers.get('closed');
      expect(closeHandler).toBeDefined();
      closeHandler?.({ code: 4409, reason: 'session_already_active' });

      expect(await screen.findByRole('dialog')).toHaveTextContent('Session already active');
      mocks.presenceAlive = false;
      fireEvent(document, new Event('visibilitychange'));

      expect(mocks.presenceConnect).toHaveBeenCalledOnce();
    }
  );

  it('shows a takeover choice when another tab owns the session without releasing it', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'presence-owner', tabId: 'original-tab' })
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent('Session already active');
    expect(mocks.broadcastSessionTakeoverRequest).toHaveBeenCalledWith(
      'tab-test',
      expect.any(String)
    );
    expect(screen.getByRole('main')).toHaveProperty('inert', true);
    expect(mocks.presenceClient.setReadOnlyMode).toHaveBeenCalledWith(true);
    expect(mocks.gameplayClient.setReadOnlyMode).toHaveBeenCalledWith(true);
    expect(mocks.presenceDisconnect).not.toHaveBeenCalled();
    expect(mocks.gameplayDisconnect).not.toHaveBeenCalled();
    expect(mocks.takeoverSession).not.toHaveBeenCalled();
  });

  it('shows the standby message without connection alerts when the session is replaced', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceHandlers.get('closed')?.({ code: 4409, reason: 'session_replaced' });

    const banner = await screen.findByTestId('standby-message');
    expect(banner).toHaveTextContent('Session active in another tab. Actions are disabled here.');
    expect(screen.queryByText('Connection lost. Reconnecting…')).not.toBeInTheDocument();
  });

  it('lets the user dismiss into standby without logging out or interrupting the original tab', async () => {
    const user = userEvent.setup();
    mocks.logout.mockResolvedValue(undefined);
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceHandlers.get('closed')?.({
      code: 4409,
      reason: 'session_already_active',
      path: '/api/v2/ws/presence'
    });
    mocks.claimGameplayOwnership.mockReturnValueOnce(new Promise(() => {}));
    expect(await screen.findByRole('button', { name: 'Continue here' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stay in original tab' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Stay in original tab' }));

    expect(await screen.findByTestId('standby-message')).toHaveTextContent(
      'Session active in another tab. Actions are disabled here.'
    );
    expect(screen.getByRole('banner')).toHaveProperty('inert', true);
    expect(screen.getByRole('main')).toHaveProperty('inert', true);
    expect(screen.getByTestId('logout-button')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeDisabled();
    expect(mocks.broadcastSessionTakeoverDismissed).toHaveBeenCalledWith('tab-test');
    expect(mocks.presenceClient.setReadOnlyMode).toHaveBeenCalledWith(true);
    expect(mocks.gameplayClient.setReadOnlyMode).toHaveBeenCalledWith(true);
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the owner tab active when another tab dismisses takeover', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'session-takeover-dismissed', tabId: 'other-tab' })
    );

    expect(mocks.presenceDisconnect).not.toHaveBeenCalled();
    expect(mocks.gameplayDisconnect).not.toHaveBeenCalled();
    expect(mocks.presenceClient.setReadOnlyMode).not.toHaveBeenCalledWith(true);
    expect(mocks.gameplayClient.setReadOnlyMode).not.toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('standby-message')).not.toBeInTheDocument();
    expect(mocks.goto).not.toHaveBeenCalledWith('/login');
  });

  it('reactivates standby after the active tab releases ownership', async () => {
    const user = userEvent.setup();
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    let releaseGameplay: ((release: () => void) => void) | undefined;
    let releasePresence: ((release: () => void) => void) | undefined;
    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceHandlers.get('closed')?.({
      code: 4409,
      reason: 'session_already_active',
      path: '/api/v2/ws/presence'
    });
    mocks.claimGameplayOwnership.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseGameplay = resolve;
      })
    );
    mocks.claimPresenceOwnership.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePresence = resolve;
      })
    );
    await user.click(await screen.findByRole('button', { name: 'Stay in original tab' }));
    expect(await screen.findByTestId('standby-message')).toBeInTheDocument();

    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'presence-takeover', tabId: 'active-tab' })
    );
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'presence-release', tabId: 'active-tab' })
    );
    releaseGameplay?.(vi.fn());
    await waitFor(() => expect(mocks.claimPresenceOwnership).toHaveBeenCalledTimes(2));
    releasePresence?.(vi.fn());

    await waitFor(() => expect(screen.queryByTestId('standby-message')).not.toBeInTheDocument());
    expect(mocks.presenceClient.setReadOnlyMode).toHaveBeenLastCalledWith(false);
    expect(mocks.gameplayClient.setReadOnlyMode).toHaveBeenLastCalledWith(false);
  });

  it('acknowledges a takeover request and waits for confirmation before closing sockets', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    let finishPresenceClose: ((value: undefined) => void) | undefined;
    let finishGameplayClose: ((value: undefined) => void) | undefined;
    mocks.presenceClient.disconnectAndWait.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishPresenceClose = resolve;
        })
    );
    mocks.gameplayClient.disconnectAndWait.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishGameplayClose = resolve;
        })
    );
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({
        type: 'session-takeover-request',
        tabId: 'other-tab',
        requestId: 'release-request'
      })
    );

    expect(mocks.broadcastTakeoverAck).toHaveBeenCalledWith(
      'tab-test',
      'other-tab',
      'release-request'
    );
    expect(mocks.presenceClient.disconnectAndWait).not.toHaveBeenCalled();
    expect(mocks.gameplayClient.disconnectAndWait).not.toHaveBeenCalled();
    expect(screen.queryByTestId('standby-message')).not.toBeInTheDocument();

    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({
        type: 'takeover-confirmed',
        tabId: 'other-tab',
        ownerTabId: 'tab-test',
        requestId: 'release-request'
      })
    );
    const banner = await screen.findByTestId('standby-message');
    expect(banner).toHaveTextContent('Session active in another tab. Actions are disabled here.');
    expect(mocks.broadcastTakeoverReady).not.toHaveBeenCalled();
    finishPresenceClose?.(undefined);
    await Promise.resolve();
    expect(mocks.broadcastTakeoverReady).not.toHaveBeenCalled();
    finishGameplayClose?.(undefined);
    await waitFor(() =>
      expect(mocks.broadcastTakeoverReady).toHaveBeenCalledWith(
        'tab-test',
        'other-tab',
        'release-request'
      )
    );
    fireEvent(document, new Event('visibilitychange'));
    expect(mocks.presenceConnect).toHaveBeenCalledOnce();
    expect(screen.queryByText('Connection lost. Reconnecting…')).not.toBeInTheDocument();
  });

  it('deduplicates non-session connection alerts across both sockets', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceHandlers.get('closed')?.({ code: 1006, reason: 'network_error' });
    mocks.gameplayHandlers.get('closed')?.({ code: 1006, reason: 'network_error' });

    await screen.findByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost. Reconnecting…');
  });

  it('reconnects presence and gameplay after takeover succeeds', async () => {
    const user = userEvent.setup();
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    const closeHandler = mocks.presenceHandlers.get('closed');
    expect(closeHandler).toBeDefined();
    closeHandler?.({
      code: 4409,
      reason: 'session_already_active'
    });
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Continue here' }));
    expect(screen.getByRole('button', { name: 'Transferring session…' })).toBeDisabled();
    await waitFor(() => expect(mocks.takeoverSession).toHaveBeenCalledOnce());
    expect(mocks.broadcastSessionTakeoverRequest).toHaveBeenCalledOnce();
    expect(mocks.broadcastTakeoverConfirmed).toHaveBeenCalledWith(
      'tab-test',
      'active-tab',
      expect.any(String)
    );
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledTimes(2));

    mocks.presenceHandlers.get('auth_ok')?.();
    await waitFor(() => expect(mocks.gameplayClient.connect).toHaveBeenCalledWith('access-token'));
    mocks.gameplayHandlers.get('auth_ok')?.();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.gameplayClient.connect).toHaveBeenCalledWith('access-token');
  });

  it('shows an error in the conflict modal when takeover fails', async () => {
    const user = userEvent.setup();
    mocks.takeoverSession.mockRejectedValue(new Error('takeover failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    const closeHandler = mocks.presenceHandlers.get('closed');
    expect(closeHandler).toBeDefined();
    closeHandler?.({
      code: 4409,
      reason: 'session_already_active'
    });
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Continue here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to take over session. Please try again.'
    );
    expect(screen.getByRole('button', { name: 'Continue here' })).toBeEnabled();
  });

  it('shows a recoverable error when the takeover request times out', async () => {
    mocks.takeoverSession.mockImplementation(() => new Promise<void>(() => {}));
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceHandlers.get('closed')?.({
      code: 4409,
      reason: 'session_already_active'
    });
    await screen.findByRole('dialog');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Continue here' }));
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Session transfer timed out. The original tab is active again.'
      );
      expect(mocks.broadcastTakeoverFailed).toHaveBeenCalledWith(
        'tab-test',
        'active-tab',
        expect.any(String)
      );
      expect(screen.getByRole('button', { name: 'Continue here' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reclaims ownership when the requester reports a failed takeover', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({
        type: 'session-takeover-request',
        tabId: 'new-tab',
        requestId: 'failed-request'
      })
    );
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({
        type: 'takeover-confirmed',
        tabId: 'new-tab',
        ownerTabId: 'tab-test',
        requestId: 'failed-request'
      })
    );
    await waitFor(() =>
      expect(mocks.broadcastTakeoverReady).toHaveBeenCalledWith(
        'tab-test',
        'new-tab',
        'failed-request'
      )
    );
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({
        type: 'takeover-failed',
        tabId: 'new-tab',
        ownerTabId: 'tab-test',
        requestId: 'failed-request'
      })
    );

    await waitFor(() => expect(mocks.claimPresenceOwnership).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('standby-message')).not.toBeInTheDocument();
    expect(mocks.presenceClient.setReadOnlyMode).toHaveBeenLastCalledWith(false);
    expect(mocks.presenceConnect).toHaveBeenCalledTimes(2);
  });

  it('answers another tab presence-list-request while this tab owns presence', async () => {
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });
    await waitFor(() => expect(mocks.presenceConnect).toHaveBeenCalledOnce());
    mocks.presenceSend.mockReset();
    mocks.sessionMessageHandlers.forEach((handler) => handler({ type: 'presence-list-request' }));

    expect(mocks.presenceSend).toHaveBeenCalledWith('list_online_users');
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

  it('redirects an authenticated user from the root route to the lobby', async () => {
    currentPath = '/';
    session.setUser({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    render(Layout, { props: { children: stubChild } });

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/lobby'));
    expect(mocks.goto).not.toHaveBeenCalledWith('/login');
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
