<script lang="ts">
  import type { StatCardProps } from './types';

  export let label: StatCardProps['label'] = '';
  export let value: StatCardProps['value'] = '';
  export let accent: NonNullable<StatCardProps['accent']> = 'neutral';
  export let testId: string | undefined = undefined;

  const accentClass: Record<NonNullable<StatCardProps['accent']>, string> = {
    cyan: 'text-[var(--neon-cyan)]',
    magenta: 'text-[var(--neon-magenta)]',
    amber: 'text-amber-500',
    green: 'text-green-400',
    neutral: 'text-[var(--text-primary)]'
  };
</script>

<div
  class="rounded-xl border border-[var(--neon-cyan)]/40 bg-[var(--bg)] p-4"
  data-testid={testId ?? 'stat-card'}
>
  <p class="text-xs uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
  <p class="mt-2 text-2xl font-bold {accentClass[accent]}">{value}</p>
</div>
