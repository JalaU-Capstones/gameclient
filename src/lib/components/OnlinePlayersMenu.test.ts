import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import OnlinePlayersMenu from './OnlinePlayersMenu.svelte';
import { onlinePlayers } from '$lib/stores/onlinePlayers.svelte';
import { session } from '$lib/stores/session';

describe('OnlinePlayersMenu', () => {
  beforeEach(() => {
    onlinePlayers.reset();
    session.reset();
    onlinePlayers.users = [{ id: 'player-1', name: 'Alice' }];
  });

  afterEach(() => {
    cleanup();
    onlinePlayers.reset();
    session.reset();
  });

  it('prefixes online player names with @', () => {
    render(OnlinePlayersMenu);

    expect(screen.getByText('@Alice')).toBeInTheDocument();
  });
});
