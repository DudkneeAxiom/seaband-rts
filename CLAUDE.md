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
npm run bundle    # dist-single/salt-and-tally.html — one file, then plays it
npm run build     # dist/ + the itch.io zip
```

`npm run bundle` runs `single-check` against the file it just wrote, because a
bundle nobody opens is a bundle nobody knows is broken: that check sat outside
`all.mjs`, went stale across the campaign/battle split, and was still asserting
that a broadside fires on the campaign layer — the one thing the rules now
refuse. Use `bundle:only` if you genuinely just want the file.

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
src/data/notables.js  the people of the two authored ports, and named officers
                      (every port has a town page; these add people to two)
src/core/             util, geometry, camera, pointer input, keys, procedural audio
src/world/            terrain bake, water shader, sky
src/ships/            procedural ship meshes, the Ship entity, NPC captains
src/combat/           ballistics, broadsides, boarding
src/sim/              market, officers, encounters, battles, the social layer
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
- **Progression the player can see.** A refit that changes a number changes the
  hull too: copper is the planking's own colour below a raised boot-top, new
  gunports are guns you can count. Faction identity works the same way — each
  power has a `build` in `FACTIONS` that picks construction, deck fittings and
  sail plan in `shipFactory`, so six powers are six objects and not six
  recolours, and a prize keeps the build she was made with while her paint
  changes hands. Colour is never the only signal; the silhouette carries it.
- **A seed per thing, not one stream for everything.** Each port's opening books
  and each ship's procedural details come from a seed derived from its own id or
  name. One shared stream means adding a harbour silently reshuffles every
  harbour after it in the list — which is how two new ports once put a ◆385/min
  arbitrage run on the board that nobody had tuned.
- **A tuned number is tuned against something — say what, and re-measure it
  elsewhere.** What a builder will accept was measured honestly on Ilo Vantu
  and then applied to every coast: Ilo Vantu is a beach, Fort Escarra is a
  seventy-metre rock, and the rock built *no buildings at all* while six
  settlement checks passed. Both limits are derived per port from that port's
  own ground now. A constant that came from measuring one place is a constant
  with a hidden argument in it.
- **Assert the thing exists, not only that it is well placed.** Every check on
  the settlements asked *where* the town was — waterfront on dry land, label
  above the roofs, mooring afloat — and a port with zero buildings passed all
  of them. Cheap existence checks catch the failures the careful ones assume
  away.
- **Every port is a place, not a set of counters.** A harbour opens on its town
  — a photograph of its real buildings, what it is, and what it trades — and
  the counters are one tap behind that. The page derives from what every port
  already has (`tagline`, `desc`, `prices`, its faction's flag colour), so
  adding a port cannot leave a half-built screen; `PORT_IDENTITY` and
  `NOTABLES` add mood and people on top where they exist.
- **If the player has a rule, the world usually needs it too.** `findRoute`
  existed for a year and was wired to tap-to-sail alone, so NPC captains went
  on steering the rhumb line into headlands — the exact fault the route module
  was written to cure, still live for every hull but one. When a fix lands on
  the player's path, ask what else takes that path.
- **A rule about position must cover what is actually drawn.** Placement
  sounded the nominal footprint while `building()` draws past it, so buildings
  were approved whose geometry hung over the harbour. Each kind declares its
  drawn extent now. The same trap caught the AI twice: a route is no help to a
  ship whose *destination* is a hill, so loitering stations and escort
  stations are sounded before they are taken. Then a third and fourth time,
  one level along again: sounding the station and not the *run to it* put
  escorts on the ground at five times the rate of the merchants they guarded,
  and `smooth()` string-pulled from the grid cell nearest the ship rather than
  the ship, so the first leg of every route was the one leg nobody sounded.
  Sound the whole road, from where she actually is.
- **A course is only clear from where you are now.** `findRoute` returns null
  for "the rhumb line is already clear", and that answer was kept for a whole
  leg — so a hull set down by the wind, or shoved off her line by `avoidLand`
  working round a headland, sailed on into land nobody had re-checked. Eleven
  of fifteen strandings were hulls carrying no route at all. Anything steering
  a long line has to re-sound it as it sails it.
- **A constant that fits one hull is not a fact about the sea.** The route grid
  cleared every cell over 6.5m, which is the player's cutter's answer with
  three metres to spare — and it was routing a 7.13m fluyt and an 8.97m frigate
  through the same water. The grid holds the shallowest cast per cell now and
  `keelFor(draft)` asks the question per hull, with the shallow road as a
  fallback so no place becomes unreachable. Same shape as the settlement limits
  tuned on Ilo Vantu: measure what a number was tuned against, then ask who
  else has to live with it.
- **A guard that reads a flag must run before something else sets it.** The
  price of attacking a neutral was charged in the damage callback, guarded on
  "she is not already hostile" — and a battle flags every enemy hostile as it
  forms, so the guard was always shut by the time it was asked. Piracy was
  free. Charge at the moment of choice, not at the moment of consequence.
- **If a manoeuvre matters, give it a control.** BOARD only appeared once you
  were already alongside, so closing the last two hundred metres had no button
  — and the only input left, tapping the water beside her, lands on the marked
  ship and unmarks her. The gesture available for the job undid the job. A
  button that gives the order beats an input the player has to be clever with.
- **Test the mechanism, not the weather around it.** Three assertions on the
  consort flank rule each watched a real duel and measured what came out —
  widest separation, held separation, share of the action masked — and all
  three were flaky, the last one ranging 0% to 92% across staged trials. The
  check that works stages the fault the rule exists to correct (a consort
  squarely in front of your guns) and asks whether the steering fixes it.
- **Stage the fault by construction, and assert the decision, not the
  aftermath.** The escort check learned this three ways in one sitting. It
  passed with the fix removed because it sounded her *heading* — which measures
  `avoidLand`, a greedy rule that deflects a bow off a rock whatever nonsense
  it was aimed at; what the rule under test decides is the point she steers
  for, so the brain records that and the check reads it. Then it passed on a
  leftover `brain.path` from the hull's previous life as a merchant. Then it
  failed one run in three because a hostile in sight sent her into the fight
  branch and the scenario never happened at all. **Prove a new check fails with
  its own fix reverted** — all three of finding 49's do — or it is decoration.
- **A harness that drives the world by hand must prove the world moved.** Three
  probes in a row reported confident numbers about a simulation that was not
  advancing: one teleported the player onto a hillside (`depth -16.7m` is not
  deep water, it is ground 16.7m up) and measured a parked hull for twenty
  minutes; two more spun at `dt = 0` because a modal had paused the world and a
  bulk `for (…) g.update()` inside `page.evaluate` cannot click the button that
  clears it. Both "findings" they produced were fiction. Check `g.time` moved,
  check she is floating, check nothing is paused — before believing anything.
- **One control per job.** The town page briefly carried a WHERE TO GO list —
  a row and a GO button per counter — directly beneath a tab strip with one
  tab per counter. Navigation written out twice is not twice as navigable; it
  is one control and one thing in the way.
- Comments explain *why*, especially where a number was tuned or a bug was
  subtle. Match the surrounding prose style.

## State of it

Feature-complete vertical slice with the campaign/encounter/battle spine in
place and six powers with water of their own. `tools/all.mjs` runs 359 checks
across sixteen suites; all green at the last commit on this branch
(16/16 in about twenty minutes).
