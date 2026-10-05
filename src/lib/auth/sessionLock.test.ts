import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPresenceOwnership } from './sessionLock';

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
});
