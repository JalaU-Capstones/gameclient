import { describe, expect, it } from 'vitest';
import { isUuid, safeRandomUuid } from './uuid';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('uuid utilities', () => {
  it('accepts valid UUIDs and rejects arbitrary strings', () => {
    expect(isUuid(VALID_UUID)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('returns a valid UUID when crypto.randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;

    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true
    });

    try {
      const value = safeRandomUuid();
      expect(isUuid(value)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true
      });
    }
  });
});
