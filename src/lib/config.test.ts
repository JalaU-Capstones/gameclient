import { afterEach, describe, expect, it, vi } from 'vitest';

describe('application configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('$env/static/public');
    vi.resetModules();
  });

  it('uses defaults when public environment variables are missing', async () => {
    vi.doMock('$env/static/public', () => ({
      PUBLIC_API_BASE: undefined,
      PUBLIC_WS_BASE: undefined,
      PUBLIC_REQUEST_TIMEOUT_MS: undefined
    }));
    vi.resetModules();

    const { config } = await import('./config');

    expect(config).toEqual({
      apiBaseUrl: '',
      wsBaseUrl: '',
      requestTimeoutMs: 15000
    });
  });

  it('uses configured values and falls back for empty or malformed values', async () => {
    vi.doMock('$env/static/public', () => ({
      PUBLIC_API_BASE: 'https://api.example.test/',
      PUBLIC_WS_BASE: '',
      PUBLIC_REQUEST_TIMEOUT_MS: 'not-a-number'
    }));
    vi.resetModules();

    const { config } = await import('./config');

    expect(config.apiBaseUrl).toBe('https://api.example.test/');
    expect(config.wsBaseUrl).toBe('');
    expect(Number.isNaN(config.requestTimeoutMs)).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/token|secret|credential/i);
  });

  it('normalizes paths and converts HTTP, HTTPS, WS, and WSS bases', async () => {
    vi.doMock('$env/static/public', () => ({
      PUBLIC_API_BASE: undefined,
      PUBLIC_WS_BASE: undefined,
      PUBLIC_REQUEST_TIMEOUT_MS: undefined
    }));
    vi.resetModules();
    const { buildWsUrl, config } = await import('./config');

    config.wsBaseUrl = 'https://socket.example.test///';
    expect(buildWsUrl('events')).toBe('wss://socket.example.test/events');
    config.wsBaseUrl = 'http://socket.example.test/';
    expect(buildWsUrl('/events')).toBe('ws://socket.example.test/events');
    config.wsBaseUrl = 'wss://socket.example.test/';
    expect(buildWsUrl('events')).toBe('wss://socket.example.test/events');
    config.wsBaseUrl = 'ws://socket.example.test/';
    expect(buildWsUrl('/events')).toBe('ws://socket.example.test/events');
  });

  it('uses the page origin for an empty or malformed WebSocket base', async () => {
    vi.doMock('$env/static/public', () => ({
      PUBLIC_API_BASE: undefined,
      PUBLIC_WS_BASE: undefined,
      PUBLIC_REQUEST_TIMEOUT_MS: undefined
    }));
    vi.resetModules();
    const { buildWsUrl, config } = await import('./config');
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'client.example.test' } });

    config.wsBaseUrl = '';
    expect(buildWsUrl('events')).toBe('wss://client.example.test/events');
    config.wsBaseUrl = 'socket.example.test';
    expect(buildWsUrl('/events')).toBe('wss://client.example.test/events');
  });
});
