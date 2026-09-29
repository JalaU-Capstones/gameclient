<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { sounds } from '$lib/audio/sounds';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';

  let { children } = $props();

  onMount(() => {
    const unlock = () => void sounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  });
</script>

<svelte:head>
  <title>GameClient</title>
</svelte:head>

<div class="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-200">
  <header class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
    <GameTitle text="TIC TAC TOE" />
    <ThemeToggle />
  </header>
  <main class="mx-auto max-w-6xl px-6 pb-10">
    {@render children()}
  </main>
</div>
