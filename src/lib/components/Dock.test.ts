import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sounds } from '$lib/audio/sounds';
import Dock from './Dock.svelte';

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: vi.fn() }
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sounds.play).mockClear();
});

describe('Dock', () => {
  it('renders the four navigation items when visible is true', () => {
    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate: vi.fn() }
    });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Lobby' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
  });

  it('marks the active item with aria-current and data-active', () => {
    render(Dock, {
      props: { visible: true, currentPath: '/history', onNavigate: vi.fn() }
    });

    const history = screen.getByRole('button', { name: 'History' });
    expect(history).toHaveAttribute('aria-current', 'page');
    expect(history).toHaveAttribute('data-active', 'true');
  });

  it('does not mark any item as active when the current path is unmatched', () => {
    render(Dock, {
      props: { visible: true, currentPath: '/game/abc-123', onNavigate: vi.fn() }
    });

    expect(screen.queryByRole('button', { current: 'page' })).toBeNull();
  });

  it('calls onNavigate with the item path when an item is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate }
    });

    await user.click(screen.getByRole('button', { name: 'History' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/history');
  });

  it('plays the click sound when an enabled item is clicked', async () => {
    const user = userEvent.setup();

    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate: vi.fn() }
    });

    await user.click(screen.getByRole('button', { name: 'Profile' }));

    expect(sounds.play).toHaveBeenCalledTimes(1);
    expect(sounds.play).toHaveBeenCalledWith('click');
  });

  it('renders nothing when visible is false', () => {
    render(Dock, {
      props: { visible: false, currentPath: '/lobby', onNavigate: vi.fn() }
    });

    expect(screen.queryByTestId('dock')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lobby' })).toBeNull();
  });

  it('disables every item when disabled is true', () => {
    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate: vi.fn(), disabled: true }
    });

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('does not navigate or play a sound when disabled is true', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate, disabled: true }
    });

    await user.click(screen.getByRole('button', { name: 'Logs' }));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('exposes a navigation landmark with an accessible name', () => {
    render(Dock, {
      props: { visible: true, currentPath: '/lobby', onNavigate: vi.fn() }
    });

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
});
