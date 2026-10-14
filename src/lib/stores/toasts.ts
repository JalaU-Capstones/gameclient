import { writable } from 'svelte/store';
import { safeRandomUuid } from '$lib/utils/uuid';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

const MAX_VISIBLE_TOASTS = 3;
const duplicateWindowMs = 500;
const toastStore = writable<Toast[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const recentToastKeys = new Map<string, { id: string; seenAt: number }>();

function createToastId() {
  return safeRandomUuid();
}

export const toasts = toastStore;

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }

  toastStore.update((items) => items.filter((toast) => toast.id !== id));

  for (const [key, value] of recentToastKeys.entries()) {
    if (value.id === id) {
      recentToastKeys.delete(key);
      break;
    }
  }
}

export function pushToast(tone: ToastTone, message: string, ttlMs = 5000): string {
  const dedupeKey = `${tone}:${message}`;
  const now = Date.now();
  const previous = recentToastKeys.get(dedupeKey);

  if (previous && now - previous.seenAt < duplicateWindowMs) {
    const timer = timers.get(previous.id);
    if (timer) {
      clearTimeout(timer);
      timers.set(
        previous.id,
        setTimeout(() => dismissToast(previous.id), ttlMs)
      );
    }
    return previous.id;
  }

  const id = createToastId();
  const toast: Toast = { id, tone, message };
  recentToastKeys.set(dedupeKey, { id, seenAt: now });

  toastStore.update((items) => [...items, toast].slice(-MAX_VISIBLE_TOASTS));

  const timeout = setTimeout(() => dismissToast(id), ttlMs);
  timers.set(id, timeout);

  return id;
}
