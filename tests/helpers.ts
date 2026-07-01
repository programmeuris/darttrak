import type { DartThrow, Turn, Leg, Match, GameType, AtcRing } from '../src/types';

// ---- Dart builders ----
export const dart = (score: number, label: string, isDouble = false): DartThrow => ({
  score,
  label,
  isDouble,
});
export const S = (n: number): DartThrow => dart(n, String(n));
export const D = (n: number): DartThrow => dart(n * 2, `D${n}`, true);
export const T = (n: number): DartThrow => dart(n * 3, `T${n}`);
export const MISS: DartThrow = dart(0, 'Miss');
export const BULL: DartThrow = dart(25, 'Outer');
export const DBULL: DartThrow = dart(50, 'Bull', true);

// ATC darts: score is the number of targets advanced (0 = miss).
export const atcHitDart = (n: number): DartThrow => dart(1, `✓${n}`, false);
export const atcMissDart = (n: number): DartThrow => dart(0, `✗${n}`, false);
export const atcStepDart = (n: number, steps: number): DartThrow =>
  dart(steps, steps === 0 ? `✗${n}` : steps === 2 ? `D${n}` : steps === 3 ? `T${n}` : `${n}`, false);

let legCounter = 0;

export function makeTurn(
  playerId: string,
  darts: DartThrow[],
  remainingScore: number,
  opts: { isBust?: boolean } = {},
): Turn {
  return {
    playerId,
    darts,
    totalScore: darts.reduce((a, d) => a + d.score, 0),
    remainingScore,
    isBust: opts.isBust ?? false,
    timestamp: 0,
  };
}

export function makeLeg(matchId: string, turns: Turn[], winnerId: string | null = null): Leg {
  return { id: `leg-${matchId}-${legCounter++}`, matchId, winnerId, turns };
}

export function makeMatch(
  opts: Partial<Match> & {
    id: string;
    gameType: GameType;
    playerIds: string[];
    legs: Leg[];
  },
): Match {
  return {
    id: opts.id,
    date: opts.date ?? 0,
    gameType: opts.gameType,
    playerIds: opts.playerIds,
    winnerId: opts.winnerId ?? null,
    format: opts.format ?? { legs: 1, sets: 1 },
    doubleOut: opts.doubleOut ?? true,
    atcRing: opts.atcRing as AtcRing | undefined,
    status: opts.status ?? 'completed',
    legs: opts.legs,
  };
}
