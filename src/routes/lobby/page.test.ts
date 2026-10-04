import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
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
      connect: vi.fn()
    },
    gameplayClient: {
      on: vi.fn((event: string, handler: (payload?: never) => void) => {
        gameplayHandlers.set(event, handler);
        return () => gameplayHandlers.delete(event);
      }),
      send: vi.fn(),
      connect: vi.fn()
    }
  };
});

vi.mock('$lib/api/auth', () => ({ authApi: { refresh: mocks.refresh } }));
vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/ws', () => ({
  globalPresenceClient: { getOrCreate: () => mocks.presenceClient },
  globalGameplaysClient: { getOrCreate: () => mocks.gameplayClient }
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
    mocks.presenceClient.send.mockReset();
    mocks.gameplayClient.send.mockReset();
    mocks.presenceClient.connect.mockReset();
    mocks.gameplayClient.connect.mockReset();
    mocks.presenceClient.on.mockClear();
    mocks.gameplayClient.on.mockClear();
    mocks.play.mockReset();
  });

  it('shows the waiting message when no other users are online and has no manual refresh button', async () => {
    render(LobbyPage);

    expect(await screen.findByText('Waiting for challengers...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('requests the current online users immediately when mounting with an active connection', async () => {
    mocks.setPresenceState('connected');

    render(LobbyPage);

    await waitFor(() =>
      expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users')
    );
    expect(mocks.presenceClient.on).not.toHaveBeenCalledWith('auth_ok', expect.any(Function));

    emit(mocks.presenceHandlers, 'online_users', { users: ['ada', 'bob'] });
    expect(await screen.findByText('Bob')).toBeInTheDocument();
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
    expect(screen.getByText('Waiting for challengers...')).toBeInTheDocument();
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
