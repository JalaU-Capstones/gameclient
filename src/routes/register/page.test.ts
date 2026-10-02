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
  page: { url: { searchParams: new URLSearchParams() } }
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

vi.mock('$app/navigation', () => ({
  goto: mocks.goto
}));

describe('Register page', () => {
  beforeEach(() => {
    session.clear();
    mocks.play.mockReset();
    mocks.register.mockReset();
    mocks.goto.mockReset();
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
      email: 'ada@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    };
    mocks.page.url.searchParams = new URLSearchParams(search);
    mocks.register.mockResolvedValue({
      access_token: 'abc',
      token_type: 'bearer',
      user: userPayload
    });
    render(RegisterPage);

    await user.type(screen.getByPlaceholderText('Name'), 'Ada');
    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(destination));
    expect(mocks.register).toHaveBeenCalledWith({
      name: 'Ada',
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
