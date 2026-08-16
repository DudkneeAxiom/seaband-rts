/* Touch input: real synthesised taps, drags and pinches on the canvas.
   This is the control path everything else depends on. */
import { launch, sleep, ff, shot, newVoyage, waitFor } from './qa.mjs';

const { browser, page, errors } = await launch('phone');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

await sleep(1000);
await newVoyage(page);

const box = await page.evaluate(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  return { w: r.width, h: r.height };
});

/* Fixed screen fractions are a trap here: a fraction that is open water on the
   first frame is sky once the camera has settled, or has a ship under it once
   the world has moved, and a tap on sky sets no course at all. Work back from
   the world instead — project sea-level points around the ship and take the
   first that lands on bare canvas, clear of every hull. */
const seaPoint = () => page.evaluate(() => {
  const g = window.__game, cam = g.rig.cam;
  const r = document.getElementById('scene').getBoundingClientRect();
  const V = Object.getPrototypeOf(cam.position).constructor;
  const proj2 = (x, y, z) => {
    const v = new V(x, y, z); v.project(cam);
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, z: v.z };
  };
  const proj = (x, z) => proj2(x, 0, z);
  /* How much room each hull actually takes on the glass, rather than a flat
     ninety pixels. That constant was measured when the battle camera stood
     200m off and a ship was seven per cent of the frame; the camera came in
     for the naval-feel pass and hulls are now twice that, so "well outside the
     pick radius" became a point on the ship's own deck — and tapping a marked
     ship unmarks her, which is what this check is watching for. Ask the hull
     how big she is: her masthead against her waterline, plus the 64px pick. */
  const hulls = g.ships.filter(s => s.alive).map(s => {
    const base = proj(s.x, s.z);
    const top = proj2(s.x, 8 + s.cls.masts * 7, s.z);
    return { ...base, r: 64 + Math.min(320, Math.abs(top.y - base.y) * 1.15) };
  });
  /* Take the *emptiest* point, not the first acceptable one. The camera now
     trails astern of the ship, so it is slowly turning whenever she is under
     way — which means a screen coordinate worked out here has drifted a little
     by the time the tap lands, and a point that merely cleared a hull can have
     slid onto her. Tapping a marked ship unmarks her, so that drift showed up
     as "setting a course keeps the ship you are tracking" failing about one
     run in five. Scoring every candidate and keeping the one furthest from any
     hull costs nothing and leaves no margin to drift across. */
  let best = null, bestClear = 0;
  for (let d = 120; d <= 240; d += 40) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const p = proj(g.player.x + Math.sin(a) * d, g.player.z + Math.cos(a) * d);
      if (p.z >= 1) continue;                                   // behind the camera
      if (p.x < 8 || p.y < 8 || p.x > r.width - 8 || p.y > r.height - 8) continue;
      /* And it has to be water she could actually be sent to. The helper only
         ever asked "is this pixel bare canvas and clear of hulls" — but the
         world point behind it can be a beach, and commandMove rightly refuses
         a course into the sand, which reads downstream as "tapping the water
         sets no destination". Ask the terrain. */
      const wx = g.player.x + Math.sin(a) * d, wz = g.player.z + Math.cos(a) * d;
      if (window.__terrain.depthAt(wx, wz) < 15) continue;
      let clear = Infinity;
      for (const h of hulls) clear = Math.min(clear, Math.hypot(h.x - p.x, h.y - p.y) - h.r);
      if (clear <= 0) continue;
      const el = document.elementFromPoint(p.x, p.y);           // and not under a control
      if (!el || el.id !== 'scene') continue;
      if (clear > bestClear) { bestClear = clear; best = { x: p.x, y: p.y }; }
    }
  }
  return best;
});

/* ---- a tap on open water sets a course ---- */
await page.evaluate(() => { window.__game.player.dest = null; });
const water = await seaPoint();
ok('there is open water to tap', !!water);
await page.touchscreen.tap(water.x, water.y);
await waitFor(page, () => !!window.__game.player.dest, 3000);
const moved = await page.evaluate(() => {
  const g = window.__game;
  return { dest: g.player.dest ? { x: Math.round(g.player.dest.x), z: Math.round(g.player.dest.z) } : null };
});
ok(`tapping the water sets a destination ${JSON.stringify(moved.dest)}`, !!moved.dest);

/* ---- the ship actually goes there ---- */
const before = await page.evaluate(() => ({ x: window.__game.player.x, z: window.__game.player.z }));
await ff(page, 6);
const after = await page.evaluate(() => ({ x: window.__game.player.x, z: window.__game.player.z }));
ok('the ship gets under way toward it', Math.hypot(after.x - before.x, after.z - before.z) > 12);

/* ---- tapping a ship marks it ---- */
await page.evaluate(() => {
  const g = window.__game;
  const s = g.ships.find(x => !x.isPlayer && x.alive);
  s.x = g.player.x + 90; s.z = g.player.z + 30; s.speed = 0;
  g.target = null;
});
await ff(page, 0.3);
/* She is under way, so her place on screen is only true for an instant —
   work it out again immediately before every tap. */
/* Where she is on the glass — and whether she is on it at all.
   `project` happily returns coordinates for a point *behind* the camera, and
   they look like perfectly good numbers, so a tap would land on empty sea and
   the failure would read as "tapping a hull does not mark her". Anything not
   actually in front of the lens, or off the edge of it, returns null. */
const aim = () => page.evaluate(() => {
  const g = window.__game;
  const s = g.ships.find(x => !x.isPlayer && x.alive && Math.hypot(x.x - g.player.x, x.z - g.player.z) < 200);
  if (!s) return null;
  const v = new (Object.getPrototypeOf(g.rig.cam.position).constructor)(s.x, 6, s.z);
  v.project(g.rig.cam);
  if (v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.92) return null;
  const r = document.getElementById('scene').getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, name: s.name };
});
/* Keep a hull inside the 200m aim() looks in. Over a long run on a slow
   machine she has sailed off by now, and a tap at a stale position tests
   nothing. Staging where she is is fair; whether the tap marks her is still
   entirely the game's decision. */
const stage = async () => {
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.ships.find(x => !x.isPlayer && x.alive);
    if (!s) return;
    /* Put her where the camera is actually looking, rather than at a fixed
       offset in world space. The offset used to be +90x/+30z, which was on
       screen only because the opening view happened to be pointed that way;
       the moment a new voyage started facing the town instead, she was behind
       the lens and every tap check failed. Staged off the camera's own
       heading, this holds whichever way the view is turned. */
    const az = g.rig.azimuth;
    const fx = -Math.sin(az), fz = -Math.cos(az);       // the way the lens looks
    s.x = g.player.x + fx * 105;
    s.z = g.player.z + fz * 105;
    s.speed = 0;
  });
  await ff(page, 0.3);          // let her mesh catch up with her position
};

/* A tap toggles the mark, and the HUD repaints on its own tick — a frame or
   two behind the game under software GL. Wait for the state the tap is meant
   to produce, card included: its buttons have no box to hit until it is
   actually on screen, which is what a 0x0 hit area means. */
const tapShip = async (want = 'marked') => {
  await stage();
  const a = await aim();
  if (!a) return null;
  await page.touchscreen.tap(a.x, a.y);
  await waitFor(page, w => {
    const g = window.__game;
    const card = document.getElementById('targetcard').classList.contains('hidden');
    if (w === 'marked') return !!g.target && !card;
    if (w === 'chase') return !!g.target && !!g.chasing;
    return !g.target && card;
  }, 4000, want);
  return a;
};
/* Lay a course first, so the mark-then-chase ladder can also prove what
   happens to the waypoint at each rung. */
const layWater = await seaPoint();
if (layWater) await page.touchscreen.tap(layWater.x, layWater.y);
await waitFor(page, () => !!window.__game.moveGoal, 3000);

const scr = await tapShip();
const marked1 = await page.evaluate(() => ({
  name: window.__game.target ? window.__game.target.name : null,
  chasing: !!window.__game.chasing,
  goal: !!window.__game.moveGoal,
}));
ok(`tapping a hull marks her as target (${marked1.name})`, marked1.name === scr.name);
ok('one tap only marks — a mistap must not commit the helm', !marked1.chasing);
ok('and a laid waypoint survives a look', marked1.goal);

/* ---- the second tap is the order ---- */
await tapShip('chase');
const chased = await page.evaluate(() => ({
  chasing: !!window.__game.chasing && window.__game.chasing === window.__game.target,
  goal: !!window.__game.moveGoal,
}));
ok('tapping her again runs her down', chased.chasing);
ok('and the stale waypoint mark goes out — the chase is the destination now', !chased.goal);
// the HUD repaints on its own tick — wait for the label, don't read the same frame
const saidSo = await waitFor(page, () =>
  /BREAK OFF/i.test(document.getElementById('tc-follow').textContent), 4000);
ok(`the card's button says so (${saidSo ? '"BREAK OFF"' : 'never said it'})`, saidSo);

/* ---- an accidental tap can be taken back ---- */
// tapping the same hull a third time releases her
await tapShip('clear');
ok('tapping the chased ship again releases her', !(await page.evaluate(() => !!window.__game.target)));

// and the card's dismiss button does it too
await tapShip();
const reMarked = await page.evaluate(() => !!window.__game.target);
const closeBox = await page.evaluate(() => {
  const r = document.getElementById('tc-close').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
});
await page.touchscreen.tap(closeBox.x, closeBox.y);
// the HUD repaints on its own tick, which on a software renderer is a whole
// frame behind the game — wait for the card to go rather than guess at it
await waitFor(page, () => !window.__game.target
  && document.getElementById('targetcard').classList.contains('hidden'), 3000);
const cleared = await page.evaluate(() => ({
  target: !!window.__game.target,
  card: document.getElementById('targetcard').classList.contains('hidden'),
}));
ok('re-marking works after releasing', reMarked);
ok(`the card's dismiss button clears the target (${closeBox.w}x${closeBox.h} hit area)`,
  !cleared.target && cleared.card && closeBox.w >= 44 && closeBox.h >= 44);

// steering must NOT drop the target — you need to manoeuvre while engaged
await tapShip();
await page.evaluate(() => { window.__game.player.dest = null; });
const helmPoint = await seaPoint();
await page.touchscreen.tap(helmPoint.x, helmPoint.y);
await waitFor(page, () => !!window.__game.player.dest, 3000);
const keptWhileSteering = await page.evaluate(() => ({
  target: !!window.__game.target, dest: !!window.__game.player.dest,
  name: window.__game.target ? window.__game.target.name : null,
}));
ok(`setting a course keeps the ship you are tracking (target ${keptWhileSteering.name}, dest ${keptWhileSteering.dest}, tapped ${helmPoint ? Math.round(helmPoint.x) + ',' + Math.round(helmPoint.y) : 'nowhere'})`,
  keptWhileSteering.target && keptWhileSteering.dest);
await page.evaluate(() => window.__game.clearTarget());

/* ---- drag swings the view, and does not issue a move order ---- */
const az0 = await page.evaluate(() => window.__game.rig.azimuth);
/* Clear the whole standing order, not just the leg she is on. Nulling `dest`
   alone leaves `route` holding the rest of the passage, and the next tick pops
   the following waypoint straight back into `dest` — so the check read "she has
   a destination" and called it an order the drag had issued. It only started
   failing when the sounding got finer and the player began carrying real routes
   where the rhumb line used to be judged clear, which is the precondition
   changing under a check that never asserted it. */
await page.evaluate(() => {
  const g = window.__game;
  g.player.dest = null; g.player.route = null; g.moveGoal = null;
});
await page.touchscreen.tap(1, 1).catch(() => { });
await page.mouse.move(box.w * 0.5, box.h * 0.5);
await page.mouse.down();
for (let i = 0; i < 10; i++) { await page.mouse.move(box.w * 0.5 + i * 14, box.h * 0.5); await sleep(16); }
await page.mouse.up();
await sleep(250);
const az1 = await page.evaluate(() => window.__game.rig.azimuth);
const destAfterDrag = await page.evaluate(() => {
  const g = window.__game;
  return g.player.dest
    ? { x: Math.round(g.player.dest.x), z: Math.round(g.player.dest.z),
      goal: !!g.moveGoal, route: g.player.route ? g.player.route.length : 0,
      chasing: !!g.chasing, target: !!g.target }
    : null;
});
ok(`dragging swings the camera (${az0.toFixed(2)} -> ${az1.toFixed(2)})`, Math.abs(az1 - az0) > 0.1);
ok(`a drag does not also order a course change (${destAfterDrag ? JSON.stringify(destAfterDrag) : 'no dest'})`, !destAfterDrag);

/* ---- wheel/pinch zooms ---- */
const z0 = await page.evaluate(() => window.__game.rig.targetDistance);
await page.mouse.move(box.w * 0.5, box.h * 0.5);
await page.mouse.wheel(0, -400);
await sleep(200);
const z1 = await page.evaluate(() => window.__game.rig.targetDistance);
ok(`zoom responds (${Math.round(z0)} -> ${Math.round(z1)})`, z1 < z0);

/* ---- the page never scrolls under a thumb ---- */
await page.touchscreen.tap(box.w * 0.5, box.h * 0.9);
await page.mouse.move(box.w * 0.5, box.h * 0.8);
await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(box.w * 0.5, box.h * 0.8 - i * 20); await sleep(10); }
await page.mouse.up();
const scrolled = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, bodyTop: document.body.getBoundingClientRect().top }));
ok('the page cannot be scrolled', scrolled.x === 0 && scrolled.y === 0 && Math.abs(scrolled.bodyTop) < 1);

/* ---- rapid tapping ---- */
for (let i = 0; i < 30; i++) await page.touchscreen.tap(200 + (i % 9) * 40, 120 + (i % 6) * 30);
await sleep(600);
ok('30 rapid taps leave the game healthy', await page.evaluate(() => !!window.__game.player && window.__game.player.alive));

/* ---- resize / orientation ---- */
await page.setViewportSize({ width: 390, height: 844 });
await sleep(700);
await page.setViewportSize({ width: 844, height: 390 });
await sleep(700);
const afterResize = await page.evaluate(() => {
  const r = window.__renderer.getSize(new (Object.getPrototypeOf(window.__game.rig.cam.position).constructor)());
  return { w: Math.round(r.x), h: Math.round(r.y), aspect: +window.__game.rig.cam.aspect.toFixed(2), alive: !!window.__game.player };
});
ok(`rotating the device re-lays the renderer (${afterResize.w}x${afterResize.h}, aspect ${afterResize.aspect})`,
  afterResize.w === 844 && afterResize.h === 390 && afterResize.alive);
await shot(page, 'touch-final');

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
