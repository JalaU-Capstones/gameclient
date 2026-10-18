import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ChartGate from './ChartGate.svelte';
import PieChart from './PieChart.svelte';

describe('PieChart', () => {
  it('renders nothing when the slices array is empty', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: PieChart,
        componentProps: {
          slices: [],
          ariaLabel: 'Log levels'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('renders nothing when the total value is zero', () => {
    const { container } = render(ChartGate, {
      props: {
        show: false,
        component: PieChart,
        componentProps: {
          slices: [
            { label: 'Info', value: 0, color: '#111' },
            { label: 'Warn', value: 0, color: '#222' }
          ],
          ariaLabel: 'Log levels'
        }
      }
    });

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId('chart-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('renders one path per non-zero slice and sets each title', () => {
    render(PieChart, {
      props: {
        slices: [
          { label: 'Info', value: 5, color: '#111' },
          { label: 'Warning', value: 3, color: '#222' },
          { label: 'Error', value: 0, color: '#333' }
        ],
        ariaLabel: 'Log levels'
      }
    });

    const slices = screen.getAllByTestId('pie-slice');
    expect(slices).toHaveLength(2);
    expect(slices[0]).toHaveAttribute('fill', '#111');
    expect(slices[1]).toHaveAttribute('fill', '#222');
    expect(slices[0].querySelector('title')?.textContent).toBe('Info: 5');
    expect(slices[1].querySelector('title')?.textContent).toBe('Warning: 3');
  });

  it('renders the correct dimensions and supports a full-circle single slice', () => {
    render(PieChart, {
      props: {
        slices: [{ label: 'All', value: 10, color: '#444' }],
        size: 220,
        thickness: 0,
        ariaLabel: 'Full chart'
      }
    });

    const svg = screen.getByTestId('pie-chart');
    expect(svg).toHaveAttribute('width', '220');
    expect(svg).toHaveAttribute('height', '220');
    expect(screen.getAllByTestId('pie-slice')).toHaveLength(1);
  });
});
