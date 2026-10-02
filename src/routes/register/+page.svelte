<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { authApi } from '$lib/api/auth';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { resolveRedirect } from '$lib/auth/redirect';
  import { sounds } from '$lib/audio/sounds';
  import { session } from '$lib/stores/session';

  let inputName = $state('');
  let inputEmail = $state('');
  let inputPassword = $state('');
  let error = $state('');
  let submitting = $state(false);

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
        error = err instanceof Error ? err.message : 'Something went wrong.';
      }
    } finally {
      submitting = false;
    }
  }
</script>

<section
  class="space-y-10 py-8 px-6 text-center mx-auto max-w-lg min-h-[70vh] flex flex-col justify-center"
>
  <h2 class="text-4xl uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Register</h2>
  <form onsubmit={handleSubmit} class="space-y-6">
    <input
      bind:value={inputName}
      type="text"
      placeholder="Name"
      autocomplete="name"
      required
      class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-4 text-xl transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
    />
    <input
      bind:value={inputEmail}
      type="email"
      placeholder="Email"
      autocomplete="email"
      required
      class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-4 text-xl transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
    />
    <input
      bind:value={inputPassword}
      type="password"
      placeholder="Password"
      autocomplete="new-password"
      minlength="8"
      maxlength="128"
      required
      class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-4 text-xl transition focus:outline-none focus:shadow-[var(--glow-cyan)]"
    />
    {#if error}
      <p class="text-red-500">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={submitting}
      class="w-full rounded-full border border-[var(--neon-magenta)] px-4 py-4 uppercase tracking-widest text-[var(--neon-magenta)] text-2xl! md:py-5 md:text-4xl! transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? 'Creating account…' : 'Create account'}
    </button>
  </form>
</section>
