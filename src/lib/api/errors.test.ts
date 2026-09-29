import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, TimeoutError } from './errors';

describe('API errors', () => {
  it('exposes the status and helpers on ApiError', () => {
    const error = new ApiError('Invalid payload', 400, 'INVALID_PAYLOAD', { field: 'email' });

    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.details).toEqual({ field: 'email' });
    expect(error.isClientError).toBe(true);
    expect(error.isServerError).toBe(false);
    expect(error.isUnauthorized).toBe(false);
  });

  it('marks 401 responses as unauthorized', () => {
    const error = new ApiError('Unauthorized', 401, 'UNAUTHORIZED');

    expect(error.isUnauthorized).toBe(true);
    expect(error.isClientError).toBe(true);
  });

  it('marks 500 responses as server errors', () => {
    const error = new ApiError('Server exploded', 500, 'INTERNAL');

    expect(error.isServerError).toBe(true);
    expect(error.isClientError).toBe(false);
  });

  it('creates network and timeout errors with the expected names', () => {
    const networkError = new NetworkError('Offline');
    const timeoutError = new TimeoutError('Too slow');

    expect(networkError).toBeInstanceOf(Error);
    expect(timeoutError).toBeInstanceOf(Error);
    expect(networkError.name).toBe('NetworkError');
    expect(timeoutError.name).toBe('TimeoutError');
  });
});
