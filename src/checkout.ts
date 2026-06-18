/**
 * Checkout suggestions for x01 double-out: given a remaining score and how many
 * darts are left in the turn, return a sensible finishing combination (ending on
 * a double / the bull), or null if it can't be checked out with those darts.
 *
 * Not a full "pro" lookup table, but a search biased toward conventional
 * finishes: fewest darts, big trebles for setup, and preferred finishing doubles.
 */

interface Seg {
  value: number;
  label: string;
}

// Finishing darts must be a double: D1..D20, or the double bull (50, shown "Bull").
const FINISH: Seg[] = (() => {
  const out: Seg[] = [];
  for (let n = 1; n <= 20; n++) out.push({ value: 2 * n, label: `D${n}` });
  out.push({ value: 50, label: 'Bull' });
  return out;
})();

// Setup darts: any segment. Ordered trebles → singles → bull → doubles so that
// equal-value ties prefer the more natural dart (e.g. single 2 over D1).
const SETUP: Seg[] = (() => {
  const out: Seg[] = [];
  for (let n = 20; n >= 1; n--) out.push({ value: 3 * n, label: `T${n}` });
  for (let n = 20; n >= 1; n--) out.push({ value: n, label: `${n}` });
  out.push({ value: 50, label: 'Bull' });
  out.push({ value: 25, label: '25' });
  for (let n = 20; n >= 1; n--) out.push({ value: 2 * n, label: `D${n}` });
  return out;
})();

// Higher = more conventional finishing double. Bull is low so it's used only when forced.
const DOUBLE_PREF: Record<number, number> = {
  40: 100, // D20
  32: 95, // D16
  16: 90, // D8
  8: 85, // D4
  4: 80, // D2
  2: 75, // D1
  20: 70, // D10
  24: 65, // D12
  36: 60, // D18
  50: 40, // Bull
};
const finishPref = (value: number): number => DOUBLE_PREF[value] ?? 50;

// Prefer the conventional finishing double, then higher-value (treble) setup darts.
const scoreOf = (setup: Seg[], finish: Seg): number =>
  finishPref(finish.value) * 1000 + setup.reduce((a, s) => a + s.value, 0);

export function suggestCheckout(remaining: number, dartsLeft: number): string[] | null {
  if (!Number.isFinite(remaining) || remaining < 2 || remaining > 170 || dartsLeft < 1) {
    return null;
  }

  // 1 dart — land the double directly.
  for (const f of FINISH) {
    if (f.value === remaining) return [f.label];
  }

  // 2 darts — pick the best-scoring setup + finishing double.
  if (dartsLeft >= 2) {
    let best: Seg[] | null = null;
    let bestScore = -1;
    for (const f of FINISH) {
      const need = remaining - f.value;
      if (need <= 0) continue;
      for (const s of SETUP) {
        if (s.value !== need) continue;
        const sc = scoreOf([s], f);
        if (sc > bestScore) {
          bestScore = sc;
          best = [s, f];
        }
      }
    }
    if (best) return best.map((s) => s.label);
  }

  // 3 darts.
  if (dartsLeft >= 3) {
    let best: Seg[] | null = null;
    let bestScore = -1;
    for (const f of FINISH) {
      const afterFinish = remaining - f.value;
      if (afterFinish <= 0) continue;
      for (const s1 of SETUP) {
        const need2 = afterFinish - s1.value;
        if (need2 <= 0) continue;
        for (const s2 of SETUP) {
          if (s2.value !== need2) continue;
          const sc = scoreOf([s1, s2], f);
          if (sc > bestScore) {
            bestScore = sc;
            best = [s1, s2, f];
          }
        }
      }
    }
    if (best) return best.map((s) => s.label);
  }

  return null;
}
