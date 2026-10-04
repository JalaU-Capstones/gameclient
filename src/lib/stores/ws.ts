import { writable } from 'svelte/store';
import { createGameplaysClient, createPresenceClient } from '$lib/api/ws';
import type { WebSocketClient } from '$lib/api/ws';

function createGlobalWsStore(factory: () => WebSocketClient) {
  const { subscribe, set } = writable<WebSocketClient | null>(null);
  let instance: WebSocketClient | null = null;

  return {
    subscribe,
    getOrCreate: () => {
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

export const globalPresenceClient = createGlobalWsStore(createPresenceClient);
export const globalGameplaysClient = createGlobalWsStore(createGameplaysClient);
