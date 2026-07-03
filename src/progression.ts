/**
 * Progression helpers: turning a chronological series of per-game (or
 * per-leg) figures into trend signals — a smoothed rolling line for charts
 * and a recent-vs-previous window comparison for "am I improving?" deltas.
 * Pure logic, no React.
 */

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Trailing mean over the last `window` entries at each index, for overlaying
 * a smoothed trend line on a raw series. Entries may be null (the metric
 * didn't apply to that game — e.g. darts-to-finish on an uncleared leg);
 * they're skipped, and a point is emitted only when at least `minCount` real
 * values sit in the window (default: a full window). Earlier points are null
 * so the chart line starts where the average becomes meaningful.
 */
export function rollingMean(
  values: (number | null)[],
  window: number,
  minCount = window,
): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    const inWindow = values
      .slice(i + 1 - window, i + 1)
      .filter((v): v is number => v !== null);
    return inWindow.length >= minCount ? mean(inWindow) : null;
  });
}

export interface TrendDelta {
  window: number; // values per side, adapted to the available history
  recent: number; // mean of the last `window` values
  previous: number; // mean of the `window` values before those
  delta: number; // recent - previous
}

/**
 * Compare the most recent `window` values against the `window` before them.
 * The two windows are disjoint, so it's a clean before/after — unlike
 * "all-time vs recent", where the recent games sit in both sides. The window
 * adapts to the data (min(maxWindow, half the series)); below 3-vs-3 the
 * comparison is noise, so null is returned instead.
 */
export function trendDelta(values: number[], maxWindow = 10): TrendDelta | null {
  const window = Math.min(maxWindow, Math.floor(values.length / 2));
  if (window < 3) return null;
  const recent = mean(values.slice(-window));
  const previous = mean(values.slice(-2 * window, -window));
  return { window, recent, previous, delta: recent - previous };
}
