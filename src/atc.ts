import type { AtcRing, Leg, Turn } from './types';

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
      return 'Singles';
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
