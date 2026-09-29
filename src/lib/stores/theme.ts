import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'gameclient.theme';

function createThemeStore() {
  const getInitialTheme = (): Theme => {
    if (!browser) return 'dark';
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  };

  let currentTheme = getInitialTheme();
  const { subscribe, set } = writable<Theme>(currentTheme);

  function apply(theme: Theme) {
    if (!browser) return;
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function setTheme(theme: Theme) {
    currentTheme = theme;
    apply(theme);
    set(theme);
  }

  function toggle() {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  if (browser) {
    apply(currentTheme);
  }

  return { subscribe, set: setTheme, toggle };
}

export const theme = createThemeStore();
