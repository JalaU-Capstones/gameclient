<script lang="ts">
  import type { BarChartProps } from './types';

  export let columns: BarChartProps['columns'] = [];
  export let colorMap: BarChartProps['colorMap'] = {};
  export let height: number = 200;
  export let ariaLabel: string = '';
  export let showXTicks: boolean = true;
  export let emptyMessage: string | undefined = undefined;

  let totals: number[] = [];
  let maxTotal = 1;
  let hasData = false;

  $: totals = columns.map((column) =>
    column.segments.reduce((sum, segment) => sum + segment.value, 0)
  );
  $: maxTotal = totals.length > 0 ? Math.max(...totals, 1) : 1;
  $: hasData = totals.some((value) => value > 0);

  const columnWidth = 100;
  const gap = 1;
</script>

{#if hasData}
  <div class="space-y-2">
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 100 {height}"
      preserveAspectRatio="none"
      width="100%"
      {height}
      data-testid="bar-chart"
    >
      {#each columns as column, columnIndex (columnIndex)}
        {@const x = columnIndex * (columnWidth / Math.max(columns.length, 1)) + gap / 2}
        {@const barWidth = columnWidth / Math.max(columns.length, 1) - gap}
        {@const total = totals[columnIndex]}
        {#if total > 0}
          {@const barHeight = (total / maxTotal) * (height - 10)}
          {@const baseY = height - 10}
          {@const segments = column.segments.filter((segment) => segment.value > 0)}
          {@const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0)}
          {#each segments as segment, segmentIndex (segment.key)}
            {@const segmentHeight = (segment.value / segmentTotal) * barHeight}
            {@const y =
              baseY -
              segmentHeight -
              segments
                .slice(0, segmentIndex)
                .reduce((sum, current) => sum + (current.value / segmentTotal) * barHeight, 0)}
            <rect
              {x}
              {y}
              width={barWidth}
              height={segmentHeight}
              fill={colorMap[segment.key] ?? 'var(--text-muted)'}
              data-testid="bar-segment"
              data-segment-key={segment.key}
              data-column-label={column.label}
            >
              <title>{column.label} · {segment.key}: {segment.value}</title>
            </rect>
          {/each}
        {/if}
      {/each}
    </svg>

    {#if showXTicks}
      <div
        class="grid text-[10px] uppercase tracking-widest text-[var(--text-muted)]"
        style={`grid-template-columns: repeat(${columns.length}, minmax(0, 1fr));`}
      >
        {#each columns as column, columnIndex (columnIndex)}
          <span class="text-center" data-testid="bar-chart-tick">{column.label}</span>
        {/each}
      </div>
    {/if}
  </div>
{:else if emptyMessage}
  <div data-testid="bar-empty-state">{emptyMessage}</div>
{/if}
