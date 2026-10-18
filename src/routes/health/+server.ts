import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
};
