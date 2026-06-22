import type { Match, Leg, Turn } from './types';
import {
  calculateAverage,
  count180s,
  bestCheckout,
  isX01,
} from './scoring';

export interface PlayerOverview {
  matchesPlayed: number; // all completed x01 games (solo practice included)
  competitivePlayed: number; // games with 2+ participants
  matchesWon: number; // wins among competitive games
  winRate: number; // 0-100, over competitive games (0 when none)
  overallAverage: number; // 3-dart average across all matches
  bestMatchAverage: number;
  total180s: number;
  bestCheckout: number;
}

function completedMatchesFor(matches: Match[], playerId: string): Match[] {
  // x01 only — Cricket / Around the Clock reuse the same fields with different
  // meaning and would distort these point-based metrics.
  return matches.filter(
    (m) =>
      m.status === 'completed' &&
      isX01(m.gameType) &&
      m.playerIds.includes(playerId),
  );
}

/** Aggregate lifetime stats for a single player across all their matches. */
export function computePlayerOverview(
  matches: Match[],
  playerId: string,
): PlayerOverview {
  const played = completedMatchesFor(matches, playerId);
  // A solo practice game is an automatic "win" (no opponent), so win/loss is
  // only meaningful over competitive games. Scoring stats below still use every
  // game — they measure skill, not results.
  const competitive = played.filter((m) => m.playerIds.length >= 2);
  const matchesWon = competitive.filter((m) => m.winnerId === playerId).length;

  // Overall average: weight by darts thrown across every leg of every match.
  const allLegs: Leg[] = [];
  for (const m of played) allLegs.push(...m.legs);
  const overallAverage = calculateAverage(allLegs, playerId);

  let bestMatchAverage = 0;
  for (const m of played) {
    const avg = calculateAverage(m.legs, playerId);
    if (avg > bestMatchAverage) bestMatchAverage = avg;
  }

  const total180s = count180s(allLegs, playerId);
  const best = bestCheckout(allLegs, playerId);

  return {
    matchesPlayed: played.length,
    competitivePlayed: competitive.length,
    matchesWon,
    winRate: competitive.length === 0 ? 0 : (matchesWon / competitive.length) * 100,
    overallAverage,
    bestMatchAverage,
    total180s,
    bestCheckout: best,
  };
}

export interface AveragePoint {
  date: number;
  label: string;
  average: number;
}

/** Per-match 3-dart average over time (oldest → newest), for the line chart. */
export function averagePerMatch(
  matches: Match[],
  playerId: string,
): AveragePoint[] {
  const played = completedMatchesFor(matches, playerId).sort(
    (a, b) => a.date - b.date,
  );
  return played.map((m) => ({
    date: m.date,
    label: new Date(m.date).toLocaleDateString(),
    average: calculateAverage(m.legs, playerId),
  }));
}

/** Score distribution buckets for turns thrown by a player (bar chart). */
export interface ScoreDistribution {
  labels: string[];
  counts: number[];
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–40', min: 0, max: 40 },
  { label: '41–80', min: 41, max: 80 },
  { label: '81–120', min: 81, max: 120 },
  { label: '121–160', min: 121, max: 160 },
  { label: '161–180', min: 161, max: 180 },
];

export function scoreDistribution(
  matches: Match[],
  playerId: string,
): ScoreDistribution {
  const counts = new Array(BUCKETS.length).fill(0);
  const played = completedMatchesFor(matches, playerId);
  for (const m of played) {
    for (const leg of m.legs) {
      for (const turn of leg.turns) {
        if (turn.playerId !== playerId) continue;
        const score = turn.isBust ? 0 : turn.totalScore;
        const idx = BUCKETS.findIndex((b) => score >= b.min && score <= b.max);
        if (idx >= 0) counts[idx]++;
      }
    }
  }
  return { labels: BUCKETS.map((b) => b.label), counts };
}

/** Flatten all turns by a player in a single match (for breakdowns). */
export function playerTurnsInMatch(match: Match, playerId: string): Turn[] {
  const out: Turn[] = [];
  for (const leg of match.legs) {
    for (const turn of leg.turns) {
      if (turn.playerId === playerId) out.push(turn);
    }
  }
  return out;
}
