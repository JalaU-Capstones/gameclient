import { get, writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  createGameplaysClient: vi.fn(),
  createPresenceClient: vi.fn(),
  connect: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  claimGameplayOwnership: vi.fn(),
  broadcastGameplayEvent: vi.fn(),
  subscribeGameplayEvents: vi.fn()
}));

vi.mock('$lib/api/ws', async () => {
  const actual = await vi.importActual<typeof import('$lib/api/ws')>('$lib/api/ws');
  return {
    ...actual,
    createGameplaysClient: mocks.createGameplaysClient,
    createPresenceClient: mocks.createPresenceClient
  };
});
vi.mock('$lib/auth/sessionLock', () => ({
  broadcastGameplayEvent: mocks.broadcastGameplayEvent,
  claimGameplayOwnership: mocks.claimGameplayOwnership,
  subscribeGameplayEvents: mocks.subscribeGameplayEvents
}));

import { createWebSocketClient } from '$lib/api/ws';
import {
  globalGameplaysClient,
  globalPresenceClient,
  createCoordinatedGameplaysClient,
  requestPresenceReconnect,
  setLastPresenceToken,
  setPresenceReconnectRequest,
  standbyMode
} from './ws';

describe('globalGameplaysClient', () => {
  beforeEach(() => {
    globalGameplaysClient.disconnect();
    globalPresenceClient.disconnect();
    globalGameplaysClient.setReadOnlyMode(false);
    globalPresenceClient.setReadOnlyMode(false);
    standbyMode.set(false);
    setLastPresenceToken(null);
    setPresenceReconnectRequest(null);
    mocks.broadcastGameplayEvent.mockReset();
    mocks.claimGameplayOwnership.mockReset().mockResolvedValue(vi.fn());
    mocks.subscribeGameplayEvents.mockReset().mockReturnValue(vi.fn());
    mocks.connect.mockReset();
    mocks.send.mockReset();
    mocks.on.mockReset().mockReturnValue(vi.fn());
    mocks.disconnect.mockReset();
    mocks.createGameplaysClient.mockReset();
    mocks.createPresenceClient.mockReset();
    mocks.createGameplaysClient.mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      onAny: vi.fn().mockReturnValue(vi.fn()),
      disconnect: mocks.disconnect
    });
    mocks.createPresenceClient.mockReset().mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn().mockReturnValue(vi.fn())
    });
  });

  it('returns the same instance on repeated calls', () => {
    const first = globalGameplaysClient.getOrCreate();
    const second = globalGameplaysClient.getOrCreate();

    expect(first).toBe(second);
    expect(mocks.createGameplaysClient).toHaveBeenCalledTimes(1);
    expect(get(globalGameplaysClient)).toBe(first);
  });

  it('creates a presence client exactly once when its instance is initially null', () => {
    const first = globalPresenceClient.getOrCreate();

    expect(globalPresenceClient.getOrCreate()).toBe(first);
    expect(mocks.createPresenceClient).toHaveBeenCalledOnce();
  });

  it('preserves read-only mode across client creation and replacement', () => {
    globalGameplaysClient.setReadOnlyMode(true);
    globalGameplaysClient.getOrCreate();
    expect(mocks.createGameplaysClient.mock.results[0]?.value.setReadOnlyMode).toHaveBeenCalledWith(
      true
    );

    globalGameplaysClient.disconnect();
    globalGameplaysClient.getOrCreate();

    expect(mocks.createGameplaysClient.mock.results[1]?.value.setReadOnlyMode).toHaveBeenCalledWith(
      true
    );
  });

  it('propagates factory errors without storing a stale client', () => {
    const error = new Error('client creation failed');
    mocks.createGameplaysClient.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => globalGameplaysClient.getOrCreate()).toThrow(error);

    const client = globalGameplaysClient.getOrCreate();
    expect(client).toBeDefined();
    expect(globalGameplaysClient.getOrCreate()).toBe(client);
    expect(mocks.createGameplaysClient).toHaveBeenCalledTimes(2);
  });

  it('disconnects, clears the instance, and publishes null', () => {
    globalGameplaysClient.getOrCreate();

    globalGameplaysClient.disconnect();

    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(get(globalGameplaysClient)).toBeNull();
    expect(globalGameplaysClient.getOrCreate()).not.toBeNull();
    expect(mocks.createGameplaysClient).toHaveBeenCalledTimes(2);
  });

  it('recreates a client whose connected state has a dead socket', () => {
    const state = writable<'connected' | 'disconnected'>('connected');
    const first = {
      state,
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      onAny: vi.fn().mockReturnValue(vi.fn()),
      disconnect: mocks.disconnect
    };
    const second = {
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      onAny: vi.fn().mockReturnValue(vi.fn()),
      disconnect: vi.fn()
    };
    mocks.createGameplaysClient.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const firstClient = globalGameplaysClient.getOrCreate();
    const secondClient = globalGameplaysClient.getOrCreate();

    expect(firstClient).not.toBe(first);
    expect(secondClient).not.toBe(second);
    expect(secondClient).not.toBe(firstClient);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(get(globalGameplaysClient)).toBe(secondClient);
  });

  it('requests an owner-controlled reconnect for a dead presence client', () => {
    const client = globalPresenceClient.getOrCreate();
    setLastPresenceToken('access-token');

    requestPresenceReconnect();

    expect(client.connect).toHaveBeenCalledWith('access-token');
  });

  it('does not create a second instance when a caller disconnects an empty store', () => {
    expect(() => globalGameplaysClient.disconnect()).not.toThrow();
    expect(mocks.createGameplaysClient).not.toHaveBeenCalled();
  });

  it('uses a registered reconnect callback before falling back to a token', () => {
    const client = globalPresenceClient.getOrCreate();
    const reconnect = vi.fn();
    setLastPresenceToken('access-token');
    setPresenceReconnectRequest(reconnect);

    requestPresenceReconnect();

    expect(reconnect).toHaveBeenCalledOnce();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('does not request another connection while presence is alive', () => {
    mocks.createPresenceClient.mockReturnValue({
      state: writable<'connected' | 'disconnected'>('connected'),
      isAlive: vi.fn().mockReturnValue(true),
      setReadOnlyMode: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn()
    });
    const client = globalPresenceClient.getOrCreate();
    const reconnect = vi.fn();
    setPresenceReconnectRequest(reconnect);

    requestPresenceReconnect();

    expect(reconnect).not.toHaveBeenCalled();
    expect(client.isAlive()).toBe(true);
  });

  it('routes gameplay events through the leader or broadcasts as a follower', async () => {
    const unsubscribe = vi.fn();
    let notifyGameplay!: (event: string, payload?: unknown) => void;
    let relayGameplayEvent!: (event: string, payload?: unknown) => void;
    mocks.createGameplaysClient.mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      onAny: vi.fn((handler) => {
        relayGameplayEvent = handler;
        return vi.fn();
      }),
      connect: mocks.connect,
      disconnect: mocks.disconnect,
      send: mocks.send,
      on: mocks.on
    });
    mocks.subscribeGameplayEvents.mockImplementation((handler: (event: string) => void) => {
      notifyGameplay = handler;
      return unsubscribe;
    });
    let claimLeader!: () => void;
    mocks.claimGameplayOwnership.mockReturnValue(
      new Promise<void>((resolve) => {
        claimLeader = resolve;
      })
    );

    const client = createCoordinatedGameplaysClient();
    const eventHandler = vi.fn();
    client.on('remote-event', eventHandler);
    notifyGameplay('remote-event');
    expect(eventHandler).toHaveBeenCalledOnce();

    client.connect('token');
    client.send('queued-event', { id: 1 });
    expect(mocks.broadcastGameplayEvent).toHaveBeenCalledWith('gameplay-send', {
      event: 'queued-event',
      payload: { id: 1 }
    });

    claimLeader();
    await Promise.resolve();
    client.send('leader-event', { id: 2 });
    relayGameplayEvent('game_state', { id: 3 });

    expect(mocks.connect).toHaveBeenCalledWith('token');
    expect(mocks.send).toHaveBeenCalledWith('leader-event', { id: 2 });
    expect(mocks.broadcastGameplayEvent).toHaveBeenCalledWith('game_state', { id: 3 });
    client.setReadOnlyMode(true);
    client.send('blocked-event', { id: 4 });
    expect(mocks.send).not.toHaveBeenCalledWith('blocked-event', { id: 4 });
    expect(mocks.broadcastGameplayEvent).not.toHaveBeenCalledWith('gameplay-send', {
      event: 'blocked-event',
      payload: { id: 4 }
    });
    client.disconnect();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('does not reconnect a stale pending leadership claim after clean disconnect', async () => {
    let completeStaleClaim!: (release: () => void) => void;
    const baseDisconnectAndWait = vi.fn(async () => undefined);
    mocks.createGameplaysClient.mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      setReadOnlyMode: vi.fn(),
      onAny: vi.fn().mockReturnValue(vi.fn()),
      connect: mocks.connect,
      disconnect: mocks.disconnect,
      disconnectAndWait: baseDisconnectAndWait
    });
    mocks.claimGameplayOwnership
      .mockReturnValueOnce(
        new Promise((resolve) => {
          completeStaleClaim = resolve;
        })
      )
      .mockResolvedValueOnce(vi.fn());

    const client = createCoordinatedGameplaysClient();
    client.connect('stale-token');
    await client.disconnectAndWait();
    client.connect('current-token');
    completeStaleClaim(vi.fn());

    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledWith('current-token'));
    expect(mocks.connect).not.toHaveBeenCalledWith('stale-token');
    expect(mocks.claimGameplayOwnership).toHaveBeenCalledTimes(2);
  });

  it('dispatches closed events with the close code and reason and disables reconnect on 4409', () => {
    const originalWebSocket = globalThis.WebSocket;
    const closeListener = vi.fn();
    const closeSpy = vi.fn();

    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      readyState = WebSocket.OPEN;
      close = closeSpy;
      send = vi.fn();
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor() {
        MockWebSocket.instances.push(this);
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket
    });

    const client = createWebSocketClient({ path: '/api/v2/ws/presence' });
    client.on('closed', closeListener);
    client.connect('token');

    const wsInstance = MockWebSocket.instances[0];
    expect(wsInstance).toBeDefined();
    wsInstance.onclose?.({ code: 4409, reason: 'session_replaced' } as CloseEvent);

    expect(closeListener).toHaveBeenCalledWith({
      code: 4409,
      reason: 'session_replaced',
      path: '/api/v2/ws/presence'
    });
    expect(client.state).toBeDefined();
    expect(closeListener).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: originalWebSocket
    });
  });
});
