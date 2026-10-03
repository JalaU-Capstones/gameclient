/**
 * Build-time configuration derived from SvelteKit's PUBLIC_* env vars.
 *
 * SvelteKit's `$env/static/public` only exports variables that were
 * present when `svelte-kit sync` ran. To avoid type errors when the
 * variables are absent (e.g. a fresh clone without `.env`), we read them
 * through a small wrapper that falls back to sensible defaults.
 */
import * as publicEnv from '$env/static/public';

interface AppConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  requestTimeoutMs: number;
}

function readEnv(name: string, fallback: string): string {
  const value = (publicEnv as Record<string, string | undefined>)[name];
  return value !== undefined && value !== '' ? value : fallback;
}

export const config: AppConfig = {
  apiBaseUrl: readEnv('PUBLIC_API_BASE', ''),
  wsBaseUrl: readEnv('PUBLIC_WS_BASE', ''),
  requestTimeoutMs: Number(readEnv('PUBLIC_REQUEST_TIMEOUT_MS', '15000'))
};

export function buildWsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = config.wsBaseUrl;

  if (base) {
    const trimmedBase = base.trim().replace(/\/+$/, '');
    const isSecure = /^https?:\/\//i.test(trimmedBase);
    const isWs = /^wss?:\/\//i.test(trimmedBase);

    if (isWs) {
      const host = trimmedBase.replace(/^wss?:\/\//i, '');
      const scheme = trimmedBase.startsWith('wss://') ? 'wss' : 'ws';
      return `${scheme}://${host}${normalizedPath}`;
    }

    if (isSecure) {
      const host = trimmedBase.replace(/^https?:\/\//i, '');
      const scheme = trimmedBase.startsWith('https://') ? 'wss' : 'ws';
      return `${scheme}://${host}${normalizedPath}`;
    }
  }

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${normalizedPath}`;
}
