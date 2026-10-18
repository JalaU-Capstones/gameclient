import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import WS from 'vitest-websocket-mock';
import { createChatClient } from './chat';

describe('createChatClient', () => {
  beforeEach(() => {
    vi.useRealTimers();
    WS.clean();
  });

  afterEach(() => {
    vi.useRealTimers();
    WS.clean();
  });

  it('sends auth as the first frame after connecting', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/chat', { jsonProtocol: true });
    const client = createChatClient();

    client.connect('jwt-token');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'jwt-token' } });
    expect(get(client.state)).toBe('authenticating');
    client.disconnect();
  });

  it('starts the 30s ping loop after auth_ok', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/chat', { jsonProtocol: true });
    const client = createChatClient();

    client.connect('ping-token');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'ping-token' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'user-1' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.send('ping', {});
    await expect(server).toReceiveMessage({ event: 'ping', payload: {} });

    client.disconnect();
  });

  it('forwards chat_send and dispatches chat events to listeners', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/chat', { jsonProtocol: true });
    const client = createChatClient();
    const history = vi.fn();
    const message = vi.fn();
    const users = vi.fn();
    const error = vi.fn();

    client.on('chat_history', history);
    client.on('chat_message', message);
    client.on('chat_users_count', users);
    client.on('chat_error', error);

    client.connect('events-token');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'events-token' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u1' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.send('chat_send', { content: 'hello there' });
    await expect(server).toReceiveMessage({
      event: 'chat_send',
      payload: { content: 'hello there' }
    });

    const payload = {
      messages: [
        {
          id: 'm1',
          user_id: 'u1',
          user_name: 'Alice',
          content: 'hi',
          timestamp: '2026-01-01T00:00:00Z'
        }
      ],
      users_count: 1
    };
    server.send({ event: 'chat_history', payload });
    server.send({
      event: 'chat_message',
      payload: {
        id: 'm2',
        user_id: 'u2',
        user_name: 'Bob',
        content: 'yo',
        timestamp: '2026-01-01T00:00:01Z'
      }
    });
    server.send({ event: 'chat_users_count', payload: { count: 2 } });
    server.send({
      event: 'chat_error',
      payload: { code: 'CHAT_RATE_LIMITED', message: 'slow down', retry_after_seconds: 5 }
    });

    await vi.waitFor(() => expect(history).toHaveBeenCalledWith(payload));
    await vi.waitFor(() =>
      expect(message).toHaveBeenCalledWith(expect.objectContaining({ content: 'yo' }))
    );
    await vi.waitFor(() => expect(users).toHaveBeenCalledWith({ count: 2 }));
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith({
        code: 'CHAT_RATE_LIMITED',
        message: 'slow down',
        retry_after_seconds: 5
      })
    );

    client.disconnect();
  });

  it('blocks chat_send in read-only mode but still allows ping', async () => {
    const server = new WS('ws://localhost:3000/api/v2/ws/chat', { jsonProtocol: true });
    const client = createChatClient();

    client.connect('readonly-token');
    await server.connected;
    await expect(server).toReceiveMessage({ event: 'auth', payload: { token: 'readonly-token' } });
    server.send({ event: 'auth_ok', payload: { user_id: 'u1' } });
    await vi.waitFor(() => expect(get(client.state)).toBe('connected'));

    client.setReadOnlyMode(true);
    client.send('chat_send', { content: 'blocked' });
    client.send('ping', {});

    expect(server.messages).not.toContainEqual({
      event: 'chat_send',
      payload: { content: 'blocked' }
    });
    await expect(server).toReceiveMessage({ event: 'ping', payload: {} });
    client.disconnect();
  });

  it('does not reconnect after auth_error invalid_token', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.useFakeTimers();

    class MockWebSocket {
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances: MockWebSocket[] = [];

      readyState = MockWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      send = vi.fn();
      close = vi.fn((code?: number, reason?: string) => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code: code ?? 1000, reason: reason ?? 'closed' } as CloseEvent);
      });

      constructor() {
        MockWebSocket.instances.push(this);
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    try {
      const client = createChatClient();
      const authError = vi.fn();
      client.on('auth_error', authError);

      client.connect('invalid-token');
      const socket = MockWebSocket.instances[0];
      socket.onopen?.(new Event('open'));
      socket.onmessage?.({
        data: JSON.stringify({ event: 'auth_error', payload: { reason: 'invalid_token' } })
      } as MessageEvent);

      await vi.waitFor(() => expect(get(client.state)).toBe('disconnected'));
      expect(authError).toHaveBeenCalledWith({ reason: 'invalid_token' });
      expect(MockWebSocket.instances).toHaveLength(1);
      client.disconnect();
    } finally {
      vi.stubGlobal('WebSocket', originalWebSocket);
    }
  });

  it('does not reconnect after explicit disconnect()', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.useFakeTimers();

    class MockWebSocket {
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances: MockWebSocket[] = [];

      readyState = MockWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      send = vi.fn();
      close = vi.fn((code?: number, reason?: string) => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code: code ?? 1000, reason: reason ?? 'closed' } as CloseEvent);
      });

      constructor() {
        MockWebSocket.instances.push(this);
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    try {
      const client = createChatClient();
      client.connect('disconnect-token');
      const socket = MockWebSocket.instances[0];
      socket.onopen?.(new Event('open'));
      socket.onmessage?.({
        data: JSON.stringify({ event: 'auth_ok', payload: { user_id: 'u1' } })
      } as MessageEvent);
      await vi.advanceTimersByTimeAsync(1);
      expect(get(client.state)).toBe('connected');

      client.disconnect();
      await vi.waitFor(() => expect(get(client.state)).toBe('disconnected'));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      vi.stubGlobal('WebSocket', originalWebSocket);
    }
  });

  it('reconnects after transient network failures', async () => {
    const originalWebSocket = globalThis.WebSocket;
    vi.useFakeTimers();

    class MockWebSocket {
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      static instances: MockWebSocket[] = [];

      readyState = MockWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      send = vi.fn();
      close = vi.fn((code?: number, reason?: string) => {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code: code ?? 1000, reason: reason ?? 'closed' } as CloseEvent);
      });

      constructor() {
        MockWebSocket.instances.push(this);
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    try {
      const client = createChatClient();
      client.connect('reconnect-token');
      const socket = MockWebSocket.instances[0];
      socket.onopen?.(new Event('open'));
      socket.onmessage?.({
        data: JSON.stringify({ event: 'auth_ok', payload: { user_id: 'u1' } })
      } as MessageEvent);
      await vi.advanceTimersByTimeAsync(1);
      expect(get(client.state)).toBe('connected');

      socket.close(1001, 'network-reset');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(get(client.state)).toBe('reconnecting');
      client.disconnect();
    } finally {
      vi.stubGlobal('WebSocket', originalWebSocket);
    }
  });
});
