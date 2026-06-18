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
