import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SessionReplacedBanner from './SessionReplacedBanner.svelte';

describe('SessionReplacedBanner', () => {
  it('renders the replacement message', () => {
    render(SessionReplacedBanner);

    expect(
      screen.getByText('Session moved to another tab. Close this tab or refresh to sign in again.')
    ).toBeInTheDocument();
  });

  it('has an alert role', () => {
    render(SessionReplacedBanner);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Session moved to another tab. Close this tab or refresh to sign in again.'
    );
  });
});
