import type { AtcRing, Leg, Match, Turn } from './types';

/** Target sequence: 1 → 20, then the bull (25) to finish. */
export const ATC_SEQUENCE: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25,
];
export const ATC_TARGET_COUNT = ATC_SEQUENCE.length; // 21

export function atcRingLabel(ring: AtcRing): string {
  switch (ring) {
    case 'double':
      return 'Doubles';
    case 'triple':
      return 'Trebles';
    case 'progressive':
      return 'Progressive';
    default:
      return 'Any'; // the 'single' ring counts a hit anywhere on the number
  }
}

/**
 * Display label for the *target* a player is aiming at. In single/progressive
 * the target is plain ("7"); double/triple show the required ring ("D7"/"T7").
 */
export function atcTargetLabel(target: number, ring: AtcRing): string {
  if (target === 25) {
    // There is no treble bull; a doubles game finishes on the double bull.
    return ring === 'double' ? 'DB' : 'Bull';
  }
  const prefix = ring === 'double' ? 'D' : ring === 'triple' ? 'T' : '';
  return `${prefix}${target}`;
}

function playerTurns(legs: Leg[], playerId: string): Turn[] {
  const out: Turn[] = [];
  for (const leg of legs) {
    for (const turn of leg.turns) {
      if (turn.playerId === playerId) out.push(turn);
    }
  }
  return out;
}

/**
 * How many targets the player has cleared in a leg. Each hit (dart.score === 1,
 * summed into Turn.totalScore) advances them one step; capped at the sequence
 * length, where the player has won.
 */
export function atcProgress(leg: Leg, playerId: string): number {
  let hits = 0;
  for (const turn of leg.turns) {
    if (turn.playerId === playerId) hits += turn.totalScore;
  }
  return Math.min(hits, ATC_TARGET_COUNT);
}

export function atcIsComplete(progress: number): boolean {
  return progress >= ATC_TARGET_COUNT;
}

/** The target number a player faces given how many they've cleared, or null if done. */
export function atcTargetForProgress(progress: number): number | null {
  if (progress >= ATC_TARGET_COUNT) return null;
  return ATC_SEQUENCE[progress];
}

/**
 * Progressive mode always requires the bull to finish. A numbered-target hit
 * may advance progress up to — but never past — the bull (the final target),
 * so the overshoot from a double/treble near the end (e.g. a treble 19 or 20)
 * is capped and the bull must still be hit deliberately. Returns the steps a
 * dart actually contributes given the player's current progress.
 */
export function atcProgressiveSteps(progress: number, steps: number): number {
  if (steps <= 0) return 0;
  if (ATC_SEQUENCE[progress] === 25) return steps; // already aiming at the bull
  const toBull = ATC_TARGET_COUNT - 1 - progress; // steps needed to reach the bull
  return Math.min(steps, toBull);
}

// ---- Stats ----

export function atcDartsThrown(legs: Leg[], playerId: string): number {
  return playerTurns(legs, playerId).reduce((acc, t) => acc + t.darts.length, 0);
}

/**
 * Number of darts that landed a hit. Counts darts (score > 0) rather than
 * summing Turn.totalScore, so it stays correct in progressive mode where one
 * dart can advance the target by 2 or 3.
 */
export function atcHits(legs: Leg[], playerId: string): number {
  let hits = 0;
  for (const turn of playerTurns(legs, playerId)) {
    for (const dart of turn.darts) if (dart.score > 0) hits++;
  }
  return hits;
}

export function atcHitRate(legs: Leg[], playerId: string): number {
  const darts = atcDartsThrown(legs, playerId);
  if (darts === 0) return 0;
  return (atcHits(legs, playerId) / darts) * 100;
}

/** Fewest darts the player used to complete any single leg (0 if none completed). */
export function atcFewestDartsToComplete(legs: Leg[], playerId: string): number {
  let best = 0;
  for (const leg of legs) {
    if (leg.winnerId !== playerId) continue;
    const darts = leg.turns
      .filter((t) => t.playerId === playerId)
      .reduce((acc, t) => acc + t.darts.length, 0);
    if (darts > 0 && (best === 0 || darts < best)) best = darts;
  }
  return best;
}

// ---- Cross-match analytics (per ring/variant) ----

export const ATC_RING_ORDER: readonly AtcRing[] = ['single', 'double', 'triple', 'progressive'];

function ringOf(match: Match): AtcRing {
  return match.atcRing ?? 'single';
}

function playerDartsInLeg(leg: Leg, playerId: string): number {
  return leg.turns
    .filter((t) => t.playerId === playerId)
    .reduce((acc, t) => acc + t.darts.length, 0);
}

/** Completed Around the Clock matches the player took part in, oldest → newest. */
export function atcMatchesFor(matches: Match[], playerId: string): Match[] {
  return matches
    .filter(
      (m) =>
        m.status === 'completed' &&
        m.gameType === 'AroundTheClock' &&
        m.playerIds.includes(playerId),
    )
    .sort((a, b) => a.date - b.date);
}

export interface AtcVariantStats {
  ring: AtcRing;
  played: number; // all completed games of this variant (solo included)
  competitivePlayed: number; // games of this variant with 2+ participants
  won: number; // wins among competitive games
  winRate: number; // over competitive games (0 when none)
  hitRate: number;
  fewestToClear: number; // fewest darts to clear a leg
  avgDartsToClear: number; // mean darts per leg the player won
}

/** Per-ring/variant summary across the player's Around the Clock matches. */
export function atcStatsByVariant(matches: Match[], playerId: string): AtcVariantStats[] {
  const all = atcMatchesFor(matches, playerId);
  const out: AtcVariantStats[] = [];
  for (const ring of ATC_RING_ORDER) {
    const group = all.filter((m) => ringOf(m) === ring);
    if (group.length === 0) continue;
    const legs = group.flatMap((m) => m.legs);
    // Solo games are automatic wins, so win/loss only counts competitive games.
    const competitive = group.filter((m) => m.playerIds.length >= 2);
    const won = competitive.filter((m) => m.winnerId === playerId).length;
    const wonLegDarts = legs
      .filter((l) => l.winnerId === playerId)
      .map((l) => playerDartsInLeg(l, playerId))
      .filter((d) => d > 0);
    out.push({
      ring,
      played: group.length,
      competitivePlayed: competitive.length,
      won,
      winRate: competitive.length === 0 ? 0 : (won / competitive.length) * 100,
      hitRate: atcHitRate(legs, playerId),
      fewestToClear: wonLegDarts.length ? Math.min(...wonLegDarts) : 0,
      avgDartsToClear: wonLegDarts.length
        ? wonLegDarts.reduce((a, b) => a + b, 0) / wonLegDarts.length
        : 0,
    });
  }
  return out;
}

export interface AtcMatchPoint {
  date: number;
  label: string;
  ring: AtcRing;
  hitRate: number;
  avgDartsToClear: number;
}

/** Per-match hit rate and darts-to-clear over time (for trend charts). */
export function atcPerMatch(matches: Match[], playerId: string): AtcMatchPoint[] {
  return atcMatchesFor(matches, playerId).map((m) => {
    const wonLegDarts = m.legs
      .filter((l) => l.winnerId === playerId)
      .map((l) => playerDartsInLeg(l, playerId))
      .filter((d) => d > 0);
    return {
      date: m.date,
      label: new Date(m.date).toLocaleDateString(),
      ring: ringOf(m),
      hitRate: atcHitRate(m.legs, playerId),
      avgDartsToClear: wonLegDarts.length
        ? wonLegDarts.reduce((a, b) => a + b, 0) / wonLegDarts.length
        : 0,
    };
  });
}
