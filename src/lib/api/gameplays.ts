import { httpClient } from './client';
import type { Gameplay, MatchResult } from '$lib/types/api';

type GameplayRaw = Omit<Gameplay, 'matchResult'> & { matchResult: string | null };

export type GameplayRecord = Gameplay;

function parseMatchResult(raw: string | null): MatchResult | null {
  if (raw === null) return null;
  return JSON.parse(raw) as MatchResult;
}

function toRecord(raw: GameplayRaw): GameplayRecord {
  return { ...raw, matchResult: parseMatchResult(raw.matchResult) };
}

export const gameplaysApi = {
  listMine: async (): Promise<GameplayRecord[]> => {
    const raw = await httpClient.get<GameplayRaw[]>('/api/v2/gameplays/my-gameplays');
    return raw.flatMap((item) => {
      try {
        return [toRecord(item)];
      } catch {
        return [];
      }
    });
  },
  getById: async (id: string): Promise<GameplayRecord> => {
    const raw = await httpClient.get<GameplayRaw>(`/api/v2/gameplays/${encodeURIComponent(id)}`);
    return toRecord(raw);
  }
};
