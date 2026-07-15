# 🎯 DartTrak

A fully local, offline-capable darts score tracking Progressive Web App (PWA).
Built with **React**, **TypeScript**, and **Vite**. No backend, no accounts, no
external connections — all data is stored in your browser via **IndexedDB**.

## Why I built this

Two reasons:

- **To explore agentic coding.** I'm interested in how far AI coding agents can
  go on a real, evolving project, so this app is built almost entirely through
  agentic workflows. I plan to go back and analyse the generated code later — how
  it's structured, where it holds up, and where it doesn't.
- **To track a new hobby without a subscription.** I recently picked up darts and
  wanted a simple way to record my games and watch my stats improve over time —
  without paying a monthly fee for it. So DartTrak is fully local and free: your
  data stays in your browser, and there's nothing to sign up for.

## Features

- **501 / 301** scoring with configurable **Double Out** and best-of-1/3/5 leg formats
- **Around the Clock** mode — race 1 → 20 → bull with a hit/miss tap input and a
  Any / Doubles / Trebles ring setting, plus a **Progressive** variant where
  doubles advance +2 and trebles +3 (each tracked separately in stats)
- **Training** mode — endless solo target practice: a shuffle bag deals all 62
  board fields (singles, doubles, trebles, outer, bull) in random order and you
  throw at each until you hit it; hitting the whole board completes a round and
  the next bag starts on your next throw. Misses register by tapping or via a
  numpad (type a count, commit on ↵ — HIT flushes typed misses first). Stats
  live in their own tab: per-round darts-per-target and first-dart hit % with
  rolling averages and trend deltas, a dated fewest-darts-per-round personal
  best, and a Single/Double/Treble hit-% matrix for every field.
- **1–4 players** per match, drawn from a saved roster; star one as the
  device's **main player** and they're preselected for every new game and the
  default on the stats screen
- **Live scoring** screen optimised for mobile: large tap targets, segmented
  multiplier numpad (Single / Double / Treble + Outer/Bull + Miss), real-time bust and
  checkout detection, **checkout suggestions** (e.g. "T20 · T20 · Bull" that
  update as you throw), undo-dart and undo-turn
- **Match summary** with per-player 3-dart average, highest turn, 180s, 100+/140+
  counts, darts thrown, checkout % and best checkout
- **Match history** with player / game-type filters and full turn-by-turn breakdowns
- **Player stats** with Chart.js, organised by game mode: an **x01** mode with
  Overview, Consistency, Finishing, Scoring and Head-to-Head lenses, and an
  **Around the Clock** mode with a variant selector (Any / Doubles / Trebles /
  Progressive) that shows one variant at a time — in a single card: its stats, a
  per-leg chart pairing Hit % and throws-to-finish (one point per leg, so
  multi-leg games don't pool into a format-dependent total; legs where the board
  wasn't cleared get a red point, since their dart count was cut short), and a
  per-area table giving
  the average hit % for every number/bull in that variant (sortable by area or hit
  %, ascending or descending). When a variant mixes solo and multiplayer games, a
  Solo-only toggle scopes the chart and area table to just the games you entered
  yourself; once more than 20 games are in scope, an All / Last-20 toggle narrows
  them further. Each player's last-viewed tab, variant, and scope toggles are
  remembered on the device, and New Match remembers the last game configuration.
- **Progression tracking**: rolling-average trend lines overlaid on the main
  charts, direction-aware trend deltas (your most recent games vs the games
  before them, green when improving), dated personal bests (fastest leg, best
  average, best checkout, best visit / best leg hit %), and a per-area ±
  column showing where your Around the Clock hit % improved between the
  earlier and recent halves of your games. Charts size to the viewport and
  every chart expands into a fullscreen viewer (rotate to landscape for the
  most plot area).
- **Backup & restore**: export all data to JSON and re-import it (your only
  backup). Imports are validated up front and rejected whole if the file is
  corrupt or from a newer app version — importing the wrong file can't wipe
  your data.
- **Installable PWA** — works offline once loaded; "Add to Home Screen" on
  Chrome / Safari

## Getting started

```bash
npm install
npm run dev       # development server
npm run build     # production build → dist/
npm run preview   # preview the production build
npm run typecheck # type-check without emitting
npm test          # run the unit tests (Vitest)
npm run test:watch     # tests in watch mode
npm run test:coverage  # tests with a coverage report
```

The pure logic (`scoring`, `analysis`, `atc`, `stats`) is covered by unit tests
in `tests/`. Typecheck, tests, and build run on every pull request via
`.github/workflows/ci.yml`.

## Install on your phone (PWA)

The app is deployed automatically to **GitHub Pages** on every push to `main`
(see `.github/workflows/deploy.yml`). Once Pages is enabled, the live URL is:

```
https://programmeuris.github.io/darttrak/
```

To install it as an app — no build tools required:

- **iPhone / iPad (Safari):** open the URL → tap **Share** → **Add to Home Screen**.
- **Android (Chrome):** open the URL → menu **⋮** → **Install app** / **Add to Home Screen**.

It then launches full-screen and works offline (data stays in that browser's
IndexedDB; use **Export** on the Home screen to back it up).

### One-time Pages setup

1. Make the repository **public** (Settings → General → Danger Zone → Change visibility).
   Free GitHub Pages requires a public repo.
2. Settings → **Pages** → under *Build and deployment*, set **Source = GitHub Actions**.
3. Push to `main` (or re-run the **Deploy to GitHub Pages** workflow). The site
   goes live at the URL above.

## Project structure

The UI is React; all game/stat logic is plain framework-agnostic TypeScript that
the components consume.

```
src/
├── main.tsx            React root + route switch
├── router.ts           hash-router helpers (navigate / parseRoute)
├── useRoute.ts         hook subscribing to route changes
├── toast.ts            imperative toast + confirm helpers
├── db.ts               IndexedDB wrapper (idb)         ┐
├── scoring.ts          501/301 bust/win + stat math    │ pure logic,
├── analysis.ts         consistency / finishing / etc.  │ unit-tested,
├── atc.ts              Around the Clock engine + stats │ no React
├── stats.ts            cross-match aggregation         ┘
├── types.ts            shared interfaces
├── styles/main.css     dark theme
├── components/Header.tsx
└── screens/
    ├── Home.tsx        roster + navigation + backup/restore
    ├── Setup.tsx       new-match configuration
    ├── Live.tsx        x01 live scoring (the core screen)
    ├── LiveAtc.tsx     Around the Clock live scoring
    ├── Summary.tsx     post-match stats
    ├── History.tsx     match list + detail breakdown
    └── PlayerStats.tsx tabbed lifetime stats + charts
```

Icons are generated by `scripts/gen-icons.mjs`. Tests live in `tests/`
(run with `npm test`): unit tests for the pure logic plus jsdom render
smoke-tests for the React screens.

## Notes on scoring

- A turn **busts** when it would take the remaining below 0, lands exactly on 0
  without a double (when Double Out is on), or would leave exactly 1.
- 3-dart average = `(total points scored / darts thrown) * 3`; busts score 0 but
  still count their darts.
- Checkout % = winning turns ÷ turns that started in checkout range: ≤ 170
  remaining with Double Out, ≤ 180 with Straight Out (where T20 T20 T20 is a
  legal finish).

## Stretch goals (not yet implemented)

Cricket mode, sound effects, and
local-network multi-device sync.
