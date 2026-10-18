import type { LogEntry } from '$lib/types/api';

const CSV_COLUMNS = [
  'id',
  'level',
  'event_type',
  'message',
  'player_id',
  'gameplay_id',
  'timestamp',
  'metadata'
] as const;

export function logsToCsv(entries: LogEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = entries.map((entry) =>
    [
      entry.id,
      entry.level,
      entry.eventType,
      entry.message,
      entry.playerId ?? '',
      entry.gameplayId ?? '',
      entry.timestamp,
      entry.metadata === null ? '' : JSON.stringify(entry.metadata)
    ]
      .map(escapeCsvField)
      .join(',')
  );

  return [header, ...rows].join('\r\n');
}

function escapeCsvField(value: string): string {
  if (value === '') return '';

  const needsQuoting = /[",\r\n]/.test(value) || /^\s|\s$/.test(value);
  if (!needsQuoting) return value;

  return `"${value.replace(/"/g, '""')}"`;
}

export interface DownloadCsvOptions {
  filename: string;
}

export function downloadCsv(content: string, options: DownloadCsvOptions): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = options.filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
