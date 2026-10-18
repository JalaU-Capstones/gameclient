const CHAT_VISIBLE_ROUTES = ['/lobby', '/history'] as const;
const CHAT_GAME_PREFIX = '/game/';

/**
 * Returns true when the chat widget should be visible for the given pathname.
 *
 * Whitelist:
 *  - /lobby
 *  - /history
 *  - /game/<id>  (any non-empty id)
 */
export function isChatRouteVisible(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if ((CHAT_VISIBLE_ROUTES as readonly string[]).includes(pathname)) return true;
  if (pathname.startsWith(CHAT_GAME_PREFIX) && pathname.length > CHAT_GAME_PREFIX.length) {
    return true;
  }
  return false;
}
