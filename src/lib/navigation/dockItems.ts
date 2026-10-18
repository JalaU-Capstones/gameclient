export type DockItemId = 'lobby' | 'history' | 'profile' | 'logs';

export interface DockItem {
  id: DockItemId;
  label: string;
  path: '/lobby' | '/history' | '/profile' | '/logs';
}

/**
 * Navigation items shown in the bottom dock.
 *
 * The active item is decided by exact match on `pathname`. Sub-routes are
 * not supported today: `/history`, `/profile`, and `/logs` are leaf pages.
 * If that changes, extend `Dock` with an explicit `activeMatch` function per
 * item instead of widening this type.
 */
export const dockItems: readonly DockItem[] = [
  { id: 'lobby', label: 'Lobby', path: '/lobby' },
  { id: 'history', label: 'History', path: '/history' },
  { id: 'profile', label: 'Profile', path: '/profile' },
  { id: 'logs', label: 'Logs', path: '/logs' }
] as const;
