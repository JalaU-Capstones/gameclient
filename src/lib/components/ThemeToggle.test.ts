import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '$lib/stores/theme';
import ThemeToggle from './ThemeToggle.svelte';

const mocks = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: mocks.play }
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  theme.set('dark');
  mocks.play.mockReset();
});

describe('ThemeToggle', () => {
  it('renders a button', () => {
    render(ThemeToggle);

    const button = screen.getByRole('button', { name: 'Switch to light mode' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass(
      'rounded-full border border-[var(--neon-magenta)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-magenta)] transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95 md:text-sm'
    );
  });

  it('toggles the theme when clicked', async () => {
    const user = userEvent.setup();
    render(ThemeToggle);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(mocks.play).toHaveBeenCalledWith('click');
  });
});
