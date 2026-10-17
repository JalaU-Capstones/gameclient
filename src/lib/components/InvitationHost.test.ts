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
  currentClient: null as {
    handlers: Map<string, (payload?: unknown) => void>;
    on: (event: string, handler: (payload?: unknown) => void) => () => void;
    send: typeof vi.fn;
  } | null,
  clientSubscribers: new Set<(client: unknown) => void>(),
  standbySubscribers: new Set<(value: boolean) => void>(),
  standbyValue: false
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$lib/audio/sounds', () => ({ sounds: { play: mocks.play } }));
vi.mock('$lib/stores/toasts', () => ({ pushToast: mocks.pushToast }));
vi.mock('$lib/stores/ws', () => ({
  standbyMode: {
    subscribe: (subscriber: (value: boolean) => void) => {
      mocks.standbySubscribers.add(subscriber);
      subscriber(mocks.standbyValue);
      return () => mocks.standbySubscribers.delete(subscriber);
    },
    set: (value: boolean) => {
      mocks.standbyValue = value;
      mocks.standbySubscribers.forEach((subscriber) => subscriber(value));
    }
  },
  globalGameplaysClient: {
    subscribe: (subscriber: (client: unknown) => void) => {
      mocks.clientSubscribers.add(subscriber);
      subscriber(mocks.currentClient);
      return () => mocks.clientSubscribers.delete(subscriber);
    }
  }
}));

function createClient() {
  const handlers = new Map<string, (payload?: unknown) => void>();
  return {
    handlers,
    on: (event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    send: mocks.send
  };
}

function setClient(client: ReturnType<typeof createClient> | null) {
  mocks.currentClient = client;
  mocks.clientSubscribers.forEach((subscriber) => subscriber(client));
}

function emit(event: string, payload?: object, client = mocks.currentClient) {
  client?.handlers.get(event)?.(payload);
}

const VALID_GAME_ID = '123e4567-e89b-42d3-a456-426614174000';

function validInvite(overrides: Record<string, unknown> = {}) {
  return {
    game_id: VALID_GAME_ID,
    host: { id: 'guest-1', name: 'Bob' },
    ...overrides
  };
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
    mocks.clientSubscribers.clear();
    mocks.standbySubscribers.clear();
    mocks.standbyValue = false;
    mocks.currentClient = createClient();
  });

  it('opens the modal for a valid invitation payload and sanitizes the host name', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: VALID_GAME_ID,
      host: { id: 'guest-1', name: '\u202E Bob\u2066 ' }
    });

    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('opens the modal for a promoted invitation and shows the wait message', async () => {
    render(InvitationHost);

    emit('invitation_promoted', {
      game_id: VALID_GAME_ID,
      host: { id: 'guest-1', name: 'Bob' }
    });

    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
    expect(screen.getByText('Esta invitación estaba en espera.')).toBeInTheDocument();
  });

  it('opens the modal for a fresh invitation without the wait message', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: VALID_GAME_ID,
      host: { id: 'guest-1', name: 'Bob' }
    });

    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
    expect(screen.queryByText('Esta invitación estaba en espera.')).not.toBeInTheDocument();
  });

  it.each(['invitation_received', 'invitation_promoted'])(
    'accepts %s with the correct game id',
    async (event) => {
      render(InvitationHost);
      emit(event, validInvite());
      await screen.findByRole('button', { name: 'Accept' });

      await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

      expect(mocks.send).toHaveBeenCalledWith('accept_invitation', { game_id: VALID_GAME_ID });
    }
  );

  it.each(['invitation_received', 'invitation_promoted'])(
    'rejects %s with the correct game id',
    async (event) => {
      render(InvitationHost);
      emit(event, validInvite());
      await screen.findByRole('button', { name: 'Decline' });

      await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

      expect(mocks.send).toHaveBeenCalledWith('reject_invitation', { game_id: VALID_GAME_ID });
    }
  );

  it('ignores invitations with invalid UUIDs', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: 'not-a-valid-uuid',
      host: { id: 'guest-1', name: 'Bob' }
    });

    await waitFor(() =>
      expect(mocks.currentClient?.handlers.has('invitation_received')).toBe(true)
    );
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it('ignores invitations from the current user', async () => {
    render(InvitationHost);

    emit('invitation_received', {
      game_id: VALID_GAME_ID,
      host: { id: 'host-1', name: 'Host' }
    });

    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it('waits for the current user before displaying an invitation', async () => {
    session.reset();
    render(InvitationHost);
    emit('invitation_received', validInvite());

    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
    session.setUser({
      id: 'host-1',
      name: 'Host',
      email: 'host@example.com',
      registerDate: '2026-01-01T00:00:00Z'
    });

    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
  });

  it('accepts a valid invitation by sending the validated game id', async () => {
    render(InvitationHost);
    emit('invitation_received', validInvite());
    await screen.findByRole('button', { name: 'Accept' });
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mocks.send).toHaveBeenCalledWith('accept_invitation', { game_id: VALID_GAME_ID });
  });

  it('rejects an invitation and closes the modal', async () => {
    render(InvitationHost);
    emit('invitation_received', validInvite());
    await screen.findByRole('button', { name: 'Decline' });
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(mocks.send).toHaveBeenCalledWith('reject_invitation', { game_id: VALID_GAME_ID });
    expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument();
  });

  it.each(['invitation_canceled', 'invitation_expired'])(
    'closes the modal when %s is received',
    async (event) => {
      render(InvitationHost);
      emit('invitation_received', validInvite());
      await screen.findByText('Challenger Approaching!');

      emit(event);

      await waitFor(() =>
        expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument()
      );
      expect(mocks.pushToast).toHaveBeenCalledOnce();
    }
  );

  it('closes the modal after 60 seconds without sending reject_invitation', async () => {
    vi.useFakeTimers();
    try {
      render(InvitationHost);
      emit('invitation_received', validInvite());
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText('Challenger Approaching!')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() =>
        expect(screen.queryByText('Challenger Approaching!')).not.toBeInTheDocument()
      );
      expect(mocks.send).not.toHaveBeenCalledWith('reject_invitation', { game_id: VALID_GAME_ID });
      expect(mocks.pushToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebinds handlers after the gameplay client is replaced', async () => {
    const oldClient = mocks.currentClient;
    render(InvitationHost);
    const nextClient = createClient();

    setClient(nextClient);

    expect(oldClient?.handlers.has('invitation_received')).toBe(false);
    expect(nextClient.handlers.has('invitation_received')).toBe(true);
    emit('invitation_received', validInvite(), nextClient);
    expect(await screen.findByText('Challenger Approaching!')).toBeInTheDocument();
  });

  it('closes and makes the modal inert when disabled', async () => {
    const view = render(InvitationHost, { props: { disabled: false } });
    emit('invitation_received', validInvite());
    await screen.findByText('Challenger Approaching!');

    await view.rerender({ disabled: true });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    emit('invitation_received', validInvite());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('maps Escape to reject', async () => {
    render(InvitationHost);
    emit('invitation_received', validInvite());
    await screen.findByText('Challenger Approaching!');
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(mocks.send).toHaveBeenCalledWith('reject_invitation', { game_id: VALID_GAME_ID });
  });
});
