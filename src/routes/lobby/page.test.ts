import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import { ApiError } from '$lib/api/errors';
import LobbyPage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const presenceHandlers = new Map<string, (payload?: never) => void>();
  const gameplayHandlers = new Map<string, (payload?: never) => void>();
  let presenceState = 'disconnected';
  return {
    refresh: vi.fn(),
    get: vi.fn(),
    goto: vi.fn(),
    presenceHandlers,
    gameplayHandlers,
    play: vi.fn(),
    setPresenceState: (state: string) => {
      presenceState = state;
    },
    getPresenceClient: vi.fn(),
    getGameplayClient: vi.fn(),
    presenceClient: {
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber(presenceState);
          return () => {};
        }
      },
      on: vi.fn((event: string, handler: (payload?: never) => void) => {
        presenceHandlers.set(event, handler);
        return () => presenceHandlers.delete(event);
      }),
      send: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(() => {
        presenceState = 'disconnected';
      })
    },
    gameplayClient: {
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber('disconnected');
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

vi.mock('$lib/api/auth', () => ({ authApi: { refresh: mocks.refresh } }));
vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
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
  }
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
    mocks.setPresenceState('disconnected');
    mocks.refresh.mockReset().mockResolvedValue({ access_token: 'token' });
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path.endsWith('/bob')) return bob;
      return ada;
    });
    mocks.goto.mockReset();
    mocks.presenceHandlers.clear();
    mocks.gameplayHandlers.clear();
    mocks.getPresenceClient.mockReset().mockReturnValue(mocks.presenceClient);
    mocks.getGameplayClient.mockReset().mockReturnValue(mocks.gameplayClient);
    mocks.presenceClient.send.mockReset();
    mocks.gameplayClient.send.mockReset();
    mocks.presenceClient.connect.mockReset();
    mocks.presenceClient.disconnect.mockReset().mockImplementation(() => {
      mocks.setPresenceState('disconnected');
    });
    mocks.gameplayClient.connect.mockReset();
    mocks.gameplayClient.disconnect.mockReset();
    mocks.presenceClient.on.mockClear();
    mocks.gameplayClient.on.mockClear();
    mocks.play.mockReset();
  });

  it('shows a loading state before the first presence list arrives', async () => {
    render(LobbyPage);

    expect(await screen.findByText('Loading players...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('shows the waiting message when the server reports an empty user list', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    emit(mocks.presenceHandlers, 'online_users', { users: [] });

    expect(await screen.findByText('Waiting for challengers...')).toBeInTheDocument();
  });

  it('shows the only-player message when the server reports the current user', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    emit(mocks.presenceHandlers, 'online_users', { users: ['ada'] });

    expect(await screen.findByText('You are the only player online.')).toBeInTheDocument();
  });

  it('silently handles an unauthorized refresh instead of showing a lobby error', async () => {
    mocks.refresh.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(LobbyPage);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.queryByText('Unauthorized. Please log in again.')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to connect to lobby.')).not.toBeInTheDocument();

    let user: typeof ada | null = ada;
    const unsubscribe = session.subscribe((state) => {
      user = state.user;
    });
    unsubscribe();
    expect(user).toBeNull();
  });

  it('resets stale singleton clients and reconnects on lobby entry', async () => {
    mocks.setPresenceState('connected');

    render(LobbyPage);

    await waitFor(() => expect(mocks.presenceClient.disconnect).toHaveBeenCalledOnce());
    expect(mocks.presenceClient.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getPresenceClient.mock.invocationCallOrder[0]
    );
    expect(mocks.gameplayClient.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getGameplayClient.mock.invocationCallOrder[0]
    );
    expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token');
    expect(mocks.gameplayClient.disconnect).toHaveBeenCalledOnce();
    expect(mocks.gameplayClient.connect).toHaveBeenCalledWith('token');
    expect(mocks.presenceClient.on).toHaveBeenCalledWith('auth_ok', expect.any(Function));
    expect(Math.max(...mocks.presenceClient.on.mock.invocationCallOrder)).toBeLessThan(
      mocks.presenceClient.connect.mock.invocationCallOrder[0]
    );
    expect(Math.max(...mocks.gameplayClient.on.mock.invocationCallOrder)).toBeLessThan(
      mocks.gameplayClient.connect.mock.invocationCallOrder[0]
    );

    emit(mocks.presenceHandlers, 'auth_ok');
    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });
    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('unsubscribes handlers and disconnects both clients when leaving the lobby', async () => {
    const { unmount } = render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    unmount();

    expect(mocks.presenceHandlers.size).toBe(0);
    expect(mocks.gameplayHandlers.size).toBe(0);
    expect(mocks.presenceClient.disconnect).toHaveBeenCalledTimes(2);
    expect(mocks.gameplayClient.disconnect).toHaveBeenCalledTimes(2);
  });

  it('waits for auth_ok when mounting during authentication', async () => {
    mocks.setPresenceState('authenticating');

    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    expect(mocks.presenceClient.send).not.toHaveBeenCalledWith('list_online_users');
    expect(screen.getByText('Loading players...')).toBeInTheDocument();

    emit(mocks.presenceHandlers, 'auth_ok');

    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
  });

  it('requests the online list after the fallback delay if no list arrived', async () => {
    vi.useFakeTimers();
    try {
      render(LobbyPage);

      await vi.waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));
      await vi.advanceTimersByTimeAsync(1200);

      expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the fallback after receiving the initial online list', async () => {
    vi.useFakeTimers();
    try {
      render(LobbyPage);
      await vi.waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

      emit(mocks.presenceHandlers, 'online_users', { users: [] });
      mocks.presenceClient.send.mockClear();
      await vi.advanceTimersByTimeAsync(2500);

      expect(mocks.presenceClient.send).not.toHaveBeenCalledWith('list_online_users');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends loading if the presence list never arrives', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      render(LobbyPage);
      await vi.advanceTimersByTimeAsync(2500);

      expect(screen.getByText('Waiting for challengers...')).toBeInTheDocument();
      expect(warning).toHaveBeenCalledWith('[lobby] Timed out waiting for online players');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders another online player with an Invite button', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('automatically requests the online user list after presence changes', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());

    emit(mocks.presenceHandlers, 'auth_ok');
    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
    mocks.presenceClient.send.mockClear();

    emit(mocks.presenceHandlers, 'user_online');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
  });

  it('refreshes after user_online and shows the newly online user', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());

    emit(mocks.presenceHandlers, 'user_online');
    await new Promise((resolve) => setTimeout(resolve, 350));
    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('removes offline users by replacing the displayed list with the server list', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());
    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });
    expect(await screen.findByText('Bob')).toBeInTheDocument();

    emit(mocks.presenceHandlers, 'user_offline');
    await new Promise((resolve) => setTimeout(resolve, 350));
    emit(mocks.presenceHandlers, 'online_users', { users: ['ada'] });

    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument());
    expect(screen.getByText('You are the only player online.')).toBeInTheDocument();
  });

  it('debounces rapid presence events into one list request', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());

    emit(mocks.presenceHandlers, 'user_online');
    await new Promise((resolve) => setTimeout(resolve, 100));
    emit(mocks.presenceHandlers, 'user_offline');
    await new Promise((resolve) => setTimeout(resolve, 100));
    emit(mocks.presenceHandlers, 'user_online');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(
      mocks.presenceClient.send.mock.calls.filter(([event]) => event === 'list_online_users')
    ).toHaveLength(1);
  });

  it('refreshes the list when the tab becomes visible and reconnects if disconnected', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token'));

    const previousVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    mocks.setPresenceState('connected');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');

    mocks.presenceClient.connect.mockClear();
    mocks.setPresenceState('disconnected');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.presenceClient.connect).toHaveBeenCalledWith('token');

    if (previousVisibility) {
      Object.defineProperty(document, 'visibilityState', previousVisibility);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('always fetches fresh unique user data and replaces stale entries', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());
    mocks.get.mockResolvedValueOnce(bob).mockResolvedValueOnce({ ...bob, name: 'Robert' });

    emit(mocks.presenceHandlers, 'online_users', { users: ['bob', 'bob'] });
    expect(await screen.findByText('Bob')).toBeInTheDocument();

    emit(mocks.presenceHandlers, 'online_users', { users: ['bob'] });
    expect(await screen.findByText('Robert')).toBeInTheDocument();
    expect(mocks.get.mock.calls.filter(([path]) => path.endsWith('/bob'))).toHaveLength(2);
  });

  it('sends an invitation and shows the waiting state', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceClient.connect).toHaveBeenCalled());
    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Invite' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('create_game', { guest_id: 'bob' });
    expect(screen.getByText('Waiting for opponent...')).toBeInTheDocument();
  });

  it('accepts an invitation and navigates to the accepted game', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.gameplayClient.connect).toHaveBeenCalled());
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: 'game-123',
      host: { id: 'bob', name: 'Bob' }
    });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Accept' }));
    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('accept_invitation', {
      game_id: 'game-123'
    });

    emit(mocks.gameplayHandlers, 'invitation_accepted', { game_id: 'game-123' });
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/game/game-123'));
  });

  it('rejects an invitation, clears its modal, and shows a message', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.gameplayClient.connect).toHaveBeenCalled());
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: 'game-123',
      host: { id: 'bob', name: 'Bob' }
    });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Decline' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('reject_invitation', {
      game_id: 'game-123'
    });
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
    expect(screen.getByText('Invitation declined.')).toBeInTheDocument();
  });
});
