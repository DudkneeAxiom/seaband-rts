# Handoff — Salt & Tally

Read this first, then `CLAUDE.md`, then `docs/findings.md`.

Branch: **`claude/maritime-sandbox-rpg-uhrf5r`** — everything below is pushed.
Head at handoff: `3808eeb`.

---

## What this is

A mobile-first maritime sandbox RPG. Plain ES modules, one vendored copy of
three.js, **no bundler and no build step** — `index.html` loads `src/main.js`
through an importmap. The whole game ships as one HTML file.

```bash
npm run setup     # first time only
npm start         # http://localhost:8080
npm test          # all 16 suites, against a server it starts itself
npm run bundle    # dist-single/salt-and-tally.html, then verifies it
```

Suites drive **the real game in a real browser** through the real UI. Two rules
that have each been learned painfully here, both in `CLAUDE.md`:

1. **Never fake state to make a test pass.**
2. **Poll, do not sleep.** The QA renderer is software GL at ~8fps.

---

## THE IMMEDIATE JOB: three open failures

A full run on the town-layout commit came back **13/16**. These are almost
certainly disturbed by rebuilding every settlement (see "the town pass" below),
not by unrelated rot. Take them in this order.

### 1. `systems` — "an action at 4x opens at 1x (clock read 4x **on the campaign layer**)"

The diagnostic is the useful part: *on the campaign layer* means `intoBattle()`
never produced a battle at all. **This is a staging failure, not the 4× rule.**
The rule itself is fine and has passed many runs.

`intoBattle` (in `tools/qa.mjs`) stages the player at `(120, 60)` and a raider
110m off. Check first whether that water is still what it was — the settlement
generator changed, and a raider that grounds or sheers off never arrives.

### 2. `trade` — "DOCK offers itself when you are hove to on a clear quay"

Docking needs `dist < port.dockR && speed < 7.5`. New buildings and new ground
near the quay are the obvious suspect. Print the player's depth, speed and
distance to the port at the moment the check gives up.

### 3. `layout` — "NOTHING TO MEASURE: pursuit, target, fleet never came up"

This guard is **telling the truth and must not be relaxed** — it refuses to
report "0 problems" when it measured nothing. State was present (pursuit set,
target *Tally Mark*, fleet 2) but the panels had not painted. This is the
`ff()` trap below: it needs a real frame before it measures.

A run covering the current head (`3808eeb`, including the roof and yard work)
was in flight at handoff and its result was not seen. **Run `npm test` first
and work from what it actually says**, rather than assuming these three are
still the live set.

---

## Traps that cost real time this session

Every one of these is written up with a reproduction in `docs/findings.md`.

- **`ff()` moves the world, not the HUD.** It drives `game.update` directly;
  the HUD redraws on rAF. Reading the DOM straight after `ff()` gives you the
  previous frame. This produced three separate confidently-wrong diagnoses.
- **Verify the artefact, not the exit code.** A `python … && git commit` chain
  where the edit throws will happily commit without the edit. This shipped an
  undocumented module once and nearly did twice.
- **Section ordering in suites.** Sections that *change* the world must come
  after sections that measure a world without those changes. Inserting a new
  section mid-chain has broken later checks three times.
- **Measure the terrain, do not guess at it.** Two placement rules were written
  from taste and built one building for an entire town. Probe first — and note
  `window.__terrain.heightAt` and the generator's `heightAtAnalytic` are easy
  to get sign-confused between.
- **A harness that crashes is worse than one that fails**, because it takes the
  evidence with it. Guard every `g.battle.*` and similar dereference.
- **The layout audit only finds overlaps.** It passed a 19px tab bar clipping
  44px buttons on every port screen for the life of the sheet. A "does content
  fit its container" check is still missing and would be worth adding.

---

## What was built this session

Roughly in order. Detail and reasoning for all of it is in `docs/findings.md`
(20 entries, each symptom → root cause → change → verification).

**Gameplay fixes from playtest:** distant NPC battles no longer count as your
combat (this was the real cause of delayed/stacked chapter cards); grape shot
no longer makes capture a formality; a prize can actually be commissioned and
commanded (the old gate was arithmetically impossible for any player); a ship
aground can always steer herself off; consorts fight on the enemy's far side
and your shot passes your own hulls.

**Systems added:**
- **Adaptive score** (`src/core/music.js`, `docs/music.md`) — one original
  tin-whistle motif arranged across sea / approach / port / six faction
  dialects / two tension tiers / four battle movements / boarding / victory /
  defeat / discovery. Crossfaded layers on a bar-aligned scheduler. All
  synthesised — no assets.
- **Bounties** — ports post notices against ships **already sailing in the
  world**, owned by a named notable.
- **Living ports** (`src/data/notables.js`, `src/sim/social.js`) — Ilo Vantu
  and Fort Escarra have identities, five notables each, relationships with
  trait-weighted changes, memory, a tie graph, and a People journal. Save
  migration is handled: an old save with no `social` key loads with nobody
  having met you.
- **Port scenes** — each location renders a real photograph of its own
  building via `window.__portrait` in `src/main.js`.

---

## Deferred, with the shapes already in place

- Notables for the other three ports. **Add a `PORT_IDENTITY` entry plus five
  `NOTABLES` rows and the town hub, journal and bounty attribution all pick it
  up with no UI work per port.**
- Elias Mercer's `cordelia` officer arc — the field exists, unwired.
- The authored officer-friction event — in data, never triggered.
- NPC world progression over time.
- **Buildings are still plain boxes up close.** Base courses and window
  openings are the natural next visual step, now that the roofs give a correct
  silhouette to hang them on.
- The water shader and yard-upgrade pricing were both deliberately left alone —
  pricing needs income measured across real play before any number moves.

---

## Working agreements that served well

- Look at things. `npm run sweep` and one-off screenshot scripts in `tools/`
  found the flat UI, the clipped tabs and the placeholder town scenes. None of
  those had failing assertions.
- Fix the class, not the instance. Two copies of a rule is one rule and one bug.
- When a check fails, first ask whether it is measuring what it claims.
- Delete temporary probe scripts (`tools/_look.mjs` etc.) before committing.
