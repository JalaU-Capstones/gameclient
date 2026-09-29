import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHttpClient } from './client';
import { NetworkError, TimeoutError } from './errors';

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

describe('createHttpClient', () => {
  it('returns parsed JSON for a successful GET request', async () => {
    server.use(
      http.get('*/api/users', () => HttpResponse.json({ users: [{ id: 'u1', name: 'Ada' }] }))
    );

    const client = createHttpClient();
    const payload = await client.get<{ users: { id: string; name: string }[] }>('/api/users');

    expect(payload).toEqual({ users: [{ id: 'u1', name: 'Ada' }] });
  });

  it('sends JSON payloads with the expected content type', async () => {
    server.use(
      http.post('*/api/users', async ({ request }) => {
        expect(request.headers.get('content-type')).toBe('application/json');
        expect(request.credentials).toBe('include');
        expect(await request.json()).toEqual({ name: 'Grace', email: 'grace@example.com' });

        return HttpResponse.json({ id: 'u2', name: 'Grace' }, { status: 201 });
      })
    );

    const client = createHttpClient();
    const payload = await client.post<{ id: string; name: string }>('/api/users', {
      name: 'Grace',
      email: 'grace@example.com'
    });

    expect(payload).toEqual({ id: 'u2', name: 'Grace' });
  });

  it('returns undefined for 204 responses', async () => {
    server.use(http.delete('*/api/session', () => new HttpResponse(null, { status: 204 })));

    const client = createHttpClient();
    const payload = await client.delete('/api/session');

    expect(payload).toBeUndefined();
  });

  it('uses include credentials for cookie auth', async () => {
    server.use(
      http.get('*/api/profile', ({ request }) => {
        expect(request.credentials).toBe('include');
        return HttpResponse.json({ id: 'u1' });
      })
    );

    const client = createHttpClient();
    await client.get('/api/profile');
  });

  it('throws ApiError with a message for 400 responses', async () => {
    server.use(
      http.get('*/api/users/1', () =>
        HttpResponse.json({ message: 'User not found' }, { status: 400 })
      )
    );

    const client = createHttpClient();

    await expect(client.get('/api/users/1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'User not found'
    });
  });

  it('falls back to a generic message for 500 responses without a JSON body', async () => {
    server.use(http.get('*/api/crash', () => new HttpResponse(null, { status: 500 })));

    const client = createHttpClient();

    await expect(client.get('/api/crash')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Request failed with status 500'
    });
  });

  it('throws TimeoutError when the request takes too long', async () => {
    server.use(
      http.get('*/api/slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json({ ok: true });
      })
    );

    const client = createHttpClient();

    await expect(client.get('/api/slow', { timeoutMs: 25 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('throws NetworkError on network failures', async () => {
    server.use(http.get('*/api/offline', () => HttpResponse.error()));

    const client = createHttpClient();

    await expect(client.get('/api/offline')).rejects.toBeInstanceOf(NetworkError);
  });

  it('respects a custom base URL', async () => {
    server.use(
      http.get('https://example.com/api/status', () => HttpResponse.json({ status: 'ok' }))
    );

    const client = createHttpClient('https://example.com');
    const payload = await client.get<{ status: string }>('/api/status');

    expect(payload).toEqual({ status: 'ok' });
  });
});
