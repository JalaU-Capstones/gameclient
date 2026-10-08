export interface WsEnvelope<E extends string = string, P = unknown> {
  event: E;
  payload: P;
}

export type WsCloseCode = 1000 | 1007 | 1009 | 4401 | 4408 | 4409 | 4429 | 4500;

export const WsCloseReason = {
  NORMAL: 1000,
  INVALID_PAYLOAD: 1007,
  TOO_LARGE: 1009,
  UNAUTHORIZED: 4401,
  AUTH_TIMEOUT: 4408,
  SESSION_CONFLICT: 4409,
  TOO_MANY_CONNECTIONS: 4429,
  INTERNAL_ERROR: 4500
} as const;

export type ConnectionState =
  'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';

export interface AuthPayload {
  token: string;
}

export interface AuthOkPayload {
  user_id: string;
}
