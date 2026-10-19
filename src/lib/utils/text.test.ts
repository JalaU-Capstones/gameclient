import { describe, expect, it } from 'vitest';
import { formatUsername, sanitizeDisplayName } from './text';

describe('formatUsername', () => {
  it('prefixes usernames with @', () => {
    expect(formatUsername('john-doe')).toBe('@john-doe');
  });

  it('does not add a duplicate prefix', () => {
    expect(formatUsername('@john-doe')).toBe('@john-doe');
  });

  it('trims whitespace before formatting', () => {
    expect(formatUsername('  john-doe  ')).toBe('@john-doe');
  });

  it('returns an empty string for empty or missing usernames', () => {
    expect(formatUsername('')).toBe('');
    expect(formatUsername(null)).toBe('');
    expect(formatUsername(undefined)).toBe('');
    expect(formatUsername('   ')).toBe('');
  });
});

describe('sanitizeDisplayName', () => {
  it('removes bidirectional controls and trims whitespace', () => {
    expect(sanitizeDisplayName('\u202E Ada\u2066 ')).toBe('Ada');
  });

  it('removes directional marks, zero-width characters, and invisible separators', () => {
    expect(sanitizeDisplayName('A\u200EB\u200FC\u202AD\u2066E\uFEFF')).toBe('ABCDE');
  });

  it('normalizes internal whitespace', () => {
    expect(sanitizeDisplayName(' John\u00A0\u2003Doe ')).toBe('John Doe');
    expect(sanitizeDisplayName('John\t\nDoe')).toBe('John Doe');
    expect(sanitizeDisplayName('John\u0085Doe')).toBe('John Doe');
  });

  it('removes C0 and C1 controls', () => {
    expect(sanitizeDisplayName('Al\u0000i\u0080ce')).toBe('Alice');
  });

  it('returns an empty string for missing values', () => {
    expect(sanitizeDisplayName(null)).toBe('');
    expect(sanitizeDisplayName(undefined)).toBe('');
  });
});
