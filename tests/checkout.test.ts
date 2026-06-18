import { describe, it, expect } from 'vitest';
import { suggestCheckout } from '../src/checkout';

// Parse a suggestion label back into a numeric value + whether it's a double.
function parse(label: string): { value: number; isDouble: boolean } {
  if (label === 'Bull') return { value: 50, isDouble: true };
  if (label === '25') return { value: 25, isDouble: false };
  if (label.startsWith('D')) return { value: 2 * Number(label.slice(1)), isDouble: true };
  if (label.startsWith('T')) return { value: 3 * Number(label.slice(1)), isDouble: false };
  return { value: Number(label), isDouble: false };
}

describe('suggestCheckout — validity', () => {
  it('every checkout sums to the target, fits the darts, and ends on a double', () => {
    for (let r = 2; r <= 170; r++) {
      const sug = suggestCheckout(r, 3);
      if (!sug) continue; // bogey numbers legitimately have no checkout
      const parsed = sug.map(parse);
      expect(parsed.reduce((a, p) => a + p.value, 0)).toBe(r);
      expect(sug.length).toBeLessThanOrEqual(3);
      expect(parsed[parsed.length - 1].isDouble).toBe(true);
    }
  });

  it('returns null outside the checkable range and for bogey numbers', () => {
    expect(suggestCheckout(1, 3)).toBeNull();
    expect(suggestCheckout(171, 3)).toBeNull();
    expect(suggestCheckout(169, 3)).toBeNull();
    expect(suggestCheckout(168, 3)).toBeNull();
    expect(suggestCheckout(40, 0)).toBeNull();
  });
});

describe('suggestCheckout — conventional finishes', () => {
  it('matches well-known checkouts', () => {
    expect(suggestCheckout(170, 3)).toEqual(['T20', 'T20', 'Bull']);
    expect(suggestCheckout(167, 3)).toEqual(['T20', 'T19', 'Bull']);
    expect(suggestCheckout(100, 3)).toEqual(['T20', 'D20']);
    expect(suggestCheckout(110, 2)).toEqual(['T20', 'Bull']);
    expect(suggestCheckout(60, 3)).toEqual(['20', 'D20']);
    expect(suggestCheckout(40, 3)).toEqual(['D20']);
    expect(suggestCheckout(50, 3)).toEqual(['Bull']);
    expect(suggestCheckout(32, 3)).toEqual(['D16']);
    expect(suggestCheckout(36, 3)).toEqual(['D18']);
  });

  it('uses the fewest darts available', () => {
    expect(suggestCheckout(100, 3)).toHaveLength(2); // not a 3-dart route
    expect(suggestCheckout(40, 3)).toHaveLength(1);
  });

  it('respects the darts-left limit', () => {
    // 100 needs 2 darts; with only 1 left it can't be finished.
    expect(suggestCheckout(100, 1)).toBeNull();
    // 50 finishes in a single dart.
    expect(suggestCheckout(50, 1)).toEqual(['Bull']);
  });
});
