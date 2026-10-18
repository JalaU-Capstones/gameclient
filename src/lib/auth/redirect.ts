const ALLOWED_PREFIXES = ['/lobby', '/game', '/profile', '/history', '/logs', '/health'];

export type RedirectPath =
  | '/health'
  | '/lobby'
  | '/history'
  | '/logs'
  | '/profile'
  | '/login'
  | '/register'
  | `/game/${string}`
  | `${'/health' | '/lobby' | '/history' | '/logs' | '/profile' | '/login' | '/register' | `/game/${string}`}?${string}`
  | `${'/health' | '/lobby' | '/history' | '/logs' | '/profile' | '/login' | '/register' | `/game/${string}`}#${string}`;

/**
 * Validate a redirect path from the URL.
 * Only allow paths that start with a known protected prefix.
 * Returns '/lobby' as the safe fallback.
 */
export function resolveRedirect(raw: string | null | undefined): RedirectPath {
  if (!raw) return '/lobby';

  if (!raw.startsWith('/') || raw.startsWith('//')) return '/lobby';
  if (raw.includes('://')) return '/lobby';

  const isAllowed = ALLOWED_PREFIXES.some(
    (prefix) => raw === prefix || raw.startsWith(`${prefix}/`) || raw.startsWith(`${prefix}?`)
  );
  if (!isAllowed) return '/lobby';

  return raw as RedirectPath;
}
