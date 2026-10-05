import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import LobbyPage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const presenceHandlers = new Map<string, (payload?: never) => void>();
  const gameplayHandlers = new Map<string, (payload?: never) => void>();
  const sessionMessageHandlers = new Set<
    (message: { type: string; userIds?: string[]; tabId?: string }) => void
  >();
  let presenceState = 'disconnected';
  let presenceAlive = false;
  const presenceSubscribers = new Set<(state: string) => void>();
  return {
    bootstrapSession: vi.fn(),
    get: vi.fn(),
    goto: vi.fn(),
    play: vi.fn(),
    presenceHandlers,
    gameplayHandlers,
    sessionMessageHandlers,
    requestPresenceReconnect: vi.fn(),
    announcePresenceListRequest: vi.fn(),
    getPresenceClient: vi.fn(),
    getGameplayClient: vi.fn(),
    setPresenceState: (state: string) => {
      presenceState = state;
      presenceSubscribers.forEach((subscriber) => subscriber(state));
    },
    setPresenceAlive: (alive: boolean) => {
      presenceAlive = alive;
    },
    presenceClient: {
      isAlive: () => presenceAlive,
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber(presenceState);
          presenceSubscribers.add(subscriber);
          return () => presenceSubscribers.delete(subscriber);
        }
      },
      on: vi.fn((event: string, handler: (payload?: never) => void) => {
        presenceHandlers.set(event, handler);
        return () => presenceHandlers.delete(event);
      }),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    },
    gameplayClient: {
      isAlive: () => true,
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber('connected');
          return () => {};
        }
      },
      on: vi.fn((event: string, handler: (payload?: never) => void) => {
        gameplayHandlers.set(event, handler);
        return () => gameplayHandlers.delete(event);
      }),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    }
  };
});

vi.mock('$lib/auth/bootstrap', () => ({
  bootstrapSession: mocks.bootstrapSession,
  handleAuthFailure: vi.fn()
}));
vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
vi.mock('$lib/auth/sessionLock', () => ({
  announcePresenceListRequest: mocks.announcePresenceListRequest,
  createTabId: vi.fn(() => 'lobby-tab'),
  subscribeSessionMessages: (
    handler: (message: { type: string; userIds?: string[]; tabId?: string }) => void
  ) => {
    mocks.sessionMessageHandlers.add(handler);
    return () => mocks.sessionMessageHandlers.delete(handler);
  }
}));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/ws', () => ({
  globalPresenceClient: {
    getOrCreate: mocks.getPresenceClient,
    disconnect: mocks.presenceClient.disconnect
  },
  globalGameplaysClient: {
    getOrCreate: mocks.getGameplayClient,
    disconnect: mocks.gameplayClient.disconnect
  },
  requestPresenceReconnect: mocks.requestPresenceReconnect
}));

const ada = {
  id: 'ada',
  name: 'Ada',
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};
const bob = {
  id: 'bob',
  name: 'Bob',
  email: 'bob@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};

function emit(handlers: Map<string, (payload?: never) => void>, event: string, payload?: object) {
  handlers.get(event)?.(payload as never);
}

describe('Lobby page', () => {
  beforeEach(() => {
    session.reset();
    session.setUser(ada);
    mocks.bootstrapSession.mockReset().mockResolvedValue({ accessToken: 'token', user: ada });
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path.endsWith('/bob')) return bob;
      return ada;
    });
    mocks.goto.mockReset();
    mocks.play.mockReset();
    mocks.presenceHandlers.clear();
    mocks.gameplayHandlers.clear();
    mocks.sessionMessageHandlers.clear();
    mocks.requestPresenceReconnect.mockReset();
    mocks.announcePresenceListRequest.mockReset();
    mocks.getPresenceClient.mockReset().mockReturnValue(mocks.presenceClient);
    mocks.getGameplayClient.mockReset().mockReturnValue(mocks.gameplayClient);
    mocks.presenceClient.send.mockReset();
    mocks.presenceClient.connect.mockReset();
    mocks.presenceClient.disconnect.mockReset();
    mocks.gameplayClient.send.mockReset();
    mocks.gameplayClient.connect.mockReset();
    mocks.gameplayClient.disconnect.mockReset();
    mocks.presenceClient.on.mockClear();
    mocks.gameplayClient.on.mockClear();
    mocks.setPresenceState('disconnected');
    mocks.setPresenceAlive(false);
  });

  it('subscribes to presence without owning or connecting the socket', async () => {
    const view = render(LobbyPage);

    await waitFor(() => expect(mocks.bootstrapSession).toHaveBeenCalledOnce());
    expect(mocks.requestPresenceReconnect).toHaveBeenCalledOnce();
    expect(mocks.presenceClient.connect).not.toHaveBeenCalled();
    expect(mocks.presenceClient.disconnect).not.toHaveBeenCalled();

    view.unmount();
    expect(mocks.presenceClient.disconnect).not.toHaveBeenCalled();
    expect(mocks.gameplayClient.disconnect).not.toHaveBeenCalled();
  });

  it('requests and displays the online user list from the layout-owned client', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceHandlers.has('online_users')).toBe(true));
    expect(screen.getByText('Loading players...')).toBeInTheDocument();

    mocks.setPresenceState('connected');
    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
    emit(mocks.presenceHandlers, 'online_users', { users: ['bob'] });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('renders presence lists broadcast from the owner tab', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceHandlers.has('online_users')).toBe(true));
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'presence-users', userIds: ['bob'] })
    );

    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('renders a direct presence list response addressed to this tab', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceHandlers.has('online_users')).toBe(true));
    mocks.sessionMessageHandlers.forEach((handler) =>
      handler({ type: 'presence-users-direct', tabId: 'lobby-tab', userIds: ['bob'] })
    );

    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('shows a direct presence snapshot received before the 2.5-second loading timeout', async () => {
    vi.useFakeTimers();
    try {
      render(LobbyPage);
      await vi.advanceTimersByTimeAsync(2400);
      mocks.sessionMessageHandlers.forEach((handler) =>
        handler({ type: 'presence-users-direct', tabId: 'lobby-tab', userIds: ['bob'] })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.queryByText('Loading players...')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a sanitized gameplay error without exposing the backend message', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.gameplayHandlers.has('error')).toBe(true));
    const rawMessage = 'Opponent b2f40334-48ad-4e82-b2f4-03f2d1c1f111 is offline';
    emit(mocks.gameplayHandlers, 'error', {
      code: 'OPPONENT_OFFLINE',
      message: rawMessage
    });

    expect(await screen.findByText('That player is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument();
    expect(screen.queryByText(/b2f40334-48ad-4e82-b2f4-03f2d1c1f111/)).not.toBeInTheDocument();
  });

  it('uses a delayed fallback and safety timeout without leaving loading forever', async () => {
    vi.useFakeTimers();
    try {
      render(LobbyPage);
      expect(mocks.announcePresenceListRequest).toHaveBeenCalledWith('lobby-tab');
      await vi.advanceTimersByTimeAsync(1200);
      expect(mocks.requestPresenceReconnect).toHaveBeenCalledTimes(2);
      expect(mocks.announcePresenceListRequest).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1300);
      expect(screen.getByText('Waiting for challengers...')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends an invitation and displays the waiting state', async () => {
    render(LobbyPage);
    mocks.setPresenceState('connected');
    emit(mocks.presenceHandlers, 'online_users', { users: ['bob'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('create_game', { guest_id: 'bob' });
    expect(screen.getByText('Waiting for opponent...')).toBeInTheDocument();
  });

  it('accepts an invitation and navigates to the accepted game', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.gameplayHandlers.has('invitation_received')).toBe(true));
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: 'game-1',
      host: { id: 'bob', name: 'Bob' }
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('accept_invitation', {
      game_id: 'game-1'
    });
    emit(mocks.gameplayHandlers, 'invitation_accepted', { game_id: 'game-1' });
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/game/game-1'));
  });

  it('declines an invitation and removes its dialog', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.gameplayHandlers.has('invitation_received')).toBe(true));
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: 'game-1',
      host: { id: 'bob', name: 'Bob' }
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('reject_invitation', {
      game_id: 'game-1'
    });
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });
});
