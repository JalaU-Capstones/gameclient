import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStatus } from '$lib/stores/chat.svelte';
import type { ChatMessage } from '$lib/types/chat';
import ChatHost from './ChatHost.svelte';

const mocks = vi.hoisted(() => ({
  play: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  send: vi.fn(),
  markRead: vi.fn(),
  clearError: vi.fn(),
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
    open: mocks.open,
    close: mocks.close,
    send: mocks.send,
    markRead: mocks.markRead,
    clearError: mocks.clearError
  }
}));

vi.mock('$lib/audio/sounds', () => ({
  sounds: { play: mocks.play }
}));

describe('ChatHost', () => {
  beforeEach(() => {
    mocks.play.mockReset();
    mocks.open.mockReset();
    mocks.close.mockReset();
    mocks.send.mockReset();
    mocks.markRead.mockReset();
    mocks.clearError.mockReset();
    mocks.state.messages = [];
    mocks.state.usersCount = 0;
    mocks.state.status = 'connected';
    mocks.state.isOpen = false;
    mocks.state.error = null;
    mocks.state.authError = null;
    mocks.state.rateLimitUntil = null;
    mocks.state.unreadCount = 0;
  });

  it('renders nothing when visible is false and the store is closed', () => {
    const { queryByTestId } = render(ChatHost, { visible: false, disabled: false });

    expect(queryByTestId('chat-host')).toBeNull();
  });

  it('renders the bubble when visible is true and the panel is closed', () => {
    render(ChatHost, { visible: true, disabled: false });

    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });

  it('renders the panel when visible is true and the store is open', () => {
    mocks.state.isOpen = true;
    render(ChatHost, { visible: true, disabled: false });

    expect(screen.getByRole('region', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.queryByTestId('chat-bubble')).not.toBeInTheDocument();
  });

  it('clicking the bubble calls open and plays the click sound', async () => {
    const user = userEvent.setup();
    render(ChatHost, { visible: true, disabled: false });

    await user.click(screen.getByTestId('chat-bubble'));

    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('clicking the panel close calls close and plays the click sound', async () => {
    const user = userEvent.setup();
    mocks.state.isOpen = true;
    render(ChatHost, { visible: true, disabled: false });

    await user.click(screen.getByTestId('chat-close'));

    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.play).toHaveBeenCalledWith('click');
  });

  it('calls chatStore.close when visible flips to false while open', async () => {
    mocks.state.isOpen = true;
    const { rerender } = render(ChatHost, { visible: true, disabled: false });

    await rerender({ visible: false, disabled: false });

    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('calls close once when disabled flips to true while open', async () => {
    mocks.state.isOpen = true;
    const { rerender } = render(ChatHost, { visible: true, disabled: false });

    await rerender({ visible: true, disabled: true });

    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('calls open once when disabled flips back to false after being disabled', async () => {
    mocks.state.isOpen = true;
    const { rerender } = render(ChatHost, { visible: true, disabled: true });

    await rerender({ visible: true, disabled: false });

    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it('does not call close when disabled is true and the store is already closed', () => {
    render(ChatHost, { visible: true, disabled: true });

    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('calls markRead while open and enabled, and not while disabled', () => {
    mocks.state.isOpen = true;
    const { rerender } = render(ChatHost, { visible: true, disabled: false });

    expect(mocks.markRead).toHaveBeenCalled();

    mocks.markRead.mockClear();
    rerender({ visible: true, disabled: true });

    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('sets the outer wrapper to inert when disabled', () => {
    render(ChatHost, { visible: true, disabled: true });

    expect(screen.getByTestId('chat-host')).toHaveAttribute('inert');
  });
});
