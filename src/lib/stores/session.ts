import { derived, writable } from 'svelte/store';
import type { User } from '$lib/types/api';

interface SessionState {
  user: User | null;
  loading: boolean;
  hydrated: boolean;
}

const sessionStore = writable<SessionState>({
  user: null,
  loading: false,
  hydrated: false
});

export const session = {
  subscribe: sessionStore.subscribe,
  setUser: (user: User | null) =>
    sessionStore.update((state) => ({ ...state, user, hydrated: true })),
  clear: () => sessionStore.update((state) => ({ ...state, user: null, hydrated: true })),
  setLoading: (loading: boolean) => sessionStore.update((state) => ({ ...state, loading })),
  markHydrated: () => sessionStore.update((state) => ({ ...state, hydrated: true })),
  reset: () => sessionStore.set({ user: null, loading: false, hydrated: false })
};

export const isAuthenticated = derived(session, ($session) => $session.user !== null);
export const isHydrated = derived(session, ($session) => $session.hydrated);
export const currentUser = derived(session, ($session) => $session.user);
