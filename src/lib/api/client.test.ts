import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './client';
import { TimeoutError } from './errors';

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

  it('returns undefined for an empty response body', async () => {
    server.use(
      http.get('*/api/empty', () => new HttpResponse(null, { headers: { 'content-length': '0' } }))
    );

    await expect(createHttpClient().get('/api/empty')).resolves.toBeUndefined();
  });

  it('returns null when a successful JSON response contains malformed JSON', async () => {
    server.use(
      http.get(
        '*/api/malformed-json',
        () => new HttpResponse('{', { headers: { 'content-type': 'application/json' } })
      )
    );

    await expect(createHttpClient().get('/api/malformed-json')).resolves.toBeNull();
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

  it('extracts error codes and falls back when an error body has no message', async () => {
    server.use(
      http.get('*/api/error-code', () =>
        HttpResponse.json({ code: 'INVALID_REQUEST' }, { status: 422 })
      )
    );

    await expect(createHttpClient().get('/api/error-code')).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'INVALID_REQUEST',
      message: 'Request failed with status 422'
    });
  });

  it('returns successful non-JSON response text', async () => {
    server.use(http.get('*/api/text', () => new HttpResponse('ready')));

    await expect(createHttpClient().get('/api/text')).resolves.toBe('ready');
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

    await expect(client.get('/api/offline')).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'Network request failed'
    });
  });

  it('maps an externally aborted request to TimeoutError', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          })
      )
    );
    const controller = new AbortController();
    try {
      const pending = createHttpClient().get('/api/aborted', { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
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
