import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
};

function isLocalhostOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0'
    );
  } catch {
    return false;
  }
}

export function validateOrigin(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.SKIP_ORIGIN_GUARD === 'true') return;

  const origin = env.ORIGIN;
  if (!origin) {
    throw new Error(
      'ORIGIN must be set when NODE_ENV=production. ' +
        'Set it to the public URL (for example https://app.example.com), ' +
        'or set SKIP_ORIGIN_GUARD=true for local Docker testing only.'
    );
  }

  if (isLocalhostOrigin(origin)) {
    throw new Error(
      `ORIGIN must not point to localhost when NODE_ENV=production. Got: ${origin}. ` +
        'Set ORIGIN to the public URL, or set SKIP_ORIGIN_GUARD=true for local Docker testing only.'
    );
  }
}

if (!building && process.env.VITEST !== 'true') {
  try {
    validateOrigin(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[startup] ${message}`);
    process.exit(1);
  }
}
