import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$lib/stores/session', () => ({
  isHydrated: {
    subscribe: (fn: (value: boolean) => void) => {
      fn(false);
      return () => {};
    }
  }
}));

describe('Root page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading indicator while the session is still hydrating', () => {
    render(Page);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
