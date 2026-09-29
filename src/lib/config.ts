/**
 * Runtime configuration derived from Vite's PUBLIC_* env vars.
 */

interface AppConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  requestTimeoutMs: number;
}

const env = import.meta.env;

export const config: AppConfig = {
  apiBaseUrl: env.PUBLIC_API_BASE ?? '',
  wsBaseUrl: env.PUBLIC_WS_BASE ?? '',
  requestTimeoutMs: Number(env.PUBLIC_REQUEST_TIMEOUT_MS ?? 15_000)
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
