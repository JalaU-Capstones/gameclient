import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '$lib/stores/session';
import InvitationHost from './InvitationHost.svelte';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  play: vi.fn(),
  pushToast: vi.fn(),
  send: vi.fn(),
  handlers: new Map<string, (payload?: unknown) => void>()
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$lib/stores/toasts', () => ({ pushToast: mocks.pushToast }));
vi.mock('$lib/stores/ws', () => ({
  standbyMode: {
    subscribe: (subscriber: (value: boolean) => void) => {
      subscriber(false);
      return () => {};
    }
  },
  globalGameplaysClient: {
    getOrCreate: () => ({
      on: (event: string, handler: (payload?: unknown) => void) => {
        mocks.handlers.set(event, handler);
        return () => mocks.handlers.delete(event);
      },
      send: mocks.send
    })
  }
}));

function emit(event: string, payload?: object) {
  mocks.handlers.get(event)?.(payload as never);
}

describe('InvitationHost', () => {
  beforeEach(() => {
    session.reset();
    session.setUser({
      id: 'host-1',
      name: 'Host',
      email: 'host@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });
    mocks.goto.mockReset();
    mocks.play.mockReset();
    mocks.pushToast.mockReset();
    mocks.send.mockReset();
    mocks.handlers.clear();
  });

  it('opens the modal for a valid invitation payload', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174000',
      host: { id: 'guest-1', name: 'Bob' }
    });

    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('ignores invitations with invalid UUIDs', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: 'not-a-valid-uuid',
      host: { id: 'guest-1', name: 'Bob' }
    });

    await waitFor(() => expect(mocks.handlers.has('invitation_received')).toBe(true));
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it('ignores invitations from the current user', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174000',
      host: { id: 'host-1', name: 'Host' }
    });

    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it('accepts a valid invitation by sending the validated game id', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174000',
      host: { id: 'guest-1', name: 'Bob' }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mocks.send).toHaveBeenCalledWith('accept_invitation', {
      game_id: '123e4567-e89b-42d3-a456-426614174000'
    });
  });

  it('rejects an invitation and closes the modal', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174000',
      host: { id: 'guest-1', name: 'Bob' }
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(mocks.send).toHaveBeenCalledWith('reject_invitation', {
      game_id: '123e4567-e89b-42d3-a456-426614174000'
    });
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it('maps Escape to reject', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: '123e4567-e89b-42d3-a456-426614174000',
      host: { id: 'guest-1', name: 'Bob' }
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mocks.send).toHaveBeenCalledWith('reject_invitation', {
      game_id: '123e4567-e89b-42d3-a456-426614174000'
    });
  });
});
