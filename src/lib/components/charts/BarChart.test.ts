import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import BarChart from './BarChart.svelte';
import ChartGate from './ChartGate.svelte';

describe('BarChart', () => {
  it('renders nothing when the chart is empty', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: BarChart,
        componentProps: {
          columns: [],
          colorMap: { info: '#111', warning: '#222' },
          ariaLabel: 'Activity over time'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders nothing when every column total is zero', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: BarChart,
        componentProps: {
          columns: [
            {
              label: 'Mon',
              segments: [
                { key: 'info', value: 0 },
                { key: 'warning', value: 0 }
              ]
            },
            { label: 'Tue', segments: [{ key: 'info', value: 0 }] }
          ],
          colorMap: { info: '#111', warning: '#222' },
          ariaLabel: 'Activity over time'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('renders one segment per positive value and includes native tooltips', () => {
    render(BarChart, {
      props: {
        columns: [
          {
            label: 'Mon',
            segments: [
              { key: 'info', value: 5 },
              { key: 'warning', value: 3 }
            ]
          },
          { label: 'Tue', segments: [{ key: 'warning', value: 2 }] }
        ],
        colorMap: { info: '#111', warning: '#222' },
        ariaLabel: 'Activity over time'
      }
    });

    const segments = screen.getAllByTestId('bar-segment');
    expect(segments).toHaveLength(3);
    expect(segments[0]).toHaveAttribute('fill', '#111');
    expect(segments[0]).toHaveAttribute('data-segment-key', 'info');
    expect(segments[0]).toHaveAttribute('data-column-label', 'Mon');
    expect(segments[0].querySelector('title')?.textContent).toBe('Mon · info: 5');
    expect(segments[1].querySelector('title')?.textContent).toBe('Mon · warning: 3');
    expect(segments[2].querySelector('title')?.textContent).toBe('Tue · warning: 2');
  });

  it('shows ticks when enabled and hides them when disabled', () => {
    const { rerender } = render(BarChart, {
      props: {
        columns: [
          { label: 'Mon', segments: [{ key: 'info', value: 1 }] },
          { label: 'Tue', segments: [{ key: 'info', value: 2 }] }
        ],
        colorMap: { info: '#111' },
        ariaLabel: 'Activity over time',
        showXTicks: true
      }
    });

    const ticks = screen.getAllByTestId('bar-chart-tick');
    expect(ticks.map((tick) => tick.textContent)).toEqual(['Mon', 'Tue']);

    rerender({
      columns: [
        { label: 'Mon', segments: [{ key: 'info', value: 1 }] },
        { label: 'Tue', segments: [{ key: 'info', value: 2 }] }
      ],
      colorMap: { info: '#111' },
      ariaLabel: 'Activity over time',
      showXTicks: false
    });

    expect(screen.queryByTestId('bar-chart-tick')).not.toBeInTheDocument();
  });

  it('handles repeated labels without collapsing the render output', () => {
    render(BarChart, {
      props: {
        columns: [
          { label: '1h', segments: [{ key: 'info', value: 1 }] },
          { label: '1h', segments: [{ key: 'info', value: 2 }] }
        ],
        colorMap: { info: '#111' },
        ariaLabel: 'Activity over time'
      }
    });

    expect(screen.getAllByTestId('bar-chart-tick')).toHaveLength(2);
    expect(screen.getAllByTestId('bar-segment')).toHaveLength(2);
  });
});
