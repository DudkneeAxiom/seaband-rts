# Salt & Tally — handoff

Context for an agent picking this up cold. `CLAUDE.md` has the working notes and
conventions; this file is what happened, what was measured, and what is still open.

## What it is

A mobile-first maritime sandbox: one battered cutter, an ocean of sails, trade or
fight your way to a fleet. Plain ES modules, one vendored copy of three.js r180,
**no bundler and no build step** — `index.html` loads `src/main.js` through an
importmap. Nothing is fetched at runtime.

Everything is original: the world, the three factions, the ship names, the
questionnaire, the story. It is *inspired by* Mount & Blade's progression fantasy
and copies none of its world, terminology or art.

## Running it

```bash
npm run setup     # npm install + playwright's chromium (first time only)
npm start         # http://localhost:8080
npm test          # all 12 suites, against a server it starts itself (~11 min)
npm run test:fast # same, minus the two slow calibration runs
npm run bundle    # dist-single/salt-and-tally.html — the whole game in one file
npm run build     # dist/ + the itch.io zip
npm run sweep     # walk every screen and write screenshots to shots/
```

Node 18+. The game itself needs nothing installed; `npm install` is only for the
QA harnesses.

**To test without any of that**: open `salt-and-tally.html` (the single-file
build) directly in a browser. It runs from `file://` with no server — that is
what `tools/single-check.mjs` verifies, 8 checks.

## Layout

```
index.html            markup for every screen; the importmap lives here
style.css             the entire UI — mobile-first, safe-area aware
src/main.js           boot, render loop, input wiring, attract mode
src/game.js           game state, world simulation, rules, save/load, markers
src/data/gamedata.js  factions, hulls, goods, ports, crew — tuning lives here
src/data/origins.js   the five questions, their effects, antagonists, chapters
src/core/             util, geometry, camera, pointer input, keys, routing, audio
src/world/            terrain bake, water shader, sky
src/ships/            procedural ship meshes, the Ship entity, NPC captains
src/combat/           ballistics, broadsides, boarding
src/sim/              market, officers
src/ui/               DOM helpers, HUD, bottom-sheet screens, the questionnaire
tools/                QA harnesses, the static server, the build and the bundler
vendor/               three.js r180, vendored — no CDN, no network at runtime
```

## How this codebase is tested — read this before writing a test

Every suite drives the **real game in a real browser** through the real UI.
Twelve suites, 207 checks. Four rules, each learned the hard way here:

1. **Do not fake state to make a test pass.** If a test wants a docked ship, sail
   or place one and let the game decide it is docked. If it wants a consort,
   board a ship and let the prize dialog commission her. Several bugs in this
   repo hid for a while behind tests that set the flag themselves.
2. **Poll, do not sleep.** The QA renderer is software GL at roughly eight frames
   a second. `waitFor(page, fn)` exists because fixed sleeps produce tests that
   pass on a fast machine and fail on a slow one. **Five separate flakes in this
   project have been exactly this.** A fixed sleep in a new test is a latent
   failure, not a style question.
3. **`QA_SLOW=6 node tools/<suite>.mjs`** throttles the browser to a sixth speed
   through CDP. Every flake here passed locally and failed on a hosted runner;
   this makes that difference reproducible in minutes instead of a push and a
   twenty-minute wait. Use it on anything new that touches the UI.
4. **Look at things.** `npm run sweep` walks every screen and writes screenshots.
   That is what found the flat UI, the harbours built in open water, and the
   firing arcs the sea was slicing into shards. Assertions cannot see any of it.

CI runs `npm run test:fast` on every PR into `main` (`.github/workflows/tests.yml`)
and uploads `shots/` when a suite fails. It skips `gunnery` and `world`, so run
the full `npm test` after touching anything those two measure.

## What was done in this session

Eight commits on `claude/maritime-sandbox-rpg-uhrf5r`, 24 files, +1336/−135, all
green. In order:

**CI, and two bugs writing it uncovered.** `npm run test:fast` was broken
outright — `serve.mjs` read `process.argv[2]` as its port at import time, so when
`all.mjs` was the program the port became `+('--fast')`, i.e. `NaN`. And a
starvation check contradicted itself: no more than 8 deaths *and* more than half
of 15 hands surviving, which cannot both hold.

**Playtest round one.**
- *Travel* was not a speed problem. Measured port to port, two of three legs
  never arrived: a course across a shoal grounds you, grounding cuts speed to 8%
  and bites the hull twice a second, and with the destination still dead ahead
  she grinds there forever. There is now a coarse A\* over the baked depth field
  (`src/core/route.js`), with corners pulled out so open water stays one straight
  run and `null` returned when the rhumb line is already clear. Mean leg 1.6 min.
- *Gunnery.* A four-gun raider killed a fresh cutter in 9 volleys and had half
  the hull off in 4. Damage down a fifth: 10.8 volleys now; an eight-gun lugger
  still takes her in 5, which is intended — the answer to that fight is seeing it
  coming, not blunting every gun in the game.
- *Aggro rings* on the water, drawn from `willHunt()`, which runs the same three
  tests `findPrey` makes, so a ring cannot promise a fight that would not happen.
- *Sky and headlands* toward a painted look.

**UI pass.** Rope borders replacing the gold (a masked ring on a pseudo-element,
because `border-image` squares off rounded corners); "Chapter 2 of 6" above the
chapter name in both the story card and the HUD objective; a lighter teal sea;
a seabed that carries to 52 units in two grains so drop-offs read as depth; and
menus now hold the world, derived from what is on screen rather than a flag, and
without touching the player's own speed setting.

**The audio bug, properly.** Reported as a jump-scare screech. The first fix
found a real leak — a delay-feedback cycle built per note, never collected — and
was reported as solved without checking that leak was the sound being described.
It was not. The cause was `sfxClash`: three square oscillators between 700 and
2100 Hz (harmonics at 6, 10 and 14 kHz — the band the ear refuses to forgive),
fired from `onBoardTick` every 0.62s for the whole duration of *every boarding
anywhere in the world*, with no distance term and no voice cap. The world boards
ships whether the player is near or not.

Now: a filtered noise scrape and two triangles under a kilohertz, lowpassed,
attenuated with range, silent past 620 units, voice-capped, given the distance at
the call site. Broadsides, hits and splashes had volume *floors* rather than
cutoffs and now fall to nothing. Every number reaching an AudioParam is coerced
finite first — a NaN there poisons filter and compressor state permanently, which
is what a screech that never stops actually is. And the limiter now limits: a
fleet action measured 1.076 at the destination (distortion) and is 0.562.

**`tools/audio.mjs`** is the durable part: an analyser past the limiter, and
assertions on what actually reaches the ear. Audio was the only subsystem with no
test at all, which is why the bug survived a fix and a confident report.

**Fleet rearming.** Stores only ever went aboard the flagship; nothing anywhere
refilled a consort, so a prize fired off what was in her when taken and was a
hull with sails after that. There is a "Powder for the Consorts" row in every
harbour now (`fleetStores()` / `storeFleet()` in `game.js`), and a consort running
dry says so.

**Harness hardening.** CI went red on a fixed sleep a fourth time; chasing it
found four more, two in tests written the same day. `QA_SLOW` came out of this.

## Numbers that were measured, not guessed

| Thing | Value |
|---|---|
| Volleys to kill a fresh cutter (4-gun attacker) | 10.8 (~73 s) |
| Volleys to kill a fresh cutter (8-gun lugger) | 5 (~28 s) |
| Mean port-to-port leg at 1× | 1.6 min |
| Audio peak, fleet action | 0.562 (was 1.076 — clipping) |
| Audio peak, silence | 0.001 |
| 30 boardings across the map | 0.0001 |
| 8 boardings alongside | 0.36 |
| Cost to refill a dry lugger's lockers | ◆9 |

## Open / worth a look

- **The water shader is the weakest link for the painted look.** Sky, islands and
  seabed read well; the sea surface itself has not been reworked. Deliberately
  untouched — it is a bigger change and wanted a play session first.
- **The lugger fight is intentionally lethal.** 5 volleys is by design; a cutter
  should lose to a lugger. If it still feels like an execution with the rings up,
  the lever to reach for is *incoming* damage specifically, not `gunDamage`,
  which is shared with the player's own guns.
- **Fleet stores are deliberately cheap** (◆9 for a dry lugger). It was treated
  as a missing affordance, not a resource decision. If rearming a large fleet
  should cost something, that number is the knob.
- **The PR description is stale.** PR #1 still describes only the CI workflow
  while the branch now carries all of the above.
- Node 20 deprecation warnings from the GitHub Actions runner (`actions/*@v4`
  target Node 20). Cosmetic; bumping to `@v5` would clear them.

## Mistakes made here, so they are not repeated

- **A fix that was verified against the wrong thing.** The audio leak was real,
  the fix was correct, and it was not the reported bug. Reproduce the symptom
  before claiming a cause.
- **Three wrong diagnoses in a row** on the origin-suite stall (stale modal, then
  the animation kill, then a debounced click). What resolved it was making the
  helper report *why* it gave up — one run, one answer: `engaged: true`, a
  respawned raider inside 420 units holding the story. Instrument before
  theorising.
- **A test that passed for the wrong reason.** The audio suite's silence baseline
  was measured while the ambience beds were still fading, so "silence" was louder
  than the sound under test and "a distant boarding adds nothing" was green and
  meaningless. Green is not the same as correct.
- **A harness fix with a hole in it.** Entrance animations are killed during QA
  runs (the software renderer freezes the document timeline, so anything fading
  in from `opacity: 0` — story cards — is invisible forever, which is why no
  screenshot in this project had ever shown one). It first went in via
  `addStyleTag`, which does not survive navigation, and two suites reload the
  page. It is an init script now.
