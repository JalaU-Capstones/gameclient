import { config } from '$lib/config';
import { ApiError, NetworkError, TimeoutError } from './errors';

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, options?: RequestOptions): Promise<T>;
}

export function createHttpClient(baseUrl = config.apiBaseUrl): HttpClient {
  const request = async <T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions = {}
  ): Promise<T> => {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${normalizedBase}${normalizedPath}`;
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const abortListener = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener('abort', abortListener, { once: true });
    }

    const init: RequestInit = {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      signal: controller.signal
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortListener);
      }

      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new TimeoutError(`Request to ${path} timed out after ${timeoutMs}ms`);
      }

      throw new NetworkError();
    }

    clearTimeout(timeoutId);
    if (options.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const parsed = isJson ? await response.json().catch(() => null) : await response.text();

    if (!response.ok) {
      const message =
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : null) ?? `Request failed with status ${response.status}`;
      const code =
        parsed && typeof parsed === 'object' && 'code' in parsed
          ? String((parsed as { code: unknown }).code)
          : undefined;
      throw new ApiError(message, response.status, code, parsed);
    }

    return parsed as T;
  };

  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body, options),
    put: (path, body, options) => request('PUT', path, body, options),
    delete: (path, options) => request('DELETE', path, undefined, options)
  };
}

export const httpClient = createHttpClient();
