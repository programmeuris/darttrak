import {
  isBust,
  isWinningTurn,
  applyTurn,
  evaluateTurn,
  calculateAverage,
  count180s,
  calculateCheckoutPercent,
  bestCheckout,
} from '../src/scoring';
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

const d = (score: number, label: string, isDouble = false): DartThrow => ({ score, label, isDouble });

// T20 T20 T20 = 180
eq('180 not bust from 200', isBust(200, [d(60, 'T20'), d(60, 'T20'), d(60, 'T20')], true), false);
eq('180 applyTurn', applyTurn(200, [d(60, 'T20'), d(60, 'T20'), d(60, 'T20')], true), 20);

// Overshoot busts
eq('overshoot bust', isBust(20, [d(60, 'T20')], true), true);
eq('overshoot applyTurn null', applyTurn(20, [d(60, 'T20')], true), null);

// Exactly 0 but not a double (double-out on) → bust
eq('zero non-double bust', isBust(40, [d(20, '20'), d(20, '20')], true), true);
// Exactly 0 on a double → win
eq('zero double win', isWinningTurn(40, [d(40, 'D20', true)], true), true);
eq('zero double not bust', isBust(40, [d(40, 'D20', true)], true), false);

// Leaving 1 with double-out → bust
eq('leave 1 bust', isBust(41, [d(40, 'D20', true)], true), true);

// Straight out: exactly 0 on a single wins
eq('straight out win', isWinningTurn(40, [d(20, '20'), d(20, '20')], false), true);
eq('straight out not bust', isBust(40, [d(20, '20'), d(20, '20')], false), false);

// Double bull checkout 50
eq('double bull win', isWinningTurn(50, [d(50, 'DB', true)], true), true);

// evaluateTurn outcomes
eq('evaluate win', evaluateTurn(40, [d(40, 'D20', true)], true), 'win');
eq('evaluate bust', evaluateTurn(20, [d(60, 'T20')], true), 'bust');
eq('evaluate ok', evaluateTurn(100, [d(60, 'T20')], true), 'ok');

// ---- Stats ----
// Build a simple leg: player A throws 100, 100, then checks out 301.
const A = 'A';
const turns: Turn[] = [
  { playerId: A, darts: [d(60, 'T20'), d(20, '20'), d(20, '20')], totalScore: 100, remainingScore: 201, isBust: false, timestamp: 1 },
  { playerId: A, darts: [d(60, 'T20'), d(57, 'T19'), d(24, 'D12', true)], totalScore: 141, remainingScore: 60, isBust: false, timestamp: 2 },
  { playerId: A, darts: [d(60, 'T20')], totalScore: 60, remainingScore: 0, isBust: false, timestamp: 3 },
];
const leg: Leg = { id: 'L1', matchId: 'M1', winnerId: A, turns };
const legs = [leg];

// total points 301, darts 7 → avg = 301/7*3
eq('average', Number(calculateAverage(legs, A).toFixed(2)), Number((301 / 7 * 3).toFixed(2)));
eq('count180s', count180s(legs, A), 0);
eq('bestCheckout', bestCheckout(legs, A), 60);
// checkout opportunities: turns with start <=170 → turn2 start=201(no), turn3 start=60(yes, success)
// turn1 start=301 no. So 1 opportunity, 1 success = 100%
eq('checkout%', calculateCheckoutPercent(legs, A), 100);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) process.exit(1);
