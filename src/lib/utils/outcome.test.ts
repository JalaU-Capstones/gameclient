import { describe, expect, it } from 'vitest';
import type { Gameplay, MatchResult } from '$lib/types/api';
import { getOutcome } from './outcome';

const HOST = 'host-id';
const GUEST = 'guest-id';

function game(matchResult: MatchResult | null): Gameplay {
  return {
    id: 'g1',
    currentPositions: '[]',
    hostPlayer: HOST,
    guestPlayer: GUEST,
    playerTurn: HOST,
    matchResult,
    createdDate: '2026-10-01T12:00:00Z',
    updatedDate: '2026-10-01T12:05:00Z'
  };
}

describe('getOutcome', () => {
  it.each([
    ['in progress', null, HOST, 'in_progress'],
    ['pending invitation', { winner: null, reason: 'pending' }, HOST, 'pending'],
    ['rejected invitation', { winner: null, reason: 'rejected' }, GUEST, 'rejected'],
    ['draw (host view)', { winner: null, reason: 'draw' }, HOST, 'draw'],
    ['draw (guest view)', { winner: null, reason: 'draw' }, GUEST, 'draw'],
    ['line won by host, seen by host', { winner: 'host', reason: 'line' }, HOST, 'won'],
    ['line won by host, seen by guest', { winner: 'host', reason: 'line' }, GUEST, 'lost'],
    ['line won by guest, seen by guest', { winner: 'guest', reason: 'line' }, GUEST, 'won'],
    ['line won by guest, seen by host', { winner: 'guest', reason: 'line' }, HOST, 'lost'],
    ['abandon, user is the winner', { winner: GUEST, reason: 'abandon' }, GUEST, 'won'],
    ['abandon, user is the one who left', { winner: GUEST, reason: 'abandon' }, HOST, 'lost']
  ] as [string, MatchResult | null, string, string][])('%s', (_name, result, myId, expected) => {
    expect(getOutcome(game(result), myId)).toBe(expected);
  });
});
