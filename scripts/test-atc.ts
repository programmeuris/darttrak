import {
  ATC_SEQUENCE,
  ATC_TARGET_COUNT,
  atcTargetLabel,
  atcProgress,
  atcIsComplete,
  atcTargetForProgress,
  atcDartsThrown,
  atcHits,
  atcHitRate,
  atcFewestDartsToComplete,
} from '../src/atc';
import type { DartThrow, Leg, Turn } from '../src/types';

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ---- Sequence & labels ----
eq('sequence length', ATC_TARGET_COUNT, 21);
eq('sequence ends on bull', ATC_SEQUENCE[ATC_TARGET_COUNT - 1], 25);
eq('label single 7', atcTargetLabel(7, 'single'), '7');
eq('label double 7', atcTargetLabel(7, 'double'), 'D7');
eq('label treble 7', atcTargetLabel(7, 'triple'), 'T7');
eq('label single bull', atcTargetLabel(25, 'single'), 'Bull');
eq('label double bull', atcTargetLabel(25, 'double'), 'DB');
eq('label triple bull falls back to Bull', atcTargetLabel(25, 'triple'), 'Bull');

// ---- Progress / target ----
eq('target at start', atcTargetForProgress(0), 1);
eq('target after 6 cleared', atcTargetForProgress(6), 7);
eq('target when done', atcTargetForProgress(21), null);
eq('complete at 21', atcIsComplete(21), true);
eq('not complete at 20', atcIsComplete(20), false);

const A = 'A';
const B = 'B';
const hit = (target: number): DartThrow => ({ score: 1, label: `✓${target}`, isDouble: false });
const miss = (target: number): DartThrow => ({ score: 0, label: `✗${target}`, isDouble: false });
const turn = (pid: string, darts: DartThrow[], progress: number): Turn => ({
  playerId: pid,
  darts,
  totalScore: darts.reduce((a, d) => a + d.score, 0),
  remainingScore: progress,
  isBust: false,
  timestamp: 0,
});

// A: turn1 hits 1,2,3 (progress 3); turn2 hits 4, miss 5, hit 5 (progress 5)
const leg: Leg = {
  id: 'L1',
  matchId: 'M1',
  winnerId: null,
  turns: [
    turn(A, [hit(1), hit(2), hit(3)], 3),
    turn(B, [hit(1), miss(2), hit(2)], 2),
    turn(A, [hit(4), miss(5), hit(5)], 5),
  ],
};

eq('progress A', atcProgress(leg, A), 5);
eq('progress B', atcProgress(leg, B), 2);
eq('darts thrown A', atcDartsThrown([leg], A), 6);
eq('hits A', atcHits([leg], A), 5);
eq('hit rate A', Number(atcHitRate([leg], A).toFixed(1)), Number(((5 / 6) * 100).toFixed(1)));

// ---- Fewest darts to complete: B clears all 21 in a won leg ----
const fullDarts: DartThrow[] = [];
for (let i = 0; i < ATC_TARGET_COUNT; i++) fullDarts.push(hit(ATC_SEQUENCE[i]));
// 21 hits across 7 turns of 3
const wonLeg: Leg = {
  id: 'L2',
  matchId: 'M1',
  winnerId: B,
  turns: [
    turn(B, fullDarts.slice(0, 3), 3),
    turn(B, fullDarts.slice(3, 6), 6),
    turn(B, fullDarts.slice(6, 9), 9),
    turn(B, fullDarts.slice(9, 12), 12),
    turn(B, fullDarts.slice(12, 15), 15),
    turn(B, fullDarts.slice(15, 18), 18),
    turn(B, fullDarts.slice(18, 21), 21),
  ],
};
eq('fewest to clear B', atcFewestDartsToComplete([wonLeg], B), 21);
eq('fewest to clear A (none)', atcFewestDartsToComplete([wonLeg], A), 0);

// ---- Progressive advancement: single +1, double +2, treble +3 ----
// Start on target 4 (progress 3). Treble of 5 from progress 4 → +3.
const step = (target: number, steps: number): DartThrow => ({
  score: steps,
  label: steps === 0 ? `✗${target}` : steps === 2 ? `D${target}` : steps === 3 ? `T${target}` : `${target}`,
  isDouble: false,
});
// Progressive: hit 1 (+1 → progress 1), double 2 (+2 → progress 3), treble 4 (+3 → progress 6)
const progLeg: Leg = {
  id: 'P1',
  matchId: 'M1',
  winnerId: null,
  turns: [
    turn(A, [step(1, 1), step(2, 2), step(4, 3)], 6), // 1 + 2 + 3 = 6 advanced
  ],
};
eq('progressive progress', atcProgress(progLeg, A), 6);
// Three darts, all hits (score > 0) → 3 hits even though 6 targets cleared.
eq('progressive hits counts darts', atcHits([progLeg], A), 3);
eq('progressive darts thrown', atcDartsThrown([progLeg], A), 3);
// Double on target 4 → +2 → next target index 5 → number 6 (the user's rule).
eq('double advances +2', atcTargetForProgress(3 + 2), 6);
// Treble on target 5 (index 4) → +3 → next index 7 → number 8.
eq('treble advances +3', atcTargetForProgress(4 + 3), 8);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) process.exit(1);
