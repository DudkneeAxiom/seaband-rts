/* A full pass over the game's states at several sizes, for eyes rather than
   assertions: title, questionnaire, open sea, harbour screens, combat,
   boarding, prize, menu, and the loss. */
import { launch, sleep, shot, ff, newVoyage, dismissModal, waitFor } from './qa.mjs';

const vp = process.argv[2] || 'phone';
const { browser, page, errors } = await launch(vp);
const S = n => shot(page, `sweep-${vp}-${n}`);

await sleep(1400);
await S('01-title');

await page.click('#btn-new');
await waitFor(page, () => !document.getElementById('origin').classList.contains('hidden'));
await sleep(400);
await S('02-question');
await page.click('#og-skip');
await sleep(500);
await S('03-summary');
await page.click('.og-go');
await waitFor(page, () => !document.getElementById('modal').classList.contains('hidden'));
await sleep(400);
await S('04-opening');
await dismissModal(page);

await sleep(800);
await S('05-sea');

/* harbour */
await page.evaluate(() => {
  const g = window.__game, p = g.player, port = g.PORTS[0];
  g.coin = 2400;
  p.x = port.x; p.z = port.z; p.speed = 0; p.dest = null; p.throttle = 0; p.headingCmd = p.yaw;
  for (const s of g.ships) if (!s.isPlayer && Math.hypot(s.x - port.x, s.z - port.z) < 600) s.x += 2200;
});
await sleep(700);
await dismissModal(page);
await waitFor(page, () => !!document.querySelector('.act-btn.dock'));
await S('06-dockprompt');
await page.click('.act-btn.dock');
await sleep(800);
await S('07-harbour');
for (const [tab, name] of [['market', '08-market'], ['crew', '09-crew'], ['yard', '10-yard'], ['tavern', '11-tavern']]) {
  const btn = await page.evaluate(t => {
    const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => x.textContent.toLowerCase().includes(t));
    if (b) { b.click(); return true; }
    return false;
  }, tab);
  if (btn) { await sleep(500); await S(name); }
}
await page.click('#sheet-close');
await sleep(700);
await dismissModal(page);

/* combat */
await page.evaluate(() => {
  const g = window.__game, p = g.player;
  p.x = 120; p.z = 60; p.dest = null; p.shot = 60;
  const pir = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
  pir.x = p.x + 110; pir.z = p.z + 40; pir.hostileToPlayer = true;
  g.selectTarget(pir);
});
await ff(page, 2);
await sleep(700);
await S('12-target');
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 6; i++) { g.player.reload.stb = 0; g.player.reload.port = 0; g.playerFire(); g.update(0.6); }
});
await sleep(600);
await S('13-broadside');

/* boarding */
await page.evaluate(() => {
  const g = window.__game, t = g.target;
  if (!t) return;
  t.sails = t.sailMax * 0.1; t.speed = 0;
  g.player.x = t.x - 22; g.player.z = t.z + 6; g.player.speed = 0; g.player.dest = null;
  g.player.crew.marine += 10; g.player.crew.veteran += 6;
});
await sleep(700);
const boardable = await page.evaluate(() => !!document.querySelector('.act-btn.board'));
if (boardable) {
  await page.click('.act-btn.board');
  await sleep(900);
  await S('14-boarding');
  for (let i = 0; i < 40; i++) {
    await ff(page, 1.2);
    if (await page.evaluate(() => !document.getElementById('modal').classList.contains('hidden'))) break;
  }
  await sleep(400);
  await S('15-prize');
  await dismissModal(page);
}

/* fleet + menu */
await sleep(600);
await S('16-fleet');
await page.click('#btn-menu');
await sleep(700);
await S('17-log');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => /HELM/.test(x.textContent));
  if (b) b.click();
});
await sleep(500);
await S('18-helm');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => /SETTINGS/.test(x.textContent));
  if (b) b.click();
});
await sleep(500);
await S('19-settings');
await page.click('#sheet-close');
await sleep(500);

/* loss */
await page.evaluate(() => window.__game.playerLost('Test of the loss screen.'));
await sleep(700);
await S('20-lost');

console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : 'no console errors');
await browser.close();
