import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { getMatch, getPlayers, getAllMatches, saveMatch, deleteMatch } from '../db';
import {
  GROUP_VISIT_DARTS,
  TRAINING_FIELD_COUNT,
  TRAINING_VARIANT_LABELS,
  advanceTraining,
  fieldIdFromLabel,
  isTrainingTurnOpen,
  lastFieldOf,
  newTrainingState,
  nextRoundBag,
  trainingAttempts,
  trainingFieldLabel,
  trainingVariantOf,
} from '../training';
import { newTrainingRound } from '../trainingSession';
import { StatCell } from '../components/Header';
import type { Match, Player, Turn } from '../types';

// Sanity cap on one numpad entry — beyond this it's a typo, not a cold streak.
const MAX_PENDING_DIGITS = 3;
// How long an armed undo stays primed before it relaxes back to safe.
const UNDO_CONFIRM_MS = 3000;
// How long the completed round stays on screen before navigating to the
// fresh one: enough for the wheel's boundary spin (0.35s CSS transition)
// and the confetti burst to play. The spin's final frame matches the fresh
// round's first render exactly, so the remount is invisible.
const ROLLOVER_MS = 950;

export function LiveTraining({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [playerName, setPlayerName] = useState('');
  // The previous round's last two targets (with their hit counts, for the
  // Group Therapy medals): they fill the wheel's trailing slots at the start
  // of a round, so the strip reads continuously across the seam.
  const [prevTail, setPrevTail] = useState<{ field: string; hits: number }[]>([]);
  // Bumped on every registered entry; the flash overlay is keyed by it so the
  // "darts landed" animation replays even when adds come in quick succession.
  const [flashKey, setFlashKey] = useState(0);
  // Numpad buffer: digits accumulate and commit on ↵ (or on HIT, which
  // registers the typed misses first so one tap closes the whole streak).
  const [pending, setPending] = useState('');
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [undoArmed, setUndoArmed] = useState<'dart' | 'action' | null>(null);
  const undoArmTimer = useRef<number | undefined>(undefined);
  // True from the round-completing save until navigation to the fresh round:
  // the boundary spin is playing on the completed record, and no input may
  // land on it in the meantime.
  const rolling = useRef(false);
  const rolloverTimer = useRef<number | undefined>(undefined);
  // True while the round-complete celebration (gold glow + confetti) plays
  // over the boundary spin.
  const [celebrating, setCelebrating] = useState(false);
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
      } else if (!m.training.nextBag || !m.training.variant) {
        // Older records predate the pre-dealt next round and the variant
        // field — heal in place (no variant means Kitchen Sink).
        m.training = {
          variant: 'sink',
          ...m.training,
          nextBag: m.training.nextBag ?? nextRoundBag(lastFieldOf(m.training)),
        };
        await saveMatch(m);
      }
      const players = await getPlayers();
      const prev = (await getAllMatches())
        .filter(
          (x) =>
            x.gameType === 'Training' &&
            x.status === 'completed' &&
            x.playerIds[0] === m.playerIds[0] &&
            trainingVariantOf(x) === trainingVariantOf(m) &&
            x.id !== m.id,
        )
        .sort((a, b) => b.date - a.date)[0];
      if (!active) return;
      setPrevTail(
        prev
          ? trainingAttempts(prev)
              .filter((a) => a.resolved)
              .map((a) => ({ field: a.target, hits: a.hits }))
              .slice(-2)
          : [],
      );
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

  useEffect(
    () => () => {
      window.clearTimeout(undoArmTimer.current);
      window.clearTimeout(rolloverTimer.current);
    },
    [],
  );

  if (!match) return <div className="screen" />;

  const training = match.training!;
  const variant = trainingVariantOf(match);
  const leg = match.legs[match.legs.length - 1];
  const lastTurn = leg.turns[leg.turns.length - 1];
  const openDarts = isTrainingTurnOpen(lastTurn, variant) ? lastTurn.darts.length : 0;
  const attempts = trainingAttempts(match);
  const resolved = attempts.filter((a) => a.resolved);
  const dartsThisRound = attempts.reduce((acc, a) => acc + a.darts, 0);
  const hitsThisRound = attempts.reduce((acc, a) => acc + a.hits, 0);
  const targetLabel = trainingFieldLabel(training.target);
  // Group Therapy: the current visit's darts, for the live medal and the
  // dart-of-three pips (empty when the open turn belongs to another target).
  const visitDarts =
    variant === 'group' &&
    openDarts > 0 &&
    fieldIdFromLabel(lastTurn!.darts[0].label) === training.target
      ? lastTurn!.darts
      : [];
  const liveHits = visitDarts.filter((d) => d.score > 0).length;

  // ---- Target wheel ----
  // One continuous strip: previous round's tail, this round's resolved
  // targets, the current one, the rest of the bag, then the pre-dealt next
  // round. Five slots render (two of them offscreen), so every visible move
  // on a hit or undo is a CSS transition of an already-mounted element —
  // entries and exits happen out of sight. Keys carry the round so a field
  // recurring in the next round can't collide; the first target of each
  // round carries the seam marker (the visible break between rounds).
  const nextRound = (training.nextBag ?? []).map((f, i) => ({
    field: f,
    key: `${match.id}:n:${f}`,
    seam: i === 0,
    medal: 0,
  }));
  const past = [
    ...prevTail.map(({ field, hits }) => ({ field, key: `p:${field}`, seam: false, medal: hits })),
    ...resolved.map((a, i) => ({
      field: a.target,
      key: `${match.id}:${a.target}`,
      seam: i === 0,
      medal: a.hits,
    })),
  ];
  // While the round-boundary spin plays (the record just completed, the
  // final target is already in `past`), the next round's opener holds focus;
  // navigation to the real fresh round follows at spin end.
  const rolled = match.status === 'completed';
  const current = rolled
    ? nextRound[0]
    : {
        field: training.target,
        key: `${match.id}:${training.target}`,
        seam: resolved.length === 0,
        medal: liveHits,
      };
  const ahead = rolled
    ? nextRound.slice(1)
    : [
        ...training.bag.map((f) => ({ field: f, key: `${match.id}:${f}`, seam: false, medal: 0 })),
        ...nextRound,
      ];
  const wheel = [
    { slot: -2, entry: past[past.length - 2] },
    { slot: -1, entry: past[past.length - 1] },
    { slot: 0, entry: current },
    { slot: 1, entry: ahead[0] },
    { slot: 2, entry: ahead[1] },
  ].filter((w) => w.entry);

  function disarmUndo() {
    window.clearTimeout(undoArmTimer.current);
    undoArmTimer.current = undefined;
    setUndoArmed(null);
  }

  function pressUndo(kind: 'dart' | 'action') {
    if (!match || saving || rolling.current) return;
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
    if (!match || submitting.current || rolling.current) return;
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
      setFlashKey((k) => k + 1);
      if (finishedRound) {
        await rollOver(next, `Board complete in ${dartsOf(next)} darts!`);
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

  // Group Therapy input: one dart per tap, and the visit ends after
  // GROUP_VISIT_DARTS darts no matter how many landed.
  async function registerGroupDart(hit: boolean) {
    if (!match || submitting.current || rolling.current) return;
    disarmUndo();
    submitting.current = true;
    setSaving(true);
    try {
      const next = structuredClone(match);
      const nextLeg = next.legs[next.legs.length - 1];
      const state = next.training!;
      const label = trainingFieldLabel(state.target);
      let turn: Turn | undefined = nextLeg.turns[nextLeg.turns.length - 1];
      // Continue the live visit only if it's still open AND still on this
      // target (a visit can span breaks — the record keeps it live).
      const open =
        isTrainingTurnOpen(turn, 'group') &&
        fieldIdFromLabel(turn!.darts[0].label) === state.target;
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
      turn!.darts.push(
        hit
          ? { score: 1, label: `✓${label}`, isDouble: false }
          : { score: 0, label: `✗${label}`, isDouble: false },
      );
      let finishedRound = false;
      if (turn!.darts.length >= GROUP_VISIT_DARTS) {
        const advanced = advanceTraining(state);
        if (advanced) {
          next.training = advanced;
        } else {
          // Every field visited — the round is complete.
          next.status = 'completed';
          next.winnerId = next.playerIds[0];
          finishedRound = true;
        }
      }
      turn!.totalScore = turn!.darts.length;
      turn!.timestamp = Date.now();

      await saveMatch(next);
      setFlashKey((k) => k + 1);
      if (finishedRound) {
        const hits = trainingAttempts(next).reduce((acc, a) => acc + a.hits, 0);
        await rollOver(next, `Board complete — ${hits}/${dartsOf(next)} hits!`);
        return;
      }
      setMatch(next);
    } catch (err) {
      console.error(err);
      toast('Save failed — the throw was not recorded. Try again.', 'error');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function dartsOf(m: Match) {
    return trainingAttempts(m).reduce((acc, a) => acc + a.darts, 0);
  }

  // Shared round rollover: deal the fresh round from the pre-dealt order the
  // wheel has been showing, then celebrate on the completed record — gold
  // glow, confetti, and the wheel spinning across the seam — before
  // navigating; the remount lands on the identical frame.
  async function rollOver(completed: Match, message: string) {
    const fresh = newTrainingRound(
      completed.playerIds[0],
      completed.training!.nextBag,
      trainingVariantOf(completed),
    );
    await saveMatch(fresh);
    toast(message);
    rolling.current = true;
    setCelebrating(true);
    setMatch(completed);
    rolloverTimer.current = window.setTimeout(
      () => navigate(`/live/${fresh.id}`, { replace: true }),
      ROLLOVER_MS,
    );
  }

  async function undoDart() {
    if (!match || submitting.current || rolling.current) return;
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
              trainingVariantOf(m) === variant &&
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
        rTurn.darts.pop(); // the final attempt's last dart; training still points at its field
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
      const poppedField = fieldIdFromLabel(popped.label);
      // Whenever the pop crosses back into a previous attempt, that attempt's
      // target is live again and the freshly drawn one returns to the front
      // of the bag. Kitchen Sink crosses on a hit (a hit always ended the
      // attempt); Group Therapy crosses whenever the popped dart belongs to
      // another target (a full visit ended it, hit or not).
      const crossed = variant === 'group' ? poppedField !== next.training!.target : popped.score > 0;
      if (crossed) {
        next.training = {
          ...next.training!,
          target: poppedField,
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
    if (!match || submitting.current || rolling.current || lastAction <= 0) return;
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
            nextBag: next.training!.nextBag,
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
        <h1 className="screen-title">
          {TRAINING_VARIANT_LABELS[variant]} · {playerName}
        </h1>
      </header>

      <div className={`score-card active${celebrating ? ' celebrate' : ''}`}>
        {flashKey > 0 && <div key={flashKey} className="sc-flash" aria-hidden="true" />}
        {celebrating && (
          // A dozen confetti pieces scattering from the target — vectors are
          // index-derived so the burst needs no randomness.
          <div className="sc-celebrate" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => {
              const angle = (i / 12) * 2 * Math.PI;
              const dist = 80 + (i % 3) * 40;
              return (
                <span
                  key={i}
                  className="confetti"
                  style={
                    {
                      '--cx': `${Math.round(Math.cos(angle) * dist)}px`,
                      '--cy': `${Math.round(Math.sin(angle) * dist * 0.6 - 30)}px`,
                      '--cr': `${140 + i * 45}deg`,
                      animationDelay: `${(i % 4) * 60}ms`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        )}
        <div className="sc-top">
          <span className="sc-name">Current target</span>
          {variant === 'group' ? (
            // Always visible: which of the visit's three darts is up next.
            <span className="sc-legs">Dart {visitDarts.length + 1}/{GROUP_VISIT_DARTS}</span>
          ) : (
            openDarts > 0 && <span className="sc-legs">{openDarts} thrown</span>
          )}
        </div>
        <div className={`target-wheel${variant === 'group' ? ' group' : ''}`}>
          {wheel.map(({ slot, entry }) => (
            <div
              key={entry.key}
              className={`tw-item s${slot}${entry.seam ? ' seam' : ''}${
                variant === 'group' && entry.medal > 0
                  ? ` medal-${Math.min(entry.medal, GROUP_VISIT_DARTS)}`
                  : ''
              }`}
            >
              {trainingFieldLabel(entry.field)}
            </div>
          ))}
        </div>
        {variant === 'group' && (
          // The visit at a glance: one pip per dart — hit, miss, or still
          // in hand (the next one to throw is highlighted).
          <div className="visit-pips">
            {Array.from({ length: GROUP_VISIT_DARTS }, (_, i) => {
              const d = visitDarts[i];
              const state = d ? (d.score > 0 ? ' hit' : ' miss') : '';
              const next = !d && i === visitDarts.length ? ' next' : '';
              return <span key={i} className={`pip${state}${next}`} />;
            })}
          </div>
        )}
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
        {variant === 'group' ? (
          <>
            <StatCell value={String(hitsThisRound)} label="Hits This Round" />
            <StatCell
              value={
                resolved.length
                  ? (resolved.reduce((a, b) => a + b.hits, 0) / resolved.length).toFixed(1)
                  : '—'
              }
              label="Avg Hits / Visit"
            />
          </>
        ) : (
          <>
            <StatCell value={String(dartsThisRound)} label="Darts This Round" />
            <StatCell
              value={
                resolved.length
                  ? (resolved.reduce((a, b) => a + b.darts, 0) / resolved.length).toFixed(1)
                  : '—'
              }
              label="Avg Darts / Target"
            />
          </>
        )}
      </div>

      {variant === 'group' ? (
        // Every visit is exactly three darts, so entry is one tap per dart —
        // no counts to type, no numpad.
        <div className="live-actions">
          <button className="btn hit-btn" disabled={saving} onClick={() => registerGroupDart(true)}>
            HIT ✓
          </button>
          <button
            className="btn miss-btn"
            disabled={saving}
            onClick={() => registerGroupDart(false)}
          >
            MISS ✗
          </button>
        </div>
      ) : (
        <>
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
        </>
      )}

      <div className={`undo-turn-row${variant === 'sink' ? ' pair' : ''}`}>
        <button
          className={`btn ${variant === 'group' ? 'full ' : ''}${
            undoArmed === 'dart' ? 'danger' : 'ghost'
          }`}
          disabled={saving}
          onClick={() => pressUndo('dart')}
        >
          {undoArmed === 'dart' ? 'Confirm' : '↶ Undo Dart'}
        </button>
        {variant === 'sink' && (
          // Group Therapy enters one dart at a time, so a separate whole-entry
          // undo would be identical to Undo Dart.
          <button
            className={`btn ${undoArmed === 'action' ? 'danger' : 'ghost'}`}
            disabled={saving || lastAction === 0}
            onClick={() => pressUndo('action')}
          >
            {undoArmed === 'action' ? 'Confirm' : '↶ Undo Action'}
          </button>
        )}
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
                  {!a.resolved
                    ? `${a.darts} thrown, still open`
                    : variant === 'group'
                      ? `${a.hits}/${GROUP_VISIT_DARTS} hits`
                      : `hit with dart ${a.darts}`}
                </span>
                <span className="log-score">
                  {!a.resolved
                    ? '…'
                    : variant === 'group'
                      ? ['—', '🥉', '🥈', '🥇'][Math.min(a.hits, 3)]
                      : '✓'}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
