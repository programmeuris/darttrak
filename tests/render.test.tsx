// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Chart.js needs a real canvas, which jsdom lacks; stub the chart components so
// chart-bearing screens render (and re-render on toggle) without a canvas.
vi.mock('react-chartjs-2', () => ({ Line: () => null, Bar: () => null }));
// Spy-wrap the db module (real implementations preserved) so individual calls
// can be made to fail in the error-path tests.
vi.mock('../src/db', { spy: true });
import { Home } from '../src/screens/Home';
import { Setup } from '../src/screens/Setup';
import { PlayerStats } from '../src/screens/PlayerStats';
import { Live } from '../src/screens/Live';
import { LiveAtc } from '../src/screens/LiveAtc';
import { LiveTraining } from '../src/screens/LiveTraining';
import { Profile } from '../src/screens/Profile';
import { History } from '../src/screens/History';
import { addPlayer, saveMatch, getMatch, getAllMatches, importAllData } from '../src/db';
import { makeMatch, makeLeg, makeTurn, S, dart, atcHitDart, atcMissDart } from './helpers';
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

  it('Home delete modal moves focus to Cancel and closes on Escape', async () => {
    await addPlayer('Alice');
    render(<Home />);
    const trigger = await screen.findByLabelText('Delete Alice');
    trigger.focus(); // jsdom doesn't focus on click; real browsers do
    fireEvent.click(trigger);

    // Focus lands on Cancel — the safe default in a destructive dialog.
    const cancel = screen.getByText('Cancel');
    expect(document.activeElement).toBe(cancel);

    // Escape dismisses without deleting and returns focus to the trigger.
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText("Open Alice's profile")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it('Home stars exactly one main player per device and Setup preselects them', async () => {
    await addPlayer('Alice');
    await addPlayer('Bob');
    const { unmount } = render(<Home />);

    // Star Alice, then Bob — the star moves; only one main player exists.
    fireEvent.click(await screen.findByLabelText('Make Alice the main player'));
    expect(screen.getByLabelText('Alice is the main player — tap to clear')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Make Bob the main player'));
    expect(screen.getByLabelText('Make Alice the main player')).toBeTruthy();
    expect(screen.getByLabelText('Bob is the main player — tap to clear')).toBeTruthy();
    unmount();

    // New game: Bob is preselected (throw-order badge 1) and starred.
    render(<Setup />);
    const bobLabel = (await screen.findByText('Bob')).closest('label')!;
    await waitFor(() => expect(bobLabel.querySelector('.order-badge')!.textContent).toBe('1'));
    expect(bobLabel.querySelector('.main-star')).toBeTruthy();
    expect(
      (await screen.findByText('Alice')).closest('label')!.querySelector('.order-badge'),
    ).toBeNull();
  });

  it('Home clears the main player when they are deleted', async () => {
    await addPlayer('Alice');
    render(<Home />);
    fireEvent.click(await screen.findByLabelText('Make Alice the main player'));

    fireEvent.click(screen.getByLabelText('Delete Alice'));
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('No players yet. Add one below.')).toBeTruthy());
    expect(localStorage.getItem('darttrak:mainPlayer')).toBeNull();
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

    // A turn is three darts. With fewer thrown, the primary button offers to
    // fill the rest as misses rather than confirming outright.
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    const fill = screen.getByText('Miss Remaining (1/3)') as HTMLButtonElement;
    expect(fill.disabled).toBe(false);
    fireEvent.click(fill); // fills the two unthrown darts as misses

    // Now the turn is full; double-click Confirm — the guard records only one.
    const confirm = screen.getByText('Confirm Turn (3/3)');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(async () => {
      const saved = await getMatch('m-live');
      expect(saved!.legs[0].turns).toHaveLength(1);
      // One scoring dart (20) plus two auto-filled misses.
      expect(saved!.legs[0].turns[0].darts).toHaveLength(3);
      expect(saved!.legs[0].turns[0].totalScore).toBe(20);
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

  it('Live multiplier buttons expose their armed state via aria-pressed', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-mult',
        gameType: '501',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg('m-mult', [])],
      }),
    );
    render(<Live matchId="m-mult" />);

    const single = await screen.findByRole('button', { name: 'Single' });
    const dbl = screen.getByRole('button', { name: 'Double' });
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(dbl.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(dbl);
    expect(dbl.getAttribute('aria-pressed')).toBe('true');
    expect(single.getAttribute('aria-pressed')).toBe('false');

    // Registering a dart re-arms Single, and the state says so.
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(single.getAttribute('aria-pressed')).toBe('true');
  });

  it('Live keeps the status area mounted when the checkout hint comes and goes', async () => {
    const alice = await addPlayer('Alice');
    // Alice sits on 170: a 3-dart checkout exists, so the hint shows at mount.
    await saveMatch(
      makeMatch({
        id: 'm-slot',
        gameType: '501',
        playerIds: [alice.id],
        doubleOut: true,
        status: 'in_progress',
        legs: [makeLeg('m-slot', [makeTurn(alice.id, [S(20), S(20), S(20)], 170)])],
      }),
    );
    const { container } = render(<Live matchId="m-slot" />);
    await screen.findAllByText('Alice');

    expect(container.querySelector('.status-slot')).toBeTruthy();
    expect(container.querySelector('.checkout-hint')!.textContent).toContain('T20');

    // A missed dart leaves 170 with two darts — no route, so the hint goes,
    // but the slot keeps holding its space and the numpad doesn't shift.
    fireEvent.click(screen.getByRole('button', { name: 'Miss' }));
    expect(container.querySelector('.checkout-hint')).toBeNull();
    expect(container.querySelector('.status-slot')).toBeTruthy();
  });

  it('LiveAtc swaps the aim line for the win banner inside the same fixed slot', async () => {
    const alice = await addPlayer('Alice');
    // One target left: 20 of 21 already cleared.
    await saveMatch(
      makeMatch({
        id: 'atc-slot',
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [
          makeLeg('atc-slot', [
            makeTurn(
              alice.id,
              Array.from({ length: 20 }, (_, i) => atcHitDart(i + 1)),
              20,
            ),
          ]),
        ],
      }),
    );
    const { container } = render(<LiveAtc matchId="atc-slot" />);
    await screen.findAllByText('Alice');
    expect(container.querySelector('.status-slot .atc-aim')).toBeTruthy();

    // Clearing the board swaps the aim line for the win banner in place.
    fireEvent.click(screen.getByRole('button', { name: 'HIT ✓' }));
    expect(container.querySelector('.status-slot .banner.win')).toBeTruthy();
    expect(container.querySelector('.atc-aim')).toBeNull();
  });

  it('Live ignores a double-tap on Confirm right after a turn is recorded', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    await saveMatch(
      makeMatch({
        id: 'm-dtap',
        gameType: '501',
        playerIds: [alice.id, bob.id],
        status: 'in_progress',
        legs: [makeLeg('m-dtap', [])],
      }),
    );
    const { container } = render(<Live matchId="m-dtap" />);
    await screen.findByText('Alice');

    // Alice records a full turn.
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Miss Remaining (1/3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Turn (3/3)' }));

    // Once the save settles it's Bob's turn; the immediate next press (the
    // double-tap's second hit) must NOT pre-fill Bob's darts as misses.
    const fillBtn = (await screen.findByRole('button', {
      name: 'Miss Remaining (0/3)',
    })) as HTMLButtonElement;
    await waitFor(() => expect(fillBtn.disabled).toBe(false));
    fireEvent.click(fillBtn);
    expect(container.querySelectorAll('.dart-slot.filled')).toHaveLength(0);

    // A deliberate press after the cooldown still fills as designed.
    const later = Date.now() + 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(later);
    fireEvent.click(fillBtn);
    nowSpy.mockRestore();
    expect(container.querySelectorAll('.dart-slot.filled')).toHaveLength(3);
  });

  it('Live requires a second press (armed red) to undo the last turn', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-undo2',
        gameType: '501',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg('m-undo2', [makeTurn(alice.id, [S(20), S(20), S(20)], 441)])],
      }),
    );
    render(<Live matchId="m-undo2" />);
    await screen.findAllByText('Alice');

    // First press only arms the button: it turns into a red confirm and
    // nothing is undone yet.
    fireEvent.click(screen.getByRole('button', { name: '⟲ Undo Last Turn' }));
    const armed = screen.getByRole('button', { name: 'Tap again to undo last turn' });
    expect(armed.className).toContain('danger');
    expect((await getMatch('m-undo2'))!.legs[0].turns).toHaveLength(1);

    // The second press performs the undo.
    fireEvent.click(armed);
    await waitFor(async () =>
      expect((await getMatch('m-undo2'))!.legs[0].turns).toHaveLength(0),
    );
  });

  it('Live disarms the undo confirm when another input arrives', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-undo-disarm',
        gameType: '501',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg('m-undo-disarm', [makeTurn(alice.id, [S(20), S(20), S(20)], 441)])],
      }),
    );
    render(<Live matchId="m-undo-disarm" />);
    await screen.findAllByText('Alice');

    fireEvent.click(screen.getByRole('button', { name: '⟲ Undo Last Turn' }));
    expect(screen.getByRole('button', { name: 'Tap again to undo last turn' })).toBeTruthy();

    // Entering a dart signals the player is scoring, not undoing — disarm.
    fireEvent.click(screen.getByRole('button', { name: '20' }));
    expect(screen.queryByRole('button', { name: 'Tap again to undo last turn' })).toBeNull();
    expect(screen.getByRole('button', { name: '⟲ Undo Last Turn' })).toBeTruthy();
    expect((await getMatch('m-undo-disarm'))!.legs[0].turns).toHaveLength(1);
  });

  it('LiveAtc requires a second press to undo the last turn', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'atc-undo2',
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg('atc-undo2', [makeTurn(alice.id, [atcHitDart(1)], 1)])],
      }),
    );
    render(<LiveAtc matchId="atc-undo2" />);
    await screen.findAllByText('Alice');

    fireEvent.click(screen.getByRole('button', { name: '⟲ Undo Last Turn' }));
    const armed = screen.getByRole('button', { name: 'Tap again to undo last turn' });
    expect((await getMatch('atc-undo2'))!.legs[0].turns).toHaveLength(1);

    fireEvent.click(armed);
    await waitFor(async () =>
      expect((await getMatch('atc-undo2'))!.legs[0].turns).toHaveLength(0),
    );
  });

  it('LiveTraining registers taps and advances through the bag on a hit', async () => {
    const alice = await addPlayer('Alice');
    const m = makeMatch({
      id: 't-live',
      gameType: 'Training',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('t-live', [])],
    });
    m.training = { target: 'T18', bag: ['S5'] };
    await saveMatch(m);

    render(<LiveTraining matchId="t-live" />);
    expect(await screen.findByText('T18')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'MISS ✗' }));
    await waitFor(async () =>
      expect((await getMatch('t-live'))!.legs[0].turns[0].darts).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: 'HIT ✓' }));

    await waitFor(async () => {
      const saved = await getMatch('t-live');
      expect(saved!.legs[0].turns).toHaveLength(1);
      expect(saved!.legs[0].turns[0].darts.map((d) => d.score)).toEqual([0, 1]);
      expect(saved!.training!.target).toBe('S5'); // next field dealt from the bag
    });
  });

  it('LiveTraining numpad commits typed misses on enter and flushes them on HIT', async () => {
    const alice = await addPlayer('Alice');
    const m = makeMatch({
      id: 't-pad',
      gameType: 'Training',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('t-pad', [])],
    });
    m.training = { target: 'D10', bag: ['S1'] };
    await saveMatch(m);

    render(<LiveTraining matchId="t-pad" />);
    await screen.findByText('D10');
    fireEvent.click(screen.getByRole('button', { name: 'Numpad' }));

    // Digits accumulate; ↵ commits them as misses in one save.
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('+12 misses')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '↵ Add misses' }));
    await waitFor(async () =>
      expect((await getMatch('t-pad'))!.legs[0].turns[0].darts).toHaveLength(12),
    );

    // HIT flushes any typed misses first, then the hit — one tap total.
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: /^HIT ✓ \(after \+3 misses\)/ }));
    await waitFor(async () => {
      const saved = await getMatch('t-pad');
      expect(saved!.legs[0].turns[0].darts).toHaveLength(16);
      expect(saved!.training!.target).toBe('S1');
    });
  });

  it('LiveTraining completes the round on the last field and rolls into a new bag', async () => {
    const alice = await addPlayer('Alice');
    const m = makeMatch({
      id: 't-final',
      gameType: 'Training',
      playerIds: [alice.id],
      status: 'in_progress',
      legs: [makeLeg('t-final', [])],
    });
    m.training = { target: 'S3', bag: [] }; // last field of the round
    await saveMatch(m);

    render(<LiveTraining matchId="t-final" />);
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button', { name: 'HIT ✓' }));

    await waitFor(async () => {
      const finished = await getMatch('t-final');
      expect(finished!.status).toBe('completed');
      expect(finished!.winnerId).toBe(alice.id);
    });
    // A fresh round record exists with a full new bag, and we navigated to it.
    const fresh = (await getAllMatches()).find(
      (x) => x.gameType === 'Training' && x.status === 'in_progress',
    );
    expect(fresh).toBeTruthy();
    expect(1 + fresh!.training!.bag.length).toBe(62);
    expect(location.hash).toBe(`#/live/${fresh!.id}`);
  });

  it('Setup configures Training as strictly solo with no match options', async () => {
    await addPlayer('Alice');
    await addPlayer('Bob');
    render(<Setup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Training' }));

    // No format / double-out ceremony, and the player section is singular.
    expect(screen.queryByText('Format')).toBeNull();
    expect(screen.queryByText('Double Out')).toBeNull();
    expect(screen.getByText('Player')).toBeTruthy();

    // Picking a second player replaces the first instead of adding.
    const aliceLabel = screen.getByText('Alice').closest('label')!;
    const bobLabel = screen.getByText('Bob').closest('label')!;
    fireEvent.click(aliceLabel.querySelector('input')!);
    fireEvent.click(bobLabel.querySelector('input')!);
    expect(aliceLabel.querySelector('.order-badge')).toBeNull();
    expect(bobLabel.querySelector('.order-badge')!.textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Start Training' }));
    await waitFor(async () => {
      const created = (await getAllMatches()).find((x) => x.gameType === 'Training');
      expect(created).toBeTruthy();
      expect(created!.playerIds).toHaveLength(1);
      expect(1 + created!.training!.bag.length).toBe(62);
    });
  });

  it('Live keeps the darts and shows an error when the turn save fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-savefail',
        gameType: '501',
        playerIds: [alice.id],
        status: 'in_progress',
        legs: [makeLeg('m-savefail', [])],
      }),
    );
    const { container } = render(<Live matchId="m-savefail" />);
    await screen.findByText('Alice');

    fireEvent.click(screen.getByRole('button', { name: '20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Miss Remaining (1/3)' }));

    vi.mocked(saveMatch).mockRejectedValueOnce(new Error('quota exceeded'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Turn (3/3)' }));

    // The turn is not recorded, the darts stay in the slots, and an error shows.
    await waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('not recorded'),
    );
    expect(container.querySelectorAll('.dart-slot.filled')).toHaveLength(3);
    expect((await getMatch('m-savefail'))!.legs[0].turns).toHaveLength(0);

    // Retrying with the same darts records the turn.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Turn (3/3)' }));
    await waitFor(async () =>
      expect((await getMatch('m-savefail'))!.legs[0].turns).toHaveLength(1),
    );
    errSpy.mockRestore();
  });

  it('Live surfaces a failed match load instead of a blank screen', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getMatch).mockRejectedValueOnce(new Error('idb unavailable'));
    render(<Live matchId="m-loadfail" />);

    await waitFor(() =>
      expect(document.getElementById('toast')!.textContent).toContain('Failed to load'),
    );
    expect(location.hash).toBe('#/');
    errSpy.mockRestore();
  });

  it('Live redirects a completed match to Summary by replacing the history entry', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-done',
        gameType: '501',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('m-done', [], alice.id)],
      }),
    );
    location.hash = '#/live/m-done'; // arriving on the live route pushes an entry
    const before = history.length;
    render(<Live matchId="m-done" />);

    await waitFor(() => expect(location.hash).toBe('#/summary/m-done'));
    // Replaced, not pushed — otherwise Back lands on the live route, which
    // redirects forward again and traps the Back button forever.
    expect(history.length).toBe(before);
  });

  it('LiveAtc ignores a double-tap on Confirm right after a turn is recorded', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    await saveMatch(
      makeMatch({
        id: 'atc-dtap',
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id, bob.id],
        status: 'in_progress',
        legs: [makeLeg('atc-dtap', [])],
      }),
    );
    const { container } = render(<LiveAtc matchId="atc-dtap" />);
    await screen.findByText('Alice');

    fireEvent.click(screen.getByRole('button', { name: 'HIT ✓' }));
    fireEvent.click(screen.getByRole('button', { name: 'Miss Remaining (1/3)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Turn (3/3)' }));

    const fillBtn = (await screen.findByRole('button', {
      name: 'Miss Remaining (0/3)',
    })) as HTMLButtonElement;
    await waitFor(() => expect(fillBtn.disabled).toBe(false));
    fireEvent.click(fillBtn);
    expect(container.querySelectorAll('.dart-slot.filled')).toHaveLength(0);
  });

  it('LiveAtc fills the remaining darts as misses, then confirms on the next press', async () => {
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

    // With darts still unthrown the primary button offers to miss the rest,
    // and it is enabled (no longer blocked until three are recorded).
    expect((screen.getByText('Miss Remaining (0/3)') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(hit);
    fireEvent.click(screen.getByText('HIT ✓'));

    // First press fills the third dart as a miss; a second confirms the turn.
    fireEvent.click(screen.getByText('Miss Remaining (2/3)'));
    const confirm = screen.getByText('Confirm Turn (3/3)') as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(async () => {
      const saved = await getMatch('m-atc3');
      expect(saved!.legs[0].turns).toHaveLength(1);
      // Two hits plus one auto-filled miss.
      expect(saved!.legs[0].turns[0].darts).toHaveLength(3);
      expect(saved!.legs[0].turns[0].totalScore).toBe(2);
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
    expect(screen.getAllByText('Hit % and throws to finish, per leg.')).toHaveLength(1);
    expect(screen.queryByText('Avg Darts to Clear')).toBeNull();
    expect(screen.queryByText('Darts / leg')).toBeNull();
    // With a variant selector shown, the card heading naming the active
    // variant would only repeat the highlighted chip — it's dropped.
    expect(document.querySelector('.ring-dot')).toBeNull();

    // The per-area breakdown lives in the same card and lists the variant's
    // targets with their hit rate. The single game has one hit on target 1,
    // so that row reads 100% (1/1).
    expect(screen.getByText('Average hit % per area, across every game.')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();

    // 'Any' (ring order first) is active by default; the selector switches subtype.
    expect(screen.getByRole('button', { name: 'Any' }).className).toContain('active');
    const progChip = screen.getByRole('button', { name: 'Progressive' });
    fireEvent.click(progChip);
    expect(progChip.className).toContain('active');
    expect(screen.getByRole('button', { name: 'Any' }).className).not.toContain('active');
  });

  it('PlayerStats ATC offers an All / Last-20 scope toggle past 20 games', async () => {
    const alice = await addPlayer('Alice');
    // 21 single-variant games so the recent-window toggle appears.
    for (let i = 0; i < 21; i++) {
      await saveMatch(
        makeMatch({
          id: `atc-many-${i}`,
          date: 1000 + i,
          gameType: 'AroundTheClock',
          atcRing: 'single',
          playerIds: [alice.id],
          status: 'completed',
          winnerId: alice.id,
          legs: [makeLeg(`atc-many-${i}`, [makeTurn(alice.id, [atcHitDart(1)], 1)], alice.id)],
        }),
      );
    }
    render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));

    // A single variant has no selector, so the card keeps its variant heading.
    expect(document.querySelector('.ring-dot')).toBeTruthy();

    // "All (21)" is active by default; the area subtitle reflects the full scope.
    const all = screen.getByRole('button', { name: 'All (21)' });
    const last = screen.getByRole('button', { name: 'Last 20 games' });
    expect(all.className).toContain('active');
    expect(last.className).not.toContain('active');
    expect(screen.getByText('Average hit % per area, across every game.')).toBeTruthy();

    // Switching to the recent window flips the active state and the subtitle.
    fireEvent.click(last);
    expect(last.className).toContain('active');
    expect(screen.getByRole('button', { name: 'All (21)' }).className).not.toContain('active');
    expect(screen.getByText('Average hit % per area, across the last 20 games.')).toBeTruthy();
  });

  it('PlayerStats ATC offers a solo-only scope when solo and multiplayer games mix', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    // A multiplayer game (Bob wins; Alice misses target 1) and a solo game
    // (Alice hits target 1), both single-variant.
    await saveMatch(
      makeMatch({
        id: 'atc-multi',
        date: 1000,
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id, bob.id],
        status: 'completed',
        winnerId: bob.id,
        legs: [makeLeg('atc-multi', [makeTurn(alice.id, [atcMissDart(1)], 0)], bob.id)],
      }),
    );
    await saveMatch(
      makeMatch({
        id: 'atc-solo',
        date: 2000,
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('atc-solo', [makeTurn(alice.id, [atcHitDart(1)], 1)], alice.id)],
      }),
    );
    render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));

    // Both kinds exist, so the toggle shows; all games are in scope by default.
    const solo = screen.getByRole('button', { name: 'Solo only (1)' });
    expect(screen.getByRole('button', { name: 'All games (2)' }).className).toContain('active');
    expect(screen.getByText('1/2')).toBeTruthy(); // target 1: hit in solo, missed in multi

    // Solo only drops the multiplayer game from the chart and area table.
    fireEvent.click(solo);
    expect(solo.className).toContain('active');
    expect(screen.getByText('Average hit % per area, across every solo game.')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.queryByText('1/2')).toBeNull();
  });

  it('PlayerStats remembers the ATC variant and scope toggles per player', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    // The Any variant mixes solo + multiplayer (so the solo toggle shows);
    // Progressive exists so the variant selector shows.
    await saveMatch(
      makeMatch({
        id: 'v-any-solo',
        date: 1000,
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('v-any-solo', [makeTurn(alice.id, [atcHitDart(1)], 1)], alice.id)],
      }),
    );
    await saveMatch(
      makeMatch({
        id: 'v-any-multi',
        date: 2000,
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id, bob.id],
        status: 'completed',
        winnerId: bob.id,
        legs: [makeLeg('v-any-multi', [makeTurn(alice.id, [atcMissDart(1)], 0)], bob.id)],
      }),
    );
    await saveMatch(
      makeMatch({
        id: 'v-prog',
        date: 3000,
        gameType: 'AroundTheClock',
        atcRing: 'progressive',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [makeLeg('v-prog', [makeTurn(alice.id, [atcHitDart(1)], 1)], alice.id)],
      }),
    );

    render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));
    fireEvent.click(screen.getByRole('button', { name: 'Solo only (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Progressive' }));
    cleanup();

    // A fresh mount restores the tab, the variant, and the scope toggle.
    render(<PlayerStats playerId={alice.id} />);
    const prog = await screen.findByRole('button', { name: 'Progressive' });
    expect(prog.className).toContain('active');
    fireEvent.click(screen.getByRole('button', { name: 'Any' }));
    expect(screen.getByRole('button', { name: 'Solo only (1)' }).className).toContain('active');
  });

  it('Setup remembers the last-used match configuration', async () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole('button', { name: '301' }));
    fireEvent.click(screen.getByRole('button', { name: 'Best of 3' }));
    cleanup();

    render(<Setup />);
    expect(screen.getByRole('button', { name: '301' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Best of 3' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('PlayerStats Training tab shows round stats and the per-field matrix', async () => {
    const alice = await addPlayer('Alice');
    // One completed round's worth of data: T20 in two darts, Outer first dart.
    await saveMatch(
      makeMatch({
        id: 't-stats',
        date: 7000,
        gameType: 'Training',
        playerIds: [alice.id],
        winnerId: alice.id,
        status: 'completed',
        legs: [
          makeLeg('t-stats', [
            makeTurn(alice.id, [dart(0, '✗T20'), dart(1, '✓T20')], 0),
            makeTurn(alice.id, [dart(1, '✓Outer')], 0),
          ]),
        ],
      }),
    );
    render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Training' }));

    expect(await screen.findByText('Hit % Per Field')).toBeTruthy();
    // Matrix: T20 hit 1/2 → 50%; the bull row's single column is the outer.
    expect(screen.getByTitle('1/2').textContent).toBe('50%');
    expect(screen.getByTitle('1/1').textContent).toBe('100%');
    // The 3-dart round is the dated best round.
    expect(screen.getByText(/Best Round \(darts\)/).previousElementSibling!.textContent).toBe('3');
  });

  it('PlayerStats charts expand into a fullscreen viewer and close on Escape', async () => {
    const alice = await addPlayer('Alice');
    await saveMatch(
      makeMatch({
        id: 'm-chart',
        gameType: '501',
        playerIds: [alice.id],
        winnerId: alice.id,
        legs: [makeLeg('m-chart', [makeTurn(alice.id, [S(20), S(20), S(20)], 441)], alice.id)],
      }),
    );
    render(<PlayerStats playerId={alice.id} />);

    const expand = await screen.findByRole('button', { name: 'Expand Average Per Match chart' });
    expand.focus(); // jsdom doesn't focus on click; real browsers do
    fireEvent.click(expand);

    // Fullscreen dialog opens with focus on its close button.
    const dialog = screen.getByRole('dialog', { name: 'Average Per Match chart' });
    const close = screen.getByRole('button', { name: 'Close chart' });
    expect(document.activeElement).toBe(close);

    // Escape dismisses and focus returns to the expand button.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(expand);
  });

  it('PlayerStats ATC shows a direction-aware trend row once enough legs exist', async () => {
    const alice = await addPlayer('Alice');
    // Six single-variant games: three all-miss legs, then three all-hit legs
    // → hit % trend is +100 over last-3-vs-previous-3 and reads as improving.
    for (let i = 0; i < 6; i++) {
      const dart = i < 3 ? atcMissDart(1) : atcHitDart(1);
      await saveMatch(
        makeMatch({
          id: `atc-trend-${i}`,
          date: 1000 + i,
          gameType: 'AroundTheClock',
          atcRing: 'single',
          playerIds: [alice.id],
          status: 'completed',
          winnerId: alice.id,
          legs: [makeLeg(`atc-trend-${i}`, [makeTurn(alice.id, [dart], dart.score)])],
        }),
      );
    }
    const { container } = render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));

    const hitCell = screen.getByText('Hit % · last 3 vs prev 3').previousElementSibling!;
    expect(hitCell.textContent).toBe('+100.0%');
    expect(hitCell.className).toContain('good');
    // No cleared legs → no darts-per-leg trend, shown as an em dash.
    expect(screen.getByText('Darts / leg trend')).toBeTruthy();
    // The area table gains the ± improvement column.
    expect(container.querySelector('.area-table .trend')).toBeTruthy();
  });

  it('PlayerStats ATC area table sorts by area and hit %, both directions', async () => {
    const alice = await addPlayer('Alice');
    // One single-variant game whose targets have distinct hit rates so numeric
    // order and hit-rate order differ: 1 → 50%, 2 → 100%, 3 → 0%.
    await saveMatch(
      makeMatch({
        id: 'atc-sort',
        gameType: 'AroundTheClock',
        atcRing: 'single',
        playerIds: [alice.id],
        status: 'completed',
        winnerId: alice.id,
        legs: [
          makeLeg(
            'atc-sort',
            [
              makeTurn(alice.id, [atcMissDart(1), atcHitDart(1), atcHitDart(2)], 2),
              makeTurn(alice.id, [atcMissDart(3), atcMissDart(3)], 2),
            ],
            alice.id,
          ),
        ],
      }),
    );
    const { container } = render(<PlayerStats playerId={alice.id} />);
    fireEvent.click(await screen.findByText('Around the Clock'));

    const areaOrder = () =>
      Array.from(container.querySelectorAll('.area-name')).map((el) => el.textContent);

    // Default: Area ascending — the targets follow sequence order.
    expect(areaOrder().slice(0, 3)).toEqual(['1', '2', '3']);

    // Hit % sorts highest-first on the first click, lowest-first on the second.
    fireEvent.click(screen.getByRole('button', { name: 'Hit %' }));
    expect(areaOrder().slice(0, 3)).toEqual(['2', '1', '3']);
    fireEvent.click(screen.getByRole('button', { name: /^Hit %/ }));
    expect(areaOrder().slice(0, 3)).toEqual(['3', '1', '2']);

    // Area sorts back to sequence, then reverses on a second click.
    fireEvent.click(screen.getByRole('button', { name: 'Area' }));
    expect(areaOrder().slice(0, 3)).toEqual(['1', '2', '3']);
    fireEvent.click(screen.getByRole('button', { name: /^Area/ }));
    expect(areaOrder().slice(0, 3)).toEqual(['3', '2', '1']);
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
