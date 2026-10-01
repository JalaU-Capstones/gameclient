<script lang="ts">
  import { resolve } from '$app/paths';
  import { authApi } from '$lib/api/auth';
  import { session } from '$lib/stores/session';
  import { goto } from '$app/navigation';
  let visible = $state(false);
  let inputEmail = $state('');
  let inputPassword = $state('');
  let error = $state('');

  async function iniciarSesion(event: SubmitEvent) {
    event.preventDefault();
    error = '';

    try {
      await authApi.login({ email: inputEmail, password: inputPassword });
      const user = await authApi.me();
      session.setUser(user);
      await goto(resolve('/lobby'));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Algo salió mal';
    }
  }
</script>

<section
  class="space-y-14 py-8 px-6 text-center mx-auto max-w-lg min-h-[70vh] flex flex-col justify-center"
>
  <h2 class="text-4xl uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Login</h2>
  <form onsubmit={iniciarSesion} class="space-y-10">
    <div class="space-y-4">
      <p class="font-bold text-[var(--text-primary)] text-xl md:text-3xl text-left">
        Insert your email
      </p>
      <input
        bind:value={inputEmail}
        type="email"
        placeholder="Email"
        class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] px-4 py-5 text-2xl!
        transition
        focus:outline-none focus:shadow-[var(--glow-cyan)]"
      />
    </div>

    <div class="space-y-4">
      <p class="font-bold text-[var(--text-primary)] text-3xl text-left">Insert your password</p>
      <div class="relative">
        <input
          bind:value={inputPassword}
          type={visible ? 'text' : 'password'}
          placeholder="Password"
          class="w-full rounded-xl border border-[var(--neon-cyan)] bg-[var(--cell)] pl-4 pr-24 py-5 text-2xl!
        transition
        focus:outline-none focus:shadow-[var(--glow-cyan)]"
        />
        <button
          type="button"
          onclick={() => (visible = !visible)}
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
      class="w-full rounded-full border border-[var(--neon-magenta)] px-4 py-4 md:py-5 uppercase tracking-widest text-[var(--neon-magenta)] text-2xl! md:text-4xl! transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95"
    >
      Login
    </button>
  </form>
</section>
