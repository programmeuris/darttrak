import { describe, it, expect } from 'vitest';
import {
  computePlayerOverview,
  averagePerMatch,
  scoreDistribution,
  playerTurnsInMatch,
  x01PersonalBests,
} from '../src/stats';
import { S, T, D, makeTurn, makeLeg, makeMatch } from './helpers';
import type { Match } from '../src/types';

const A = 'A';
const B = 'B';

// mA: A throws a single 60 visit and wins (501).
const mA: Match = makeMatch({
  id: 'mA',
  date: 1000,
  gameType: '501',
  playerIds: [A, B],
  winnerId: A,
  legs: [makeLeg('mA', [makeTurn(A, [S(20), S(20), S(20)], 441)], A)],
});

// mB: A throws a 180 visit but loses (301).
const mB: Match = makeMatch({
  id: 'mB',
  date: 2000,
  gameType: '301',
  playerIds: [A, B],
  winnerId: B,
  legs: [makeLeg('mB', [makeTurn(A, [T(20), T(20), T(20)], 121)], B)],
});

describe('computePlayerOverview', () => {
  const o = computePlayerOverview([mA, mB], A);
  it('counts matches and win rate', () => {
    expect(o.matchesPlayed).toBe(2);
    expect(o.matchesWon).toBe(1);
    expect(o.winRate).toBe(50);
  });
  it('weights overall average by darts thrown', () => {
    expect(o.overallAverage).toBeCloseTo(((60 + 180) / 6) * 3, 5); // 120
  });
  it('reports best match average and total 180s', () => {
    expect(o.bestMatchAverage).toBe(180);
    expect(o.total180s).toBe(1);
  });
  it('has no checkout when nothing finished', () => {
    expect(o.bestCheckout).toBe(0);
  });
});

describe('solo games and win rate', () => {
  // A solo practice game: A is the only participant, so A "wins" by default.
  const solo: Match = makeMatch({
    id: 'solo',
    date: 4000,
    gameType: '501',
    playerIds: [A],
    winnerId: A,
    legs: [makeLeg('solo', [makeTurn(A, [S(20), S(20), S(20)], 441)], A)],
  });

  it('counts solo games as played but not toward win/loss', () => {
    const o = computePlayerOverview([mA, mB, solo], A);
    expect(o.matchesPlayed).toBe(3); // total includes the solo game
    expect(o.competitivePlayed).toBe(2); // mA + mB
    expect(o.matchesWon).toBe(1); // mA only — the solo "win" is ignored
    expect(o.winRate).toBe(50); // 1 of 2 competitive games
  });

  it('reports no win rate when only solo games exist', () => {
    const o = computePlayerOverview([solo], A);
    expect(o.matchesPlayed).toBe(1);
    expect(o.competitivePlayed).toBe(0);
    expect(o.matchesWon).toBe(0);
    expect(o.winRate).toBe(0); // the UI renders this as “—”
  });
});

describe('averagePerMatch', () => {
  it('returns one point per match, oldest first', () => {
    const pts = averagePerMatch([mB, mA], A); // pass out of order
    expect(pts.map((p) => p.date)).toEqual([1000, 2000]);
    expect(pts[0].average).toBeCloseTo(60, 5);
    expect(pts[1].average).toBeCloseTo(180, 5);
  });
});

describe('scoreDistribution', () => {
  it('buckets visit scores', () => {
    const dist = scoreDistribution([mA, mB], A);
    expect(dist.labels).toEqual(['0–40', '41–80', '81–120', '121–160', '161–180']);
    expect(dist.counts).toEqual([0, 1, 0, 0, 1]); // 60 and 180
  });
});

describe('playerTurnsInMatch', () => {
  it('returns only that player’s turns', () => {
    expect(playerTurnsInMatch(mA, A)).toHaveLength(1);
    expect(playerTurnsInMatch(mA, B)).toHaveLength(0);
  });
});

describe('x01PersonalBests', () => {
  it('dates each record to the match it was first set in', () => {
    // mC: A wins a 301 leg in 6 darts — 180 then a 121 checkout (T20 T11 D14).
    const mC: Match = makeMatch({
      id: 'mC',
      date: 5000,
      gameType: '301',
      playerIds: [A],
      winnerId: A,
      legs: [
        makeLeg(
          'mC',
          [
            makeTurn(A, [T(20), T(20), T(20)], 121),
            makeTurn(A, [T(20), T(11), D(14)], 0),
          ],
          A,
        ),
      ],
    });
    const pb = x01PersonalBests([mA, mB, mC], A);
    // Best visit is the 180 — first thrown in mB, not displaced by mC's 180.
    expect(pb.highestTurn).toEqual({ value: 180, date: 2000 });
    // mA's fixture leg is marked won after a single 3-dart visit, so it holds
    // the fastest-leg record; mC's genuine 6-dart finish doesn't displace it.
    expect(pb.fewestDartsLeg).toEqual({ value: 3, date: 1000 });
    expect(pb.bestCheckout).toEqual({ value: 121, date: 5000 });
    // mB's single 180 visit is a 180.0 match average — still the record
    // (mC averages 150.5), so the date stays 2000.
    expect(pb.bestMatchAverage).toEqual({ value: 180, date: 2000 });
  });

  it('returns nulls with no completed data', () => {
    const pb = x01PersonalBests([], A);
    expect(pb.bestMatchAverage).toBeNull();
    expect(pb.bestCheckout).toBeNull();
    expect(pb.fewestDartsLeg).toBeNull();
    expect(pb.highestTurn).toBeNull();
  });
});

describe('x01 guard in stats', () => {
  const cricket: Match = makeMatch({
    id: 'c1',
    date: 3000,
    gameType: 'Cricket',
    playerIds: [A, B],
    winnerId: A,
    legs: [makeLeg('c1', [makeTurn(A, [S(20), S(20), S(20)], 0)], A)],
  });
  it('ignores non-x01 matches', () => {
    expect(computePlayerOverview([mA, mB, cricket], A).matchesPlayed).toBe(2);
    expect(averagePerMatch([mA, mB, cricket], A)).toHaveLength(2);
  });
});
