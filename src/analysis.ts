import type { Match, Leg, Turn } from './types';
import { calculateAverage, checkoutCap, isX01 } from './scoring';

// ---- shared helpers ----

/**
 * Completed x01 matches that include the player, oldest → newest. Non-x01 modes
 * (Cricket / Around the Clock) are excluded — every metric here assumes x01
 * point semantics and would be skewed by them.
 */
function playerMatches(matches: Match[], playerId: string): Match[] {
  return matches
    .filter(
      (m) =>
        m.status === 'completed' &&
        isX01(m.gameType) &&
        m.playerIds.includes(playerId),
    )
    .sort((a, b) => a.date - b.date);
}

function legsOf(matches: Match[]): Leg[] {
  const out: Leg[] = [];
  for (const m of matches) out.push(...m.legs);
  return out;
}

function turnsForPlayer(legs: Leg[], playerId: string): Turn[] {
  const out: Turn[] = [];
  for (const leg of legs) {
    for (const turn of leg.turns) {
      if (turn.playerId === playerId) out.push(turn);
    }
  }
  return out;
}

function scoredPoints(turn: Turn): number {
  return turn.isBust ? 0 : turn.totalScore;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

/** Remaining the player faced at the start of a turn. */
function startRemaining(turn: Turn): number {
  return turn.remainingScore + scoredPoints(turn);
}

/** Full scoring visits: not a bust, all three darts thrown (excludes finishes). */
function scoringVisits(turns: Turn[]): number[] {
  return turns
    .filter((t) => !t.isBust && t.darts.length === 3)
    .map((t) => t.totalScore);
}

// =====================================================================
// 1. CONSISTENCY — how stable a player's scoring visits are.
// =====================================================================

export interface ConsistencyStats {
  visits: number;
  averageVisit: number; // mean 3-dart scoring visit
  stdDev: number; // lower = steadier
  coefficientOfVariation: number; // %, normalises spread by skill level
  rating: string;
  perMatch: { label: string; date: number; average: number; stdDev: number }[];
}

function consistencyRating(cv: number, sample: number): string {
  if (sample < 10) return 'Not enough data';
  if (cv < 25) return 'Very consistent';
  if (cv < 40) return 'Consistent';
  if (cv < 55) return 'Streaky';
  return 'Erratic';
}

export function consistencyStats(
  matches: Match[],
  playerId: string,
): ConsistencyStats {
  const played = playerMatches(matches, playerId);
  const allVisits = scoringVisits(turnsForPlayer(legsOf(played), playerId));
  const avg = mean(allVisits);
  const sd = stdDev(allVisits);
  const cv = avg > 0 ? (sd / avg) * 100 : 0;

  const perMatch = played
    .map((m) => {
      const visits = scoringVisits(turnsForPlayer(m.legs, playerId));
      return {
        label: dateLabel(m.date),
        date: m.date,
        average: mean(visits),
        stdDev: stdDev(visits),
      };
    })
    .filter((p) => p.average > 0);

  return {
    visits: allVisits.length,
    averageVisit: avg,
    stdDev: sd,
    coefficientOfVariation: cv,
    rating: consistencyRating(cv, allVisits.length),
    perMatch,
  };
}

// =====================================================================
// 2. FINISHING — checkout ability.
// =====================================================================

export interface FinishingStats {
  // Visits that started within checkout range for their match's rules:
  // <= 170 with double-out, <= 180 straight-out (see scoring.checkoutCap).
  opportunities: number;
  checkouts: number;
  checkoutPercent: number;
  bestCheckout: number;
  averageCheckout: number;
  bands: { labels: string[]; counts: number[] };
  perMatch: { label: string; date: number; checkoutPercent: number }[];
}

// Cover 1–180 so every legal checkout lands in a band: straight-out allows
// finishes of 1 and above 170, which double-out-only ranges would drop.
const CHECKOUT_BANDS: { label: string; min: number; max: number }[] = [
  { label: '1–40', min: 1, max: 40 },
  { label: '41–80', min: 41, max: 80 },
  { label: '81–120', min: 81, max: 120 },
  { label: '121–180', min: 121, max: 180 },
];

function finishingFor(
  turns: Turn[],
  doubleOut: boolean,
): {
  opportunities: number;
  checkouts: number;
  checkoutScores: number[];
} {
  const cap = checkoutCap(doubleOut);
  let opportunities = 0;
  let checkouts = 0;
  const checkoutScores: number[] = [];
  for (const turn of turns) {
    const start = startRemaining(turn);
    if (start > 0 && start <= cap) {
      opportunities++;
      if (!turn.isBust && turn.remainingScore === 0) {
        checkouts++;
        checkoutScores.push(turn.totalScore);
      }
    }
  }
  return { opportunities, checkouts, checkoutScores };
}

export function finishingStats(
  matches: Match[],
  playerId: string,
): FinishingStats {
  const played = playerMatches(matches, playerId);
  // Aggregate per match: the checkout range depends on each match's own
  // double-out setting, so the turns can't be pooled before counting.
  let opportunities = 0;
  let checkouts = 0;
  const checkoutScores: number[] = [];
  for (const m of played) {
    const f = finishingFor(turnsForPlayer(m.legs, playerId), m.doubleOut);
    opportunities += f.opportunities;
    checkouts += f.checkouts;
    checkoutScores.push(...f.checkoutScores);
  }

  const counts = new Array(CHECKOUT_BANDS.length).fill(0);
  for (const score of checkoutScores) {
    const idx = CHECKOUT_BANDS.findIndex((b) => score >= b.min && score <= b.max);
    if (idx >= 0) counts[idx]++;
  }

  const perMatch = played
    .map((m) => {
      const f = finishingFor(turnsForPlayer(m.legs, playerId), m.doubleOut);
      return {
        label: dateLabel(m.date),
        date: m.date,
        opportunities: f.opportunities,
        checkoutPercent:
          f.opportunities === 0 ? 0 : (f.checkouts / f.opportunities) * 100,
      };
    })
    .filter((p) => p.opportunities > 0)
    .map(({ label, date, checkoutPercent }) => ({ label, date, checkoutPercent }));

  return {
    opportunities,
    checkouts,
    checkoutPercent: opportunities === 0 ? 0 : (checkouts / opportunities) * 100,
    bestCheckout: checkoutScores.length ? Math.max(...checkoutScores) : 0,
    averageCheckout: mean(checkoutScores),
    bands: { labels: CHECKOUT_BANDS.map((b) => b.label), counts },
    perMatch,
  };
}

// =====================================================================
// 3. SCORING POWER — raw scoring output.
// =====================================================================

export interface ScoringStats {
  threeDartAverage: number;
  firstNineAverage: number; // scoring phase: first 3 visits of each leg
  tonPlusRate: number; // % of scoring visits >= 100
  highestVisit: number;
  over100: number;
  over140: number;
  over180: number;
  perMatch: { label: string; date: number; average: number; firstNine: number }[];
}

/** Average of a player's first three visits in every leg (first 9 darts). */
function firstNineAverage(legs: Leg[], playerId: string): number {
  let points = 0;
  let darts = 0;
  for (const leg of legs) {
    const playerTurns = leg.turns.filter((t) => t.playerId === playerId).slice(0, 3);
    for (const t of playerTurns) {
      points += scoredPoints(t);
      darts += t.darts.length;
    }
  }
  return darts === 0 ? 0 : (points / darts) * 3;
}

export function scoringStats(matches: Match[], playerId: string): ScoringStats {
  const played = playerMatches(matches, playerId);
  const legs = legsOf(played);
  const visits = scoringVisits(turnsForPlayer(legs, playerId));

  let over100 = 0;
  let over140 = 0;
  let over180 = 0;
  let tonPlus = 0;
  for (const v of visits) {
    if (v >= 100) {
      over100++;
      tonPlus++;
    }
    if (v >= 140) over140++;
    if (v >= 180) over180++;
  }

  const perMatch = played.map((m) => ({
    label: dateLabel(m.date),
    date: m.date,
    average: calculateAverage(m.legs, playerId),
    firstNine: firstNineAverage(m.legs, playerId),
  }));

  return {
    threeDartAverage: calculateAverage(legs, playerId),
    firstNineAverage: firstNineAverage(legs, playerId),
    tonPlusRate: visits.length === 0 ? 0 : (tonPlus / visits.length) * 100,
    highestVisit: visits.length ? Math.max(...visits) : 0,
    over100,
    over140,
    over180,
    perMatch,
  };
}

// =====================================================================
// 4. HEAD-TO-HEAD — record vs each opponent (1v1 matches only).
// =====================================================================

export interface HeadToHeadRow {
  opponentId: string;
  played: number;
  won: number;
  lost: number;
  winRate: number;
  legsFor: number;
  legsAgainst: number;
  avgFor: number;
  avgAgainst: number;
}

export function headToHead(matches: Match[], playerId: string): HeadToHeadRow[] {
  // Only true 1v1 matches give a meaningful head-to-head.
  const oneVone = playerMatches(matches, playerId).filter(
    (m) => m.playerIds.length === 2,
  );

  const byOpponent = new Map<string, Match[]>();
  for (const m of oneVone) {
    const opponentId = m.playerIds.find((id) => id !== playerId);
    if (!opponentId) continue;
    const list = byOpponent.get(opponentId) ?? [];
    list.push(m);
    byOpponent.set(opponentId, list);
  }

  const rows: HeadToHeadRow[] = [];
  for (const [opponentId, ms] of byOpponent) {
    let won = 0;
    let legsFor = 0;
    let legsAgainst = 0;
    for (const m of ms) {
      if (m.winnerId === playerId) won++;
      for (const leg of m.legs) {
        if (leg.winnerId === playerId) legsFor++;
        else if (leg.winnerId === opponentId) legsAgainst++;
      }
    }
    const allLegs = legsOf(ms);
    rows.push({
      opponentId,
      played: ms.length,
      won,
      lost: ms.length - won,
      winRate: ms.length === 0 ? 0 : (won / ms.length) * 100,
      legsFor,
      legsAgainst,
      avgFor: calculateAverage(allLegs, playerId),
      avgAgainst: calculateAverage(allLegs, opponentId),
    });
  }

  return rows.sort((a, b) => b.played - a.played);
}
