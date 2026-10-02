import { describe, expect, it } from 'vitest';
import { resolveRedirect } from './redirect';

describe('resolveRedirect', () => {
  it.each([
    [null, '/lobby'],
    ['', '/lobby'],
    ['/history', '/history'],
    ['/game/abc-123', '/game/abc-123'],
    ['/history?filter=wins', '/history?filter=wins'],
    ['https://evil.com', '/lobby'],
    ['//evil.com', '/lobby'],
    ['/admin', '/lobby'],
    ['history', '/lobby']
  ])('resolves %s to %s', (raw, expected) => {
    expect(resolveRedirect(raw)).toBe(expected);
  });
});
