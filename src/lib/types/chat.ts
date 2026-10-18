/** Wire payloads for the AsyncAPI chat channel. */
export interface ChatAuthPayload {
  token: string;
}

/** AsyncAPI chat schema: chat_send client payload. */
export interface ChatSendPayload {
  content: string;
}

/** AsyncAPI chat schema: auth_ok server payload. */
export interface ChatAuthOkPayload {
  user_id: string;
}

export type ChatAuthErrorReason =
  'invalid_token' | 'expired_token' | 'auth_timeout' | 'expected_auth_event' | 'session_replaced';

/** AsyncAPI chat schema: auth_error server payload. */
export interface ChatAuthErrorPayload {
  reason: ChatAuthErrorReason;
}

/** AsyncAPI chat schema: ChatMessage message. */
export interface WireChatMessage {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** AsyncAPI chat schema: chat_history server payload. */
export interface ChatHistoryPayload {
  messages: WireChatMessage[];
  users_count: number;
}

export type ChatMessagePayload = WireChatMessage;

/** AsyncAPI chat schema: chat_users_count server payload. */
export interface ChatUsersCountPayload {
  count: number;
}

export type ChatErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_PAYLOAD'
  | 'NOT_IMPLEMENTED'
  | 'CHAT_MESSAGE_EMPTY'
  | 'CHAT_MESSAGE_TOO_LONG'
  | 'CHAT_RATE_LIMITED';

/** AsyncAPI chat schema: chat_error server payload. */
export interface ChatErrorPayload {
  code: ChatErrorCode;
  message: string;
  /** Present only when `code === 'CHAT_RATE_LIMITED'`. */
  retry_after_seconds?: number;
}

export const CHAT_CLOSE_RECONNECTED = 1000;
export const CHAT_CLOSE_SESSION_REPLACED = 4409;

export type ChatClientEvent = 'auth' | 'ping' | 'chat_send';

export type ChatServerEvent =
  | 'auth_ok'
  | 'auth_error'
  | 'pong'
  | 'chat_history'
  | 'chat_message'
  | 'chat_users_count'
  | 'chat_error';

/** UI representation for a chat message mapped from the AsyncAPI chat schema. */
export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Map a wire message to its UI form. */
export function toChatMessage(wire: WireChatMessage): ChatMessage {
  return {
    id: wire.id,
    userId: wire.user_id,
    userName: wire.user_name,
    content: wire.content,
    timestamp: wire.timestamp
  };
}
