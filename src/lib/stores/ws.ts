import { get, writable } from 'svelte/store';
import { createGameplaysClient, createPresenceClient } from '$lib/api/ws';
import type { AnyEventHandler, EventHandler, WebSocketClient } from '$lib/api/ws';
import {
  broadcastGameplayEvent,
  claimGameplayOwnership,
  subscribeGameplayEvents
} from '$lib/auth/sessionLock';

export const standbyMode = writable(false);

function createGlobalWsStore(factory: () => WebSocketClient) {
  const { subscribe, set } = writable<WebSocketClient | null>(null);
  let instance: WebSocketClient | null = null;
  let readOnlyMode = false;

  return {
    subscribe,
    getOrCreate: () => {
      if (instance && get(instance.state) === 'connected' && !instance.isAlive()) {
        instance.disconnect();
        instance = null;
        set(null);
      }
      if (!instance) {
        instance = factory();
        instance.setReadOnlyMode(readOnlyMode);
        set(instance);
      }
      return instance;
    },
    disconnect: () => {
      instance?.disconnect();
      instance = null;
      set(null);
    },
    setReadOnlyMode: (enabled: boolean) => {
      readOnlyMode = enabled;
      instance?.setReadOnlyMode(enabled);
    }
  };
}

export function createCoordinatedGameplaysClient(): WebSocketClient {
  const baseClient = createGameplaysClient();
  const localHandlers = new Map<string, Set<EventHandler>>();
  const localAnyHandlers = new Set<AnyEventHandler>();
  let token: string | null = null;
  let leader = false;
  let readOnlyMode = false;
  let releaseOwnership: (() => void) | null = null;
  let leadershipRequest: Promise<void> | null = null;
  let connectionGeneration = 0;

  const notify = (event: string, payload?: unknown) => {
    const handlers = localHandlers.get(event);
    handlers?.forEach((handler) => handler(payload));
    localAnyHandlers.forEach((handler) => handler(event, payload));
  };

  const ensureLeader = (generation: number): Promise<void> => {
    if (leader) return Promise.resolve();
    if (leadershipRequest) {
      return leadershipRequest
        .catch(() => undefined)
        .then(() => {
          if (generation !== connectionGeneration || !token || leader) return;
          return ensureLeader(generation);
        });
    }
    leadershipRequest = (async () => {
      const tabId = `gameplay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const release = await claimGameplayOwnership(tabId);
      if (!token || generation !== connectionGeneration) {
        release();
        return;
      }
      leader = true;
      releaseOwnership = release;
      baseClient.connect(token);
    })().finally(() => {
      leadershipRequest = null;
    });
    return leadershipRequest;
  };

  void subscribeGameplayEvents((event, payload) => {
    if (event === 'gameplay-send') {
      if (!leader || !payload || typeof payload !== 'object' || !('event' in payload)) return;
      const message = payload;
      if (typeof message.event === 'string') {
        baseClient.send(message.event, 'payload' in message ? message.payload : undefined);
      }
      return;
    }
    notify(event, payload);
  });
  const relayGameplayEvent: AnyEventHandler = (event, payload) => {
    if (leader && event !== 'auth_ok' && event !== 'auth_failed' && event !== 'closed') {
      broadcastGameplayEvent(event, payload);
    }
    notify(event, payload);
  };
  baseClient.onAny(relayGameplayEvent);

  const client: WebSocketClient = {
    state: baseClient.state,
    isAlive: () => baseClient.isAlive(),
    setReadOnlyMode: (enabled) => {
      readOnlyMode = enabled;
      baseClient.setReadOnlyMode(enabled);
    },
    connect: (nextToken) => {
      token = nextToken;
      if (leader) {
        baseClient.connect(nextToken);
        return;
      }
      const generation = ++connectionGeneration;
      void ensureLeader(generation).catch((error: unknown) => {
        console.error('[ws] gameplay ownership failed', error);
      });
    },
    disconnect: () => {
      connectionGeneration += 1;
      leader = false;
      token = null;
      baseClient.disconnect();
      releaseOwnership?.();
      releaseOwnership = null;
    },
    disconnectAndWait: async (timeoutMs) => {
      connectionGeneration += 1;
      leader = false;
      token = null;
      await baseClient.disconnectAndWait(timeoutMs);
      releaseOwnership?.();
      releaseOwnership = null;
    },
    send: (event, payload) => {
      if (readOnlyMode) return;
      if (leader) {
        baseClient.send(event, payload);
        return;
      }
      broadcastGameplayEvent('gameplay-send', { event, payload });
    },
    on: <T = unknown>(event: string, handler: (payload: T) => void) => {
      let handlers = localHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        localHandlers.set(event, handlers);
      }
      handlers.add(handler as EventHandler);
      return () => {
        handlers?.delete(handler as EventHandler);
        if (handlers && handlers.size === 0) localHandlers.delete(event);
      };
    },
    onAny: (handler) => {
      localAnyHandlers.add(handler);
      return () => localAnyHandlers.delete(handler);
    }
  };

  return client;
}

export const globalPresenceClient = createGlobalWsStore(createPresenceClient);
export const globalGameplaysClient = createGlobalWsStore(createCoordinatedGameplaysClient);

let lastPresenceToken: string | null = null;
let presenceReconnectRequest: (() => void) | null = null;

export function setLastPresenceToken(token: string | null): void {
  lastPresenceToken = token;
}

export function setPresenceReconnectRequest(request: (() => void) | null): void {
  presenceReconnectRequest = request;
}

export function requestPresenceReconnect(): void {
  const client = globalPresenceClient.getOrCreate();
  if (client.isAlive()) return;

  if (presenceReconnectRequest) {
    presenceReconnectRequest();
    return;
  }

  if (lastPresenceToken) client.connect(lastPresenceToken);
}
