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

vi.mock('$lib/api/ws', () => ({
  createGameplaysClient: mocks.createGameplaysClient,
  createPresenceClient: mocks.createPresenceClient
}));
vi.mock('$lib/auth/sessionLock', () => ({
  broadcastGameplayEvent: mocks.broadcastGameplayEvent,
  claimGameplayOwnership: mocks.claimGameplayOwnership,
  subscribeGameplayEvents: mocks.subscribeGameplayEvents
}));

import {
  globalGameplaysClient,
  globalPresenceClient,
  createCoordinatedGameplaysClient,
  requestPresenceReconnect,
  setLastPresenceToken,
  setPresenceReconnectRequest
} from './ws';

describe('globalGameplaysClient', () => {
  beforeEach(() => {
    globalGameplaysClient.disconnect();
    globalPresenceClient.disconnect();
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
      disconnect: mocks.disconnect
    });
    mocks.createPresenceClient.mockReset().mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      connect: vi.fn(),
      disconnect: vi.fn()
    });
  });

  it('returns the same instance on repeated calls', () => {
    const first = globalGameplaysClient.getOrCreate();
    const second = globalGameplaysClient.getOrCreate();

    expect(first).toBe(second);
    expect(mocks.createGameplaysClient).toHaveBeenCalledTimes(1);
    expect(get(globalGameplaysClient)).toBe(first);
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
      disconnect: mocks.disconnect
    };
    const second = {
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
      disconnect: vi.fn()
    };
    mocks.createGameplaysClient.mockReturnValueOnce(first).mockReturnValueOnce(second);

    expect(globalGameplaysClient.getOrCreate()).toBe(first);
    expect(globalGameplaysClient.getOrCreate()).toBe(second);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(get(globalGameplaysClient)).toBe(second);
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
    mocks.createGameplaysClient.mockReturnValue({
      state: writable<'connected' | 'disconnected'>('disconnected'),
      isAlive: vi.fn().mockReturnValue(false),
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
    expect(mocks.broadcastGameplayEvent).toHaveBeenCalledWith('queued-event', { id: 1 });

    claimLeader();
    await Promise.resolve();
    client.connect('token');
    client.send('leader-event', { id: 2 });

    expect(mocks.connect).toHaveBeenCalledWith('token');
    expect(mocks.send).toHaveBeenCalledWith('leader-event', { id: 2 });
    client.disconnect();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
