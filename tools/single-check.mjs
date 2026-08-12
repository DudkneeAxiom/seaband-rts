/* Verify the single-file build runs with no server at all (file:// URL)
   and still passes the core gameplay path. */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = pathToFileURL(path.join(ROOT, 'dist-single', 'salt-and-tally.html')).href;
// screenshots land beside the repo unless QA_OUT says otherwise, so a clone
// on any machine writes somewhere that exists
const OUT = process.env.QA_OUT || path.join(ROOT, 'shots');
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

  /* Nobody opens fire on the campaign layer. This used to run a raider
     alongside and pull the trigger, which is now the one thing the rules
     refuse — so the check reads the whole road instead: guns cold out at
     sea, contact makes an encounter, choosing to fight makes a battle, and
     the broadside goes off in there. */
  const shots = () => g.projectiles.pending.length + g.projectiles.list.length;
  const arm = () => { g.player.shot = 99; g.player.reload.stb = 0; g.player.reload.port = 0; };
  g.leavePort();
  g.player.x = 120; g.player.z = 60; g.player.dest = null; g.player.speed = 0; g.player.yaw = 0;
  g.player.hull = g.player.hullMax; g.player.sails = g.player.sailMax;

  let t = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !t; i++) t = g.spawnNPC('pirate');
  t.x = g.player.x + 110; t.z = g.player.z + 30;
  t.hull = t.hullMax; t.sails = t.sailMax;
  t.hostileToPlayer = true; t.target = g.player; t.aggro = 40;
  t.chaseHold = 0; t.fleeing = false; t.captured = false;
  t.brain = { state: 'hunt', t: 0, cooldown: 0 };
  g.encounterCooling = 0; g.paused = false;
  g.selectTarget(t);

  arm();
  const beforeCold = shots();
  g.playerFire();
  const coldOnTheOcean = shots() === beforeCold;

  // let her run us down; contact stops the world and asks
  for (let i = 0; i < 60 * 60 && g.mode === 'campaign'; i++) g.update(1 / 60);
  const asked = g.mode === 'encounter';
  if (asked) g.chooseEncounter('fight');
  const inBattle = g.mode === 'battle';

  let fired = false;
  if (inBattle) {
    g.selectTarget(g.battle.enemies[0]);
    arm();
    g.update(0.1);
    arm();
    const before = shots();
    g.playerFire();
    fired = shots() > before;
    g.battle.finish('fled');
  }
  return { dockable, sheet, coldOnTheOcean, asked, inBattle, fired, mode: g.mode };
});
ok('the harbour opens', arc.dockable && arc.sheet);
ok('the guns stay cold on the campaign layer', arc.coldOnTheOcean);
ok(`contact asks before it shoots, and fighting makes a battle (asked ${arc.asked}, battle ${arc.inBattle})`,
  arc.asked && arc.inBattle);
ok('a broadside fires in the action', arc.fired);

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
