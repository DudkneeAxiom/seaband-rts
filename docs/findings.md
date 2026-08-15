# Playtest findings log

Symptom → reproduction → root cause → change → verification.
Newest first. Trivia omitted deliberately.

---

## 57. The reckoning said you took nothing after you took her  (P1, playtest)

**Symptom.** Board a Tally cutter, win, send her home as a prize. The
after-action card:

```
THE WATER IS YOURS
Enemy sail engaged · 1
Sunk · 0
Taken · 0
```

while `stats.captured` is 1 and *Hook & Halter* is sitting in the roads.

**Root cause.** The tally asked whether the hull had ended up in your fleet:

```js
const taken = this.startEnemies.filter(s => g.fleet.includes(s) || s.faction === 'player');
```

That is true of exactly one of the four things the prize dialog offers. Send
her home, salvage her or scuttle her and she is in none of them — and she is
not dead either, so `sunk` does not count her. The best thing that can happen
in this game reported as nothing happening at all.

**Change.** Taken means her colours came down — `s.captured` — whatever you did
with her afterwards; and a hull you took is not also a hull you sank.

**Found by** playing the half of the game I had not played this month: take a
prize, bring her home, put a captain in her. Two harness notes from the same
run — the first version fired twelve broadsides and never closed, because it
never steered (the BOARD button's `playerBoard` starts the run, and calling it
was the whole trick); and "the yard offers no way to commission her" was my own
navigation failing on a tab labelled `⚒ SHIPYARD`, not a bug.

## 56. The story fired on deeds you had not done  (P1, reported)

**Symptom.** Reported: "the main story line progression … feels random and just
like a pop up after completing normal gameplay."

**Root cause.** Three of the six chapters — the early three, the ones a new
captain actually meets — closed on something other than what they described:

| the objective says | what actually closed it |
|---|---|
| "Make **Ilo Vantu** and dock" | docking at *any* port (`hintState.docked`) |
| "Find a **Tally** raider — black hull, red trim" | `sunk + captured >= 1`, *any* hull of *any* flag |
| "Cut her rigging, board her, **and keep her**" | `fleet.length > 1`, a second hull by *any* road |

So the game read as a thing that watches you play and then congratulates you
for whatever you happened to do — which is exactly what a pop-up is. Worse, the
closing prose then told you about a deed you had not done: take a Compact
trader and the card says **"One Tally hull fewer."** Put into Marasay and a
chapter that had asked for Ilo Vantu closes on the harbour it names.

**Change.** Each chapter now tests the deed it names. `stores` wants the port
it names (`hintState.port_ilovantu`, which `enterPort` already sets per
harbour); `blood` wants a Tally hull, counted at the moment she strikes rather
than after the prize disposition — commissioning her sets `faction = 'player'`,
so asking later asks a question whose answer has been overwritten; `consort`
wants her taken *and* kept.

**Verification.** The wrong deed no longer closes the chapter and the right one
still does:

```
no      stores:  docked at Marasay          CLOSES  stores:  docked at Ilo Vantu
no      blood:   took a trader              CLOSES  blood:   took a Tally
no      consort: a second hull, not boarded CLOSES  consort: boarded and kept
```

Three checks in `origin`, one per chapter, each asserting both halves.

**And it caught a check that had been faking its own state.** "Making port
closes chapter one" set `hintState.docked = 1` by hand rather than docking —
the one thing this repo's testing rules name outright — and it only surfaced
because the flag stopped standing for having been anywhere in particular. It
goes through `enterPort` now, which is the call the DOCK button makes.

## 55. Sixty-six presses of one button was the whole relationship  (P1, reported)

**Symptom.** Reported: "one thing i would say still needs work is the dialogue
and progression with npcs at the towns/ports."

**Measured, before touching anything.** The cast is well written — bios, hidden
ambitions, three tiers of dialogue, rivalries. What you could *do* with them:

```
Stranger    [Ask about the port]
Acquainted  [Ask about the port] [Ask about the others]
Friendly    [Ask about the port] [Ask about the others]      <- nothing new at all
Trusted     [Ask about the port] [Ask about the others] [Personal matters] [the boon]

one press of the only option a stranger has:  +0.8
first meeting to Acquainted:                  12 presses
first meeting to Trusted:                     66 presses
```

Sixty-six presses of the same button, reading the same sentence each time, to
reach the rung where the writing actually is. That is a progress bar with a
face on it.

**Three faults underneath it.**

1. **A topic paid every time it was asked.** So the only "conversation" the
   game had was a treadmill, and the fastest way to a friendship was to stop
   playing and tap.
2. **The middle of the ladder was empty.** `Friendly` — a whole tier — opened
   nothing whatever over `acquainted`.
3. **The main loop of the game moved nobody.** `makeCargoQuest` had no `owner`
   field at all and `completeQuest` paid coin and prestige and touched no
   relationship, so a captain could carry freight up and down the Shoals for a
   whole career and still be a stranger on every quay. The only road to knowing
   anybody ran through bounty-hunting. Meanwhile bounties *did* name an owner —
   `makeBounty` picks the local who would actually care and writes the brief in
   their voice — and the player took that work off a notice board without ever
   speaking to them.

**Change.** A topic pays the first time it is raised and afterwards is
something you already know (the option stays, so you can re-read it). Carrying
work names the person who wrote it, spread across the quay's clerks by the
contract's own id rather than always the first match — handing every contract
to the one factor makes a cast of five into a cast of one. Delivering it moves
that person and leaves a memory in their mouth. They ask you for their own work
themselves at `friendly`, in their own words, instead of it appearing on a
board. `Friendly` now opens "Ask what is wrong" — a friend tells you what is
wrong; it still takes a trusted one to say what they are *for*. And the card
says what the next rung opens, read off the same gates the options use, so the
promise cannot drift from the mechanic.

**Verification.**

```
Stranger    [Ask about Ilo Vantu]
Acquainted  + [Ask about the others]
Friendly    + [Is there work?] [Ask what is wrong]
Trusted     + [Personal matters] [THE HARBOURMASTER'S BOOK]

one delivered contract:  kesk 0 -> 19.5, Acquainted,
                         "You carried Timber for Fort Escarra and it arrived as promised."
contracts at Ilo Vantu:  written by two different hands, not one
```

Four checks in `social`; the two that matter fail with the owner taken back off
carrying work.

**And the full suite caught what the social work hid.** Two earlier changes
this session combined badly: harbour works that are now solid to a keel, plus a
chase that routes round land. Together they taught raiders to work their way
through Greywake's mouth after a captain who had run for shelter — three ports
lost their refuge (`-49m`, `-54m`, `-85m`, all still in `hunt`), which the
rhumb line could never have done because `avoidLand` simply bounced them off
the arm. The run-down does not route into guarded water now: a hull under the
shore batteries is not one you follow round a breakwater to reach. All five
ports refuge again, every raider in `sheer`. **A refuge that can be routed into
is not a refuge** — and two fixes that are each right can still be wrong
together.

**One thing I nearly shipped.** The next-rung line first read "she will talk
about the other people here" — for Doro Kesk, and for everyone else. Pronouns
are not in `notables.js` and a name does not tell you them, so it is "they".

## 54. A thumb faster than the screen turned the captain's purse to NaN  (P1, playtest)

**Symptom.** A played career reported `coin: NaN`, and the compass started
throwing `rotate(NaN 50 50)`. Forty minutes of sailing with no port visits was
clean, so it was not the sea.

**Reproduction.** Dock at Ilo Vantu, trade, leave, dock again. It falls over on
the second visit, every time:

```
visit 1: ◆216, upgrades []
visit 2: coin NaN, and ilovantu.fish = NaN
```

**Root cause.** Every trade calls `refresh()`, which throws the market row away
and builds a new one. A tap already on its way lands on the old node — and that
handler closed over the quantities from when it was *drawn*:

```js
const have = p.cargo[gid] || 0;      // read at render
onTap(sb, () => {
  const cnt = Math.min(qtyMult, have);   // ...and used at tap, however stale
  p.cargo[gid] -= cnt;
  if (p.cargo[gid] <= 0) delete p.cargo[gid];
```

Sell sixteen fish you no longer have and `p.cargo.fish -= 16` runs on an entry
deleted a moment before: `undefined - 16` is **NaN**. Then `NaN <= 0` is false,
so it is never cleaned up. From there it is four steps downhill, and every one
of them is a comparison that lets NaN through:

1. `p.cargoUsed` and `p.cargoFree` go NaN.
2. The BUY row computes `nb = Math.min(…, p.cargoFree, …)` → NaN, and
   `bb.disabled = nb <= 0` is **false**, so the button stays lit.
3. Pressing it runs `G.coin -= buy * cnt` with a NaN count — **the purse**.
4. `takeStock` runs `Math.max(0, stock - NaN)` → the port's fish stock is NaN
   for the rest of the voyage, which prices at NaN, which lights the button
   again.

On a phone, tapping faster than the screen redraws is not abuse. It is how
people buy things.

**Change.** Both handlers price and count the deal from the ship and the store
*as they are at the tap*, never from what the row said when it was drawn; and
every guard is `!(cnt > 0)` rather than `cnt <= 0`, because the second is false
for NaN — which is precisely how a poisoned quantity got through the door.
Underneath, `addStock`/`takeStock` refuse a non-finite quantity and `price()`
treats a broken shelf as an empty one, so one bad number cannot outlive the tap
that made it.

**Verification.** Eight consecutive port visits, everything finite:

```
before   visit 2 → coin NaN, ilovantu.fish NaN
after    ◆239 ◆272 ◆247 ◆20 ◆5 ◆4 ◆5 ◆8, nothing non-finite anywhere
```

The check in `trade` stages the fault as it actually happens — keep the button,
let the game redraw around it, and go on pressing the one you are holding. With
the fix reverted it reads `hold NaN` and takes a second check down with it,
which is the cascade in miniature.

**Two harness notes.** It first passed while measuring nothing: the cargo was
put aboard *after* the counter was drawn, so the row rendered against an empty
hold and the button was inert. It asserts the staging now — that the button is
genuinely detached and that twelve fish actually sold. And the playtest that
found this had itself been broken: `untilDock` waited for *any* dockable port,
and she leaves inside the radius of the one she has just left, so it fired on
tick zero and she never sailed a metre.

## 53. A trader looked like a warship because only her builders had a say  (P1, reported)

**Symptom.** "Can we change merchant ships visuals to look more like a merchant
ship than a combat ship?"

**Root cause.** `build` — how a faction builds — was the only thing that had
ever changed a silhouette. So a League merchant was a League warship, a
Covenant merchant was a Covenant warship, and the one trader-looking hull on
the sea was a Compact one, because the Compact happen to build like traders.
What she is *for* had no expression at all.

**Change.** A role layer on top of the faction's build: hatches with tarpaulins
battened over them, the derrick that strikes cargo through them, casks standing
along the waterways, crates stacked abaft the mainmast high enough to break the
line of the rail, and her boat carried on deck where a warship keeps her gun
crews' room. Faction and role are different axes and both are visible now — a
Sable trader is unmistakably Sable *and* unmistakably a trader.

The first pass laid the casks on their sides and kept the crates low, which at
any distance you actually read a hull from is a spare spar and a flat deck.
Looking at it is what fixed it: stood on end, with a hoop, and the crates
stacked two-and-one.

**Verification.** Two checks — every one of the six powers puts visibly more on
the same hull when she is a trader, and the world's own spawned merchants carry
it while her patrols and pirates do not. The second exists because the first
passed with the wiring in `Ship.meshOpts` reverted: it built hulls straight from
the factory, which proves the layer exists and not that anything uses it.

## 52. Four fixes for one screenshot, and none of them was the fault  (P1, reported)

**Symptom.** Reported a second time, with the same screenshot: "stone arm ship
still seems to be stuck and they drift into the greywake stone walls in the
same spot as last time."

**Three wrong answers first, all of them measured, none of them it.**

1. *The breakwater is not in the depth field.* It is — `raiseSeabed` stamps a
   footing under every block, and the module comment already says why. It is a
   26m grid against a 22×26m block, so I made the works exact at query time
   instead of trusting the bake. Measured effect on the arm's own footprint:
   **99.4% → 100%**. Real, principled, and not the fault.
2. *The route grid plots through the arm.* A probe said it did — 20 foul
   samples on a route into Greywake. The probe's own start point was **12.7m
   above sea level**; every foul sample was on the leg leaving that hillside.
   The routing had been right all along. (The grid is sounded on a 5×5 lattice
   per cell now rather than 5 points, which is an argument from geometry — a
   26m wall inside a 48m cell — and I could not isolate its effect in traffic.)
3. *She is chasing the player through the harbour.* The powers hostile to the
   player hunt at 640m and the chase steered the rhumb line, so this was worth
   fixing and is fixed — `runDownTo` routes when the line is foul. She was not
   chasing anyone.

**The actual fault, and why four rounds of checks never caught it.** Track the
hull rather than photograph her:

```
Stone Arm   post 179m off the arm, in 56m of water — a perfectly good gate
            closest she ever came to it in ten minutes: 188m, worst 373m
            98% of ten minutes within 60m of the breakwater, closest 16m
            depth under her 7.8m against a 4.6m draft — never aground
            speed 7.7 knots — never stationary
```

Her post lay to windward across the arm. Every board ran her at the masonry,
`beatTo` correctly came about for the shore, and she gave back exactly the
ground she had made. **Not aground and not stopped**, so the grounding metric
(0.05%) and the going-nowhere metric (0 hulls) both reported a clean harbour
while she sat on the wall in plain sight. I had been measuring two things that
were fine and calling it fixed, twice.

**Change.** A picket judges whether she is *getting anywhere*: if she has not
closed her gate by 25m in forty-five seconds, the gate is not hers today and
she takes one she can lie at. Judged over a window, not against her best ever —
against her best, a hull beating back and forth touches it on every board and
the rule never fires (measured: still 99%). The replacement gate needs sea room
round it, not merely water under it, and a ladder of fallbacks ending in open
water near where she already is, because every rung that looks around the Sound
is invisible to a hull pinned on the wrong side of the harbour — without that
last rung the rule fired every forty-five seconds and changed nothing.

**Verification.**

```
                        before          after (4 runs)
closest she came        188m            30m / 41m / 5m / 72m
time within 60m of arm  96–99%          18–23%
```

The staged check puts a guard one side of the harbour and her gate the other
and asks whether she shifts it. It fails with the rule reverted.

**And the full suite caught what four standalone runs did not.** Giving NPC
captains `beatTo` gave them the beat *without the rule about when not to beat*.
`Ship.update` has carried that rule for the player since the beat was written —
"inside a battle the tap is a tactical order, the distances are a few
ship-lengths" — and an NPC raider zigzagging to windward at 126m from an enemy
on 34% hull meant the action would not end. Three campaign checks failed
together, none of them mine. `runDownTo` had the same fault one step along: it
sent a hull off to work round a headland mid-duel. Both carry the exception
now. **Carrying a rule across means carrying its exceptions too** — and a suite
that runs everything is how you find out you left one behind.

**Lesson.** The complaint was "stuck at the wall". I measured *aground* and
*going nowhere*, twice, because those were the metrics I already had. Neither
is the same thing, and a hull can sit sixteen metres off masonry for ten
minutes while both read clean. **Measure the words in the report.**

## 51. The harbours were full of ships that could not sail to windward  (P1, reported)

**Symptom.** Reported from a phone with a screenshot: ships "glitching in
harbor ports … ones stuck on the grey wall", a merchant that "keeps moving left
to right", and "if a player is docked or tapped to slow down it doesn't anchor
the ship and allows it to drift."

**Reproduced.** Half an hour watched off Greywake, tracking every hull within
900m. Four of fifteen were going nowhere. The worst is the ship in the
screenshot:

```
hull                     path   net  wander  swing   aground
Stone Arm      (sable)     74m    6m   0.08   10.3 rad   2.3%
Breakwater     (sable)    393m   87m   0.22   19.4 rad   0.7%
Warehouse Rose (escort)   584m   25m   0.04   39.9 rad   0
```

`Warehouse Rose` turned six full circles in two minutes to gain 25m.

**Root cause — the big one: no NPC captain could beat to windward.**

The first guess was terrain, and it was wrong. Both Sable gate-keepers had a
post in **56m and 78m of water** with a clear line the whole way — sounded end
to end, `findRoute` returning null because there was nothing to route around.
What they had in common was the wind: their posts lay **0.50 and 0.61 rad
inside a 0.82 rad no-go cone**, dead upwind.

`layToWind` laid the near edge of the cone and held it, on the stated reasoning
that "the mark drifts out of the cone as she goes, and one long board with a
fetch at the end looks like a captain who knows her trade". That is true of a
mark you are passing and false of a station, which does not move: she reaches
away until the bearing swings, comes back, and does it again for ever. There
was no tack — the comment said so outright: "An NPC captain has no tack state
to beat with."

`Ship.beatTo` is the real thing — a tack state, a rule for when to come about,
and a lead line that takes the other board rather than stand into the shore —
and it had been wired to the player alone since it was written. Exactly the
`findRoute` fault of a year earlier, and finding 49's before that.

**Three smaller ones underneath it.**

- A Sable picket ran at full throttle to a 120m ring and then at a flat quarter
  throttle inside it. She was still making thirteen knots when she crossed the
  ring, coasted out the far side, was told to close again, and orbited. At a
  harbour with arms, one end of that orbit is masonry.
- A Sable post was a bearing off a fixed station with nothing asking whether
  the result was water — the same fault fixed for loitering and escort stations
  two sessions ago, missed here.
- An escort whose charge is gone steers for home, and "steer for home" with no
  arrival is an orbit. That was `Warehouse Rose`.

**Change.** `steerTo` calls `ship.beatTo` — the same beat for every hull
afloat. The picket takes the way off as she comes in and lies to inside 30m,
and gets her sails back the moment she is aground whatever the station says.
Sable posts are sounded. A paid-off escort that reaches her home port takes up
her faction's patrol, which knows how to arrive.

**And the anchoring, which was two separate faults.** Arriving at a mark left
12% of throttle on — meant to read as "taking the way off her", and reading
instead as a ship that never stops: **239m clear of the mark in the five
minutes after reaching it**, still making half a knot, for ever. And
`leavePort` set *full* throttle, so closing the harbour screen sent her sailing
herself out of the roads on whatever heading she was lying on. Both now leave
her where she is; tapping the water still works, and arriving on a shoal keeps
her sails so the escape steering has something to work with.

**Verification.** Greywake watched again, three runs:

```
                  hulls going nowhere   ship-seconds aground
before                    4                 0.65%
after                 0, 0, 1*             0.05%, 0.14%, 0.17%
* a pirate circling the parked player, which is what she is supposed to do
```

Worst wander went from 0.04 to 0.96 — near-straight sailing. Three staged
checks in `campaign`, each confirmed to fail with its own fix reverted:

```
a mark dead upwind is beaten up to      board starboard, 0 rad off close-hauled, then came about
she lies where she was sailed to        sailed 327m, throttle 0 on arrival, 0m of drift in five minutes
leaving the harbour screen              throttle 0 alongside, 0 after
```

**The beat check took six attempts, and every failure was staging.** It let her
sail four minutes and she covered 2650m — a teleport, not a beat, because
parking the player at 9e4 put every hull outside the cull radius and the
population system moved them wholesale. Then the sea room was checked at 400m
and not at 60m, so it measured `avoidLand`'s 1.5 rad deflection instead of the
beat. Then the player was parked 300m away and *was* the scenario — a Sable
guard finds an enemy at 640m, so the hull steered at her the whole time and the
check read a bearing of exactly π/4. Then the ship the world handed it was
still shaking off section 1 and `updateAI` returned before any steering at all.
The version that works asks two questions and runs the world for one tick:
does she lay a board, and when she has stood far enough off, does she come
about.

**And one check passed while measuring nothing.** "She lies where she was
sailed to" passed with the fix reverted, because `commandMove` refuses for a
hull that is boarding or grappled — both left lying about by earlier sections —
so the course was never laid and it sat measuring a ship that had not moved.
Then the mark it tapped turned out to be ashore, so 600 seconds went by for a
452m trip and "throttle on arrival" was read off a ship still under way. It
sounds for water now and proves she sailed.

## 50. Two "findings" that were my own probes lying to me  (harness)

**Symptom.** The previous session's voyage ended with two open items: DOCK was
not offered on arrival at Tideglass or Fort Escarra, and a full six-port
circuit raised **zero encounters** in 796 seconds.

**Neither was real.** The docking one was a probe threshold — the voyage
declared "made port" at 120m and then demanded a button that needs `dist <
dockR` (74–90m) and `speed < 7.5`. Sailed honestly, Ilo Vantu goes from arrival
at 13.2 knots to DOCK offered in **0.3 seconds**.

The empty sea was worse: three successive probes measured a world that was
never running. One teleported the player to `port + 700m` on a bearing that put
her on a hillside — `depth -16.7m` is not deep water, it is ground 16.7m above
the sea — and then measured a parked hull for twenty minutes. The next two
stalled on `g.paused`: a modal pauses the world, and a bulk `for (…) g.update()`
loop inside `page.evaluate` cannot click the button that clears it, so it spins
at `dt = 0` forever. Driven properly the sea is busy — **24 encounters in 40
minutes**, hostiles closing to 2m.

And the merchants the player reported never seeing are in pip range **97% of a
thirty-minute voyage** and within 500m for 65% of it, from minute zero. That
was already the right diagnosis in finding 44 — they were invisible as
*merchants*, not absent — and the coin mark on the pip is the fix.

**Lesson.** Every one of these probes reported a confident number about a
simulation that was not advancing. A harness that drives the world by hand has
to prove the world moved: check `g.time`, check she is in water, check nothing
is paused — before believing anything it says about what did or did not happen.

## 49. The world sailed onto the beach while the player never touched it  (P1, playtest)

**Symptom.** Half an hour of traffic, watched with the player auto-sailing the
port circuit and every hull's keel checked once a simulated second. The player
grounded for **0 of 1500 seconds**. Everybody else did it constantly — several
at *negative* depth, which is not a shoal, that is a hull standing on dry land:

```
escort  Two Percent            aground in -3.4m
escort  Guilder II             aground in -0.3m
merchant Ledger of Oosterhaven aground in  0.8m
```

Aggregate over three runs: **0.331% of all ship-seconds on the ground**, with
escorts worst at 1.25% against 0.23% for the merchants they were guarding.

**Root cause — four of them, all the same shape: a rule that sounded the
destination and never the road to it.**

1. **A course was only sounded when it was laid.** `findRoute` returns null for
   "the rhumb line is already clear", and `steerVia` kept that answer for the
   whole leg. A hull that left port on a clean line and was then set down by
   the wind, or shoved off it by `avoidLand` working round a headland, went on
   steering a line that had since gone foul with nothing to notice. Measured
   at the moment of stranding: 15 events, **11 on hulls carrying no route at
   all**, 7 of those with land squarely across the line they were steering.

2. **The road was cleared at a depth that was really one ship's depth.** The
   route grid passed any cell over 6.5m. That is the player's cutter's answer —
   she draws 3.45m, so every route ever laid had three metres to spare and the
   constant looked like a fact. A fluyt draws 7.13m and a frigate 8.97m, and
   the grid was routing both through six and a half metres of water. On the
   water: `Ledger of Oosterhaven`, draft 7.1, hard aground in 5.3m **with three
   legs of a perfectly valid route still in hand**.

3. **The first leg of every route was the one leg nobody sounded.** `smooth()`
   string-pulled from the grid cell nearest the ship, not from the ship.
   `nearestWater` will reach eight cells — 384m — for a berth in thin water,
   and the line back out to that cell can cross anything. Checked across all 20
   port pairs at a frigate's draft: five foul legs, **all five of them leg
   zero**, one of them over ground 31m above the sea.

4. **And then the AI threw that leg away.** `steerVia` dropped the first
   waypoint as "usually where she already is". It never was: the smoothing
   returns the furthest mark she can *see* from where she stands, so the first
   waypoint is the only one guaranteed to be a clear run from her, and the
   second is the corner she was meant to round it at.

A fifth, found while building the check: an escort whose charge has rounded a
point has *no* station she can sail to — the abeam station is behind the land,
and so is the wake, and so is the charge. The fallback ladder had nowhere left
to fall, so she steered the rhumb line at a hull she could not see.

**Change.** The grid stores the shallowest cast in each cell instead of a
yes/no, so one bake answers the question for every draft afloat; `keelFor(draft)`
says what a hull wants under her, and a deep hull that can find no deep road
settles for the shallow one rather than being stranded — nothing here may make
a place unreachable. `smooth()` is string-pulled from where the ship actually
is. `steerVia` re-sounds the line it is steering every ~1.3s and lays a new
route when it goes foul, and keeps every waypoint it is given. An escort with
no sailable station routes to her charge instead of steering at her.

**Verification.** Aggregate over four runs after, against three before:

```
before   0.475%  0.298%  0.219%          mean 0.331%
after    0.030%  0.117%  0.058%  0.269%  mean 0.119%
merchants 0% in three runs of the four; the player still 0/1500
```

But that number is weather — a world that spawns its own traffic, and the
spread overlaps. So the three checks that went into `campaign` stage each
fault instead, per finding 46, and each was confirmed to fail with its own fix
reverted and pass with it back:

```
a frigate's road is deep enough for a frigate   20 routes, 61 legs, shallowest 10.5m under an 8.97m draft
a course that goes foul under her is laid again routed round it, leg clear
an escort cut off from her charge sails water   she let the station go, now on a routed leg round
```

**Two harness lessons on the way.** The escort check first *passed* with the
fix removed, because it sounded her heading — which measures `avoidLand`, a
greedy rule that will deflect a bow off a rock whatever nonsense it was aimed
at. What the rule under test decides is the *point she steers for*, so the
brain records it and the check reads that. Then it passed again on a leftover
`brain.path` from the hull's previous life as a merchant, and then failed one
run in three because a hostile in sight sent her into the fight branch and the
scenario never happened. Staged by construction now: the pair must be foul
*and* roundable, the water is cleared of everyone else, and the brain is wiped.

## 48. Your own fleet was sinking the prize you were boarding  (P1, reported)

**Symptom.** Reported: "the player has no way to call off other ships in their
fleet to stop firing if trying to capture a new ship, making boarding
difficult if you have a larger fleet."

**Root cause.** Every order a consort could be given fired her guns. FOLLOW
fired. ENGAGE fired and boarded. **HOLD fired too** — it slowed her to a crawl
and went on shooting anything inside gun range, which is not what the word
means to anybody reading it. So a captain closing to take a prize had her own
squadron shooting it out from under her, and the more ships she owned the
worse it got. A fleet made capturing *harder*, which is backwards for the
mechanic the whole prize system is built on.

**Change.** A hold-fire toggle on the fleet bar, beside the three formation
orders rather than as a fourth one — where they sail and whether they shoot
are different questions, and you may well want them alongside and silent. It
suppresses consort gunnery *and* consort boarding, so they cannot take the
prize out from under you either.

**Verification, and the control had to be rewritten too.** The obvious pair
was "free → she sinks, held → she lives", and the first half is an outcome
with a whole duel inside it: 56% hull on one run, nothing left on the next.
Exactly the trap in finding 46, three days old. So it counts the shot out of
the consorts' own lockers, which is what the toggle actually governs:

```
left free  3 consorts spend 10–20 rounds, her hull 15% / 0%
held       0 rounds out of 6 lockers, her hull 100%, boarding true
```

## 47. No way to know how strong you were  (P1, reported)

**Symptom.** Reported: "player has no idea how strong they are compared to
other ships on the water."

**Root cause.** Finding 44 put a fighting-weight number over every other
ship's mast, and left the player with nothing to hold it against. The
comparison existed only on the target card, and only once you had marked
somebody — so reading `431` over a brig told you nothing unless you were
already committing to look at her.

**Change.** Your own weight sits with the provisions and the shot on the ship
panel, in the same units: `WEIGHT 914`. Fleet weight rather than hull weight,
because consorts turn up to the same action, and it is the same figure the
card calls "You".

## 46. Three flaky assertions on one rule, and the fix was to stop watching  (harness)

**Symptom.** `campaign`'s consort-positioning check failed a full run at 1.14
rad and passed a rerun at 3.12, on identical staging.

**Root cause.** It asserted the **widest** separation ever reached beat 1.3 —
more than the mechanism promises. The flank steer pushes a consort to 1.1 rad
clear of the flagship's bearing and then hands over to the ordinary duel, so
anything past that came from how far the enemy's own sailing happened to swing
her. The comment directly above the assertion already said no assertion should
be hostage to that, and then the assertion was.

**Two more attempts, both wrong, and worth recording because the pattern is
the lesson.** Measuring the separation she *holds*: 0.89 rad on one run, 1.35
on the next. Measuring the share of the action she spends masking the guns:
8–9% across three runs, which looked stable, then **21%** in the very next
full run — and sixteen staged trials put the true range at **0% to 92%**.

Every one of those watched a duel and hoped the rule would show up in it. How
a duel swings is the enemy's sailing, and no amount of choosing a cleverer
statistic makes an emergent outcome into a test of a mechanism.

**Change.** Stage the fault the rule exists to correct. Put the consort
squarely between the flagship and the enemy — masking the battery, separation
zero — and ask whether the steering takes her off that line. It does: 0 rad →
**2.24, 2.49, 1.73** across three runs against a 0.9 bar. The rule, tested
directly, indifferent to how the fight goes.

## 45. The convoys were there; you could not tell which they were  (P1, reported)

**Symptom.** Reported after the merchant work landed: "I didn't see a merchant
ship at all."

**Measured first, because the obvious reading was that they were not
spawning.** Sailing a four-leg voyage between ports for fifteen simulated
minutes and sampling every five seconds: a merchant was within sighting range
**98% of the time**, ten different ones over the voyage, one as close as 96m.
They were never missing.

**Root cause.** Nothing said which sail was which. A laden trader is a dhow or
a fluyt in ordinary colours, and at four hundred metres that is a ship. The
manifest only appeared once she was marked, so the way to find the one worth
robbing was to tap every sail on the sea in turn — which is exactly the
tapping that unmarks things, and not a thing anybody would do.

**Change.** A hull with cargo in her gets a coin beside her weight on the mast
pip: `◆192` against a raider's plain `62`. The number still answers "how
dangerous", the coin answers "is she carrying anything", and neither stands in
for the other.

## 44. The mast pips carry a number now  (requested)

**Asked for.** Replace the symbols above the ships with a number based on
strength or threat.

**What was there.** Five pre-baked glyphs — ▼▼ ▼ ● ▲ ▲▲ — one texture per
band, shared by every hull in it. That told you which of five buckets she fell
into and nothing more, so two ships wearing the same arrow could be a long way
apart and the only way to find out was to mark each one in turn.

**Change.** The pip carries her fighting weight, the same figure the target
card weighs her by, so the two agree by construction. The five colours stay,
because the band is still worth reading at a glance and colour is never asked
to be the only signal here — the number is the signal, the colour reinforces
it. A texture per *sprite* rather than per band, redrawn only when the figure
or the band actually changes: the pool is a handful of sprites, and a hull's
weight moves slowly enough that most frames redraw nothing.

Measured on the water: 47, 50, 73, 241, 431 over a fisher, a cutter, a dhow
and two brigs.

## 43. An action that opened with the player inside a rock  (P0, reported)

**Symptom.** Reported: "one of the times when I started a fight, the instance
spawned my boat in the middle of the island, grounding it from the fight."

**Root cause.** `deploy` lays each side out abeam of the other, then walks any
hull that landed on the putty out to water — twelve steps of 18m **along a
single bearing**, the way she happened to be facing, giving up if that line
was blocked. On a coast it usually is blocked, and the line of battle is laid
across the bearing the fleets closed on, which near a shore is very often
straight at it.

**Change.** Rings outward from where she was going to stand, sixteen bearings
at a time, nearest water wins. Failing that she goes to the middle of the
arena — which is floating water by definition, because that is where two
floating ships met.

**Verification, and it reproduces exactly what was reported.** A new check in
`campaign` forms an action on every waterfront in the world. Reverted to the
old single-bearing walk it fails at Greywake with

```
AGROUND: PLAYER in -87.5m, Hook & Halter in -11.4m
```

— the player's own hull eighty-seven metres up inside the rock, before a shot.
With the fix, every waterfront is clear.

## 42. A refuge a raider could follow you into  (P1)

**Symptom.** The full run failed three harbour-refuge checks — *"she sheers
off rather than follow you under the guns of Greywake"* — reporting the raider
**closer** to the harbour than she started (−15m, −62m, −67m). Run on its own,
the same suite passed all five.

**Not a flake, and worth the twenty minutes to find that out.** Fourteen
trials per port with the raider's state reset each time: Ilo Vantu, Greywake,
Tideglass and Escarra never failed; **Marasay failed 4 of 14**, worst case
−58m. The intermittency in the full run was carried brain state changing which
side of the coin came up, not the presence or absence of a bug.

**Root cause.** The decision to sheer off was re-taken every frame from "am I
inside guarded water", and a raider laid off a *minor* port starts barely
forty metres inside that ring. So she stood out, crossed the line, instantly
resumed hunting, and came back in — and over ten seconds could finish nearer
the harbour than she began. A refuge that is not one.

**Change.** Standing off is a decision about the harbour, not about the exact
metre she is standing on: it holds for seven seconds past the boundary,
steering away from the port she just left. Same instinct as `chaseHold`, which
exists for the same reason one layer up.

**Verification.** The same seventy trials: **0 failures**, and Marasay's worst
case goes from −58m to +27m.

## 41. BOARD is an order now, not a reward for having already arrived  (P1, reported)

**Symptom.** Reported: "in combat you should have a clickable option to board
and clicking that button makes the ship follow the enemy ship to board;
currently if a player tries to tap to get close to board the ship it toggles
and toggles off the focused view."

**Root cause, and it is a nasty little trap.** The BOARD button only appeared
once `canBoard` was already true — alongside her, with the way off. Getting
*there* is the whole manoeuvre, and it had no control at all: the only way to
steer in was to tap the water beside her. But a tap near a marked ship lands
on the *ship*, and tapping the ship you have marked is the gesture that
unmarks her. So the one input available for closing to board toggled the
target off, and tapping again toggled it back — exactly as reported. The
manoeuvre was unreachable through the interface that was meant to perform it.

**Change.** The button is the order. It is offered whenever there is somebody
to board, and it says which of its jobs it is about to do: `CLOSE HER` short
of grappling range, `CLOSING — TAP TO STOP` once ordered, `NN% ODDS` when the
grapples can reach. `updateBoardRun` steers for her every half-second and
**takes the way off as the gap closes** — grapples cannot be thrown at ramming
speed, so the last forty metres are sailed at her pace plus a little, which is
the part that made doing it by hand so fiddly. The moment `canBoard` is true
the grapples go across on their own. Pressing it again stands off; laying a
course of your own cancels it too.

**Verification.** `systems`, in a real action: 181m → 50m unsteered, `boarding
true`. Measured over a run: eleven seconds from 175m, slowing from 14 knots to
1.3 as she came alongside.

## 40. A destination you could not see  (P2, reported)

**Symptom.** Reported: "if a player clicks or taps out on the map I'd like to
be able to see where that marker is and once the ship comes to a halt on the
waypoint it goes away."

**Root cause.** `pingMove` was a flourish — one ring that expanded and
vanished. After it played, a course laid across open water left nothing on the
sea to say where it ended; the destination existed only inside the helm.

**Change.** A standing mark: a ring on the water with a staff and a pennant
over it, turned to face the camera so the flag is never edge-on. It shows the
*end* of the course rather than the next corner of a route — what the player
chose is the place they touched, and the dog-legs in between are the helm's
business. It goes out when she arrives, and also when there is no helm to
speak of: dead, boarding, or in port.

## 39. How big is she, in one number  (feature, requested)

**Asked for.** A size value for ships, in the spirit of Bannerlord's party
sizes — something you can compare at a glance.

**What it is.** Tons burthen, derived from her own length and beam rather than
written down beside them, so it can never disagree with the hull that gets
drawn. The shape of the formula is the old builder's measure, which measures
*capacity* — which is why a fluyt out-tons a brig while losing badly to her,
and that is a thing worth knowing at a glance rather than discovering in an
action:

```
cutter 60t · lugger 113t · dhow 163t · brig 324t · fluyt 330t · frigate 592t
```

It sits on the target card beside her class, on your own ship's panel beside
her name, and in the yard and fleet lists where hulls are actually compared
before money changes hands.

## 38. Playtest: robbing a friendly trader cost nothing at all  (P0)

**Symptom.** Found by playing it. Ran a convoy down the way a player does —
mark her, close, contact, FIGHT — shot her rig off and reduced her to 42% hull,
and the reckoning read **infamy 0, standing untouched**. The entire price of
piracy, the thing the whole feature is supposed to weigh against, was not
being charged.

**Root cause.** The charge lives in `onHit`, guarded on
`!s.hostileToPlayer` — a sensible guard, since you should not be fined for
returning fire. But `battle.js` flags **every enemy hostile as the action
forms**, before the first ball is in the air. So by the time any shot landed
the guard was always shut. Only the direct `provoke()` path — a shot fired on
the campaign layer, which the rules now refuse anyway — could ever charge it.

A captain could clear for action on a trader whose power had come to trust
her, take the cargo, and lose nothing.

**Change.** `chargeForAttacking()` runs as the battle forms, which is the
moment of choice and the last moment the game can still tell a trader from a
raider. Anyone already at odds with you, and the Tally who are everyone's
enemy, are free as they always were. The toast now says it out loud as you
clear for action: *"Word will get out. Infamy +7, standing −16."*

**Verification.** `trade`, driven through the whole real chain because that is
the only way the bug appears: compact 30 → 4, infamy 17 → 27. Last in the file,
since it opens a real action.

## 37. Playtest: the card weighed the merchant and ignored her escort  (P1)

**Symptom.** Marking an escorted convoy showed **FAR WEAKER — You 172, 73 Her**
while a lugger stood off her quarter waiting to join the action. The card whose
whole job is "judge this at a distance" was leaving the guns out of the sum.

**Change.** `weighUp` counts the escorts with their charge, and an escort with
her charge — because the battle takes them all. The same convoy now reads EVEN.

Two more from the same screenshot: the manifest line ran off the end of a
174px card and the ellipsis ate the escort count, which is the half that
decides whether you go — the escort has moved onto the line that names her
power, and the cargo has the line to itself. And the card was being *revealed*
on every tick but only *filled* on the slow one, so marking a ship put a blank
card on the glass for up to a seventh of a second; it fills the moment the
target changes now.

## 36. Playtest: one escort was a coin-flip between a lugger and a brig  (P1)

**Symptom.** A starting cutter that took the bait on a ◆1879 convoy was simply
sunk. Reading the rule back: the escort's hull class rolled lugger-or-brig
regardless of the shipment, so a middling run could sail behind sixteen guns.

**Change.** The weight follows the money the same way the *number* of escorts
does: a middling run gets a lugger you can fight, and the brigs guard the
shipments that are worth a brig. The option to rob a convoy is not an option
if the first rung kills you.

## 35. Playtest: escorts outliving their convoy  (P2)

**Symptom.** Five hundred seconds of the world running itself left an escort
with no charge — a warship guarding a hull that no longer existed, and one
more every time a merchant wandered off the edge of the world.

**Change.** A stray escort is culled with her charge rather than left drifting
about the player's water. Not while she is fighting: an escort who has been
given a reason to care about the player is nobody's stray.

**And three things that looked like bugs and were not**, recorded because each
cost time: the target card reading empty (my probe read it before the 0.14s
tick), a convoy that could not be brought to action (my probe marked a
different merchant to the one it had staged), and a merchant taking no damage
through a whole action (the probe never manoeuvred, so `fireSide` was null and
every broadside was NO ARC). A playtest harness that cannot sail is not
evidence about sailing.

## 34. The market was a slab with two sheets of paper beside it  (P2, reported)

**Symptom.** Reported: "the market building visuals look terrible". Framed
close, it was one pale block with two thin plates cantilevered off it — all
the same colour as the walls, indistinguishable from a warehouse that had lost
its roof, with a tree growing through it.

**Change.** What makes a market legible is repetition and colour. Three or
four stalls in a row on a flagged square, each with four legs, a counter with
goods heaped on it, and a **pitched** canopy — two slopes meeting at a ridge
pole. Barrels, crates and sacks around their feet.

Two things had to be measured rather than guessed:
- **The canopy colours are one warm against cream, never two from the same
  bag.** Rolling both freely gave Tideglass two pale canopies on pale sand,
  which is a market you cannot see.
- **The pitch has to be steep.** At the first value the two halves read as one
  flat plate on legs, which is a table; a market full of tables is what it
  looked like from the quay.

## 33. Changing the market moved every building dealt after it  (P1)

**Symptom.** After rebuilding the market, `shore` failed *"no building stands
in open water (2 suspect points)"* — at Greywake and Tideglass, neither of
which I had touched. Shrinking the market changed nothing: the two points
stayed at exactly the same coordinates.

**Root cause, in three layers.**
1. The market draws a different number of random numbers than it used to, and
   a town deals every building from **one stream**. So changing it reshuffled
   every position after it. CLAUDE.md already says *a seed per thing, not one
   stream for everything*; this is that rule collecting again.
2. Underneath, the real fault: placement sounded the **nominal** footprint
   `w × d`, while `building()` draws past it — a tavern 1.25 across, a yard
   frame 1.36. Positions were approved whose actual geometry hung over the
   next thing along, which on a waterfront is the harbour. The reshuffle only
   changed *which* building was standing in the wrong place.
3. And the audit had been sampling every 97th vertex, so it had never happened
   to look at the offending one before.

**Change.** Each kind declares how far past its footprint it draws, and the
ground is sounded for *that*. One worst-case margin for everything was tried
first and cost Fort Escarra its tavern and its market — on a rock that tight,
the margin is the difference between a public building and none — so two more
rules came with it: the public buildings may fall back to the second row where
the front will not have them, and a builder short of ground builds a **smaller
house** rather than none at all.

**And one honest exception.** The last floating point was the quay crane's
jib, which reaches out over the water because that is what a quay crane is
for. It has moved into the `seaworks` mesh alongside the breakwaters, which
the audit exempts for exactly that reason. It had been hanging there correctly
all along; only the sampling shift made it visible.

## 32. Merchants worth robbing  (feature, requested)

**Asked for.** Merchant ships that run cargo port to port, escorted or not
depending on the shipment, that the player can loot at a price in reputation —
Bannerlord's caravans, at sea.

**What was there.** A `merchant` role that sailed between random nodes, and a
hold that was **invented at the moment you took her** (`rollLoot` conjured a
random good if her cargo was empty). So there was nothing to size up before
committing, and no reason to prefer one hull to another.

**What she carries now.** A real shipment: a good chosen for the margin
between where she loaded and where she is bound, in an amount that is actually
in her hold, on the leg her manifest names. Take her and you take what she
had.

**Pricing the run, not the hull.** The first cut filled the hull and priced the
result — and a fluyt holds 130 tons, which at pepper prices is a prize worth
more than the ship carrying it. Every merchant became a jackpot with two brigs
round her: 43% of shipments drew a double escort and the traffic turned into a
convoy-escort simulator. Deciding what the run is *worth* first and working
back to the tonnage pins it to the band the rest of the economy uses (a cargo
contract pays ◆500–2300), and it falls out of the arithmetic that salt fish
travels in bulk and pepper travels in a corner of the hold.

Measured after: ◆264–2341, median ◆1122 — **39% sail unescorted, 49% with one,
12% with two**. Which is the point: the fat one on the horizon is the one with
two sail around her, and that is a decision rather than a lottery.

**The escort** keeps station abeam and a little astern, matches her charge's
course, and picks a fight only when one is coming for the charge — with a
leash, so a decoy that pulls both escorts away works but costs the attacker
the time it takes. When the charge is gone she has no reason to be there and
makes for the nearest port of her own colours.

**The price of taking one** scales with how well that power thought of you and
with what she was carrying. Robbing a stranger costs −12 standing and +7
infamy; robbing a power that had come to trust you costs −27 and +10, and the
toast says so in those words. Her escorts take it personally immediately.

**And you can see it coming.** The target card carries the manifest and the
escort count the moment you mark her — `47 Salt Fish · ~◆816 · unescorted` —
because a convoy should be judged at a distance, not discovered in the hold
afterwards.

## 31. Loitering ships set course for the middle of the island  (P1, reported)

**Symptom.** Reported, after the routing fix: "the other ships also still
steer themselves into terrain around harbors".

**Root cause.** Finding 30 gave NPC captains the route grid, which fixes a
ship whose *course* crosses land. It does nothing for a ship whose
**destination is a hill** — and three behaviours picked their loitering
stations as a random bearing and range from a port with nothing asking whether
the result was water. A patrol working the roads off Tideglass would set a
course for the middle of the island and lean on `avoidLand` all the way in.

**Change.** `waterPoint()` sounds a station before taking it, and returns null
rather than inventing a bad one. The fisher's runs out to the banks and home,
and all three loitering stations, now route as well.

**And a regression I made and caught by measuring.** The new escorts station
themselves on a point computed off their charge's hull — with, at first, no
water check either, which is the identical bug one level along. Grounding
across the whole world went from 0.02% of samples to **0.64%**. Sounding the
station and falling in astern where it is dry brought it to 0.24%, against a
world carrying two more ships than the baseline; what is left are brief grazes
the grounded-helm rule clears, not the sticking that was reported.

## 30. Only the player knew how to sail round an island  (P1, reported)

**Symptom.** Reported: "Ships seem to get stuck next to the left grey arm at
Greywake." Reproduced by putting fourteen hulls round Greywake and telling
them to make the harbour: after 400 simulated seconds, four were still out
there — two of them turning circles against the left arm for **352 and 179
seconds** at full speed — and two had driven ashore.

**Root cause.** `findRoute` — the A* over the baked depth field, written
because "tap-to-sail used to steer the rhumb line and nothing else, so a
course laid across the shoals ran the ship aground" — was called from
`game.js` and nowhere else. It was the *player's*. Every NPC captain still
steered the rhumb line with `avoidLand`, a greedy local rule that can nudge a
bow off a rock and cannot work a hull through a harbour mouth. Each deflection
pointed them back at the arm, so they orbited it until something killed them.
`avoidLand` already carried a comment about a fleet grinding itself to death
on this exact breakwater; the answer to that had been to sound the probe ray
better, which is the instance, not the class.

**Change.** `steerVia` in `ai.js`: the same grid, the same search, laid once
when a course is set and followed waypoint by waypoint with `steerTo` still
doing the sailing. Merchants on a leg and damaged ships running for their yard
use it — the long hauls that end inside a harbour. It falls back to the rhumb
line whenever no route is found, so open water costs nothing.

**And the bug underneath it, which was the player's too.** `smooth()` appended
the destination *unconditionally*: a route worked carefully round every
headland finished with an **unchecked straight line** from the last water cell
to the mark. Harmless where the mark is in open water; into Greywake that last
leg crosses a breakwater arm, so hulls that had just been routed neatly
through the mouth turned and drove onto the masonry inside it. Where the mark
cannot be seen from the last waypoint the route now ends in the water, and the
last few metres are left to the ship's own avoidance.

**Result.** Stuck or circling: 4 → **0**. Lost aground: 4 → 2. Twelve of the
fourteen now make the harbour and carry on to their next leg.

## 29. The Iron Sound was a gate nothing could get through  (P2, reported)

**Symptom.** Reported: "Can you move the outer two islands out further so it's
not so tight?"

**Change.** The Iron Teeth and Graithold stand 220m and 160m further off Sable
Head, along their own bearings from it, and Greywake's arms close to 80 metres
either side of the axis instead of 54. Narrow channels are the point of this
water — the League's argument is that whoever holds the gates holds the
traffic — but they were narrow enough that the traffic could not use them at
all, which makes the argument to nobody. Against a two-hundred-metre arm the
heads still very nearly meet.

Kept honest by measurement, not taste: `shore` still asserts the arms stand in
water, that the mouth carries a hull, and that both islands' towns build.

## 28. A new campaign inherited the last one's clock  (P1, reported)

**Symptom.** Reported: "When starting a new campaign the world speed seems off
and player has to change the speed for it to go normal x1 speed."

**Root cause.** The `Game` object outlives a voyage — it is built once and
`newGame` re-dresses it — and `newGame` reset thirty-odd fields without
touching `speed`. So a captain who had been running at 4× and started a new
campaign got a world moving at four times life from the first frame, with
nothing to do about it but notice and wind the clock back by hand. `time` was
the same leak and quieter: contract epochs, the dry-stores warning and
everything the social layer timestamps were all being dated from the end of
the previous voyage.

**Verification.** Driven the way it was reported — wind the clock to 4×, start
a new campaign, read the clock. Before: `speed=4, worldClock=4.9s`. After:
`speed=1, worldClock=0.3s`. `systems` now checks it.

## 27. The islands now level the ground their towns stand on  (P2)

**Symptom.** Finding 24 let every port build a town, but two of them were
building it on ground that fell 24 metres across a single house. Buildable, in
the sense that a wall can be stood on it; from the water it read as sheds glued
to a cliff.

**Change, with permission to move the terrain.** Real harbour towns are not
built up a 25° slope — the ground gets levelled first. So each island now gets
the apron its town would have cut: a shelf behind the beach, pulled toward a
third of whatever height is there so a rock still stands and a low shore stays
low. Measured, per port, before and after:

| port | median fall across a footprint | |
|---|---|---|
| | before | after |
| ilovantu | 7.4m | 3.5m |
| marasay | 10.5m | 2.8m |
| greywake | 22.0m | 7.2m |
| tideglass | 8.5m | 2.7m |
| escarra | 23.9m | 7.0m |

It only touches ground that is already dry and fades out approaching the
waterline, so the coastline, the beaches and every depth a hull cares about
are what they were.

**The cost, caught by measuring it.** The first version added **1.7 seconds to
world load** — a `for…of` allocating an iterator on the innermost line of a
150k-sample bake, and `Math.hypot` carrying overflow handling nothing here
needs. An indexed loop over squared distances is the same arithmetic: the bake
went 2782ms → 1196ms against a 1035ms baseline, so the aprons cost 160ms
rather than 1750.

**And the fault it exposed.** `shore` then failed *"every settlement is
anchored on dry land"* — Marasay's recorded waterfront sampled at −0.6m. Not
the aprons' doing so much as their revealing: the shore sweep measures the
**analytic** field, which has detail the baked grid cannot at twenty-six
metres a cell, while everything downstream — hulls, the route grid, the
harness — reads the **baked** one. At the waterline the two can disagree. The
record now walks inland until the field the game actually uses agrees it is
dry: 4.5m, and nothing else moves.

## 26. A nine-second wait for a world that takes eight to build  (harness)

**Symptom.** None yet, which is the point. Timing the boot to check what the
aprons cost showed the world build at **7.9 seconds** under software GL —
against `newVoyage`'s 9-second wait for the opening scene. The baseline was
already 7.3s.

**Why it matters.** Answering the last question is what builds the world, and
*every suite in the repo starts that way*. A 1.1-second margin on the one step
all sixteen share was a single slow runner away from failing all of them at
once — and it had been narrowing quietly every time a port gained buildings.
Exactly the flake CLAUDE.md's "poll, do not sleep" rule exists to prevent,
sitting inside the helper that implements that rule.

**Change.** 40 seconds. A generous wait costs nothing when the condition is
met early; a tight one costs a whole CI run.

## 25. The where-to-go list was the tab strip, written out twice  (P2, reported)

**Symptom.** Reported: "I don't want to see the where to go on any of the town
pages."

**Root cause, and a misread worth recording.** The previous instruction was
"the where to go options needs to go on town pages" — which I read as *put
them there* and finding 22 duly put them on all five. It meant *get rid of
them*. The reading should have been suspicious of itself: what I built was a
row per counter, each with its own GO button, sitting directly beneath a tab
strip that already had one tab per counter. Two controls for one job, one of
them a longhand copy of the other, and the copy was what pushed everything
else down the page.

**Change.** Gone, with `goTab` and its CSS rule. The tabs are the navigation;
the town page is the place. In its stead, the one thing a captain wants on
arrival that is *not* a second copy of the tabs: what this harbour sells cheap
and what it pays for, read off the port's own price table so it cannot
disagree with the market.

**And a bug that only a real run would have found.** `GOODS.find(...)` —
`GOODS` is keyed by id, not a list. It threw inside `townTab`, and the boot
guard in `index.html` did exactly what it was written to do: caught the
uncaught error and replaced the screen with "She would not answer the helm"
and the stack. Every port screen was dead. No assertion covered it; docking
and looking did.

## 24. Two of five ports had no town at all  (P1)

**Symptom.** Chasing "the visuals for the area views still need work", I dumped
the settlement record for every port before touching anything:

```
ilovantu 23 buildings   marasay 7   greywake 1   tideglass 25   escarra 0
```

Fort Escarra — an Admiralty station whose own description promises a stone
mole and a signal mast — had **no buildings**. Greywake, the League's fortress
harbour, had one shed. Both port screens were photographing bare grass.

**Root cause.** What a builder will accept was two absolute numbers: nothing
above 46m, nothing with more than ten metres of fall across its own footprint.
Finding 19 measured those — on Ilo Vantu, which is a beach. Re-measuring per
port shows what that costs everywhere else:

| port | shore | front row | median fall | candidates accepted |
|---|---|---|---|---|
| ilovantu | 74m | ok | 7.4m | 207 / 1300 |
| marasay | 74m | **none** | 10.5m | 153 |
| greywake | 74m | **none** | 22.0m | **2** |
| tideglass | 110m | ok | 8.5m | 421 |
| escarra | 56m | **none** | 23.9m | **0** |

Escarra stands on a seventy-metre rock — the code says so ten lines above the
test that then rejected all of it — and Greywake on a headland. Their
waterfront rows sit at 44m with 26 to 28 metres of fall, so *every* candidate
failed one of the two tests. Marasay lost its whole front row the same way,
which is why it had no market building for the port screen to frame.

**Change.** The limits come from the port's own coast: sample the bands first,
take the 72nd percentile of height and the 60th of fall, and accept what that
ground offers. The old constants are the floors, so a gentle coast keeps
exactly today's standards and nothing about Ilo Vantu moves; the ceiling on
the fall is what still refuses a sheer cliff. Sitting a building on the lowest
corner of its footprint stays right even on a hillside, because every view of
a port is from the water — the downhill side — so it stands on its low corner
with the hill rising behind it.

Result: 26, 11, 26, 26, 11. Greywake and Escarra have towns; Marasay,
Tideglass and Greywake have the market building their tabs advertise.

**Verification, and the part worth keeping.** `shore` now asserts that every
port built a town, that every town has a waterfront row, and that there is a
building for every service the port advertises — because a screen that
captions a picture THE MARKET needs a market to point the lens at. Reverted
against the old limits the three checks name all three faults exactly:

```
FAIL every port built a town (ilovantu 23, marasay 7, greywake 1, tideglass 25, escarra 0)
FAIL and every town has a waterfront row
FAIL and a building for every service it advertises
   (marasay: market, greywake: tavern,market, tideglass: market, escarra: tavern,market)
```

**Why nothing caught this.** `shore` has six checks about settlements and all
six ask *where* the town is — its waterfront on dry land, its label above the
roofs, its mooring afloat. Not one asked whether there was a town. A port with
zero buildings passed every one of them.

## 23. Every area view was taken through a 104° lens  (P2)

**Symptom.** Reported: the visuals for the area views still need work. The
close-ups were pale, flat and empty — a third of each frame sky, the subject
small and far, and the near corner of some wall stretched across the rest.

**Root cause.** `PerspectiveCamera(46, w/h)` — and three.js takes the
*vertical* angle. These strips are 3:1, so 46° vertical is **104° horizontal**:
an ultra-wide. Everything an ultra-wide does to a photograph, it was doing to
these.

Two more, found by looking rather than reasoning:

- **The bearing was borrowed from the middle of the town.** Every building is
  turned square to the water and now records the angle it was turned to, so
  its front — where the sign, the door and the awnings are — is a known
  direction. It was being photographed from a bearing that is the front of the
  *average* building and the gable end or the back of plenty of individual
  ones. A market shot from behind its own awnings is a shed.
- **A hill in the way reads as "clear" to a single ray.** First attempt aimed
  from the building's front and came back with a green slope and a roof behind
  it, twice.

**Change.** A 24° lens, which fills the strip from a stand that is still
outside the hedge and whose compression flatters flat-shaded geometry. The
stand is *measured*: swing around the building's own front, stand further back
as needed, and ask the terrain whether the camera is in open air and how many
of six marks on the building — four eaves corners, the ridge, the door — it
can actually see. First stand that sees all six wins; nearest among equals, so
the subject fills as much of the strip as it can.

**Mistake worth recording.** Between the two I raised the camera by
`dist * 0.3` and turned the market into a plan of its own rooftops, which
threw away the silhouettes finding 20 exists to have created. The value that
shipped is the middle of the two I could see were wrong, which is the only
reason I know it is right.

## 22. Three harbours were a wall of counters  (P1, reported)

**Symptom.** Reported: "the where to go options needs to go on town pages".

**Root cause.** The town hub — the place, its people, and WHERE TO GO — was
built only for the two ports written up with notables, on the reasoning that a
town page without people would be half a feature. What that actually shipped
was Marasay, Greywake and Tideglass opening straight onto a repair counter
with no sense of place and **no WHERE TO GO anywhere in them**: the tab strip
was the only navigation those three ports had.

And on the two that had it, WHERE TO GO sat *below* five biography cards, so
on a phone the way to the market was under the fold on the screen whose whole
job is to be the way in.

**Change.** Every port has a town page. It is built from what every port
already has — its own name for itself, its own description, its faction's
colour, and a photograph of its real buildings — and the authored two add
their mood, their worry and their people on top. Where nobody has been written
yet the people section is simply not drawn, rather than showing an empty
heading. WHERE TO GO now comes before the people: it is the first thing on the
page a player lands on when they dock, and the people are one thumb further
down, which is the right order for a place you have already arrived at.

**Verification.** All five ports open on THE TOWN with a photograph and their
full set of destinations; Greywake shows all five without scrolling on desktop.

## 21. The save-guard check assumed a battle that does not always live that long  (harness)

**Symptom.** One intermittent failure across full runs: "a battle cannot
overwrite the save with a benched world (13 sail in the instance)". A solo
campaign run from the same head passed all 32 checks.

**Root cause.** Section 11 measures that `save()` refuses while
`mode === 'battle'` — and took its battle on trust from section 10, two
boarding checks earlier. Those checks run the better part of a minute of
simulation, and a boarding that captures the last enemy empties the instance,
which ends the battle by itself (`battle.js`: no enemies left → `finish`).
That is the game being right. The check then ran `save()` on the campaign
layer, the save was correctly written, and the failure read as the guard
leaking. The "13 sail" in the message was the restored campaign roster, not a
battle instance at all — the count could not tell those apart, which is the
same message ambiguity as finding 9.

**Change.** Two halves, both in `tools/campaign.mjs`:
- Section 11 brings the check to its subject: if the earlier action has
  settled, it dismisses whatever cards the victory queued and re-enters a
  live battle through the real chain (`intoBattle` — contact, encounter,
  FIGHT), then measures. Nothing writes `mode` by hand.
- The message now reports the mode and whether the save was refused or
  written, and a failure prints the roster — so the two different bugs this
  message can describe stop sharing one line.

**Verification.** The settled-battle path was exercised deliberately — the
battle force-finished through its own `finish()` just before section 11, a
throwaway line removed after the run — and the re-entry staged a fresh action:
"2 sail, mode battle, save refused", 32/32, with every later section
unaffected. The normal path passed unchanged before and after. Full suite
green: 16/16.

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

## 20. Every building was the same building  (P2)

**Symptom.** "A tavern should look like one, not just a cone building."

**Root cause.** `building()` made exactly one shape — a tapered box under a
four-sided cone — and that shape was the house, the tavern, the market, the
shipyard and the harbourmaster's office alike. Fine at two hundred metres.
Not fine once the port screen frames one of them and captions it THE TAVERN.

**Change.** Buildings are typed, built from the same primitives in the same
style — no new art pipeline — but with silhouettes that read at a glance:

- **tavern** — low and broad, gabled, chimney, a sign hanging off a bracket,
  two barrels by the door
- **market** — barely a building: a low stall block under wide canvas awnings
  with crates stacked around it
- **yard** — a frame rather than a wall: uprights, a crossbeam, a half-planked
  hull on the slipway with its ribs showing, stacked timber
- **harbour** — taller and narrower on a stone base, signal mast, lantern
- **warehouse** — long, blank, big doors, a foil for the rest
- **house** — the original, which is what most of a town is

The town deals its public buildings to the waterfront, and only the ones the
port actually has: a hamlet with no shipyard does not get a shipyard in the
picture. The spot record carries the kind, so THE TAVERN frames *the tavern*
rather than whichever house hashed to that slot.

**Two mistakes on the way, both caught by printing the result.** Giving civic
buildings fixed slots across the front row built none at all — the extremes of
a row on this coast are underwater at one end and cliff at the other, the same
trap as finding 19, one layer up. The slot is a preference now that gives way
to buildable ground after half the attempts. And before that, framing a
skeletal shipyard at 78m let the neighbouring market's awnings dominate the
shot; a known building gets elbow room on the front and the lens comes in to
54m.

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
