/* Visual QA: pose the game into interesting states and shoot them. */
import { launch, shot, sleep } from './qa.mjs';

const vp = process.argv[2] || 'phone';
const { browser, page, errors } = await launch(vp);
await sleep(1200);
await page.click('#btn-new');
await sleep(2500);

// --- 1. close-up of the flagship ---
await page.evaluate(() => {
  const g = window.__game;
  g.rig.setZoom(96);
  g.rig.distance = 96;
  g.player.setDestination(g.player.x + 300, g.player.z - 200);
});
await sleep(6000);
await shot(page, `s1-flagship-${vp}`);

// --- 2. approach to Ilo Vantu ---
await page.evaluate(() => {
  const g = window.__game;
  const port = g.constructor.PORTS_DEBUG || null;
  void port;
  g.player.x = -250; g.player.z = 620; g.player.yaw = -0.6;
  g.player.setDestination(-190, 400);
  g.rig.setZoom(210); g.rig.distance = 210;
  g.rig.focus.set(g.player.x, 0, g.player.z);
});
await sleep(7000);
await shot(page, `s2-port-${vp}`);

// --- 3. a fight: put a pirate right alongside ---
const fight = await page.evaluate(async () => {
  const g = window.__game;
  g.player.x = 120; g.player.z = -80; g.player.yaw = 1.2;
  g.player.hull = g.player.hullMax; g.player.shot = 60;
  const pir = g.ships.find(s => s.faction === 'pirate' && s.alive);
  if (!pir) return 'no pirate';
  pir.x = g.player.x + 150; pir.z = g.player.z + 30; pir.yaw = 1.3;
  pir.hostileToPlayer = true;
  g.selectTarget(pir);
  g.rig.setZoom(180); g.rig.distance = 180;
  g.rig.focus.set(g.player.x, 0, g.player.z);
  return pir.name;
});
await sleep(2500);
await page.evaluate(() => {
  const g = window.__game;
  // force a broadside for the shot
  g.player.reload.stb = 0; g.player.reload.port = 0;
  g.fireSide = g.fireSide || 'stb';
  g.playerFire();
});
await sleep(400);
await shot(page, `s3-broadside-${vp}`);
await sleep(2200);
await shot(page, `s3b-smoke-${vp}`);

// --- 4. boarding ---
await page.evaluate(() => {
  const g = window.__game;
  const t = g.target;
  if (!t) return;
  t.sails = t.sailMax * 0.15; t.hull = t.hullMax * 0.3;
  t.x = g.player.x + 26; t.z = g.player.z + 4;
  t.speed = 0; g.player.speed = 0;
  g.rig.setZoom(110); g.rig.distance = 110;
  g.startBoarding(g.player, t);
});
await sleep(3000);
await shot(page, `s4-boarding-${vp}`);
await sleep(9000);
await shot(page, `s5-prize-${vp}`);

console.log('fight:', fight);
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no console errors');
await browser.close();
