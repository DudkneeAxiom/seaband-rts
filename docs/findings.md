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
