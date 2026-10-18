import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TakeoverPromptModal from './TakeoverPromptModal.svelte';

describe('TakeoverPromptModal', () => {
  it('renders nothing when hidden', () => {
    render(TakeoverPromptModal, {
      props: {
        show: false,
        isSubmitting: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn()
      }
    });

    expect(screen.queryByTestId('takeover-modal')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires the confirm handler and keeps the cancel control visible', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(TakeoverPromptModal, {
      props: {
        show: true,
        isSubmitting: false,
        onConfirm,
        onCancel
      }
    });

    await user.click(screen.getByTestId('takeover-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('takeover-cancel')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Another session is active');
  });

  it('shows the retry countdown variant when retryAfterSeconds is positive', () => {
    render(TakeoverPromptModal, {
      props: {
        show: true,
        isSubmitting: false,
        retryAfterSeconds: 9,
        onConfirm: vi.fn(),
        onCancel: vi.fn()
      }
    });

    expect(screen.getByTestId('takeover-confirm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows an alert message and calls the cancel handler on Escape', async () => {
    const onCancel = vi.fn();
    render(TakeoverPromptModal, {
      props: {
        show: true,
        isSubmitting: false,
        errorMessage: 'Please retry in a moment.',
        onConfirm: vi.fn(),
        onCancel
      }
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Please retry in a moment.');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not handle Escape while submitting', () => {
    const onCancel = vi.fn();
    render(TakeoverPromptModal, {
      props: {
        show: true,
        isSubmitting: true,
        onConfirm: vi.fn(),
        onCancel
      }
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).not.toHaveBeenCalled();
  });
});
