# React migration — review fixes (in progress)

Branch: `claude/react-migration`. The React migration was merged into the wrong
base (`claude/test-suite`) so it never reached `main`. After these fixes, open a
**fresh PR `claude/react-migration` → `main`** to actually ship it.

## Tasks
- [ ] #1 confirm-turn double-submit race — guard `confirmTurn` in `Live.tsx` and
      `LiveAtc.tsx` with an in-flight ref so a double-tap can't record a turn
      twice / run the win branch twice.
- [ ] #2 error boundary — add an `ErrorBoundary` in `main.tsx` around the route
      switch (replaces the old `try/catch + toast` from the deleted `main.ts`).
      Key it by route so it resets on navigation.
- [ ] #3 stale input state across matches — keyed boundary by route + explicit
      `key={matchId}` on `<Live>`/`<LiveAtc>` so `currentDarts`/`multiplier`
      reset when switching matches.
- [ ] #4 "Match not found" toast — toast in `LiveRoute` (main.tsx) before
      `navigate('/')` when `getMatch` returns null.
- [ ] user request: in progressive ATC, the **+3 (Treble) button must be
      disabled on the bull** (only outer/inner bull exist). Already wired via
      `onBull` in `LiveAtc.tsx` — verify and harden/comment.
- [ ] verify: `npm run typecheck`, `npm test`, `npm run build` all green.
- [ ] remove this file, open PR `claude/react-migration` → `main`.

## Notes
- Findings #5 (navigate-in-render, latent) and #6 ("legs" plural, cosmetic) are
  intentionally deferred.
