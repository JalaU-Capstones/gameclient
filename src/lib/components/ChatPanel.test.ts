import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStatus } from '$lib/stores/chat.svelte';
import type { ChatMessage } from '$lib/types/chat';
import ChatPanel from './ChatPanel.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  clearError: vi.fn(),
  send: vi.fn(),
  state: {
    messages: [] as ChatMessage[],
    usersCount: 0,
    status: 'connected' as ChatStatus,
    isOpen: false,
    error: null as string | null,
    authError: null as string | null,
    rateLimitUntil: null as number | null,
    unreadCount: 0
  }
}));

vi.mock('$lib/stores/chat.svelte', () => ({
  chatStore: {
    get messages() {
      return mocks.state.messages;
    },
    get usersCount() {
      return mocks.state.usersCount;
    },
    get status() {
      return mocks.state.status;
    },
    get isOpen() {
      return mocks.state.isOpen;
    },
    get error() {
      return mocks.state.error;
    },
    get authError() {
      return mocks.state.authError;
    },
    get rateLimitUntil() {
      return mocks.state.rateLimitUntil;
    },
    get unreadCount() {
      return mocks.state.unreadCount;
    },
    send: mocks.send,
    markRead: vi.fn(),
    clearError: mocks.clearError
  }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: mocks.play }
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    mocks.play.mockReset();
    mocks.clearError.mockReset();
    mocks.send.mockReset();
    mocks.state.messages = [];
    mocks.state.usersCount = 4;
    mocks.state.status = 'connected';
    mocks.state.error = null;
    mocks.state.authError = null;
    mocks.state.rateLimitUntil = null;
    mocks.state.unreadCount = 0;
  });

  it('renders the header with the current user count', () => {
    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByText('Chat · 4')).toBeInTheDocument();
  });

  it.each([
    ['connected', 'bg-emerald-400'],
    ['reconnecting', 'bg-amber-400'],
    ['error', 'bg-red-500'],
    ['idle', 'bg-neutral-500']
  ])('renders the status dot for %s', (status, className) => {
    mocks.state.status = status as ChatStatus;
    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByLabelText('Chat status')).toHaveClass(className);
  });

  it('calls the close handler and plays the click sound', async () => {
    const onClose = vi.fn();
    render(ChatPanel, { onClose });

    await userEvent.click(screen.getByTestId('chat-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('calls the close handler and plays the click sound on Escape', async () => {
    const onClose = vi.fn();
    render(ChatPanel, { onClose });

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('renders messages with the author name and relative time', () => {
    mocks.state.messages = [
      {
        id: '1',
        userId: 'u1',
        userName: 'Ada',
        content: 'hello',
        timestamp: new Date(Date.now() - 60_000).toISOString()
      }
    ];

    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByText('Ada · 1m')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('shares one group header for consecutive messages from the same author within 5 minutes', () => {
    const now = Date.now();
    mocks.state.messages = [
      {
        id: '1',
        userId: 'u1',
        userName: 'Ada',
        content: 'first',
        timestamp: new Date(now - 120_000).toISOString()
      },
      {
        id: '2',
        userId: 'u1',
        userName: 'Ada',
        content: 'second',
        timestamp: new Date(now - 60_000).toISOString()
      }
    ];

    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getAllByText(/Ada ·/)).toHaveLength(1);
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders a header for each different author', () => {
    const now = Date.now();
    mocks.state.messages = [
      {
        id: '1',
        userId: 'u1',
        userName: 'Ada',
        content: 'one',
        timestamp: new Date(now - 60_000).toISOString()
      },
      {
        id: '2',
        userId: 'u2',
        userName: 'Bob',
        content: 'two',
        timestamp: new Date(now - 30_000).toISOString()
      }
    ];

    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getAllByText(/Ada ·|Bob ·/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows an absolute time in the title on older messages', () => {
    const exactIso = '2024-01-15T12:00:00.000Z';
    mocks.state.messages = [
      {
        id: '1',
        userId: 'u1',
        userName: 'Ada',
        content: 'old',
        timestamp: exactIso
      }
    ];

    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByText('Ada · ' + new Date(exactIso).toLocaleString())).toBeInTheDocument();
  });

  it('renders chatStore.error inline', () => {
    mocks.state.error = 'Something broke';
    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('renders chatStore.authError inline when error is null', () => {
    mocks.state.authError = 'Authentication failed.';
    render(ChatPanel, { onClose: vi.fn() });

    expect(screen.getByText('Authentication failed.')).toBeInTheDocument();
  });

  it('shows the rate limit countdown and disables form controls', () => {
    vi.useFakeTimers();
    try {
      mocks.state.rateLimitUntil = Date.now() + 8_000;
      render(ChatPanel, { onClose: vi.fn() });

      expect(screen.getByText('Wait 8s')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables the send button when the message is empty and clears the input after a successful send', async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue(undefined);
    render(ChatPanel, { onClose: vi.fn() });

    const input = screen.getByRole('textbox', { name: 'Message' });
    const button = screen.getByRole('button', { name: 'Send' });

    expect(button).toBeDisabled();
    await user.type(input, 'hello');
    expect(button).toBeEnabled();

    await user.click(button);
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('hello'));
    expect(input).toHaveValue('');
  });

  it('preserves the input when chatStore.send returns an error', async () => {
    const user = userEvent.setup();
    mocks.send.mockImplementation(async () => {
      mocks.state.error = 'Message cannot be empty.';
    });
    render(ChatPanel, { onClose: vi.fn() });

    const input = screen.getByRole('textbox', { name: 'Message' });
    await user.type(input, 'bad');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('bad'));
    expect(input).toHaveValue('bad');
  });

  it('submits the trimmed message on Enter', async () => {
    const user = userEvent.setup();
    mocks.send.mockResolvedValue(undefined);
    render(ChatPanel, { onClose: vi.fn() });

    const input = screen.getByRole('textbox', { name: 'Message' });
    await user.type(input, ' hello ');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('hello'));
  });

  it('shows the character counter only above 400 characters', async () => {
    const user = userEvent.setup();
    render(ChatPanel, { onClose: vi.fn() });

    const input = screen.getByRole('textbox', { name: 'Message' });
    await user.type(input, 'a'.repeat(401));

    expect(screen.getByText('401/500')).toBeInTheDocument();
  });

  it('dismisses the inline error and calls clearError', async () => {
    const user = userEvent.setup();
    mocks.state.error = 'Something broke';
    render(ChatPanel, { onClose: vi.fn() });

    await user.click(screen.getByLabelText('Dismiss error'));

    expect(mocks.clearError).toHaveBeenCalledTimes(1);
  });
});
