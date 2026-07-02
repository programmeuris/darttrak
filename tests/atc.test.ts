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
  atcProgressiveSteps,
  atcSeriesByVariant,
  atcTargetStats,
  atcVariantMatches,
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
    expect(atcTargetLabel(25, 'double')).toBe('Bull');
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

  it('emits one point per leg for multi-leg matches', () => {
    // Best-of-3 where A clears leg 1 in 21 darts and loses leg 2 to B after
    // 3 darts (1 hit) — each leg is its own attempt at the board, so each
    // gets its own point instead of pooling into one format-dependent total.
    const lostLeg = clearLeg(B);
    lostLeg.turns.push(makeTurn(A, [atcMissDart(1), atcMissDart(1), atcHitDart(1)], 1));
    const multi = makeMatch({
      id: 'multi',
      date: 9000,
      gameType: 'AroundTheClock',
      atcRing: 'single',
      playerIds: [A, B],
      winnerId: B,
      format: { legs: 3, sets: 1 },
      legs: [clearLeg(A), lostLeg],
    });

    const pts = atcSeriesByVariant([multi], A).find((s) => s.ring === 'single')!.points;
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.cleared)).toEqual([true, false]);
    expect(pts[0].darts).toBe(21);
    expect(pts[1].darts).toBe(3);
    expect(pts[1].hitRate).toBeCloseTo((1 / 3) * 100, 5);
    // Same-date legs are disambiguated in the tooltip label.
    expect(pts[1].label).toContain('Leg 2');
  });

  it('splits hit-rate series per variant, each indexed from its own game 1', () => {
    // Two progressive games and one single game, passed out of order.
    const prog1 = atcMatch('prog1', 1000, 'progressive', A);
    const prog2 = atcMatch('prog2', 3000, 'progressive', A);
    const single1 = atcMatch('single1', 2000, 'single', A);
    const series = atcSeriesByVariant([prog2, single1, prog1], A);

    // Ring order, only rings that were played.
    expect(series.map((s) => s.ring)).toEqual(['single', 'progressive']);
    // Each variant is its own oldest→newest sequence (both start at index 0).
    expect(series.find((s) => s.ring === 'progressive')!.points.map((p) => p.date)).toEqual([
      1000, 3000,
    ]);
    expect(series.find((s) => s.ring === 'single')!.points.map((p) => p.date)).toEqual([2000]);
    // Each point also carries the darts thrown that game (21 per cleared leg
    // here) and whether the player cleared the board.
    expect(series.find((s) => s.ring === 'single')!.points[0].darts).toBe(21);
    expect(series.find((s) => s.ring === 'single')!.points[0].cleared).toBe(true);
  });

  it('marks lost games as uncleared in the per-variant series', () => {
    // A loses m3 (doubles, B clears) but clears m1 (single).
    const series = atcSeriesByVariant([m1, m3], A);
    expect(series.find((s) => s.ring === 'single')!.points.map((p) => p.cleared)).toEqual([true]);
    expect(series.find((s) => s.ring === 'double')!.points.map((p) => p.cleared)).toEqual([false]);
  });
});

describe('per-area hit rate', () => {
  // A leg where A misses target 3 twice before hitting it; everything else is a
  // clean one-dart hit. 23 darts total: 21 hits + 2 misses on the "3".
  function legWithMissesOn3(player: string): Leg {
    const turns = [];
    let prog = 0;
    // T1: hit 1, hit 2, miss 3
    turns.push(makeTurn(player, [atcHitDart(1), atcHitDart(2), atcMissDart(3)], (prog = 2)));
    // T2: miss 3, hit 3, hit 4
    turns.push(makeTurn(player, [atcMissDart(3), atcHitDart(3), atcHitDart(4)], (prog = 4)));
    // Remaining targets 5..20 + bull, one hit each (17 hits).
    while (prog < ATC_TARGET_COUNT) {
      const darts = [];
      for (let k = 0; k < 3 && prog < ATC_TARGET_COUNT; k++) {
        darts.push(atcHitDart(prog + 1));
        prog++;
      }
      turns.push(makeTurn(player, darts, prog));
    }
    return makeLeg(`miss3-${player}`, turns, player);
  }

  it('reconstructs the aimed target and reports hits/darts per area', () => {
    const m = makeMatch({
      id: 'area-single',
      date: 1000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'single',
      legs: [legWithMissesOn3(A)],
    });
    const stats = atcTargetStats([m], A, 'single');
    // Every sequence target is present, in order.
    expect(stats.map((s) => s.target)).toEqual([...ATC_SEQUENCE]);
    const three = stats.find((s) => s.target === 3)!;
    expect(three.darts).toBe(3); // two misses + one hit
    expect(three.hits).toBe(1);
    expect(three.hitRate).toBeCloseTo((1 / 3) * 100);
    // A clean one-hit target is 100%.
    const seven = stats.find((s) => s.target === 7)!;
    expect(seven).toMatchObject({ hits: 1, darts: 1, hitRate: 100 });
    // The bull is labelled for the ring.
    expect(stats.find((s) => s.target === 25)!.label).toBe('Bull');
  });

  it('counts a multi-step progressive dart as one attempt on the aimed target only', () => {
    // A single turn in progressive: treble on 1 (+3 → skips 2 and 3), then a
    // treble on 4 (+3 → skips 5, 6). Two darts, both hits, on targets 1 and 4.
    const leg = makeLeg('prog-skip', [
      makeTurn(A, [atcStepDart(1, 3), atcStepDart(4, 3)], 6),
    ]);
    const m = makeMatch({
      id: 'area-prog',
      date: 1000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'progressive',
      legs: [leg],
    });
    const stats = atcTargetStats([m], A, 'progressive');
    expect(stats.find((s) => s.target === 1)).toMatchObject({ hits: 1, darts: 1 });
    expect(stats.find((s) => s.target === 4)).toMatchObject({ hits: 1, darts: 1 });
    // The skipped targets were never aimed at.
    for (const skipped of [2, 3, 5, 6]) {
      expect(stats.find((s) => s.target === skipped)).toMatchObject({ hits: 0, darts: 0 });
    }
  });

  it('lists one variant\'s games oldest→newest, and slicing the tail gives "last N"', () => {
    const mk = (id: string, date: number, ring: AtcRing) =>
      makeMatch({
        id,
        date,
        gameType: 'AroundTheClock',
        playerIds: [A],
        winnerId: A,
        atcRing: ring,
        legs: [makeLeg(id, [makeTurn(A, [atcHitDart(1)], 1)], A)],
      });
    const matches = [
      mk('s2', 2000, 'single'),
      mk('p1', 1500, 'progressive'),
      mk('s1', 1000, 'single'),
      mk('s3', 3000, 'single'),
    ];
    const singles = atcVariantMatches(matches, A, 'single');
    expect(singles.map((m) => m.id)).toEqual(['s1', 's2', 's3']); // sorted, progressive excluded
    // The component takes the last N for the "recent" scope.
    expect(singles.slice(-2).map((m) => m.id)).toEqual(['s2', 's3']);
  });

  it('keeps variants separate — progressive games never count toward Any', () => {
    const single = makeMatch({
      id: 's',
      date: 1000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'single',
      legs: [makeLeg('s-leg', [makeTurn(A, [atcMissDart(1)], 0)], null)],
    });
    const prog = makeMatch({
      id: 'p',
      date: 2000,
      gameType: 'AroundTheClock',
      playerIds: [A],
      winnerId: A,
      atcRing: 'progressive',
      legs: [makeLeg('p-leg', [makeTurn(A, [atcHitDart(1)], 1)], null)],
    });
    const singleOne = atcTargetStats([single, prog], A, 'single').find((s) => s.target === 1)!;
    expect(singleOne).toMatchObject({ hits: 0, darts: 1 }); // only the single game's miss
    const progOne = atcTargetStats([single, prog], A, 'progressive').find((s) => s.target === 1)!;
    expect(progOne).toMatchObject({ hits: 1, darts: 1 }); // only the progressive game's hit
  });
});
