import { httpClient } from './client';
import type { LogEntry, LogLevel, LogsQueryResponse } from '$lib/types/api';

export type LogsPage = LogsQueryResponse;

export interface ListLogsParams {
  limit?: number;
  offset?: number;
  level?: LogLevel | string;
  eventType?: string;
  gameplayId?: string;
  from?: string;
  to?: string;
}

export interface ListAllLogsParams extends ListLogsParams {
  playerId?: string;
}

type LogEntryRaw = Omit<LogEntry, 'level'> & { level: string };

type LogsQueryRaw = Omit<LogsQueryResponse, 'items'> & { items: LogEntryRaw[] };

const KNOWN_LEVELS = new Set<LogLevel>(['debug', 'info', 'warning', 'error', 'critical']);

function normalizeLevel(raw: string): LogLevel {
  const level = raw.trim().toLowerCase() as LogLevel;
  return KNOWN_LEVELS.has(level) ? level : 'info';
}

function toEntry(raw: LogEntryRaw): LogEntry {
  return {
    ...raw,
    level: normalizeLevel(raw.level),
    metadata: raw.metadata ?? null
  };
}

function buildQuery(params: ListLogsParams | ListAllLogsParams): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.level !== undefined && params.level !== '') {
    query.set('level', String(params.level).toUpperCase());
  }
  if (params.eventType !== undefined && params.eventType !== '') {
    query.set('event_type', params.eventType);
  }
  if (params.gameplayId !== undefined && params.gameplayId !== '') {
    query.set('gameplay_id', params.gameplayId);
  }
  if ('playerId' in params && params.playerId !== undefined && params.playerId !== '') {
    query.set('player_id', params.playerId);
  }
  if (params.from !== undefined && params.from !== '') {
    query.set('from', params.from);
  }
  if (params.to !== undefined && params.to !== '') {
    query.set('to', params.to);
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export const logsApi = {
  listMine: async (params: ListLogsParams = {}): Promise<LogsPage> => {
    const raw = await httpClient.get<LogsQueryRaw>(`/api/v2/logs/me${buildQuery(params)}`);
    return {
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
      items: raw.items.map(toEntry)
    };
  },
  listAll: async (params: ListAllLogsParams = {}): Promise<LogsPage> => {
    const raw = await httpClient.get<LogsQueryRaw>(`/api/v2/logs${buildQuery(params)}`);
    return {
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
      items: raw.items.map(toEntry)
    };
  }
};
