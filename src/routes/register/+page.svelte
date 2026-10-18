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

  let visible = $state(false);
  let inputName = $state('');
  let inputEmail = $state('');
  let inputPassword = $state('');
  let error = $state('');
  let submitting = $state(false);
  let loginHref = $derived.by((): '/login' | `/login?${string}` => {
    const redirect = $page.url.searchParams.get('redirect');
    return redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    sounds.play('click');
    error = '';
    submitting = true;

    try {
      const response = await authApi.register({
        name: inputName,
        email: inputEmail,
        password: inputPassword
      });
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
      <p class="text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl">Insert your name</p>
      <input
        bind:value={inputName}
        type="text"
        placeholder="Name"
        autocomplete="name"
        required
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-5 text-lg transition sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
      />
    </div>

    <div class="space-y-4">
      <p class="text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl">Insert your email</p>
      <input
        bind:value={inputEmail}
        type="email"
        placeholder="Email"
        autocomplete="email"
        required
        class="w-full rounded-xl border border-neon-cyan bg-cell px-4 py-5 text-lg transition sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
      />
    </div>

    <div class="space-y-4">
      <p class="text-left font-bold text-fg text-lg sm:text-2xl md:text-3xl">
        Insert your password
      </p>
      <div class="relative">
        <input
          bind:value={inputPassword}
          type={visible ? 'text' : 'password'}
          placeholder="Password"
          autocomplete="new-password"
          minlength="8"
          maxlength="128"
          required
          class="w-full rounded-xl border border-neon-cyan bg-cell pl-4 pr-20 py-5 text-lg transition sm:pr-24 sm:text-2xl focus:outline-none focus:shadow-glow-cyan"
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
      disabled={submitting}
      class="flex w-full items-center justify-center rounded-full border border-neon-magenta px-4 py-4 md:py-5 text-xl sm:text-2xl md:text-3xl uppercase tracking-widest text-center text-neon-magenta transition hover:bg-opacity-10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
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
