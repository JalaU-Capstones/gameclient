import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastPresenceUsers,
  claimPresenceOwnership,
  openSessionChannel,
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

    release();
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
});
