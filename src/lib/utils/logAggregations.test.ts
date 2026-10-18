import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_LEVELS,
  LEVEL_COLORS,
  aggregateActivity,
  aggregateLevelDistribution,
  aggregateTopEventTypes,
  hasChartData,
  type ActivityRange
} from './logAggregations';
import type { LogEntry } from '$lib/types/api';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    level: 'info',
    eventType: 'ws_connected',
    message: 'connected',
    playerId: 'player-1',
    gameplayId: 'game-1',
    metadata: null,
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('logAggregations', () => {
  it('returns the expected number of bins for each range', () => {
    expect(aggregateActivity([], '1h', Date.now()).length).toBe(12);
    expect(aggregateActivity([], '6h', Date.now()).length).toBe(12);
    expect(aggregateActivity([], '24h', Date.now()).length).toBe(24);
    expect(aggregateActivity([], '7d', Date.now()).length).toBe(7);
  });

  it('bins entries around the correct window and emits zero segments for absent levels', () => {
    const now = new Date('2026-01-01T00:00:00Z').getTime();
    const entries = [
      makeEntry({ id: 'a', level: 'warning', timestamp: '2025-12-31T23:59:00Z' }),
      makeEntry({ id: 'b', level: 'error', timestamp: '2025-12-31T23:58:00Z' })
    ];

    const columns = aggregateActivity(entries, '1h', now);
    expect(columns.length).toBe(12);
    expect(
      columns.some((column) =>
        column.segments.some((segment) => segment.key === 'warning' && segment.value === 1)
      )
    ).toBe(true);
    expect(
      columns.some((column) =>
        column.segments.some((segment) => segment.key === 'error' && segment.value === 1)
      )
    ).toBe(true);
    expect(columns[0].segments).toHaveLength(LOG_LEVELS.length);
    expect(columns[0].segments.every((segment) => segment.value === 0)).toBe(true);
  });

  it('uses the expected label format for each range', () => {
    const now = Date.now();
    const timeFormat = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const dayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' });

    expect(aggregateActivity([], '1h', now)[0].label).toBe(
      timeFormat.format(new Date(now - 60 * 60 * 1000))
    );
    expect(aggregateActivity([], '6h', now)[0].label).toBe(
      timeFormat.format(new Date(now - 6 * 60 * 60 * 1000))
    );
    expect(aggregateActivity([], '24h', now)[0].label).toBe(
      timeFormat.format(new Date(now - 24 * 60 * 60 * 1000))
    );
    expect(aggregateActivity([], '7d', now)[0].label).toBe(
      dayFormat.format(new Date(now - 7 * 24 * 60 * 60 * 1000))
    );
  });

  it('ignores entries outside the active window', () => {
    const now = Date.now();
    const range: ActivityRange = '1h';
    const entries = [
      makeEntry({ id: 'future', timestamp: new Date(now + 1).toISOString() }),
      makeEntry({ id: 'old', timestamp: new Date(now - 60 * 60 * 1000 - 1).toISOString() }),
      makeEntry({ id: 'inside', timestamp: new Date(now - 5 * 60 * 1000).toISOString() })
    ];

    const columns = aggregateActivity(entries, range, now);
    expect(columns.some((column) => column.segments.some((segment) => segment.value > 0))).toBe(
      true
    );
    expect(
      columns.every((column) =>
        column.segments.every((segment) => segment.value === 0 || segment.value === 1)
      )
    ).toBe(true);
  });

  it('returns one slice per level in LOG_LEVELS order', () => {
    const slices = aggregateLevelDistribution([
      makeEntry({ level: 'warning' }),
      makeEntry({ id: 'b', level: 'error' }),
      makeEntry({ id: 'c', level: 'critical' })
    ]);

    expect(slices.map((slice) => slice.label)).toEqual(['warning', 'error', 'critical']);
    expect(slices.map((slice) => slice.color)).toEqual([
      LEVEL_COLORS.warning,
      LEVEL_COLORS.error,
      LEVEL_COLORS.critical
    ]);
  });

  it('returns an empty array for empty level distributions', () => {
    expect(aggregateLevelDistribution([])).toEqual([]);
  });

  it('sorts top event types by count and label, and respects the limit', () => {
    const entries = [
      makeEntry({ id: 'a', eventType: 'player_joined' }),
      makeEntry({ id: 'b', eventType: 'player_joined' }),
      makeEntry({ id: 'c', eventType: 'game_abandoned' }),
      makeEntry({ id: 'd', eventType: 'chat_message' })
    ];

    expect(aggregateTopEventTypes(entries)).toEqual([
      { label: 'player joined', value: 2 },
      { label: 'chat message', value: 1 },
      { label: 'game abandoned', value: 1 }
    ]);
    expect(aggregateTopEventTypes(entries, 2).length).toBe(2);
  });

  it('returns an empty array for empty event types', () => {
    expect(aggregateTopEventTypes([])).toEqual([]);
  });

  it('hasChartData detects positive values only', () => {
    expect(
      hasChartData([
        { label: '00:00', segments: LOG_LEVELS.map((level) => ({ key: level, value: 0 })) }
      ])
    ).toBe(false);
    expect(
      hasChartData([
        {
          label: '00:00',
          segments: [
            { key: 'debug', value: 0 },
            { key: 'info', value: 2 },
            ...LOG_LEVELS.slice(2).map((level) => ({ key: level, value: 0 }))
          ]
        }
      ])
    ).toBe(true);
  });
});
