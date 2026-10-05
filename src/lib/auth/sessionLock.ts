export type SessionMessage =
  | { type: 'logout' }
  | { type: 'session-refreshed'; at: number }
  | { type: 'presence-takeover'; tabId: string }
  | { type: 'presence-release'; tabId: string }
  | { type: 'presence-query'; tabId: string }
  | { type: 'presence-owner'; tabId: string }
  | { type: 'presence-list-request'; tabId: string }
  | { type: 'presence-users'; userIds: string[] }
  | { type: 'gameplay-query'; tabId: string }
  | { type: 'gameplay-takeover'; tabId: string }
  | { type: 'gameplay-release'; tabId: string }
  | { type: 'gameplay-owner'; tabId: string }
  | { type: 'gameplay-send'; event: string; payload?: unknown }
  | { type: 'gameplay-event'; event: string; payload?: unknown }
  | { type: 'session-lock-request'; requestId: string }
  | { type: 'session-lock-acquired'; requestId: string; ownerId: string }
  | { type: 'session-lock-released'; ownerId: string };

const channelName = 'gameapi';
const sessionLockName = 'gameapi-session';
const lockWaiters = new Set<() => void>();
const messageHandlers = new Set<(message: SessionMessage) => void>();
const pendingLockRequests = new Set<string>();
let channel: BroadcastChannel | null = null;
let channelUsers = 0;
let fallbackOwner: string | null = null;
let lastSessionRefreshAt = 0;
let localLockHeld = false;
let tabSequence = 0;
let presenceOwnerId: string | null = null;
let presenceOwnerResponseAt = 0;
let presenceLockRelease: (() => void) | null = null;
let presenceLockPromise: Promise<() => void> | null = null;
const presenceCandidates = new Set<string>();
const presenceWaiters = new Set<() => void>();
let gameplayOwnerId: string | null = null;
let gameplayOwnerResponseAt = 0;
let gameplayLockRelease: (() => void) | null = null;
let gameplayLockPromise: Promise<() => void> | null = null;
const gameplayCandidates = new Set<string>();
const gameplayWaiters = new Set<() => void>();

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (channel) return channel;
  channel = new BroadcastChannel(channelName);
  channel.onmessage = (event: MessageEvent<SessionMessage>) => {
    const message = event.data;
    if (!message || typeof message !== 'object' || !('type' in message)) return;

    if (import.meta.env.DEV) {
      console.debug('[sessionLock] channel message', {
        type: message.type,
        tabId: 'tabId' in message ? message.tabId : undefined,
        ownerId: 'ownerId' in message ? message.ownerId : undefined,
        event: 'event' in message ? message.event : undefined
      });
    }

    if (message.type === 'session-refreshed' && Number.isFinite(message.at)) {
      lastSessionRefreshAt = Math.max(lastSessionRefreshAt, message.at);
    } else if (message.type === 'presence-query') {
      presenceCandidates.add(message.tabId);
      if (presenceOwnerId) announcePresenceOwner(presenceOwnerId);
      presenceWaiters.forEach((notify) => notify());
    } else if (message.type === 'presence-takeover') {
      presenceOwnerId = message.tabId;
      presenceCandidates.add(message.tabId);
      presenceWaiters.forEach((notify) => notify());
    } else if (message.type === 'presence-owner') {
      presenceOwnerId = message.tabId;
      presenceOwnerResponseAt = Date.now();
      presenceWaiters.forEach((notify) => notify());
    } else if (message.type === 'presence-release') {
      if (presenceOwnerId === message.tabId) presenceOwnerId = null;
      presenceCandidates.delete(message.tabId);
      presenceWaiters.forEach((notify) => notify());
    } else if (message.type === 'gameplay-query') {
      gameplayCandidates.add(message.tabId);
      if (gameplayOwnerId) announceGameplayOwner(gameplayOwnerId);
      gameplayWaiters.forEach((notify) => notify());
    } else if (message.type === 'gameplay-takeover') {
      gameplayOwnerId = message.tabId;
      gameplayCandidates.add(message.tabId);
      gameplayWaiters.forEach((notify) => notify());
    } else if (message.type === 'gameplay-owner') {
      gameplayOwnerId = message.tabId;
      gameplayOwnerResponseAt = Date.now();
      gameplayWaiters.forEach((notify) => notify());
    } else if (message.type === 'gameplay-release') {
      if (gameplayOwnerId === message.tabId) gameplayOwnerId = null;
      gameplayCandidates.delete(message.tabId);
      gameplayWaiters.forEach((notify) => notify());
    } else if (message.type === 'gameplay-event') {
      messageHandlers.forEach((handler) => handler(message));
      return;
    } else if (message.type === 'session-lock-request') {
      pendingLockRequests.add(message.requestId);
      if (fallbackOwner) {
        channel?.postMessage({
          type: 'session-lock-acquired',
          requestId: message.requestId,
          ownerId: fallbackOwner
        } satisfies SessionMessage);
      }
    } else if (message.type === 'session-lock-acquired') {
      fallbackOwner = message.ownerId;
      lockWaiters.forEach((notify) => notify());
    } else if (message.type === 'session-lock-released') {
      if (fallbackOwner === message.ownerId) fallbackOwner = null;
      pendingLockRequests.delete(message.ownerId);
      lockWaiters.forEach((notify) => notify());
    }

    messageHandlers.forEach((handler) => handler(message));
  };
  return channel;
}

export function openSessionChannel(): () => void {
  ensureChannel();
  channelUsers += 1;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    channelUsers = Math.max(0, channelUsers - 1);
    if (channelUsers === 0 && channel) {
      channel.close();
      channel = null;
    }
  };
}

export function subscribeSessionMessages(handler: (message: SessionMessage) => void): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export function onRemoteLogout(handler: () => void): () => void {
  return subscribeSessionMessages((message) => {
    if (message.type === 'logout') handler();
  });
}

function postMessage(message: SessionMessage): void {
  const openedHere = channel === null && channelUsers === 0;
  const currentChannel = ensureChannel();
  currentChannel?.postMessage(message);
  if (openedHere && currentChannel && channelUsers === 0) {
    currentChannel.close();
    channel = null;
  }
}

export function broadcastLogout(): void {
  postMessage({ type: 'logout' });
}

export function broadcastSessionRefreshed(at = Date.now()): void {
  lastSessionRefreshAt = Math.max(lastSessionRefreshAt, at);
  postMessage({ type: 'session-refreshed', at });
}

export function getLastSessionRefreshAt(): number {
  return lastSessionRefreshAt;
}

export function announcePresenceTakeover(tabId: string): void {
  postMessage({ type: 'presence-takeover', tabId });
}

export function announcePresenceRelease(tabId: string): void {
  postMessage({ type: 'presence-release', tabId });
}

export function announcePresenceQuery(tabId: string): void {
  postMessage({ type: 'presence-query', tabId });
}

export function announcePresenceOwner(tabId: string): void {
  postMessage({ type: 'presence-owner', tabId });
}

export function announceGameplayQuery(tabId: string): void {
  postMessage({ type: 'gameplay-query', tabId });
}

export function announceGameplayTakeover(tabId: string): void {
  postMessage({ type: 'gameplay-takeover', tabId });
}

export function announceGameplayRelease(tabId: string): void {
  postMessage({ type: 'gameplay-release', tabId });
}

export function announceGameplayOwner(tabId: string): void {
  postMessage({ type: 'gameplay-owner', tabId });
}

export function broadcastGameplayEvent(event: string, payload?: unknown): void {
  postMessage({ type: 'gameplay-event', event, payload });
}

export function subscribeGameplayEvents(
  handler: (event: string, payload?: unknown) => void
): () => void {
  return subscribeSessionMessages((message) => {
    if (message.type === 'gameplay-event') {
      handler(message.event, message.payload);
    }
  });
}

export function announcePresenceListRequest(tabId: string): void {
  postMessage({ type: 'presence-list-request', tabId });
}

export function broadcastPresenceUsers(userIds: string[]): void {
  postMessage({ type: 'presence-users', userIds });
}

function waitForPresenceChange(timeoutMs = 250): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      presenceWaiters.delete(finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    presenceWaiters.add(finish);
  });
}

async function claimBroadcastPresenceOwnership(tabId: string): Promise<() => void> {
  const closeChannel = channel ? undefined : openSessionChannel();

  while (true) {
    presenceCandidates.clear();
    presenceCandidates.add(tabId);
    const ownerQueryAt = Date.now();
    announcePresenceQuery(tabId);
    await waitForPresenceChange(120);

    if (presenceOwnerId && presenceOwnerId !== tabId) {
      if (presenceOwnerResponseAt >= ownerQueryAt) {
        await waitForPresenceChange();
        continue;
      }
      presenceOwnerId = null;
    }

    const winner = [...presenceCandidates].sort()[0];
    if (winner !== tabId) {
      await waitForPresenceChange();
      continue;
    }

    presenceOwnerId = tabId;
    announcePresenceTakeover(tabId);
    await waitForPresenceChange(60);
    if (presenceOwnerId !== tabId) continue;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (presenceOwnerId === tabId) presenceOwnerId = null;
      presenceCandidates.delete(tabId);
      announcePresenceRelease(tabId);
      if (presenceLockRelease === release) presenceLockRelease = null;
      presenceLockPromise = null;
      presenceWaiters.forEach((notify) => notify());
      closeChannel?.();
    };
    presenceLockRelease = release;
    return release;
  }
}

export function claimPresenceOwnership(tabId: string): Promise<() => void> {
  if (presenceLockRelease) return Promise.resolve(presenceLockRelease);
  if (presenceLockPromise) return presenceLockPromise;

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    presenceLockPromise = claimBroadcastPresenceOwnership(tabId).finally(() => {
      if (!presenceLockRelease) presenceLockPromise = null;
    });
    return presenceLockPromise;
  }

  presenceLockPromise = new Promise<() => void>((resolve, reject) => {
    let notifyAcquired: ((release: () => void) => void) | undefined;
    let acquired = false;
    const acquiredPromise = new Promise<() => void>((resolveAcquired) => {
      notifyAcquired = resolveAcquired;
    });
    let unlock = () => {};
    const hold = new Promise<void>((resolveHold) => {
      unlock = resolveHold;
    });
    void locks
      .request('presence-owner', { mode: 'exclusive' }, async () => {
        if (import.meta.env.DEV) console.debug('[sessionLock] presence owner acquired', { tabId });
        presenceOwnerId = tabId;
        announcePresenceTakeover(tabId);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          if (presenceOwnerId === tabId) presenceOwnerId = null;
          announcePresenceRelease(tabId);
          if (presenceLockRelease === release) presenceLockRelease = null;
          presenceLockPromise = null;
          unlock();
          if (import.meta.env.DEV)
            console.debug('[sessionLock] presence owner released', { tabId });
        };
        presenceLockRelease = release;
        acquired = true;
        notifyAcquired?.(release);
        await hold;
      })
      .catch((error: unknown) => {
        if (!acquired) reject(error);
      });
    void acquiredPromise.then(resolve, reject);
  }).finally(() => {
    if (!presenceLockRelease) presenceLockPromise = null;
  });
  return presenceLockPromise;
}

export function releasePresenceOwnership(): void {
  presenceLockRelease?.();
}

async function claimBroadcastGameplayOwnership(tabId: string): Promise<() => void> {
  const closeChannel = channel ? undefined : openSessionChannel();

  while (true) {
    gameplayCandidates.clear();
    gameplayCandidates.add(tabId);
    const ownerQueryAt = Date.now();
    announceGameplayQuery(tabId);
    await waitForPresenceChange(120);

    if (gameplayOwnerId && gameplayOwnerId !== tabId) {
      if (gameplayOwnerResponseAt >= ownerQueryAt) {
        await waitForPresenceChange();
        continue;
      }
      gameplayOwnerId = null;
    }

    const winner = [...gameplayCandidates].sort()[0];
    if (winner !== tabId) {
      await waitForPresenceChange();
      continue;
    }

    gameplayOwnerId = tabId;
    announceGameplayTakeover(tabId);
    await waitForPresenceChange(60);
    if (gameplayOwnerId !== tabId) continue;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (gameplayOwnerId === tabId) gameplayOwnerId = null;
      gameplayCandidates.delete(tabId);
      announceGameplayRelease(tabId);
      if (gameplayLockRelease === release) gameplayLockRelease = null;
      gameplayLockPromise = null;
      gameplayWaiters.forEach((notify) => notify());
      closeChannel?.();
    };
    gameplayLockRelease = release;
    if (import.meta.env.DEV) console.debug('[sessionLock] gameplay owner acquired', { tabId });
    return release;
  }
}

export function claimGameplayOwnership(tabId: string): Promise<() => void> {
  if (gameplayLockRelease) return Promise.resolve(gameplayLockRelease);
  if (gameplayLockPromise) return gameplayLockPromise;

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    gameplayLockPromise = claimBroadcastGameplayOwnership(tabId).finally(() => {
      if (!gameplayLockRelease) gameplayLockPromise = null;
    });
    return gameplayLockPromise;
  }

  gameplayLockPromise = new Promise<() => void>((resolve, reject) => {
    let notifyAcquired: ((release: () => void) => void) | undefined;
    let acquired = false;
    const acquiredPromise = new Promise<() => void>((resolveAcquired) => {
      notifyAcquired = resolveAcquired;
    });
    let unlock = () => {};
    const hold = new Promise<void>((resolveHold) => {
      unlock = resolveHold;
    });
    void locks
      .request('gameplay-owner', { mode: 'exclusive' }, async () => {
        gameplayOwnerId = tabId;
        announceGameplayTakeover(tabId);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          if (gameplayOwnerId === tabId) gameplayOwnerId = null;
          announceGameplayRelease(tabId);
          if (gameplayLockRelease === release) gameplayLockRelease = null;
          gameplayLockPromise = null;
          unlock();
          if (import.meta.env.DEV)
            console.debug('[sessionLock] gameplay owner released', { tabId });
        };
        gameplayLockRelease = release;
        acquired = true;
        notifyAcquired?.(release);
        if (import.meta.env.DEV) console.debug('[sessionLock] gameplay owner acquired', { tabId });
        await hold;
      })
      .catch((error: unknown) => {
        if (!acquired) reject(error);
      });
    void acquiredPromise.then(resolve, reject);
  }).finally(() => {
    if (!gameplayLockRelease) gameplayLockPromise = null;
  });
  return gameplayLockPromise;
}

export function releaseGameplayOwnership(): void {
  gameplayLockRelease?.();
}

export function createTabId(): string {
  tabSequence += 1;
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${tabSequence.toString(36)}-${randomId}`;
}

function waitForLockChange(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      lockWaiters.delete(finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    lockWaiters.add(finish);
  });
}

async function acquireBroadcastLock(): Promise<() => void> {
  const lockId = createTabId();
  let closeChannel: (() => void) | undefined;
  if (!channel) closeChannel = openSessionChannel();
  while (localLockHeld || fallbackOwner) {
    await waitForLockChange(100);
  }

  pendingLockRequests.add(lockId);
  postMessage({ type: 'session-lock-request', requestId: lockId });
  await waitForLockChange(75);
  if (fallbackOwner && fallbackOwner !== lockId) {
    pendingLockRequests.delete(lockId);
    return acquireBroadcastLock();
  }

  const winner = [...pendingLockRequests].sort()[0];
  if (winner !== lockId) {
    pendingLockRequests.delete(lockId);
    return acquireBroadcastLock();
  }

  localLockHeld = true;
  fallbackOwner = lockId;
  postMessage({ type: 'session-lock-acquired', requestId: lockId, ownerId: lockId });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    localLockHeld = false;
    fallbackOwner = null;
    pendingLockRequests.delete(lockId);
    postMessage({ type: 'session-lock-released', ownerId: lockId });
    lockWaiters.forEach((notify) => notify());
    closeChannel?.();
  };
}

export async function acquireSessionLock(): Promise<() => void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) {
    let releaseLock = () => {};
    let notifyAcquired = () => {};
    let rejectAcquisition: (error: unknown) => void = () => {};
    const acquired = new Promise<void>((resolve, reject) => {
      notifyAcquired = resolve;
      rejectAcquisition = reject;
    });
    let unlock = () => {};
    const hold = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    void locks
      .request(sessionLockName, { mode: 'exclusive' }, async () => {
        if (import.meta.env.DEV) console.debug('[sessionLock] session lock acquired');
        releaseLock = unlock;
        notifyAcquired();
        await hold;
      })
      .catch(rejectAcquisition);

    await acquired;
    return () => {
      if (import.meta.env.DEV) console.debug('[sessionLock] session lock released');
      releaseLock();
    };
  }
  return acquireBroadcastLock();
}

export function getLocalSessionLockUserCount(): number {
  return channelUsers;
}
