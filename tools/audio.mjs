/* Audio: the mixer under abuse.

   A sound bug is the one kind a screenshot cannot catch and an assertion about
   game state will never see. So this listens: an analyser sits on the end of
   the chain, past the limiter, and these checks watch what actually reaches
   the ear while the game throws everything it has at the mixer — a fleet
   action, a map full of boardings, and a round of deliberately poisonous
   arguments.

   Two properties matter, and both are cheap to state and hard to fake:
     · nothing that comes out is anything but a finite number. A NaN written to
       any param poisons filter and compressor state permanently, which is what
       a screech that never stops actually is.
     · nothing clips. Peaks stay under one. */
import { launch, sleep, newVoyage, waitFor } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);

/* The context needs a gesture; a tap on the sea is one. */
await page.mouse.click(700, 500);
const live = await waitFor(page, () => {
  const s = window.__audio && window.__audio.stats();
  return !!s && s.state === 'running' && s.time > 0.2;
}, 8000);
const first = await G(() => window.__audio && window.__audio.stats());
ok(`the mixer is running and can be listened to (${first && first.state}, t=${first && first.time.toFixed(2)}s)`, live);

/* ---- poison: every entry point, given the worst arguments there are ---- */
const survived = await G(async () => {
  const a = window.__audio;
  const bad = [NaN, Infinity, -Infinity, -1e9, 1e12, undefined, null, 'x', {}];
  let threw = 0;
  for (const v of bad) {
    for (const fn of ['cannon', 'wood', 'splash', 'clash', 'click']) {
      try { a[fn](v); } catch (e) { threw++; }
    }
    try { a.update(v, { speedN: v, shallow: v, nearShore: v, nearPort: v, combat: v }); } catch (e) { threw++; }
  }
  await new Promise(r => setTimeout(r, 700));
  return { threw, stats: a.stats() };
});
ok(`garbage arguments do not throw (${survived.threw} exceptions)`, survived.threw === 0);
ok(`and no NaN reaches the ear (${survived.stats.bad} bad samples)`, survived.stats.bad === 0);

/* ---- a fleet action: everything at once, repeatedly ---- */
const loud = await G(async () => {
  const a = window.__audio;
  let peak = 0, bad = 0;
  for (let round = 0; round < 22; round++) {
    for (let i = 0; i < 14; i++) { a.cannon(60); a.wood(50); a.splash(40); a.clash(30); }
    a.bell(); a.horn(); a.coin();
    await new Promise(r => setTimeout(r, 55));
    const s = a.stats();
    peak = Math.max(peak, s.peak); bad += s.bad;
  }
  return { peak: +peak.toFixed(3), bad, voices: a.stats().voices };
});
ok(`a fleet action does not clip (peak ${loud.peak})`, loud.peak <= 1.0);
ok(`and stays finite through it (${loud.bad} bad samples)`, loud.bad === 0);
ok(`the voice cap holds (${loud.voices} live, cap 24)`, loud.voices <= 24);

/* Sampling the analyser once after a fixed wait reads whatever the buffer
   happens to hold at that instant, and on a loaded machine that is as likely
   to be the tail of the sound as the front of it. Watch a window and keep the
   loudest thing in it. */
const listen = `async (a, ms) => {
  let p = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = a.stats();
    if (s && s.peak > p) p = s.peak;
    await new Promise(r => setTimeout(r, 15));
  }
  return p;
}`;

/* ---- the jump scare: a melee on the far side of the world ----
   Measured with the sea and the score held quiet. The beds run continuously
   and their level wanders further than a single effect contributes, so any
   before/after against the full mix reads the swell rather than the sound —
   which is exactly how the first version of this check flaked. */
const clash = await G(`(async () => {
  const a = window.__audio, listen = ${listen};
  a.solo(true);
  // long enough for the beds to actually be down, not still on their way:
  // measuring during the fade gave a "silence" baseline louder than the sound
  // under test, and the check then passed for entirely the wrong reason
  await new Promise(r => setTimeout(r, 2000));
  const quiet = await listen(a, 500);
  // thirty boardings, all of them somebody else's business
  for (let i = 0; i < 30; i++) a.clash(4000);
  const far = await listen(a, 600);
  await new Promise(r => setTimeout(r, 700));
  for (let i = 0; i < 8; i++) a.clash(20);
  const near = await listen(a, 600);
  a.solo(false);
  return { quiet: +quiet.toFixed(4), far: +far.toFixed(4), near: +near.toFixed(4) };
})()`);
ok(`thirty boardings across the map add nothing (quiet ${clash.quiet}, with them ${clash.far})`,
  clash.far <= clash.quiet + 0.02);
ok(`eight alongside are plainly heard (${clash.near})`, clash.near > clash.far + 0.05);

/* ---- a long session leaks nothing that keeps making noise ---- */
const settled = await G(async () => {
  const a = window.__audio;
  for (let i = 0; i < 40; i++) {
    a.update(1 / 30, { speedN: 0.8, shallow: 0.2, nearShore: 0.6, nearPort: 0.1, combat: 1 });
    await new Promise(r => setTimeout(r, 20));
  }
  await new Promise(r => setTimeout(r, 1500));         // then silence
  let peak = 0, bad = 0;
  for (let i = 0; i < 10; i++) {
    const s = a.stats();
    peak = Math.max(peak, s.peak); bad += s.bad;
    await new Promise(r => setTimeout(r, 60));
  }
  return { peak: +peak.toFixed(3), bad };
});
ok(`the score does not pile up behind itself (quiet peak ${settled.peak})`, settled.peak < 0.75);
ok(`and nothing has gone bad by the end (${settled.bad})`, settled.bad === 0);

/* ---- the adaptive score knows where the player is ----
   The real game loop feeds the controller every frame, so these checks stage
   real conditions and wait for the music to believe them — the debounce is
   part of what is being tested. Combat is staged with synthetic feeds, which
   interleave with the real ones exactly the way a real battle's would. */
const seen = [];
const believe = async (want, secs) => {
  const got = await waitFor(page, w => window.__audio.music().state === w, secs * 1000, want);
  seen.push(await G(() => window.__audio.music().state));
  return got;
};
await G(() => {
  const g = window.__game, p = g.player;
  p.x = -1600; p.z = 200; g.combatHeat = 0; g.pursuit = null;   // open water, nobody near
  for (const s of g.ships) { if (!s.isPlayer) { s.hostileToPlayer = false; s.chaseHold = 900; } }
  g.encounterCooling = 900;
});
const gotSea = await believe('sea', 16);
await G(() => { window.__game.combatHeat = 40; });               // powder smoke: low unease
const gotTension = await believe('tension_low', 12);
const battle = await G(async () => {
  const a = window.__audio;
  window.__game.combatHeat = 0;
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    a.update(1 / 30, { mode: 'battle', battlePhase: 'b' });
    await new Promise(r => setTimeout(r, 30));
  }
  const inBattle = a.music().state;
  const until2 = Date.now() + 2500;
  while (Date.now() < until2) {
    a.update(1 / 30, { mode: 'battle', battlePhase: 'c', boarding: true });
    await new Promise(r => setTimeout(r, 30));
  }
  const inBoarding = a.music().state;
  a.musicEvent('victory');
  return { inBattle, inBoarding, sting: a.music().stinger };
});
seen.push(battle.inBattle, battle.inBoarding);
const backOut = await believe('sea', 18);
ok(`the score rides the states with the player (${seen.join(' -> ')})`,
  gotSea && gotTension && battle.inBattle === 'battle'
  && battle.inBoarding === 'boarding' && backOut);
ok(`and a won fight resolves as a stinger (${battle.sting})`, battle.sting === 'victory');

/* ---- flapping cannot thrash it ----
   A raider skirting detection range flips tension on and off every second.
   Debounce means the mix holds course instead of restarting on each flap. */
const flap = await G(async () => {
  const a = window.__audio;
  const changes = [];
  let last = a.music().state;
  for (let i = 0; i < 60; i++) {
    a.update(1 / 30, { mode: 'campaign', tension: i % 2 ? 2 : 0 });
    await new Promise(r => setTimeout(r, 50));
    const s = a.music().state;
    if (s !== last) { changes.push(s); last = s; }
  }
  return { changes: changes.length, peak: a.stats().peak, bad: a.stats().bad };
});
ok(`a flapping threat cannot thrash the mix (${flap.changes} changes in 3s of flapping)`, flap.changes <= 1);

/* ---- a long battle neither clips nor stacks ---- */
const war = await G(async () => {
  const a = window.__audio;
  let peak = 0, bad = 0;
  for (let i = 0; i < 90; i++) {
    a.update(1 / 30, { mode: 'battle', battlePhase: ['a', 'b', 'c', 'd'][i / 24 | 0] || 'd', combat: 1 });
    if (i % 6 === 0) a.cannon(80);
    await new Promise(r => setTimeout(r, 40));
    const s = a.stats();
    peak = Math.max(peak, s.peak); bad += s.bad;
  }
  return { peak: +peak.toFixed(3), bad };
});
ok(`a whole battle through all four movements stays clean (peak ${war.peak})`, war.peak < 1 && war.bad === 0);

/* ---- and garbage cannot reach the controller either ---- */
const musPoison = await G(async () => {
  const a = window.__audio;
  let threw = 0;
  for (const v of [NaN, Infinity, null, 'x', {}, -1e9]) {
    try { a.update(0.03, { mode: v, tension: v, battlePhase: v, portId: v, nearPort: v, boarding: v }); } catch (e) { threw++; }
    try { a.musicEvent(v); } catch (e) { threw++; }
  }
  await new Promise(r => setTimeout(r, 500));
  const s = a.stats();
  return { threw, bad: s.bad };
});
ok(`the controller shrugs off garbage state (${musPoison.threw} exceptions, ${musPoison.bad} bad samples)`,
  musPoison.threw === 0 && musPoison.bad === 0);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
