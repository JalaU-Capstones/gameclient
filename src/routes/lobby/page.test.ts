import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import LobbyPage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const presenceHandlers = new Map<string, (payload?: never) => void>();
  const gameplayHandlers = new Map<string, (payload?: never) => void>();
  return {
    refresh: vi.fn(),
    get: vi.fn(),
    goto: vi.fn(),
    presenceHandlers,
    gameplayHandlers,
    play: vi.fn(),
    presenceClient: {
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
    mocks.play.mockReset();
  });

  it('shows the waiting message when no other users are online and has no manual refresh button', async () => {
    render(LobbyPage);

    expect(await screen.findByText('Waiting for challengers...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
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

    emit(mocks.presenceHandlers, 'user_online');
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(mocks.presenceClient.send).toHaveBeenCalledWith('list_online_users');
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
