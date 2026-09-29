import { writable, type Readable } from 'svelte/store';
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
  connect(token: string): void;
  disconnect(): void;
  send(event: string, payload?: unknown): void;
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
}

const defaultWsCloseCode: WsCloseCode = 1000;

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

      authTimer = setTimeout(() => {
        if (socket !== ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        shouldReconnect = false;
        ws.close(4401, 'auth_timeout');
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
        return;
      }

      if (parsed.event === 'auth_error') {
        shouldReconnect = false;
        clearAuthTimer();
        console.warn('WebSocket auth failed', parsed.payload);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4401, 'auth_error');
        }
        return;
      }

      if (parsed.event === 'error') {
        const payload = parsed.payload as { code?: string; message?: string } | undefined;
        console.warn(
          `WebSocket error (${payload?.code ?? 'UNKNOWN'}): ${payload?.message ?? 'Unknown error'}`
        );
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

      if (intentionalClose) {
        setState('disconnected');
        socket = null;
        return;
      }

      if (!shouldReconnect) {
        setState('disconnected');
        socket = null;
        return;
      }

      if (closeEvent.code === 4401 || closeEvent.code === 4408) {
        shouldReconnect = false;
        setState('disconnected');
        socket = null;
        return;
      }

      scheduleReconnect();
    };
  }

  function connect(nextToken: string): void {
    openSocket(nextToken, false);
  }

  return {
    state,
    connect(nextToken: string): void {
      connect(nextToken);
    },
    disconnect(): void {
      intentionalClose = true;
      shouldReconnect = false;
      clearReconnect();
      teardown();
      setState('disconnected');
    },
    send(event: string, payload?: unknown): void {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
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
  return createWebSocketClient({ path: '/api/v2/ws/presence' });
}
