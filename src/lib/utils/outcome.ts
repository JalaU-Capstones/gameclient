import type { Gameplay } from '$lib/types/api';

export type Outcome =
  | 'won'
  | 'lost'
  | 'draw'
  | 'in_progress'
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'canceled'
  | 'busy';

export function getOutcome(game: Gameplay, myId: string): Outcome {
  // target_busy is stored with invitationState "expired", so it has to win over that state.
  if (game.matchResult?.reason === 'target_busy') return 'busy';

  if (game.invitationState === 'pending' || game.invitationState === 'queued') return 'pending';
  if (game.invitationState === 'expired') return 'expired';
  if (game.invitationState === 'canceled') return 'canceled';

  const result = game.matchResult;
  if (result === null) return 'in_progress';

  switch (result.reason) {
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'expired':
      return 'expired';
    case 'host_left':
    case 'guest_left':
      return 'canceled';
    case 'target_busy':
      return 'busy';
    case 'draw':
      return 'draw';
    case 'abandon':
      return result.winner === myId ? 'won' : 'lost';
    case 'line': {
      const myRole = game.hostPlayer === myId ? 'host' : 'guest';
      return result.winner === myRole ? 'won' : 'lost';
    }
    default:
      return 'canceled';
  }
}
