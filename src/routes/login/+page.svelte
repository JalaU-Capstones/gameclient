<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { authApi } from '$lib/api/auth';
  import { ApiError, NetworkError, TimeoutError } from '$lib/api/errors';
  import { clearBootstrapSessionCache } from '$lib/auth/bootstrap';
  import { resolveRedirect, type RedirectPath } from '$lib/auth/redirect';
  import { userFacingMessage } from '$lib/errors/messages';
  import { sounds } from '$lib/audio/sounds';
  import { session } from '$lib/stores/session';
  import { pushToast } from '$lib/stores/toasts';
  import { setLastPresenceToken } from '$lib/stores/ws';
  import TakeoverPromptModal from '$lib/components/TakeoverPromptModal.svelte';

  const registerHref = $derived.by((): RedirectPath => {
    const redirectParam = $page.url.searchParams.get('redirect');
    return redirectParam
      ? (`/register?redirect=${encodeURIComponent(redirectParam)}` as RedirectPath)
      : '/register';
  });

  let visible = $state(false);
  let inputEmail = $state('');
  let inputPassword = $state('');
  let error = $state('');
  let submitting = $state(false);
  let pendingTakeover = $state<{
    accessToken: string;
    user: {
      id: string;
      name: string;
      email: string;
      registerDate: string;
    };
    redirect: RedirectPath;
  } | null>(null);
  let isTakingOver = $state(false);
  let takeoverError = $state('');
  let takeoverRetryAfter = $state<number | undefined>(undefined);
  let isCancelling = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    sounds.play('click');
    error = '';
    submitting = true;

    try {
      const response = await authApi.login({
        email: inputEmail,
        password: inputPassword
      });

      if (response.other_active_sessions > 0) {
        const redirectParam = $page.url.searchParams.get('redirect');
        const destination = resolveRedirect(redirectParam);
        pendingTakeover = {
          accessToken: response.access_token,
          user: response.user,
          redirect: resolve(destination) as RedirectPath
        };
        return;
      }

      session.setUser(response.user);
      setLastPresenceToken(response.access_token);
      const redirectParam = $page.url.searchParams.get('redirect');
      const destination = resolveRedirect(redirectParam);
      await goto(resolve(destination));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        error = 'Invalid email or password.';
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

  async function handleTakeoverConfirm(): Promise<void> {
    if (!pendingTakeover || isTakingOver) return;

    isTakingOver = true;
    takeoverError = '';
    takeoverRetryAfter = undefined;

    try {
      await authApi.takeoverSession();
      session.setUser(pendingTakeover.user);
      setLastPresenceToken(pendingTakeover.accessToken);
      const target = pendingTakeover.redirect;
      pendingTakeover = null;
      await goto(resolve(target));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const retryAfterHeader = err.headers?.get('Retry-After');
          const parsed = Number(retryAfterHeader);
          takeoverRetryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
          takeoverError =
            'Demasiados intentos de takeover. Espera unos segundos antes de reintentar.';
          return;
        }

        if (
          err.code === 'GAME_IN_PROGRESS' ||
          (err.status === 409 && err.message.includes('game'))
        ) {
          takeoverError =
            'Hay una partida activa en la otra sesión. Espera a que termine y vuelve a intentar.';
          return;
        }

        if (err.code === 'SESSION_REQUIRED') {
          takeoverError =
            'La sesión actual no es válida para el takeover. Vuelve a iniciar sesión.';
          return;
        }

        takeoverError = userFacingMessage(err.code, 'No se pudo completar el takeover.');
        return;
      }

      takeoverError = 'No se pudo completar el takeover. Revisa tu conexión.';
    } finally {
      isTakingOver = false;
    }
  }

  async function handleTakeoverCancel(): Promise<void> {
    if (!pendingTakeover || isCancelling) return;

    isCancelling = true;
    try {
      await authApi.logout().catch(() => undefined);
    } finally {
      clearBootstrapSessionCache();
      pendingTakeover = null;
      isCancelling = false;
      pushToast('info', 'Inicio de sesión cancelado. La otra sesión sigue activa.');
    }
  }

  function handleToggleVisibility() {
    sounds.play('click');
    visible = !visible;
  }

  function handleRegisterClick() {
    sounds.play('click');
  }
</script>

<section
  class="space-y-14 py-8 px-6 text-center mx-auto max-w-lg min-h-[70vh] flex flex-col justify-center"
>
  <h2 class="text-4xl uppercase tracking-[0.25em] text-[var(--neon-cyan)]">Login</h2>

  {#if !pendingTakeover}
    <form onsubmit={handleSubmit} class="space-y-10">
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
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <a
        href={resolve(registerHref)}
        onclick={handleRegisterClick}
        class="block w-full rounded-full border border-[var(--neon-cyan)] px-4 py-4 md:py-5 text-center uppercase tracking-widest text-[var(--neon-cyan)] text-2xl! md:text-4xl! transition hover:bg-[var(--neon-cyan)] hover:text-[var(--bg)] active:scale-95"
      >
        Register
      </a>
    </form>
  {/if}

  <TakeoverPromptModal
    show={pendingTakeover !== null}
    isSubmitting={isTakingOver || isCancelling}
    errorMessage={takeoverError}
    retryAfterSeconds={takeoverRetryAfter}
    onConfirm={handleTakeoverConfirm}
    onCancel={handleTakeoverCancel}
  />
</section>
