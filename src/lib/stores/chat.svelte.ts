import { SvelteDate } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { createChatClient, type ChatClient } from '$lib/api/chat';
import { bootstrapSession, renewSessionToken } from '$lib/auth/bootstrap';
import {
  toChatMessage,
  type ChatAuthErrorPayload,
  type ChatErrorPayload,
  type ChatHistoryPayload,
  type ChatMessage,
  type ChatUsersCountPayload
} from '$lib/types/chat';
import { currentUser } from './session';

export type ChatStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface ChatStoreOptions {
  client?: ChatClient;
  onAuthFailure?: (error: unknown) => void;
}

export interface ChatStore {
  readonly messages: ChatMessage[];
  readonly usersCount: number;
  readonly status: ChatStatus;
  readonly isOpen: boolean;
  readonly error: string | null;
  readonly authError: string | null;
  readonly rateLimitUntil: number | null;
  readonly unreadCount: number;

  initialize(options?: ChatStoreOptions): void;
  open(): Promise<void>;
  close(): void;
  send(content: string): Promise<void>;
  markRead(): void;
  clearError(): void;
  reset(): void;
}

const MAX_MESSAGES = 200;
const MAX_MESSAGE_AGE_MS = 2 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10_000;
const RATE_WINDOW_MAX = 10;
const RATE_BLOCK_MS = 30_000;
const MAX_CONTENT_LENGTH = 500;

function pruneMessages(nextMessages: ChatMessage[], now = Date.now()): ChatMessage[] {
  const cutoff = now - MAX_MESSAGE_AGE_MS;
  const filtered = nextMessages.filter((message) => {
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp)) {
      return true;
    }
    return timestamp >= cutoff;
  });

  return filtered.slice(-MAX_MESSAGES);
}

export function createChatStore(): ChatStore {
  let messages = $state<ChatMessage[]>([]);
  let usersCount = $state(0);
  let status = $state<ChatStatus>('idle');
  let isOpen = $state(false);
  let error = $state<string | null>(null);
  let authError = $state<string | null>(null);
  let rateLimitUntil = $state<number | null>(null);
  let unreadCount = $state(0);

  let client: ChatClient | null = null;
  let onAuthFailure: ((error: unknown) => void) | undefined;
  let stateSubscription: (() => void) | null = null;
  let unsubscribeHandlers: Array<() => void> = [];
  let authRefreshInFlight = false;
  const sendTimestamps: number[] = [];

  function resetClientSubscriptions(): void {
    stateSubscription?.();
    stateSubscription = null;
    unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
    unsubscribeHandlers = [];
  }

  function bindClient(nextClient: ChatClient): void {
    resetClientSubscriptions();
    client = nextClient;
    stateSubscription = nextClient.state.subscribe((next) => {
      status = next as ChatStatus;
    });

    unsubscribeHandlers = [
      nextClient.on('auth_error', (payload: ChatAuthErrorPayload | undefined) => {
        const reason = payload?.reason;

        if (reason === 'invalid_token' || reason === 'expired_token') {
          if (authRefreshInFlight) {
            return;
          }

          authRefreshInFlight = true;
          void (async () => {
            try {
              const nextToken = await renewSessionToken();
              client?.connect(nextToken);
            } catch (refreshError) {
              authError = 'Authentication failed.';
              status = 'error';
              isOpen = false;
              onAuthFailure?.(refreshError);
            } finally {
              authRefreshInFlight = false;
            }
          })();
          return;
        }

        if (reason === 'session_replaced') {
          isOpen = false;
          error = null;
          authError = null;
          unreadCount = 0;
          return;
        }

        authError = reason ?? 'Authentication failed.';
      }),
      nextClient.on('chat_history', (payload: ChatHistoryPayload | undefined) => {
        if (!payload) {
          return;
        }
        messages = pruneMessages(payload.messages.map((wire) => toChatMessage(wire)));
        usersCount = payload.users_count ?? 0;
      }),
      nextClient.on('chat_message', (payload: unknown) => {
        const wireMessage = payload as
          | {
              user_id?: string;
              user_name?: string;
              id?: string;
              content?: string;
              timestamp?: string;
            }
          | undefined;
        if (!wireMessage || !wireMessage.id || !wireMessage.user_id) {
          return;
        }

        const nextMessage = toChatMessage({
          id: wireMessage.id,
          user_id: wireMessage.user_id,
          user_name: wireMessage.user_name ?? '',
          content: wireMessage.content ?? '',
          timestamp: wireMessage.timestamp ?? new SvelteDate().toISOString()
        });

        messages = pruneMessages([...messages, nextMessage]);

        const current = get(currentUser);
        if (!isOpen && nextMessage.userId !== current?.id) {
          unreadCount += 1;
        }
      }),
      nextClient.on('chat_users_count', (payload: ChatUsersCountPayload | undefined) => {
        usersCount = payload?.count ?? 0;
      }),
      nextClient.on('chat_error', (payload: ChatErrorPayload | undefined) => {
        if (!payload) {
          return;
        }

        error = payload.message || 'Chat error.';
        if (payload.code === 'CHAT_RATE_LIMITED') {
          const retrySeconds = payload.retry_after_seconds ?? 30;
          rateLimitUntil = Date.now() + retrySeconds * 1000;
        }
      }),
      nextClient.on('session_replaced', () => {
        isOpen = false;
        error = null;
        authError = null;
        unreadCount = 0;
      }),
      nextClient.on('closed', (payload: { code?: number; reason?: string } | undefined) => {
        if (payload?.code === 4409 || payload?.reason === 'session_replaced') {
          isOpen = false;
          error = null;
          authError = null;
          unreadCount = 0;
        }
      })
    ];
  }

  function ensureClient(nextClient?: ChatClient): ChatClient {
    const next = nextClient ?? client ?? createChatClient();
    client = next;
    if (client !== next) {
      return next;
    }
    return client;
  }

  function applyRateLimitError(now = Date.now()): boolean {
    if (rateLimitUntil !== null && now < rateLimitUntil) {
      error = 'Too many messages. Please wait a moment.';
      return true;
    }

    if (rateLimitUntil !== null && now >= rateLimitUntil) {
      rateLimitUntil = null;
    }

    while (sendTimestamps.length > 0 && sendTimestamps[0] <= now - RATE_WINDOW_MS) {
      sendTimestamps.shift();
    }

    if (sendTimestamps.length >= RATE_WINDOW_MAX) {
      rateLimitUntil = now + RATE_BLOCK_MS;
      error = 'Too many messages. Please wait a moment.';
      return true;
    }

    return false;
  }

  return {
    get messages(): ChatMessage[] {
      return messages;
    },
    get usersCount(): number {
      return usersCount;
    },
    get status(): ChatStatus {
      return status;
    },
    get isOpen(): boolean {
      return isOpen;
    },
    get error(): string | null {
      return error;
    },
    get authError(): string | null {
      return authError;
    },
    get rateLimitUntil(): number | null {
      return rateLimitUntil;
    },
    get unreadCount(): number {
      return unreadCount;
    },
    initialize(options: ChatStoreOptions = {}): void {
      onAuthFailure = options.onAuthFailure ?? onAuthFailure;
      const selectedClient = options.client ?? client ?? createChatClient();
      if (selectedClient !== client) {
        bindClient(selectedClient);
        return;
      }
      bindClient(selectedClient);
    },
    async open(): Promise<void> {
      if (isOpen) {
        return;
      }

      error = null;
      authError = null;
      isOpen = true;

      const activeClient = ensureClient();
      if (activeClient.isAlive()) {
        return;
      }

      try {
        const { accessToken } = await bootstrapSession();
        activeClient.connect(accessToken);
      } catch (bootstrapError) {
        authError = 'Authentication failed.';
        status = 'error';
        isOpen = false;
        if (import.meta.env.DEV) {
          console.debug('[chat] bootstrap failed', bootstrapError);
        }
      }
    },
    close(): void {
      isOpen = false;
      client?.disconnect();
    },
    async send(content: string): Promise<void> {
      const now = Date.now();
      if (rateLimitUntil !== null && now < rateLimitUntil) {
        error = 'Too many messages. Please wait a moment.';
        return;
      }

      if (applyRateLimitError(now)) {
        return;
      }

      const trimmed = content.trim();
      if (!trimmed) {
        error = 'Message cannot be empty.';
        return;
      }

      if (trimmed.length > MAX_CONTENT_LENGTH) {
        error = 'Message cannot exceed 500 characters.';
        return;
      }

      error = null;
      sendTimestamps.push(now);
      client?.send('chat_send', { content: trimmed });
    },
    markRead(): void {
      unreadCount = 0;
    },
    clearError(): void {
      error = null;
    },
    reset(): void {
      client?.disconnect();
      resetClientSubscriptions();
      client = null;
      onAuthFailure = undefined;
      authRefreshInFlight = false;
      sendTimestamps.length = 0;
      messages = [];
      usersCount = 0;
      status = 'idle';
      isOpen = false;
      error = null;
      authError = null;
      rateLimitUntil = null;
      unreadCount = 0;
    }
  };
}

export const chatStore = createChatStore();
