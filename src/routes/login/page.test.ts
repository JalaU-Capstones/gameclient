import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '$lib/api/errors';
import { session } from '$lib/stores/session';
import LoginPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  login: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  goto: vi.fn(),
  resolve: (path: string) => path
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: {
    play: mocks.play,
    unlock: vi.fn(),
    setMuted: vi.fn(),
    isMuted: () => false,
    isUnlocked: () => true
  }
}));

vi.mock('$lib/api/auth', () => ({
  authApi: {
    login: mocks.login,
    me: mocks.me,
    logout: mocks.logout
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

vi.mock('$app/paths', () => ({
  resolve: mocks.resolve
}));

describe('Login page', () => {
  beforeEach(() => {
    session.clear();
    mocks.play.mockReset();
    mocks.login.mockReset();
    mocks.me.mockReset();
    mocks.goto.mockReset();
    mocks.resolve = (path: string) => path;
  });

  it('plays a click when the show/hide toggle is clicked', async () => {
    const user = userEvent.setup();
    render(LoginPage);

    await user.click(screen.getByRole('button', { name: 'SHOW' }));

    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('plays a click when the register link is clicked', async () => {
    const user = userEvent.setup();
    render(LoginPage);

    await user.click(screen.getByRole('link', { name: 'Register' }));

    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('plays a click when the form is submitted', async () => {
    const user = userEvent.setup();
    mocks.login.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: {
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      }
    });
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mocks.play).toHaveBeenCalledWith('click'));
  });

  it('submits the entered credentials to authApi.login', async () => {
    const user = userEvent.setup();
    mocks.login.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: {
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      }
    });
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(mocks.login).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'secret'
      })
    );
  });

  it('sets the current user and navigates to the lobby after a successful login', async () => {
    const user = userEvent.setup();
    const userPayload = {
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    };
    mocks.login.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: userPayload
    });
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/lobby'));
    let currentUser: typeof userPayload | null = null;
    const unsubscribe = session.subscribe((state) => {
      currentUser = state.user;
    });
    unsubscribe();
    expect(currentUser).toEqual(userPayload);
  });

  it('shows the invalid credentials message when the API responds with 401', async () => {
    const user = userEvent.setup();
    mocks.login.mockRejectedValue(new ApiError('Invalid credentials', 401));
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Invalid email or password.');
  });

  it('shows the network error message when the server is unreachable', async () => {
    const user = userEvent.setup();
    mocks.login.mockRejectedValue(new NetworkError());
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Cannot reach the server. Check your connection.');
  });

  it('disables the submit button while the login request is in flight', async () => {
    const user = userEvent.setup();
    let resolveLogin!: (value: unknown) => void;
    mocks.login.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        })
    );
    render(LoginPage);

    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    resolveLogin?.({
      access_token: 'abc',
      token_type: 'bearer',
      user: {
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
        registerDate: '2026-01-01T00:00:00Z'
      }
    });
  });
});
