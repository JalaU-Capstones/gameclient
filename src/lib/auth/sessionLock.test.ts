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
  broadcastTakeoverAck,
  broadcastTakeoverConfirmed,
  broadcastTakeoverFailed,
  broadcastTakeoverReady,
  broadcastGameplayEvent,
  broadcastPresenceUsers,
  broadcastSessionRefreshed,
  broadcastSessionTakeoverDismissed,
  broadcastSessionTakeoverRequest,
  claimPresenceOwnership,
  claimGameplayOwnership,
  getLastSessionRefreshAt,
  getLocalSessionLockUserCount,
  onRemoteLogout,
  openSessionChannel,
  releaseGameplayOwnership,
  releasePresenceOwnership,
  requestSessionRelease,
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

  it('announces ownership queries while waiting for Web Locks', async () => {
    const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      'BroadcastChannel'
    );
    const messages: unknown[] = [];
    class MockBroadcastChannel {
      onmessage: ((event: MessageEvent<SessionMessage>) => void) | null = null;

      constructor() {}

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

    let presenceRelease: (() => void) | undefined;
    let gameplayRelease: (() => void) | undefined;
    try {
      presenceRelease = await claimPresenceOwnership('presence-tab');
      gameplayRelease = await claimGameplayOwnership('gameplay-tab');

      expect(messages).toContainEqual({ type: 'presence-query', tabId: 'presence-tab' });
      expect(messages).toContainEqual({ type: 'gameplay-query', tabId: 'gameplay-tab' });
    } finally {
      presenceRelease?.();
      gameplayRelease?.();
      if (originalBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      }
    }
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
      dispatch({ type: 'session-takeover-dismissed', tabId: 'other-tab' });
      dispatch({
        type: 'takeover-ack',
        tabId: 'owner-tab',
        requesterTabId: 'requester-tab',
        requestId: 'request'
      });
      dispatch({
        type: 'takeover-confirmed',
        tabId: 'requester-tab',
        ownerTabId: 'owner-tab',
        requestId: 'request'
      });
      dispatch({
        type: 'takeover-ready',
        tabId: 'owner-tab',
        requesterTabId: 'requester-tab',
        requestId: 'request'
      });
      dispatch({
        type: 'takeover-failed',
        tabId: 'requester-tab',
        ownerTabId: 'owner-tab',
        requestId: 'request'
      });
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
      broadcastSessionTakeoverDismissed('requesting-tab');
      broadcastTakeoverAck('owner-tab', 'requester-tab', 'request');
      broadcastTakeoverConfirmed('requester-tab', 'owner-tab', 'request');
      broadcastTakeoverReady('owner-tab', 'requester-tab', 'request');
      broadcastTakeoverFailed('requester-tab', 'owner-tab', 'request');

      expect(gameplay).toHaveBeenCalledWith('game_message', { value: 1 });
      expect(logout).toHaveBeenCalledOnce();
      expect(channel.messages).toContainEqual({
        type: 'gameplay-event',
        event: 'game_message',
        payload: { value: 2 }
      });
      expect(received).toHaveLength(21);
      expect(channel.messages).toContainEqual({
        type: 'session-takeover-dismissed',
        tabId: 'requesting-tab'
      });
      expect(channel.messages).toContainEqual({
        type: 'takeover-ack',
        tabId: 'owner-tab',
        requesterTabId: 'requester-tab',
        requestId: 'request'
      });
      expect(channel.messages).toContainEqual({
        type: 'takeover-confirmed',
        tabId: 'requester-tab',
        ownerTabId: 'owner-tab',
        requestId: 'request'
      });
      expect(channel.messages).toContainEqual({
        type: 'takeover-ready',
        tabId: 'owner-tab',
        requesterTabId: 'requester-tab',
        requestId: 'request'
      });
      expect(channel.messages).toContainEqual({
        type: 'takeover-failed',
        tabId: 'requester-tab',
        ownerTabId: 'owner-tab',
        requestId: 'request'
      });
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

  it('broadcasts session release requests without releasing ownership before confirmation', async () => {
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

    const requestId = broadcastSessionTakeoverRequest('owner-tab');

    expect(MockBroadcastChannel.instance.messages).toContainEqual({
      type: 'session-takeover-request',
      tabId: 'owner-tab',
      requestId
    });
    expect(() => releasePresence()).not.toThrow();
    expect(() => releaseGameplay()).not.toThrow();

    if (originalBroadcastChannel) {
      Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
    } else {
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    }
  });

  it('waits for a matching session release confirmation', async () => {
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

    try {
      const pendingRelease = requestSessionRelease('requester-tab', 1000);
      const request = MockBroadcastChannel.instance.messages.find(
        (message): message is Extract<SessionMessage, { type: 'session-takeover-request' }> =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'session-takeover-request'
      );
      expect(request).toBeDefined();
      if (!request) throw new Error('Session release request was not broadcast');

      MockBroadcastChannel.instance.onmessage?.({
        data: {
          type: 'session-released',
          requestId: request.requestId,
          requesterTabId: request.tabId,
          tabId: 'owner-tab'
        }
      } as MessageEvent<SessionMessage>);

      await expect(pendingRelease).resolves.toBe(true);
    } finally {
      if (originalBroadcastChannel) {
        Object.defineProperty(globalThis, 'BroadcastChannel', originalBroadcastChannel);
      } else {
        Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      }
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
          data: { type: 'session-takeover-request', tabId, requestId: 'request-id' }
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
