import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import LogsPage from './+page.svelte';

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: vi.fn() }
}));

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

function logItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    level: 'INFO',
    eventType: 'ws_connected',
    message: 'WebSocket connected',
    playerId: 'user-1',
    gameplayId: null,
    metadata: { path: '/api/v2/ws/gameplays' },
    timestamp: '2026-10-16T15:30:00Z',
    ...overrides
  };
}

describe('Logs page', () => {
  it('shows a loading state and then the summarized log list', async () => {
    server.use(
      http.get('*/api/v2/logs/me', () =>
        HttpResponse.json({
          total: 1,
          limit: 20,
          offset: 0,
          items: [logItem()]
        })
      )
    );

    render(LogsPage);

    expect(screen.getByText('Loading logs...')).toBeInTheDocument();
    expect(await screen.findByText('ws connected')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
    expect(screen.getByText('WebSocket connected')).toBeInTheDocument();
    expect(screen.queryByTestId('log-details')).not.toBeInTheDocument();
  });

  it('expands a row to reveal the full message and metadata', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/v2/logs/me', () =>
        HttpResponse.json({
          total: 1,
          limit: 20,
          offset: 0,
          items: [logItem({ message: 'A'.repeat(120) })]
        })
      )
    );

    render(LogsPage);
    await screen.findByText(/A{20}/);

    await user.click(screen.getByRole('button', { name: /Details/i }));

    const details = await screen.findByTestId('log-details');
    expect(within(details).getByText('A'.repeat(120))).toBeInTheDocument();
    expect(within(details).getByText(/"path": "\/api\/v2\/ws\/gameplays"/)).toBeInTheDocument();
  });

  it('filters the current page on the client without calling the server again', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/api/v2/logs/me', () => {
        calls += 1;
        return HttpResponse.json({
          total: 2,
          limit: 20,
          offset: 0,
          items: [
            logItem({ id: 'a', level: 'INFO', eventType: 'ws_connected', message: 'ok' }),
            logItem({
              id: 'b',
              level: 'ERROR',
              eventType: 'game_abandoned',
              message: 'left the match'
            })
          ]
        });
      })
    );

    render(LogsPage);
    await screen.findByText('ws connected');
    expect(calls).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Error' }));

    expect(screen.queryByText('ws connected')).not.toBeInTheDocument();
    expect(screen.getByText('game abandoned')).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('disables previous and next when the current filter leaves no rows', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/v2/logs/me', () =>
        HttpResponse.json({
          total: 90,
          limit: 20,
          offset: 20,
          items: [logItem({ id: 'a', level: 'INFO', message: 'ok' })]
        })
      )
    );

    render(LogsPage);
    await screen.findByText('ok');

    await user.click(screen.getByRole('button', { name: 'Warning' }));

    expect(screen.getByText('No warning logs on this page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('paginates with limit and offset from the server', async () => {
    const user = userEvent.setup();
    const offsets: string[] = [];
    server.use(
      http.get('*/api/v2/logs/me', ({ request }) => {
        const url = new URL(request.url);
        offsets.push(url.searchParams.get('offset') ?? 'missing');
        const offset = Number(url.searchParams.get('offset') ?? 0);
        return HttpResponse.json({
          total: 40,
          limit: 20,
          offset,
          items: [
            logItem({
              id: `log-${offset}`,
              message: offset === 0 ? 'first page' : 'second page'
            })
          ]
        });
      })
    );

    render(LogsPage);
    expect(await screen.findByText('first page')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('second page')).toBeInTheDocument();
    expect(offsets).toEqual(['0', '20']);
  });
});
