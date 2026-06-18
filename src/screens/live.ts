import { el, mount, toast, confirmDialog } from '../ui';
import { navigate } from '../router';
import { getMatch, getPlayers, saveMatch } from '../db';
import { startingScore, evaluateTurn, isBust, isWinningTurn } from '../scoring';
import type { Match, Leg, Turn, DartThrow, Player } from '../types';

interface LiveState {
  match: Match;
  playerNames: Map<string, string>;
  currentDarts: DartThrow[];
}

function startScore(match: Match): number {
  return startingScore(match.gameType === '301' ? '301' : '501');
}

function legsToWin(match: Match): number {
  return Math.floor(match.format.legs / 2) + 1;
}

/** The active (last, not-yet-won) leg. */
function activeLeg(match: Match): Leg {
  return match.legs[match.legs.length - 1];
}

/** Remaining score for each player in the given leg. */
function legRemaining(match: Match, leg: Leg): Map<string, number> {
  const start = startScore(match);
  const remaining = new Map<string, number>();
  for (const id of match.playerIds) remaining.set(id, start);
  for (const turn of leg.turns) {
    remaining.set(turn.playerId, turn.remainingScore);
  }
  return remaining;
}

/** Legs won by each player across the match. */
function legsWonBy(match: Match): Map<string, number> {
  const won = new Map<string, number>();
  for (const id of match.playerIds) won.set(id, 0);
  for (const leg of match.legs) {
    if (leg.winnerId) won.set(leg.winnerId, (won.get(leg.winnerId) ?? 0) + 1);
  }
  return won;
}

/** Whose turn it is in the active leg (alternating starter per leg). */
function currentPlayerId(match: Match): string {
  const leg = activeLeg(match);
  const n = match.playerIds.length;
  const legIndex = match.legs.length - 1;
  const starter = legIndex % n;
  const idx = (starter + leg.turns.length) % n;
  return match.playerIds[idx];
}

export async function renderLive(root: HTMLElement, matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) {
    toast('Match not found', 'error');
    navigate('/');
    return;
  }
  if (match.status === 'completed') {
    navigate(`/summary/${matchId}`);
    return;
  }

  const players = await getPlayers();
  const playerNames = new Map<string, string>(
    players.map((p: Player) => [p.id, p.name]),
  );
  // Fallback names for any deleted players still referenced.
  for (const id of match.playerIds) {
    if (!playerNames.has(id)) playerNames.set(id, 'Unknown');
  }

  const state: LiveState = { match, playerNames, currentDarts: [] };

  render(root, state);
}

function render(root: HTMLElement, state: LiveState): void {
  const { match, playerNames, currentDarts } = state;
  const leg = activeLeg(match);
  const remaining = legRemaining(match, leg);
  const won = legsWonBy(match);
  const turnPlayer = currentPlayerId(match);
  const startRemaining = remaining.get(turnPlayer)!;

  const outcome = evaluateTurn(startRemaining, currentDarts, match.doubleOut);
  const turnTotal = currentDarts.reduce((a, d) => a + d.score, 0);
  const projected = startRemaining - turnTotal;

  // ---- Scoreboard ----
  const scoreCards = match.playerIds.map((id) => {
    const isTurn = id === turnPlayer;
    const rem = remaining.get(id)!;
    const displayRem = isTurn && outcome !== 'bust' ? projected : rem;
    return el(
      'div',
      { class: `score-card ${isTurn ? 'active' : ''}` },
      [
        el('div', { class: 'sc-top' }, [
          el('span', { class: 'sc-name' }, [playerNames.get(id) ?? '?']),
          el('span', { class: 'sc-legs' }, [`${won.get(id) ?? 0} ${match.legs.length > 1 || match.format.legs > 1 ? 'legs' : 'leg'}`]),
        ]),
        el('div', { class: 'sc-remaining' }, [String(displayRem)]),
        isTurn && currentDarts.length > 0
          ? el('div', { class: 'sc-pending' }, [
              `${turnTotal} this turn`,
            ])
          : null,
      ],
    );
  });

  // ---- Current darts display ----
  const dartSlots = [0, 1, 2].map((i) => {
    const dart = currentDarts[i];
    return el('div', { class: `dart-slot ${dart ? 'filled' : ''}` }, [
      dart ? dart.label : '–',
    ]);
  });

  // ---- Status banner ----
  let banner: HTMLElement | null = null;
  if (outcome === 'bust') {
    banner = el('div', { class: 'banner bust' }, ['BUST — confirm to end turn']);
  } else if (outcome === 'win') {
    banner = el('div', { class: 'banner win' }, [
      `${playerNames.get(turnPlayer)} checks out! Confirm to win the leg.`,
    ]);
  }

  // ---- Numpad ----
  const multiplierState = { value: 1 as 1 | 2 | 3 };
  const inputLocked = currentDarts.length >= 3 || outcome === 'bust' || outcome === 'win';

  const multButtons = ([
    [1, 'Single'],
    [2, 'Double'],
    [3, 'Treble'],
  ] as [1 | 2 | 3, string][]).map(([val, label]) =>
    el(
      'button',
      {
        class: `mult-btn ${val === multiplierState.value ? 'active' : ''}`,
        onClick: () => {
          multiplierState.value = val;
          multButtons.forEach((b, i) =>
            b.classList.toggle('active', ([1, 2, 3] as const)[i] === val),
          );
        },
      },
      [label],
    ),
  );

  function addDart(base: number, isBull: boolean): void {
    if (currentDarts.length >= 3) return;
    const mult = multiplierState.value;
    let score: number;
    let label: string;
    let isDouble: boolean;

    if (isBull) {
      if (mult === 3) {
        toast('No treble bull', 'error');
        return;
      }
      if (mult === 2) {
        score = 50;
        label = 'DB';
        isDouble = true;
      } else {
        score = 25;
        label = 'Bull';
        isDouble = false;
      }
    } else if (base === 0) {
      score = 0;
      label = 'Miss';
      isDouble = false;
    } else {
      score = base * mult;
      isDouble = mult === 2;
      const prefix = mult === 2 ? 'D' : mult === 3 ? 'T' : '';
      label = `${prefix}${base}`;
    }

    currentDarts.push({ score, label, isDouble });
    render(root, state);
  }

  const numberButtons = [];
  for (let n = 1; n <= 20; n++) {
    numberButtons.push(
      el(
        'button',
        {
          class: 'num-btn',
          disabled: inputLocked,
          onClick: () => addDart(n, false),
        },
        [String(n)],
      ),
    );
  }

  const specialButtons = el('div', { class: 'special-row' }, [
    el(
      'button',
      {
        class: 'num-btn wide bull',
        disabled: inputLocked,
        onClick: () => addDart(25, true),
      },
      ['Bull (25/50)'],
    ),
    el(
      'button',
      {
        class: 'num-btn wide miss',
        disabled: inputLocked,
        onClick: () => addDart(0, false),
      },
      ['Miss'],
    ),
  ]);

  // ---- Action buttons ----
  function undoLastDart(): void {
    if (currentDarts.length === 0) return;
    currentDarts.pop();
    render(root, state);
  }

  async function confirmTurn(): Promise<void> {
    if (currentDarts.length === 0) {
      toast('Throw at least one dart', 'error');
      return;
    }
    const bust = isBust(startRemaining, currentDarts, match.doubleOut);
    const win = isWinningTurn(startRemaining, currentDarts, match.doubleOut);
    const total = currentDarts.reduce((a, d) => a + d.score, 0);
    const newRemaining = bust ? startRemaining : startRemaining - total;

    const turn: Turn = {
      playerId: turnPlayer,
      darts: [...currentDarts],
      totalScore: total,
      remainingScore: newRemaining,
      isBust: bust,
      timestamp: Date.now(),
    };
    leg.turns.push(turn);
    state.currentDarts = [];

    if (win) {
      leg.winnerId = turnPlayer;
      const wonCounts = legsWonBy(match);
      if ((wonCounts.get(turnPlayer) ?? 0) >= legsToWin(match)) {
        match.winnerId = turnPlayer;
        match.status = 'completed';
        await saveMatch(match);
        toast(`${playerNames.get(turnPlayer)} wins the match!`);
        navigate(`/summary/${match.id}`);
        return;
      }
      // Start next leg.
      match.legs.push({
        id: cryptoId(),
        matchId: match.id,
        winnerId: null,
        turns: [],
      });
      await saveMatch(match);
      toast(`${playerNames.get(turnPlayer)} wins the leg!`);
      render(root, state);
      return;
    }

    await saveMatch(match);
    if (bust) toast('Bust!');
    render(root, state);
  }

  async function undoLastTurn(): Promise<void> {
    // Drop trailing empty legs (a freshly started next leg).
    while (match.legs.length > 1 && activeLeg(match).turns.length === 0) {
      match.legs.pop();
    }
    const leg2 = activeLeg(match);
    if (leg2.turns.length === 0) {
      toast('Nothing to undo', 'error');
      return;
    }
    leg2.turns.pop();
    leg2.winnerId = null;
    match.winnerId = null;
    match.status = 'in_progress';
    state.currentDarts = [];
    await saveMatch(match);
    toast('Last turn undone');
    render(root, state);
  }

  const confirmLabel =
    outcome === 'win' ? 'Confirm Win' : outcome === 'bust' ? 'Confirm Bust' : 'Confirm Turn';

  const actions = el('div', { class: 'live-actions' }, [
    el(
      'button',
      {
        class: 'btn',
        disabled: currentDarts.length === 0,
        onClick: undoLastDart,
      },
      ['↶ Undo Dart'],
    ),
    el(
      'button',
      {
        class: `btn primary ${outcome === 'bust' ? 'danger' : outcome === 'win' ? 'success' : ''}`,
        disabled: currentDarts.length === 0,
        onClick: confirmTurn,
      },
      [confirmLabel],
    ),
  ]);

  // ---- Turn log ----
  const logEntries: HTMLElement[] = [];
  const allTurns: { turn: Turn; legIndex: number }[] = [];
  match.legs.forEach((l, li) => l.turns.forEach((t) => allTurns.push({ turn: t, legIndex: li })));
  allTurns
    .slice(-8)
    .reverse()
    .forEach(({ turn, legIndex }) => {
      logEntries.push(
        el('li', { class: `log-row ${turn.isBust ? 'bust' : ''}` }, [
          el('span', { class: 'log-player' }, [playerNames.get(turn.playerId) ?? '?']),
          el('span', { class: 'log-darts' }, [
            turn.darts.map((d) => d.label).join(' · '),
          ]),
          el('span', { class: 'log-score' }, [
            turn.isBust ? 'BUST' : `${turn.totalScore}`,
          ]),
          el('span', { class: 'log-remaining' }, [`→ ${turn.remainingScore}`]),
          match.format.legs > 1 ? el('span', { class: 'log-leg' }, [`L${legIndex + 1}`]) : null,
        ]),
      );
    });

  const quitBtn = el(
    'button',
    {
      class: 'icon-btn',
      'aria-label': 'Quit',
      onClick: () => {
        if (confirmDialog('Leave match? Progress is saved and resumable from History.')) {
          navigate('/');
        }
      },
    },
    ['‹'],
  );

  mount(
    root,
    el('div', { class: 'screen live' }, [
      el('header', { class: 'screen-header' }, [
        quitBtn,
        el('h1', { class: 'screen-title' }, [
          `${match.gameType}  ·  Leg ${match.legs.length}/${match.format.legs}`,
        ]),
      ]),
      el('div', { class: 'scoreboard' }, scoreCards),
      banner,
      el('div', { class: 'dart-slots' }, dartSlots),
      actions,
      el('section', { class: 'numpad' }, [
        el('div', { class: 'mult-row' }, multButtons),
        el('div', { class: 'num-grid' }, numberButtons),
        specialButtons,
      ]),
      el('div', { class: 'undo-turn-row' }, [
        el('button', { class: 'btn ghost', onClick: undoLastTurn }, [
          '⟲ Undo Last Turn',
        ]),
      ]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Turn Log']),
        el('ul', { class: 'turn-log' }, logEntries.length ? logEntries : [
          el('li', { class: 'empty' }, ['No turns yet']),
        ]),
      ]),
    ]),
  );
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `leg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
