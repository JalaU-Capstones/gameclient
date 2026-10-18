import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderMenu from './HeaderMenu.svelte';

interface HeaderMenuProps {
  isAuthenticated: boolean;
  canGoBack: boolean;
  showGoToLobby: boolean;
  isLeavingGame: boolean;
  disabled: boolean;
  onBack: () => void;
  onLogout: () => void;
}

const afterNavigateMock = vi.hoisted(() => ({
  callback: undefined as
    ((navigation: { to: { url: { pathname: string } } } | null) => void) | undefined
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: (callback: (navigation: { to: { url: { pathname: string } } } | null) => void) => {
    afterNavigateMock.callback = callback;
  }
}));

vi.mock('$lib/components/ThemeToggle.svelte', () => ({
  default: () => null
}));

describe('HeaderMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterNavigateMock.callback = undefined;
  });

  function baseProps(overrides: Partial<HeaderMenuProps> = {}): HeaderMenuProps {
    return {
      isAuthenticated: true,
      canGoBack: true,
      showGoToLobby: false,
      isLeavingGame: false,
      disabled: false,
      onBack: vi.fn(),
      onLogout: vi.fn(),
      ...overrides
    };
  }

  it('renders the trigger in the closed state', () => {
    render(HeaderMenu, { props: baseProps() });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-controls', 'header-menu-panel');
  });

  it('opens the menu when clicked', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps() });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-label', 'Close menu');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps() });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click outside the trigger and panel', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps() });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders the Back item and calls onBack when clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(HeaderMenu, { props: baseProps({ onBack }) });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    const backItem = screen.getByRole('menuitem', { name: /Back/i });
    await user.click(backItem);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('hides the Back item when it is not applicable', () => {
    render(HeaderMenu, { props: baseProps({ isAuthenticated: false, canGoBack: false }) });

    expect(screen.queryByRole('menuitem', { name: /Back|Go to lobby/i })).not.toBeInTheDocument();
  });

  it('shows Leaving... and disables the Back action while leaving', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps({ isLeavingGame: true }) });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    const leavingItem = screen.getByRole('menuitem', { name: /Leaving/i });
    expect(leavingItem).toBeDisabled();
  });

  it('renders Logout and calls onLogout when clicked', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(HeaderMenu, { props: baseProps({ onLogout }) });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    const logoutItem = screen.getByRole('menuitem', { name: /Logout/i });
    await user.click(logoutItem);

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not render Logout when unauthenticated', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps({ isAuthenticated: false }) });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    expect(screen.queryByRole('menuitem', { name: /Logout/i })).not.toBeInTheDocument();
  });

  it('disables the trigger and prevents opening when disabled', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps({ disabled: true }) });

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toBeDisabled();

    await user.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu if disabled flips to true while open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(HeaderMenu, { props: baseProps({ disabled: false }) });

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await rerender({
      isAuthenticated: true,
      canGoBack: true,
      showGoToLobby: false,
      isLeavingGame: false,
      disabled: true,
      onBack: vi.fn(),
      onLogout: vi.fn()
    });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('renders the theme row', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps() });

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('closes when the afterNavigate callback fires', async () => {
    const user = userEvent.setup();
    render(HeaderMenu, { props: baseProps() });

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    afterNavigateMock.callback?.({ to: { url: { pathname: '/lobby' } } });

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
