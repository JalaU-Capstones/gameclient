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
  describe('update', () => {
    it('sends only the provided fields and resolves on 204', async () => {
      let received: unknown;
      server.use(
        http.put('*/api/v2/users/u1', async ({ request }) => {
          received = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await expect(usersApi.update('u1', { username: 'ada' })).resolves.toBeUndefined();

      expect(received).toEqual({ username: 'ada' });
    });

    it('fails with a 409 ApiError when the email is already registered', async () => {
      server.use(
        http.put('*/api/v2/users/u1', () =>
          HttpResponse.json({ message: 'Email is currently registered' }, { status: 409 })
        )
      );

      const error = await usersApi
        .update('u1', { email: 'taken@example.com' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409 });
    });

    it('fails with a 403 ApiError when editing someone else', async () => {
      server.use(
        http.put('*/api/v2/users/other', () =>
          HttpResponse.json({ message: 'You can only modify your own account' }, { status: 403 })
        )
      );

      const error = await usersApi.update('other', { username: 'eve' }).catch((e: unknown) => e);

      expect(error).toMatchObject({ status: 403 });
    });
  });

  describe('delete', () => {
    it('resolves on 204', async () => {
      server.use(http.delete('*/api/v2/users/u1', () => new HttpResponse(null, { status: 204 })));

      await expect(usersApi.delete('u1')).resolves.toBeUndefined();
    });

    it('fails with a 403 ApiError when deleting someone else', async () => {
      server.use(
        http.delete('*/api/v2/users/other', () =>
          HttpResponse.json({ message: 'You can only delete your own account' }, { status: 403 })
        )
      );

      const error = await usersApi.delete('other').catch((e: unknown) => e);

      expect(error).toMatchObject({ status: 403 });
    });
  });
});
