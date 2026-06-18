import { describe, it, expect } from 'vitest';
import {
  isBust,
  isWinningTurn,
  applyTurn,
  evaluateTurn,
  startingScore,
  isX01,
  calculateAverage,
  calculateHighestTurn,
  count180s,
  countHighScores,
  calculateCheckoutPercent,
  bestCheckout,
  totalDartsThrown,
} from '../src/scoring';
import { S, D, T, DBULL, makeTurn, makeLeg } from './helpers';

describe('startingScore / isX01', () => {
  it('maps 501 and 301', () => {
    expect(startingScore('501')).toBe(501);
    expect(startingScore('301')).toBe(301);
  });
  it('isX01 only for 501/301', () => {
    expect(isX01('501')).toBe(true);
    expect(isX01('301')).toBe(true);
    expect(isX01('Cricket')).toBe(false);
    expect(isX01('AroundTheClock')).toBe(false);
  });
});

describe('isBust', () => {
  it('no darts is never a bust', () => {
    expect(isBust(100, [], true)).toBe(false);
  });
  it('180 from 200 is fine', () => {
    expect(isBust(200, [T(20), T(20), T(20)], true)).toBe(false);
  });
  it('overshooting below zero busts', () => {
    expect(isBust(20, [T(20)], true)).toBe(true);
  });
  it('landing on zero without a double busts when double-out is on', () => {
    expect(isBust(40, [S(20), S(20)], true)).toBe(true);
  });
  it('landing on zero with a double does not bust', () => {
    expect(isBust(40, [D(20)], true)).toBe(false);
  });
  it('leaving exactly 1 busts under double-out', () => {
    expect(isBust(41, [D(20)], true)).toBe(true);
  });
  it('landing on zero without a double is allowed when double-out is off', () => {
    expect(isBust(40, [S(20), S(20)], false)).toBe(false);
  });
});

describe('isWinningTurn', () => {
  it('double finish wins', () => {
    expect(isWinningTurn(40, [D(20)], true)).toBe(true);
  });
  it('double bull (50) wins', () => {
    expect(isWinningTurn(50, [DBULL], true)).toBe(true);
  });
  it('single finish wins only with double-out off', () => {
    expect(isWinningTurn(40, [S(20), S(20)], false)).toBe(true);
    expect(isWinningTurn(40, [S(20), S(20)], true)).toBe(false);
  });
  it('not reaching zero is not a win', () => {
    expect(isWinningTurn(60, [D(20)], true)).toBe(false);
  });
});

describe('applyTurn', () => {
  it('returns new remaining for a valid turn', () => {
    expect(applyTurn(200, [T(20), T(20), T(20)], true)).toBe(20);
  });
  it('returns null on a bust', () => {
    expect(applyTurn(20, [T(20)], true)).toBeNull();
  });
  it('returns 0 on a valid checkout', () => {
    expect(applyTurn(40, [D(20)], true)).toBe(0);
  });
});

describe('evaluateTurn', () => {
  it('detects win, bust, and ok', () => {
    expect(evaluateTurn(40, [D(20)], true)).toBe('win');
    expect(evaluateTurn(20, [T(20)], true)).toBe('bust');
    expect(evaluateTurn(100, [T(20)], true)).toBe('ok');
  });
});

describe('per-leg stats', () => {
  // A scores 100, 141, then checks out 60 — 301 over 7 darts.
  const A = 'A';
  const legs = [
    makeLeg(
      'm',
      [
        makeTurn(A, [T(20), S(20), S(20)], 201), // 100
        makeTurn(A, [T(20), T(19), D(12)], 60), // 141
        makeTurn(A, [T(20)], 0), // 60 checkout
      ],
      A,
    ),
  ];

  it('3-dart average = points / darts * 3', () => {
    expect(calculateAverage(legs, A)).toBeCloseTo((301 / 7) * 3, 5);
  });
  it('highest turn', () => {
    expect(calculateHighestTurn(legs, A)).toBe(141);
  });
  it('counts no 180s here', () => {
    expect(count180s(legs, A)).toBe(0);
  });
  it('high-score bands are cumulative', () => {
    expect(countHighScores(legs, A)).toEqual({ over100: 2, over140: 1, over180: 0 });
  });
  it('best checkout', () => {
    expect(bestCheckout(legs, A)).toBe(60);
  });
  it('checkout % = wins / chances (<=170 start)', () => {
    // Only the final turn started <= 170 (60); it was taken.
    expect(calculateCheckoutPercent(legs, A)).toBe(100);
  });
  it('total darts thrown', () => {
    expect(totalDartsThrown(legs, A)).toBe(7);
  });
  it('a bust turn scores 0 points but still counts its darts', () => {
    const bustLegs = [
      makeLeg('b', [
        makeTurn(A, [S(20), S(20), S(20)], 100, { isBust: true }), // bust, no score
      ]),
    ];
    expect(calculateAverage(bustLegs, A)).toBe(0);
    expect(totalDartsThrown(bustLegs, A)).toBe(3);
    expect(count180s(bustLegs, A)).toBe(0);
  });
});

describe('counts an actual 180', () => {
  it('180 visit', () => {
    const legs = [makeLeg('m', [makeTurn('A', [T(20), T(20), T(20)], 321)])];
    expect(count180s(legs, 'A')).toBe(1);
    expect(countHighScores(legs, 'A')).toEqual({ over100: 1, over140: 1, over180: 1 });
  });
});
