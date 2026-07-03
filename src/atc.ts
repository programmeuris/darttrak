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
    // The bull is the final target in every variant — its outer (25) and bull
    // (50) rings share one label here since a hit anywhere on it clears it (and
    // a doubles game must land the bull itself).
    return 'Bull';
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

/** Completed games of one variant the player took part in, oldest → newest. */
export function atcVariantMatches(matches: Match[], playerId: string, ring: AtcRing): Match[] {
  return atcMatchesFor(matches, playerId).filter((m) => ringOf(m) === ring);
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

export interface AtcTargetStat {
  target: number; // the number aimed at (1..20, or 25 for the bull)
  label: string; // display label for the target in this ring (e.g. "7", "D7", "Bull")
  hits: number;
  darts: number; // darts thrown while this was the live target
  hitRate: number; // 0 when no darts were thrown at this target
}

/**
 * Per-target hit rate for one variant. The dart records don't store which
 * target each dart aimed at, so we reconstruct it: within every leg we walk the
 * player's darts in throw order, and the live target is `ATC_SEQUENCE[progress]`
 * before the dart lands. A hit (score > 0) advances progress — by more than one
 * step in progressive — so the skipped targets are never counted as attempts.
 * Aggregated across all completed games of the given ring; returned in sequence
 * order with every target present (darts: 0 for targets never faced).
 */
export function atcTargetStats(
  matches: Match[],
  playerId: string,
  ring: AtcRing,
): AtcTargetStat[] {
  const hits = new Map<number, number>();
  const darts = new Map<number, number>();
  const group = atcMatchesFor(matches, playerId).filter((m) => ringOf(m) === ring);
  for (const match of group) {
    for (const leg of match.legs) {
      let progress = 0;
      for (const turn of leg.turns) {
        if (turn.playerId !== playerId) continue;
        for (const d of turn.darts) {
          if (progress >= ATC_TARGET_COUNT) break;
          const target = ATC_SEQUENCE[progress];
          darts.set(target, (darts.get(target) ?? 0) + 1);
          if (d.score > 0) hits.set(target, (hits.get(target) ?? 0) + 1);
          progress += d.score;
        }
      }
    }
  }
  return ATC_SEQUENCE.map((target) => {
    const n = darts.get(target) ?? 0;
    const h = hits.get(target) ?? 0;
    return {
      target,
      label: atcTargetLabel(target, ring),
      hits: h,
      darts: n,
      hitRate: n === 0 ? 0 : (h / n) * 100,
    };
  });
}

export interface AtcVariantSeries {
  ring: AtcRing;
  // One point per LEG the player threw in, oldest match first with legs in
  // play order. The leg is the unit here because "darts to finish" only means
  // something per attempt at the board — pooling a best-of-3 match would make
  // the number depend on the format, not the throwing. `cleared` is per leg:
  // false when the leg ended (opponent finished) before the player cleared,
  // i.e. `darts` is a truncated count rather than a real throws-to-finish.
  points: { date: number; label: string; hitRate: number; darts: number; cleared: boolean }[];
}

export interface AtcBest {
  value: number;
  date: number; // date of the match in which the record was set
}

export interface AtcPersonalBests {
  fewestDarts: AtcBest | null; // fewest darts to clear the board
  bestLegHitRate: AtcBest | null; // best hit % over a single cleared leg
}

/**
 * Personal bests for one variant, with the date each record was first set.
 * Only cleared legs count — they're the complete, comparable attempts (an
 * abandoned two-dart leg could otherwise "hold" a 100% hit-rate record).
 */
export function atcPersonalBests(
  matches: Match[],
  playerId: string,
  ring: AtcRing,
): AtcPersonalBests {
  let fewest: AtcBest | null = null;
  let bestRate: AtcBest | null = null;
  for (const m of atcVariantMatches(matches, playerId, ring)) {
    for (const leg of m.legs) {
      if (leg.winnerId !== playerId) continue;
      const darts = playerDartsInLeg(leg, playerId);
      if (darts === 0) continue;
      if (!fewest || darts < fewest.value) fewest = { value: darts, date: m.date };
      const rate = atcHitRate([leg], playerId);
      if (!bestRate || rate > bestRate.value) bestRate = { value: rate, date: m.date };
    }
  }
  return { fewestDarts: fewest, bestLegHitRate: bestRate };
}

export interface AtcTargetTrend {
  target: number;
  delta: number | null; // recent-half hit % minus earlier-half; null = not enough data
}

/**
 * Per-area improvement: hit % over the recent half of the variant's games
 * minus the earlier half, per target. Requires `minDarts` attempts at the
 * target in BOTH halves — a delta computed from a handful of darts is noise,
 * so those show null instead. Returned in sequence order.
 */
export function atcTargetTrends(
  matches: Match[],
  playerId: string,
  ring: AtcRing,
  minDarts = 5,
): AtcTargetTrend[] {
  const ms = atcVariantMatches(matches, playerId, ring);
  const half = Math.floor(ms.length / 2);
  const early = half >= 1 ? atcTargetStats(ms.slice(0, half), playerId, ring) : null;
  const recent = half >= 1 ? atcTargetStats(ms.slice(half), playerId, ring) : null;
  return ATC_SEQUENCE.map((target, i) => {
    const e = early?.[i];
    const r = recent?.[i];
    const enough = e && r && e.darts >= minDarts && r.darts >= minDarts;
    return { target, delta: enough ? r.hitRate - e.hitRate : null };
  });
}

/**
 * Per-leg series split by variant, each indexed by its own leg count rather
 * than a shared date axis. This lets the chart align every variant at leg 1
 * (instead of interleaving them by date, which collides on same-day games).
 * Returned in ring order; rings with no games are omitted.
 */
export function atcSeriesByVariant(matches: Match[], playerId: string): AtcVariantSeries[] {
  const out: AtcVariantSeries[] = [];
  for (const ring of ATC_RING_ORDER) {
    const pts: AtcVariantSeries['points'] = [];
    for (const m of atcVariantMatches(matches, playerId, ring)) {
      const dateLabel = new Date(m.date).toLocaleDateString();
      m.legs.forEach((leg, i) => {
        const darts = playerDartsInLeg(leg, playerId);
        if (darts === 0) return; // a leg the player never threw in isn't an attempt
        pts.push({
          date: m.date,
          label: m.legs.length > 1 ? `${dateLabel} · Leg ${i + 1}` : dateLabel,
          hitRate: atcHitRate([leg], playerId),
          darts,
          cleared: leg.winnerId === playerId,
        });
      });
    }
    if (pts.length) out.push({ ring, points: pts });
  }
  return out;
}
