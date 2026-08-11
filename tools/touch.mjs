/* Touch input: real synthesised taps, drags and pinches on the canvas.
   This is the control path everything else depends on. */
import { launch, sleep, ff, shot } from './qa.mjs';

const { browser, page, errors } = await launch('phone');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

await sleep(1000);
await page.click('#btn-new');
await sleep(1800);

const box = await page.evaluate(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  return { w: r.width, h: r.height };
});

/* ---- a tap on open water sets a course ---- */
await page.evaluate(() => { window.__game.player.dest = null; });
await page.touchscreen.tap(box.w * 0.62, box.h * 0.42);
await sleep(350);
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
const scr = await page.evaluate(() => {
  const g = window.__game;
  const s = g.ships.find(x => !x.isPlayer && x.alive && Math.hypot(x.x - g.player.x, x.z - g.player.z) < 140);
  const v = new (Object.getPrototypeOf(g.rig.cam.position).constructor)(s.x, 6, s.z);
  v.project(g.rig.cam);
  const r = document.getElementById('scene').getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, name: s.name };
});
await page.touchscreen.tap(scr.x, scr.y);
await sleep(350);
const targeted = await page.evaluate(() => window.__game.target ? window.__game.target.name : null);
ok(`tapping a hull marks her as target (${targeted})`, targeted === scr.name);

/* ---- an accidental tap can be taken back ---- */
// tapping the same hull again releases her
await page.touchscreen.tap(scr.x, scr.y);
await sleep(350);
ok('tapping the marked ship again releases her', !(await page.evaluate(() => !!window.__game.target)));

// and the card's dismiss button does it too
await page.touchscreen.tap(scr.x, scr.y);
await sleep(350);
const reMarked = await page.evaluate(() => !!window.__game.target);
const closeBox = await page.evaluate(() => {
  const r = document.getElementById('tc-close').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
});
await page.touchscreen.tap(closeBox.x, closeBox.y);
await sleep(350);
const cleared = await page.evaluate(() => ({
  target: !!window.__game.target,
  card: document.getElementById('targetcard').classList.contains('hidden'),
}));
ok('re-marking works after releasing', reMarked);
ok(`the card's dismiss button clears the target (${closeBox.w}x${closeBox.h} hit area)`,
  !cleared.target && cleared.card && closeBox.w >= 44 && closeBox.h >= 44);

// steering must NOT drop the target — you need to manoeuvre while engaged
await page.touchscreen.tap(scr.x, scr.y);
await sleep(300);
await page.touchscreen.tap(box.w * 0.25, box.h * 0.3);
await sleep(350);
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
