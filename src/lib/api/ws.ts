import { get, writable, type Readable } from 'svelte/store';
import { buildWsUrl } from '$lib/config';
import type { ConnectionState, WsCloseCode, WsEnvelope } from '$lib/types/ws';

export interface WebSocketClientOptions {
  path: string;
  pingIntervalMs?: number;
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  authTimeoutMs?: number;
}

export type EventHandler<T = unknown> = (payload: T) => void;

export interface WebSocketClient {
  readonly state: Readable<ConnectionState>;
  isAlive(): boolean;
  connect(token: string): void;
  disconnect(): void;
  send(event: string, payload?: unknown): void;
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
}

const defaultWsCloseCode: WsCloseCode = 1000;

function sanitizeDiagnosticText(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]')
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, '[redacted]')
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*["']?[^\s,;]+/gi,
      (_match, label: string) => `${label}=[redacted]`
    )
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]');
}

export function createWebSocketClient(options: WebSocketClientOptions): WebSocketClient {
  const {
    path,
    pingIntervalMs = 30_000,
    maxReconnectAttempts = 10,
    baseReconnectDelayMs = 1_000,
    maxReconnectDelayMs = 30_000,
    authTimeoutMs = 10_000
  } = options;

  const state = writable<ConnectionState>('disconnected');
  const handlers = new Map<string, Set<EventHandler>>();

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setTimeout> | undefined;
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let token: string | null = null;
  let intentionalClose = false;
  let shouldReconnect = true;
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
      console.debug('[ws] state transition', previous, '→', next, path);
    }
    state.set(next);
  };

  const dispatchToHandlers = <T>(event: string, payload: T) => {
    const eventHandlers = handlers.get(event);
    if (!eventHandlers) {
      return;
    }

    eventHandlers.forEach((handler) => handler(payload));
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) {
      return;
    }

    if (intentionalClose || !token || !shouldReconnect) {
      setState('disconnected');
      return;
    }

    if (reconnectAttempts >= maxReconnectAttempts) {
      setState('disconnected');
      return;
    }

    const backoff = Math.min(
      baseReconnectDelayMs * 2 ** reconnectAttempts + Math.random() * baseReconnectDelayMs,
      maxReconnectDelayMs
    );
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

      if (Date.now() - lastSeenMessageAt > pingIntervalMs * 2) {
        socket.close(1000, 'keepalive_timeout');
        return;
      }

      socket.send(JSON.stringify({ event: 'ping', payload: {} }));
    }, pingIntervalMs);
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

    const ws = new WebSocket(buildWsUrl(path));
    socket = ws;
    setState(reconnecting ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      setState('authenticating');
      ws.send(JSON.stringify({ event: 'auth', payload: { token: nextToken } }));
      if (import.meta.env.DEV) console.debug('[ws] auth message sent for', path);

      authTimer = setTimeout(() => {
        if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        shouldReconnect = false;
        if (import.meta.env.DEV) console.debug('[ws] auth_timeout', path);
        dispatchToHandlers('auth_failed', { reason: 'auth_timeout', path });
        ws.close(4408, 'auth_timeout');
      }, authTimeoutMs);
    };

    ws.onmessage = (event) => {
      let parsed: WsEnvelope | undefined;
      try {
        parsed = JSON.parse(String(event.data)) as WsEnvelope;
      } catch {
        return;
      }

      if (!parsed || typeof parsed !== 'object' || !('event' in parsed)) {
        return;
      }

      lastSeenMessageAt = Date.now();

      if (parsed.event === 'pong') {
        return;
      }

      if (parsed.event === 'auth_ok') {
        clearAuthTimer();
        reconnectAttempts = 0;
        shouldReconnect = true;
        setState('connected');
        startPingLoop();
        if (import.meta.env.DEV) console.debug('[ws] auth_ok', path);
        dispatchToHandlers(parsed.event, parsed.payload);
        return;
      }

      if (parsed.event === 'auth_error') {
        shouldReconnect = false;
        clearAuthTimer();
        dispatchToHandlers('auth_failed', { reason: 'auth_error', path });
        if (import.meta.env.DEV) console.debug('[ws] auth_error', path);
        console.warn('[ws] authentication failed', path);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4401, 'auth_error');
        }
        return;
      }

      if (parsed.event === 'error') {
        const payload = parsed.payload as { code?: string; message?: string } | undefined;
        if (import.meta.env.DEV) {
          console.debug('[ws] error', path, {
            code: payload?.code,
            message: sanitizeDiagnosticText(payload?.message)
          });
        }
        console.warn('[ws] error', { code: payload?.code, path });
        dispatchToHandlers(parsed.event, parsed.payload);
        return;
      }

      dispatchToHandlers(parsed.event, parsed.payload);
    };

    ws.onerror = () => {
      setState('reconnecting');
    };

    ws.onclose = (closeEvent) => {
      clearAuthTimer();
      clearPing();
      if (import.meta.env.DEV) {
        console.debug('[ws] socket closed', path, {
          code: closeEvent.code,
          reason: sanitizeDiagnosticText(closeEvent.reason)
        });
      }

      if (intentionalClose) {
        setState('disconnected');
        socket = null;
        return;
      }

      if (closeEvent.code === 4401 || closeEvent.code === 4408) {
        shouldReconnect = false;
        dispatchToHandlers('auth_failed', {
          reason: closeEvent.reason || 'auth_failed',
          code: closeEvent.code,
          path
        });
        setState('disconnected');
        socket = null;
        return;
      }

      if (!shouldReconnect) {
        setState('disconnected');
        socket = null;
        return;
      }

      scheduleReconnect();
    };
  }

  function connect(nextToken: string): void {
    if (import.meta.env.DEV) console.debug('[ws] connect requested for', path);
    openSocket(nextToken, false);
  }

  return {
    state,
    isAlive(): boolean {
      return socket?.readyState === WebSocket.OPEN;
    },
    connect(nextToken: string): void {
      connect(nextToken);
    },
    disconnect(): void {
      if (import.meta.env.DEV) console.debug('[ws] disconnect requested for', path);
      intentionalClose = true;
      shouldReconnect = false;
      clearReconnect();
      teardown();
      setState('disconnected');
    },
    send(event: string, payload?: unknown): void {
      if (import.meta.env.DEV) console.debug('[ws] send requested', path, event);
      if (socket && socket.readyState !== WebSocket.OPEN) {
        if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
          return;
        }
      }

      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (import.meta.env.DEV)
          console.debug('[ws] send skipped; socket is not open', path, event);
        setState('disconnected');
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
    }
  };
}

export function createGameplaysClient(): WebSocketClient {
  return createWebSocketClient({ path: '/api/v2/ws/gameplays' });
}

export function createPresenceClient(): WebSocketClient {
  return createWebSocketClient({
    path: '/api/v2/ws/presence',
    pingIntervalMs: 25_000,
    maxReconnectAttempts: Number.POSITIVE_INFINITY
  });
}
