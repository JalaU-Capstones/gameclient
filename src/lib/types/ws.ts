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

export interface InvitationQueuedPayload {
  game_id: string;
  guest_id: string;
  position: number;
}

export interface InvitationExpiredPayload {
  game_id: string;
  reason: 'timeout' | 'target_busy' | 'target_unavailable';
}

export interface InvitationCanceledPayload {
  game_id: string;
  reason: 'host_left' | 'guest_left' | 'host_busy';
}

export interface UserStatusPayload {
  user_id: string;
  status: 'playing' | 'available';
}

export interface CreateGamePayload {
  guest_id: string;
  guest_username?: string;
  client_request_id?: string;
  request_id?: string;
}
