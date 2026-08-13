# Playtest findings log

Symptom → reproduction → root cause → change → verification.
Newest first. Trivia omitted deliberately.

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
