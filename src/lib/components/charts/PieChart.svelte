<script lang="ts">
  import type { PieChartProps } from './types';

  export let slices: PieChartProps['slices'] = [];
  export let size: number = 200;
  export let thickness: number | undefined = undefined;
  export let ariaLabel: string = '';
  export let emptyMessage: string | undefined = undefined;

  let donutThickness = 0;
  let total = 0;
  let hasData = false;
  let cx = 0;
  let cy = 0;
  let outerRadius = 0;
  let innerRadius = 0;
  let arcs: Array<{ path: string; slice: (typeof slices)[number] }> = [];

  $: donutThickness = thickness ?? size * 0.35;
  $: total = slices.reduce((sum, slice) => sum + slice.value, 0);
  $: hasData = total > 0;
  $: cx = size / 2;
  $: cy = size / 2;
  $: outerRadius = size / 2 - 1;
  $: innerRadius = Math.max(0, outerRadius - donutThickness);
  $: {
    if (!hasData) {
      arcs = [];
    } else {
      const result: Array<{ path: string; slice: (typeof slices)[number] }> = [];
      let angle = -Math.PI / 2;

      for (const slice of slices) {
        if (slice.value <= 0) continue;
        const sweep = (slice.value / total) * Math.PI * 2;
        const startAngle = angle;
        const endAngle = angle + sweep;
        angle = endAngle;
        const path = describeArc(startAngle, endAngle);
        if (path) result.push({ path, slice });
      }

      arcs = result;
    }
  }

  function polar(radius: number, angle: number): [number, number] {
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  }

  function describeArc(startAngle: number, endAngle: number): string {
    if (endAngle - startAngle >= Math.PI * 2 - 1e-6) {
      const [x1, y1] = polar(outerRadius, 0);
      const [x2, y2] = polar(outerRadius, Math.PI);
      const [x3, y3] = polar(innerRadius, 0);
      const [x4, y4] = polar(innerRadius, Math.PI);
      return [
        `M ${x1} ${y1}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${x2} ${y2}`,
        `A ${outerRadius} ${outerRadius} 0 1 1 ${x1} ${y1}`,
        'Z',
        `M ${x3} ${y3}`,
        `A ${innerRadius} ${innerRadius} 0 1 1 ${x4} ${y4}`,
        `A ${innerRadius} ${innerRadius} 0 1 1 ${x3} ${y3}`,
        'Z'
      ].join(' ');
    }

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = polar(outerRadius, startAngle);
    const [x2, y2] = polar(outerRadius, endAngle);
    const [x3, y3] = polar(innerRadius, endAngle);
    const [x4, y4] = polar(innerRadius, startAngle);

    return [
      `M ${x1} ${y1}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}`,
      'Z'
    ].join(' ');
  }
</script>

<div class="flex h-40 sm:h-56 w-full flex-col">
  {#if hasData}
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 {size} {size}"
      width={size}
      height={size}
      data-testid="pie-chart"
    >
      {#each arcs as arc, index (index)}
        <path
          d={arc.path}
          fill={arc.slice.color}
          stroke="var(--bg)"
          stroke-width="1"
          data-testid="pie-slice"
          data-slice-label={arc.slice.label}
        >
          <title>{arc.slice.label}: {arc.slice.value}</title>
        </path>
      {/each}
    </svg>
  {:else if emptyMessage}
    <div data-testid="pie-empty-state">{emptyMessage}</div>
  {/if}
</div>
