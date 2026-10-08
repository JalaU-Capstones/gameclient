import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SessionReplacedBanner from './SessionReplacedBanner.svelte';

describe('SessionReplacedBanner', () => {
  it('renders the persistent standby message', () => {
    render(SessionReplacedBanner);

    expect(
      screen.getByText('Session active in another tab. Actions are disabled here.')
    ).toBeInTheDocument();
  });

  it('has a status role', () => {
    render(SessionReplacedBanner);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Session active in another tab. Actions are disabled here.'
    );
  });

  it('does not cover the viewport or obscure session updates', () => {
    render(SessionReplacedBanner);

    expect(screen.getByRole('status')).not.toHaveClass('fixed', 'inset-0');
  });
});
