import type { LogEntry, LogLevel } from '$lib/types/api';
import type { BarChartProps, BarColumn, HBarItem, PieSlice } from '$lib/components/charts/types';

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error', 'critical'];

export const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'var(--text-muted)',
  info: 'var(--neon-cyan)',
  warning: '#f59e0b',
  error: 'var(--neon-magenta)',
  critical: '#ef4444'
};

export type ActivityRange = '1h' | '6h' | '24h' | '7d';

const RANGE_CONFIG: Record<
  ActivityRange,
  { binCount: number; binMs: number; labelFormatter: (date: Date) => string }
> = {
  '1h': {
    binCount: 12,
    binMs: 5 * 60 * 1000,
    labelFormatter: (date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date)
  },
  '6h': {
    binCount: 12,
    binMs: 30 * 60 * 1000,
    labelFormatter: (date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date)
  },
  '24h': {
    binCount: 24,
    binMs: 60 * 60 * 1000,
    labelFormatter: (date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date)
  },
  '7d': {
    binCount: 7,
    binMs: 24 * 60 * 60 * 1000,
    labelFormatter: (date) =>
      new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' }).format(date)
  }
};

export function aggregateActivity(
  entries: LogEntry[],
  range: ActivityRange,
  now: number
): BarColumn[] {
  const config = RANGE_CONFIG[range];
  const { binCount, binMs } = config;
  const rangeMs = binCount * binMs;
  const windowStart = now - rangeMs;

  const columns: BarColumn[] = Array.from({ length: binCount }, (_, index) => {
    const start = windowStart + index * binMs;
    return {
      label: config.labelFormatter(new Date(start)),
      segments: LOG_LEVELS.map((level) => ({ key: level, value: 0 }))
    };
  });

  for (const entry of entries) {
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) continue;

    const bucketIndex = Math.min(
      binCount - 1,
      Math.max(0, Math.floor((timestamp - windowStart) / binMs))
    );

    const match = columns[bucketIndex].segments.find((segment) => segment.key === entry.level);
    if (match) match.value += 1;
  }

  return columns;
}

export function aggregateLevelDistribution(entries: LogEntry[]): PieSlice[] {
  const counts = Object.fromEntries(LOG_LEVELS.map((level) => [level, 0])) as Record<
    LogLevel,
    number
  >;

  for (const entry of entries) {
    counts[entry.level] = (counts[entry.level] ?? 0) + 1;
  }

  return LOG_LEVELS.filter((level) => counts[level] > 0).map((level) => ({
    label: level,
    value: counts[level],
    color: LEVEL_COLORS[level]
  }));
}

export function aggregateTopEventTypes(entries: LogEntry[], limit = 8): HBarItem[] {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.eventType, (counts.get(entry.eventType) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([eventType, value]) => ({
      label: eventType.replace(/_/g, ' '),
      value
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({ ...item }));
}

export function activityColorMap(): BarChartProps['colorMap'] {
  return {
    debug: LEVEL_COLORS.debug,
    info: LEVEL_COLORS.info,
    warning: LEVEL_COLORS.warning,
    error: LEVEL_COLORS.error,
    critical: LEVEL_COLORS.critical
  };
}

export function hasChartData(columns: BarColumn[]): boolean {
  return columns.some((column) => column.segments.some((segment) => segment.value > 0));
}
