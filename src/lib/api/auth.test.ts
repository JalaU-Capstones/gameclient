import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authApi } from './auth';
import { NetworkError } from './errors';

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

describe('authApi', () => {
  describe('register', () => {
    it('sends registration details and returns the authenticated user', async () => {
      const response = {
        access_token: 'abc',
        token_type: 'bearer',
        user: {
          id: 'u1',
          name: 'Laura',
          email: 'laura@test.com',
          registerDate: '2026-10-01T12:00:00Z'
        }
      };
      server.use(
        http.post('*/api/v2/auth/register', async ({ request }) => {
          expect(await request.json()).toEqual({
            name: 'Laura',
            email: 'laura@test.com',
            password: 'clave12345'
          });
          return HttpResponse.json(response, { status: 201 });
        })
      );

      await expect(
        authApi.register({
          name: 'Laura',
          email: 'laura@test.com',
          password: 'clave12345'
        })
      ).resolves.toEqual(response);
    });
  });

  describe('login', () => {
    it('sends email and password as JSON with a POST request', async () => {
      server.use(
        http.post('*/api/v2/auth/login', async ({ request }) => {
          expect(request.headers.get('content-type')).toBe('application/json');
          expect(request.credentials).toBe('include');
          expect(await request.json()).toEqual({
            email: 'laura@test.com',
            password: 'clave12345'
          });

          return HttpResponse.json({ access_token: 'abc', token_type: 'bearer' });
        })
      );

      await expect(
        authApi.login({ email: 'laura@test.com', password: 'clave12345' })
      ).resolves.toBeDefined();
    });

    it('raises ApiError 401 when the credentials are wrong', async () => {
      server.use(
        http.post('*/api/v2/auth/login', () =>
          HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
        )
      );

      await expect(
        authApi.login({ email: 'laura@test.com', password: 'mala-clave' })
      ).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        message: 'Invalid credentials'
      });
    });

    it('raises NetworkError when the backend is unreachable', async () => {
      server.use(http.post('*/api/v2/auth/login', () => HttpResponse.error()));

      await expect(
        authApi.login({ email: 'laura@test.com', password: 'clave12345' })
      ).rejects.toBeInstanceOf(NetworkError);
    });
  });

  describe('me', () => {
    it('returns the authenticated user', async () => {
      const user = {
        id: 'u1',
        name: 'Laura',
        email: 'laura@test.com',
        registerDate: '2026-10-01T12:00:00Z'
      };
      server.use(http.get('*/api/v2/auth/me', () => HttpResponse.json(user)));

      await expect(authApi.me()).resolves.toEqual(user);
    });

    it('raises ApiError 401 when there is no active session', async () => {
      server.use(
        http.get('*/api/v2/auth/me', () =>
          HttpResponse.json({ message: 'Not authenticated' }, { status: 401 })
        )
      );

      await expect(authApi.me()).rejects.toMatchObject({
        name: 'ApiError',
        status: 401
      });
    });
  });

  describe('logout', () => {
    it('sends a POST request and resolves with nothing on 204', async () => {
      server.use(http.post('*/api/v2/auth/logout', () => new HttpResponse(null, { status: 204 })));

      await expect(authApi.logout()).resolves.toBeUndefined();
    });
  });
});
