import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import GamePage from './+page.svelte';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: never) => void>();
  return {
    refresh: vi.fn(),
    get: vi.fn(),
    goto: vi.fn(),
    handlers,
    play: vi.fn(),
    client: {
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
vi.mock('$lib/api/auth', () => ({ authApi: { refresh: mocks.refresh } }));
vi.mock('$lib/api/client', () => ({ httpClient: { get: mocks.get } }));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$lib/stores/ws', () => ({
  globalGameplaysClient: { getOrCreate: () => mocks.client }
}));

const host = {
  id: 'host',
  name: 'Ada',
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};
const guest = {
  id: 'guest',
  name: 'Bob',
  email: 'bob@example.com',
  registerDate: '2026-01-01T00:00:00Z'
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
    session.setUser(host);
    mocks.refresh.mockReset().mockResolvedValue({ access_token: 'token' });
    mocks.get.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v2/gameplays/')) {
        return {
          id: 'game-123',
          currentPositions: JSON.stringify({ board: startingBoard }),
          hostPlayer: 'host',
          guestPlayer: 'guest',
          playerTurn: 'host',
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
    mocks.handlers.clear();
    mocks.client.send.mockReset();
    mocks.client.connect.mockReset();
    mocks.play.mockReset();
  });

  it('renders an empty board while game data is loading', () => {
    mocks.refresh.mockReturnValue(new Promise(() => {}));
    render(GamePage);

    expect(screen.getByText('Loading Game...')).toBeInTheDocument();
  });

  it('displays the host and guest names after loading', async () => {
    render(GamePage);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('disables board cells when it is the opponent’s turn', async () => {
    session.setUser(guest);
    render(GamePage);

    await screen.findByText('Bob');

    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toBeDisabled();
  });

  it('sends a move when the current player clicks an empty cell', async () => {
    render(GamePage);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cell 0 0' }));

    expect(mocks.client.send).toHaveBeenCalledWith('play_move', {
      game_id: 'game-123',
      row: 0,
      col: 0
    });
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toHaveTextContent('X');
    expect(screen.getByRole('button', { name: 'Cell 0 0' })).toHaveClass('cell-symbol', 'cell-x');
  });

  it('uses responsive board sizing and pixel-style symbol sizing on narrow screens', async () => {
    window.innerWidth = 360;
    render(GamePage);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cell 0 0' }));
    const symbol = screen.getByRole('button', { name: 'Cell 0 0' });
    const board = symbol.closest('.grid-cols-3');

    expect(symbol).toHaveClass('cell-symbol');
    expect(board).toHaveClass('w-[min(90vw,400px)]');
  });

  it('applies the board, winner, and reason received with game_ended', async () => {
    render(GamePage);
    await screen.findByText('Ada');

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
