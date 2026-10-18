import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '$lib/types/api';
import { downloadCsv, logsToCsv } from './csv';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    level: 'info',
    eventType: 'chat_message',
    message: 'hello',
    playerId: 'player-1',
    gameplayId: 'game-1',
    metadata: { reason: 'abandon', note: 'a, b' },
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('csv', () => {
  it('produces the CSV header and serializes content with CRLF line endings', () => {
    const csv = logsToCsv([makeEntry()]);

    expect(
      csv.startsWith('id,level,event_type,message,player_id,gameplay_id,timestamp,metadata')
    ).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('quotes values that need escaping', () => {
    const entry = makeEntry({
      message: 'hello, "there"',
      playerId: '  player  ',
      gameplayId: null,
      metadata: { note: 'line 1\nline 2' }
    });

    const csv = logsToCsv([entry]);
    expect(csv).toContain('"hello, ""there"""');
    expect(csv).toContain('"  player  "');
    expect(csv).toContain('"{""note"":""line 1\\nline 2""}"');
  });

  it('serializes empty ids and metadata correctly', () => {
    const csv = logsToCsv([
      makeEntry({
        playerId: null,
        gameplayId: null,
        metadata: null,
        message: ''
      })
    ]);

    expect(csv).toMatch(/log-1,info,chat_message,,,,2026-01-01T00:00:00Z,/);
  });

  it('returns just the header for empty input', () => {
    expect(logsToCsv([])).toBe(
      'id,level,event_type,message,player_id,gameplay_id,timestamp,metadata'
    );
  });

  it('downloads the CSV using a blob and anchor', async () => {
    const createObjectURL = vi.fn(() => 'blob:test-url');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL
    });

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('id,level\r\n1,info', { filename: 'gameapi-logs-20240101-123456.csv' });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    expect(appendChildSpy).toHaveBeenCalledTimes(1);
    expect(removeChildSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe('gameapi-logs-20240101-123456.csv');
    expect(anchor.getAttribute('rel')).toBe('noopener');
    expect(anchor.href).toContain('blob:test-url');

    const call = createObjectURL.mock.calls[0] as unknown[];
    expect(call[0]).toBeInstanceOf(Blob);
  });
});
