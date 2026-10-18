import { describe, expect, it } from 'vitest';
import { isChatRouteVisible } from './visibility';

describe('isChatRouteVisible', () => {
  it.each([
    ['/lobby', true],
    ['/history', true],
    ['/game/abc-123', true],
    ['/game/abc-123/whatever', true],
    ['/game/', false],
    ['/game', false],
    ['/profile', false],
    ['/logs', false],
    ['/health', false],
    ['/login', false],
    ['/register', false],
    ['/', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['/lobby/extra', false],
    ['/history?foo=bar', false]
  ])('returns %s for %s', (pathname, expected) => {
    expect(isChatRouteVisible(pathname as string | null | undefined)).toBe(expected);
  });
});
