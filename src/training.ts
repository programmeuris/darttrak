/**
 * Training mode engine + stats. Solo, endless target practice: a shuffle bag
 * deals every board field once in random order; the player throws at the
 * current field until they hit it, however long that takes. Hitting all 62
 * fields completes a ROUND — the unit of the analytics, since every round
 * covers the identical field set and rounds are therefore directly
 * comparable — and the next throw seamlessly starts a fresh bag.
 *
 * One match record per round. Each target attempt is one Turn: its darts are
 * the misses-then-hit sequence with the field encoded in the labels
 * ('✗T18' … '✓T18') — targets are random, so unlike Around the Clock they
 * can't be reconstructed and must be stored. Pure logic, no React.
 */

import type { Match, Turn } from './types';

/** All 62 practice fields: S/D/T × 1–20 plus the outer (S25) and bull (D25). */
export const TRAINING_FIELDS: readonly string[] = (() => {
  const out: string[] = [];
  for (const ring of ['S', 'D', 'T'] as const) {
    for (let n = 1; n <= 20; n++) out.push(`${ring}${n}`);
  }
  out.push('S25', 'D25');
  return out;
})();

export const TRAINING_FIELD_COUNT = TRAINING_FIELDS.length; // 62

// ---- Variants ----
// Kitchen Sink ('sink'): throw at the target until you hit it, then move on —
// everything AND the kitchen sink, once. Group Therapy ('group'): exactly
// GROUP_VISIT_DARTS darts at every target, hit or miss, then move on; the
// score is how many of the visit landed. Same bag, same records.

export type TrainingVariant = 'sink' | 'group';

export const TRAINING_VARIANT_LABELS: Record<TrainingVariant, string> = {
  sink: 'Kitchen Sink',
  group: 'Group Therapy',
};

/** Darts per visit in Group Therapy: throw all three, then move on. */
export const GROUP_VISIT_DARTS = 3;

/** Records predating the variant field are Kitchen Sink rounds. */
export function trainingVariantOf(match: Match): TrainingVariant {
  return match.training?.variant === 'group' ? 'group' : 'sink';
}

/** Display label, matching the app's convention: plain = single. */
export function trainingFieldLabel(id: string): string {
  if (id === 'S25') return 'Outer';
  if (id === 'D25') return 'Bull';
  return id.startsWith('S') ? id.slice(1) : id;
}

/** Inverse of the dart labels ('✗T18' / '✓Outer' → field id). */
export function fieldIdFromLabel(label: string): string {
  const raw = label.replace(/^[✗✓]/, '');
  if (raw === 'Outer') return 'S25';
  if (raw === 'Bull') return 'D25';
  return raw.startsWith('D') || raw.startsWith('T') ? raw : `S${raw}`;
}

/** Fisher–Yates over the full field pool; injectable randomness for tests. */
export function shuffledBag(random: () => number = Math.random): string[] {
  const bag = [...TRAINING_FIELDS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export interface TrainingState {
  target: string;
  bag: string[]; // fields still to come this round
  // The NEXT round's full order, dealt when this one completes. Generated up
  // front so the live screen can preview targets across the round boundary;
  // optional because records predating the target wheel lack it (healed on
  // load). Its first field never equals this round's last (see nextRoundBag).
  nextBag?: string[];
  // Which training variant this round is; missing means Kitchen Sink
  // (records predate the field — read through trainingVariantOf).
  variant?: TrainingVariant;
}

/** The final field of the round in its current order (the seam's left side). */
export function lastFieldOf(state: Pick<TrainingState, 'target' | 'bag'>): string {
  return state.bag.length ? state.bag[state.bag.length - 1] : state.target;
}

/**
 * The order the round AFTER this one will be dealt in. A plain reshuffle,
 * except it may not open with `lastOfCurrent`: back-to-back rounds would
 * otherwise repeat a target across the seam and the wheel couldn't show a
 * break. Rejection keeps the draw uniform over the allowed orderings (and
 * rejects only 1-in-62 shuffles).
 */
export function nextRoundBag(
  lastOfCurrent: string,
  random: () => number = Math.random,
): string[] {
  let bag = shuffledBag(random);
  while (bag[0] === lastOfCurrent) bag = shuffledBag(random);
  return bag;
}

export function newTrainingState(
  random?: () => number,
  variant: TrainingVariant = 'sink',
): TrainingState {
  const bag = shuffledBag(random);
  const target = bag.shift()!;
  return { target, bag, nextBag: nextRoundBag(lastFieldOf({ target, bag }), random), variant };
}

/**
 * Draw the next target, or null when the bag is spent — the round is
 * complete (the caller finalises the record; a new round gets a new bag).
 */
export function advanceTraining(state: TrainingState): TrainingState | null {
  if (state.bag.length === 0) return null;
  const bag = [...state.bag];
  return { target: bag.shift()!, bag, nextBag: state.nextBag, variant: state.variant };
}

// ---- Stats ----

export interface TrainingAttempt {
  target: string; // field id
  darts: number; // throws taken so far (including the hit when resolved)
  hits: number; // scored darts (0 or 1 in Kitchen Sink; 0–3 in Group Therapy)
  firstHit: boolean; // the very first dart of the attempt landed
  resolved: boolean; // false = the live target of an in-progress round
  timestamp: number;
}

/** Completed and in-progress training rounds for a player, oldest first. */
export function trainingMatchesFor(matches: Match[], playerId: string): Match[] {
  // Unlike the other modes, in_progress records count: the live round is
  // valid data (the bag deals a uniformly random subset, so its per-target
  // figures are unbiased) and should show in the stats immediately.
  return matches
    .filter((m) => m.gameType === 'Training' && m.playerIds.includes(playerId))
    .sort((a, b) => a.date - b.date);
}

export function trainingAttempts(match: Match): TrainingAttempt[] {
  const variant = trainingVariantOf(match);
  const out: TrainingAttempt[] = [];
  for (const leg of match.legs) {
    for (const turn of leg.turns) {
      if (turn.darts.length === 0) continue;
      out.push({
        target: fieldIdFromLabel(turn.darts[0].label),
        darts: turn.darts.length,
        hits: turn.darts.filter((d) => d.score > 0).length,
        firstHit: turn.darts[0].score > 0,
        // Kitchen Sink attempts end on the hit; Group Therapy visits end
        // when all their darts are thrown, hit or not.
        resolved:
          variant === 'group'
            ? turn.darts.length >= GROUP_VISIT_DARTS
            : turn.darts[turn.darts.length - 1].score > 0,
        timestamp: turn.timestamp,
      });
    }
  }
  return out;
}

export interface TrainingRound {
  date: number;
  label: string;
  complete: boolean; // all fields visited (the record is a finished round)
  attempts: number; // attempts with at least one dart, unresolved included
  resolved: number; // targets hit (Kitchen Sink) / visits completed (Group)
  darts: number; // total darts thrown this round
  hits: number; // total scored darts this round
  avgDarts: number; // mean darts per RESOLVED target — unbiased mid-round too
  avgHits: number; // mean hits per RESOLVED visit (the Group Therapy score)
  firstDartHitRate: number; // % of attempts whose very first dart landed
}

/** Per-round stats, oldest first. */
export function trainingRounds(matches: Match[], playerId: string): TrainingRound[] {
  return trainingMatchesFor(matches, playerId).map((m) => {
    const attempts = trainingAttempts(m);
    const resolved = attempts.filter((a) => a.resolved);
    const firstDartHits = attempts.filter((a) => a.firstHit).length;
    return {
      date: m.date,
      label: new Date(m.date).toLocaleDateString(),
      complete: m.status === 'completed',
      attempts: attempts.length,
      resolved: resolved.length,
      darts: attempts.reduce((acc, a) => acc + a.darts, 0),
      hits: attempts.reduce((acc, a) => acc + a.hits, 0),
      avgDarts: resolved.length
        ? resolved.reduce((acc, a) => acc + a.darts, 0) / resolved.length
        : 0,
      avgHits: resolved.length
        ? resolved.reduce((acc, a) => acc + a.hits, 0) / resolved.length
        : 0,
      firstDartHitRate: attempts.length ? (firstDartHits / attempts.length) * 100 : 0,
    };
  });
}

/** Most hits in a completed round — the Group Therapy personal best. */
export function trainingBestHitsRound(
  matches: Match[],
  playerId: string,
): { value: number; date: number } | null {
  let best: { value: number; date: number } | null = null;
  for (const round of trainingRounds(matches, playerId)) {
    if (!round.complete) continue;
    if (!best || round.hits > best.value) best = { value: round.hits, date: round.date };
  }
  return best;
}

/** Fewest darts to clear the whole board, with the round's date (null until a round completes). */
export function trainingBestRound(
  matches: Match[],
  playerId: string,
): { value: number; date: number } | null {
  let best: { value: number; date: number } | null = null;
  for (const round of trainingRounds(matches, playerId)) {
    if (!round.complete) continue;
    if (!best || round.darts < best.value) best = { value: round.darts, date: round.date };
  }
  return best;
}

export interface TrainingFieldStat {
  id: string;
  label: string;
  darts: number; // darts thrown while this field was the target
  hits: number;
  hitRate: number; // 0 when never attempted
}

/** Per-field hit rate across all training, every field present (darts: 0 when never dealt). */
export function trainingFieldStats(matches: Match[], playerId: string): TrainingFieldStat[] {
  const darts = new Map<string, number>();
  const hits = new Map<string, number>();
  for (const m of trainingMatchesFor(matches, playerId)) {
    for (const leg of m.legs) {
      for (const turn of leg.turns) {
        for (const d of turn.darts) {
          const id = fieldIdFromLabel(d.label);
          darts.set(id, (darts.get(id) ?? 0) + 1);
          if (d.score > 0) hits.set(id, (hits.get(id) ?? 0) + 1);
        }
      }
    }
  }
  return TRAINING_FIELDS.map((id) => {
    const n = darts.get(id) ?? 0;
    const h = hits.get(id) ?? 0;
    return {
      id,
      label: trainingFieldLabel(id),
      darts: n,
      hits: h,
      hitRate: n === 0 ? 0 : (h / n) * 100,
    };
  });
}

/**
 * Whether the last turn is still this target's live attempt: Kitchen Sink
 * attempts stay open until a dart lands; Group Therapy visits stay open
 * until all their darts are thrown.
 */
export function isTrainingTurnOpen(
  turn: Turn | undefined,
  variant: TrainingVariant = 'sink',
): boolean {
  if (!turn || turn.darts.length === 0) return false;
  if (variant === 'group') return turn.darts.length < GROUP_VISIT_DARTS;
  return turn.darts[turn.darts.length - 1].score === 0;
}

// ---- Ring aggregates ----

export type TrainingRing = 'all' | 'single' | 'double' | 'treble' | 'outer' | 'bull';

export interface TrainingRingStat {
  ring: TrainingRing;
  label: string;
  darts: number; // darts spent on resolved targets in this ring
  resolved: number; // resolved attempts (targets hit / visits completed)
  avgDarts: number | null; // darts per hit target; null until something resolved
  avgHits: number | null; // hits per completed visit (the Group Therapy score)
}

const RING_DEFS: readonly { ring: TrainingRing; label: string }[] = [
  { ring: 'all', label: 'All Targets' },
  { ring: 'single', label: 'Singles' },
  { ring: 'double', label: 'Doubles' },
  { ring: 'treble', label: 'Trebles' },
  { ring: 'outer', label: 'Outer' },
  { ring: 'bull', label: 'Bull' },
];

/** Outer and bull count as their own rings, not as a single/double. */
export function trainingRingOf(fieldId: string): TrainingRing {
  if (fieldId === 'S25') return 'outer';
  if (fieldId === 'D25') return 'bull';
  return fieldId.startsWith('D') ? 'double' : fieldId.startsWith('T') ? 'treble' : 'single';
}

/**
 * Average darts to hit a target, split by ring (plus the all-rings figure).
 * Resolved attempts only, like the headline Avg Darts / Target — an open
 * attempt's cost isn't known yet. Note this is exactly 1 / hit-rate over the
 * same darts; it's kept in darts because that's the unit training scores in.
 */
export function trainingRingAverages(matches: Match[], playerId: string): TrainingRingStat[] {
  const darts = new Map<TrainingRing, number>();
  const resolved = new Map<TrainingRing, number>();
  const hits = new Map<TrainingRing, number>();
  for (const m of trainingMatchesFor(matches, playerId)) {
    for (const a of trainingAttempts(m)) {
      if (!a.resolved) continue;
      for (const ring of ['all', trainingRingOf(a.target)] as const) {
        darts.set(ring, (darts.get(ring) ?? 0) + a.darts);
        resolved.set(ring, (resolved.get(ring) ?? 0) + 1);
        hits.set(ring, (hits.get(ring) ?? 0) + a.hits);
      }
    }
  }
  return RING_DEFS.map(({ ring, label }) => {
    const d = darts.get(ring) ?? 0;
    const r = resolved.get(ring) ?? 0;
    const h = hits.get(ring) ?? 0;
    return {
      ring,
      label,
      darts: d,
      resolved: r,
      avgDarts: r ? d / r : null,
      avgHits: r ? h / r : null,
    };
  });
}

/**
 * Per-field improvement: hit % over the player's recent rounds minus their
 * earlier ones (the training twin of atcTargetTrends). By default the rounds
 * split into halves — maximum sample, but ever-less responsive as history
 * grows. Passing `window` compares the last `window` rounds against the
 * `window` before them instead, which stays equally sensitive forever; while
 * the history can't fill both windows it falls back to the halves split.
 * Either way a field needs `minDarts` on BOTH sides — a delta computed from
 * a handful of darts is noise, so those show null. Keyed by field id.
 */
export function trainingFieldTrends(
  matches: Match[],
  playerId: string,
  minDarts = 5,
  window: number | null = null,
): Map<string, number | null> {
  const ms = trainingMatchesFor(matches, playerId);
  let early: TrainingFieldStat[] | null = null;
  let recent: TrainingFieldStat[] | null = null;
  if (window != null && window >= 1 && ms.length >= window * 2) {
    early = trainingFieldStats(ms.slice(-2 * window, -window), playerId);
    recent = trainingFieldStats(ms.slice(-window), playerId);
  } else {
    const half = Math.floor(ms.length / 2);
    early = half >= 1 ? trainingFieldStats(ms.slice(0, half), playerId) : null;
    recent = half >= 1 ? trainingFieldStats(ms.slice(half), playerId) : null;
  }
  const out = new Map<string, number | null>();
  TRAINING_FIELDS.forEach((id, i) => {
    const e = early?.[i];
    const r = recent?.[i];
    const enough = e && r && e.darts >= minDarts && r.darts >= minDarts;
    out.set(id, enough ? r.hitRate - e.hitRate : null);
  });
  return out;
}

/**
 * The fields most in need of practice: lowest hit % among fields with at
 * least `minDarts` thrown (a bad rate off two darts is noise, not a weak
 * field), weakest first, ties broken toward the bigger sample.
 */
export function trainingWeakFields(
  matches: Match[],
  playerId: string,
  count = 5,
  minDarts = 5,
): TrainingFieldStat[] {
  return trainingFieldStats(matches, playerId)
    .filter((f) => f.darts >= minDarts)
    .sort((a, b) => a.hitRate - b.hitRate || b.darts - a.darts)
    .slice(0, count);
}
