import type { Pathname } from '$app/types';

const ALLOWED_PREFIXES = ['/lobby', '/game', '/profile', '/history', '/logs'];
export type RedirectPath = Pathname | `${Pathname}?${string}` | `${Pathname}#${string}`;

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
