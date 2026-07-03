import { describe, it, expect } from 'vitest';
import { rollingMean, trendDelta } from '../src/progression';

describe('rollingMean', () => {
  it('emits nulls until a full window exists, then trailing means', () => {
    expect(rollingMean([10, 20, 30, 40], 3)).toEqual([null, null, 20, 30]);
  });

  it('skips null entries and respects minCount', () => {
    // Window of 3 positions; nulls (e.g. uncleared legs) don't count toward it.
    const values = [10, null, 30, null, null];
    // Strict (minCount = window): no window of 3 positions has 3 real values.
    expect(rollingMean(values, 3)).toEqual([null, null, null, null, null]);
    // Relaxed to 2: [10,null,30] has two real values → mean 20; later windows
    // hold just one real value → null again.
    expect(rollingMean(values, 3, 2)).toEqual([null, null, 20, null, null]);
  });

  it('handles an empty series', () => {
    expect(rollingMean([], 5)).toEqual([]);
  });
});

describe('trendDelta', () => {
  it('needs at least 3-vs-3 values', () => {
    expect(trendDelta([1, 2, 3, 4, 5])).toBeNull(); // half = 2 → too small
    expect(trendDelta([])).toBeNull();
  });

  it('compares the last window with the disjoint window before it', () => {
    // 6 values → window 3: previous [10,10,10], recent [20,20,20].
    const t = trendDelta([10, 10, 10, 20, 20, 20])!;
    expect(t.window).toBe(3);
    expect(t.previous).toBe(10);
    expect(t.recent).toBe(20);
    expect(t.delta).toBe(10);
  });

  it('caps the window at maxWindow and ignores older values beyond it', () => {
    // 30 values: only the last 20 (10 vs 10) matter.
    const values = [...Array(10).fill(99), ...Array(10).fill(10), ...Array(10).fill(16)];
    const t = trendDelta(values)!;
    expect(t.window).toBe(10);
    expect(t.previous).toBe(10);
    expect(t.recent).toBe(16);
    expect(t.delta).toBe(6);
  });

  it('adapts the window to odd-sized histories', () => {
    // 7 values → window 3: middle value (index 0) falls outside both windows.
    const t = trendDelta([50, 10, 10, 10, 30, 30, 30])!;
    expect(t.window).toBe(3);
    expect(t.previous).toBe(10);
    expect(t.recent).toBe(30);
  });
});
