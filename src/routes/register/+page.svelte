<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { authApi } from '$lib/api/auth';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { resolveRedirect } from '$lib/auth/redirect';
  import { userFacingMessage } from '$lib/errors/messages';
  import { sounds } from '$lib/audio/sounds';
  import { session } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toasts';

  let visible = $state(false);
  let inputUsername = $state('');
  let usernameError = $state('');
  let usernameTouched = $state(false);
  let inputEmail = $state('');
  let inputPassword = $state('');
  let error = $state('');
  let submitting = $state(false);
  let loginHref = $derived.by((): '/login' | `/login?${string}` => {
    const redirect = $page.url.searchParams.get('redirect');
    return redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
  });

  function validateUsername(username: string): string {
    if (!username || username.length < 3) return 'Username must be at least 3 characters.';
    if (username.length > 30) return 'Username must be at most 30 characters.';
    const regex = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{1,28}[a-zA-Z0-9])?$/;
    if (!regex.test(username)) {
      return 'Use only letters, numbers, hyphens, and underscores. Must start and end with a letter or number.';
    }
    return '';
  }

  function handleUsernameInput(event: Event) {
    inputUsername = (event.currentTarget as HTMLInputElement).value;
    usernameTouched = true;
    usernameError = validateUsername(inputUsername);
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    sounds.play('click');
    error = '';
    usernameTouched = true;
    usernameError = validateUsername(inputUsername);
    if (usernameError) return;
    submitting = true;

    try {
      const response = await authApi.register({
        username: inputUsername,
        email: inputEmail,
        password: inputPassword
      });
      if (response.username_was_auto_generated) {
        pushToast('info', 'Your username was auto-generated. Please update it in your profile.');
      }
      session.setUser(response.user);
      const redirectParam = $page.url.searchParams.get('redirect');
      const destination = resolveRedirect(redirectParam);
      await goto(resolve(destination));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        error = 'An account with this email already exists.';
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

  function handleBackToLoginClick() {
    sounds.play('click');
  }
</script>

<section
  class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center space-y-14 px-4 py-8 text-center sm:px-6"
>
  <h2 class="text-3xl uppercase tracking-[0.25em] text-neon-cyan sm:text-4xl md:text-5xl">
    Register
  </h2>
  <form onsubmit={handleSubmit} class="space-y-10">
    <div class="space-y-4">
      <label
        for="register-username"
        class="block text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl"
      >
        Choose a username
      </label>
      <input
        id="register-username"
        value={inputUsername}
        oninput={handleUsernameInput}
        onblur={() => {
          if (inputUsername) {
            usernameTouched = true;
            usernameError = validateUsername(inputUsername);
          }
        }}
        type="text"
        placeholder="e.g., john-doe-99"
        autocomplete="username"
        required
        aria-invalid={usernameTouched && usernameError !== ''}
        aria-describedby={usernameTouched && usernameError ? 'register-username-error' : undefined}
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-4 text-lg transition sm:py-5 sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
      />
      {#if usernameTouched && usernameError}
        <p id="register-username-error" class="text-left text-red-500">{usernameError}</p>
      {/if}
    </div>

    <div class="space-y-4">
      <label
        for="register-email"
        class="block text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl"
      >
        Insert your email
      </label>
      <input
        bind:value={inputEmail}
        id="register-email"
        type="email"
        placeholder="Email"
        autocomplete="email"
        required
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-4 text-lg transition sm:py-5 sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
      />
    </div>

    <div class="space-y-4">
      <label
        for="register-password"
        class="block text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl"
      >
        Insert your password
      </label>
      <div class="relative">
        <input
          bind:value={inputPassword}
          id="register-password"
          type={visible ? 'text' : 'password'}
          placeholder="Password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
          class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-4 pr-20 text-lg transition sm:py-5 sm:pr-24 sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
        />
        <button
          type="button"
          onclick={handleToggleVisibility}
          class="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-sm uppercase tracking-widest text-neon-cyan transition hover:text-neon-magenta"
        >
          {visible ? 'HIDE' : 'SHOW'}
        </button>
      </div>
    </div>
    {#if error}
      <p class="text-red-500">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={submitting || validateUsername(inputUsername) !== ''}
      class="w-full rounded-full border border-neon-magenta px-4 py-4 md:py-5 text-xl sm:text-2xl md:text-3xl uppercase tracking-widest text-center text-neon-magenta transition hover:bg-opacity-10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? 'Creating account…' : 'Create account'}
    </button>
    <a
      href={resolve(loginHref)}
      onclick={handleBackToLoginClick}
      class="flex w-full items-center justify-center rounded-full border border-neon-cyan px-4 py-4 md:py-5 text-xl sm:text-2xl md:text-3xl uppercase tracking-widest text-center text-neon-cyan transition hover:bg-opacity-10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      Back to login
    </a>
  </form>
</section>
