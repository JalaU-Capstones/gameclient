import type { Gameplay } from '$lib/types/api';

export type Outcome = 'won' | 'lost' | 'draw' | 'in_progress' | 'pending' | 'rejected';

export function getOutcome(game: Gameplay, myId: string): Outcome {
  const result = game.matchResult;

  // No result yet: the game is still being played.
  if (result === null) return 'in_progress';

  switch (result.reason) {
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'draw':
      return 'draw';
    case 'abandon':
      // winner is a user id here
      return result.winner === myId ? 'won' : 'lost';
    case 'line': {
      // winner is "host" or "guest" here
      const myRole = game.hostPlayer === myId ? 'host' : 'guest';
      return result.winner === myRole ? 'won' : 'lost';
    }
  }
}
