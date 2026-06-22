// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Home } from '../src/screens/Home';
import { Setup } from '../src/screens/Setup';
import { PlayerStats } from '../src/screens/PlayerStats';
import { Live } from '../src/screens/Live';
import { LiveAtc } from '../src/screens/LiveAtc';
import { Profile } from '../src/screens/Profile';
import { History } from '../src/screens/History';
import { addPlayer, saveMatch, getMatch, importAllData } from '../src/db';
import { makeMatch, makeLeg, makeTurn, S, atcHitDart } from './helpers';

afterEach(async () => {
  cleanup();
  location.hash = '';
  await importAllData({ players: [], matches: [] }); // reset the shared fake DB
});

describe('screens render without crashing', () => {
  it('Home shows the title and empty roster', async () => {
    render(<Home />);
    expect(screen.getByText('🎯 DartTrak')).toBeTruthy();
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

    // A turn is three darts: confirm stays disabled until all three are thrown.
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect((screen.getByText('Confirm Turn (1/3)') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: '20' }));

    // Now enabled; double-click Confirm — the guard must record only one turn.
    const confirm = screen.getByText('Confirm Turn (3/3)');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(async () => {
      const saved = await getMatch('m-live');
      expect(saved!.legs[0].turns).toHaveLength(1);
    });
  });

  it('Live lets a checkout win confirm with fewer than three darts', async () => {
    const bob = await addPlayer('Bob');
    // Bob sits on 40 → D20 checks out on a single dart.
    const match = makeMatch({
      id: 'm-co-win',
      gameType: '501',
      playerIds: [bob.id],
      doubleOut: true,
      status: 'in_progress',
      legs: [makeLeg('m-co-win', [makeTurn(bob.id, [S(20)], 40)])],
    });
    await saveMatch(match);

    render(<Live matchId="m-co-win" />);
    fireEvent.click(await screen.findByText('Double'));
    fireEvent.click(screen.getByRole('button', { name: '20' }));

    const confirm = screen.getByText('Confirm Win') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(async () => {
      const saved = await getMatch('m-co-win');
      expect(saved!.status).toBe('completed');
      expect(saved!.winnerId).toBe(bob.id);
    });
  });

  it('LiveAtc requires three darts before a turn can be confirmed', async () => {
    const alice = await addPlayer('Alice');
    const match = makeMatch({
      id: 'm-atc3',
      gameType: 'AroundTheClock',
      atcRing: 'single',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('m-atc3', [])],
    });
    await saveMatch(match);

    render(<LiveAtc matchId="m-atc3" />);
    const hit = await screen.findByText('HIT ✓');

    // Fewer than three darts: confirm is disabled and the label tracks the count.
    expect((screen.getByText('Confirm Turn (0/3)') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(hit);
    fireEvent.click(screen.getByText('HIT ✓'));
    expect((screen.getByText('Confirm Turn (2/3)') as HTMLButtonElement).disabled).toBe(true);

    // Third dart unlocks confirm and records exactly one turn.
    fireEvent.click(screen.getByText('HIT ✓'));
    const confirm = screen.getByText('Confirm Turn (3/3)') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(async () => {
      const saved = await getMatch('m-atc3');
      expect(saved!.legs[0].turns).toHaveLength(1);
      expect(saved!.legs[0].turns[0].darts).toHaveLength(3);
    });
  });

  it('LiveAtc lets a board-clearing win confirm with fewer than three darts', async () => {
    const alice = await addPlayer('Alice');
    const twenty = Array.from({ length: 20 }, (_, i) => atcHitDart(i + 1));
    const match = makeMatch({
      id: 'm-atcwin',
      gameType: 'AroundTheClock',
      atcRing: 'single',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('m-atcwin', [makeTurn(alice.id, twenty, 20)])],
    });
    await saveMatch(match);

    render(<LiveAtc matchId="m-atcwin" />);
    const hit = await screen.findByText('HIT ✓');

    // One hit on the bull clears the board: the win is shown but not yet saved.
    fireEvent.click(hit);
    expect(screen.getByText(/clears the board/i)).toBeTruthy();
    const confirm = screen.getByText('Confirm Win') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect((await getMatch('m-atcwin'))!.status).toBe('in_progress');

    // The explicit confirm finalizes the win.
    fireEvent.click(confirm);
    await waitFor(async () => {
      const saved = await getMatch('m-atcwin');
      expect(saved!.status).toBe('completed');
      expect(saved!.winnerId).toBe(alice.id);
    });
  });

  it('Live shows a checkout suggestion when the player is on a finish', async () => {
    const bob = await addPlayer('Bob');
    // A prior turn leaves Bob on 40 → suggested finish is D20.
    const match = makeMatch({
      id: 'm-co',
      gameType: '501',
      playerIds: [bob.id],
      doubleOut: true,
      status: 'in_progress',
      legs: [makeLeg('m-co', [makeTurn(bob.id, [S(20)], 40)])],
    });
    await saveMatch(match);

    render(<Live matchId="m-co" />);
    expect(await screen.findByText('D20')).toBeTruthy();
  });
});

describe('player profiles', () => {
  it('Home links each player to their profile', async () => {
    const alice = await addPlayer('Alice');
    render(<Home />);
    const link = await screen.findByRole('button', { name: /Open Alice's profile/i });
    fireEvent.click(link);
    expect(location.hash).toBe(`#/player/${alice.id}`);
  });

  it('Home no longer shows a global Stats button', async () => {
    render(<Home />);
    await screen.findByText('History'); // wait for the screen
    expect(screen.queryByText('Stats')).toBeNull();
  });

  it('Profile shows the name, match count, and analytics entry', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'pf1',
        gameType: '501',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('pf1', [makeTurn(alice.id, [S(20)], 481)], alice.id)],
      }),
    );
    render(<Profile playerId={alice.id} />);
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.getByText('1 match played')).toBeTruthy();
    fireEvent.click(screen.getByText('📊 Analytics'));
    expect(location.hash).toBe(`#/player/${alice.id}/stats`);
  });

  it('PlayerStats locks to a player and hides the picker', async () => {
    const alice = await addPlayer('Alice');
    render(<PlayerStats playerId={alice.id} />);
    expect(await screen.findByText('Alice · Stats')).toBeTruthy();
    expect(screen.queryByText('All players')).toBeNull();
    // The standalone picker label is not rendered in locked mode.
    expect(screen.queryByText('Player')).toBeNull();
  });

  it('History scopes to one player and hides the player filter', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    await saveMatch(
      makeMatch({
        id: 'ah1',
        gameType: '501',
        playerIds: [alice.id, bob.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('ah1', [], alice.id)],
      }),
    );
    await saveMatch(
      makeMatch({
        id: 'bh1',
        gameType: '501',
        playerIds: [bob.id],
        status: 'completed',
        winnerId: bob.id,
        legs: [makeLeg('bh1', [], bob.id)],
      }),
    );
    render(<History playerId={alice.id} />);
    expect(await screen.findByText('Alice · History')).toBeTruthy();
    // Player filter dropdown is hidden; the game filter stays.
    expect(screen.queryByText('All players')).toBeNull();
    expect(screen.getByText('All games')).toBeTruthy();
    // Only Alice's match is listed (Bob's solo game is excluded).
    expect(screen.getByText('Alice vs Bob')).toBeTruthy();
  });
});
