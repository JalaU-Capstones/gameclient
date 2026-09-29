import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GameTitle from './GameTitle.svelte';

describe('GameTitle', () => {
  it('renders the default title', () => {
    render(GameTitle);
    expect(screen.getByTestId('game-title')).toHaveTextContent('TIC TAC TOE');
  });

  it('renders a custom text when passed as prop', () => {
    render(GameTitle, { props: { text: 'CUSTOM' } });
    expect(screen.getByTestId('game-title')).toHaveTextContent('CUSTOM');
  });
});
