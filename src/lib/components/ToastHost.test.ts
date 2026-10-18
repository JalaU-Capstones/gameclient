import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { dismissToast, pushToast, toasts } from '$lib/stores/toasts';
import { get } from 'svelte/store';
import ToastHost from './ToastHost.svelte';

describe('ToastHost', () => {
  beforeEach(() => {
    const current = get(toasts);
    for (const toast of current) {
      dismissToast(toast.id);
    }
  });

  it('renders nothing when there are no toasts', () => {
    render(ToastHost);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/.+/)).not.toBeInTheDocument();
  });

  it('renders an info toast with the expected accessibility attributes', async () => {
    render(ToastHost);

    pushToast('info', 'hello world');
    await waitFor(() => expect(screen.getByText('hello world')).toBeInTheDocument());

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
  });

  it('renders an error toast and distinguishes it from an info toast', async () => {
    render(ToastHost);

    pushToast('error', 'something broke');
    await waitFor(() => expect(screen.getByText('something broke')).toBeInTheDocument());

    const toastNode = screen.getByText('something broke').closest('div');
    expect(toastNode).not.toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders multiple toasts in insertion order', async () => {
    render(ToastHost);

    pushToast('info', 'first');
    pushToast('success', 'second');

    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('dismisses a toast when the dismiss button is clicked', async () => {
    render(ToastHost);
    const id = pushToast('warning', 'dismiss me');

    await waitFor(() => expect(screen.getByText('dismiss me')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    await waitFor(() => {
      expect(get(toasts).some((toast) => toast.id === id)).toBe(false);
    });
    expect(screen.queryByText('dismiss me')).not.toBeInTheDocument();
  });
});
