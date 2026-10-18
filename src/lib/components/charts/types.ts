export interface StatCardProps {
  label: string;
  value: string | number;
  accent?: 'cyan' | 'magenta' | 'amber' | 'green' | 'neutral';
  testId?: string;
}

export interface BarSegment {
  key: string;
  value: number;
}

export interface BarColumn {
  label: string;
  segments: BarSegment[];
}

/**
 * Empty data renders no SVG; the caller decides whether to show a placeholder outside the chart.
 */
export interface BarChartProps {
  columns: BarColumn[];
  colorMap: Record<string, string>;
  height?: number;
  ariaLabel: string;
  showXTicks?: boolean;
  emptyMessage?: string;
}

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

export interface PieChartProps {
  slices: PieSlice[];
  size?: number;
  thickness?: number;
  ariaLabel: string;
  emptyMessage?: string;
}

export interface HBarItem {
  label: string;
  value: number;
  color?: string;
}

/**
 * Empty data renders no DOM; the caller decides whether to show a placeholder outside the chart.
 */
export interface HBarChartProps {
  items: HBarItem[];
  ariaLabel: string;
  maxValue?: number;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}
