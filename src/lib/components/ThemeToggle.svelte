<script lang="ts">
  import { sounds } from '$lib/audio/sounds';
  import { theme } from '$lib/stores/theme';

  $: isDark = $theme === 'dark';
  $: label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  function toggleTheme() {
    sounds.play('click');
    theme.toggle();
  }
</script>

<button
  type="button"
  aria-label={label}
  class="rounded-full border border-[var(--neon-magenta)] px-4 py-2 text-xs uppercase tracking-widest text-[var(--neon-magenta)] transition hover:bg-[var(--neon-magenta)] hover:text-[var(--bg)] active:scale-95 md:text-sm"
  on:click={toggleTheme}
>
  {isDark ? 'Light' : 'Dark'}
</button>
