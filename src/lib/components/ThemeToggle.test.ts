import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { theme } from '$lib/stores/theme';
import ThemeToggle from './ThemeToggle.svelte';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  theme.set('dark');
});

describe('ThemeToggle', () => {
  it('renders a button', () => {
    render(ThemeToggle);

    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('toggles the theme when clicked', async () => {
    const user = userEvent.setup();
    render(ThemeToggle);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
