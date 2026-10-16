import { describe, expect, it } from 'vitest';
import type { LogEntry } from '$lib/types/api';
import { filterLogEntries, summarizeMessage } from './logFilter';

function entry(partial: Partial<LogEntry> & Pick<LogEntry, 'id' | 'level' | 'message'>): LogEntry {
  return {
    eventType: 'move_made',
    playerId: 'p1',
    gameplayId: null,
    metadata: null,
    timestamp: '2026-10-16T12:00:00Z',
    ...partial
  };
}

describe('filterLogEntries', () => {
  const sample = [
    entry({ id: '1', level: 'info', message: 'connected' }),
    entry({ id: '2', level: 'warning', message: 'slow reply' }),
    entry({ id: '3', level: 'error', message: 'socket closed' }),
    entry({
      id: '4',
      level: 'info',
      eventType: 'login_failed',
      message: 'Invalid credentials'
    })
  ];

  it('returns every entry for the all filter', () => {
    expect(filterLogEntries(sample, 'all')).toHaveLength(4);
  });

  it('keeps only matching levels', () => {
    expect(filterLogEntries(sample, 'warning').map((item) => item.id)).toEqual(['2']);
    expect(filterLogEntries(sample, 'error').map((item) => item.id)).toEqual(['3']);
  });

  it('treats fail as errors plus messages or events that mention fail', () => {
    expect(filterLogEntries(sample, 'fail').map((item) => item.id)).toEqual(['3', '4']);
  });
});

describe('summarizeMessage', () => {
  it('keeps short messages intact', () => {
    expect(summarizeMessage('hello world')).toBe('hello world');
  });

  it('truncates long messages with an ellipsis', () => {
    const long = 'a'.repeat(120);
    expect(summarizeMessage(long, 20)).toBe(`${'a'.repeat(19)}…`);
  });
});
