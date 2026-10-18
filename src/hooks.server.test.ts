import { describe, expect, it, vi } from 'vitest';
import { handle, validateOrigin } from './hooks.server';

describe('hooks.server', () => {
  it('allows a development origin even when it is localhost', () => {
    expect(() =>
      validateOrigin({ NODE_ENV: 'development', ORIGIN: 'http://localhost:3000' })
    ).not.toThrow();
  });

  it('allows a production origin when it is public', () => {
    expect(() =>
      validateOrigin({ NODE_ENV: 'production', ORIGIN: 'https://app.example.com' })
    ).not.toThrow();
  });

  it('throws when ORIGIN is missing in production', () => {
    expect(() => validateOrigin({ NODE_ENV: 'production' })).toThrow(/ORIGIN must be set/);
  });

  it('throws when ORIGIN is localhost', () => {
    expect(() =>
      validateOrigin({ NODE_ENV: 'production', ORIGIN: 'http://localhost:3000' })
    ).toThrow(/must not point to localhost/);
  });

  it('throws when ORIGIN is 127.0.0.1', () => {
    expect(() =>
      validateOrigin({ NODE_ENV: 'production', ORIGIN: 'http://127.0.0.1:3000' })
    ).toThrow(/must not point to localhost/);
  });

  it('throws when ORIGIN is 0.0.0.0', () => {
    expect(() => validateOrigin({ NODE_ENV: 'production', ORIGIN: 'http://0.0.0.0:3000' })).toThrow(
      /must not point to localhost/
    );
  });

  it('returns when SKIP_ORIGIN_GUARD is true', () => {
    expect(() =>
      validateOrigin({
        NODE_ENV: 'production',
        ORIGIN: 'http://localhost:3000',
        SKIP_ORIGIN_GUARD: 'true'
      })
    ).not.toThrow();
  });

  it('applies all security headers to a response', async () => {
    const resolve = vi.fn(async () => new Response('ok'));
    const response = await handle({ event: {} as never, resolve: resolve as never });

    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    );
  });

  it('preserves existing headers while applying the security ones', async () => {
    const resolve = vi.fn(async () => {
      const response = new Response('ok');
      response.headers.set('x-custom', 'value');
      return response;
    });

    const response = await handle({ event: {} as never, resolve: resolve as never });
    expect(response.headers.get('x-custom')).toBe('value');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('overwrites pre-existing security headers', async () => {
    const resolve = vi.fn(async () => {
      const response = new Response('ok');
      response.headers.set('x-frame-options', 'SAMEORIGIN');
      return response;
    });

    const response = await handle({ event: {} as never, resolve: resolve as never });
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});
