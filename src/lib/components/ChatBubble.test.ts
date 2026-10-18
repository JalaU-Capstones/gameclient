import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ChatBubble from './ChatBubble.svelte';

describe('ChatBubble', () => {
  it('renders with the open chat button label', () => {
    render(ChatBubble, { onClick: () => undefined });

    expect(screen.getByLabelText('Open chat')).toBeInTheDocument();
    expect(screen.getByLabelText('Open chat')).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onClick once on click', async () => {
    const onClick = vi.fn();
    render(ChatBubble, { onClick });

    await fireEvent.click(screen.getByTestId('chat-bubble'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render a badge when unreadCount is zero', () => {
    render(ChatBubble, { onClick: () => undefined, unreadCount: 0 });

    expect(screen.queryByLabelText('0 unread messages')).not.toBeInTheDocument();
  });

  it('renders the badge count when unreadCount is positive', () => {
    render(ChatBubble, { onClick: () => undefined, unreadCount: 3 });

    expect(screen.getByLabelText('3 unread messages')).toHaveTextContent('3');
  });

  it('caps the unread badge at 99+', () => {
    render(ChatBubble, { onClick: () => undefined, unreadCount: 112 });

    expect(screen.getByLabelText('112 unread messages')).toHaveTextContent('99+');
  });

  it('has the chat bubble test id', () => {
    render(ChatBubble, { onClick: () => undefined });

    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });
});
