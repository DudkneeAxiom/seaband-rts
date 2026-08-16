# The score — "The Long Water"

Commodore's music is one original eight-bar folk tune arranged many ways,
not a playlist. This document is (1) the map of the adaptive system as built,
and (2) generation briefs for replacing the procedural instruments with
composed recordings later, without code changes to gameplay.

## What plays today

Everything is synthesised live in WebAudio (`src/core/music.js`), the same way
the rest of the game's audio works — **no asset files, no network**. That is
what lets the whole game ship as a single HTML file. Treat the current
synthesis as a deliberately *placeholder-grade performance of final
compositions*: the tune, the arrangements, the states and the transitions are
the design; the timbres are stand-ins.

The motif ("The Long Water", D dorian, 8 bars of 4/4) lives as note data at
the top of `music.js`. Its opening rise is the fingerprint the tension and
battle states quote; its falling tail is what victory and the advantage phase
play. Modal transforms: dorian (home), aeolian (danger, the Sable League),
and a raised-third/seventh "lift" into D major (Admiralty, Compact).

## States and transitions

```
sea ⇄ approach ⇄ port(faction, town)
 │
 ├─ tension_low ─ tension_high ─ battle(a→b→c→d) ─ boarding
 │                                     │
 │                                victory (stinger, ~5s)
 └────────────── defeat (stinger, then quiet) ── discovery (2–3s, never in combat)
```

- One state machine (`musicUpdate`) is the only writer. Gameplay reports facts
  through the state bag `game.update` already passes to `updateAudio`, plus
  three events (`victory`, `defeat`, `discovery`) via `sfxMusicEvent`.
- Transitions are mix moves, not track changes: each instrument is a named
  gain layer; states ramp layers over 5–12 s (civil) or 1–3 s (combat).
  Arrangers keep playing through the fade, and the bar clock never resets, so
  layers enter on bar lines.
- Debounce and dwell: civil states must be asked for continuously for seconds
  before they are believed, and hold for a minimum once entered. Combat is
  believed almost immediately. Rapid flapping cannot thrash the mix.
- Fatigue: at sea the tune plays for a passage, then rests for 50–160 s of
  ambience-only quiet (randomised). Ports rest shorter. Danger never rests.
  After a victory, a long deliberate quiet before the sea music returns.

## Faction dialects

Same tune, different hands. Parameters in `DIALECTS`:

| Power | Mode | Feel |
|---|---|---|
| Vantu Freeholds | dorian | fiddle-and-pluck session folk, ornamented |
| Coruvian Admiralty | lift (major) | measured drum, horn answers, little ornament |
| Ambrine Compact | lift | brighter, busier plucks, bells, quickest |
| Sable League | aeolian | low brass and drones, slow, heavy |
| Veyra Covenant | dorian | high airy whistle, long drones, sparse |
| The Tally | aeolian | no ports — their dialect colours tension/battle |

Each town then bends its power's dialect deterministically from its own id
(tempo ±6, ornament, pluck density, bells, whistle register) — a seed per
thing, per the repo convention.

## Asset drop-in plan (when composed tracks exist)

Target layout (none of these exist yet — the game does not load files today):

```
audio/music/core/long-water-motif.(mid|musicxml)   the tune, canonical
audio/music/exploration/sea-a.ogg  sea-b.ogg       open-water passages
audio/music/factions/{freehold,admiralty,compact,sable,veyra}-port.ogg
audio/music/ports/{portId}-overlay.ogg             optional per-town colour
audio/music/combat/tension-low.ogg tension-high.ogg
audio/music/combat/battle-{a,b,c,d}.ogg            aligned stems, same tempo/key
audio/music/combat/boarding.ogg
audio/music/stingers/{victory,defeat,discovery}.ogg
audio/ambience/{sea,ports,battle}/...              (ambience stays procedural)
```

The controller's states map 1:1 onto those files; replacing `scheduleBar`'s
arrangers with stem playback keeps every transition rule intact. Battle stems
must share tempo (112 bpm) and key (D aeolian) so the phase crossfades stay
bar-aligned.

## Generation briefs

Shared identity for every brief: tin whistle lead; folk instrumentation
(fiddle, frame drum, plucked lute-strings, low drone, low horn); D
dorian/aeolian/major per state; restrained, older-and-stranger than pirate
cliché. **Avoid**: accordion shanty tropes, orchestral braams, trailer
percussion, synths, choir, hero brass. Every piece must audibly contain or
fragment "The Long Water". All loops need 2-bar tails that crossfade cleanly.

1. **sea-a / sea-b** — 80 bpm, D dorian, 90–120 s, loop. Whistle carries the
   full tune with space between phrases; drone, sparse pluck, one fiddle
   answer. Lonely, unhurried, wide. The whistle must drop out entirely for
   8–16 bars mid-piece.
2. **freehold-port** — 88 bpm, D dorian, 60–90 s, loop. Session feel: fiddle
   shadowing the tune a sixth below, hand drum on 1 and 3, ornamented whistle.
3. **admiralty-port** — 76 bpm, D major, 60–90 s, loop. Horn answers the
   whistle phrase for phrase; measured drum; ceremonial but not pompous.
4. **compact-port** — 100 bpm, D major, 60–90 s, loop. Bright, busy plucks,
   small bells; a wealthy quay at midday.
5. **sable-port** — 66 bpm, D aeolian, 60–90 s, loop. Low brass and drone
   carry it; whistle low register, few notes; iron and coal smoke.
6. **veyra-port** — 72 bpm, D dorian, 60–90 s, loop. High whistle over long
   drones, almost no percussion; salt-glass and weather.
7. **tension-low** — 92 bpm, D aeolian, 45–60 s, loop. Drum pulse on 1 and 3,
   dark drone; the tune reduced to its first three notes, rarely.
8. **tension-high** — 92 bpm, D aeolian, 45–60 s, loop. Pulse doubled, horn
   entries; two-note fragments only.
9. **battle-a/b/c/d** — 112 bpm, D aeolian, 60–90 s, aligned stems. a: drums
   sparse, closing. b: full frame/war drums, fiddle ostinato, low brass. c:
   densest drums, lowest harmony, melody almost gone. d: drums thin, the
   tune's tail returns whole in dorian. The whistle appears in fragments in
   a/b, disappears in c, leads in d.
10. **boarding** — 120 bpm, D aeolian, 45–60 s, loop. Close percussion, struck
    strings, no sea-room; whistle only as short cries.
11. **victory** — 84 bpm, D dorian, 5–6 s, one-shot. Whistle + horn play the
    tune's tail together, one soft bell; no fanfare.
12. **defeat** — 56 bpm, D aeolian, 10–12 s, one-shot. Low solo whistle plays
    the opening and does not finish it; distant horn; unresolved.
13. **discovery** — 92 bpm, D dorian, 2–3 s, one-shot. The opening rise,
    quick and light, one horn note under it.

## QA

`tools/audio.mjs` drives the mixer under abuse and now also checks the
controller: state resolution (sea → battle → boarding → sea), debounce under
rapid flapping, stingers, and that long battles neither clip nor stack.
