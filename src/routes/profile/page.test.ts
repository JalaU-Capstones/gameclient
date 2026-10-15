import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
import { session } from '$lib/stores/session';
import ProfilePage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  logout: vi.fn(),
  renew: vi.fn()
}));

vi.mock('$lib/api/user', () => ({
  usersApi: { update: mocks.update, delete: mocks.remove }
}));

vi.mock('$lib/auth/logout', () => ({
  performLogout: mocks.logout
}));

vi.mock('$lib/auth/bootstrap', () => ({
  renewSessionToken: mocks.renew
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
    mocks.remove.mockReset();
    mocks.logout.mockReset();
    mocks.logout.mockResolvedValue(undefined);
    mocks.renew.mockReset();
    mocks.renew.mockResolvedValue('new-token');
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
    it('renews the session token after the name changes', async () => {
      mocks.update.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
      await waitFor(() => expect(mocks.renew).toHaveBeenCalledTimes(1));
    });

    it('renews the session token after the email changes', async () => {
      mocks.update.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.clear(screen.getByPlaceholderText('Email'));
      await user.type(screen.getByPlaceholderText('Email'), 'new@example.com');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
      await waitFor(() => expect(mocks.renew).toHaveBeenCalledTimes(1));
    });

    it('does not renew the token when only the password changes', async () => {
      mocks.update.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Leave empty to keep current'), 'newsecret1');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
      expect(mocks.renew).not.toHaveBeenCalled();
    });

    it('does not renew the token when the update fails', async () => {
      mocks.update.mockRejectedValue(new ApiError('dup', 409));
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(
        await screen.findByText('An account with this email already exists.')
      ).toBeInTheDocument();
      expect(mocks.renew).not.toHaveBeenCalled();
    });

    it('still shows "Account updated." when the token renewal fails', async () => {
      mocks.update.mockResolvedValue(undefined);
      mocks.renew.mockRejectedValue(new ApiError('Unauthorized', 401));
      const user = userEvent.setup();
      render(ProfilePage);

      await user.type(screen.getByPlaceholderText('Name'), 'x');
      await user.click(screen.getByRole('button', { name: 'Update account' }));

      expect(await screen.findByText('Account updated.')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Updating…' })).not.toBeInTheDocument()
      );
      expect(screen.queryByText(/went wrong|reach the server/)).not.toBeInTheDocument();
    });
  });
  describe('deleting the account', () => {
    async function openConfirmation() {
      const user = userEvent.setup();
      render(ProfilePage);
      await user.click(screen.getByRole('button', { name: 'Delete account' }));
      return user;
    }

    it('deletes the account and then logs the user out', async () => {
      mocks.remove.mockResolvedValue(undefined);
      const user = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

      await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
      expect(mocks.remove).toHaveBeenCalledWith('1');
      expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.logout.mock.invocationCallOrder[0]
      );
    });

    it('does not call the backend when the user cancels', async () => {
      const user = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.logout).not.toHaveBeenCalled();
    });

    it('disables the button while the request is in flight', async () => {
      let finish: () => void = () => {};
      mocks.remove.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
      const user = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

      expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();

      finish();
      await waitFor(() => expect(mocks.logout).toHaveBeenCalled());
    });

    it('still finishes the logout when the account no longer exists (404)', async () => {
      mocks.remove.mockRejectedValue(new ApiError('gone', 404));
      const user = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

      await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    });

    it.each([
      [new ApiError('nope', 403), 'You can only delete your own account.'],
      [new NetworkError(), 'Cannot reach the server. Check your connection.'],
      [new TimeoutError(), 'The server took too long to respond. Try again.'],
      [new ApiError('boom', 500), 'Something went wrong. Please try again.']
    ])('shows a message and keeps the session on failure (%#)', async (failure, message) => {
      mocks.remove.mockRejectedValue(failure);
      const user = await openConfirmation();

      await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mocks.logout).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    });
  });
});
