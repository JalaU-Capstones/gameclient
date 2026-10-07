import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { usersApi } from './user';

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

function user(id: string, name: string) {
  return { id, name };
}

describe('usersApi', () => {
  describe('getById', () => {
    it('returns the user', async () => {
      server.use(http.get('*/api/v2/users/u1', () => HttpResponse.json(user('u1', 'laura'))));

      const result = await usersApi.getById('u1');

      expect(result.name).toBe('laura');
    });

    it('fails with an ApiError when the user does not exist', async () => {
      server.use(
        http.get('*/api/v2/users/nope', () =>
          HttpResponse.json({ message: 'User not found' }, { status: 404 })
        )
      );

      const error = await usersApi.getById('nope').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404 });
    });
  });

  describe('getNames', () => {
    it('returns a dictionary of id to name', async () => {
      server.use(
        http.get('*/api/v2/users/:id', ({ params }) =>
          HttpResponse.json(user(String(params.id), `name-${params.id}`))
        )
      );

      const names = await usersApi.getNames(['u1', 'u2']);

      expect(names).toEqual({ u1: 'name-u1', u2: 'name-u2' });
    });

    it('requests each id only once', async () => {
      let calls = 0;
      server.use(
        http.get('*/api/v2/users/:id', ({ params }) => {
          calls += 1;
          return HttpResponse.json(user(String(params.id), 'x'));
        })
      );

      await usersApi.getNames(['u1', 'u1', 'u1']);

      expect(calls).toBe(1);
    });

    it('leaves out users that cannot be loaded', async () => {
      server.use(
        http.get('*/api/v2/users/good', () => HttpResponse.json(user('good', 'pablo'))),
        http.get('*/api/v2/users/gone', () =>
          HttpResponse.json({ message: 'User not found' }, { status: 404 })
        )
      );

      const names = await usersApi.getNames(['good', 'gone']);

      expect(names).toEqual({ good: 'pablo' });
    });

    it('returns an empty dictionary for an empty list', async () => {
      expect(await usersApi.getNames([])).toEqual({});
    });
  });
});
