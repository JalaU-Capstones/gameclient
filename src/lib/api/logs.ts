import { httpClient } from './client';
import type { LogEntry, LogLevel, LogsQueryResponse } from '$lib/types/api';

export type LogsPage = LogsQueryResponse;

export interface ListMyLogsParams {
  limit?: number;
  offset?: number;
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

function buildQuery(params: ListMyLogsParams): string {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

export const logsApi = {
  listMine: async (params: ListMyLogsParams = {}): Promise<LogsPage> => {
    const raw = await httpClient.get<LogsQueryRaw>(`/api/v2/logs/me${buildQuery(params)}`);
    return {
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
      items: raw.items.map(toEntry)
    };
  }
};
