# AGENTS.md

Orientation for coding agents working in this repo. The README covers the
product; this covers how to work on it safely.

## What this is

DartTrak is a fully local, offline-first darts-tracking PWA: React 19 +
TypeScript + Vite, data in IndexedDB (via `idb`), charts with Chart.js
(`react-chartjs-2`), deployed to GitHub Pages. No backend, no accounts — a
user's IndexedDB is the only copy of their data, so data-losing bugs are the
worst kind here.

## Commands

```bash
npm install
npm run dev        # dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # tsc && vite build (also generates the service worker)
```

Before every commit run the full gate: `npm run typecheck && npm test && npm run build`.
There is no linter config; match the style of the surrounding code (Prettier-ish,
2-space, single quotes).

## Workflow

- Each feature/fix gets its own branch off `origin/main` and its own PR; never
  push to `main` directly.
- CI (`.github/workflows/ci.yml`) runs typecheck + tests + build on PRs.
  Merging to `main` deploys to GitHub Pages (`deploy.yml`, test-gated; the
  deploy step auto-retries once because Pages fails transiently).

## Architecture

All game/stat logic is pure, framework-free TypeScript that the React screens
consume — put new logic in a pure module with unit tests, not in a component.

- `src/scoring.ts`, `atc.ts`, `training.ts`, `stats.ts`, `analysis.ts`,
  `progression.ts`, `checkout.ts` — pure logic, unit-tested in `tests/`
- `src/db.ts` — IndexedDB wrapper + versioned export/import (all-or-nothing;
  bump `EXPORT_VERSION` on breaking data changes)
- `src/prefs.ts` — device-local UI prefs in localStorage (`darttrak:` prefix),
  silently no-op when storage is unavailable; NOT part of export/import
- `src/router.ts` + `useRoute.ts` — tiny hash router; `navigate(path, { replace })`
  for redirects so Back doesn't loop
- `src/screens/*` — one component per screen; `main.tsx` maps routes and picks
  the live screen by `match.gameType` (keyed by matchId to force remount)

## Data model (the invariants that matter)

Everything is a `Match` (see `src/types.ts`): `Match → legs: Leg[] → turns:
Turn[] → darts: Dart[]`. All game modes share this shape — History, Summary,
export/import, and resume work off it, so new modes should reuse it rather than
invent storage.

- `gameType`: `'501' | '301' | 'AroundTheClock' | 'Cricket' | 'Training'`
- Training: one match record per round (a shuffle bag of all 62 fields);
  live state on `match.training = { target, bag, nextBag }` — `nextBag` is
  the NEXT round's pre-dealt order (its opener never equals this round's
  last field), shown by the live screen's target wheel and consumed on
  rollover; each target attempt is one
  Turn whose dart labels encode the field (`'✗T18'`/`'✓T18'`, `Outer`=S25,
  `Bull`=D25 — see `trainingFieldLabel`/`fieldIdFromLabel`). Unlike other
  modes, `in_progress` training rounds COUNT in stats (deliberate: the bag
  deals a uniformly random subset, so mid-round figures are unbiased).
- Training numpad semantics: a typed count n means n misses on the miss
  button (↵), but "the hit came with dart n" on HIT — n−1 misses plus the
  hit, n darts total. With nothing typed: one miss, or a first-dart hit.
- Stats modules filter by `gameType` — keep modes from leaking into each
  other's numbers.

## Live-screen conventions

The live screens are used mid-game on a phone; guard against fat fingers and
mid-save races:

- Every save path uses the `submitting` ref + `saving` state pair; buttons are
  disabled while saving. Failed saves toast an error and leave state unchanged.
- Destructive taps need friction: every undo button is a two-press confirm
  (arms red for 3s); miss-fill has a 400ms cooldown.
- Keep layout stable while playing (fixed-height status regions) — no jumping
  buttons.

## Chart conventions (PlayerStats)

Color = metric. Raw per-game/leg series are solid with small points; rolling
averages are the same color, dotted (`borderDash: [3, 5]`, `pointRadius: 0`),
drawn in front (`order: 1`) and hidden from the legend (labels containing
"avg" are filtered). X axes use the shared `X_TICKS`; every chart is wrapped
in `ExpandableChart` for the fullscreen viewer. Rolling means come from
`progression.ts` (`rollingMean`, `trendDelta`) — don't reimplement.

## Testing

Vitest, jsdom, `fake-indexeddb/auto`. Pure logic gets unit tests; screens get
render tests in `tests/render.test.tsx` using the helpers in `tests/helpers.ts`.

- `react-chartjs-2` is mocked to null components (jsdom has no canvas).
- `vi.mock('../src/db', { spy: true })` wraps the real db so individual calls
  can be made to reject in failure-path tests.
- jsdom doesn't focus elements on click — call `.focus()` explicitly in
  focus-management tests.

## Gotchas

- `structuredClone(match)` before mutating; save first, then update React
  state — never leave UI ahead of the database.
- Timestamps are `Date.now()` epoch ms; chart labels use `toLocaleDateString()`.
- Update README.md when user-facing behaviour changes.
