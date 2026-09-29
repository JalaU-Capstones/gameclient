import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { healthApi } from './health';

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

describe('healthApi', () => {
  it('returns the health payload on a successful check', async () => {
    server.use(http.get('*/health', () => HttpResponse.json({ status: 'ok' })));

    await expect(healthApi.check()).resolves.toEqual({ status: 'ok' });
  });

  it('raises ApiError when the backend reports a failure', async () => {
    server.use(
      http.get('*/health', () => HttpResponse.json({ message: 'DB down' }, { status: 503 }))
    );

    await expect(healthApi.check()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'DB down'
    });
  });
});
