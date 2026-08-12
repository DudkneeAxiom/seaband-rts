# Salt & Tally — working notes

A maritime sandbox: one battered cutter, an ocean of sails, trade or fight your way
to a fleet. Plain ES modules, one vendored copy of three.js, **no bundler and no
build step** — `index.html` loads `src/main.js` directly through an importmap.

## Running it

```bash
npm run setup     # npm install + playwright's chromium (first time only)
npm start         # http://localhost:8080
npm test          # every suite, against a server it starts itself
npm run test:fast # same, minus the two slow calibration runs
npm run bundle    # dist-single/salt-and-tally.html — the whole game in one file
npm run build     # dist/ + the itch.io zip
```

Node 18+. The game itself needs nothing installed — `npm install` is only for the
QA harnesses. Screenshots go to `shots/` (gitignored); `QA_OUT` overrides.

## Layout

```
index.html            markup for every screen; the importmap lives here
style.css             the entire UI — mobile-first, safe-area aware
src/main.js           boot, render loop, input wiring, attract mode
src/game.js           game state, world simulation, rules, save/load, markers
src/data/gamedata.js  factions, hulls, goods, ports, crew — tuning lives here
src/data/origins.js   the five questions, their effects, antagonists, chapters
src/core/             util, geometry, camera, pointer input, keys, procedural audio
src/world/            terrain bake, water shader, sky
src/ships/            procedural ship meshes, the Ship entity, NPC captains
src/combat/           ballistics, broadsides, boarding
src/sim/              market, officers, encounters, battle instances
src/ui/               DOM helpers, HUD, bottom-sheet screens, the questionnaire
tools/                QA harnesses, the static server, the build and the bundler
vendor/               three.js r180, vendored — no CDN, no network at runtime
```

## How this codebase is tested

Every suite drives the **real game in a real browser** through the real UI. There
are two rules that have each been learned the hard way here:

1. **Do not fake state to make a test pass.** If a test wants a docked ship, sail
   or place one and let the game decide it is docked. Several bugs in this repo
   were hidden for a while by tests that set the flag themselves.
2. **Poll, do not sleep.** The QA renderer is software GL at roughly eight frames
   a second. `waitFor(page, fn)` and the `hold()` helper in `tools/helm.mjs`
   exist because fixed sleeps produce tests that pass on a fast machine and fail
   on a slow one. A fixed sleep in a new test is almost always a latent flake.

Look at things. `npm run sweep` walks every screen and writes screenshots — that
is what found the flat UI, the harbours built in open water, and the firing arcs
the sea was slicing into shards. Assertions cannot see any of those.

CI runs `npm run test:fast` on every PR into `main` (`.github/workflows/tests.yml`)
and uploads `shots/` when a suite fails. It skips `gunnery` and `world`, so run
the full `npm test` yourself after touching anything those two measure.

## The three layers

The ocean is the **campaign**. Physical contact between hostile fleets makes an
**encounter**. An encounter can make a **battle**. `game.mode` is the one place
that is written down, and everything that asks "can I fire", "can I dock",
"what do the buttons say" asks it first.

- **Nobody opens fire on the campaign layer.** `tryFire` refuses when the target
  is the player's and `ctx.combatLive` is false, and a raider closes to touching
  distance rather than taking up a gunnery station. Contact is an event, not a
  range band.
- **A battle is fought where the fleets met.** Not a separate arena: the reef you
  were running for is still under you and the terrain is the truth about that
  place. What a battle does is *narrow* — everyone else is benched by splicing
  them out of `game.ships` and hiding their meshes.
- **Splice, never reassign, `game.ships`.** `Projectiles` and the AI `world`
  object hold a reference to that exact array.
- **`save()` refuses while `mode === 'battle'`**, because the ship list is not
  the world at that moment. The battle saves itself when it ends.

## Conventions worth keeping

- **Derive, do not store.** Only the questionnaire's *answers* are saved; skills,
  traits, the nemesis and the ending are recomputed on load, so a save can never
  disagree with the questions. Same instinct elsewhere: the compass measures north
  off the projection rather than deriving it from the camera's own numbers.
- **Generate the promise from the mechanic.** The effect chips under each origin
  option come from the effect objects themselves, and the key list on the HELM
  page renders from `KEYMAP`. Neither can drift from what the code does.
- **Touch is the design centre.** Every interactive target is ≥44px. The keyboard
  layer is a shortcut to something a thumb can already reach, never the only way.
- **Nothing blocks the player permanently.** Contracts pay an advance so a captain
  with nothing can still take work; harbours are refuges so running for port
  always works. If a change can strand someone, it needs a way back.
- Comments explain *why*, especially where a number was tuned or a bug was
  subtle. Match the surrounding prose style.

## State of it

Feature-complete vertical slice with the campaign/encounter/battle spine in
place. `tools/all.mjs` runs 230-odd checks across thirteen suites; all green at
the last commit on this branch.
