export const USER_MESSAGES: Record<string, string> = {
  OPPONENT_OFFLINE: 'That player is no longer available.',
  GAME_NOT_FOUND: 'That game is no longer available.',
  GAME_NOT_ACTIVE: 'That game has already ended.',
  NOT_YOUR_TURN: 'Please wait for your turn.',
  INVALID_MOVE: 'That move is not allowed.',
  CANNOT_INVITE_SELF: 'You cannot invite yourself.',
  INVITATION_NOT_PENDING: 'That invitation is no longer valid.',
  USER_BUSY: 'That player is already in a game.',
  HOST_BUSY: 'You already have a game or invitation in progress.',
  INVITATION_EXPIRED: 'Your invitation expired.',
  INVITATION_CANCELED: 'The invitation was canceled.',
  INVITATION_REJECTED: 'The invitation was declined.',
  AUTH_FAILED: 'Your session ended. Please sign in again.',
  UNKNOWN_ERROR: 'Something went wrong. Please try again.'
};

export function userFacingMessage(
  code: string | undefined,
  fallback = USER_MESSAGES.UNKNOWN_ERROR
) {
  if (!code) return fallback;
  return USER_MESSAGES[code] ?? fallback;
}
