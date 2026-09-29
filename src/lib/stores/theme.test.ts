import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  vi.resetModules();
});

describe('theme store', () => {
  it('defaults to dark when localStorage is empty', async () => {
    const { theme } = await import('./theme');

    expect(get(theme)).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('sets the theme and updates the html class', async () => {
    const { theme } = await import('./theme');

    theme.set('light');

    expect(get(theme)).toBe('light');
    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('toggles from dark to light and back', async () => {
    const { theme } = await import('./theme');

    theme.toggle();
    expect(get(theme)).toBe('light');

    theme.toggle();
    expect(get(theme)).toBe('dark');
  });

  it('persists the selected theme in localStorage', async () => {
    const { theme } = await import('./theme');

    theme.set('light');

    expect(localStorage.getItem('gameclient.theme')).toBe('light');
  });
});
