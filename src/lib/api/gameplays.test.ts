import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { gameplaysApi } from './gameplays';

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

function rawGameplay(id: string, matchResult: string | null) {
  return {
    id,
    currentPositions: '[]',
    hostPlayer: 'host-1',
    guestPlayer: 'guest-1',
    playerTurn: 'host-1',
    matchResult,
    createdDate: '2026-10-01T12:00:00Z',
    updatedDate: '2026-10-01T12:05:00Z'
  };
}

describe('gameplaysApi', () => {
  describe('listMine', () => {
    it('translates matchResult from text into an object', async () => {
      server.use(
        http.get('*/api/v2/gameplays/my-gameplays', () =>
          HttpResponse.json([rawGameplay('g1', '{"winner": null, "reason": "draw"}')])
        )
      );

      const result = await gameplaysApi.listMine();

      expect(result).toHaveLength(1);
      expect(result[0].matchResult).toEqual({ winner: null, reason: 'draw' });
    });

    it('keeps matchResult as null for games still in progress', async () => {
      server.use(
        http.get('*/api/v2/gameplays/my-gameplays', () =>
          HttpResponse.json([rawGameplay('g1', null)])
        )
      );

      const result = await gameplaysApi.listMine();

      expect(result[0].matchResult).toBeNull();
    });

    it('skips games whose matchResult cannot be read', async () => {
      server.use(
        http.get('*/api/v2/gameplays/my-gameplays', () =>
          HttpResponse.json([
            rawGameplay('good', '{"winner": "host", "reason": "line"}'),
            rawGameplay('broken', '{roto')
          ])
        )
      );

      const result = await gameplaysApi.listMine();

      expect(result.map((g) => g.id)).toEqual(['good']);
    });

    it('returns an empty list when the user has no games', async () => {
      server.use(http.get('*/api/v2/gameplays/my-gameplays', () => HttpResponse.json([])));

      expect(await gameplaysApi.listMine()).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns the game with matchResult translated', async () => {
      server.use(
        http.get('*/api/v2/gameplays/g1', () =>
          HttpResponse.json(rawGameplay('g1', '{"winner": "user-9", "reason": "abandon"}'))
        )
      );

      const result = await gameplaysApi.getById('g1');

      expect(result.id).toBe('g1');
      expect(result.matchResult).toEqual({ winner: 'user-9', reason: 'abandon' });
    });

    it.each([
      [403, 'You did not play this game'],
      [404, 'Gameplay not found']
    ])('fails with an ApiError carrying status %i', async (status, message) => {
      server.use(
        http.get('*/api/v2/gameplays/g1', () => HttpResponse.json({ message }, { status }))
      );

      const error = await gameplaysApi.getById('g1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, message });
    });
  });
});
