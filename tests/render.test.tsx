// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Chart.js needs a real canvas, which jsdom lacks; stub the chart components so
// chart-bearing screens render (and re-render on toggle) without a canvas.
vi.mock('react-chartjs-2', () => ({ Line: () => null, Bar: () => null }));
import { Home } from '../src/screens/Home';
import { Setup } from '../src/screens/Setup';
import { PlayerStats } from '../src/screens/PlayerStats';
import { Live } from '../src/screens/Live';
import { LiveAtc } from '../src/screens/LiveAtc';
import { Profile } from '../src/screens/Profile';
import { History } from '../src/screens/History';
import { addPlayer, saveMatch, getMatch, importAllData } from '../src/db';
import { makeMatch, makeLeg, makeTurn, S, atcHitDart } from './helpers';
import type { AtcRing } from '../src/types';

afterEach(async () => {
  cleanup();
  location.hash = '';
  localStorage.clear();
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

  it('Home delete asks for confirmation (with an export option) before removing', async () => {
    await addPlayer('Alice');
    render(<Home />);
    fireEvent.click(await screen.findByLabelText('Delete Alice'));

    // The modal offers an export-first option and has not deleted anything yet.
    expect(screen.getByText('⬇ Export backup')).toBeTruthy();
    expect(screen.getByLabelText("Open Alice's profile")).toBeTruthy();

    // Confirming clears the player (and, via cascade, their matches).
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('No players yet. Add one below.')).toBeTruthy());
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

  it('Setup shows live throw-order badges on selected players', async () => {
    await addPlayer('Alice');
    await addPlayer('Bob');
    render(<Setup />);

    const aliceLabel = (await screen.findByText('Alice')).closest('label')!;
    const bobLabel = screen.getByText('Bob').closest('label')!;
    const aliceBox = aliceLabel.querySelector('input')!;
    const bobBox = bobLabel.querySelector('input')!;
    const badge = (label: HTMLElement) => label.querySelector('.order-badge');

    // Unselected players carry no badge.
    expect(badge(aliceLabel)).toBeNull();

    // Select Bob first, then Alice → Bob throws 1st, Alice 2nd.
    fireEvent.click(bobBox);
    fireEvent.click(aliceBox);
    expect(badge(bobLabel)!.textContent).toBe('1');
    expect(badge(aliceLabel)!.textContent).toBe('2');

    // Deselecting the first re-numbers the rest live.
    fireEvent.click(bobBox);
    expect(badge(bobLabel)).toBeNull();
    expect(badge(aliceLabel)!.textContent).toBe('1');
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

  it('LiveAtc progressive requires a bull hit even after a treble', async () => {
    const alice = await addPlayer('Alice');
    // Alice has cleared 1–18 (progress 18); the next target is 19.
    const cleared = Array.from({ length: 18 }, (_, i) => atcHitDart(i + 1));
    const match = makeMatch({
      id: 'm-prog',
      gameType: 'AroundTheClock',
      atcRing: 'progressive',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('m-prog', [makeTurn(alice.id, cleared, 18)])],
    });
    await saveMatch(match);

    render(<LiveAtc matchId="m-prog" />);
    const treble = await screen.findByText('Treble +3');

    // Treble 19 would overshoot the bull — capped, so it only reaches 20 and the
    // board is not cleared yet.
    fireEvent.click(treble);
    expect(screen.queryByText(/clears the board/i)).toBeNull();
    expect(screen.getByText('20/21')).toBeTruthy();

    // The bull still has to be hit to finish.
    fireEvent.click(screen.getByText('Hit +1'));
    expect(screen.getByText(/clears the board/i)).toBeTruthy();
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

  it('PlayerStats remembers the last-open tab per player', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');

    // Open Alice's stats and switch to Consistency.
    render(<PlayerStats playerId={alice.id} />);
    await screen.findByText('Alice · Stats');
    fireEvent.click(screen.getByText('Consistency'));
    expect(localStorage.getItem(`darttrak:statsTab:${alice.id}`)).toBe('consistency');
    cleanup();

    // Re-opening Alice restores Consistency as the active tab.
    render(<PlayerStats playerId={alice.id} />);
    await screen.findByText('Alice · Stats');
    expect(screen.getByText('Consistency').className).toContain('active');
    expect(screen.getByText('Overview').className).not.toContain('active');
    cleanup();

    // Bob has his own memory and defaults to Overview.
    render(<PlayerStats playerId={bob.id} />);
    await screen.findByText('Bob · Stats');
    expect(screen.getByText('Overview').className).toContain('active');
  });

  it('PlayerStats nests x01 lenses under a top-level mode and remembers the lens', async () => {
    const alice = await addPlayer('Alice');
    render(<PlayerStats playerId={alice.id} />);
    await screen.findByText('Alice · Stats');

    // x01 mode shows the lens sub-tabs; pick one.
    fireEvent.click(screen.getByText('Consistency'));
    // Switching to the ATC mode hides the x01 lenses.
    fireEvent.click(screen.getByText('Around the Clock'));
    expect(screen.queryByText('Consistency')).toBeNull();
    // Back to x01 returns to the lens we were on, not Overview.
    fireEvent.click(screen.getByText('x01'));
    expect(screen.getByText('Consistency').className).toContain('active');
  });

  it('PlayerStats ATC toggles between per-variant combined charts', async () => {
    const alice = await addPlayer('Alice');
    // Two variants so the selector appears.
    for (const ring of ['single', 'progressive'] as const) {
      await saveMatch(
        makeMatch({
          id: `atc-${ring}`,
          gameType: 'AroundTheClock',
          atcRing: ring,
          playerIds: [alice.id],
          status: 'completed',
          winnerId: alice.id,
          legs: [makeLeg(`atc-${ring}`, [makeTurn(alice.id, [atcHitDart(1)], 1)], alice.id)],
        }),
      );
    }
    render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));

    // Only one variant's combined chart is shown — no bar chart, no metric toggle.
    expect(screen.getAllByText('Hit % and throws to finish, per game.')).toHaveLength(1);
    expect(screen.queryByText('Avg Darts to Clear')).toBeNull();
    expect(screen.queryByText('Darts / game')).toBeNull();

    // The per-area card lists the variant's targets with their hit rate. The
    // single game has one hit on target 1, so that row reads 100% (1/1).
    expect(screen.getByText('Hit % By Area')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();

    // 'Any' (ring order first) is active by default; the selector switches subtype.
    expect(screen.getByRole('button', { name: 'Any' }).className).toContain('active');
    const progChip = screen.getByRole('button', { name: 'Progressive' });
    fireEvent.click(progChip);
    expect(progChip.className).toContain('active');
    expect(screen.getByRole('button', { name: 'Any' }).className).not.toContain('active');
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

describe('LiveAtc action layout', () => {
  async function renderLiveAtc(ring: AtcRing, findLabel: string) {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: `atc-${ring}`,
        gameType: 'AroundTheClock',
        atcRing: ring,
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg(`atc-${ring}`, [])],
      }),
    );
    render(<LiveAtc matchId={`atc-${ring}`} />);
    await screen.findByText(findLabel);
  }

  const buttonLabels = (selector: string) =>
    Array.from(document.querySelector(selector)!.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );

  it('Progressive groups the scoring buttons and puts Miss last (bottom-right)', async () => {
    await renderLiveAtc('progressive', 'Hit +1');
    expect(buttonLabels('.atc-prog-actions')).toEqual([
      'Hit +1',
      'Double +2',
      'Treble +3',
      'Miss ✗',
    ]);
  });

  it('Single ring keeps Hit then Miss (Miss on the right) — same side as Progressive', async () => {
    await renderLiveAtc('single', 'HIT ✓');
    // The first .live-actions row is the hit/miss pair (the undo/confirm row follows).
    expect(buttonLabels('.live-actions')).toEqual(['HIT ✓', 'MISS ✗']);
  });
});
