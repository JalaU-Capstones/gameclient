import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient } from '$lib/api/chat';
import { session } from './session';
import { createChatStore } from './chat.svelte';

const mocks = vi.hoisted(() => ({
  bootstrapSession: vi.fn(async () => ({ accessToken: 'jwt-token', user: { id: 'u1' } })),
  renewSessionToken: vi.fn(async () => 'jwt-token-2')
}));

vi.mock('$lib/auth/bootstrap', () => ({
  bootstrapSession: mocks.bootstrapSession,
  renewSessionToken: mocks.renewSessionToken
}));

type MockConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'idle';

class MockChatClient {
  state = writable<MockConnectionState>('disconnected') as ReturnType<
    typeof writable<MockConnectionState>
  >;

  connect = vi.fn();
  disconnect = vi.fn();
  disconnectAndWait = vi.fn(async () => {});
  isAlive = vi.fn(() => true);
  send = vi.fn();
  setReadOnlyMode = vi.fn();
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  onAny(handler: (event: string, payload?: unknown) => void): () => void {
    void handler;
    return () => {};
  }

  emit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  emitState(
    next:
      | 'idle'
      | 'connecting'
      | 'authenticating'
      | 'connected'
      | 'reconnecting'
      | 'disconnected'
      | 'error'
  ): void {
    this.state.set(next);
  }
}

describe('chatStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    session.setUser({ id: 'u1' } as never);
    mocks.bootstrapSession
      .mockReset()
      .mockResolvedValue({ accessToken: 'jwt-token', user: { id: 'u1' } });
    mocks.renewSessionToken.mockReset().mockResolvedValue('jwt-token-2');
  });

  afterEach(() => {
    vi.useRealTimers();
    session.clear();
  });

  it('starts with the expected idle state', () => {
    const store = createChatStore();

    expect(store.messages).toEqual([]);
    expect(store.usersCount).toBe(0);
    expect(store.status).toBe('idle');
    expect(store.isOpen).toBe(false);
    expect(store.error).toBeNull();
    expect(store.authError).toBeNull();
    expect(store.rateLimitUntil).toBeNull();
    expect(store.unreadCount).toBe(0);
  });

  it('initializes client state subscriptions and mirrors transitions', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    client.emitState('connecting');
    expect(store.status).toBe('connecting');

    client.emitState('connected');
    expect(store.status).toBe('connected');

    store.reset();
    client.emitState('error');
    expect(store.status).toBe('idle');
  });

  it('opens and connects once while open', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });
    client.isAlive.mockReturnValue(false);

    await store.open();
    await store.open();

    expect(mocks.bootstrapSession).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledWith('jwt-token');
    expect(store.isOpen).toBe(true);
  });

  it('sets authError and leaves the store closed when bootstrap fails', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });
    client.isAlive.mockReturnValue(false);
    mocks.bootstrapSession.mockRejectedValueOnce(new Error('boot failed'));

    await store.open();

    expect(store.isOpen).toBe(false);
    expect(store.authError).toBe('Authentication failed.');
    expect(store.status).toBe('error');
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('turns off the socket without dropping history on close', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });
    client.isAlive.mockReturnValue(false);
    await store.open();

    const first = {
      id: 'm1',
      user_id: 'u1',
      user_name: 'Ada',
      content: 'hello',
      timestamp: new Date().toISOString()
    };
    client.emit('chat_history', { messages: [first], users_count: 3 });
    store.close();

    expect(store.isOpen).toBe(false);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].content).toBe('hello');
  });

  it('replaces the buffer and tracks users_count from chat_history', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    client.emit('chat_history', {
      messages: [
        {
          id: 'm1',
          user_id: 'u1',
          user_name: 'Ada',
          content: 'first',
          timestamp: new Date().toISOString()
        },
        {
          id: 'm2',
          user_id: 'u2',
          user_name: 'Bob',
          content: 'second',
          timestamp: new Date().toISOString()
        }
      ],
      users_count: 7
    });

    expect(store.messages).toHaveLength(2);
    expect(store.usersCount).toBe(7);
    expect(store.messages[1].content).toBe('second');
  });

  it('increments unreadCount for peer messages only while closed', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });
    const base = new Date().toISOString();

    client.emit('chat_message', {
      id: 'm1',
      user_id: 'u2',
      user_name: 'Bob',
      content: 'hi',
      timestamp: base
    });
    expect(store.unreadCount).toBe(1);

    store.markRead();
    expect(store.unreadCount).toBe(0);

    store.open();
    client.emit('chat_message', {
      id: 'm2',
      user_id: 'u2',
      user_name: 'Bob',
      content: 'visible',
      timestamp: base
    });
    expect(store.unreadCount).toBe(0);

    client.emit('chat_message', {
      id: 'm3',
      user_id: 'u1',
      user_name: 'Ada',
      content: 'mine',
      timestamp: base
    });
    expect(store.unreadCount).toBe(0);
  });

  it('prunes to the last 200 messages and drops messages older than two hours', () => {
    vi.useFakeTimers();
    const now = new Date('2024-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    for (let i = 0; i < 210; i += 1) {
      client.emit('chat_message', {
        id: `m${i}`,
        user_id: 'u2',
        user_name: 'Bob',
        content: `msg-${i}`,
        timestamp: new Date(now - i * 1000).toISOString()
      });
    }

    expect(store.messages).toHaveLength(200);
    expect(store.messages.at(-1)?.id).toBe('m209');

    client.emit('chat_message', {
      id: 'old',
      user_id: 'u2',
      user_name: 'Bob',
      content: 'old',
      timestamp: new Date(now - 2 * 60 * 60 * 1000 - 1000).toISOString()
    });

    expect(store.messages.some((message) => message.id === 'old')).toBe(false);
  });

  it('sets users_count via chat_users_count events and ignores empty payloads', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    client.emit('chat_users_count', { count: 5 });
    client.emit('chat_history', undefined);
    client.emit('chat_message', undefined);

    expect(store.usersCount).toBe(5);
    expect(store.messages).toEqual([]);
  });

  it('skips open when already alive and clears auth errors on session_replaced', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    const onAuthFailure = vi.fn();
    store.initialize({ client, onAuthFailure });
    client.isAlive.mockReturnValue(true);

    void store.open();
    expect(mocks.bootstrapSession).not.toHaveBeenCalled();

    client.emit('auth_error', { reason: 'session_replaced' });
    expect(store.authError).toBeNull();
    expect(store.isOpen).toBe(false);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('resets the rate-limit window after timeout and cleans up on close code 4409', async () => {
    vi.useFakeTimers();
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    client.emit('chat_error', {
      code: 'CHAT_RATE_LIMITED',
      message: 'slow down',
      retry_after_seconds: 1
    });
    expect(store.rateLimitUntil).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1001);
    await store.send('after-wait');
    expect(client.send).toHaveBeenCalledWith('chat_send', { content: 'after-wait' });

    client.emit('closed', { code: 4409, reason: 'session_replaced' });
    expect(store.isOpen).toBe(false);
    expect(store.authError).toBeNull();
  });

  it('validates message inputs and sends trimmed payloads', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    await store.send('   ');
    expect(store.error).toBe('Message cannot be empty.');
    expect(client.send).not.toHaveBeenCalled();

    await store.send('x'.repeat(501));
    expect(store.error).toBe('Message cannot exceed 500 characters.');
    expect(client.send).not.toHaveBeenCalled();

    await store.send('  hi  ');
    expect(store.error).toBeNull();
    expect(client.send).toHaveBeenCalledWith('chat_send', { content: 'hi' });
  });

  it('blocks repeated sends in the rate-limit window and honors server rate-limit errors', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    for (let i = 0; i < 10; i += 1) {
      await store.send(`msg-${i}`);
    }
    await store.send('blocked');
    expect(store.error).toBe('Too many messages. Please wait a moment.');
    expect(store.rateLimitUntil).not.toBeNull();
    expect(client.send).toHaveBeenCalledTimes(10);

    client.emit('chat_error', {
      code: 'CHAT_RATE_LIMITED',
      message: 'Too fast',
      retry_after_seconds: 5
    });

    expect(store.rateLimitUntil).not.toBeNull();
    expect(store.error).toBe('Too fast');
  });

  it('refreshes expired tokens once and triggers auth failure on refresh error', async () => {
    vi.useFakeTimers();
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    const onAuthFailure = vi.fn();
    store.initialize({ client, onAuthFailure });

    const refreshPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('jwt-token-2'), 50);
    });
    mocks.renewSessionToken.mockReset().mockReturnValue(refreshPromise);

    client.emit('auth_error', { reason: 'invalid_token' });
    client.emit('auth_error', { reason: 'invalid_token' });
    expect(mocks.renewSessionToken).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(client.connect).toHaveBeenCalledWith('jwt-token-2');

    mocks.renewSessionToken.mockRejectedValueOnce(new Error('refresh failed'));
    client.emit('auth_error', { reason: 'expired_token' });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.authError).toBe('Authentication failed.');
    expect(store.status).toBe('error');
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('cleans up on session_replaced without invoking auth failure', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    const onAuthFailure = vi.fn();
    store.initialize({ client, onAuthFailure });
    store.open();

    client.emit('session_replaced', { reason: 'session_replaced' });

    expect(store.isOpen).toBe(false);
    expect(store.unreadCount).toBe(0);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('reset clears subscriptions and state', () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });
    client.emit('chat_message', {
      id: 'm1',
      user_id: 'u2',
      user_name: 'Bob',
      content: 'hi',
      timestamp: new Date().toISOString()
    });

    store.reset();
    client.emit('chat_message', {
      id: 'm2',
      user_id: 'u2',
      user_name: 'Bob',
      content: 'after-reset',
      timestamp: new Date().toISOString()
    });

    expect(store.messages).toEqual([]);
    expect(store.usersCount).toBe(0);
    expect(store.status).toBe('idle');
    expect(store.isOpen).toBe(false);
    expect(store.error).toBeNull();
    expect(store.authError).toBeNull();
    expect(store.rateLimitUntil).toBeNull();
    expect(store.unreadCount).toBe(0);
  });

  it('clearError clears errors', async () => {
    const client = new MockChatClient() as MockChatClient & ChatClient;
    const store = createChatStore();
    store.initialize({ client });

    await store.send('  ');
    store.clearError();

    expect(store.error).toBeNull();
  });
});
