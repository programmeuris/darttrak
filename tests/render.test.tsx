// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Home } from '../src/screens/Home';
import { Setup } from '../src/screens/Setup';
import { PlayerStats } from '../src/screens/PlayerStats';
import { Live } from '../src/screens/Live';
import { addPlayer, saveMatch, getMatch, importAllData } from '../src/db';
import { makeMatch, makeLeg } from './helpers';

afterEach(async () => {
  cleanup();
  await importAllData({ players: [], matches: [] }); // reset the shared fake DB
});

describe('screens render without crashing', () => {
  it('Home shows the title and empty roster', async () => {
    render(<Home />);
    expect(screen.getByText('🎯 Darts Tracker')).toBeTruthy();
    // Roster loads async from (fake) IndexedDB.
    expect(await screen.findByText('No players yet. Add one below.')).toBeTruthy();
  });

  it('Home can add a player', async () => {
    render(<Home />);
    const input = screen.getByPlaceholderText('New player name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText('Alice')).toBeTruthy();
  });

  it('Setup renders game-type options and shows the ATC ring picker', async () => {
    render(<Setup />);
    expect(screen.getByText('Game Type')).toBeTruthy();
    // Double Out shows for x01; switching to ATC reveals the ring picker.
    expect(screen.getByText('Double Out')).toBeTruthy();
    fireEvent.click(screen.getByText('Around the Clock'));
    expect(await screen.findByText('Ring')).toBeTruthy();
    expect(screen.getByText('Progressive')).toBeTruthy();
  });

  it('PlayerStats prompts to add players when none exist', async () => {
    render(<PlayerStats />);
    expect(await screen.findByText('Add players to see stats.')).toBeTruthy();
  });

  it('Live mounts an in-progress 501 match and records exactly one turn per confirm', async () => {
    const alice = await addPlayer('Alice');
    const match = makeMatch({
      id: 'm-live',
      gameType: '501',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('m-live', [])],
    });
    await saveMatch(match);

    render(<Live matchId="m-live" />);
    // Scoreboard renders the player and starting score once the match loads.
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('501')).toBeTruthy();

    // Enter a dart, then double-click Confirm — the guard must record only one turn.
    fireEvent.click(screen.getByText('20'));
    const confirm = screen.getByText('Confirm Turn');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(async () => {
      const saved = await getMatch('m-live');
      expect(saved!.legs[0].turns).toHaveLength(1);
    });
  });
});
