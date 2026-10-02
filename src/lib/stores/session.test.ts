import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentUser, isAuthenticated, isHydrated, session } from './session';

const user = {
  id: '1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  registerDate: '2026-01-01T00:00:00Z'
};

describe('session store', () => {
  beforeEach(() => {
    session.reset();
  });

  it('setUser stores the user and marks the session as hydrated', () => {
    session.setUser(user);

    expect(get(session).user).toEqual(user);
    expect(get(session).hydrated).toBe(true);
    expect(get(isAuthenticated)).toBe(true);
    expect(get(isHydrated)).toBe(true);
    expect(get(currentUser)).toEqual(user);
  });

  it('clear removes the user and marks the session as hydrated', () => {
    session.setUser(user);

    session.clear();

    expect(get(session).user).toBeNull();
    expect(get(session).hydrated).toBe(true);
    expect(get(isAuthenticated)).toBe(false);
    expect(get(currentUser)).toBeNull();
  });

  it('markHydrated sets hydrated without changing the user', () => {
    session.setUser(user);
    session.markHydrated();

    expect(get(session).user).toEqual(user);
    expect(get(session).hydrated).toBe(true);
  });

  it('reset returns the store to the initial state', () => {
    session.setUser(user);
    session.setLoading(true);

    session.reset();

    expect(get(session)).toEqual({
      user: null,
      loading: false,
      hydrated: false
    });
    expect(get(isAuthenticated)).toBe(false);
    expect(get(isHydrated)).toBe(false);
    expect(get(currentUser)).toBeNull();
  });

  it('isAuthenticated reflects the current user status', () => {
    expect(get(isAuthenticated)).toBe(false);

    session.setUser(user);
    expect(get(isAuthenticated)).toBe(true);

    session.clear();
    expect(get(isAuthenticated)).toBe(false);
  });
});
