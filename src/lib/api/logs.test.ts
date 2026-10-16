import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { logsApi } from './logs';

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

describe('logsApi', () => {
  it('loads the current page and normalizes levels to lowercase', async () => {
    server.use(
      http.get('*/api/v2/logs/me', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('offset')).toBe('0');
        return HttpResponse.json({
          total: 1,
          limit: 20,
          offset: 0,
          items: [
            {
              id: 'log-1',
              level: 'WARNING',
              eventType: 'game_abandoned',
              message: 'Player left',
              playerId: 'user-1',
              gameplayId: 'game-1',
              metadata: { reason: 'abandon' },
              timestamp: '2026-10-16T12:00:00Z'
            }
          ]
        });
      })
    );

    const page = await logsApi.listMine({ limit: 20, offset: 0 });

    expect(page.total).toBe(1);
    expect(page.items[0].level).toBe('warning');
    expect(page.items[0].eventType).toBe('game_abandoned');
    expect(page.items[0].metadata).toEqual({ reason: 'abandon' });
  });

  it('omits empty query params', async () => {
    server.use(
      http.get('*/api/v2/logs/me', ({ request }) => {
        const url = new URL(request.url);
        expect(url.search).toBe('');
        return HttpResponse.json({ total: 0, limit: 50, offset: 0, items: [] });
      })
    );

    const page = await logsApi.listMine();
    expect(page.items).toEqual([]);
  });
});
