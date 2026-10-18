import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, pushToast, toasts } from './toasts';

describe('toasts store', () => {
  beforeEach(() => {
    vi.useRealTimers();
    const current = get(toasts);
    for (const toast of current) {
      dismissToast(toast.id);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(get(toasts)).toEqual([]);
  });

  it('pushes a toast with a generated id and expected payload', () => {
    const id = pushToast('info', 'hello world');

    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(get(toasts)).toEqual([
      expect.objectContaining({
        id,
        tone: 'info',
        message: 'hello world'
      })
    ]);
  });

  it('stores multiple toasts in insertion order', () => {
    const first = pushToast('info', 'first');
    const second = pushToast('success', 'second');

    expect(get(toasts)).toHaveLength(2);
    expect(get(toasts)[0]).toEqual(expect.objectContaining({ id: first, tone: 'info' }));
    expect(get(toasts)[1]).toEqual(expect.objectContaining({ id: second, tone: 'success' }));
  });

  it('dismisses only the requested toast and leaves the rest intact', () => {
    const first = pushToast('info', 'first');
    const second = pushToast('error', 'second');

    dismissToast(first);

    expect(get(toasts)).toEqual([
      expect.objectContaining({ id: second, tone: 'error', message: 'second' })
    ]);
  });

  it('is a no-op for an unknown toast id', () => {
    const first = pushToast('warning', 'once');
    dismissToast('missing-id');

    expect(get(toasts)).toEqual([
      expect.objectContaining({ id: first, tone: 'warning', message: 'once' })
    ]);
  });

  it('drops expired toasts when the timeout fires', () => {
    vi.useFakeTimers();

    const id = pushToast('info', 'temporary', 1000);
    expect(get(toasts)).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(get(toasts)).toEqual([]);
    expect(get(toasts).some((toast) => toast.id === id)).toBe(false);
  });
});
