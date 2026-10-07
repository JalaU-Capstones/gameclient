import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/svelte';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { session } from '$lib/stores/session';
import HistoryPage from './+page.svelte';

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
  matchResult: object | null
) {
  return {
    id,
    currentPositions: '[]',
    hostPlayer,
    guestPlayer,
    playerTurn: hostPlayer,
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

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  session.setUser(ME);
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
    expect(within(cards[2]).getByText('Pending')).toBeInTheDocument();
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
