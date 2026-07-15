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
}

export function newTrainingState(random?: () => number): TrainingState {
  const bag = shuffledBag(random);
  return { target: bag.shift()!, bag };
}

/**
 * Draw the next target, or null when the bag is spent — the round is
 * complete (the caller finalises the record; a new round gets a new bag).
 */
export function advanceTraining(state: TrainingState): TrainingState | null {
  if (state.bag.length === 0) return null;
  const bag = [...state.bag];
  return { target: bag.shift()!, bag };
}

// ---- Stats ----

export interface TrainingAttempt {
  target: string; // field id
  darts: number; // throws taken so far (including the hit when resolved)
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
  const out: TrainingAttempt[] = [];
  for (const leg of match.legs) {
    for (const turn of leg.turns) {
      if (turn.darts.length === 0) continue;
      out.push({
        target: fieldIdFromLabel(turn.darts[0].label),
        darts: turn.darts.length,
        resolved: turn.darts[turn.darts.length - 1].score > 0,
        timestamp: turn.timestamp,
      });
    }
  }
  return out;
}

export interface TrainingRound {
  date: number;
  label: string;
  complete: boolean; // all fields hit (the record is a finished round)
  attempts: number; // attempts with at least one dart, unresolved included
  resolved: number; // targets actually hit
  darts: number; // total darts thrown this round
  avgDarts: number; // mean darts per RESOLVED target — unbiased mid-round too
  firstDartHitRate: number; // % of attempts hit with the very first dart
}

/** Per-round stats, oldest first. */
export function trainingRounds(matches: Match[], playerId: string): TrainingRound[] {
  return trainingMatchesFor(matches, playerId).map((m) => {
    const attempts = trainingAttempts(m);
    const resolved = attempts.filter((a) => a.resolved);
    const firstDartHits = resolved.filter((a) => a.darts === 1).length;
    return {
      date: m.date,
      label: new Date(m.date).toLocaleDateString(),
      complete: m.status === 'completed',
      attempts: attempts.length,
      resolved: resolved.length,
      darts: attempts.reduce((acc, a) => acc + a.darts, 0),
      avgDarts: resolved.length
        ? resolved.reduce((acc, a) => acc + a.darts, 0) / resolved.length
        : 0,
      firstDartHitRate: attempts.length ? (firstDartHits / attempts.length) * 100 : 0,
    };
  });
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

export function isTrainingTurnOpen(turn: Turn | undefined): boolean {
  return !!turn && turn.darts.length > 0 && turn.darts[turn.darts.length - 1].score === 0;
}
