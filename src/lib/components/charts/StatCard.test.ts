import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StatCard from './StatCard.svelte';

describe('StatCard', () => {
  it('renders the label and value', () => {
    render(StatCard, { props: { label: 'Total', value: '42' } });

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('uses the neutral accent by default', () => {
    render(StatCard, { props: { label: 'Warnings', value: 3 } });

    expect(screen.getByText('3')).toHaveClass('text-[var(--text-primary)]');
  });

  it('applies the cyan accent class when set', () => {
    render(StatCard, { props: { label: 'Errors', value: 2, accent: 'cyan' } });

    expect(screen.getByText('2')).toHaveClass('text-[var(--neon-cyan)]');
  });

  it('uses a custom test id when provided and accepts numeric values', () => {
    render(StatCard, { props: { label: 'Unique players', value: 12, testId: 'custom-id' } });

    expect(screen.getByTestId('custom-id')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('uses the default test id when no custom id is provided', () => {
    render(StatCard, { props: { label: 'Unique games', value: 9 } });

    expect(screen.getByTestId('stat-card')).toBeInTheDocument();
  });
});
