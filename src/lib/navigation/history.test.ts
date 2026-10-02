import { beforeEach, describe, expect, it } from 'vitest';
import { navigationHistory } from './history';

function getEntries(): string[] {
  let current: string[] = [];
  const unsubscribe = navigationHistory.subscribe((entries) => {
    current = entries;
  });
  unsubscribe();
  return current;
}

describe('navigationHistory', () => {
  beforeEach(() => {
    navigationHistory.reset();
  });

  it('records protected routes and ignores public and root routes', () => {
    navigationHistory.record('/login');
    navigationHistory.record('/register');
    navigationHistory.record('/');
    navigationHistory.record('/lobby');

    expect(getEntries()).toEqual(['/lobby']);
  });

  it('does not duplicate consecutive identical paths', () => {
    navigationHistory.record('/lobby');
    navigationHistory.record('/lobby');

    expect(getEntries()).toEqual(['/lobby']);
  });

  it('caps its history at 20 entries', () => {
    for (let index = 0; index < 21; index += 1) {
      navigationHistory.record(`/route-${index}`);
    }

    expect(getEntries()).toHaveLength(20);
    expect(getEntries()[0]).toBe('/route-1');
    expect(getEntries()[19]).toBe('/route-20');
  });

  it('returns the previous route and removes the current one when going back', () => {
    navigationHistory.record('/lobby');
    navigationHistory.record('/history');

    expect(navigationHistory.back()).toBe('/lobby');
    expect(getEntries()).toEqual(['/lobby']);
  });

  it('returns null when there is no previous route', () => {
    navigationHistory.record('/lobby');

    expect(navigationHistory.back()).toBeNull();
    expect(navigationHistory.back()).toBeNull();
  });

  it('reflects whether there is a previous route', () => {
    expect(navigationHistory.canGoBack()).toBe(false);

    navigationHistory.record('/lobby');
    expect(navigationHistory.canGoBack()).toBe(false);

    navigationHistory.record('/history');
    expect(navigationHistory.canGoBack()).toBe(true);
  });

  it('clears all entries when reset', () => {
    navigationHistory.record('/lobby');
    navigationHistory.record('/history');

    navigationHistory.reset();

    expect(getEntries()).toEqual([]);
    expect(navigationHistory.canGoBack()).toBe(false);
  });
});
