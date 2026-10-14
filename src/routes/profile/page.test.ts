import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
import { session } from '$lib/stores/session';
import ProfilePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  update: vi.fn()
}));

vi.mock('$lib/api/user', () => ({
  usersApi: { update: mocks.update }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: mocks.play }
}));

const ada = {
  id: '1',
  name: 'Ada',
  email: 'ada@example.com',
  registerDate: '2026-01-15T10:00:00Z'
};

describe('Profile page', () => {
  beforeEach(() => {
    session.setUser(ada);
    mocks.play.mockReset();
    mocks.update.mockReset();
  });

  it('prefills name and email from the session and never shows a password', () => {
    render(ProfilePage);

    expect(screen.getByPlaceholderText('Name')).toHaveValue('Ada');
    expect(screen.getByPlaceholderText('Email')).toHaveValue('ada@example.com');
    expect(screen.getByPlaceholderText('Leave empty to keep current')).toHaveValue('');
  });

  it('fills the fields once the session hydrates after a reload', async () => {
    session.reset();
    render(ProfilePage);

    expect(screen.getByPlaceholderText('Name')).toHaveValue('');

    session.setUser(ada);

    await waitFor(() => expect(screen.getByPlaceholderText('Name')).toHaveValue('Ada'));
    expect(screen.getByPlaceholderText('Email')).toHaveValue('ada@example.com');
    expect(screen.getByRole('button', { name: 'Update account' })).toBeDisabled();
  });

  it('does not overwrite what the user is typing when the session emits again', async () => {
    const user = userEvent.setup();
    render(ProfilePage);

    await user.type(screen.getByPlaceholderText('Name'), 'x');
    session.setUser({ ...ada });

    expect(screen.getByPlaceholderText('Name')).toHaveValue('Adax');
  });

  it('shows the member-since date', () => {
    render(ProfilePage);

    const expected = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
      new Date(ada.registerDate)
    );
    expect(screen.getByText(/Member since/)).toHaveTextContent(`Member since ${expected}`);
  });

  it('disables Update until something changes', async () => {
    const user = userEvent.setup();
    render(ProfilePage);

    const update = screen.getByRole('button', { name: 'Update account' });
    expect(update).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Name'), 'x');
    expect(update).toBeEnabled();

    await user.type(screen.getByPlaceholderText('Name'), '{Backspace}');
    expect(update).toBeDisabled();
  });

  it('enables Update when only the password is filled', async () => {
    const user = userEvent.setup();
    render(ProfilePage);

    await user.type(screen.getByPlaceholderText('Leave empty to keep current'), 'newsecret1');

    expect(screen.getByRole('button', { name: 'Update account' })).toBeEnabled();
  });

  it('plays a click and toggles password visibility', async () => {
    const user = userEvent.setup();
    render(ProfilePage);

    const password = screen.getByPlaceholderText('Leave empty to keep current');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'SHOW' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(mocks.play).toHaveBeenCalledWith('click');

    await user.click(screen.getByRole('button', { name: 'HIDE' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('asks for confirmation before deleting and lets the user cancel', async () => {
    const user = userEvent.setup();
    render(ProfilePage);

    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
  });
  describe('updating the account', () => {
    it('sends only the changed fields, refreshes the session and clears the password', async () => {
      mocks.update.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.clear(screen.getByPlaceholderText('Name'));
      await user.type(screen.getByPlaceholderText('Name'), 'Ada Lovelace');
      await user.type(screen.getByPlaceholderText('Leave empty to keep current'), 'newsecret1');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith('1', {
          name: 'Ada Lovelace',
          password: 'newsecret1'
        })
      );
      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Leave empty to keep current')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Update account' })).toBeDisabled();

      let stored: { name: string; email: string } | null = null;
      session.subscribe((state) => (stored = state.user))();
      expect(stored).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    });

    it('normalizes the email to lowercase before sending it', async () => {
      mocks.update.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.clear(screen.getByPlaceholderText('Email'));
      await user.type(screen.getByPlaceholderText('Email'), 'New@Example.com');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith('1', { email: 'new@example.com' })
      );
    });

    it('disables the button while the request is in flight', async () => {
      let finish: () => void = () => {};
      mocks.update.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled();

      finish();
      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
    });

    it.each([
      [new ApiError('dup', 409), 'An account with this email already exists.'],
      [new ApiError('nope', 403), 'You can only edit your own account.'],
      [new NetworkError(), 'Cannot reach the server. Check your connection.'],
      [new TimeoutError(), 'The server took too long to respond. Try again.'],
      [new ApiError('boom', 500), 'Something went wrong. Please try again.']
    ])('shows a friendly message on failure (%#)', async (failure, message) => {
      mocks.update.mockRejectedValue(failure);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText('Account updated.')).not.toBeInTheDocument();

      let stored: { name: string } | null = null;
      session.subscribe((state) => (stored = state.user))();
      expect(stored).toMatchObject({ name: 'Ada' });
    });
  });
});
