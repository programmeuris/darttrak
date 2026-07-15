import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { getMatch, getPlayers, getAllMatches, saveMatch, deleteMatch } from '../db';
import {
  TRAINING_FIELD_COUNT,
  advanceTraining,
  fieldIdFromLabel,
  isTrainingTurnOpen,
  newTrainingState,
  trainingAttempts,
  trainingFieldLabel,
} from '../training';
import { newTrainingRound } from '../trainingSession';
import { StatCell } from '../components/Header';
import type { Match, Player, Turn } from '../types';

// Sanity cap on one numpad entry — beyond this it's a typo, not a cold streak.
const MAX_PENDING_DIGITS = 3;
// How long an armed undo stays primed before it relaxes back to safe.
const UNDO_CONFIRM_MS = 3000;

export function LiveTraining({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [playerName, setPlayerName] = useState('');
  // Numpad buffer: digits accumulate and commit on ↵ (or on HIT, which
  // registers the typed misses first so one tap closes the whole streak).
  const [pending, setPending] = useState('');
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [undoArmed, setUndoArmed] = useState<'dart' | 'action' | null>(null);
  const undoArmTimer = useRef<number | undefined>(undefined);
  // How many darts the last numpad entry added. Undo Action reverts exactly
  // that many; any other edit (an undo, a remount) invalidates the memory.
  const [lastAction, setLastAction] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const m = await getMatch(matchId);
      if (!active) return;
      if (!m) {
        toast('Training not found', 'error');
        navigate('/', { replace: true });
        return;
      }
      if (m.status === 'completed') {
        navigate(`/summary/${matchId}`, { replace: true });
        return;
      }
      // Records from an import may predate the training field — heal in place.
      if (!m.training) {
        m.training = newTrainingState();
        await saveMatch(m);
      }
      const players = await getPlayers();
      if (!active) return;
      setPlayerName(players.find((p: Player) => p.id === m.playerIds[0])?.name ?? 'Unknown');
      setMatch(m);
    })().catch((err) => {
      if (!active) return;
      console.error(err);
      toast('Failed to load the training', 'error');
      navigate('/', { replace: true });
    });
    return () => {
      active = false;
    };
  }, [matchId]);

  useEffect(() => () => window.clearTimeout(undoArmTimer.current), []);

  if (!match) return <div className="screen" />;

  const training = match.training!;
  const leg = match.legs[match.legs.length - 1];
  const lastTurn = leg.turns[leg.turns.length - 1];
  const openDarts = isTrainingTurnOpen(lastTurn) ? lastTurn.darts.length : 0;
  const attempts = trainingAttempts(match);
  const resolved = attempts.filter((a) => a.resolved);
  const dartsThisRound = attempts.reduce((acc, a) => acc + a.darts, 0);
  const targetLabel = trainingFieldLabel(training.target);

  function disarmUndo() {
    window.clearTimeout(undoArmTimer.current);
    undoArmTimer.current = undefined;
    setUndoArmed(null);
  }

  function pressUndo(kind: 'dart' | 'action') {
    if (!match || saving) return;
    if (undoArmed !== kind) {
      setUndoArmed(kind);
      window.clearTimeout(undoArmTimer.current);
      undoArmTimer.current = window.setTimeout(() => setUndoArmed(null), UNDO_CONFIRM_MS);
      return;
    }
    disarmUndo();
    if (kind === 'dart') void undoDart();
    else void undoAction();
  }

  async function registerDarts(misses: number, hit: boolean) {
    if (!match || submitting.current) return;
    if (misses <= 0 && !hit) return;
    disarmUndo();
    submitting.current = true;
    setSaving(true);
    try {
      const next = structuredClone(match);
      const nextLeg = next.legs[next.legs.length - 1];
      const state = next.training!;
      const label = trainingFieldLabel(state.target);
      let turn: Turn | undefined = nextLeg.turns[nextLeg.turns.length - 1];
      // Continue the live attempt only if it's still open AND still on this
      // target (an attempt can span breaks — the record keeps it live).
      const open =
        isTrainingTurnOpen(turn) && fieldIdFromLabel(turn!.darts[0].label) === state.target;
      if (!open) {
        turn = {
          playerId: next.playerIds[0],
          darts: [],
          totalScore: 0,
          remainingScore: 0,
          isBust: false,
          timestamp: Date.now(),
        };
        nextLeg.turns.push(turn);
      }
      for (let i = 0; i < misses; i++) {
        turn!.darts.push({ score: 0, label: `✗${label}`, isDouble: false });
      }
      let finishedRound = false;
      if (hit) {
        turn!.darts.push({ score: 1, label: `✓${label}`, isDouble: false });
        const advanced = advanceTraining(state);
        if (advanced) {
          next.training = advanced;
        } else {
          // Every field hit — the round is complete. The record finalises
          // itself; the next round starts immediately with a fresh bag.
          next.status = 'completed';
          next.winnerId = next.playerIds[0];
          finishedRound = true;
        }
      }
      turn!.totalScore = turn!.darts.length;
      turn!.timestamp = Date.now();

      await saveMatch(next);
      setPending('');
      if (finishedRound) {
        const darts = trainingAttempts(next).reduce((acc, a) => acc + a.darts, 0);
        const fresh = newTrainingRound(next.playerIds[0]);
        await saveMatch(fresh);
        toast(`Board complete in ${darts} darts!`);
        navigate(`/live/${fresh.id}`, { replace: true });
        return;
      }
      setLastAction(misses + (hit ? 1 : 0));
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the throws were not recorded. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function undoDart() {
    if (!match || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const next = structuredClone(match);
      const nextLeg = next.legs[next.legs.length - 1];
      const turn = nextLeg.turns[nextLeg.turns.length - 1];
      if (!turn || turn.darts.length === 0) {
        // A brand-new round has nothing local to undo, but the press most
        // likely means "that final hit was a mis-tap": reopen the previous
        // round and discard this empty one.
        const prev = (await getAllMatches())
          .filter(
            (m) =>
              m.gameType === 'Training' &&
              m.status === 'completed' &&
              m.playerIds[0] === match.playerIds[0] &&
              m.id !== match.id,
          )
          .sort((a, b) => b.date - a.date)[0];
        const prevLeg = prev?.legs[prev.legs.length - 1];
        const prevTurn = prevLeg?.turns[prevLeg.turns.length - 1];
        if (!prev || !prevTurn || prevTurn.darts.length === 0) {
          toast('Nothing to undo', 'error');
          return;
        }
        const reopened = structuredClone(prev);
        const rLeg = reopened.legs[reopened.legs.length - 1];
        const rTurn = rLeg.turns[rLeg.turns.length - 1];
        rTurn.darts.pop(); // the round-final hit; training still points at its field
        if (rTurn.darts.length === 0) rLeg.turns.pop();
        else rTurn.totalScore = rTurn.darts.length;
        reopened.status = 'in_progress';
        reopened.winnerId = null;
        await saveMatch(reopened);
        await deleteMatch(match.id);
        toast('Round reopened');
        navigate(`/live/${reopened.id}`, { replace: true });
        return;
      }
      const popped = turn.darts.pop()!;
      if (popped.score > 0) {
        // Undoing a hit reopens the attempt: its target becomes live again and
        // the freshly drawn one goes back to the front of the bag.
        next.training = {
          target: fieldIdFromLabel(popped.label),
          bag: [next.training!.target, ...next.training!.bag],
        };
      }
      if (turn.darts.length === 0) nextLeg.turns.pop();
      else turn.totalScore = turn.darts.length;
      await saveMatch(next);
      setLastAction(0);
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the undo was not applied. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  // Reverts the whole last numpad entry in one save. Its darts are still the
  // tail of the last turn: `lastAction` is only ever set by a registerDarts
  // that stayed on this round, and every undo path clears it.
  async function undoAction() {
    if (!match || submitting.current || lastAction <= 0) return;
    submitting.current = true;
    setSaving(true);
    try {
      const next = structuredClone(match);
      const nextLeg = next.legs[next.legs.length - 1];
      const turn = nextLeg.turns[nextLeg.turns.length - 1];
      for (let i = 0; i < lastAction; i++) {
        const popped = turn.darts.pop()!;
        if (popped.score > 0) {
          // The entry's hit comes off first: its target becomes live again
          // and the freshly drawn one goes back to the front of the bag.
          next.training = {
            target: fieldIdFromLabel(popped.label),
            bag: [next.training!.target, ...next.training!.bag],
          };
        }
      }
      if (turn.darts.length === 0) nextLeg.turns.pop();
      else turn.totalScore = turn.darts.length;
      await saveMatch(next);
      setLastAction(0);
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the undo was not applied. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function pressDigit(d: string) {
    setPending((p) => (p.length >= MAX_PENDING_DIGITS || (p === '' && d === '0') ? p : p + d));
  }

  // With nothing typed the miss button records a single miss, so the pad
  // covers plain tap entry too. `pending` can never be '0' (leading-zero
  // guard in pressDigit), so the count is always at least 1.
  function commitPending() {
    void registerDarts(parseInt(pending || '1', 10), false);
  }

  const recent = attempts.slice(-8).reverse();

  return (
    <div className="screen live">
      <header className="screen-header">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="screen-title">Training · {playerName}</h1>
      </header>

      <div className="score-card active">
        <div className="sc-top">
          <span className="sc-name">Current target</span>
          {openDarts > 0 && <span className="sc-legs">{openDarts} thrown</span>}
        </div>
        <div className="sc-target">{targetLabel}</div>
        <div className="atc-progress">
          <div
            className="atc-progress-fill"
            style={{ width: `${(resolved.length / TRAINING_FIELD_COUNT) * 100}%` }}
          />
        </div>
        <div className="sc-pending">
          {resolved.length}/{TRAINING_FIELD_COUNT} fields this round
        </div>
      </div>

      <div className="stat-grid">
        <StatCell value={String(dartsThisRound)} label="Darts This Round" />
        <StatCell
          value={
            resolved.length
              ? (resolved.reduce((a, b) => a + b.darts, 0) / resolved.length).toFixed(1)
              : '—'
          }
          label="Avg Darts / Target"
        />
      </div>

      <div className="pad-display" aria-live="polite">
        +{pending || '0'} darts
      </div>
      <div className="num-grid dialpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="num-btn" disabled={saving} onClick={() => pressDigit(d)}>
            {d}
          </button>
        ))}
        <button
          className="num-btn"
          aria-label="Delete last digit"
          disabled={saving || pending === ''}
          onClick={() => setPending((p) => p.slice(0, -1))}
        >
          ⌫
        </button>
        <button className="num-btn" disabled={saving} onClick={() => pressDigit('0')}>
          0
        </button>
        <button
          className="num-btn wide miss"
          aria-label={pending ? 'Add misses' : undefined}
          disabled={saving}
          onClick={commitPending}
        >
          {pending ? '↵ Add' : 'MISS ✗'}
        </button>
      </div>
      <button
        className="btn hit-btn full"
        disabled={saving}
        // The typed number is which dart hit: n means n-1 misses then the
        // hit — n darts in total, unlike the miss button where n is all misses.
        onClick={() => registerDarts(Math.max(parseInt(pending || '1', 10) - 1, 0), true)}
      >
        HIT ✓{pending ? ` (with dart ${pending})` : ''}
      </button>

      <div className="undo-turn-row">
        <button
          className={`btn ${undoArmed === 'dart' ? 'danger' : 'ghost'}`}
          disabled={saving}
          onClick={() => pressUndo('dart')}
        >
          {undoArmed === 'dart' ? 'Tap again to undo dart' : '↶ Undo Dart'}
        </button>
        <button
          className={`btn ${undoArmed === 'action' ? 'danger' : 'ghost'}`}
          disabled={saving || lastAction === 0}
          onClick={() => pressUndo('action')}
        >
          {undoArmed === 'action' ? 'Tap again to undo action' : '↶ Undo Action'}
        </button>
      </div>

      <section className="card">
        <h2 className="card-title">This Round</h2>
        <ul className="turn-log">
          {recent.length === 0 ? (
            <li className="empty">Nothing yet — aim for {targetLabel}</li>
          ) : (
            recent.map((a, i) => (
              <li className="log-row" key={i}>
                <span className="log-player">{trainingFieldLabel(a.target)}</span>
                <span className="log-darts">
                  {a.resolved ? `hit with dart ${a.darts}` : `${a.darts} thrown, still open`}
                </span>
                <span className="log-score">{a.resolved ? '✓' : '…'}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
