import { describe, it, expect } from 'vitest';
import {
  consistencyStats,
  finishingStats,
  scoringStats,
  headToHead,
} from '../src/analysis';
import { computePlayerOverview } from '../src/stats';
import { S, T, BULL, MISS, dart, makeTurn, makeLeg, makeMatch } from './helpers';
import type { Match } from '../src/types';

const A = 'A';
const B = 'B';

// A: scores 60, 100, 100, then a 2-dart checkout of 41 (301, double-out).
const m1: Match = makeMatch({
  id: 'm1',
  date: 1000,
  gameType: '301',
  playerIds: [A, B],
  winnerId: A,
  legs: [
    makeLeg(
      'm1',
      [
        makeTurn(A, [S(20), S(20), S(20)], 241), // 60
        makeTurn(B, [T(20), S(20), S(20)], 201), // 100
        makeTurn(A, [T(20), S(20), S(20)], 141), // 100
        makeTurn(B, [MISS], 201, { isBust: true }), // bust
        makeTurn(A, [T(20), S(20), S(20)], 41), // 100
        makeTurn(A, [BULL, dart(16, 'D8', true)], 0), // checkout 41
      ],
      A,
    ),
  ],
});

const m2: Match = makeMatch({
  id: 'm2',
  date: 2000,
  gameType: '301',
  playerIds: [A, B],
  winnerId: B,
  legs: [
    makeLeg(
      'm2',
      [makeTurn(A, [S(20), S(20), S(20)], 241), makeTurn(B, [T(20), S(20), S(20)], 201)],
      B,
    ),
  ],
});

describe('consistencyStats', () => {
  const c = consistencyStats([m1], A);
  it('counts only full 3-dart scoring visits', () => {
    expect(c.visits).toBe(3); // the 2-dart checkout is excluded
  });
  it('averages the scoring visits', () => {
    expect(c.averageVisit).toBeCloseTo((60 + 100 + 100) / 3, 5);
  });
});

describe('finishingStats', () => {
  const f = finishingStats([m1], A);
  it('counts every visit that started <= 170 as a chance', () => {
    // Starts of 141 (missed) and 41 (taken) both qualify.
    expect(f.opportunities).toBe(2);
    expect(f.checkouts).toBe(1);
    expect(f.checkoutPercent).toBe(50);
  });
  it('tracks best checkout', () => {
    expect(f.bestCheckout).toBe(41);
  });
});

describe('finishingStats in straight-out games', () => {
  // A leaves exactly 180 and finishes with T20 T20 T20 — legal straight-out,
  // impossible under double-out (where the cap is 170).
  const straight: Match = makeMatch({
    id: 's1',
    date: 4000,
    gameType: '501',
    doubleOut: false,
    playerIds: [A],
    winnerId: A,
    legs: [
      makeLeg(
        's1',
        [
          makeTurn(A, [T(20), T(20), T(20)], 321), // 180 → 321 left
          makeTurn(A, [T(20), T(19), dart(24, 'D12', true)], 180), // 141 → 180 left
          makeTurn(A, [T(20), T(20), T(20)], 0), // 180 checkout
        ],
        A,
      ),
    ],
  });
  // A checkout of 1 (single 1), only reachable straight-out.
  const tiny: Match = makeMatch({
    id: 's2',
    date: 5000,
    gameType: '301',
    doubleOut: false,
    playerIds: [A],
    winnerId: A,
    legs: [
      makeLeg(
        's2',
        [
          makeTurn(A, [T(20), T(20), T(20)], 121), // 180 → 121 left
          makeTurn(A, [T(20), T(20), MISS], 1), // 120 → 1 left (no bust straight-out)
          makeTurn(A, [S(1)], 0), // checkout 1
        ],
        A,
      ),
    ],
  });

  const f = finishingStats([straight, tiny], A);
  it('uses the 180 cap for straight-out matches', () => {
    // Chances: 180 (taken), 121 (missed), 1 (taken). The 180 finish would
    // not even count as a chance under the double-out cap.
    expect(f.opportunities).toBe(3);
    expect(f.checkouts).toBe(2);
    expect(f.bestCheckout).toBe(180);
  });
  it('bands cover the full 1–180 checkout range', () => {
    // 1 lands in the first band, 180 in the last — under the old 2–170
    // bands both fell outside and the chart disagreed with the checkout count.
    expect(f.bands.counts).toEqual([1, 0, 0, 1]);
    expect(f.bands.counts.reduce((a, b) => a + b, 0)).toBe(f.checkouts);
  });
  it('keeps per-match caps when pooling double-out and straight-out games', () => {
    const mixed = finishingStats([m1, straight], A);
    expect(mixed.opportunities).toBe(3); // 2 from m1 (double-out) + 1 straight-out
    expect(mixed.bestCheckout).toBe(180);
  });
});

describe('scoringStats', () => {
  const s = scoringStats([m1], A);
  it('first-9 average over the first three visits', () => {
    expect(s.firstNineAverage).toBeCloseTo((260 / 9) * 3, 5);
  });
  it('counts ton-plus visits', () => {
    expect(s.over100).toBe(2);
    expect(s.highestVisit).toBe(100);
  });
});

describe('headToHead', () => {
  const rows = headToHead([m1, m2], A);
  it('aggregates the 1-v-1 record vs each opponent', () => {
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.opponentId).toBe(B);
    expect(r.played).toBe(2);
    expect(r.won).toBe(1);
    expect(r.lost).toBe(1);
    expect(r.winRate).toBe(50);
  });
});

describe('x01 guard', () => {
  const cricket: Match = makeMatch({
    id: 'c1',
    date: 3000,
    gameType: 'Cricket',
    playerIds: [A, B],
    winnerId: A,
    legs: [makeLeg('c1', [makeTurn(A, [dart(999, 'x'), dart(0, 'x'), dart(0, 'x')], 0)], A)],
  });

  it('excludes non-x01 matches from every x01 metric', () => {
    expect(consistencyStats([m1, cricket], A).visits).toBe(consistencyStats([m1], A).visits);
    expect(scoringStats([m1, cricket], A).highestVisit).toBe(scoringStats([m1], A).highestVisit);
    expect(computePlayerOverview([m1, m2, cricket], A).matchesPlayed).toBe(2);
  });
});
