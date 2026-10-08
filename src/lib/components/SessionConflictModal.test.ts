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
        onDismiss: vi.fn(),
        isTakingOver: false,
        takeoverError: ''
      }
    });

    expect(screen.getByRole('dialog', { name: 'Session already active' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stay in original tab' })).toBeInTheDocument();
  });

  it('clicking Continue here invokes onTakeover', async () => {
    const user = userEvent.setup();
    const onTakeover = vi.fn(async () => undefined);

    render(SessionConflictModal, {
      props: {
        onTakeover,
        onDismiss: vi.fn(),
        isTakingOver: false,
        takeoverError: ''
      }
    });

    await user.click(screen.getByRole('button', { name: 'Continue here' }));

    expect(onTakeover).toHaveBeenCalledOnce();
  });

  it('clicking Dismiss invokes onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss,
        isTakingOver: false,
        takeoverError: ''
      }
    });

    await user.click(screen.getByRole('button', { name: 'Stay in original tab' }));

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

    const view = render(SessionConflictModal, {
      props: {
        onTakeover,
        onDismiss: vi.fn(),
        isTakingOver: false,
        takeoverError: ''
      }
    });

    const button = screen.getByRole('button', { name: 'Continue here' });
    await user.click(button);
    await view.rerender({
      onTakeover,
      onDismiss: vi.fn(),
      isTakingOver: true,
      takeoverError: ''
    });

    expect(screen.getByRole('button', { name: 'Transferring session…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stay in original tab' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for the original tab to release ownership'
    );
    resolveTakeover?.();
  });

  it('keeps dismissal available during automatic retries', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss,
        isTakingOver: false,
        isRetrying: true,
        takeoverError: ''
      }
    });

    expect(screen.getByRole('button', { name: 'Transferring session…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stay in original tab' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Retrying the connection');

    await user.click(screen.getByRole('button', { name: 'Stay in original tab' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('dismisses on Escape and wraps keyboard focus within the dialog', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(SessionConflictModal, {
      props: {
        onTakeover: vi.fn(async () => undefined),
        onDismiss,
        isTakingOver: false,
        takeoverError: ''
      }
    });

    const takeoverButton = screen.getByRole('button', { name: 'Continue here' });
    const dismissButton = screen.getByRole('button', { name: 'Stay in original tab' });

    expect(takeoverButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(dismissButton).toHaveFocus();
    await user.tab();
    expect(takeoverButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows takeover errors and keeps dismissal disabled while takeover is pending', async () => {
    const user = userEvent.setup();
    let resolveTakeover!: () => void;
    const onDismiss = vi.fn();
    const view = render(SessionConflictModal, {
      props: {
        onTakeover: () =>
          new Promise<void>((resolve) => {
            resolveTakeover = resolve;
          }),
        onDismiss,
        isTakingOver: false,
        takeoverError: ''
      }
    });

    await user.click(screen.getByRole('button', { name: 'Continue here' }));
    await view.rerender({
      onTakeover: async () => undefined,
      onDismiss,
      isTakingOver: true,
      takeoverError: 'Failed to take over session. Please try again.'
    });
    expect(screen.getByRole('button', { name: 'Transferring session…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to take over session. Please try again.'
    );

    const latestDismiss = vi.fn();
    await view.rerender({
      onTakeover: async () => undefined,
      onDismiss: latestDismiss,
      isTakingOver: true,
      takeoverError: 'Failed to take over session. Please try again.'
    });
    await user.click(screen.getByRole('button', { name: 'Stay in original tab' }));

    expect(latestDismiss).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    resolveTakeover();
  });
});
