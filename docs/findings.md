# Playtest findings log

Symptom → reproduction → root cause → change → verification.
Newest first. Trivia omitted deliberately.

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
