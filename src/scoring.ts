import type { DartThrow, GameType, Leg, Turn } from './types';

/** Game types that use x01 point semantics (running total down to zero). */
export const X01_GAME_TYPES: readonly GameType[] = ['501', '301'];

/**
 * Whether a match uses x01 scoring. The current analytics (averages, checkout %,
 * distributions, consistency) all assume x01 point semantics, so non-x01 modes
 * like Cricket / Around the Clock must be excluded from them and given their own
 * metrics instead.
 */
export function isX01(gameType: GameType): boolean {
  return gameType === '501' || gameType === '301';
}

/** Starting score for the given x01 game type. */
export function startingScore(gameType: '501' | '301'): number {
  return gameType === '501' ? 501 : 301;
}

function sumDarts(darts: DartThrow[]): number {
  return darts.reduce((acc, d) => acc + d.score, 0);
}

// ---- 501 / 301 logic ----

/**
 * A bust occurs when:
 * - total scored > remaining (would go below 0)
 * - total scored === remaining but final dart is NOT a double (double-out on)
 * - remaining - total === 1 with double-out on (1 is unreachable on a double)
 */
export function isBust(
  remaining: number,
  darts: DartThrow[],
  doubleOut: boolean,
): boolean {
  if (darts.length === 0) return false;
  const total = sumDarts(darts);
  const newRemaining = remaining - total;

  if (newRemaining < 0) return true;

  if (newRemaining === 0) {
    if (doubleOut) {
      const last = darts[darts.length - 1];
      return !last.isDouble; // hit zero but not on a double → bust
    }
    return false;
  }

  if (newRemaining === 1 && doubleOut) return true;

  return false;
}

/** Check if a turn wins the leg (reaches exactly 0, on a double when required). */
export function isWinningTurn(
  remaining: number,
  darts: DartThrow[],
  doubleOut: boolean,
): boolean {
  if (darts.length === 0) return false;
  const total = sumDarts(darts);
  if (remaining - total !== 0) return false;
  if (doubleOut) {
    return darts[darts.length - 1].isDouble;
  }
  return true;
}

/** Returns the new remaining score, or null if the turn busts. */
export function applyTurn(
  remaining: number,
  darts: DartThrow[],
  doubleOut: boolean,
): number | null {
  if (isBust(remaining, darts, doubleOut)) return null;
  return remaining - sumDarts(darts);
}

export type ThrowOutcome = 'ok' | 'bust' | 'win';

/**
 * Evaluate the state of an in-progress turn after each dart, so the live
 * screen can react immediately (warn on bust, end turn on win).
 */
export function evaluateTurn(
  remaining: number,
  darts: DartThrow[],
  doubleOut: boolean,
): ThrowOutcome {
  if (isWinningTurn(remaining, darts, doubleOut)) return 'win';
  if (isBust(remaining, darts, doubleOut)) return 'bust';
  return 'ok';
}

// ---- Per-player stat calculations across legs ----

function turnsForPlayer(legs: Leg[], playerId: string): Turn[] {
  const out: Turn[] = [];
  for (const leg of legs) {
    for (const turn of leg.turns) {
      if (turn.playerId === playerId) out.push(turn);
    }
  }
  return out;
}

/** Points actually scored in a turn (0 on a bust). */
function pointsScored(turn: Turn): number {
  return turn.isBust ? 0 : turn.totalScore;
}

/** 3-dart average = (total points scored / darts thrown) * 3. */
export function calculateAverage(legs: Leg[], playerId: string): number {
  const turns = turnsForPlayer(legs, playerId);
  let points = 0;
  let darts = 0;
  for (const turn of turns) {
    points += pointsScored(turn);
    darts += turn.darts.length;
  }
  if (darts === 0) return 0;
  return (points / darts) * 3;
}

export function calculateHighestTurn(legs: Leg[], playerId: string): number {
  const turns = turnsForPlayer(legs, playerId);
  let highest = 0;
  for (const turn of turns) {
    if (!turn.isBust && turn.totalScore > highest) highest = turn.totalScore;
  }
  return highest;
}

export function count180s(legs: Leg[], playerId: string): number {
  const turns = turnsForPlayer(legs, playerId);
  return turns.filter((t) => !t.isBust && t.totalScore === 180).length;
}

/** Cumulative thresholds: over100 = score >= 100, over140 = >= 140, over180 = >= 180. */
export function countHighScores(
  legs: Leg[],
  playerId: string,
): { over100: number; over140: number; over180: number } {
  const turns = turnsForPlayer(legs, playerId);
  let over100 = 0;
  let over140 = 0;
  let over180 = 0;
  for (const turn of turns) {
    if (turn.isBust) continue;
    const s = turn.totalScore;
    if (s >= 100) over100++;
    if (s >= 140) over140++;
    if (s >= 180) over180++;
  }
  return { over100, over140, over180 };
}

/** Remaining the player faced at the start of a turn (before throwing). */
function remainingAtTurnStart(turn: Turn): number {
  return turn.remainingScore + pointsScored(turn);
}

/**
 * Checkout % = winning turns / turns where the player had <= 170 remaining at
 * the start of their turn.
 */
export function calculateCheckoutPercent(legs: Leg[], playerId: string): number {
  const turns = turnsForPlayer(legs, playerId);
  let opportunities = 0;
  let checkouts = 0;
  for (const turn of turns) {
    const start = remainingAtTurnStart(turn);
    if (start > 0 && start <= 170) {
      opportunities++;
      if (!turn.isBust && turn.remainingScore === 0) checkouts++;
    }
  }
  if (opportunities === 0) return 0;
  return (checkouts / opportunities) * 100;
}

/** Best (winning) checkout score the player has hit across the legs. */
export function bestCheckout(legs: Leg[], playerId: string): number {
  const turns = turnsForPlayer(legs, playerId);
  let best = 0;
  for (const turn of turns) {
    if (!turn.isBust && turn.remainingScore === 0 && turn.totalScore > best) {
      best = turn.totalScore;
    }
  }
  return best;
}

export function totalDartsThrown(legs: Leg[], playerId: string): number {
  return turnsForPlayer(legs, playerId).reduce(
    (acc, t) => acc + t.darts.length,
    0,
  );
}
