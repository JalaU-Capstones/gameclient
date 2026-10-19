import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import type { PublicUser, User } from '$lib/types/api';
import GamePage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: never) => void>();
  let invitationState = 'accepted';
  let omitInvitationState = false;
  let standbyValue = false;
  const standbySubscribers = new Set<(value: boolean) => void>();
  let currentClient: unknown = null;
  const clientSubscribers = new Set<(client: unknown) => void>();
  return {
    gameplaysStore: {
      getOrCreate: () => currentClient,
      subscribe: (subscriber: (client: unknown) => void) => {
        subscriber(currentClient);
        clientSubscribers.add(subscriber);
        return () => clientSubscribers.delete(subscriber);
      }
    },
    replaceClient: (client: unknown) => {
      currentClient = client;
      clientSubscribers.forEach((subscriber) => subscriber(client));
    },
    bootstrapSession: vi.fn(),
    get: vi.fn(),
    goto: vi.fn(),
    pushToast: vi.fn(),
    handlers,
    get invitationState() {
      return invitationState;
    },
    set invitationState(value: string) {
      invitationState = value;
    },
    get omitInvitationState() {
      return omitInvitationState;
    },
    set omitInvitationState(value: boolean) {
      omitInvitationState = value;
    },
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
    play: vi.fn(),
    gameplayAlive: true,
    client: {
      isAlive: () => mocks.gameplayAlive,
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber('connected');
          return () => {};
        }
      },
      on: vi.fn((event: string, handler: (payload?: never) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      }),
      send: vi.fn(),
      connect: vi.fn()
    },
    page: {
      url: new URL('http://localhost/game/game-123'),
      params: { id: 'game-123' }
    }
  };
});

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (value: typeof mocks.page) => void) => {
      fn(mocks.page);
      return () => {};
    }
  }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/stores/toasts', () => ({ pushToast: mocks.pushToast }));
vi.mock('$lib/auth/bootstrap', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/auth/bootstrap')>();
  return { ...original, bootstrapSession: mocks.bootstrapSession };
});
vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$lib/stores/ws', () => ({
  standbyMode: mocks.standbyMode,
  globalGameplaysClient: mocks.gameplaysStore,
  globalPresenceClient: {
    getOrCreate: vi.fn(() => ({
      on: vi.fn(() => () => {}),
      send: vi.fn(),
      isAlive: () => true,
      state: {
        subscribe: (subscriber: (state: string) => void) => {
          subscriber('connected');
          return () => {};
        }
      }
    }))
  }
}));

const currentUser: User = {
  id: 'host',
  name: 'Ada',
  username: 'ada',
  usernameModifiedBySystem: false,
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};
const host: PublicUser = {
  id: 'host',
  name: 'Ada'
};
const guest: PublicUser = {
  id: 'guest',
  name: 'Bob'
};
const startingBoard = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0]
];

function emit(event: string, payload?: object) {
  mocks.handlers.get(event)?.(payload as never);
}

describe('Game page', () => {
  beforeEach(() => {
    session.reset();
    session.setUser(currentUser);
    mocks.bootstrapSession
      .mockReset()
      .mockResolvedValue({ accessToken: 'token', user: currentUser });
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v2/gameplays/')) {
        return {
          id: 'game-123',
          currentPositions: JSON.stringify({ board: startingBoard }),
          hostPlayer: 'host',
          guestPlayer: 'guest',
          playerTurn: 'host',
          ...(mocks.omitInvitationState ? {} : { invitationState: mocks.invitationState }),
          matchResult: null,
          createdDate: '2026-01-01T00:00:00Z',
          updatedDate: '2026-01-01T00:00:00Z'
        };
      }
      if (path.endsWith('/host')) return host;
      if (path.endsWith('/guest')) return guest;
      throw new Error(`Unexpected GET request: ${path}`);
    });
    mocks.goto.mockReset();
    mocks.pushToast.mockReset();
    mocks.handlers.clear();
    mocks.invitationState = 'accepted';
    mocks.omitInvitationState = false;
    mocks.client.send.mockReset();
    mocks.client.connect.mockReset();
    mocks.play.mockReset();
    mocks.gameplayAlive = true;
    mocks.setStandbyMode(false);
    mocks.replaceClient(mocks.client);
  });

  it('renders an empty board while game data is loading', () => {
    mocks.bootstrapSession.mockReturnValue(new Promise(() => {}));
    render(GamePage);

    expect(screen.getByText('Loading Game...')).toBeInTheDocument();
  });

  it('displays the host and guest names after loading', async () => {
    render(GamePage);

    expect(await screen.findByText('@Ada')).toBeInTheDocument();
    expect(screen.getByText('@Bob')).toBeInTheDocument();
  });

  it('sends leave_game when the game page unmounts', async () => {
    const { unmount } = render(GamePage);

    await screen.findByText('@Ada');
    unmount();

    expect(mocks.client.send).toHaveBeenCalledWith('leave_game', { game_id: 'game-123' });
  });

  it('loads host and guest from minimal public user endpoint responses', async () => {
    render(GamePage);

    expect(await screen.findByText('@Ada')).toBeInTheDocument();
    expect(screen.getByText('@Bob')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/api/v2/users/host');
    expect(mocks.get).toHaveBeenCalledWith('/api/v2/users/guest');
  });

  it('sanitizes gameplay error messages before rendering them', async () => {
    render(GamePage);
    await screen.findByText('@Ada');
    const rawMessage = 'Opponent b2f40334-48ad-4e82-b2f4-03f2d1c1f111 is offline';
    emit('error', { code: 'OPPONENT_OFFLINE', message: rawMessage });

    expect(await screen.findByText('That player is no longer available.')).toBeInTheDocument();
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument();
  });

  it('shows a toast and redirects after a replacement invitation', async () => {
    vi.useFakeTimers();
    try {
      render(GamePage);
      await screen.findByText('@Ada');

      emit('invitation_replaced', { game_id: 'game-123', reason: 'target_busy' });

      expect(mocks.pushToast).toHaveBeenCalledWith(
        'warning',
        'Another player accepted the invitation first.'
      );
      expect(mocks.goto).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2499);
      expect(mocks.goto).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.goto).toHaveBeenCalledWith('/lobby');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores invitation_replaced events for a different game', async () => {
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_replaced', { game_id: 'other-game', reason: 'target_busy' });

    expect(mocks.pushToast).not.toHaveBeenCalled();
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('marks the invitation as pending again after a retry is accepted', async () => {
    mocks.invitationState = 'rejected';
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: false,
      updated_at: '2026-10-17T12:00:00.000000+00:00'
    });

    expect(await screen.findByText('Invitation pending')).toBeInTheDocument();
    expect(screen.getByText('2 retries left')).toBeInTheDocument();
    expect(mocks.pushToast).toHaveBeenCalledWith(
      'info',
      'Retry sent. Waiting for the guest to respond...'
    );
  });

  it('ignores an expiration event older than an acknowledged retry', async () => {
    mocks.invitationState = 'expired';
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: false,
      updated_at: '2026-10-17T12:00:00.000000+00:00'
    });
    expect(await screen.findByText('Invitation pending')).toBeInTheDocument();

    mocks.pushToast.mockClear();
    emit('invitation_expired', {
      game_id: 'game-123',
      updated_at: '2026-10-17T11:59:59.000000+00:00'
    });

    expect(mocks.pushToast).not.toHaveBeenCalled();
    expect(screen.getByText('Invitation pending')).toBeInTheDocument();

    emit('invitation_expired', {
      game_id: 'game-123',
      updated_at: '2026-10-17T12:01:00.000000+00:00'
    });
    expect(mocks.pushToast).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('ignores a stale invitation_expired that arrives after invitation_retry_accepted', async () => {
    mocks.invitationState = 'pending';
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: false,
      updated_at: '2026-10-17T12:00:00.000000+00:00'
    });
    expect(await screen.findByText('Invitation pending')).toBeInTheDocument();
    mocks.pushToast.mockClear();

    emit('invitation_expired', {
      game_id: 'game-123',
      reason: 'timeout',
      updated_at: '2026-10-17T11:59:59.000000+00:00'
    });

    expect(mocks.pushToast).not.toHaveBeenCalled();
    expect(screen.getByText('Invitation pending')).toBeInTheDocument();
  });

  it('processes invitation_expired when updated_at is missing from the payload', async () => {
    mocks.invitationState = 'pending';
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: false,
      updated_at: '2026-10-17T12:00:00.000000+00:00'
    });
    await screen.findByText('Invitation pending');
    mocks.pushToast.mockClear();

    emit('invitation_expired', { game_id: 'game-123', reason: 'timeout' });

    expect(mocks.pushToast).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('filters an invitation_expired event with the same updated_at as the last retry', async () => {
    mocks.invitationState = 'pending';
    render(GamePage);
    await screen.findByText('@Ada');
    const updatedAt = '2026-10-17T12:00:00.000000+00:00';

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: false,
      updated_at: updatedAt
    });
    await screen.findByText('Invitation pending');
    mocks.pushToast.mockClear();

    emit('invitation_expired', {
      game_id: 'game-123',
      reason: 'timeout',
      updated_at: updatedAt
    });

    expect(mocks.pushToast).not.toHaveBeenCalled();
    expect(screen.getByText('Invitation pending')).toBeInTheDocument();
  });

  it('shows the idempotent retry toast when the invitation was already pending', async () => {
    render(GamePage);
    await screen.findByText('@Ada');

    emit('invitation_retry_accepted', {
      game_id: 'game-123',
      attempt: 1,
      remaining_attempts: 2,
      idempotent: true,
      updated_at: '2026-10-17T12:00:00.000000+00:00'
    });

    expect(mocks.pushToast).toHaveBeenCalledWith(
      'info',
      'This invitation was already pending. Your view is synced.'
    );
  });

  it('shows a countdown button after RETRY_LIMIT_EXCEEDED', async () => {
    mocks.invitationState = 'rejected';
    render(GamePage);
    await screen.findByText('@Ada');

    emit('error', {
      code: 'RETRY_LIMIT_EXCEEDED',
      message: 'limit reached',
      retry_after_seconds: 30
    });

    expect(await screen.findByTestId('countdown-button')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-button')).toHaveTextContent('Retry in (30s)');
  });

  it('sends retry_invitation when the host clicks the retry button', async () => {
    mocks.invitationState = 'rejected';
    render(GamePage);
    await screen.findByText('@Ada');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mocks.client.send).toHaveBeenCalledWith('retry_invitation', { game_id: 'game-123' });
  });

  it('hides the retry button for the guest', async () => {
    session.setUser({ ...currentUser, id: 'guest', name: 'Bob' });
    mocks.invitationState = 'rejected';
    render(GamePage);
    await screen.findByText('@Ada');

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('disables the retry button in standby mode', async () => {
    mocks.invitationState = 'rejected';
    mocks.setStandbyMode(true);
    render(GamePage);
    await screen.findByText('@Ada');

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('subscribes once when the gameplay socket is already connected', async () => {
    render(GamePage);
    await screen.findByText('@Ada');

    expect(mocks.client.connect).not.toHaveBeenCalled();
    expect(mocks.client.send).toHaveBeenCalledTimes(1);
    expect(mocks.client.send).toHaveBeenCalledWith('subscribe_game', { game_id: 'game-123' });
  });

  it('subscribes again after gameplay socket authentication on reconnect', async () => {
    mocks.gameplayAlive = false;
    render(GamePage);
    await screen.findByText('@Ada');

    expect(mocks.client.connect).toHaveBeenCalledWith('token');
    emit('auth_ok');

    expect(mocks.client.send).toHaveBeenCalledWith('subscribe_game', { game_id: 'game-123' });
  });

  it('rebinds to the new gameplay client after a session takeover', async () => {
    render(GamePage);
    await screen.findByText('@Ada');

    const takeoverClient = {
      ...mocks.client,
      on: vi.fn(() => () => {}),
      send: vi.fn(),
      connect: vi.fn()
    };
    mocks.replaceClient(null);
    mocks.replaceClient(takeoverClient);

    await waitFor(() =>
      expect(takeoverClient.send).toHaveBeenCalledWith('subscribe_game', { game_id: 'game-123' })
    );
    expect(takeoverClient.on).toHaveBeenCalledWith('board_updated', expect.any(Function));
  });

  it('disables board cells when it is the opponent’s turn', async () => {
    session.setUser({ ...currentUser, id: guest.id, name: guest.name });
    render(GamePage);

    await screen.findByText('@Bob');

    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled();
  });

  it('sends a move when the current player clicks an empty cell', async () => {
    render(GamePage);

    const cell = await screen.findByRole('button', { name: 'Cell 0 0' });
    await userEvent.setup().click(cell);

    expect(mocks.client.send).toHaveBeenCalledWith(
      'play_move',
      expect.objectContaining({
        game_id: 'game-123',
        row: 0,
        col: 0,
        client_request_id: expect.any(String)
      })
    );

    emit('board_updated', {
      board: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      turn: 'guest'
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cell 0 0' })).toHaveTextContent('X');
      expect(screen.getByRole('button', { name: 'Cell 0 0' })).toHaveClass('cell-symbol', 'cell-x');
    });
  });

  it('sends only one move when a cell is clicked twice before the server update', async () => {
    render(GamePage);
    const cell = await screen.findByRole('button', { name: 'Cell 0 0' });

    fireEvent.click(cell);
    fireEvent.click(cell);

    expect(mocks.client.send.mock.calls.filter(([event]) => event === 'play_move')).toHaveLength(1);
  });

  it('enables the host board when the pending invitation is accepted', async () => {
    mocks.invitationState = 'pending';
    render(GamePage);

    expect(await screen.findByText('Invitation pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled();
    expect(screen.getByText("Opponent's Turn")).toBeInTheDocument();

    emit('invitation_accepted', {
      board: startingBoard,
      turn: 'host'
    });

    await waitFor(() => {
      expect(screen.queryByText('Invitation pending')).not.toBeInTheDocument();
      expect(screen.getByText('Your Turn')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeEnabled();
    });
  });

  it.each([
    ['invitation_rejected', 'INVITATION_REJECTED'],
    ['invitation_expired', 'INVITATION_EXPIRED'],
    ['invitation_canceled', 'INVITATION_CANCELED']
  ])('ends the pending invitation on %s', async (event, messageCode) => {
    mocks.invitationState = 'pending';
    render(GamePage);
    expect(await screen.findByText('Invitation pending')).toBeInTheDocument();

    emit(event);

    await waitFor(() => expect(screen.queryByText('Invitation pending')).not.toBeInTheDocument());
    expect(mocks.pushToast).toHaveBeenCalledWith(
      'warning',
      messageCode === 'INVITATION_REJECTED'
        ? 'The invitation was declined.'
        : messageCode === 'INVITATION_EXPIRED'
          ? 'Your invitation expired.'
          : 'The invitation was canceled.'
    );
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled();
  });

  it('does not revive the board when acceptance arrives after game_ended', async () => {
    mocks.invitationState = 'pending';
    render(GamePage);
    await screen.findByText('Invitation pending');
    const finalBoard = [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 0]
    ];

    emit('game_ended', { winner: 'guest', reason: 'abandon', board: finalBoard });
    emit('invitation_accepted', {
      board: startingBoard,
      turn: 'host'
    });

    expect(await screen.findByText('YOU LOST')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toHaveTextContent('X');
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled();
    expect(screen.queryByText('Your Turn')).not.toBeInTheDocument();
  });

  it('infers an accepted invitation from a legacy gameplay response', async () => {
    mocks.omitInvitationState = true;
    render(GamePage);

    const cell = await screen.findByRole('button', { name: 'Cell 0 0' });
    await userEvent.setup().click(cell);

    expect(mocks.client.send).toHaveBeenCalledWith(
      'play_move',
      expect.objectContaining({
        game_id: 'game-123',
        row: 0,
        col: 0,
        client_request_id: expect.any(String)
      })
    );
  });

  it('disables game actions in standby mode', async () => {
    render(GamePage);
    await screen.findByText('@Ada');
    mocks.setStandbyMode(true);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cell 0 0' }));
    expect(mocks.client.send).not.toHaveBeenCalledWith(
      'play_move',
      expect.objectContaining({ row: 0, col: 0 })
    );
  });

  it('uses responsive board sizing and pixel-style symbol sizing on narrow screens', async () => {
    window.innerWidth = 360;
    render(GamePage);

    const cell = await screen.findByRole('button', { name: 'Cell 0 0' });
    await userEvent.setup().click(cell);
    emit('board_updated', {
      board: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
      ],
      turn: 'guest'
    });

    await waitFor(() => {
      const symbol = screen.getByRole('button', { name: 'Cell 0 0' });
      const board = symbol.closest('.grid-cols-3');

      expect(symbol).toHaveClass('cell-symbol');
      expect(board).toHaveClass('w-[min(90vw,400px)]');
    });
  });

  it('applies the board, winner, and reason received with game_ended', async () => {
    render(GamePage);
    await screen.findByText('@Ada');

    emit('game_ended', {
      winner: 'guest',
      reason: 'abandon',
      board: [
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 0]
      ]
    });

    await waitFor(() => expect(screen.getByText('YOU LOST')).toBeInTheDocument());
    expect(screen.getByText('Reason: abandon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell 1 1' })).toHaveTextContent('O');
  });
});
