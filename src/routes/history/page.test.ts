import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/svelte';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import HistoryPage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: never) => void>();
  const client = {
    isAlive: () => true,
    send: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: never) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    })
  };
  return {
    client,
    handlers,
    pushToast: vi.fn(),
    standby: {
      subscribe: (fn: (value: boolean) => void) => {
        fn(false);
        return () => {};
      }
    }
  };
});

vi.mock('$lib/stores/ws', () => ({
  standbyMode: mocks.standby,
  globalGameplaysClient: {
    subscribe: (subscriber: (client: typeof mocks.client | null) => void) => {
      subscriber(mocks.client);
      return () => {};
    },
    getOrCreate: () => mocks.client
  }
}));

vi.mock('$lib/stores/toasts', () => ({ pushToast: mocks.pushToast }));

const server = setupServer();

const ME = {
  id: 'me-id',
  name: 'laura',
  email: 'laura@example.com',
  registerDate: '2026-10-01T12:00:00Z'
};

// The backend sends matchResult as a JSON string, so the tests do the same.
function gameplay(
  id: string,
  hostPlayer: string,
  guestPlayer: string | null,
  matchResult: object | null,
  invitationState:
    'accepted' | 'pending' | 'queued' | 'rejected' | 'expired' | 'canceled' = 'accepted'
) {
  return {
    id,
    currentPositions: '[]',
    hostPlayer,
    guestPlayer,
    playerTurn: hostPlayer,
    invitationState,
    matchResult: matchResult === null ? null : JSON.stringify(matchResult),
    createdDate: '2026-10-05T15:30:00Z',
    updatedDate: '2026-10-05T15:40:00Z'
  };
}

// Serves the game list and a user lookup. Returns the ids that were requested.
function mockBackend(games: ReturnType<typeof gameplay>[], users: Record<string, string> = {}) {
  const requestedUserIds: string[] = [];
  server.use(
    http.get('*/api/v2/gameplays/my-gameplays', () => HttpResponse.json(games)),
    http.get('*/api/v2/users/:id', ({ params }) => {
      const id = String(params.id);
      requestedUserIds.push(id);
      const name = users[id];
      return name
        ? HttpResponse.json({ id, name })
        : HttpResponse.json({ message: 'User not found' }, { status: 404 });
    })
  );
  return requestedUserIds;
}

function emit(event: string, payload?: object) {
  mocks.handlers.get(event)?.(payload as never);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  session.setUser(ME);
  mocks.client.send.mockClear();
  mocks.pushToast.mockClear();
  mocks.handlers.clear();
});

afterEach(() => {
  server.resetHandlers();
  session.reset();
});

afterAll(() => {
  server.close();
});

describe('History page', () => {
  it('shows a loading message while the games are being fetched', async () => {
    mockBackend([]);

    render(HistoryPage);

    expect(screen.getByText('Loading games...')).toBeInTheDocument();
    expect(await screen.findByText('No games played yet.')).toBeInTheDocument();
  });

  it('shows the empty message when the user has no games', async () => {
    mockBackend([]);

    render(HistoryPage);

    expect(await screen.findByText('No games played yet.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows one card per game with the rival name and the date', async () => {
    mockBackend(
      [
        gameplay('g1', ME.id, 'pablo-id', { winner: 'host', reason: 'line' }),
        gameplay('g2', 'maria-id', ME.id, { winner: 'host', reason: 'line' })
      ],
      { 'pablo-id': 'pablo_88', 'maria-id': 'maria' }
    );

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('pablo_88')).toBeInTheDocument();
    expect(within(cards[1]).getByText('maria')).toBeInTheDocument();
    expect(within(cards[0]).getByText(/Oct \d{1,2}, 2026/)).toBeInTheDocument();
  });

  it('tells the user whether they won or lost, from their own point of view', async () => {
    mockBackend(
      [
        gameplay('g1', ME.id, 'pablo-id', { winner: 'host', reason: 'line' }),
        gameplay('g2', 'maria-id', ME.id, { winner: 'host', reason: 'line' }),
        gameplay('g3', ME.id, 'ana-id', { winner: 'ana-id', reason: 'abandon' }),
        gameplay('g4', ME.id, 'luis-id', { winner: ME.id, reason: 'abandon' })
      ],
      { 'pablo-id': 'pablo', 'maria-id': 'maria', 'ana-id': 'ana', 'luis-id': 'luis' }
    );

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).getByText('You won')).toBeInTheDocument();
    expect(within(cards[1]).getByText('You lost')).toBeInTheDocument();
    expect(within(cards[2]).getByText('You lost')).toBeInTheDocument();
    expect(within(cards[3]).getByText('You won')).toBeInTheDocument();
  });

  it('labels draws and games that are not finished', async () => {
    mockBackend(
      [
        gameplay('g1', ME.id, 'a-id', { winner: null, reason: 'draw' }),
        gameplay('g2', ME.id, 'b-id', null),
        gameplay('g3', ME.id, 'c-id', { reason: 'pending' }),
        gameplay('g4', ME.id, 'd-id', { winner: null, reason: 'rejected' })
      ],
      { 'a-id': 'a', 'b-id': 'b', 'c-id': 'c', 'd-id': 'd' }
    );

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).getByText('Draw')).toBeInTheDocument();
    expect(within(cards[1]).getByText('In progress')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Waiting for response')).toBeInTheDocument();
    expect(within(cards[3]).getByText('Rejected')).toBeInTheDocument();
  });

  it('shows "Unknown player" when the rival cannot be loaded', async () => {
    mockBackend([
      gameplay('g1', ME.id, 'deleted-id', { winner: null, reason: 'draw' }),
      gameplay('g2', ME.id, null, null)
    ]);

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).getByText('Unknown player')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Unknown player')).toBeInTheDocument();
  });

  it('looks up each rival once and never the logged-in user', async () => {
    const requested = mockBackend(
      [
        gameplay('g1', ME.id, 'pablo-id', null),
        gameplay('g2', 'pablo-id', ME.id, null),
        gameplay('g3', ME.id, 'pablo-id', null)
      ],
      { 'pablo-id': 'pablo' }
    );

    render(HistoryPage);

    await screen.findAllByRole('listitem');
    expect(requested).toEqual(['pablo-id']);
  });

  it('does not render the online players menu on the history page', async () => {
    mockBackend([]);

    render(HistoryPage);

    expect(await screen.findByText('No games played yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
  });

  it('shows the retry button for host games that ended in a terminal rejection state', async () => {
    mockBackend([
      gameplay('g1', ME.id, 'pablo-id', { winner: null, reason: 'rejected' }, 'rejected'),
      gameplay('g2', ME.id, 'host-id', { winner: null, reason: 'expired' }, 'expired'),
      gameplay('g3', ME.id, 'canceled-id', { winner: null, reason: 'canceled' }, 'canceled')
    ]);

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(cards[1]).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(cards[2]).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('hides the retry button on guest games and non-terminal games', async () => {
    mockBackend([
      gameplay('g1', 'other-host', ME.id, { winner: null, reason: 'rejected' }, 'rejected'),
      gameplay('g2', ME.id, 'pablo-id', { winner: 'me-id', reason: 'line' }),
      gameplay('g3', ME.id, 'pablo-id', null)
    ]);

    render(HistoryPage);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(cards[1]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(cards[2]).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('sends retry_invitation when the host clicks Retry', async () => {
    mockBackend([
      gameplay('g1', ME.id, 'pablo-id', { winner: null, reason: 'rejected' }, 'rejected')
    ]);

    render(HistoryPage);
    const card = (await screen.findAllByRole('listitem'))[0];

    await screen.findByRole('button', { name: 'Retry' });
    await within(card).getByRole('button', { name: 'Retry' }).click();

    expect(mocks.client.send).toHaveBeenCalledWith('retry_invitation', { game_id: 'g1' });
  });

  it('updates the row to pending after an accepted retry', async () => {
    mockBackend([
      gameplay('g1', ME.id, 'pablo-id', { winner: null, reason: 'rejected' }, 'rejected')
    ]);

    render(HistoryPage);
    const card = (await screen.findAllByRole('listitem'))[0];
    await within(card).getByRole('button', { name: 'Retry' }).click();

    emit('invitation_retry_accepted', { game_id: 'g1', attempt: 1, remaining_attempts: 2 });

    await screen.findByText('Waiting for response');
    expect(within(card).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows a countdown button when the retry cooldown is active', async () => {
    mockBackend([
      gameplay('g1', ME.id, 'pablo-id', { winner: null, reason: 'rejected' }, 'rejected')
    ]);

    render(HistoryPage);
    const card = (await screen.findAllByRole('listitem'))[0];
    await within(card).getByRole('button', { name: 'Retry' }).click();

    emit('error', { code: 'RETRY_LIMIT_EXCEEDED', retry_after_seconds: 12 });

    expect(await screen.findByTestId('countdown-button')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-button')).toHaveTextContent('Retry in (12s)');
  });

  it('shows an error message and no cards when the games cannot be loaded', async () => {
    server.use(
      http.get('*/api/v2/gameplays/my-gameplays', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );

    render(HistoryPage);

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByText('No games played yet.')).not.toBeInTheDocument();
  });
});
