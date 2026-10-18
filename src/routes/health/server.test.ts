import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('health route', () => {
  it('returns 200 with the ok payload', async () => {
    const response = await GET({} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
