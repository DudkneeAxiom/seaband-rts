# Salt & Tally

**A maritime sandbox for phones.** One battered cutter, a handful of sailors, and an
ocean full of sails. Trade, hunt pirates, shoot away a rival's rigging, throw grapples
over her rail, and sail home with her under your flag.

A playable vertical slice: roughly 20–30 minutes of first play, replayable after that.
Runs entirely in the browser, no backend, no build step.

---

## Play it

```bash
npx http-server . -p 8080 -c-1
# then open http://localhost:8080
```

Any static file server works — the game is plain ES modules and one vendored copy of
three.js. Open it on a phone on the same network for the real thing.

### Without a server

```bash
node tools/bundle.mjs     # writes dist-single/salt-and-tally.html — the whole game in one file
```

That single ~1 MB file has three.js, every module, the stylesheet and the markup
flattened into one classic `<script>`. Open it straight from `file://`, e-mail it to
yourself, drop it in iCloud Drive and tap it on an iPad — it needs no server, no network
and no build step. Saves still work (localStorage). It also produces
`dist-single/artifact.html`, the same page without the `<html>/<head>/<body>` wrapper,
for hosts that supply their own document skeleton.

### For itch.io

```bash
node tools/build.mjs      # writes dist/ and salt-and-tally-web.zip (~267 KB)
```

Upload the zip, tick *"This file will be played in the browser"*, set the viewport to
960×540 or larger, and enable **Fullscreen** and **Mobile friendly**.

---

## Controls

Designed for thumbs. Mouse mirrors touch for desk testing.

| Action | Touch | Mouse |
|---|---|---|
| Set a course | Tap the water | Click the water |
| Mark a target | Tap a ship | Click a ship |
| Swing the view | Drag | Drag |
| Zoom | Pinch | Scroll wheel |
| Fire a broadside | **FIRE** (lights when a battery bears) | same |
| Choose shot | **ROUND / CHAIN / GRAPE** | same |
| Board | **BOARD** (appears alongside a slowed ship) | same |
| Enter port | **DOCK** (appears inside the harbour buoys) | same |
| Fleet orders | **FOLLOW / ENGAGE / HOLD** (appear once you have a consort) | same |
| Time | **❙❙ / 1× / 2×** bottom left | same |
| Log, help, settings | ☰ top left | same |

Buttons only exist while they mean something, so the ocean keeps the screen.

---

## The arc the demo is built around

1. Start off Ilo Vantu in a battered cutter with thirteen hands.
2. Learn to sail — the wind matters, and the pale water is shallow.
3. Make port. Repair, take on provisions and shot, recruit, hire an officer.
4. Put to sea. Merchants, fishing boats, Admiralty patrols and Tally pirates are
   already going about their business.
5. Find a Tally ship. Cut her rigging with chain shot, sweep her deck with grape.
6. Come alongside, take the way off her, and **BOARD**.
7. Win, and choose: give her to an officer on the spot, send her home as a prize,
   strip her, or scuttle her.
8. Sail back with two ships under your flag. Look astern.
9. Take the *Long Answer* contract in the tavern and go after Mireya Sant with a fleet.

---

## Core systems

**Finding things.** The current objective is spelled out in one line, and when its
target is off screen a chevron pins to the edge of the view with the bearing and the
range in metres — a port, a contract's destination, or the nearest Tally sail.

**The rig reads the wind.** Yards brace round and the canvas bellies to leeward from
the live wind angle — square before a following wind, hard round and flat when you are
close-hauled, empty when you point into it. Shot-away rigging reefs up to the yards. It
is one draw call: the whole rig is built flat with a pivot and a (u,v) parameter per
vertex, and a vertex stage on the standard material swings it. You can read a ship's
point of sail off her rig alone, on your own hull and on everyone else's.

**Sailing.** Tap-to-course with real momentum: hulls accelerate, carry way, and have a
turning circle. Speed comes from `hull class × rigging condition × crew skill × cargo ×
wind angle`. Running before the wind is worth 100%; beating into it, 38%. That spread
is the whole reason a chase is interesting.

**Systemic damage.** Four tracked systems, no single health bar:
hull (sinking), sails (mobility), crew (everything), and guns per side. Round shot
smashes hulls, chain shot cuts rigging, grape sweeps decks. Which one you load decides
whether you sink a ship or capture her.

**Gunnery.** Every shot is a real object with a solved ballistic arc. Spread grows with
range and shrinks with gunnery skill — a green crew lands about 55% at 50 m and under
10% at extreme range, so closing is a decision, not a formality. Guns bear only on the
beam; the arcs are drawn on the water while a target is marked.

**Crew.** Deckhand → Sailor → Gunner / Marine / Rigger → Old Salt. Sea time and battle
rate people up between voyages. Sailors work the rig, gunners the battery, marines the
rail. Losing a trained crew hurts in a way losing a number does not.

**Officers.** Named people with generated portraits, traits, roles and wages: First Mate,
Navigator, Master Gunner, Boatswain, Surgeon, Marine Officer. Each gives a concrete
bonus, gains experience, and — at skill 2 or better — can be given a command of their own.
Fleet growth is gated on officers, which is what makes hiring one feel like a decision.

**Boarding & capture.** Grapples, a tug-of-war resolved from marine count and quality,
crew morale and officer bonuses, with casualties on both sides and a live odds figure on
the button before you commit. Win and the prize is yours to keep, sell or sink.

**Fleet command.** FOLLOW / ENGAGE / HOLD. Consorts navigate and fight themselves —
you give intent, your captains execute it.

**Economy.** Five goods across three settlements, with per-port price modifiers, stock
that drifts back to a local baseline, and NPC merchant arrivals that move the books.
Buy cheap, accept the risk of the passage, sell dear.

**Sizing up a sail.** Every ship that is not yours carries a pip above her mast
colouring how she compares to everything under your flag — two green chevrons down for
far weaker, amber for an even fight, two red up for far stronger. Marking a target opens
the same comparison in full: a diverging bar with both fighting weights and a verdict.
Weight counts guns, gun-crew quality, the fighting strength of the hands aboard, and
hull. A fat merchant with six guns and nobody trained to serve them is not the same
proposition as a lean privateer with the same battery.

**Time.** Pause, 1× and 2× in the bottom-left corner. 2× runs the simulation twice per
frame at the normal step rather than one double-length step, so physics, gunnery and
collision behave identically — a long passage just takes half as long to sail.

**Reputation.** Prestige for sinking pirates and honouring contracts; infamy for firing
on merchants, fishermen and the Admiralty. Faction standing moves with it, and the ships
of a faction you have wronged remember it.

---

## What the living world simulates

Nothing in the world exists for the player's benefit. Every NPC runs its own machine:

- **Merchants** (Ambrine Compact and Freehold) run cargo between the three ports and
  four off-map sea lanes, and their arrivals move the market's stock.
- **Fishing boats** leave Marasay or Ilo Vantu, work a fishing ground for half a minute,
  and carry the catch home — which adds fish to that port's stock.
- **The Tally** patrol dangerous water, size up every sail they can see, chase what they
  can beat, board what they can take, and run for it when they are hurt.
- **Admiralty patrols** sweep around Fort Escarra hunting pirates.
- Anyone who is shot at fights back, whatever their day job was.

Measured over ten simulated minutes with the player parked and doing nothing (`tools/world.mjs`):
33–57 broadsides fired between NPCs, ~290 samples of a captain actively hunting someone,
~160 samples of a merchant running from a threat, occasional NPC boarding actions that
change a hull's ownership outright, and market stock drifting as fishermen land catches.
You will see a pirate chase a merchant across your bow without any of it being staged.

---

## How ship capture and fleet growth work

1. Beat a ship down — rigging gone, crew thinned, and both of you nearly stopped.
2. **BOARD** appears with the odds. The action resolves over a few seconds, with
   casualties, morale swings and a shifting bar.
3. On winning, the prize dialog offers up to four choices:
   - **Give her to \<officer\>** — only if you have a free officer who can command *and*
     enough hands to man her. She converts to your colours on the spot, takes a prize
     crew off your flagship, and sails with you immediately.
   - **Send her home as a prize** — she is waiting in the roads at Ilo Vantu's shipyard,
     where you can commission her (with an officer) or sell her.
   - **Salvage her** — coin plus her cargo; the hull goes down.
   - **Scuttle her** — cargo only.
4. A commissioned consort has her own captain, her own crew (transferable at the
   shipyard), her own repairs, and takes fleet orders.

The first capture is deliberately the moment the game turns: it is the first time your
power is visible in the world rather than in a number.

---

## Mobile optimisations

- Every interactive target is at least 44×44 px; most are 48–56. Verified automatically
  across five viewports (`tools/layout.mjs`).
- Layouts for landscape phone, portrait phone, small phone (iPhone SE), tablet and
  desktop. Portrait re-stacks the bottom controls; short landscape screens shrink the
  furniture and turn the prize dialog into two columns so nothing lands below the fold.
- Ship picking is screen-space proximity, not mesh ray-casting — a 64 px forgiving radius
  around a hull rather than a pixel-accurate hit.
- `touch-action: none`, `overscroll-behavior: none`, fixed body, blocked gesture events
  and double-tap: the page can never scroll, bounce or zoom under a fat thumb.
- Safe-area insets on all four edges for notches and home indicators.
- Render budget measured on a busy frame: **78 draw calls, 60k triangles**. Ships are
  merged into three meshes each; islands, settlements and all wakes are one mesh apiece;
  trees and rocks are instanced; particles are four pooled point-sprite systems.
- The water shader branches on depth so the expensive shallow-water and foam noise only
  runs inshore. Wave mesh density scales with screen size (128–192 segments); the shading
  normal and the crest term are resolved per pixel, because at 22 units to the quad no
  affordable mesh carries them — interpolate them and the sea wears its own wireframe.
  The quality drop below falls back to the per-vertex path.
- Simulation cost is 0.2 ms median per frame for a full world.
- Automatic quality drop: if the game measures under 34 fps it halves the water detail
  and lowers the pixel ratio. Also switchable by hand in Settings.
- Device pixel ratio capped at 1.75 on mobile.

---

## Testing performed

All suites drive the real game in Chromium via Playwright.

```bash
node tools/playthrough.mjs phone   # 23 checks: the whole arc, with real UI clicks
node tools/touch.mjs               # 9 checks: synthesised taps, drags, pinch, rotation
node tools/systems.mjs             # 14 checks: contracts, discoveries, shoals, supplies…
node tools/layout.mjs              # HUD geometry audit across 5 viewports
node tools/world.mjs               # ten simulated minutes of NPC behaviour + sim cost
node tools/gunnery.mjs             # accuracy-vs-range curve and duel outcomes
node tools/perf.mjs                # draw calls / triangles, idle and worst case
node tools/scenes.mjs phone        # visual QA screenshots of key moments
node tools/single-check.mjs        # 7 checks: the one-file build, run from file://
node tools/rig.mjs                 # 7 checks: sails brace and belly the right way
```

Current results:

| Suite | Result |
|---|---|
| Full playthrough (new game → sail → dock → trade → recruit → hire → combat → board → capture → 2-ship fleet → save/reload → death) | **23/23** |
| Systems (contracts, discoveries, reef draft, starvation, empty lockers, reputation, crew promotion, wind, time controls, fighting weight, objective marker, corrupt save) | **22/22** |
| Touch input (tap-to-sail, tap-to-target, drag-orbit, zoom, no page scroll, rapid tapping, rotation) | **9/9** |
| Single-file build run from `file://` at iPad resolution (load, three.js, new voyage, touch, harbour, broadside, save) | **7/7** |
| Rig behaviour (belly direction on four points of sail, brace direction, canvas empties in irons) | **7/7** |
| Layout audit (phone landscape/portrait, small phone, tablet, desktop) | **0 problems** |
| Console errors across all suites | **none** |

Gunnery calibration (green crew, stationary target broadside-on, ~150 shots per range):

| Range | Hit rate |
|---|---|
| 50 m | 55–62% |
| 100 m | 44–55% |
| 150 m | ~40–60% |
| 200 m | ~33% |
| 235 m | 4–24% |

The curve is noisy run to run — that is the point; a green gun crew is not a rifle. What
holds across runs is the shape: closing the range roughly doubles your hit rate.

First-fight duels against a Tally cutter, six runs: **player survived 6/6**, median
length **53 s**, ending on 43–68% hull with one to three crew lost. Winnable, and it
costs enough to send you back to port.

Also exercised by hand: rapid tapping, target disappearing mid-fight, flagship
destruction, restart, orientation change, resize, no-money purchase states, out-of-shot
firing, and a deliberately corrupted save.

### Visual QA performed

Screenshots were rendered and inspected at every stage rather than assumed, which caught
and fixed: the far-ocean plane punching through the near water in giant shards; a
lighthouse built on open water beside the player's start; piers floating unattached
offshore; inverted hull winding leaving ships as broken boxes; crest foam covering half
the ocean; wake ribbons drawn as solid white planks after a position jump; clipped ammo
labels; clouds painting over the sea; the island shelf interleaving with the water plane
and showing through as flat grey shards; a wake that widened and brightened the wrong
way round; sails whose belly was baked toward the stern so they bulged into the wind
instead of away from it; firing arcs pinned at a fixed height while the swell ran three
metres, so the sea sliced them into grey slabs; foam tracing the water mesh's own
triangles; and colliding hint/objective/target panels on narrow screens.

---

## Known limitations

- **One ocean region.** ~4.2 km square, seven islands, three settlements. The far ocean
  is a fogged backdrop, not more sandbox.
- **Boarding is resolved, not played.** It is a presented tug-of-war with real inputs,
  not a second combat engine. This was a deliberate scope call — a polished resolution
  beats an unfinished action mode.
- **No land.** Ports are screens with a live world behind them, not walkable places.
- **Three factions, no politics.** Standing moves and hostility flips, but there is no
  war, no territory change and no diplomacy behind it yet.
- **You cannot buy a bigger flagship.** Hull progression in the slice runs through
  capture and yard upgrades; the shipyard sells refits, not new hulls.
- **Two quests and two discoveries.** Enough to demonstrate the shapes; the cargo
  contract regenerates, the hunt is one-off.
- **Audio is entirely procedural** — WebAudio oscillators and filtered noise, no samples.
  It is atmospheric rather than rich, and it needs one tap to start (browser policy).
- **Weather is wind only.** No storms, fog banks or currents.
- **Time control is 1× or 2×.** No faster setting, and no auto-pause when something
  happens — a fight that starts while you are at 2× stays at 2× until you say otherwise.
- **Limited accessibility options** — keyboard focus rings and `prefers-reduced-motion`
  are honoured, but there is no colour-blind palette, text scaling or key remapping.

---

## Files

```
index.html            shell, HUD markup, importmap
style.css             the entire UI: mobile-first, safe-area aware
src/main.js           boot, render loop, input wiring, attract mode
src/game.js           game state, world simulation, rules, save/load, markers
src/data/gamedata.js  factions, hulls, goods, crew, world layout — all tuning lives here
src/core/             util, geometry helpers, camera, input, procedural audio
src/world/            terrain + seabed bake, water shader, sky and clouds
src/ships/            procedural ship meshes, the Ship entity, NPC captains
src/combat/           ballistics, broadsides, boarding
src/fx/               wake ribbons, pooled particles
src/sim/              market, officers and portraits
src/ui/               DOM helpers, HUD, bottom-sheet port screens
tools/                the QA harnesses, the static build and the single-file bundler
vendor/three.module.min.js   three.js r180, vendored — no CDN, no network at runtime
dist/ + salt-and-tally-web.zip   the static build
dist-single/salt-and-tally.html  the whole game as one self-contained file
```

No bundler, no transpiler, no runtime dependencies beyond three.js.

---

## Design notes

A few decisions worth recording:

- **World-locked camera, not ship-locked.** A camera that rotates with the ship is more
  immersive and much worse for tap-to-sail: the world would swing under your thumb
  mid-tap. The view stays world-locked with a lead-ahead framing and manual orbit.
- **Camera pitch is tied to zoom.** Close in it drops to a low, cinematic angle with the
  horizon in frame; zoomed out it rises into a tactical view. One gesture, two purposes.
- **Firing arcs are drawn on the water.** "Position → angle → range → fire" only works if
  angle is visible. The wedges appear when a target is marked and brighten when a battery
  bears and is loaded. They are tessellated and re-stamped from the wave field every
  frame so they ride the swell — a flat sheet at a fixed height gets sawn into shards by
  the sea it is meant to lie on.
- **Capture is gated on officers, not on money.** It makes the tavern matter and makes
  the second ship an event rather than a purchase.
- **Pirates scale to your notoriety.** Your first Tally captain is a thin-crewed cutter;
  once you have taken prizes they come in luggers with real gun crews.
- **No wages.** Provisions are the running cost. A second meter that only subtracts money
  would have added bookkeeping, not tension.

---

## Credits

Everything here — code, geometry, shaders, portraits, audio, names — is original and
generated at runtime. The only third-party component is
[three.js](https://threejs.org) (MIT), vendored in `vendor/`.
