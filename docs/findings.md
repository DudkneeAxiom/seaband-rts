# Playtest findings log

Symptom → reproduction → root cause → change → verification.
Newest first. Trivia omitted deliberately.

---

## Session handoff — adaptive audio + polish pass

**What was played.** A cold fresh voyage driven through the real UI: the
opening leg to Ilo Vantu, docking, the harbour sheets, a measured census of
the sea, four port-to-port voyages, and repeated real battles entered through
contact → encounter → clear for action. Ammunition tactics were measured
across four plans against a pinned hull class. A full visual sweep of thirty
screens was taken and read.

**Measured.**

- Opening leg: 15 s, wind factor 0.86, uninterrupted. (Before the wind pass
  this leg was a dead beat at 0.43 with the ship pointed 170° the wrong way.)
- Voyages: Ilo Vantu→Marasay 975 m ≈1.5 min; →Greywake 2045 m ≈3.2 min;
  →Tideglass 1831 m ≈2.9 min; Greywake→Tideglass 3777 m ≈5.9 min.
- World density: 16 sail besides the player, 3 within 900 m. Six powers
  represented.
- Ammunition: see finding 3 — the before/after tables are the substance of
  this session's balance work.

**What remains, honestly.**

- *Water.* The brief flags the sea as the weakest visual element. It reads
  better than it did, but at distance it still shows large soft blotches that
  scan as smudges rather than swell. Not attempted this session: it is a
  shader change and the brief rightly warns against starting one late.
- *Progression choice.* With ~2400 coin a captain can afford three of the
  four yard upgrades at once, so the "A or B, not both" tension the brief
  asks for is weak. This needs income measured against upgrade cost over a
  real half-hour of play before touching numbers — measure first, as ever.
- *Officers.* Not audited this session.


## 11. Easing the drag was not enough — the helm was still steering her aground  (P0)

**Symptom.** The battle-escape failure from finding 5 came back, and this time
the diagnostic I had added said why: `depth 1.7, draft 3.4`. She was hard
aground, exactly as before.

**Root cause.** Finding 5 eased the shoal drag when a hull's head was toward
deeper water — necessary, and not sufficient. A grounded ship is still being
*steered* by whatever course she was given, and the escape order pointed her
along the arena's exit bearing, which ran further into the shallows. She
dutifully held that course on 1.7m of water and ground there. The easing only
helps a ship that happens to already be pointing at water.

**Change.** While aground, the helm answers the ground before the orders: it
takes the deepest of eight short casts and steers that way, and picks the
orders up again the moment she floats. In `Ship.update`, so it covers every
hull in the game at once — which let the NPC-specific claw-off added in
finding 5 be deleted. Two copies of a rule is one rule and one bug.

**Verification.** `campaign`: the escape that had been failing now reports
"THEY BREAK OFF" from 62m instead of stuck-at-253m. `systems`: a hull
deliberately stranded on 0.4m of water under a 3.4m draft claws off with 85%
of her hull.

## 14. A design change broke what the tests had memorised  (harness)

**Symptom.** After the social pass, `trade` and `playthrough` each failed one
check: "the harbourmaster's board shows the advance (0 offers)" and "buying
provisions costs coin and adds stores".

**Root cause.** Both dock and immediately read `#sheet-content`, because for
the whole life of those suites docking landed you on the quay. The two
authored ports now open on THE TOWN, which is the entire point of the change —
so the content under the cursor was the town, and the board was one tap away.
Neither check was wrong about the game; both were wrong about where the game
now puts you.

**Change.** A `goPortTab(page, label)` helper in `qa.mjs`, and both checks walk
to the quay first — which is exactly what a player does. The checks still
verify the board and the stores; they no longer assume the route. Ports
without an authored town are unaffected, and the helper is a no-op there.

**Worth saying plainly:** this is the correct kind of test failure. The suites
encoded an assumption about navigation, the design deliberately changed it,
and the tests said so instead of quietly still passing. Weakening them to
match would have thrown away the only thing that noticed.

## 16. A tab bar squashed to nineteen pixels, on every port  (P1)

**Symptom.** Reported from play: "the navigation buttons seem to be getting
clipped on the bottom of view."

**Root cause.** `#sheet-tabs` is a flex row inside the sheet's flex column and
had no `flex` of its own, so on a short screen the column took its space from
the tabs: measured at **19px tall** holding 44px buttons, which clipped clean
through. This was true of every port screen, not just the new ones — and the
layout audit passed it every time, because that audit looks for *overlaps* and
a clipped element does not overlap anything. Content that is cut off by its own
container is a different failure, and nothing was looking for it.

**Change.** `flex: 0 0 auto; min-height: 52px` on the row, `flex: 0 0 auto` on
the tabs, and the sheet's content pane made the flexible one. The sheet's foot
also gained `env(safe-area-inset-bottom)` — the last row of a long list was
ending flush with the bottom of the glass.

## 19. The town was a scatter, and a stricter rule built one shed  (P2)

**Symptom.** With the port screen framing individual buildings, the settlement
generator's output stopped surviving a close look: sheds dropped on a hillside
at angles no builder would choose, some half-buried in a slope, some standing
on one corner.

**Root cause.** Placement was a pure scatter — random distance along the
shore, random distance inland, and `ry: rng() * 6.28`, a full random circle.
At two hundred metres from the deck that reads as a town. At eighty metres it
reads as what it is.

**Change.** The town grows from its waterfront: rows at increasing distance
inland, every building square to the water ±12°, the ground sampled under the
whole footprint rather than at its centre so nothing floats or buries, the
front row larger and denser and thinning as it climbs, and no building on top
of a neighbour. Buildings sit on the *lowest* corner of their footprint, so
they dig into a slope instead of hovering over it.

**And the mistake worth recording.** My first cut used a fixed set of
positions per row and rejected any footprint with more than 5.5m of fall
across it. That built **one building** for the whole of Ilo Vantu. Probing the
actual terrain explained both halves: a normal footprint on that coast falls
eight to nine metres across its own width, so the threshold rejected
everything; and fixed positions along a row put one end twenty metres under
water and the other up a cliff. The rows are searched bands now, with the
limit set from the measurement rather than from taste — 24 buildings, 8 of
them on the waterfront.

I caught it because the probe printed `spots: 1` immediately after the change.
A screenshot alone might have read as "sparse village".

## 18. A tap test that aimed behind the camera  (harness)

**Symptom.** Turning the opening view to face the town broke four `touch`
checks at once: "tapping a hull marks her as target (null)", and three that
depend on it.

**Root cause.** The suite staged its victim at a fixed world offset —
`player + 90x + 30z` — which was visible only because the opening camera
happened to point that way. Rotated to face Ilo Vantu, she was *behind the
lens*. And `THREE.Vector3.project()` returns perfectly plausible-looking
coordinates for a point behind the camera, so the harness tapped confidently
on empty sea and reported that tapping a hull does not mark her.

**Change.** She is staged along the camera's own heading, so it holds
whichever way the view is turned; and `aim()` now returns null for anything
behind the lens or near the edge of frame, so a bad aim fails as "no aim"
rather than as a wrong claim about the game.

**Why it matters beyond the fix:** this was the fourth failure this session
where the harness measured something other than what it claimed. A test that
can quietly point at the wrong place is worth less than no test, because it
spends its failures on itself.

## 17. A drawn harbour beside a renderer that makes real ones  (P2)

**Symptom.** "The town scenes look terrible."

**Root cause.** Fair. I had built the settlement scene out of CSS bands — a
sky, a hill, a row of identical dark rectangles for rooftops, three triangles
for sails. Beside this game's actual low-poly harbours it read as placeholder
art, and it was placeholder art.

**Change.** The scene is now a *photograph of the real place*: a temporary
camera is pointed at the harbour from the water, the real scene is rendered
once, and the image is kept for the session. Same buildings, same water, same
light the player just sailed past. Aimed between the port marker and its shore
town — pointed at the marker alone the camera stares at open water with the
buildings shoved into a corner, because the harbour is the water but a picture
of a town should be about the town.

The read happens in the same synchronous block as the draw, before the frame
is presented, so it needs no `preserveDrawingBuffer` — which would have cost
every frame of the game a buffer copy for the sake of two pictures. If it
throws, the port gets a plain gradient and the game does not notice.

## 15. The documentation edit that failed inside its own chain  (process, again)

Finding 8 recorded that a chain which writes prose and then commits will
commit without the prose. It happened again in the same session, to the same
file: the `CLAUDE.md` edit asserted on a line with different trailing
whitespace than I assumed, threw, and the chain carried on into a backgrounded
test run where the traceback was never read. The commit would have shipped a
new module undocumented.

Caught only by grepping the artefact before committing. The rule stands and
needs to be applied rather than merely written down: **verify the artefact,
not the exit code.**

## 13. Two things play asked for: bounties, and a hunt you can actually hunt

**Bounties.** Ports now post notices against named ships — the other half of a
harbourmaster's board, beside the cargo runs. The design rule that makes it
worth having: **a bounty names a hull already sailing in this world**, chosen
from live traffic near that port, not a target conjured when you accept it. So
the notice can quote her class, her battery and a real bearing, and the ship
you go and find is the ship the notice meant.

Who a port objects to comes from its own power's `hostileTo` list plus the
Tally, so the board reads differently in different water and taking Admiralty
work is a way of choosing a side. Reward scales with the target's own weight
and the port's means. Taking her pays a quarter more than sinking her, which
points at the game's better verb. Notices come down when the hull is gone,
because a board advertising a ship already on the bottom is a board nobody
believes. A notice you never accepted pays nothing.

**Chapter six.** Reported: "you just sail around selecting every ship hoping
the name matches the one from the story." True — `objectiveMarker()` only
pointed at Mireya Sant if a *hunt quest* existed, and the chapter never
created one, so the story named a brig and left you to a lottery.

Harbours talk now. Docking anywhere refreshes word of where the story's quarry
was last working; the objective chip carries it in words ("Word in harbour
puts her off Tideglass"), the compass points at the report, and the tavern
rumour says the same. The report is deliberately **stale and blurred by a few
hundred metres** — it is where she *was*, not a satellite fix — so it sends you
to the right water and leaves the finding to you. Inside 1100m the report
gives way to the real thing.

**Verification.** `systems`: a harbour posts against ships that really exist
and are not yours; sinking a taken bounty pays the notice, the prestige and
the standing; an untaken notice pays salvage but no bounty; word in harbour
puts the objective within 400m of where the quarry actually is and says so in
prose. Plus a look at the board itself, which is how I know it reads like a
noticeboard rather than a table of numbers.

## 12. A gunnery measurement balanced on a knife edge  (harness)

**Symptom.** "Round shot is for sinking her" read 6/6, then 4/6, then 1/6 from
identical staging, after two earlier fixes had already removed a starved crew
and a drifting battery as causes.

**Root cause.** Twelve volleys at that range put the trial exactly on the
threshold where round shot either just sinks a cutter or just fails to, so the
outcome rode entirely on gunnery spread. The remaining variance was real
randomness the check had no business being sensitive to: what it exists to
show is the *contrast* between shot types, not whether one particular hull
sinks on volley eleven or thirteen.

**Change.** Eighteen volleys, the same for every shot type, which moves the
measurement off the edge without changing what it compares. Reads 6/6.

## 10. A prize nobody could ever commission, and no way to sail it  (P0, reported)

**Symptom.** "I captured one of the main flagships which had 64 crew slots,
however I could never get it to join my fleet because the max I could recruit
was 22 and that vessel required 26." And separately: the player is stuck
commanding the starting cutter for the whole campaign.

**Root cause — the dead end.** Not bad luck: arithmetic. The gate read
`p.crewTotal - cls.crewMin < p.cls.crewMin`. A cutter's `crewMax` is 22; the
heaviest hull's `crewMin` is 26. So the sum was `22 - 26 = -4 < 5` for every
captain in every save that ever existed. No player could have commissioned a
frigate or above, ever, by any route. The prize was permanently unusable and
the game gave no reason why — the row simply said "needs 26 hands".

**Root cause — the ceiling.** Recruiting could only ever fill the flagship's
own berths, so even holding coin the player could not man a captured hull.
And there was no way to command a fleet ship, so a better ship could only be
sold or towed around.

**Change.** Three parts, and each removes a different half of the trap:
- A prize goes out with a *prize crew* (4–8 hands), not her full complement.
  She sails undermanned — the crew-skill curve already models that as slower
  reloads and a heavier helm — and you man her up afterwards. Historically
  this is what prize crews were.
- Hands can be signed onto any ship in the fleet that is in harbour with you,
  chosen with a picker in the crew screen. That is how an undermanned prize
  becomes a working ship.
- `takeCommand(ship)` shifts your flag to any ship you own, in harbour only.
  Your skill, your story and the camera go across; the ship you leave becomes
  a consort under whichever officer was aboard. Formation slots renumber
  around the new flag.

**Why harbour only.** Swapping flags under way is not a thing a crew can do,
and the battle instance holds references to the player ship that must not
change beneath it.

**Verification.** `systems`: the heaviest hull in the game is commissioned
from a flagship filled to its own cap — the exact reported situation — and
sails with 8; the flag shifts to her and the cutter becomes a consort; the
shift is refused at sea and accepted in port; the captain's skill travels
with the captain; and the whole thing survives a save/load round trip, since
a flag that reverts on reload loses the ship you took.

## 9. Two measurements that drifted, and one that read a frame too early  (harness)

**Round shot, 2/6 then 4/6 then 6/6 from identical staging.** The trial pins
the hull class, both crews, the range and the hull condition — but not the
player's battery. The foe shoots back, and a gun knocked out in trial two is
still missing in trial six, so a six-trial run drifted downward as it went.
The question is about ammunition; everything that is not the ammunition is now
held still, including both batteries. Reads 6/6 and 4/6 across runs against a
threshold of 3.

**Hunger was the first half of the same fault** — the starvation section above
it leaves the company worn down, and hunger is gunnery skill. Fixed earlier in
the session; the battery was what remained.

**"An action at 4× opens at 1×" read the strip a frame too early.** The rule
worked — speed 1 on the battle layer — but the assertion also read the button,
and `ff()` advances the simulation without rendering, so the strip still said
4×. The check now waits for the paint. This is the third time this session
that `ff()`-without-a-frame has produced a confidently wrong reading; it is
written into CLAUDE.md but is worth restating: **`ff()` moves the world, not
the HUD.**

**And the failure message was ambiguous.** "clock read 4x" is equally what you
get when the rule fails and when no action ever opened — different bugs. It
now reports the layer and the lit button alongside the speed.

## 8. The sea drowned the score, and buying scrolled you away  (P2, both reported)

**Symptom A.** "The ambient sounds seem to overpower the music tracks."

**Root cause.** They did, measurably: ambience shipped at 0.55 against music
at 0.30 — the sea was nearly twice the score. A tune written to be listened to
arrived as something happening behind the weather.

**Change.** Defaults rebalanced (music 0.52, sea 0.40) and, more usefully, the
mix is now the player's: four faders in Settings — music, sea and weather,
guns and ship, overall — ramped rather than stepped so a drag does not click,
persisted to localStorage, with a reset. One volume control could never have
settled an argument between two buses.

**Symptom B.** "On desktop, recruiting or purchasing from the bottom of the
page pushes the view all the way back to the top."

**Root cause.** `renderTab()` set `scrollTop = 0` unconditionally, and every
purchase, recruitment and refit calls `refresh()`, which goes through it. The
reset is right for a tab switch and wrong for redrawing the tab you are
already reading.

**Change.** `refresh()` keeps the scroll position (clamped, since the list can
be shorter after a purchase); tab switches still start at the top.

**Verification.** `audio`: the defaults put the score above the sea, a fader
moves its bus and is written down, and no fader can be poisoned by garbage.
`trade`: driven through the real market at a viewport where the list actually
overflows — 214px before the purchase, 214px after — and a tab switch still
lands at 0. The first version of that check reported `list too short to
scroll` rather than passing on an empty measurement, which is the harness
behaving exactly as it should.

**Postscript, and the reason this entry was nearly lost.** The container
rolled the working tree back mid-session while this was being written, which
deleted `docs/findings.md`; the edit that should have added this section
failed with `FileNotFoundError` inside a `git add -A && git commit` chain, so
the commit went through carrying the code and none of the reasoning. The
lesson is about the chain, not the rollback: `a && b && c` where `a` writes
prose and `c` commits will happily commit without the prose. Verify the
artefact, not the exit code.

## 7. One unguarded read took a whole suite down  (harness)

**Symptom.** The campaign suite died outright — `TypeError: Cannot read
properties of null (reading 'allies')` — rather than reporting a failed check.

**Root cause.** The fleet-action check polled for `mode === 'battle'` and then
read `game.battle.allies` in a separate evaluate. A short action against one
beaten raider can finish in between, leaving `battle` null. The throw killed
the run, so the other twelve checks after it never happened and the report
explained nothing.

**Change.** The read is guarded and reports what it found instead
(`no action to read: mode campaign`). A check that cannot reach its subject
fails alone and says why.

**Note.** This is the same class of fault as the two staging flakes in finding
5, and worth stating as a rule: a harness that crashes is worse than a harness
that fails, because it takes the evidence with it.

**And it had siblings.** CI then died on the same shape one section further
down — `g.battle.finish('fled')` in a teardown, on an action that had already
finished by itself. Fixing the one the local run happened to hit was treating
the instance, not the class. Every `g.battle.*` in the suite is now guarded,
including the loop that presses the attack: mode saying `battle` with no
battle object means there is nothing left to press, so it stops rather than
spinning. Local runs are green either way — this only ever shows up when the
timing is different, which is exactly what CI is for.

## 6. The objective chevron sat on the fleet bar  (P2)

**Symptom.** Layout audit, viewport B: `#objptr` overlapping `#leftstack`
(111×29px) and `#fleetbar` (111×24px).

**Root cause.** The pointer keeps itself out of the bottom band by a fixed
margin — 150px, or 176 on a short screen. That number was right when it was
written, but the left column grows a fleet bar the moment the player takes a
consort, and the chevron then landed on it.

**Change.** After clamping to the glass, the chip asks `#leftstack` and
`#actions` where they actually are and steps above whichever one it lands on.
Measured, not guessed — the same instinct as the notices column, which already
measures `#rightstack`.

**Verification.** `layout`: 0 problems across five viewports.

## 5. A battle over a reef could pin the player on it  (P0)

**Symptom.** A full-suite run failed the battle-escape check with the player
stuck 245 m from an arena she needed to be 640 m clear of, after 165 seconds
of trying: `speed 0.2, throttle 1, sails 0.74`. Two further campaign checks
failed behind it, and a trade docking check failed the same way.

**Root cause.** Aground. Shoal drag multiplies target speed by `1 − over×0.92`,
which is eight per cent — and a hull that slow cannot always steer herself off,
so a fight that drifted over a reef could pin the player there with full sail
set while the shoal ate her hull. `Nothing blocks the player permanently` is an
explicit principle of this codebase and this broke it. It was invisible from
every number the check printed, which is why the diagnostic now includes depth,
draft and wind.

**Change.** A grounded hull sounds 26 m ahead: with her head toward deeper
water the drag eases to `1 − over×0.55`. Steering off works, steering on does
not, and the hazard is entirely intact for a captain who ignores it.

**Verification.** `systems` strands her on real shoal water — 0.4 m under a
3.4 m draft — points her at the deepest cast within 90 m, and requires her to
float again with her hull better than 40%. She claws off in 4 m with 84%.

**Two harness faults found alongside it.** The far-war staging let its two
ships sail themselves, and they drifted out of arc or ran for harbour — so the
check sometimes observed no war at all and reported it honestly (0 shots) by
failing rather than passing vacuously. They are now held broadside to
broadside while their real guns and the real hit callback do the work. And the
shot-type measurement inherited a starved crew from the section above it;
hunger is gunnery skill, which is how round shot read 2 sinks out of 6 on one
run and 6 out of 6 on the next from the same guns at the same range.

## 4. The chapter chip sat over every battle  (P2)

**Symptom.** A sweep screenshot of a fleet action had "CHAPTER 1 OF 6 ·
SHIP'S STORES / Make Ilo Vantu and dock" on the glass over the fight. The HUD
has hidden that chip in battles since it was written.

**Reproduction.** `intoBattle`, then read `#objective` — `hidden` absent while
`game.mode === 'battle'`.

**Root cause.** The story tick calls `refreshObjective()` every frame, and
`setObjective` unconditionally did `classList.remove('hidden')` plus a full
`innerHTML` rewrite. The HUD re-hides the chip only on its 0.14s slow tick, so
between ticks the story tick put it straight back. Two costs: the chip was
visible through most of every action it was meant to be absent from, and the
DOM was rewritten sixty times a second for a string that changes perhaps ten
times a campaign.

**Change.** `setObjective` early-returns when neither text nor kicker has
changed, so it stops fighting the HUD for ownership of the element and stops
the per-frame churn.

**Verification.** `campaign` section 15 drives a real battle and polls for the
chip to stand down, then leaves the action and polls for it to come back.

**Note on method.** This one took four wrong diagnoses — a stale-game
hypothesis, a second-element hypothesis, a `$`-helper hypothesis, and
`updateObjectivePointer`. What settled it was a MutationObserver with stack
traces on the element itself. The repo's own rule applies: reproduce and
instrument before diagnosing. Two of my intermediate probes also reported
"still showing" because `page.evaluate` polling contends with the frame loop
under software GL — the observer run was the one that told the truth.

## 3. Grape shot made capture a formality  (P1)

**Symptom.** Playtest measurement of the brief's "is the right answer always
the biggest number?" question. Five ammunition plans, same hull class, same
pose, twelve broadsides each:

| plan | sunk | boarding odds | her rig | her crew |
|---|---|---|---|---|
| round | 5/6 | — | 0.77 | 13 |
| chain | 0/6 | 0.49 | 0.00 | 13.8 |
| grape | 0/6 | **1.00** | 0.68 | **0** |
| chain+grape | 0/6 | **1.00** | 0.13 | **0** |

**Root cause.** `killCrew` had no floor, so grape swept a full company to
literally nobody; `boardOdds` was an unclamped ratio, so an empty deck gave
exactly 1.0. Capture was therefore a chore with one correct answer — load
grape, close, press the button — and chain had no reason to exist.

**Change.** Gunnery cannot reduce a company below a working core
(`ceil(crewMin × 0.35)`); the last hands are below the waterline and behind
the guns, and they are who you meet at the rail. Boarding melee still kills to
the last man — that path calls `killCrew` directly and is untouched.
`boardOdds` clamps to [0.06, 0.92], so a prize is never certain and a
desperate boarding is never impossible.

**Result.** The three shot types are now three intentions:

| plan | sunk | boarding odds | her rig | her crew |
|---|---|---|---|---|
| round | 6/6 | — | 0.80 | 11 |
| chain | 0/8 | 0.53 | 0.00 | 12 |
| grape | 0/8 | 0.79 | 0.66 | 2 |
| chain+grape | 0/8 | 0.79 | **0.12** | 2 |

Round destroys the prize. Chain strips her rig so she cannot run but leaves a
coin-flip melee. Grape softens her deck for a favoured boarding. Chain+grape
is the expert answer — she can neither run nor repel you — paid for in
broadsides and time alongside.

**Verification.** `systems` asserts the design rather than the numbers: round
sinks her, grape beats chain for odds by a clear margin, chain leaves her rig
under a quarter, and no gunnery makes a prize certain.

**Probe note.** The first version of this measurement compared arms against
whatever raider happened to be first in `game.ships`, which is a different
hull class between runs — it reported round shot going from 5/6 sinks to 0/6
after a change that touches no hull damage at all. The regression test pins
the class.

## 1. Other people's wars counted as the player's action  (P1)

**Symptom.** Tension music rose while sailing empty water with nothing in
sight. A playtester had already reported the visible half of the same bug:
"chapter pop ups when completed seem super delayed… I got hit with three
chapter pop ups after leaving Greywake."

**Reproduction.** Park the player at (0, −1700), set `combatHeat = 0`, let the
world run six seconds. Heat climbed to 9.6 with no hostile within 1300m.

**Root cause.** `onBroadside` and `onHit` both did
`combatHeat = Math.max(combatHeat, 10)` unconditionally — for *any* ball
striking *any* hull anywhere on the map. The world simulates its own wars
whether the player is watching or not, so a skirmish over the horizon kept
`combatHeat` permanently burning. Three systems read it: the score's tension
layer, `engaged` (which holds a chapter card back until the guns are quiet),
and crew sea-time (treble while it burns). Hence: tension music with an empty
horizon, chapter cards queueing for minutes and then arriving in a stack, and
free crew XP from other people's battles.

**Change.** New `Game.heatFrom(target, owner, d, amount)`: heat rises only for
a fight that is the player's, her fleet's, or inside 520m — the same radius
`engaged` already uses for a marked ship.

**Verification.** `systems`: a real AI-driven fight at 2100m fires 8 shots and
leaves heat at 0 with `engaged` false; the same iron alongside raises it to 10.

## 2. Danger had to wait its turn behind the music's minimum dwell  (P2)

**Symptom.** With heat raised deliberately, the score stayed on the sea
arrangement for several seconds before the tension layer arrived.

**Root cause.** Civil states hold a minimum dwell so that sailing the rim of a
harbour's radius cannot thrash the mix. Only `battle` and `boarding` were
allowed to preempt it — the tension states were not, which is backwards: the
entire point of the tension layer is to be heard *before* the thing it warns
about.

**Change.** Both tension states now preempt dwell alongside battle/boarding.

**Verification.** Instrumented trace: heat raised → `tension_low` within the
debounce window instead of after the dwell expired. Audio suite green twice.
