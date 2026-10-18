import { get, writable } from 'svelte/store';
import { buildWsUrl } from '$lib/config';
import { CHAT_CLOSE_SESSION_REPLACED } from '$lib/types/chat';
import type { AnyEventHandler, EventHandler, WebSocketClient } from './ws';
import type { ConnectionState, WsCloseCode } from '$lib/types/ws';

const CHAT_PATH = '/api/v2/ws/chat';
const CHAT_PING_INTERVAL_MS = 30_000;
const CHAT_AUTH_TIMEOUT_MS = 10_000;
const defaultWsCloseCode: WsCloseCode = 1000;

export type ChatClient = WebSocketClient;

export function createChatClient(): ChatClient {
  const state = writable<ConnectionState>('disconnected');
  const handlers = new Map<string, Set<EventHandler>>();
  const anyEventHandlers = new Set<AnyEventHandler>();

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setTimeout> | undefined;
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  let token: string | null = null;
  let intentionalClose = false;
  let shouldReconnect = true;
  let reconnectAttempts = 0;
  let readOnlyMode = false;
  let lastSeenMessageAt = Date.now();

  const clearPing = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  };

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const clearAuthTimer = () => {
    if (authTimer) {
      clearTimeout(authTimer);
      authTimer = undefined;
    }
  };

  const setState = (next: ConnectionState) => {
    const previous = get(state);
    if (import.meta.env.DEV && previous !== next) {
      console.debug('[chat] state transition', previous, '→', next, CHAT_PATH);
    }
    state.set(next);
  };

  const dispatchToHandlers = <T>(event: string, payload: T) => {
    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach((handler) => handler(payload));
    }
    anyEventHandlers.forEach((handler) => handler(event, payload));
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) {
      return;
    }

    if (intentionalClose || !token || !shouldReconnect) {
      setState('disconnected');
      return;
    }

    const backoff = Math.min(1_000 * 2 ** reconnectAttempts + Math.random() * 1_000, 30_000);
    reconnectAttempts += 1;
    setState('reconnecting');

    reconnectTimer = setTimeout(() => {
      if (token) {
        openSocket(token, true);
      }
    }, backoff);
  };

  const startPingLoop = () => {
    clearPing();
    pingTimer = setInterval(() => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (Date.now() - lastSeenMessageAt > CHAT_PING_INTERVAL_MS * 3) {
        socket.close(1000, 'keepalive_timeout');
        return;
      }

      socket.send(JSON.stringify({ event: 'ping', payload: {} }));
    }, CHAT_PING_INTERVAL_MS);
  };

  const teardown = () => {
    clearPing();
    clearReconnect();
    clearAuthTimer();
    if (socket) {
      const currentSocket = socket;
      socket = null;
      try {
        currentSocket.close(defaultWsCloseCode, 'teardown');
      } catch {
        // Ignore close errors during cleanup.
      }
    }
  };

  function openSocket(nextToken: string, reconnecting = false): void {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (socket) {
      const previousSocket = socket;
      socket = null;
      previousSocket.onopen = null;
      previousSocket.onmessage = null;
      previousSocket.onerror = null;
      previousSocket.onclose = null;
      try {
        previousSocket.close(defaultWsCloseCode, 'reconnect');
      } catch {
        // Ignore close errors while replacing a dead socket.
      }
    }

    token = nextToken;
    intentionalClose = false;
    shouldReconnect = true;
    if (!reconnecting) {
      reconnectAttempts = 0;
    }
    lastSeenMessageAt = Date.now();
    clearReconnect();
    clearAuthTimer();

    const ws = new WebSocket(buildWsUrl(CHAT_PATH));
    socket = ws;
    setState(reconnecting ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      setState('authenticating');
      ws.send(JSON.stringify({ event: 'auth', payload: { token: nextToken } }));
      if (import.meta.env.DEV) console.debug('[chat] auth message sent');

      authTimer = setTimeout(() => {
        if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        shouldReconnect = false;
        dispatchToHandlers('auth_error', { reason: 'auth_timeout' });
        if (import.meta.env.DEV) console.debug('[chat] auth_timeout');
        ws.close(4408, 'auth_timeout');
      }, CHAT_AUTH_TIMEOUT_MS);
    };

    ws.onmessage = (event) => {
      let parsed: { event?: string; payload?: unknown } | undefined;
      try {
        parsed = JSON.parse(String(event.data)) as { event?: string; payload?: unknown };
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== 'object' || !('event' in parsed)) {
        return;
      }

      const eventName = parsed.event;
      if (typeof eventName !== 'string' || eventName.length === 0) {
        return;
      }

      lastSeenMessageAt = Date.now();

      if (eventName === 'pong') {
        return;
      }

      if (eventName === 'auth_ok') {
        clearAuthTimer();
        reconnectAttempts = 0;
        shouldReconnect = true;
        setState('connected');
        startPingLoop();
        dispatchToHandlers('auth_ok', parsed.payload);
        return;
      }

      if (eventName === 'auth_error') {
        const authPayload = (parsed.payload ?? {}) as { reason?: string };
        shouldReconnect = false;
        clearAuthTimer();
        dispatchToHandlers('auth_error', authPayload);
        if (import.meta.env.DEV)
          console.debug('[chat] auth_error', authPayload.reason ?? 'unknown');
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4401, authPayload.reason ?? 'auth_error');
        }
        return;
      }

      dispatchToHandlers(eventName, parsed.payload);
    };

    ws.onerror = () => {
      setState('reconnecting');
    };

    ws.onclose = (closeEvent) => {
      clearAuthTimer();
      clearPing();

      if (intentionalClose) {
        setState('disconnected');
        socket = null;
        return;
      }

      if (closeEvent.code === CHAT_CLOSE_SESSION_REPLACED) {
        shouldReconnect = false;
        dispatchToHandlers('session_replaced', {
          code: closeEvent.code,
          reason: closeEvent.reason || 'session_replaced',
          path: CHAT_PATH
        });
        setState('disconnected');
        socket = null;
        return;
      }

      if (closeEvent.code === 1000 && closeEvent.reason === 'reconnected') {
        shouldReconnect = false;
        setState('disconnected');
        socket = null;
        return;
      }

      if (closeEvent.code === 4401 || closeEvent.code === 4408 || closeEvent.code === 4409) {
        shouldReconnect = false;
        dispatchToHandlers('closed', {
          code: closeEvent.code,
          reason: closeEvent.reason || 'closed',
          path: CHAT_PATH
        });
        setState('disconnected');
        socket = null;
        return;
      }

      dispatchToHandlers('closed', {
        code: closeEvent.code,
        reason: closeEvent.reason || 'closed',
        path: CHAT_PATH
      });

      if (!shouldReconnect) {
        setState('disconnected');
        socket = null;
        return;
      }

      scheduleReconnect();
    };
  }

  const connect = (nextToken: string): void => {
    openSocket(nextToken, false);
  };

  return {
    state,
    isAlive(): boolean {
      return socket?.readyState === WebSocket.OPEN;
    },
    setReadOnlyMode(enabled: boolean): void {
      readOnlyMode = enabled;
    },
    connect,
    disconnect(): void {
      intentionalClose = true;
      shouldReconnect = false;
      clearReconnect();
      teardown();
      setState('disconnected');
    },
    disconnectAndWait(timeoutMs = 5_000): Promise<void> {
      intentionalClose = true;
      shouldReconnect = false;
      clearReconnect();
      clearPing();
      clearAuthTimer();
      const currentSocket = socket;
      if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED) {
        if (socket === currentSocket) socket = null;
        setState('disconnected');
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          currentSocket.removeEventListener('close', handleClose);
          if (error) {
            reject(error);
            return;
          }
          if (socket === currentSocket) socket = null;
          setState('disconnected');
          resolve();
        };
        const handleClose = () => finish();
        const timeout = setTimeout(
          () => finish(new Error(`WebSocket close timed out for ${CHAT_PATH}`)),
          timeoutMs
        );
        currentSocket.addEventListener('close', handleClose, { once: true });
        try {
          if (currentSocket.readyState !== WebSocket.CLOSING) {
            currentSocket.close(defaultWsCloseCode, 'session_handover');
          }
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error(`WebSocket close failed for ${CHAT_PATH}`)
          );
        }
      });
    },
    send(event: string, payload?: unknown): void {
      if (readOnlyMode && event === 'chat_send') {
        return;
      }

      if (socket && socket.readyState !== WebSocket.OPEN) {
        if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
          return;
        }
      }

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (!intentionalClose && token && shouldReconnect) {
          scheduleReconnect();
        }
        return;
      }

      socket.send(JSON.stringify({ event, payload }));
    },
    on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
      const eventHandlers = handlers.get(event) ?? new Set<EventHandler>();
      eventHandlers.add(handler as EventHandler);
      handlers.set(event, eventHandlers);

      return () => {
        const current = handlers.get(event);
        if (!current) {
          return;
        }

        current.delete(handler as EventHandler);
        if (current.size === 0) {
          handlers.delete(event);
        }
      };
    },
    onAny(handler: AnyEventHandler): () => void {
      anyEventHandlers.add(handler);
      return () => anyEventHandlers.delete(handler);
    }
  } satisfies WebSocketClient;
}
