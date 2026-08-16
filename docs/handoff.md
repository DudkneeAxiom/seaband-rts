# Handoff — Commodore

Read this first, then `CLAUDE.md`, then `docs/findings.md`.

Branch: **`claude/maritime-sandbox-rpg-uhrf5r`** — everything below is pushed.
Head at handoff: the finding-21 commit (the campaign save-guard staging fix).

---

## What this is

A mobile-first maritime sandbox RPG. Plain ES modules, one vendored copy of
three.js, **no bundler and no build step** — `index.html` loads `src/main.js`
through an importmap. The whole game ships as one HTML file.

```bash
npm run setup     # first time only
npm start         # http://localhost:8080
npm test          # all 16 suites, against a server it starts itself
npm run bundle    # dist-single/commodore.html, then verifies it
```

Suites drive **the real game in a real browser** through the real UI. Two rules
that have each been learned painfully here, both in `CLAUDE.md`:

1. **Never fake state to make a test pass.**
2. **Poll, do not sleep.** The QA renderer is software GL at ~8fps.

---

## Where the suite actually stands

**16/16 clean, twice** — once on `3808eeb` in 1211s, and again in 1382s after
the finding-21 fix below. Those runs cover everything in this document — the
social pass, the typed buildings, the rebuilt roofs, the yard on the pier line
and the scenic port cards.

Earlier runs during this work reported failures (13/16, then 15/16). Three of
those cleared without being fixed — transient, disturbed by an intermediate
state of the town rebuild. The fourth looked like it had cleared too, and had
not: it was an intermittent harness fault that simply rolled a passing run.
The specific ones, in case any returns:

- `systems` — "an action at 4x opens at 1x (clock read 4x **on the campaign
  layer**)". The diagnostic is the useful half: *on the campaign layer* means
  `intoBattle()` never produced a battle. A staging failure, not the 4× rule.
  The water suspicion was since checked directly: the bake puts 70m under both
  hulls at `(120, 60)` and along the whole approach, so if this fails on the
  campaign layer again, the water is not the reason.
- `trade` — "DOCK offers itself when you are hove to on a clear quay". Docking
  needs `dist < port.dockR && speed < 7.5`. Print depth, speed and distance at
  the moment it gives up.
- `layout` — "NOTHING TO MEASURE: pursuit, target, fleet never came up". This
  guard is **telling the truth and must not be relaxed**; it refuses to report
  "0 problems" when it measured nothing. It needs a real frame before it
  measures — the `ff()` trap below.
- `campaign` — "a battle cannot overwrite the save with a benched world (13
  sail in the instance)". **This one was a real defect in the harness and is
  fixed — finding 21.** The guard was never leaking: the boarding checks in
  section 10b run the better part of a minute of simulation, a capture that
  empties the instance ends the battle by itself, and the check then measured
  `save()` on the campaign layer, where writing is correct. The thirteen sail
  were the restored campaign roster, not an instance. Section 11 now re-enters
  a real battle when the last one has settled, and its message says which of
  the two bugs it is describing.

**The lesson is the pattern, not the list.** Most failures under a rebuild are
the suite catching an intermediate state — but "it passed on the rerun" is not
the same as "it was transient", and the one that was written off that way was
a coin-flip that had merely landed well. Run `npm test`, work from what it
says today, and when a failure vanishes, know *why* before closing the book.

## Where to pick up

Nothing is broken, so the next work is chosen rather than forced. In rough
order of value:

1. **Notables for the other three ports** — the cheapest big win. Add a
   `PORT_IDENTITY` entry plus five `NOTABLES` rows and the town hub, the
   People journal and bounty attribution all pick it up with no UI work.
2. **Buildings up close** — base courses and window openings. The roofs give a
   correct silhouette to hang them on now.
3. **A "does content fit its container" layout check** — see the traps below.
4. Mercer's `cordelia` arc, the officer-friction event, NPC progression.

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
