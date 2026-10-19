<script lang="ts">
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { usersApi } from '$lib/api/user';
  import { sounds } from '$lib/audio/sounds';
  import { renewSessionToken } from '$lib/auth/bootstrap';
  import { performLogout } from '$lib/auth/logout';
  import { userFacingMessage } from '$lib/errors/messages';
  import { currentUser, session } from '$lib/stores/session';
  import type { UpdateUserPayload } from '$lib/types/api';

  // Prefilled from the logged-in user (GET /api/v2/auth/me, already in the session store).
  // The password is never shown: the backend only stores a hash and never returns it.
  // Writable $derived: on a reload the session hydrates AFTER this page mounts, so the field
  // follows the session once it arrives, and still keeps what the user types until the
  // session value itself changes.
  let inputUsername = $derived($currentUser?.username ?? '');
  let usernameTouched = $state(false);
  let inputEmail = $derived($currentUser?.email ?? '');
  let inputPassword = $state(''); // optional: empty = keep current password
  let visible = $state(false);
  let error = $state('');
  let success = $state('');
  let submitting = $state(false);
  let confirmingDelete = $state(false);
  let deleteError = $state('');
  let deleting = $state(false);

  function validateUsername(username: string): string {
    if (!username || username.length < 3) return 'Username must be at least 3 characters.';
    if (username.length > 30) return 'Username must be at most 30 characters.';
    const regex = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{1,28}[a-zA-Z0-9])?$/;
    if (!regex.test(username)) {
      return 'Use only letters, numbers, hyphens, and underscores. Must start and end with a letter or number.';
    }
    return '';
  }

  let usernameError = $derived(validateUsername(inputUsername));

  const memberSince = $derived(
    $currentUser?.registerDate
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
          new Date($currentUser.registerDate)
        )
      : ''
  );

  // Only enable "Update" when something actually changed.
  const hasChanges = $derived(
    inputUsername.trim() !== ($currentUser?.username ?? '') ||
      inputEmail.trim().toLowerCase() !== ($currentUser?.email ?? '') ||
      inputPassword.length > 0
  );

  async function renewTokenAfterEdit() {
    try {
      await renewSessionToken();
    } catch (err) {
      if (import.meta.env.DEV) console.debug('[profile] token renewal failed', err);
    }
  }

  async function handleUpdate(event: SubmitEvent) {
    event.preventDefault();
    sounds.play('click');
    error = '';
    success = '';
    usernameTouched = true;

    const user = $currentUser;
    if (!user) return;
    if (usernameError) return;

    // Send only what actually changed (the backend ignores omitted fields).
    const payload: UpdateUserPayload = {};
    const username = inputUsername.trim();
    const email = inputEmail.trim().toLowerCase();
    if (username !== user.username) payload.username = username;
    if (email !== user.email) payload.email = email;
    if (inputPassword) payload.password = inputPassword;
    if (Object.keys(payload).length === 0) return;

    submitting = true;
    try {
      await usersApi.update(user.id, payload);
      session.setUser({
        ...user,
        username,
        usernameModifiedBySystem:
          payload.username !== undefined ? false : user.usernameModifiedBySystem,
        email
      });
      inputUsername = username;
      inputEmail = email;
      inputPassword = '';
      success = 'Account updated.';
      if (payload.username !== undefined || payload.email !== undefined) {
        await renewTokenAfterEdit();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        error = 'An account with this email already exists.';
      } else if (err instanceof ApiError && err.status === 403) {
        error = 'You can only edit your own account.';
      } else if (err instanceof NetworkError) {
        error = 'Cannot reach the server. Check your connection.';
      } else if (err instanceof TimeoutError) {
        error = 'The server took too long to respond. Try again.';
      } else {
        error = userFacingMessage(err instanceof ApiError ? err.code : undefined);
      }
    } finally {
      submitting = false;
    }
  }

  function handleToggleVisibility() {
    sounds.play('click');
    visible = !visible;
  }

  function handleAskDelete() {
    sounds.play('click');
    error = '';
    success = '';
    deleteError = '';
    confirmingDelete = true;
  }

  function handleCancelDelete() {
    sounds.play('click');
    confirmingDelete = false;
  }

  async function handleConfirmDelete() {
    sounds.play('click');
    const user = $currentUser;
    if (!user) return;

    deleteError = '';
    deleting = true;
    let deleted = false;
    try {
      await usersApi.delete(user.id);
      deleted = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The account is already gone: finish the logout instead of blocking the user.
        deleted = true;
      } else if (err instanceof ApiError && err.status === 403) {
        deleteError = 'You can only delete your own account.';
      } else if (err instanceof NetworkError) {
        deleteError = 'Cannot reach the server. Check your connection.';
      } else if (err instanceof TimeoutError) {
        deleteError = 'The server took too long to respond. Try again.';
      } else {
        deleteError = userFacingMessage(err instanceof ApiError ? err.code : undefined);
      }
    } finally {
      deleting = false;
    }

    if (deleted) {
      // Same cleanup as the Logout button: close sockets, clear the session, go to /login.
      await performLogout();
    } else {
      confirmingDelete = false;
    }
  }
</script>

<section
  class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center space-y-14 px-6 py-8 text-center"
>
  <div class="space-y-3">
    <h2 class="text-4xl uppercase tracking-[0.25em] text-neon-cyan">Profile</h2>
    {#if memberSince}
      <p class="text-sm uppercase tracking-widest text-fg-muted">
        Member since {memberSince}
      </p>
    {/if}
  </div>

  <form onsubmit={handleUpdate} class="max-w-md mx-auto w-full px-4 sm:px-0 space-y-10">
    {#if $currentUser?.usernameModifiedBySystem}
      <p
        class="mb-6 rounded-xl border border-yellow-500 bg-yellow-500/10 p-4 text-sm sm:text-base text-yellow-500 text-left"
      >
        Your username was automatically adjusted to meet our new rules. Please choose a new one
        below.
      </p>
    {/if}
    <div class="space-y-4">
      <label for="profile-username" class="font-bold text-fg text-xl md:text-3xl text-left">
        Your username
      </label>
      <input
        bind:value={inputUsername}
        oninput={() => (usernameTouched = true)}
        id="profile-username"
        type="text"
        placeholder="Username"
        autocomplete="username"
        required
        aria-invalid={usernameTouched && usernameError !== ''}
        aria-describedby={usernameTouched && usernameError ? 'profile-username-error' : undefined}
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-4 text-lg transition sm:py-5 sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
      />
      {#if usernameTouched && usernameError}
        <p id="profile-username-error" class="text-left text-red-500">{usernameError}</p>
      {/if}
    </div>

    <div class="space-y-4">
      <p class="font-bold text-fg text-xl md:text-3xl text-left">Your email</p>
      <input
        bind:value={inputEmail}
        type="email"
        placeholder="Email"
        autocomplete="email"
        required
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-5 text-2xl! transition focus:outline-none focus:shadow-glow-cyan"
      />
    </div>

    <div class="space-y-4">
      <p class="font-bold text-fg text-xl md:text-3xl text-left">New password</p>
      <div class="relative">
        <input
          bind:value={inputPassword}
          type={visible ? 'text' : 'password'}
          placeholder="Leave empty to keep current"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          class="w-full rounded-xl border border-neon-cyan bg-cell pl-4 pr-24 py-5 text-2xl! transition focus:outline-none focus:shadow-glow-cyan"
        />
        <button
          type="button"
          onclick={handleToggleVisibility}
          class="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-sm! uppercase tracking-widest text-neon-cyan transition hover:text-neon-magenta"
        >
          {visible ? 'HIDE' : 'SHOW'}
        </button>
      </div>
    </div>

    {#if error}
      <p class="text-red-500">{error}</p>
    {/if}
    {#if success}
      <p class="text-neon-cyan">{success}</p>
    {/if}

    <button
      type="submit"
      disabled={submitting || !hasChanges || usernameError !== ''}
      class="w-full rounded-full border border-neon-magenta px-4 py-4 uppercase tracking-widest text-neon-magenta text-lg transition hover:bg-neon-magenta hover:text-bg active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:text-xl md:py-5"
    >
      {submitting ? 'Updating…' : 'Update account'}
    </button>
  </form>

  <div class="space-y-6 border-t border-red-500/40 pt-10">
    {#if deleteError}
      <p class="text-red-500">{deleteError}</p>
    {/if}
    {#if !confirmingDelete}
      <button
        type="button"
        onclick={handleAskDelete}
        class="w-full rounded-full border border-red-500 px-4 py-4 uppercase tracking-widest text-red-500 text-lg transition hover:bg-red-500 hover:text-bg active:scale-95 sm:w-auto sm:text-xl md:py-5"
      >
        Delete account
      </button>
    {:else}
      <p class="text-red-500 text-xl md:text-2xl">
        This permanently deletes your account. This cannot be undone.
      </p>
      <div class="flex flex-col gap-4 md:flex-row">
        <button
          type="button"
          onclick={handleCancelDelete}
          class="w-full rounded-full border border-neon-cyan px-4 py-4 uppercase tracking-widest text-neon-cyan text-xl! transition hover:bg-neon-cyan hover:text-bg active:scale-95"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleConfirmDelete}
          disabled={deleting}
          class="w-full rounded-full border border-red-500 px-4 py-4 uppercase tracking-widest text-red-500 text-xl! transition hover:bg-red-500 hover:text-bg active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? 'Deleting…' : 'Yes, delete it'}
        </button>
      </div>
    {/if}
  </div>
</section>
