import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { toast, confirmDialog } from '../toast';
import { getMatch, getPlayers, saveMatch, uuid } from '../db';
import {
  ATC_SEQUENCE,
  ATC_TARGET_COUNT,
  atcProgress,
  atcProgressiveSteps,
  atcTargetLabel,
  atcRingLabel,
} from '../atc';
import type { Match, Leg, Turn, DartThrow, Player, AtcRing } from '../types';

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
function currentPlayerId(match: Match): string {
  const leg = activeLeg(match);
  const n = match.playerIds.length;
  const starter = (match.legs.length - 1) % n;
  return match.playerIds[(starter + leg.turns.length) % n];
}
function hitsIn(darts: DartThrow[]): number {
  return darts.reduce((acc, d) => acc + d.score, 0);
}
function dartLabel(target: number, steps: number, ring: AtcRing): string {
  if (steps === 0) return `✗${atcTargetLabel(target, ring)}`;
  if (ring === 'progressive') {
    if (target === 25) return steps === 2 ? 'DB' : 'Bull';
    const prefix = steps === 2 ? 'D' : steps === 3 ? 'T' : '';
    return `${prefix}${target}`;
  }
  return `✓${atcTargetLabel(target, ring)}`;
}

export function LiveAtc({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [currentDarts, setCurrentDarts] = useState<DartThrow[]>([]);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const m = await getMatch(matchId);
      if (!active) return;
      if (!m) {
        toast('Match not found', 'error');
        navigate('/');
        return;
      }
      if (m.status === 'completed') {
        navigate(`/summary/${matchId}`);
        return;
      }
      const players = await getPlayers();
      const map = new Map<string, string>(players.map((p: Player) => [p.id, p.name]));
      for (const id of m.playerIds) if (!map.has(id)) map.set(id, 'Unknown');
      if (!active) return;
      setNames(map);
      setMatch(m);
    })();
    return () => {
      active = false;
    };
  }, [matchId]);

  if (!match) return <div className="screen" />;

  const ring = match.atcRing ?? 'single';
  const leg = activeLeg(match);
  const won = legsWonBy(match);
  const turnPlayer = currentPlayerId(match);
  const startProgress = atcProgress(leg, turnPlayer);
  const liveProgress = Math.min(startProgress + hitsIn(currentDarts), ATC_TARGET_COUNT);
  const hasWon = liveProgress >= ATC_TARGET_COUNT;
  const inputLocked = currentDarts.length >= 3 || hasWon;
  const currentTargetNum = ATC_SEQUENCE[Math.min(liveProgress, ATC_TARGET_COUNT - 1)];
  // The bull only has an outer (25) and inner/double (50) — no treble — so the
  // +3 button is disabled once the target reaches the bull.
  const onBull = !hasWon && currentTargetNum === 25;
  const nameOf = (id: string) => names.get(id) ?? '?';

  function addStep(steps: number) {
    if (inputLocked) return;
    const progressNow = Math.min(startProgress + hitsIn(currentDarts), ATC_TARGET_COUNT);
    if (progressNow >= ATC_TARGET_COUNT) return;
    const target = ATC_SEQUENCE[progressNow];
    // Progressive: a numbered hit can't carry you past the bull — the label
    // still shows the ring actually hit (e.g. "T19"), but progress is capped so
    // the bull must be hit to finish.
    const score = ring === 'progressive' ? atcProgressiveSteps(progressNow, steps) : steps;
    setCurrentDarts((d) => [...d, { score, label: dartLabel(target, steps, ring), isDouble: false }]);
  }

  async function confirmTurn() {
    if (!match) return;
    // A turn is three darts. The only exception is clearing the board early —
    // then the win can be confirmed without filling the remaining slots.
    if (!hasWon && currentDarts.length < 3) {
      toast('Throw all 3 darts to finish the turn', 'error');
      return;
    }
    if (submitting.current) return; // guard against double-tap recording the turn twice
    submitting.current = true;
    try {
      const hits = hitsIn(currentDarts);
      const newProgress = Math.min(startProgress + hits, ATC_TARGET_COUNT);
      const next = structuredClone(match);
      const nextLeg = activeLeg(next);
      nextLeg.turns.push({
        playerId: turnPlayer,
        darts: [...currentDarts],
        totalScore: hits,
        remainingScore: newProgress,
        isBust: false,
        timestamp: Date.now(),
      } satisfies Turn);
      setCurrentDarts([]);

      if (newProgress >= ATC_TARGET_COUNT) {
        nextLeg.winnerId = turnPlayer;
        if ((legsWonBy(next).get(turnPlayer) ?? 0) >= legsToWin(next)) {
          next.winnerId = turnPlayer;
          next.status = 'completed';
          await saveMatch(next);
          toast(`${nameOf(turnPlayer)} wins the match!`);
          navigate(`/summary/${next.id}`);
          return;
        }
        next.legs.push({ id: uuid(), matchId: next.id, winnerId: null, turns: [] });
        await saveMatch(next);
        toast(`${nameOf(turnPlayer)} wins the leg!`);
        setMatch(next);
        return;
      }
      await saveMatch(next);
      setMatch(next);
    } finally {
      submitting.current = false;
    }
  }

  async function undoLastTurn() {
    if (!match) return;
    const next = structuredClone(match);
    while (next.legs.length > 1 && activeLeg(next).turns.length === 0) next.legs.pop();
    const lastLeg = activeLeg(next);
    if (lastLeg.turns.length === 0) {
      toast('Nothing to undo', 'error');
      return;
    }
    lastLeg.turns.pop();
    lastLeg.winnerId = null;
    next.winnerId = null;
    next.status = 'in_progress';
    setCurrentDarts([]);
    await saveMatch(next);
    toast('Last turn undone');
    setMatch(next);
  }

  const allTurns: { turn: Turn; legIndex: number }[] = [];
  match.legs.forEach((l, li) => l.turns.forEach((t) => allTurns.push({ turn: t, legIndex: li })));

  return (
    <div className="screen live">
      <header className="screen-header">
        <button
          className="icon-btn"
          aria-label="Quit"
          onClick={() =>
            confirmDialog('Leave match? Progress is saved and resumable from History.') &&
            navigate('/')
          }
        >
          ‹
        </button>
        <h1 className="screen-title">
          Around the Clock · {atcRingLabel(ring)} · Leg {match.legs.length}/{match.format.legs}
        </h1>
      </header>

      <div className="scoreboard">
        {match.playerIds.map((id) => {
          const isTurn = id === turnPlayer;
          const progress = isTurn ? liveProgress : atcProgress(leg, id);
          const done = progress >= ATC_TARGET_COUNT;
          return (
            <div className={`score-card ${isTurn ? 'active' : ''}`} key={id}>
              <div className="sc-top">
                <span className="sc-name">{nameOf(id)}</span>
                <span className="sc-legs">{won.get(id) ?? 0}</span>
              </div>
              <div className="sc-target">{done ? '✓ Done' : atcTargetLabel(ATC_SEQUENCE[progress], ring)}</div>
              <div className="atc-progress">
                <div className="atc-progress-fill" style={{ width: `${(progress / ATC_TARGET_COUNT) * 100}%` }} />
              </div>
              <div className="sc-pending">
                {progress}/{ATC_TARGET_COUNT}
              </div>
            </div>
          );
        })}
      </div>

      {hasWon && (
        <div className="banner win">{nameOf(turnPlayer)} clears the board! Confirm to win the leg.</div>
      )}

      <div className="atc-aim">
        {nameOf(turnPlayer)} — aim for{' '}
        <strong>{hasWon ? '—' : atcTargetLabel(currentTargetNum, ring)}</strong>
        {ring === 'progressive' && <span className="atc-hint"> · double +2 · treble +3</span>}
      </div>

      <div className="dart-slots">
        {[0, 1, 2].map((i) => {
          const dart = currentDarts[i];
          return (
            <div className={`dart-slot ${dart ? (dart.score ? 'filled hit' : 'filled miss') : ''}`} key={i}>
              {dart ? dart.label : '–'}
            </div>
          );
        })}
      </div>

      {ring === 'progressive' ? (
        <div className="atc-prog-actions">
          <button className="btn hit-btn" disabled={inputLocked} onClick={() => addStep(1)}>
            Hit +1
          </button>
          <button className="btn hit-btn" disabled={inputLocked} onClick={() => addStep(2)}>
            Double +2
          </button>
          <button className="btn hit-btn" disabled={inputLocked || onBull} onClick={() => addStep(3)}>
            Treble +3
          </button>
          <button className="btn miss-btn" disabled={inputLocked} onClick={() => addStep(0)}>
            Miss ✗
          </button>
        </div>
      ) : (
        <div className="live-actions">
          <button className="btn hit-btn" disabled={inputLocked} onClick={() => addStep(1)}>
            HIT ✓
          </button>
          <button className="btn miss-btn" disabled={inputLocked} onClick={() => addStep(0)}>
            MISS ✗
          </button>
        </div>
      )}

      <div className="live-actions">
        <button className="btn" disabled={currentDarts.length === 0} onClick={() => setCurrentDarts((d) => d.slice(0, -1))}>
          ↶ Undo Dart
        </button>
        <button
          className={`btn primary ${hasWon ? 'success' : ''}`}
          disabled={!hasWon && currentDarts.length < 3}
          onClick={confirmTurn}
        >
          {hasWon ? 'Confirm Win' : `Confirm Turn (${currentDarts.length}/3)`}
        </button>
      </div>

      <div className="undo-turn-row">
        <button className="btn ghost" onClick={undoLastTurn}>
          ⟲ Undo Last Turn
        </button>
      </div>

      <section className="card">
        <h2 className="card-title">Turn Log</h2>
        <ul className="turn-log">
          {allTurns.length === 0 ? (
            <li className="empty">No turns yet</li>
          ) : (
            allTurns
              .slice(-8)
              .reverse()
              .map(({ turn, legIndex }, i) => (
                <li className="log-row" key={i}>
                  <span className="log-player">{nameOf(turn.playerId)}</span>
                  <span className="log-darts">{turn.darts.map((d) => d.label).join(' · ')}</span>
                  <span className="log-score">+{turn.totalScore}</span>
                  <span className="log-remaining">
                    → {turn.remainingScore}/{ATC_TARGET_COUNT}
                  </span>
                  {match.format.legs > 1 && <span className="log-leg">L{legIndex + 1}</span>}
                </li>
              ))
          )}
        </ul>
      </section>
    </div>
  );
}
