import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BarChart from './BarChart.svelte';
import ChartGate from './ChartGate.svelte';

describe('ChartGate', () => {
  it('renders nothing when show is false', () => {
    render(ChartGate, {
      props: {
        show: false,
        component: null,
        componentProps: {}
      }
    });

    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.getByTestId('chart-shell').querySelector('svg')).toBeNull();
  });

  it('renders the chart component when show is true and a component is supplied', () => {
    render(ChartGate, {
      props: {
        show: true,
        component: BarChart,
        componentProps: {
          columns: [{ label: 'A', segments: [{ key: 'wins', value: 3 }] }],
          colorMap: { wins: '#00f0ff' },
          ariaLabel: 'chart'
        }
      }
    });

    expect(screen.getByTestId('chart-shell').querySelector('svg')).not.toBeNull();
  });

  it('does not render when a component is missing even if show is true', () => {
    render(ChartGate, {
      props: {
        show: true,
        component: null,
        componentProps: {}
      }
    });

    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.getByTestId('chart-shell').querySelector('svg')).toBeNull();
  });
});
