import { get, writable } from 'svelte/store';

const PUBLIC_ROUTES = ['/login', '/register'];
const MAX_ENTRIES = 20;

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname);
}

const entries = writable<string[]>([]);

/**
 * Navigation history that only records protected routes.
 * Public routes are ignored, so an authenticated user cannot go back to them.
 */
export const navigationHistory = {
  subscribe: entries.subscribe,

  record(pathname: string): void {
    if (isPublic(pathname)) return;
    if (pathname === '/') return;

    entries.update((current) => {
      if (current[current.length - 1] === pathname) return current;
      return [...current, pathname].slice(-MAX_ENTRIES);
    });
  },

  back(): string | null {
    const current = get(entries);
    if (current.length < 2) return null;
    const target = current[current.length - 2];
    entries.update((list) => list.slice(0, -1));
    return target;
  },

  canGoBack(): boolean {
    return get(entries).length >= 2;
  },

  reset(): void {
    entries.set([]);
  }
};
