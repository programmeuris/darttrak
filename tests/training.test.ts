import { describe, it, expect } from 'vitest';
import {
  TRAINING_FIELDS,
  TRAINING_FIELD_COUNT,
  trainingFieldLabel,
  fieldIdFromLabel,
  shuffledBag,
  lastFieldOf,
  nextRoundBag,
  newTrainingState,
  advanceTraining,
  trainingAttempts,
  trainingRounds,
  trainingBestRound,
  trainingFieldStats,
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

  it('counts every dart toward per-field stats, misses on open attempts included', () => {
    const fields = new Map(trainingFieldStats([m1], A).map((f) => [f.id, f]));
    expect(fields.get('T20')).toMatchObject({ darts: 3, hits: 1 });
    expect(fields.get('D16')).toMatchObject({ darts: 1, hits: 1, hitRate: 100 });
    expect(fields.get('S5')).toMatchObject({ darts: 2, hits: 0, hitRate: 0 });
    expect(fields.get('S1')).toMatchObject({ darts: 0, hitRate: 0 });
    expect(fields.size).toBe(62);
  });
});
