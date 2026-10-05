import { get, writable } from 'svelte/store';
import { createGameplaysClient, createPresenceClient } from '$lib/api/ws';
import type { EventHandler, WebSocketClient } from '$lib/api/ws';
import {
  broadcastGameplayEvent,
  claimGameplayOwnership,
  subscribeGameplayEvents
} from '$lib/auth/sessionLock';

function createGlobalWsStore(factory: () => WebSocketClient) {
  const { subscribe, set } = writable<WebSocketClient | null>(null);
  let instance: WebSocketClient | null = null;

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
        set(instance);
      }
      return instance;
    },
    disconnect: () => {
      instance?.disconnect();
      instance = null;
      set(null);
    }
  };
}

export function createCoordinatedGameplaysClient(): WebSocketClient {
  const baseClient = createGameplaysClient();
  const localHandlers = new Map<string, Set<EventHandler>>();
  let token: string | null = null;
  let ownerToken: string | null = null;
  let leader = false;

  const notify = (event: string, payload?: unknown) => {
    const handlers = localHandlers.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => handler(payload));
  };

  const ensureLeader = async () => {
    const tabId = `gameplay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const release = await claimGameplayOwnership(tabId);
    leader = true;
    ownerToken = token;
    void ownerToken;
    return release;
  };

  void subscribeGameplayEvents((event, payload) => {
    if (event === 'gameplay-send') return;
    notify(event, payload);
  });

  const client: WebSocketClient = {
    state: baseClient.state,
    isAlive: () => baseClient.isAlive(),
    connect: (nextToken) => {
      token = nextToken;
      if (leader) {
        baseClient.connect(nextToken);
        return;
      }
      void ensureLeader().catch(() => undefined);
    },
    disconnect: () => {
      leader = false;
      token = null;
      baseClient.disconnect();
    },
    send: (event, payload) => {
      if (leader) {
        baseClient.send(event, payload);
        return;
      }
      broadcastGameplayEvent(event, payload);
    },
    on: <T = unknown>(event: string, handler: (payload: T) => void) => {
      let handlers = localHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        localHandlers.set(event, handlers);
      }
      handlers.add(handler as EventHandler);
      const unsubscribeBase = baseClient.on(event, handler as EventHandler);
      return () => {
        handlers?.delete(handler as EventHandler);
        unsubscribeBase();
        if (handlers && handlers.size === 0) localHandlers.delete(event);
      };
    }
  };

  return client;
}

export const globalPresenceClient = createGlobalWsStore(createPresenceClient);
export const globalGameplaysClient = createGlobalWsStore(createGameplaysClient);

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
