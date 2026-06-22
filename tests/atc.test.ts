import { describe, it, expect } from 'vitest';
import {
  ATC_SEQUENCE,
  ATC_TARGET_COUNT,
  atcTargetLabel,
  atcRingLabel,
  atcProgress,
  atcIsComplete,
  atcTargetForProgress,
  atcDartsThrown,
  atcHits,
  atcHitRate,
  atcFewestDartsToComplete,
  atcStatsByVariant,
  atcPerMatch,
  atcProgressiveSteps,
} from '../src/atc';
import {
  atcHitDart,
  atcMissDart,
  atcStepDart,
  makeTurn,
  makeLeg,
  makeMatch,
} from './helpers';
import type { AtcRing, Leg, Match } from '../src/types';

const A = 'A';
const B = 'B';

describe('sequence and labels', () => {
  it('runs 1..20 then bull', () => {
    expect(ATC_TARGET_COUNT).toBe(21);
    expect(ATC_SEQUENCE[ATC_TARGET_COUNT - 1]).toBe(25);
  });
  it('labels targets by ring', () => {
    expect(atcTargetLabel(7, 'single')).toBe('7');
    expect(atcTargetLabel(7, 'double')).toBe('D7');
    expect(atcTargetLabel(7, 'triple')).toBe('T7');
    expect(atcTargetLabel(7, 'progressive')).toBe('7');
  });
  it('handles the bull, including the no-treble-bull fallback', () => {
    expect(atcTargetLabel(25, 'single')).toBe('Bull');
    expect(atcTargetLabel(25, 'double')).toBe('DB');
    expect(atcTargetLabel(25, 'triple')).toBe('Bull');
  });
  it('names variants', () => {
    expect(atcRingLabel('single')).toBe('Any');
    expect(atcRingLabel('progressive')).toBe('Progressive');
  });
});

describe('progress and completion', () => {
  it('maps progress to the target number', () => {
    expect(atcTargetForProgress(0)).toBe(1);
    expect(atcTargetForProgress(6)).toBe(7);
    expect(atcTargetForProgress(21)).toBeNull();
  });
  it('is complete only at 21', () => {
    expect(atcIsComplete(20)).toBe(false);
    expect(atcIsComplete(21)).toBe(true);
  });
});

describe('per-leg stats (hit/miss play)', () => {
  const leg = makeLeg('m', [
    makeTurn(A, [atcHitDart(1), atcHitDart(2), atcHitDart(3)], 3),
    makeTurn(B, [atcHitDart(1), atcMissDart(2), atcHitDart(2)], 2),
    makeTurn(A, [atcHitDart(4), atcMissDart(5), atcHitDart(5)], 5),
  ]);

  it('reconstructs progress from hits', () => {
    expect(atcProgress(leg, A)).toBe(5);
    expect(atcProgress(leg, B)).toBe(2);
  });
  it('counts darts and hits, and computes hit rate', () => {
    expect(atcDartsThrown([leg], A)).toBe(6);
    expect(atcHits([leg], A)).toBe(5);
    expect(atcHitRate([leg], A)).toBeCloseTo((5 / 6) * 100, 5);
  });
});

describe('fewest darts to complete', () => {
  function clearLeg(winner: string): Leg {
    const turns = [];
    let prog = 0;
    for (let t = 0; t < 7; t++) {
      const darts = [atcHitDart(prog + 1), atcHitDart(prog + 2), atcHitDart(prog + 3)];
      prog += 3;
      turns.push(makeTurn(winner, darts, prog));
    }
    return makeLeg('w', turns, winner);
  }
  it('finds the fewest darts among won legs', () => {
    const leg = clearLeg(B);
    expect(atcFewestDartsToComplete([leg], B)).toBe(21);
    expect(atcFewestDartsToComplete([leg], A)).toBe(0);
  });
});

describe('progressive variant', () => {
  // single +1, double +2, treble +3 → 6 targets cleared in one turn.
  const progLeg = makeLeg('p', [
    makeTurn(A, [atcStepDart(1, 1), atcStepDart(2, 2), atcStepDart(4, 3)], 6),
  ]);

  it('advances by the multiplier', () => {
    expect(atcProgress(progLeg, A)).toBe(6);
    // Double on target 4 -> +2 -> next target 6; treble on 5 -> +3 -> next target 8.
    expect(atcTargetForProgress(3 + 2)).toBe(6);
    expect(atcTargetForProgress(4 + 3)).toBe(8);
  });
  it('counts darts that hit, not steps', () => {
    expect(atcHits([progLeg], A)).toBe(3);
    expect(atcDartsThrown([progLeg], A)).toBe(3);
  });

  it('always requires the bull to finish (caps overshoot near the end)', () => {
    // Mid-sequence the full multiplier applies.
    expect(atcProgressiveSteps(5, 3)).toBe(3); // on 6, treble → +3
    // Near the end a numbered hit can only reach the bull (progress 20), never 21.
    expect(atcProgressiveSteps(18, 3)).toBe(2); // treble 19 → +2, lands on the bull
    expect(atcProgressiveSteps(19, 3)).toBe(1); // treble 20 → +1
    expect(atcProgressiveSteps(19, 2)).toBe(1); // double 20 → +1
    // On the bull, the hit counts in full (single bull +1, double bull +2).
    expect(atcProgressiveSteps(20, 1)).toBe(1);
    expect(atcProgressiveSteps(20, 2)).toBe(2);
    // A miss never advances.
    expect(atcProgressiveSteps(18, 0)).toBe(0);
  });
});

describe('analytics by variant', () => {
  function clearLeg(winner: string): Leg {
    const turns = [];
    let prog = 0;
    for (let t = 0; t < 7; t++) {
      const darts = [atcHitDart(prog + 1), atcHitDart(prog + 2), atcHitDart(prog + 3)];
      prog += 3;
      turns.push(makeTurn(winner, darts, prog));
    }
    return makeLeg(`L-${winner}`, turns, winner);
  }
  function atcMatch(id: string, date: number, ring: AtcRing, winnerId: string): Match {
    return makeMatch({
      id,
      date,
      gameType: 'AroundTheClock',
      playerIds: [A, B],
      winnerId,
      atcRing: ring,
      legs: [clearLeg(winnerId)],
    });
  }

  const m1 = atcMatch('m1', 1000, 'single', A);
  const m2 = atcMatch('m2', 2000, 'progressive', A);
  const m3 = atcMatch('m3', 3000, 'double', B);
  m3.legs[0].turns.push(makeTurn(A, [atcMissDart(1), atcMissDart(1)], 0)); // A misses in doubles

  it('groups by variant in a fixed order', () => {
    const variants = atcStatsByVariant([m1, m2, m3], A);
    expect(variants.map((v) => v.ring)).toEqual(['single', 'double', 'progressive']);
  });
  it('summarises each variant', () => {
    const variants = atcStatsByVariant([m1, m2, m3], A);
    const single = variants.find((v) => v.ring === 'single')!;
    expect(single).toMatchObject({
      played: 1,
      won: 1,
      winRate: 100,
      hitRate: 100,
      fewestToClear: 21,
      avgDartsToClear: 21,
    });
    const dbl = variants.find((v) => v.ring === 'double')!;
    expect(dbl.won).toBe(0);
    expect(dbl.fewestToClear).toBe(0);
  });
  it('counts solo games as played but not toward win rate', () => {
    // A solo single-ring game: A is the only player and clears the board.
    const solo = makeMatch({
      id: 'solo-atc',
      date: 4000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'single',
      legs: [clearLeg(A)],
    });
    const single = atcStatsByVariant([m1, solo], A).find((v) => v.ring === 'single')!;
    expect(single.played).toBe(2); // m1 (competitive) + solo
    expect(single.competitivePlayed).toBe(1); // m1 only
    expect(single.won).toBe(1); // m1 win; the solo "win" is ignored
    expect(single.winRate).toBe(100); // 1 of 1 competitive game
  });

  it('reports no win rate for a variant with only solo games', () => {
    const solo = makeMatch({
      id: 'solo-only',
      date: 5000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'triple',
      legs: [clearLeg(A)],
    });
    const triple = atcStatsByVariant([solo], A).find((v) => v.ring === 'triple')!;
    expect(triple.played).toBe(1);
    expect(triple.competitivePlayed).toBe(0);
    expect(triple.won).toBe(0);
    expect(triple.winRate).toBe(0);
  });

  it('returns per-match points sorted oldest first', () => {
    const points = atcPerMatch([m3, m1, m2], A);
    expect(points.map((p) => p.date)).toEqual([1000, 2000, 3000]);
    expect(points.map((p) => p.ring)).toEqual(['single', 'progressive', 'double']);
  });
});
