import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  announceGameplayOwner,
  announceGameplayQuery,
  announceGameplayRelease,
  announceGameplayTakeover,
  announcePresenceListRequest,
  announcePresenceOwner,
  announcePresenceQuery,
  announcePresenceRelease,
  announcePresenceTakeover,
  broadcastGameplayEvent,
  broadcastPresenceUsers,
  broadcastSessionRefreshed,
  broadcastSessionRelease,
  claimPresenceOwnership,
  claimGameplayOwnership,
  getLastSessionRefreshAt,
  getLocalSessionLockUserCount,
  onRemoteLogout,
  openSessionChannel,
  releaseGameplayOwnership,
  releasePresenceOwnership,
  subscribeGameplayEvents,
  subscribeSessionMessages,
  type SessionMessage
} from './sessionLock';

describe('presence ownership lock', () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

  afterEach(() => {
    if (originalLocks) {
      Object.defineProperty(navigator, 'locks', originalLocks);
    } else {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('holds one exclusive ownership lock until its release callback is called', async () => {
    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    const firstClaim = claimPresenceOwnership('tab-1');
    const secondClaim = claimPresenceOwnership('tab-1');
    const release = await firstClaim;

    expect(await secondClaim).toBe(release);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      'presence-owner',
      { mode: 'exclusive' },
      expect.any(Function)
    );

    releasePresenceOwnership();
    expect(() => release()).not.toThrow();
    await Promise.resolve();

    const nextRelease = await claimPresenceOwnership('tab-2');
    expect(request).toHaveBeenCalledTimes(2);
    nextRelease();
  });

  it('replies directly to a presence-list-request with the cached user list', async () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      'BroadcastChannel'
    );
    const messages: unknown[] = [];
    class MockBroadcastChannel {
      static instance: MockBroadcastChannel;
      onmessage: ((event: MessageEvent<SessionMessage>) => void) | null = null;

      constructor() {
        MockBroadcastChannel.instance = this;
      }

      postMessage(message: unknown) {
        messages.push(message);
      }

      close() {}
    }
    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    let closeChannel: (() => void) | undefined;
    let release: (() => void) | undefined;
    try {
      closeChannel = openSessionChannel();
      release = await claimPresenceOwnership('owner-tab');
      broadcastPresenceUsers(['player-1']);
      MockBroadcastChannel.instance.onmessage?.({
        data: { type: 'presence-list-request', tabId: 'requesting-tab' }
      } as MessageEvent<SessionMessage>);

      expect(messages).toContainEqual({
        type: 'presence-users-direct',
        userIds: ['player-1'],
        tabId: 'requesting-tab'
      });
    } finally {
      release?.();
      closeChannel?.();
      if (originalBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      }
    }
  });

  it('releases a session lock idempotently', async () => {
    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    const release = await (await import('./sessionLock')).acquireSessionLock();

    expect(getLocalSessionLockUserCount()).toBe(0);
    expect(() => {
      release();
      release();
    }).not.toThrow();
    await Promise.resolve();
  });

  it('broadcasts and routes session messages while ignoring malformed messages', () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      'BroadcastChannel'
    );
    class MockBroadcastChannel {
      static instance: MockBroadcastChannel;
      onmessage: ((event: MessageEvent<SessionMessage>) => void) | null = null;
      readonly messages: unknown[] = [];

      constructor() {
        MockBroadcastChannel.instance = this;
      }

      postMessage(message: unknown) {
        this.messages.push(message);
      }

      close() {}
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel
    });

    const closeChannel = openSessionChannel();
    const received: SessionMessage[] = [];
    const logout = vi.fn();
    const gameplay = vi.fn();
    const unsubscribeMessages = subscribeSessionMessages((message) => received.push(message));
    const unsubscribeLogout = onRemoteLogout(logout);
    const unsubscribeGameplay = subscribeGameplayEvents(gameplay);
    const channel = MockBroadcastChannel.instance;
    const dispatch = (data: unknown) =>
      channel.onmessage?.({ data } as MessageEvent<SessionMessage>);

    try {
      dispatch(null);
      dispatch({});
      dispatch({ type: 'session-refreshed', at: 100 });
      dispatch({ type: 'session-refreshed', at: Number.NaN });
      expect(getLastSessionRefreshAt()).toBe(100);

      dispatch({ type: 'presence-query', tabId: 'other-tab' });
      dispatch({ type: 'presence-takeover', tabId: 'other-tab' });
      dispatch({ type: 'presence-owner', tabId: 'other-tab' });
      dispatch({ type: 'presence-release', tabId: 'unknown-tab' });
      dispatch({ type: 'presence-list-request', tabId: 'requester' });
      dispatch({ type: 'gameplay-query', tabId: 'other-tab' });
      dispatch({ type: 'gameplay-takeover', tabId: 'other-tab' });
      dispatch({ type: 'gameplay-owner', tabId: 'other-tab' });
      dispatch({ type: 'gameplay-release', tabId: 'unknown-tab' });
      dispatch({ type: 'gameplay-event', event: 'game_message', payload: { value: 1 } });
      dispatch({ type: 'session-lock-request', requestId: 'request' });
      dispatch({ type: 'session-lock-acquired', requestId: 'request', ownerId: 'unknown-owner' });
      dispatch({ type: 'session-lock-released', ownerId: 'different-owner' });
      dispatch({ type: 'logout' });

      announcePresenceListRequest('requester');
      announcePresenceQuery('tab');
      announcePresenceTakeover('tab');
      announcePresenceOwner('tab');
      announcePresenceRelease('tab');
      announceGameplayQuery('tab');
      announceGameplayTakeover('tab');
      announceGameplayOwner('tab');
      announceGameplayRelease('tab');
      broadcastPresenceUsers(['player']);
      broadcastGameplayEvent('game_message', { value: 2 });
      broadcastSessionRefreshed(200);

      expect(gameplay).toHaveBeenCalledWith('game_message', { value: 1 });
      expect(logout).toHaveBeenCalledOnce();
      expect(channel.messages).toContainEqual({
        type: 'gameplay-event',
        event: 'game_message',
        payload: { value: 2 }
      });
      expect(received).toHaveLength(16);
    } finally {
      unsubscribeMessages();
      unsubscribeLogout();
      unsubscribeGameplay();
      closeChannel();
      if (originalBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      }
    }
  });

  it('shares gameplay ownership and permits repeated releases', async () => {
    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    const firstClaim = claimGameplayOwnership('game-tab');
    const secondClaim = claimGameplayOwnership('game-tab');
    const release = await firstClaim;

    expect(await secondClaim).toBe(release);
    expect(request).toHaveBeenCalledOnce();
    releaseGameplayOwnership();
    expect(() => release()).not.toThrow();
  });

  it('broadcasts session release requests and releases the owner lock on request', async () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      'BroadcastChannel'
    );
    class MockBroadcastChannel {
      static instance: MockBroadcastChannel;
      onmessage: ((event: MessageEvent<SessionMessage>) => void) | null = null;
      readonly messages: unknown[] = [];

      constructor() {
        MockBroadcastChannel.instance = this;
      }

      postMessage(message: unknown) {
        this.messages.push(message);
      }

      close() {}
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel
    });

    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    const releasePresence = await claimPresenceOwnership('owner-tab');
    const releaseGameplay = await claimGameplayOwnership('game-tab');

    broadcastSessionRelease('owner-tab');

    expect(MockBroadcastChannel.instance.messages).toContainEqual({
      type: 'session-release-request',
      tabId: 'owner-tab'
    });
    expect(() => releasePresence()).not.toThrow();
    expect(() => releaseGameplay()).not.toThrow();

    if (originalBroadcastChannel) {
      Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
    } else {
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    }
  });

  it('ignores release requests from unknown tabs and safely handles requests without an owner', async () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      'BroadcastChannel'
    );
    class MockBroadcastChannel {
      static instance: MockBroadcastChannel;
      onmessage: ((event: MessageEvent<SessionMessage>) => void) | null = null;

      constructor() {
        MockBroadcastChannel.instance = this;
      }

      postMessage() {}
      close() {}
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel
    });

    const request = vi.fn(
      async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<void>) =>
        callback()
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    const closeChannel = openSessionChannel();
    let release: (() => void) | undefined;
    try {
      const ownerClaim = await claimPresenceOwnership('owner-tab');
      release = ownerClaim;

      const dispatchReleaseRequest = (tabId: string) =>
        MockBroadcastChannel.instance.onmessage?.({
          data: { type: 'session-release-request', tabId }
        } as MessageEvent<SessionMessage>);

      expect(() => dispatchReleaseRequest('unknown-tab')).not.toThrow();
      expect(await claimPresenceOwnership('owner-tab')).toBe(ownerClaim);
      expect(request).toHaveBeenCalledOnce();

      releasePresenceOwnership();
      release = undefined;
      expect(() => dispatchReleaseRequest('unknown-tab')).not.toThrow();
    } finally {
      release?.();
      closeChannel();
      if (originalBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      }
    }
  });
});
