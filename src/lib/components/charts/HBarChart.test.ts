import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ChartGate from './ChartGate.svelte';
import HBarChart from './HBarChart.svelte';

describe('HBarChart', () => {
  it('renders nothing when the items array is empty', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: HBarChart,
        componentProps: {
          items: [],
          ariaLabel: 'Top event types'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('hbar-chart')).not.toBeInTheDocument();
  });

  it('renders nothing when every value is zero', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: HBarChart,
        componentProps: {
          items: [
            { label: 'Info', value: 0 },
            { label: 'Warning', value: 0 }
          ],
          ariaLabel: 'Top event types'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('hbar-chart')).not.toBeInTheDocument();
  });

  it('renders rows, labels, values, and bar widths', () => {
    render(HBarChart, {
      props: {
        items: [
          { label: 'Info', value: 10 },
          { label: 'Warning', value: 5 }
        ],
        ariaLabel: 'Top event types'
      }
    });

    const rows = screen.getAllByTestId('hbar-row');
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId('hbar-label')[0]).toHaveTextContent('Info');
    expect(screen.getAllByTestId('hbar-value')[0]).toHaveTextContent('10');

    const bars = screen.getAllByTestId('hbar-bar');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '50%' });
    expect(bars[0]).toHaveAttribute('data-bar-label', 'Info');
  });

  it('uses maxValue when provided, respects custom colors, and formats values', () => {
    render(HBarChart, {
      props: {
        items: [
          { label: 'Info', value: 4, color: '#123456' },
          { label: 'Warning', value: 2 }
        ],
        ariaLabel: 'Top event types',
        maxValue: 8,
        valueFormatter: (value: number) => `${value}%`
      }
    });

    const bars = screen.getAllByTestId('hbar-bar');
    expect(bars[0]).toHaveStyle({ width: '50%' });
    expect(bars[0]).toHaveStyle({ backgroundColor: '#123456' });
    expect(screen.getAllByTestId('hbar-value')[0]).toHaveTextContent('4%');
    expect(screen.getAllByTestId('hbar-value')[1]).toHaveTextContent('2%');
  });

  it('falls back to the default cyan when no color is provided', () => {
    render(HBarChart, {
      props: {
        items: [{ label: 'Info', value: 3 }],
        ariaLabel: 'Top event types'
      }
    });

    expect(screen.getByTestId('hbar-bar')).toHaveStyle({ backgroundColor: 'var(--neon-cyan)' });
  });
});
