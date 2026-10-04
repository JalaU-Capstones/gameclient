import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  createGameplaysClient: vi.fn(),
  createPresenceClient: vi.fn()
}));

vi.mock('$lib/api/ws', () => ({
  createGameplaysClient: mocks.createGameplaysClient,
  createPresenceClient: mocks.createPresenceClient
}));

import { globalGameplaysClient } from './ws';

describe('globalGameplaysClient', () => {
  beforeEach(() => {
    globalGameplaysClient.disconnect();
    mocks.disconnect.mockReset();
    mocks.createGameplaysClient.mockReset();
    mocks.createPresenceClient.mockReset();
    mocks.createGameplaysClient.mockReturnValue({ disconnect: mocks.disconnect });
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
});
