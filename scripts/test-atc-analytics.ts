import { atcStatsByVariant, atcPerMatch } from '../src/atc';
import type { Match, DartThrow, Turn, AtcRing } from '../src/types';

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

const A = 'A';
const B = 'B';
const hit = (n: number): DartThrow => ({ score: 1, label: `✓${n}`, isDouble: false });
const miss = (n: number): DartThrow => ({ score: 0, label: `✗${n}`, isDouble: false });
const turn = (pid: string, darts: DartThrow[], progress: number): Turn => ({
  playerId: pid,
  darts,
  totalScore: darts.reduce((a, d) => a + d.score, 0),
  remainingScore: progress,
  isBust: false,
  timestamp: 0,
});

// A clears all 21 in 21 darts (7 perfect turns); B doesn't.
function clearLeg(winner: string): Match['legs'][number] {
  const turns: Turn[] = [];
  let prog = 0;
  for (let t = 0; t < 7; t++) {
    const darts = [hit(prog + 1), hit(prog + 2), hit(prog + 3)];
    prog += 3;
    turns.push(turn(winner, darts, prog));
  }
  return { id: `L-${winner}`, matchId: 'm', winnerId: winner, turns };
}

function atcMatch(id: string, date: number, ring: AtcRing, winnerId: string): Match {
  return {
    id,
    date,
    gameType: 'AroundTheClock',
    playerIds: [A, B],
    winnerId,
    format: { legs: 1, sets: 1 },
    doubleOut: false,
    atcRing: ring,
    status: 'completed',
    legs: [clearLeg(winnerId)],
  };
}

// A wins a singles match and a progressive match; loses a doubles match.
const m1 = atcMatch('m1', 1000, 'single', A);
const m2 = atcMatch('m2', 2000, 'progressive', A);
const m3 = atcMatch('m3', 3000, 'double', B);

// Add one miss for A in the doubles match so A's hit rate < 100 there.
m3.legs[0].turns.push(turn(A, [miss(1), miss(1)], 0));

const variants = atcStatsByVariant([m1, m2, m3], A);
eq('variant count', variants.length, 3);
// Order is single, double, triple, progressive → here single, double, progressive
eq('variant order', variants.map((v) => v.ring), ['single', 'double', 'progressive']);

const single = variants.find((v) => v.ring === 'single')!;
eq('single played', single.played, 1);
eq('single won', single.won, 1);
eq('single winRate', single.winRate, 100);
eq('single hitRate', single.hitRate, 100);
eq('single fewest', single.fewestToClear, 21);
eq('single avg darts', single.avgDartsToClear, 21);

const dbl = variants.find((v) => v.ring === 'double')!;
eq('double played', dbl.played, 1);
eq('double won', dbl.won, 0);
eq('double fewest (none won)', dbl.fewestToClear, 0);

// Non-x01 guard sanity: A x01-less here; perMatch returns 3 ATC points sorted.
const points = atcPerMatch([m3, m1, m2], A);
eq('perMatch count', points.length, 3);
eq('perMatch sorted asc', points.map((p) => p.date), [1000, 2000, 3000]);
eq('perMatch rings', points.map((p) => p.ring), ['single', 'progressive', 'double']);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) process.exit(1);
