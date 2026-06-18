import {
  consistencyStats,
  finishingStats,
  scoringStats,
  headToHead,
} from '../src/analysis';
import { computePlayerOverview } from '../src/stats';
import type { Match, DartThrow, Turn } from '../src/types';

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
const t3 = (pid: string, score: number, remaining: number, darts: DartThrow[], isBust = false): Turn => ({
  playerId: pid,
  darts,
  totalScore: score,
  remainingScore: remaining,
  isBust,
  timestamp: 0,
});

// A: scoring 60, 100, then checkout 41 (2 darts) from 301
// visits (3-dart): 60, 100  → finishing visit excluded (2 darts)
const A = 'A';
const B = 'B';

function makeMatch(id: string, date: number, winnerId: string, legs: Match['legs']): Match {
  return {
    id,
    date,
    gameType: '301',
    playerIds: [A, B],
    winnerId,
    format: { legs: 1, sets: 1 },
    doubleOut: true,
    status: 'completed',
    legs,
  };
}

const m1: Match = makeMatch('m1', 1000, A, [
  {
    id: 'L1',
    matchId: 'm1',
    winnerId: A,
    turns: [
      // A: 301 -> 241 -> 141 -> 41 (start of finish=41<=170) -> 0 checkout 41
      t3(A, 60, 241, [d(20, '20'), d(20, '20'), d(20, '20')]),
      t3(B, 100, 201, [d(60, 'T20'), d(20, '20'), d(20, '20')]),
      t3(A, 100, 141, [d(60, 'T20'), d(20, '20'), d(20, '20')]),
      t3(B, 0, 201, [d(0, 'Miss')], true), // bust example, excluded from scoring visits
      t3(A, 100, 41, [d(60, 'T20'), d(20, '20'), d(20, '20')]),
      t3(A, 41, 0, [d(25, 'Bull'), d(16, 'D8', true)]), // 2-dart checkout 41
    ],
  },
]);

// ---- Consistency: A scoring visits = [60,100,100] (the 2-dart finish excluded) ----
const cons = consistencyStats([m1], A);
eq('consistency visits', cons.visits, 3);
eq('consistency avg', Number(cons.averageVisit.toFixed(2)), Number(((60 + 100 + 100) / 3).toFixed(2)));

// ---- Finishing: A had one opportunity (start 41) and checked out 41 ----
const fin = finishingStats([m1], A);
// Two finishable starts (141 and 41); only the 41 was taken → 50%.
eq('finishing opportunities', fin.opportunities, 2);
eq('finishing checkouts', fin.checkouts, 1);
eq('finishing pct', fin.checkoutPercent, 50);
eq('finishing best', fin.bestCheckout, 41);

// ---- Scoring: first-9 avg of A = first 3 visits (60,100,100) over 9 darts ----
const sc = scoringStats([m1], A);
eq('scoring first9', Number(sc.firstNineAverage.toFixed(2)), Number(((260) / 9 * 3).toFixed(2)));
eq('scoring over100', sc.over100, 2); // 100 and 100
eq('scoring best visit', sc.highestVisit, 100);

// ---- Head-to-head: A beat B once ----
const m2: Match = makeMatch('m2', 2000, B, [
  {
    id: 'L2',
    matchId: 'm2',
    winnerId: B,
    turns: [t3(A, 60, 241, [d(20, '20'), d(20, '20'), d(20, '20')]), t3(B, 100, 201, [d(60, 'T20'), d(20, '20'), d(20, '20')])],
  },
]);
const h2h = headToHead([m1, m2], A);
eq('h2h opponents count', h2h.length, 1);
eq('h2h opponent', h2h[0].opponentId, B);
eq('h2h played', h2h[0].played, 2);
eq('h2h won', h2h[0].won, 1);
eq('h2h lost', h2h[0].lost, 1);
eq('h2h winrate', h2h[0].winRate, 50);

// ---- Guard: non-x01 (Cricket) matches must be excluded from x01 analytics ----
const cricket: Match = {
  id: 'c1',
  date: 3000,
  gameType: 'Cricket',
  playerIds: [A, B],
  winnerId: A,
  format: { legs: 1, sets: 1 },
  doubleOut: false,
  status: 'completed',
  legs: [
    {
      id: 'CL',
      matchId: 'c1',
      winnerId: A,
      // Bogus huge "score" that would wreck x01 averages/spread if not excluded.
      turns: [t3(A, 999, 0, [d(0, 'x'), d(0, 'x'), d(0, 'x')])],
    },
  ],
};

eq('guard: consistency excludes cricket', consistencyStats([m1, cricket], A).visits, cons.visits);
eq('guard: scoring excludes cricket', scoringStats([m1, cricket], A).highestVisit, sc.highestVisit);
eq('guard: overview played excludes cricket', computePlayerOverview([m1, m2, cricket], A).matchesPlayed, 2);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) process.exit(1);
