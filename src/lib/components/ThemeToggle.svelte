<script lang="ts">
  import { theme } from '$lib/stores/theme';

  $: isDark = $theme === 'dark';
  $: label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  function toggleTheme() {
    theme.toggle();
  }
</script>

<button
  type="button"
  aria-label={label}
  class="rounded-full border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--text-primary)] shadow-[var(--glow-cyan)] transition hover:scale-[1.02]"
  on:click={toggleTheme}
>
  {isDark ? 'Light' : 'Dark'}
</button>
