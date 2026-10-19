import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import RegisterPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  register: vi.fn(),
  goto: vi.fn(),
  page: { url: { searchParams: new URLSearchParams() } },
  pushToast: vi.fn()
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (value: typeof mocks.page) => void) => {
      fn(mocks.page);
      return () => {};
    }
  }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: mocks.play }
}));

vi.mock('$lib/api/auth', () => ({
  authApi: { register: mocks.register }
}));

vi.mock('$lib/stores/toasts', () => ({
  pushToast: mocks.pushToast
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

describe('Register page', () => {
  beforeEach(() => {
    session.clear();
    mocks.play.mockReset();
    mocks.register.mockReset();
    mocks.goto.mockReset();
    mocks.pushToast.mockReset();
    mocks.page.url.searchParams = new URLSearchParams();
  });

  it.each([
    ['redirect=%2Fhistory', '/history'],
    ['', '/lobby']
  ])('registers and navigates to %s', async (search, destination) => {
    const user = userEvent.setup();
    const userPayload = {
      id: '1',
      name: 'Ada',
      username: 'john-doe',
      usernameModifiedBySystem: false,
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    };
    mocks.page.url.searchParams = new URLSearchParams(search);
    mocks.register.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: userPayload,
      other_active_sessions: 0,
      username_was_auto_generated: false
    });
    render(RegisterPage);

    await user.type(screen.getByPlaceholderText('e.g., john-doe-99'), 'john-doe');
    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(destination));
    expect(mocks.register).toHaveBeenCalledWith({
      username: 'john-doe',
      email: 'ada@example.com',
      password: 'secret123'
    });
    let currentUser: typeof userPayload | null = null;
    const unsubscribe = session.subscribe((state) => {
      currentUser = state.user;
    });
    unsubscribe();
    expect(currentUser).toEqual(userPayload);
  });

  it('shows and validates the username input while typing', async () => {
    const user = userEvent.setup();
    render(RegisterPage);

    const username = screen.getByRole('textbox', { name: 'Choose a username' });
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(username).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.type(username, 'john doe');
    expect(
      screen.getByText(
        'Use only letters, numbers, hyphens, and underscores. Must start and end with a letter or number.'
      )
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(username);
    await user.type(username, 'john-doe');
    expect(
      screen.queryByText(
        'Use only letters, numbers, hyphens, and underscores. Must start and end with a letter or number.'
      )
    ).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it.each([
    ['jo', 'Username must be at least 3 characters.'],
    ['a'.repeat(31), 'Username must be at most 30 characters.']
  ])('shows the correct validation message for username %s', async (value, message) => {
    const user = userEvent.setup();
    render(RegisterPage);

    await user.type(screen.getByRole('textbox', { name: 'Choose a username' }), value);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  it('shows an info toast when the system auto-generated the username', async () => {
    const user = userEvent.setup();
    mocks.register.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: {
        id: '1',
        name: 'Ada',
        username: 'john-doe',
        usernameModifiedBySystem: true,
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      },
      other_active_sessions: 0,
      username_was_auto_generated: true
    });
    render(RegisterPage);

    await user.type(screen.getByPlaceholderText('e.g., john-doe-99'), 'john-doe');
    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(mocks.pushToast).toHaveBeenCalledWith(
        'info',
        'Your username was auto-generated. Please update it in your profile.'
      )
    );
  });

  it('plays a click and toggles password visibility', async () => {
    const user = userEvent.setup();
    render(RegisterPage);

    const password = screen.getByPlaceholderText('Password');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'SHOW' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(mocks.play).toHaveBeenCalledWith('click');

    mocks.play.mockClear();
    await user.click(screen.getByRole('button', { name: 'HIDE' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('plays a click and preserves the redirect in the back-to-login link', async () => {
    const user = userEvent.setup();
    mocks.page.url.searchParams = new URLSearchParams('redirect=%2Fhistory');
    render(RegisterPage);

    const loginLink = screen.getByRole('link', { name: 'Back to login' });
    expect(loginLink).toHaveAttribute('href', '/login?redirect=%2Fhistory');
    loginLink.addEventListener('click', (event) => event.preventDefault(), { once: true });

    await user.click(loginLink);

    expect(mocks.play).toHaveBeenCalledWith('click');
  });
});
