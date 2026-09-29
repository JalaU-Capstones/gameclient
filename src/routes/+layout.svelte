<script lang="ts">
  import '../app.css';
  import GameTitle from '$lib/components/GameTitle.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';

  let { children } = $props();
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
