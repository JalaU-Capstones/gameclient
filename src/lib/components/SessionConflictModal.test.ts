import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SessionConflictModal from './SessionConflictModal.svelte';

describe('SessionConflictModal', () => {
  it('renders the title and both actions', () => {
    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss: vi.fn()
      }
    });

    expect(screen.getByRole('dialog', { name: 'Session already active' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this tab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('clicking Use this tab invokes onTakeover', async () => {
    const user = userEvent.setup();
    const onTakeover = vi.fn(async () => undefined);

    render(SessionConflictModal, {
      props: {
        onTakeover,
        onDismiss: vi.fn()
      }
    });

    await user.click(screen.getByRole('button', { name: 'Use this tab' }));

    expect(onTakeover).toHaveBeenCalledOnce();
  });

  it('clicking Dismiss invokes onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss
      }
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows loading state while takeover is in progress', async () => {
    const user = userEvent.setup();
    let resolveTakeover: (() => void) | undefined;
    const onTakeover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTakeover = resolve;
        })
    );

    render(SessionConflictModal, {
      props: {
        onTakeover,
        onDismiss: vi.fn()
      }
    });

    const button = screen.getByRole('button', { name: 'Use this tab' });
    await user.click(button);

    expect(screen.getByRole('button', { name: 'Using this tab…' })).toBeDisabled();
    resolveTakeover?.();
  });

  it('dismisses on Escape and wraps keyboard focus within the dialog', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss
      }
    });

    const takeoverButton = screen.getByRole('button', { name: 'Use this tab' });
    const dismissButton = screen.getByRole('button', { name: 'Dismiss' });

    expect(takeoverButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(dismissButton).toHaveFocus();
    await user.tab();
    expect(takeoverButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('uses the latest dismiss callback while takeover is pending', async () => {
    const user = userEvent.setup();
    let resolveTakeover!: () => void;
    const onDismiss = vi.fn();
    const view = render(SessionConflictModal, {
      props: {
        onTakeover: () =>
          new Promise<void>((resolve) => {
            resolveTakeover = resolve;
          }),
        onDismiss
      }
    });

    await user.click(screen.getByRole('button', { name: 'Use this tab' }));
    expect(screen.getByRole('button', { name: 'Using this tab…' })).toBeDisabled();

    const latestDismiss = vi.fn();
    await view.rerender({
      onTakeover: async () => undefined,
      onDismiss: latestDismiss
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(latestDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    resolveTakeover();
  });
});
