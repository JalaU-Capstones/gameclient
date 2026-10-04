import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/config', () => ({
  config: {
    apiBaseUrl: '',
    wsBaseUrl: '',
    requestTimeoutMs: 15000
  },
  buildWsUrl: (path: string) => `ws://localhost:3000${path}`
}));

import WS from 'vitest-websocket-mock';
import { get } from 'svelte/store';
import { createPresenceClient, createWebSocketClient } from './ws';

describe('createWebSocketClient', () => {
  beforeEach(() => {
    vi.useRealTimers();
    WS.clean();
  });

  afterEach(() => {
    WS.clean();
  });

  it('sends an auth message on connect and moves to connected after auth_ok', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 250,
      pingIntervalMs: 500
    });
    const authHandler = vi.fn();
    client.on('auth_ok', authHandler);

    client.connect('token-123');

    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-123' } });

    server.send({ event: 'auth_ok', payload: { user_id: 'u1' } });

    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));
    expect(authHandler).toHaveBeenCalledWith({ user_id: 'u1' });
  });

  it('closes with 4401 and does not reconnect on auth_error', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 200,
      pingIntervalMs: 1000,
      maxReconnectAttempts: 2,
      baseReconnectDelayMs: 10
    });

    client.connect('token-abc');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-abc' } });
    server.send({ event: 'auth_error', payload: { code: 'INVALID_TOKEN', message: 'bad token' } });

    await vi.waitFor(() => expect(get(client.state)).toBe('disconnected'));
    expect(server.messages).toContainEqual({ event: 'auth', payload: { token: 'token-abc' } });
  });

  it('closes when auth times out and does not reconnect', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 25,
      pingIntervalMs: 200,
      maxReconnectAttempts: 2,
      baseReconnectDelayMs: 10
    });

    client.connect('token-timeout');
    await server.connected;

    await vi.waitFor(() => expect(get(client.state)).toBe('disconnected'), { timeout: 500 });
    expect(server.messages).toEqual([{ event: 'auth', payload: { token: 'token-timeout' } }]);
  });

  it('sends a payload when the socket is connected', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000
    });

    client.connect('token-send');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-send' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-send' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.send('game_message', { text: 'hello' });

    await expect(server).toReceiveMessage({ event: 'game_message', payload: { text: 'hello' } });
  });

  it('sends a presence heartbeat every 25 seconds', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/presence', { jsonProtocol: true });
    const client = createPresenceClient();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    client.connect('token-presence');
    await server.connected;
    await expect(server).toReceiveMessage({
      event: 'auth',
      payload: { token: 'token-presence' }
    });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-presence' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    const heartbeat = setIntervalSpy.mock.calls.find(([, interval]) => interval === 25_000)?.[0];
    expect(heartbeat).toBeTypeOf('function');
    if (typeof heartbeat === 'function') heartbeat();

    await expect(server).toReceiveMessage({ event: 'ping', payload: {} });
    client.disconnect();
    setIntervalSpy.mockRestore();
  });

  it('ignores send calls on disconnected sockets', () => {
    const client = createWebSocketClient({ path: '/api/v2/ws/gameplays' });

    expect(() => client.send('ping', { value: 1 })).not.toThrow();
  });

  it('dispatches event handlers and supports unsubscribe', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000
    });
    const handler = vi.fn();

    client.connect('token-events');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-events' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-events' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    const unsubscribe = client.on('game_message', handler);
    server.send({ event: 'game_message', payload: { message: 'hello from server' } });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ message: 'hello from server' }));

    unsubscribe();
    server.send({ event: 'game_message', payload: { message: 'ignored' } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores pong messages and does not dispatch them to handlers', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000
    });
    const handler = vi.fn();

    client.connect('token-pong');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-pong' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-pong' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.on('pong', handler);
    server.send({ event: 'pong', payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).not.toHaveBeenCalled();
  });

  it('warns on error events and does not forward them to handlers', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000
    });
    const handler = vi.fn();

    client.connect('token-error');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-error' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-error' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.on('error', handler);
    server.send({ event: 'error', payload: { code: 'BOOM', message: 'bad payload' } });
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    expect(handler).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('reconnects after an unexpected close with exponential backoff', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000,
      maxReconnectAttempts: 2,
      baseReconnectDelayMs: 20,
      maxReconnectDelayMs: 60
    });

    client.connect('token-reconnect');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'token-reconnect' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u-reconnect' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    server.close();
    await new Promise((resolve) => setTimeout(resolve, 120));

    await vi.waitFor(
      () => {
        expect(server.messages).toContainEqual({
          event: 'auth',
          payload: { token: 'token-reconnect' }
        });
      },
      { timeout: 1000 }
    );
  });

  it('disconnect stops future reconnect attempts', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/gameplays', { jsonProtocol: true });
    const client = createWebSocketClient({
      path: '/api/v2/ws/gameplays',
      authTimeoutMs: 100,
      pingIntervalMs: 1000,
      maxReconnectAttempts: 3,
      baseReconnectDelayMs: 20,
      maxReconnectDelayMs: 60
    });

    client.connect('token-disconnect');
    await server.connected;
    await expect(server).toReceiveMessage({
      event: 'auth',
      payload: { token: 'token-disconnect' }
    });
    server.close();
    client.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(get(client.state)).toBe('disconnected');
  });
});
