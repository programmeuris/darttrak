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
    if (target === 25) return steps === 2 ? 'Bull' : 'Outer';
    const prefix = steps === 2 ? 'D' : steps === 3 ? 'T' : '';
    return `${prefix}${target}`;
  }
  return `✓${atcTargetLabel(target, ring)}`;
}

// Ignore fill-presses on Confirm this soon after a turn was recorded: a
// double-tap's second hit lands well inside this window, and without it that
// hit would start pre-filling the NEXT player's darts as misses.
const FILL_COOLDOWN_MS = 400;
// How long the Undo Last Turn button stays armed after its first press before
// reverting — long enough to read the red confirm state, short enough that a
// stray tap doesn't leave a live undo lying in wait.
const UNDO_CONFIRM_MS = 3000;

export function LiveAtc({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [currentDarts, setCurrentDarts] = useState<DartThrow[]>([]);
  // Ref for a synchronous double-tap guard; state to disable the inputs while
  // a save is in flight (during that window `match` is stale, so a tap would
  // otherwise be attributed to the wrong player).
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const lastRecordAt = useRef(0);
  // Undo Last Turn sits next to Confirm, so it takes two presses: the first
  // arms it (highlighted red), the second undoes. Any other input disarms it.
  const [undoArmed, setUndoArmed] = useState(false);
  const undoArmTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const m = await getMatch(matchId);
      if (!active) return;
      if (!m) {
        toast('Match not found', 'error');
        navigate('/', { replace: true });
        return;
      }
      if (m.status === 'completed') {
        navigate(`/summary/${matchId}`, { replace: true });
        return;
      }
      const players = await getPlayers();
      const map = new Map<string, string>(players.map((p: Player) => [p.id, p.name]));
      for (const id of m.playerIds) if (!map.has(id)) map.set(id, 'Unknown');
      if (!active) return;
      setNames(map);
      setMatch(m);
    })().catch((err) => {
      // Without this a rejected read strands the user on a blank screen.
      if (!active) return;
      console.error(err);
      toast('Failed to load the match', 'error');
      navigate('/', { replace: true });
    });
    return () => {
      active = false;
    };
  }, [matchId]);

  useEffect(() => () => window.clearTimeout(undoArmTimer.current), []);

  if (!match) return <div className="screen" />;

  const ring = match.atcRing ?? 'single';
  const leg = activeLeg(match);
  const won = legsWonBy(match);
  const turnPlayer = currentPlayerId(match);
  const startProgress = atcProgress(leg, turnPlayer);
  const liveProgress = Math.min(startProgress + hitsIn(currentDarts), ATC_TARGET_COUNT);
  const hasWon = liveProgress >= ATC_TARGET_COUNT;
  const inputLocked = currentDarts.length >= 3 || hasWon || saving;
  const currentTargetNum = ATC_SEQUENCE[Math.min(liveProgress, ATC_TARGET_COUNT - 1)];
  // The bull only has an outer (25) and inner/double (50) — no treble — so the
  // +3 button is disabled once the target reaches the bull.
  const onBull = !hasWon && currentTargetNum === 25;
  const nameOf = (id: string) => names.get(id) ?? '?';

  function disarmUndo() {
    window.clearTimeout(undoArmTimer.current);
    undoArmTimer.current = undefined;
    setUndoArmed(false);
  }

  function pressUndoTurn() {
    if (!match || saving) return;
    if (!match.legs.some((l) => l.turns.length > 0)) {
      toast('Nothing to undo', 'error');
      return;
    }
    if (!undoArmed) {
      setUndoArmed(true);
      window.clearTimeout(undoArmTimer.current);
      undoArmTimer.current = window.setTimeout(() => setUndoArmed(false), UNDO_CONFIRM_MS);
      return;
    }
    disarmUndo();
    void undoLastTurn();
  }

  function addStep(steps: number) {
    disarmUndo();
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
    disarmUndo();
    // The double-tap guard must run before the fill branch: after a recorded
    // turn the slots are empty again, so a second tap would otherwise start
    // filling the next player's darts as misses.
    if (!match || submitting.current) return;
    // A turn is three darts. Clearing the board early is the one exception —
    // then the win confirms without filling the remaining slots. Otherwise the
    // first press fills any unthrown darts as misses on the current target, and
    // the player presses again to confirm the now-complete turn.
    if (!hasWon && currentDarts.length < 3) {
      if (Date.now() - lastRecordAt.current < FILL_COOLDOWN_MS) return;
      const fill = 3 - currentDarts.length;
      const missLabel = dartLabel(currentTargetNum, 0, ring);
      setCurrentDarts((d) => [
        ...d,
        ...Array.from({ length: fill }, () => ({ score: 0, label: missLabel, isDouble: false })),
      ]);
      return;
    }
    submitting.current = true;
    setSaving(true);
    lastRecordAt.current = Date.now();
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
      const clearedBoard = newProgress >= ATC_TARGET_COUNT;
      let winsMatch = false;
      if (clearedBoard) {
        nextLeg.winnerId = turnPlayer;
        winsMatch = (legsWonBy(next).get(turnPlayer) ?? 0) >= legsToWin(next);
        if (winsMatch) {
          next.winnerId = turnPlayer;
          next.status = 'completed';
        } else {
          next.legs.push({ id: uuid(), matchId: next.id, winnerId: null, turns: [] });
        }
      }

      await saveMatch(next);
      // Only a persisted turn clears the input — on a failed save the darts
      // stay in the slots so the player can retry instead of silently losing
      // them.
      setCurrentDarts([]);

      if (winsMatch) {
        toast(`${nameOf(turnPlayer)} wins the match!`);
        // Replace so Back from the summary goes home, not to a dead live
        // screen that would only redirect forward again.
        navigate(`/summary/${next.id}`, { replace: true });
        return;
      }
      if (clearedBoard) {
        toast(`${nameOf(turnPlayer)} wins the leg!`);
        setMatch(next);
        return;
      }
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the turn was not recorded. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function undoLastTurn() {
    // Shares the confirm guard: undoing while a confirm is saving would clone
    // the stale match and silently drop the just-recorded turn (and a
    // double-tapped undo would remove one turn while looking like two).
    if (!match || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
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
      await saveMatch(next);
      setCurrentDarts([]);
      toast('Last turn undone');
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the undo was not applied. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
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
        <button
          className="btn"
          disabled={currentDarts.length === 0 || saving}
          onClick={() => {
            disarmUndo();
            setCurrentDarts((d) => d.slice(0, -1));
          }}
        >
          ↶ Undo Dart
        </button>
        <button
          className={`btn primary ${hasWon ? 'success' : ''}`}
          disabled={saving}
          onClick={confirmTurn}
        >
          {hasWon
            ? 'Confirm Win'
            : currentDarts.length < 3
              ? `Miss Remaining (${currentDarts.length}/3)`
              : 'Confirm Turn (3/3)'}
        </button>
      </div>

      <div className="undo-turn-row">
        <button
          className={`btn ${undoArmed ? 'danger' : 'ghost'}`}
          disabled={saving}
          onClick={pressUndoTurn}
        >
          {undoArmed ? 'Tap again to undo last turn' : '⟲ Undo Last Turn'}
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
