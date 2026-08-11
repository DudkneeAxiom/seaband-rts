/* Verify the single-file build runs with no server at all (file:// URL)
   and still passes the core gameplay path. */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FILE = 'file://' + path.join(ROOT, 'dist-single', 'salt-and-tally.html');
const OUT = process.env.QA_OUT || '/tmp/claude-0/-home-user-seaband-rts/596e8234-72fc-559d-b926-c631e5408168/scratchpad/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// iPad Pro 11" landscape, as reported by iPadOS Safari
const ctx = await browser.newContext({
  viewport: { width: 1194, height: 834 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(FILE, { waitUntil: 'load' });
await sleep(2500);
ok('single file loads from file:// with no server', await page.evaluate(() => !!document.getElementById('scene')));
ok('three.js came through the bundle', await page.evaluate(() => !!window.__renderer));
await page.screenshot({ path: `${OUT}/single-title.png` });

// through the questionnaire the way a player goes
await page.click('#btn-new');
await sleep(900);
ok('the questionnaire opens in the single file too',
  await page.evaluate(() => !document.getElementById('origin').classList.contains('hidden')));
await page.click('#og-skip');
await sleep(400);
await page.click('.og-go');
await sleep(1800);
await page.click('#modal-actions .btn');
await sleep(600);
const st = await page.evaluate(() => {
  const g = window.__game;
  return { player: g.player && g.player.name, ships: g.ships.length, tris: window.__renderer.info.render.triangles };
});
ok(`a new voyage starts (${st.player}, ${st.ships} ships, ${st.tris} tris)`, !!st.player && st.ships > 5);

// the real control path, by touch
const box = await page.evaluate(() => { const r = document.getElementById('scene').getBoundingClientRect(); return { w: r.width, h: r.height }; });
await page.touchscreen.tap(box.w * 0.6, box.h * 0.45);
await sleep(400);
ok('tapping the water sets a course', await page.evaluate(() => !!window.__game.player.dest));

await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 60 * 8; i++) { g.update(1 / 60); g.rig.update(1 / 60, { x: g.player.x, z: g.player.z, yaw: g.player.yaw, speed: g.player.speed }, null, 0); }
});
await sleep(600);
await page.screenshot({ path: `${OUT}/single-sea.png` });

// port, combat, boarding still work
const arc = await page.evaluate(async () => {
  const g = window.__game;
  g.player.x = -190; g.player.z = 400; g.player.speed = 0;
  g.update(0.1);
  const dockable = !!g.dockablePort;
  g.enterPort(g.PORTS[0]);
  const sheet = !document.getElementById('sheet').classList.contains('hidden');
  document.getElementById('sheet-close').click();
  const t = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
  t.x = g.player.x + 100; t.z = g.player.z; t.hostileToPlayer = true;
  g.selectTarget(t);
  g.player.yaw = 0; g.player.shot = 99;
  g.update(0.1);
  g.player.reload.stb = 0; g.player.reload.port = 0;
  const before = g.projectiles.pending.length + g.projectiles.list.length;
  g.playerFire();
  const fired = (g.projectiles.pending.length + g.projectiles.list.length) > before;
  return { dockable, sheet, fired };
});
ok('the harbour opens', arc.dockable && arc.sheet);
ok('a broadside fires', arc.fired);

// localStorage works from file:// (saves)
const saved = await page.evaluate(() => {
  try { window.__game.save(); return !!localStorage.getItem('salt-and-tally-v1'); } catch (e) { return 'blocked: ' + e.message; }
});
ok(`the voyage can be saved locally (${saved})`, saved === true);

await sleep(1200);
await page.screenshot({ path: `${OUT}/single-ipad.png` });

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
