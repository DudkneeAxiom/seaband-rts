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
  const proj = (x, z) => {
    const v = new V(x, 0, z); v.project(cam);
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, z: v.z };
  };
  const hulls = g.ships.filter(s => s.alive).map(s => proj(s.x, s.z));
  for (let d = 120; d <= 240; d += 40) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const p = proj(g.player.x + Math.sin(a) * d, g.player.z + Math.cos(a) * d);
      if (p.z >= 1) continue;                                   // behind the camera
      if (p.x < 8 || p.y < 8 || p.x > r.width - 8 || p.y > r.height - 8) continue;
      // the pick radius is 64px, so stay well outside it
      if (hulls.some(h => Math.hypot(h.x - p.x, h.y - p.y) < 90)) continue;
      const el = document.elementFromPoint(p.x, p.y);           // and not under a control
      if (!el || el.id !== 'scene') continue;
      return { x: p.x, y: p.y };
    }
  }
  return null;
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
  await waitFor(page, marked => {
    const card = document.getElementById('targetcard').classList.contains('hidden');
    return marked ? !!window.__game.target && !card : !window.__game.target && card;
  }, 4000, want === 'marked');
  return a;
};
const scr = await tapShip();
const targeted = await page.evaluate(() => window.__game.target ? window.__game.target.name : null);
ok(`tapping a hull marks her as target (${targeted})`, targeted === scr.name);

/* ---- an accidental tap can be taken back ---- */
// tapping the same hull again releases her
await tapShip('clear');
ok('tapping the marked ship again releases her', !(await page.evaluate(() => !!window.__game.target)));

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
}));
ok('setting a course keeps the ship you are tracking',
  keptWhileSteering.target && keptWhileSteering.dest);
await page.evaluate(() => window.__game.clearTarget());

/* ---- drag swings the view, and does not issue a move order ---- */
const az0 = await page.evaluate(() => window.__game.rig.azimuth);
await page.evaluate(() => { window.__game.player.dest = null; });
await page.touchscreen.tap(1, 1).catch(() => { });
await page.mouse.move(box.w * 0.5, box.h * 0.5);
await page.mouse.down();
for (let i = 0; i < 10; i++) { await page.mouse.move(box.w * 0.5 + i * 14, box.h * 0.5); await sleep(16); }
await page.mouse.up();
await sleep(250);
const az1 = await page.evaluate(() => window.__game.rig.azimuth);
const destAfterDrag = await page.evaluate(() => !!window.__game.player.dest);
ok(`dragging swings the camera (${az0.toFixed(2)} -> ${az1.toFixed(2)})`, Math.abs(az1 - az0) > 0.1);
ok('a drag does not also order a course change', !destAfterDrag);

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
