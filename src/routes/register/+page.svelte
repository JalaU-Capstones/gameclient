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
  class="space-y-14 py-8 px-6 text-center mx-auto max-w-lg min-h-[70vh] flex flex-col justify-center"
>
  <h2 class="text-4xl uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Register</h2>
  <form onsubmit={handleSubmit} class="space-y-10">
    <div class="space-y-4">
      <p class="font-bold text-[var(--text-primary)] text-xl md:text-3xl text-left">
        Insert your name
      </p>
      <input
        bind:value={inputName}
        type="text"
        placeholder="Name"
        autocomplete="name"
        required
        class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-5 text-2xl! transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
      />
    </div>

    <div class="space-y-4">
      <p class="font-bold text-[var(--text-primary)] text-xl md:text-3xl text-left">
        Insert your email
      </p>
      <input
        bind:value={inputEmail}
        type="email"
        placeholder="Email"
        autocomplete="email"
        required
        class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-5 text-2xl! transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
      />
    </div>

    <div class="space-y-4">
      <p class="font-bold text-[var(--text-primary)] text-xl md:text-3xl text-left">
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
          class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] pl-4 pr-24 py-5 text-2xl! transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
        />
        <button
          type="button"
          onclick={handleToggleVisibility}
          class="absolute right-4 top-1/2 -translate-y-1/2 cursor-pointer text-sm! uppercase tracking-widest text-[var(--neon-cyan)] transition hover:text-[var(--neon-magenta)]"
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
      class="w-full rounded-full border border-[var(--neon-magenta)] px-4 py-4 md:py-5 uppercase tracking-widest text-[var(--neon-magenta)] text-2xl! md:text-4xl! transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? 'Creating account…' : 'Create account'}
    </button>
    <a
      href={resolve(loginHref)}
      onclick={handleBackToLoginClick}
      class="block w-full rounded-full border border-[var(--neon-cyan)] px-4 py-4 md:py-5 text-center uppercase tracking-widest text-[var(--neon-cyan)] text-2xl! md:text-4xl! transition hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] active:scale-95"
    >
      Back to login
    </a>
  </form>
</section>
