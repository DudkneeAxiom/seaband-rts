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

/* ---- the jump scare: a melee on the far side of the world ---- */
const far = await G(async () => {
  const a = window.__audio;
  await new Promise(r => setTimeout(r, 900));          // let the deck clear
  const before = a.stats().peak;
  // every boarding in the world used to arrive at full volume, four times a
  // second, wherever it was happening
  for (let i = 0; i < 30; i++) a.clash(4000);
  await new Promise(r => setTimeout(r, 260));
  const after = a.stats().peak;
  return { before: +before.toFixed(4), after: +after.toFixed(4) };
});
ok(`a boarding across the map is not in your ears (peak ${far.before} -> ${far.after})`,
  far.after <= far.before + 0.05);

/* ---- and one alongside still is ---- */
const near = await G(async () => {
  const a = window.__audio;
  await new Promise(r => setTimeout(r, 700));
  const before = a.stats().peak;
  for (let i = 0; i < 6; i++) a.clash(20);
  await new Promise(r => setTimeout(r, 220));
  return { before: +before.toFixed(4), after: +a.stats().peak.toFixed(4) };
});
ok(`a boarding alongside is (peak ${near.before} -> ${near.after})`, near.after > near.before);

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

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
