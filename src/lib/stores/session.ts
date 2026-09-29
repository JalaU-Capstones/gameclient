import { derived, writable } from 'svelte/store';
import type { User } from '$lib/types/api';

interface SessionState {
  user: User | null;
  loading: boolean;
}

const sessionStore = writable<SessionState>({ user: null, loading: false });

export const session = {
  subscribe: sessionStore.subscribe,
  setUser: (user: User | null) => sessionStore.update((state) => ({ ...state, user })),
  clear: () => sessionStore.set({ user: null, loading: false }),
  setLoading: (loading: boolean) => sessionStore.update((state) => ({ ...state, loading }))
};

export const isAuthenticated = derived(session, ($session) => $session.user !== null);
export const currentUser = derived(session, ($session) => $session.user);
