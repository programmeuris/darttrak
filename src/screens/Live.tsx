import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { toast, confirmDialog } from '../toast';
import { getMatch, getPlayers, saveMatch, uuid } from '../db';
import { startingScore, evaluateTurn, isBust, isWinningTurn } from '../scoring';
import { suggestCheckout } from '../checkout';
import type { Match, Leg, Turn, DartThrow, Player } from '../types';

function startScore(match: Match): number {
  return startingScore(match.gameType === '301' ? '301' : '501');
}
function legsToWin(match: Match): number {
  return Math.floor(match.format.legs / 2) + 1;
}
function activeLeg(match: Match): Leg {
  return match.legs[match.legs.length - 1];
}
function legRemaining(match: Match, leg: Leg): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const id of match.playerIds) remaining.set(id, startScore(match));
  for (const turn of leg.turns) remaining.set(turn.playerId, turn.remainingScore);
  return remaining;
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

export function Live({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [currentDarts, setCurrentDarts] = useState<DartThrow[]>([]);
  const [multiplier, setMultiplier] = useState<1 | 2 | 3>(1);
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

  const leg = activeLeg(match);
  const remaining = legRemaining(match, leg);
  const won = legsWonBy(match);
  const turnPlayer = currentPlayerId(match);
  const startRemaining = remaining.get(turnPlayer)!;
  const outcome = evaluateTurn(startRemaining, currentDarts, match.doubleOut);
  const turnTotal = currentDarts.reduce((a, d) => a + d.score, 0);
  const projected = startRemaining - turnTotal;
  const inputLocked = currentDarts.length >= 3 || outcome === 'bust' || outcome === 'win';
  const nameOf = (id: string) => names.get(id) ?? '?';

  // Suggested finish for the player on throw (x01 double-out only), updating as
  // darts are thrown this turn.
  const checkout =
    match.doubleOut && outcome === 'ok' && currentDarts.length < 3
      ? suggestCheckout(projected, 3 - currentDarts.length)
      : null;

  function addDart(base: number, isBull: boolean) {
    if (currentDarts.length >= 3) return;
    let score: number;
    let label: string;
    let isDouble: boolean;
    if (isBull) {
      if (multiplier === 3) {
        toast('No treble bull', 'error');
        return;
      }
      if (multiplier === 2) {
        score = 50;
        label = 'Bull';
        isDouble = true;
      } else {
        score = 25;
        label = 'Outer';
        isDouble = false;
      }
    } else if (base === 0) {
      score = 0;
      label = 'Miss';
      isDouble = false;
    } else {
      score = base * multiplier;
      isDouble = multiplier === 2;
      label = `${multiplier === 2 ? 'D' : multiplier === 3 ? 'T' : ''}${base}`;
    }
    setCurrentDarts((d) => [...d, { score, label, isDouble }]);
    setMultiplier(1);
  }

  async function confirmTurn() {
    if (!match) return;
    // A turn is three darts. It ends early only on a checkout (win) or a bust;
    // an ordinary turn must record all three before it can be confirmed.
    if (outcome === 'ok' && currentDarts.length < 3) {
      toast('Throw all 3 darts to finish the turn', 'error');
      return;
    }
    if (submitting.current) return; // guard against double-tap recording the turn twice
    submitting.current = true;
    try {
      const bust = isBust(startRemaining, currentDarts, match.doubleOut);
      const win = isWinningTurn(startRemaining, currentDarts, match.doubleOut);
      const total = currentDarts.reduce((a, d) => a + d.score, 0);

      const next = structuredClone(match);
      const nextLeg = activeLeg(next);
      nextLeg.turns.push({
        playerId: turnPlayer,
        darts: [...currentDarts],
        totalScore: total,
        remainingScore: bust ? startRemaining : startRemaining - total,
        isBust: bust,
        timestamp: Date.now(),
      } satisfies Turn);
      setCurrentDarts([]);
      setMultiplier(1);

      if (win) {
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
      if (bust) toast('Bust!');
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
          {match.gameType} · Leg {match.legs.length}/{match.format.legs}
        </h1>
      </header>

      <div className="scoreboard">
        {match.playerIds.map((id) => {
          const isTurn = id === turnPlayer;
          const displayRem = isTurn && outcome !== 'bust' ? projected : remaining.get(id)!;
          return (
            <div className={`score-card ${isTurn ? 'active' : ''}`} key={id}>
              <div className="sc-top">
                <span className="sc-name">{nameOf(id)}</span>
                <span className="sc-legs">
                  {won.get(id) ?? 0} {(won.get(id) ?? 0) === 1 ? 'leg' : 'legs'}
                </span>
              </div>
              <div className="sc-remaining">{displayRem}</div>
              {isTurn && currentDarts.length > 0 && (
                <div className="sc-pending">{turnTotal} this turn</div>
              )}
            </div>
          );
        })}
      </div>

      {outcome === 'bust' && <div className="banner bust">BUST — confirm to end turn</div>}
      {outcome === 'win' && (
        <div className="banner win">{nameOf(turnPlayer)} checks out! Confirm to win the leg.</div>
      )}

      {checkout && (
        <div className="checkout-hint">
          Checkout: <strong>{checkout.join(' · ')}</strong>
        </div>
      )}

      <div className="dart-slots">
        {[0, 1, 2].map((i) => (
          <div className={`dart-slot ${currentDarts[i] ? 'filled' : ''}`} key={i}>
            {currentDarts[i] ? currentDarts[i].label : '–'}
          </div>
        ))}
      </div>

      <div className="live-actions">
        <button className="btn" disabled={currentDarts.length === 0} onClick={() => setCurrentDarts((d) => d.slice(0, -1))}>
          ↶ Undo Dart
        </button>
        <button
          className={`btn primary ${outcome === 'bust' ? 'danger' : outcome === 'win' ? 'success' : ''}`}
          disabled={outcome === 'ok' && currentDarts.length < 3}
          onClick={confirmTurn}
        >
          {outcome === 'win'
            ? 'Confirm Win'
            : outcome === 'bust'
              ? 'Confirm Bust'
              : `Confirm Turn (${currentDarts.length}/3)`}
        </button>
      </div>

      <section className="numpad">
        <div className="mult-row">
          {([[1, 'Single'], [2, 'Double'], [3, 'Treble']] as [1 | 2 | 3, string][]).map(([v, label]) => (
            <button
              key={v}
              className={`mult-btn ${v === multiplier ? 'active' : ''}`}
              onClick={() => setMultiplier(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="num-grid">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
            <button key={n} className="num-btn" disabled={inputLocked} onClick={() => addDart(n, false)}>
              {n}
            </button>
          ))}
        </div>
        <div className="special-row">
          <button className="num-btn wide bull" disabled={inputLocked} onClick={() => addDart(25, true)}>
            Outer / Bull (25/50)
          </button>
          <button className="num-btn wide miss" disabled={inputLocked} onClick={() => addDart(0, false)}>
            Miss
          </button>
        </div>
      </section>

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
                <li className={`log-row ${turn.isBust ? 'bust' : ''}`} key={i}>
                  <span className="log-player">{nameOf(turn.playerId)}</span>
                  <span className="log-darts">{turn.darts.map((d) => d.label).join(' · ')}</span>
                  <span className="log-score">{turn.isBust ? 'BUST' : turn.totalScore}</span>
                  <span className="log-remaining">→ {turn.remainingScore}</span>
                  {match.format.legs > 1 && <span className="log-leg">L{legIndex + 1}</span>}
                </li>
              ))
          )}
        </ul>
      </section>
    </div>
  );
}
