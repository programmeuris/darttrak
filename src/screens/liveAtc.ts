import { el, mount, toast, confirmDialog } from '../ui';
import { navigate } from '../router';
import { getMatch, getPlayers, saveMatch } from '../db';
import {
  ATC_SEQUENCE,
  ATC_TARGET_COUNT,
  atcProgress,
  atcTargetLabel,
  atcRingLabel,
} from '../atc';
import type { Match, Leg, Turn, DartThrow, Player, AtcRing } from '../types';

interface AtcState {
  match: Match;
  ring: AtcRing;
  playerNames: Map<string, string>;
  currentDarts: DartThrow[]; // score 1 = hit, 0 = miss
}

function legsToWin(match: Match): number {
  return Math.floor(match.format.legs / 2) + 1;
}

function activeLeg(match: Match): Leg {
  return match.legs[match.legs.length - 1];
}

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
  const starter = (match.legs.length - 1) % n;
  return match.playerIds[(starter + leg.turns.length) % n];
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `leg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function renderLiveAtc(root: HTMLElement, matchId: string): Promise<void> {
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
  for (const id of match.playerIds) {
    if (!playerNames.has(id)) playerNames.set(id, 'Unknown');
  }

  const state: AtcState = {
    match,
    ring: match.atcRing ?? 'single',
    playerNames,
    currentDarts: [],
  };
  render(root, state);
}

function hitsIn(darts: DartThrow[]): number {
  return darts.reduce((acc, d) => acc + d.score, 0);
}

function render(root: HTMLElement, state: AtcState): void {
  const { match, ring, playerNames, currentDarts } = state;
  const leg = activeLeg(match);
  const won = legsWonBy(match);
  const turnPlayer = currentPlayerId(match);
  const startProgress = atcProgress(leg, turnPlayer);
  const hitsSoFar = hitsIn(currentDarts);
  const liveProgress = Math.min(startProgress + hitsSoFar, ATC_TARGET_COUNT);
  const hasWon = liveProgress >= ATC_TARGET_COUNT;

  // ---- Scoreboard ----
  const scoreCards = match.playerIds.map((id) => {
    const isTurn = id === turnPlayer;
    const progress = isTurn ? liveProgress : atcProgress(leg, id);
    const done = progress >= ATC_TARGET_COUNT;
    const targetLabel = done
      ? '✓ Done'
      : atcTargetLabel(ATC_SEQUENCE[progress], ring);
    return el('div', { class: `score-card ${isTurn ? 'active' : ''}` }, [
      el('div', { class: 'sc-top' }, [
        el('span', { class: 'sc-name' }, [playerNames.get(id) ?? '?']),
        el('span', { class: 'sc-legs' }, [`${won.get(id) ?? 0}`]),
      ]),
      el('div', { class: 'sc-target' }, [targetLabel]),
      el('div', { class: 'atc-progress' }, [
        el('div', {
          class: 'atc-progress-fill',
          style: `width:${(progress / ATC_TARGET_COUNT) * 100}%`,
        }),
      ]),
      el('div', { class: 'sc-pending' }, [`${progress}/${ATC_TARGET_COUNT}`]),
    ]);
  });

  // ---- Banner ----
  const banner = hasWon
    ? el('div', { class: 'banner win' }, [
        `${playerNames.get(turnPlayer)} clears the board! Confirm to win the leg.`,
      ])
    : null;

  // ---- Current dart slots ----
  const dartSlots = [0, 1, 2].map((i) => {
    const dart = currentDarts[i];
    return el(
      'div',
      {
        class: `dart-slot ${dart ? (dart.score ? 'filled hit' : 'filled miss') : ''}`,
      },
      [dart ? dart.label : '–'],
    );
  });

  const inputLocked = currentDarts.length >= 3 || hasWon;
  const currentTargetNum = ATC_SEQUENCE[Math.min(liveProgress, ATC_TARGET_COUNT - 1)];
  const currentTargetLabel = hasWon ? '—' : atcTargetLabel(currentTargetNum, ring);

  function addDart(isHit: boolean): void {
    if (inputLocked) return;
    const progressNow = Math.min(startProgress + hitsIn(currentDarts), ATC_TARGET_COUNT);
    if (progressNow >= ATC_TARGET_COUNT) return;
    const target = ATC_SEQUENCE[progressNow];
    const label = `${isHit ? '✓' : '✗'}${atcTargetLabel(target, ring)}`;
    currentDarts.push({ score: isHit ? 1 : 0, label, isDouble: false });
    render(root, state);
  }

  function undoLastDart(): void {
    if (currentDarts.length === 0) return;
    currentDarts.pop();
    render(root, state);
  }

  async function confirmTurn(): Promise<void> {
    if (currentDarts.length === 0) {
      toast('Record at least one dart', 'error');
      return;
    }
    const hits = hitsIn(currentDarts);
    const newProgress = Math.min(startProgress + hits, ATC_TARGET_COUNT);
    const turn: Turn = {
      playerId: turnPlayer,
      darts: [...currentDarts],
      totalScore: hits,
      remainingScore: newProgress,
      isBust: false,
      timestamp: Date.now(),
    };
    leg.turns.push(turn);
    state.currentDarts = [];

    if (newProgress >= ATC_TARGET_COUNT) {
      leg.winnerId = turnPlayer;
      if ((legsWonBy(match).get(turnPlayer) ?? 0) >= legsToWin(match)) {
        match.winnerId = turnPlayer;
        match.status = 'completed';
        await saveMatch(match);
        toast(`${playerNames.get(turnPlayer)} wins the match!`);
        navigate(`/summary/${match.id}`);
        return;
      }
      match.legs.push({ id: cryptoId(), matchId: match.id, winnerId: null, turns: [] });
      await saveMatch(match);
      toast(`${playerNames.get(turnPlayer)} wins the leg!`);
      render(root, state);
      return;
    }

    await saveMatch(match);
    render(root, state);
  }

  async function undoLastTurn(): Promise<void> {
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

  // ---- Turn log ----
  const allTurns: { turn: Turn; legIndex: number }[] = [];
  match.legs.forEach((l, li) => l.turns.forEach((t) => allTurns.push({ turn: t, legIndex: li })));
  const logEntries = allTurns
    .slice(-8)
    .reverse()
    .map(({ turn, legIndex }) =>
      el('li', { class: 'log-row' }, [
        el('span', { class: 'log-player' }, [playerNames.get(turn.playerId) ?? '?']),
        el('span', { class: 'log-darts' }, [turn.darts.map((d) => d.label).join(' · ')]),
        el('span', { class: 'log-score' }, [`+${turn.totalScore}`]),
        el('span', { class: 'log-remaining' }, [`→ ${turn.remainingScore}/${ATC_TARGET_COUNT}`]),
        match.format.legs > 1 ? el('span', { class: 'log-leg' }, [`L${legIndex + 1}`]) : null,
      ]),
    );

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
          `Around the Clock · ${atcRingLabel(ring)} · Leg ${match.legs.length}/${match.format.legs}`,
        ]),
      ]),
      el('div', { class: 'scoreboard' }, scoreCards),
      banner,
      el('div', { class: 'atc-aim' }, [
        `${playerNames.get(turnPlayer)} — aim for `,
        el('strong', {}, [currentTargetLabel]),
      ]),
      el('div', { class: 'dart-slots' }, dartSlots),
      el('div', { class: 'live-actions' }, [
        el(
          'button',
          { class: 'btn hit-btn', disabled: inputLocked, onClick: () => addDart(true) },
          ['HIT ✓'],
        ),
        el(
          'button',
          { class: 'btn miss-btn', disabled: inputLocked, onClick: () => addDart(false) },
          ['MISS ✗'],
        ),
      ]),
      el('div', { class: 'live-actions' }, [
        el(
          'button',
          { class: 'btn', disabled: currentDarts.length === 0, onClick: undoLastDart },
          ['↶ Undo Dart'],
        ),
        el(
          'button',
          {
            class: `btn primary ${hasWon ? 'success' : ''}`,
            disabled: currentDarts.length === 0,
            onClick: confirmTurn,
          },
          [hasWon ? 'Confirm Win' : 'Confirm Turn'],
        ),
      ]),
      el('div', { class: 'undo-turn-row' }, [
        el('button', { class: 'btn ghost', onClick: undoLastTurn }, ['⟲ Undo Last Turn']),
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
