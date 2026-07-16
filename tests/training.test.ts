import { describe, it, expect } from 'vitest';
import {
  TRAINING_FIELDS,
  TRAINING_FIELD_COUNT,
  trainingFieldLabel,
  fieldIdFromLabel,
  shuffledBag,
  isTrainingTurnOpen,
  lastFieldOf,
  nextRoundBag,
  newTrainingState,
  advanceTraining,
  trainingAttempts,
  trainingRounds,
  trainingBestRound,
  trainingBestHitsRound,
  trainingFieldStats,
  trainingFieldTrends,
  trainingRingOf,
  trainingRingAverages,
  trainingVariantOf,
  trainingWeakFields,
} from '../src/training';
import { makeMatch, makeLeg, makeTurn, dart } from './helpers';
import type { Match } from '../src/types';

const A = 'A';

// A resolved attempt: `misses` ✗-darts then one ✓-dart on the field.
const attempt = (field: string, misses: number) => [
  ...Array.from({ length: misses }, () => dart(0, `✗${trainingFieldLabel(field)}`)),
  dart(1, `✓${trainingFieldLabel(field)}`),
];

function trainingMatch(id: string, date: number, turns: ReturnType<typeof makeTurn>[], complete = false): Match {
  return makeMatch({
    id,
    date,
    gameType: 'Training',
    playerIds: [A],
    winnerId: complete ? A : null,
    status: complete ? 'completed' : 'in_progress',
    legs: [makeLeg(id, turns)],
  });
}

describe('field pool and labels', () => {
  it('has 62 unique fields: S/D/T × 1–20 plus outer and bull', () => {
    expect(TRAINING_FIELD_COUNT).toBe(62);
    expect(new Set(TRAINING_FIELDS).size).toBe(62);
    expect(TRAINING_FIELDS).toContain('S25');
    expect(TRAINING_FIELDS).toContain('D25');
    expect(TRAINING_FIELDS).not.toContain('T25'); // no treble bull
  });

  it('labels follow the app convention and round-trip through dart labels', () => {
    expect(trainingFieldLabel('S18')).toBe('18');
    expect(trainingFieldLabel('D16')).toBe('D16');
    expect(trainingFieldLabel('T20')).toBe('T20');
    expect(trainingFieldLabel('S25')).toBe('Outer');
    expect(trainingFieldLabel('D25')).toBe('Bull');
    for (const id of TRAINING_FIELDS) {
      expect(fieldIdFromLabel(`✗${trainingFieldLabel(id)}`)).toBe(id);
      expect(fieldIdFromLabel(`✓${trainingFieldLabel(id)}`)).toBe(id);
    }
  });
});

describe('shuffle bag', () => {
  it('deals every field exactly once', () => {
    const bag = shuffledBag();
    expect(new Set(bag).size).toBe(62);
  });

  it('is deterministic with injected randomness', () => {
    const fixed = () => 0.5;
    expect(shuffledBag(fixed)).toEqual(shuffledBag(fixed));
  });

  it('advances through the bag and signals round completion at the end', () => {
    let state = newTrainingState(() => 0);
    const seen = [state.target];
    for (;;) {
      const next = advanceTraining(state);
      if (next === null) break;
      state = next;
      seen.push(state.target);
    }
    expect(seen).toHaveLength(62);
    expect(new Set(seen).size).toBe(62);
  });
});

describe('group therapy', () => {
  const groupMatch = (id: string, date: number, turns: ReturnType<typeof makeTurn>[], complete = false) => {
    const m = trainingMatch(id, date, turns, complete);
    m.training = { target: 'S1', bag: [], variant: 'group' };
    return m;
  };
  // A visit: one dart per entry, 1 = hit, 0 = miss.
  const visit = (field: string, pattern: (0 | 1)[]) =>
    makeTurn(
      A,
      pattern.map((s) => dart(s, `${s ? '✓' : '✗'}${trainingFieldLabel(field)}`)),
      0,
    );

  it('a visit resolves after three darts, however many landed', () => {
    const m = groupMatch('g1', 1000, [visit('T20', [1, 0, 1]), visit('S10', [0])]);
    const [full, open] = trainingAttempts(m);
    expect(full).toMatchObject({
      target: 'T20',
      darts: 3,
      hits: 2,
      firstHit: true,
      resolved: true,
    });
    expect(open).toMatchObject({ target: 'S10', darts: 1, hits: 0, resolved: false });
    const [round] = trainingRounds([m], A);
    expect(round.avgHits).toBe(2);
    expect(round.hits).toBe(2);
    expect(round.firstDartHitRate).toBe(50);
  });

  it('tracks the most hits in a completed round as the personal best', () => {
    const m1 = groupMatch('g2', 1000, [visit('T20', [1, 0, 0])], true);
    const m2 = groupMatch('g3', 2000, [visit('T20', [1, 1, 0])], true);
    expect(trainingBestHitsRound([m1, m2], A)).toEqual({ value: 2, date: 2000 });
    // In-progress rounds never hold the record.
    expect(trainingBestHitsRound([groupMatch('g4', 3000, [visit('T20', [1, 1, 1])])], A)).toBeNull();
  });

  it('turn-open depends on the variant', () => {
    const hitFirst = makeTurn(A, [dart(1, '✓T20')], 0);
    expect(isTrainingTurnOpen(hitFirst, 'sink')).toBe(false); // the hit closed it
    expect(isTrainingTurnOpen(hitFirst, 'group')).toBe(true); // 1 of 3 darts thrown
    expect(isTrainingTurnOpen(visit('T20', [1, 1, 1]), 'group')).toBe(false);
  });

  it('records without a variant read as Kitchen Sink', () => {
    const legacy = trainingMatch('legacy', 1000, [makeTurn(A, attempt('T20', 1), 0)]);
    expect(trainingVariantOf(legacy)).toBe('sink');
    legacy.training = { target: 'S1', bag: [] };
    expect(trainingVariantOf(legacy)).toBe('sink');
  });
});

describe('pre-dealt next round', () => {
  it('lastFieldOf is the end of the remaining order', () => {
    expect(lastFieldOf({ target: 'S1', bag: ['S2', 'S3'] })).toBe('S3');
    expect(lastFieldOf({ target: 'S1', bag: [] })).toBe('S1');
  });

  it('nextRoundBag deals every field but never opens on the current round’s last', () => {
    for (let i = 0; i < 200; i++) {
      const bag = nextRoundBag('T20');
      expect(new Set(bag).size).toBe(62);
      expect(bag[0]).not.toBe('T20');
    }
  });

  it('newTrainingState pre-deals the next round with the seam guard applied', () => {
    for (let i = 0; i < 50; i++) {
      const s = newTrainingState();
      expect(new Set(s.nextBag).size).toBe(62);
      expect(s.nextBag![0]).not.toBe(lastFieldOf(s));
    }
  });

  it('advanceTraining carries the pre-dealt next round along unchanged', () => {
    let state = newTrainingState(() => 0.25);
    const nextBag = state.nextBag;
    for (;;) {
      const next = advanceTraining(state);
      if (next === null) break;
      state = next;
    }
    expect(state.bag).toHaveLength(0);
    expect(state.nextBag).toBe(nextBag);
  });
});

describe('round stats', () => {
  // Round 1 (complete flag): T20 in 3, D16 in 1, plus an open attempt on S5 (2 misses).
  const m1 = trainingMatch(
    'r1',
    1000,
    [
      makeTurn(A, attempt('T20', 2), 0),
      makeTurn(A, attempt('D16', 0), 0),
      makeTurn(A, [dart(0, '✗5'), dart(0, '✗5')], 0),
    ],
    true,
  );

  it('parses attempts with targets, dart counts, and resolution', () => {
    const attempts = trainingAttempts(m1);
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toMatchObject({ target: 'T20', darts: 3, resolved: true });
    expect(attempts[1]).toMatchObject({ target: 'D16', darts: 1, resolved: true });
    expect(attempts[2]).toMatchObject({ target: 'S5', darts: 2, resolved: false });
  });

  it('aggregates per round, excluding open attempts from avg darts', () => {
    const [round] = trainingRounds([m1], A);
    expect(round.complete).toBe(true);
    expect(round.attempts).toBe(3);
    expect(round.resolved).toBe(2);
    expect(round.darts).toBe(6);
    expect(round.avgDarts).toBe(2); // (3 + 1) / 2 — the open S5 can't be gamed
    expect(round.firstDartHitRate).toBeCloseTo((1 / 3) * 100, 5); // only D16 fell first dart
  });

  it('tracks the fewest-darts round as a dated personal best', () => {
    const m2 = trainingMatch('r2', 2000, [makeTurn(A, attempt('S1', 0), 0)], true);
    expect(trainingBestRound([m1, m2], A)).toEqual({ value: 1, date: 2000 });
    // In-progress rounds never hold the record.
    const live = trainingMatch('r3', 3000, [makeTurn(A, attempt('S2', 0), 0)]);
    expect(trainingBestRound([live], A)).toBeNull();
  });

  it('splits darts-per-target by ring, resolved attempts only', () => {
    // T20 in 3, D16 in 1, S10 in 2, Outer in 2, Bull in 4 — S5 stays open.
    const m = trainingMatch('rings', 1000, [
      makeTurn(A, attempt('T20', 2), 0),
      makeTurn(A, attempt('D16', 0), 0),
      makeTurn(A, attempt('S10', 1), 0),
      makeTurn(A, attempt('S25', 1), 0),
      makeTurn(A, attempt('D25', 3), 0),
      makeTurn(A, [dart(0, '✗5'), dart(0, '✗5')], 0),
    ]);
    const rings = new Map(trainingRingAverages([m], A).map((r) => [r.ring, r]));
    expect(rings.get('all')).toMatchObject({ darts: 12, resolved: 5, avgDarts: 2.4 });
    expect(rings.get('single')).toMatchObject({ darts: 2, resolved: 1, avgDarts: 2 });
    expect(rings.get('double')!.avgDarts).toBe(1);
    expect(rings.get('treble')!.avgDarts).toBe(3);
    expect(rings.get('outer')!.avgDarts).toBe(2);
    expect(rings.get('bull')!.avgDarts).toBe(4);
    // The outer and bull are their own rings, never singles/doubles.
    expect(trainingRingOf('S25')).toBe('outer');
    expect(trainingRingOf('D25')).toBe('bull');
    expect(trainingRingOf('S7')).toBe('single');
  });

  it('surfaces the weakest fields, requiring a minimum sample', () => {
    // T3: 1/10 (10%), D16: 1/4 (25% but only 4 darts — below the sample bar),
    // S10: 5 attempts first-dart (5/5, 100%), T20: 2/9 (22%).
    const m = trainingMatch('weak', 1000, [
      makeTurn(A, attempt('T3', 9), 0),
      makeTurn(A, attempt('D16', 3), 0),
      makeTurn(A, attempt('T20', 4), 0),
      makeTurn(A, attempt('T20', 3), 0),
      ...Array.from({ length: 5 }, () => makeTurn(A, attempt('S10', 0), 0)),
    ]);
    const weak = trainingWeakFields([m], A, 3, 5);
    expect(weak.map((f) => f.id)).toEqual(['T3', 'T20', 'S10']);
    expect(weak[0].hitRate).toBe(10);
    // D16 is excluded: 4 darts is noise, not a weak field.
    expect(weak.find((f) => f.id === 'D16')).toBeUndefined();
  });

  it('measures per-field improvement between the earlier and recent halves of rounds', () => {
    // Earlier round: T20 at 1/10. Recent round: T20 at 5/10 → +40 points.
    // S10 has plenty of darts early but too few recently → null.
    const early = trainingMatch(
      'half1',
      1000,
      [makeTurn(A, attempt('T20', 9), 0), makeTurn(A, attempt('S10', 7), 0)],
      true,
    );
    const recent = trainingMatch(
      'half2',
      2000,
      [
        ...Array.from({ length: 5 }, () => makeTurn(A, attempt('T20', 1), 0)),
        makeTurn(A, attempt('S10', 0), 0),
      ],
      true,
    );
    const trends = trainingFieldTrends([early, recent], A);
    expect(trends.get('T20')).toBe(40);
    expect(trends.get('S10')).toBeNull();
    expect(trends.get('D5')).toBeNull(); // never thrown at
    // A single round has no halves to compare.
    expect(trainingFieldTrends([early], A).get('T20')).toBeNull();
  });

  it('a trend window compares the last N rounds with the N before, else falls back to halves', () => {
    // Four rounds of T20 form, 10 darts each: 10%, 10%, 50%, 20%.
    const tenPercent = (id: string, date: number) =>
      trainingMatch(id, date, [makeTurn(A, attempt('T20', 9), 0)], true);
    const rounds = [
      tenPercent('w1', 1000),
      tenPercent('w2', 2000),
      trainingMatch(
        'w3',
        3000,
        Array.from({ length: 5 }, () => makeTurn(A, attempt('T20', 1), 0)),
        true,
      ),
      trainingMatch(
        'w4',
        4000,
        [
          makeTurn(A, attempt('T20', 3), 0),
          makeTurn(A, attempt('T20', 4), 0),
          makeTurn(A, [dart(0, '✗T20')], 0),
        ],
        true,
      ),
    ];
    // Halves: 2/20 (10%) vs 7/20 (35%) → +25.
    expect(trainingFieldTrends(rounds, A).get('T20')).toBe(25);
    // Window 1: only w4 (20%) vs w3 (50%) → -30; older rounds don't dilute it.
    expect(trainingFieldTrends(rounds, A, 5, 1).get('T20')).toBe(-30);
    // Window 3 needs 6 rounds — falls back to the halves split.
    expect(trainingFieldTrends(rounds, A, 5, 3).get('T20')).toBe(25);
  });

  it('counts every dart toward per-field stats, misses on open attempts included', () => {
    const fields = new Map(trainingFieldStats([m1], A).map((f) => [f.id, f]));
    expect(fields.get('T20')).toMatchObject({ darts: 3, hits: 1 });
    expect(fields.get('D16')).toMatchObject({ darts: 1, hits: 1, hitRate: 100 });
    expect(fields.get('S5')).toMatchObject({ darts: 2, hits: 0, hitRate: 0 });
    expect(fields.get('S1')).toMatchObject({ darts: 0, hitRate: 0 });
    expect(fields.size).toBe(62);
  });
});
