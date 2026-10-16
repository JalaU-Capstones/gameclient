import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import { onlinePlayers } from '$lib/stores/onlinePlayers.svelte';
import type { PublicUser, User } from '$lib/types/api';
import InvitationHost from '$lib/components/InvitationHost.svelte';
import LobbyPage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const presenceHandlers = new Map<string, (payload?: never) => void>();
  const gameplayHandlers = new Map<string, (payload?: never) => void>();
  const sessionMessageHandlers = new Set<
    (message: { type: string; userIds?: string[]; tabId?: string }) => void
  >();
  let standbyValue = false;
  const standbySubscribers = new Set<(value: boolean) => void>();
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
    standbyMode: {
      subscribe: (subscriber: (value: boolean) => void) => {
        subscriber(standbyValue);
        standbySubscribers.add(subscriber);
        return () => standbySubscribers.delete(subscriber);
      }
    },
    setStandbyMode: (value: boolean) => {
      standbyValue = value;
      standbySubscribers.forEach((subscriber) => subscriber(value));
    },
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
  standbyMode: mocks.standbyMode,
  globalPresenceClient: {
    subscribe: (subscriber: (client: typeof mocks.presenceClient | null) => void) => {
      subscriber(mocks.presenceClient);
      return () => {};
    },
    getOrCreate: mocks.getPresenceClient,
    disconnect: mocks.presenceClient.disconnect
  },
  globalGameplaysClient: {
    subscribe: (subscriber: (client: typeof mocks.gameplayClient | null) => void) => {
      subscriber(mocks.gameplayClient);
      return () => {};
    },
    getOrCreate: mocks.getGameplayClient,
    disconnect: mocks.gameplayClient.disconnect
  },
  requestPresenceReconnect: mocks.requestPresenceReconnect
}));

const adaId = '123e4567-e89b-42d3-a456-426614174000';
const bobId = '123e4567-e89b-42d3-a456-426614174001';
const ada: User = {
  id: adaId,
  name: 'Ada',
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};
const bob: PublicUser = {
  id: bobId,
  name: 'Bob'
};

function emit(handlers: Map<string, (payload?: never) => void>, event: string, payload?: object) {
  handlers.get(event)?.(payload as never);
}

function renderLobbyWithInvitationHost() {
  render(LobbyPage);
  render(InvitationHost);
}

describe('Lobby page', () => {
  beforeEach(async () => {
    session.reset();
    session.setUser(ada);
    mocks.bootstrapSession.mockReset().mockResolvedValue({ accessToken: 'token', user: ada });
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path.includes(bobId)) return bob;
      return ada;
    });
    mocks.goto.mockReset();
    mocks.play.mockReset();
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
    mocks.setStandbyMode(false);
    onlinePlayers.reset();
    onlinePlayers.initialize();
    emit(mocks.presenceHandlers, 'online_users', { users: [] });
    await waitFor(() => expect(onlinePlayers.users).toEqual([]));
  });

  it('subscribes to presence without owning or connecting the socket', async () => {
    const view = render(LobbyPage);

    await waitFor(() => expect(mocks.bootstrapSession).toHaveBeenCalledOnce());
    expect(mocks.requestPresenceReconnect).not.toHaveBeenCalled();
    expect(mocks.getPresenceClient).not.toHaveBeenCalled();
    expect(mocks.presenceClient.connect).not.toHaveBeenCalled();
    expect(mocks.presenceClient.disconnect).not.toHaveBeenCalled();

    view.unmount();
    expect(mocks.presenceClient.disconnect).not.toHaveBeenCalled();
    expect(mocks.gameplayClient.disconnect).not.toHaveBeenCalled();
  });

  it('requests and displays the online user list from the layout-owned client', async () => {
    render(LobbyPage);
    expect(screen.getByText('Waiting for challengers...')).toBeInTheDocument();

    mocks.setPresenceState('connected');
    expect(mocks.presenceClient.send).not.toHaveBeenCalledWith('list_online_users');
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });

    await waitFor(() => expect(onlinePlayers.users.map((user) => user.name)).toContain('Bob'));
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('fetches public user records by ID without requiring private fields', async () => {
    render(LobbyPage);
    await waitFor(() => expect(mocks.presenceHandlers.has('online_users')).toBe(true));
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });

    await waitFor(() => expect(onlinePlayers.users.map((user) => user.name)).toContain('Bob'));
    expect(mocks.get).toHaveBeenCalledWith(`/api/v2/users/${bobId}`);
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  it('filters the current user from the shared online list', async () => {
    render(LobbyPage);
    emit(mocks.presenceHandlers, 'online_users', { users: [adaId, bobId] });

    await waitFor(() => expect(onlinePlayers.users.map((user) => user.name)).toContain('Bob'));
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('renders shared online users broadcast by the presence client', async () => {
    render(LobbyPage);
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });

    await waitFor(() => expect(onlinePlayers.users.map((user) => user.name)).toContain('Bob'));
  });

  it('updates playing status from shared presence events', async () => {
    render(LobbyPage);
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });
    await waitFor(() => expect(onlinePlayers.users.map((user) => user.name)).toContain('Bob'));

    emit(mocks.presenceHandlers, 'user_status', { user_id: bobId, status: 'playing' });

    await waitFor(() => expect(onlinePlayers.playingIds.has(bobId)).toBe(true));
    expect(await screen.findByText('Playing')).toBeInTheDocument();
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

  it('refreshes presence from the shared store on auth_ok', () => {
    mocks.setPresenceAlive(true);

    emit(mocks.presenceHandlers, 'auth_ok');

    expect(mocks.presenceClient.send).toHaveBeenCalledTimes(1);
    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
  });

  it('sends an invitation with a client request ID', async () => {
    render(LobbyPage);
    mocks.setPresenceState('connected');
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith(
      'create_game',
      expect.objectContaining({
        guest_id: bobId,
        client_request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        )
      })
    );
  });

  it('keeps the lobby free of local waiting modal state when the route owns the game_created handler', async () => {
    render(LobbyPage);
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith(
      'create_game',
      expect.objectContaining({ guest_id: bobId })
    );
    expect(screen.queryByText('Waiting for opponent...')).not.toBeInTheDocument();
  });

  it('disables lobby actions while standby still receives presence updates', async () => {
    renderLobbyWithInvitationHost();
    await waitFor(() => expect(mocks.gameplayHandlers.has('invitation_received')).toBe(true));
    mocks.setStandbyMode(true);
    emit(mocks.presenceHandlers, 'online_users', { users: [bobId] });

    expect(await screen.findByRole('button', { name: 'Invite' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeDisabled();

    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174002',
      host: { id: bobId, name: 'Bob' }
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(mocks.gameplayClient.send).not.toHaveBeenCalledWith(
      'create_game',
      expect.objectContaining({ guest_id: bobId })
    );
    expect(screen.getAllByText('Bob')).not.toHaveLength(0);
  });

  it('accepts an invitation and navigates to the accepted game', async () => {
    renderLobbyWithInvitationHost();
    await waitFor(() => expect(mocks.gameplayHandlers.has('invitation_received')).toBe(true));
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174002',
      host: { id: bobId, name: 'Bob' }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('accept_invitation', {
      game_id: '123e4567-e89b-42d3-a456-426614174002'
    });
    emit(mocks.gameplayHandlers, 'invitation_accepted', {
      game_id: '123e4567-e89b-42d3-a456-426614174002'
    });
    await waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith('/game/123e4567-e89b-42d3-a456-426614174002')
    );
  });

  it('declines an invitation and removes its dialog', async () => {
    renderLobbyWithInvitationHost();
    await waitFor(() => expect(mocks.gameplayHandlers.has('invitation_received')).toBe(true));
    emit(mocks.gameplayHandlers, 'invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174002',
      host: { id: bobId, name: 'Bob' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(mocks.gameplayClient.send).toHaveBeenCalledWith('reject_invitation', {
      game_id: '123e4567-e89b-42d3-a456-426614174002'
    });
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });
  it('plays a click sound and navigates to the history page', async () => {
    render(LobbyPage);

    await userEvent.click(screen.getByRole('button', { name: 'History' }));

    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(mocks.goto).toHaveBeenCalledWith('/history');
  });

  it('plays a click sound and navigates to the profile page', async () => {
    render(LobbyPage);

    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(mocks.goto).toHaveBeenCalledWith('/profile');
  });

  it('plays a click sound and navigates to the logs page', async () => {
    render(LobbyPage);

    await userEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(mocks.play).toHaveBeenCalledWith('click');
    expect(mocks.goto).toHaveBeenCalledWith('/logs');
  });
});
