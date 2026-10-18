<script lang="ts">
  import type { HBarChartProps } from './types';

  export let items: HBarChartProps['items'] = [];
  export let ariaLabel: string = '';
  export let maxValue: number | undefined = undefined;
  export let valueFormatter: NonNullable<HBarChartProps['valueFormatter']> = (value: number) =>
    String(value);
  export let emptyMessage: string | undefined = undefined;

  let effectiveMax = 1;
  let hasData = false;

  $: effectiveMax = maxValue ?? Math.max(1, ...items.map((item) => item.value));
  $: hasData = items.some((item) => item.value > 0);

  function percent(value: number): number {
    if (effectiveMax <= 0) return 0;
    return Math.max(0, Math.min(100, (value / effectiveMax) * 100));
  }
</script>

{#if hasData}
  <ul class="space-y-2" role="img" aria-label={ariaLabel} data-testid="hbar-chart">
    {#each items as item (item.label)}
      <li class="flex items-center gap-3" data-testid="hbar-row">
        <span
          class="w-[35%] truncate text-xs uppercase tracking-widest text-[var(--text-muted)]"
          title={item.label}
          data-testid="hbar-label"
        >
          {item.label}
        </span>
        <div class="relative h-5 flex-1 rounded bg-[var(--text-muted)]/10">
          <div
            class="absolute inset-y-0 left-0 rounded"
            style={`width: ${percent(item.value)}%; background-color: ${item.color ?? 'var(--neon-cyan)'};`}
            data-testid="hbar-bar"
            data-bar-label={item.label}
          ></div>
        </div>
        <span
          class="w-14 text-right text-xs font-mono text-[var(--text-primary)]"
          data-testid="hbar-value"
        >
          {valueFormatter(item.value)}
        </span>
      </li>
    {/each}
  </ul>
{:else if emptyMessage}
  <div data-testid="hbar-empty-state">{emptyMessage}</div>
{/if}
