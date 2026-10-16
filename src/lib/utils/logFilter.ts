import type { LogEntry, LogLevel } from '$lib/types/api';

/** Client-side filter chips. Server pagination stays untouched. */
export type LogFilter = 'all' | LogLevel | 'fail';

export const LOG_FILTERS: LogFilter[] = ['all', 'info', 'warning', 'error', 'fail'];

export const LOG_FILTER_LABELS: Record<LogFilter, string> = {
  all: 'All',
  debug: 'Debug',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  critical: 'Critical',
  fail: 'Fail'
};

function mentionsFail(entry: LogEntry): boolean {
  const haystack = `${entry.eventType} ${entry.message}`.toLowerCase();
  return haystack.includes('fail');
}

/** Pipe the current page payload through the selected filter. */
export function filterLogEntries(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'fail') {
    return entries.filter((entry) => entry.level === 'error' || mentionsFail(entry));
  }
  return entries.filter((entry) => entry.level === filter);
}

export function summarizeMessage(message: string, maxLength = 90): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}
