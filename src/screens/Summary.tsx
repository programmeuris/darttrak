import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { Header, StatGrid } from '../components/Header';
import { getMatch, getPlayers } from '../db';
import {
  calculateAverage,
  calculateHighestTurn,
  count180s,
  countHighScores,
  calculateCheckoutPercent,
  bestCheckout,
  totalDartsThrown,
} from '../scoring';
import { atcDartsThrown, atcHits, atcHitRate, atcFewestDartsToComplete, atcRingLabel } from '../atc';
import {
  TRAINING_FIELD_COUNT,
  TRAINING_VARIANT_LABELS,
  trainingRounds,
  trainingVariantOf,
} from '../training';
import type { Match, Player } from '../types';

export function Summary({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

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
      const players = await getPlayers();
      if (!active) return;
      setNames(new Map(players.map((p: Player) => [p.id, p.name])));
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

  if (!match) return <div className="screen" />;

  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const isAtc = match.gameType === 'AroundTheClock';
  const isTraining = match.gameType === 'Training';
  const isGroup = isTraining && trainingVariantOf(match) === 'group';
  const subtitle = isTraining
    ? `${TRAINING_VARIANT_LABELS[trainingVariantOf(match)]} round · ${new Date(match.date).toLocaleDateString()}`
    : isAtc
      ? `Around the Clock · ${atcRingLabel(match.atcRing ?? 'single')} · Best of ${match.format.legs}`
      : `${match.gameType} · Best of ${match.format.legs} · ${match.doubleOut ? 'Double Out' : 'Straight Out'}`;

  function rowsFor(id: string): [string, string][] {
    if (isTraining) {
      const round = trainingRounds([match!], id)[0];
      if (!round) return [];
      if (isGroup) {
        return [
          ['Targets Visited', `${round.resolved}/${TRAINING_FIELD_COUNT}`],
          ['Hits', `${round.hits}/${round.darts}`],
          ['Avg Hits / Visit', round.resolved > 0 ? round.avgHits.toFixed(1) : '—'],
          ['First-dart Hit %', `${round.firstDartHitRate.toFixed(0)}%`],
        ];
      }
      return [
        ['Fields Hit', `${round.resolved}/${TRAINING_FIELD_COUNT}`],
        ['Darts Thrown', String(round.darts)],
        ['Avg Darts / Target', round.avgDarts > 0 ? round.avgDarts.toFixed(1) : '—'],
        ['First-dart Hit %', `${round.firstDartHitRate.toFixed(0)}%`],
      ];
    }
    if (isAtc) {
      const fewest = atcFewestDartsToComplete(match!.legs, id);
      return [
        ['Darts Thrown', String(atcDartsThrown(match!.legs, id))],
        ['Hits', String(atcHits(match!.legs, id))],
        ['Hit %', `${atcHitRate(match!.legs, id).toFixed(0)}%`],
        ['Fewest to Clear', fewest > 0 ? String(fewest) : '—'],
      ];
    }
    const hs = countHighScores(match!.legs, id);
    const best = bestCheckout(match!.legs, id);
    return [
      ['3-Dart Avg', calculateAverage(match!.legs, id).toFixed(1)],
      ['Highest Turn', String(calculateHighestTurn(match!.legs, id))],
      ['180s', String(count180s(match!.legs, id))],
      ['100+', String(hs.over100)],
      ['140+', String(hs.over140)],
      ['Darts Thrown', String(totalDartsThrown(match!.legs, id))],
      ['Checkout %', `${calculateCheckoutPercent(match!.legs, id, match!.doubleOut).toFixed(0)}%`],
      ['Best Checkout', best > 0 ? String(best) : '—'],
    ];
  }

  return (
    <div className="screen">
      <Header title="Match Summary" onBack={() => navigate('/')} />

      <section className="card winner-banner">
        <div className="winner-label">{isTraining ? 'Training' : 'Winner'}</div>
        <div className="winner-name">
          {isTraining ? `🎯 ${nameOf(match.playerIds[0])}` : `🏆 ${match.winnerId ? nameOf(match.winnerId) : '—'}`}
        </div>
        <div className="muted">{subtitle}</div>
      </section>

      {match.playerIds.map((id) => (
        <section
          className={`card ${!isTraining && id === match.winnerId ? 'winner-card' : ''}`}
          key={id}
        >
          <h2 className="card-title">
            {nameOf(id)}
            {!isTraining && id === match.winnerId && <span className="badge"> 🏆 Winner</span>}
          </h2>
          <StatGrid rows={rowsFor(id)} />
        </section>
      ))}

      <div className="add-row">
        <button className="btn primary big full" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    </div>
  );
}
