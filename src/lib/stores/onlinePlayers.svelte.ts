import { SvelteSet } from 'svelte/reactivity';
import { httpClient } from '$lib/api/client';
import type { PublicUser } from '$lib/types/api';
import { globalPresenceClient } from './ws';
import type { WebSocketClient } from '$lib/api/ws';

class OnlinePlayersStore {
  users = $state<PublicUser[]>([]);
  playingIds = $state<ReadonlySet<string>>(new SvelteSet<string>());
  #unsubscribeEvents: (() => void) | null = null;
  #boundClient: WebSocketClient | null = null;
  #latestRequest = 0;
  #initialized = false;

  reset(): void {
    this.#unsubscribeEvents?.();
    this.#unsubscribeEvents = null;
    this.#boundClient = null;
    this.users = [];
    this.playingIds = new SvelteSet<string>();
    this.#initialized = false;
  }

  initialize(): void {
    if (this.#initialized) return;
    this.#initialized = true;

    globalPresenceClient.subscribe((client) => {
      if (!client) {
        this.#unsubscribeEvents?.();
        this.#unsubscribeEvents = null;
        this.#boundClient = null;
        this.users = [];
        this.playingIds = new SvelteSet<string>();
        return;
      }
      this.#bindClient(client);
    });
  }

  refresh(): void {
    const client = globalPresenceClient.getOrCreate();
    if (client.isAlive()) client.send('list_online_users');
  }

  #bindClient(client: WebSocketClient): void {
    if (client === this.#boundClient) return;
    this.#unsubscribeEvents?.();
    this.#boundClient = client;

    const offAuth = client.on('auth_ok', () => this.refresh());
    const offOnline = client.on<{ users?: string[]; playing?: string[] } | undefined>(
      'online_users',
      (payload) => this.#handleOnlineUsers(payload)
    );
    const offStatus = client.on<{ user_id: string; status: 'playing' | 'available' } | undefined>(
      'user_status',
      (payload) => this.#handleUserStatus(payload)
    );
    const offUpdated = client.on('user_updated', () => this.refresh());
    const offClosed = client.on('closed', () => {
      this.users = [];
      this.playingIds = new SvelteSet<string>();
    });
    this.#unsubscribeEvents = () => {
      offAuth();
      offOnline();
      offStatus();
      offUpdated();
      offClosed();
    };

    if (client.isAlive()) this.refresh();
  }

  #handleOnlineUsers(payload: { users?: string[]; playing?: string[] } | undefined): void {
    const requestId = ++this.#latestRequest;
    const playing = new SvelteSet(payload?.playing ?? []);

    void this.#fetchUsers(payload?.users ?? []).then((next) => {
      if (requestId !== this.#latestRequest) return;
      this.users = next;
      this.playingIds = playing;
    });
  }

  #handleUserStatus(
    payload: { user_id: string; status: 'playing' | 'available' } | undefined
  ): void {
    if (!payload) return;

    const next = new SvelteSet(this.playingIds);
    if (payload.status === 'playing') next.add(payload.user_id);
    else next.delete(payload.user_id);
    this.playingIds = next;
  }

  async #fetchUsers(userIds: string[]): Promise<PublicUser[]> {
    const unique = [...new Set(userIds)];
    const results = await Promise.allSettled(
      unique.map((id) => httpClient.get<PublicUser>(`/api/v2/users/${id}`))
    );

    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }
}

export const onlinePlayers = new OnlinePlayersStore();
