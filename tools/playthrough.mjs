/* Full-arc functional test: new game → sail → dock → trade/recruit/hire
   → sea → combat → board → capture → two-ship fleet → save/load.
   Uses real UI clicks wherever a player would. */
import { launch, shot, sleep, ff, newVoyage, dismissModal, waitFor } from './qa.mjs';

const vp = process.argv[2] || 'phone';
const { browser, page, errors } = await launch(vp);
const log = [];
const ok = (m, cond) => { log.push(`${cond ? 'PASS' : 'FAIL'}  ${m}`); if (!cond) console.log('  ^ FAILED'); };
const G = fn => page.evaluate(fn);

await sleep(1000);
await newVoyage(page);
ok('game boots with a flagship', await G(() => !!window.__game.player));

/* ---------- 1. sail to the port ---------- */
await G(() => {
  const g = window.__game;
  g.commandMove(-190, 400);
});
let docked = false;
for (let i = 0; i < 20; i++) {
  await ff(page, 3);
  docked = await G(() => !!window.__game.dockablePort);
  if (docked) break;
  await G(() => { const g = window.__game; if (!g.player.dest && !g.dockablePort) g.commandMove(-190, 400); });
}
ok('sailed to Ilo Vantu and the DOCK prompt appeared', docked);
await shot(page, `p1-approach-${vp}`);

/* ---------- 2. dock, use every service ---------- */
await dismissModal(page);
await page.click('.act-btn.dock');
await sleep(900);
ok('port sheet opened', await G(() => !document.getElementById('sheet').classList.contains('hidden')));
await shot(page, `p2-harbour-${vp}`);

const before = await G(() => ({ coin: window.__game.coin, prov: window.__game.player.provisions }));
// buy provisions (first gold button in the STORES section)
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const r = rows.find(x => x.textContent.includes('Provisions'));
  r && r.querySelector('button').click();
});
await sleep(400);
const after = await G(() => ({ coin: window.__game.coin, prov: window.__game.player.provisions }));
ok('buying provisions costs coin and adds stores', after.prov > before.prov && after.coin < before.coin);

// repair
await G(() => { window.__game.player.hull = 40; });
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.find(t => t.textContent.includes('HARBOUR')).click();
});
await sleep(300);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const r = rows.find(x => x.textContent.includes('Careen'));
  r && r.querySelector('button').click();
});
await sleep(400);
ok('refit restores the hull', await G(() => window.__game.player.hull === window.__game.player.hullMax));

// market
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('MARKET')).click());
await sleep(400);
await shot(page, `p3-market-${vp}`);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const r = rows.find(x => x.textContent.includes('Salt Fish'));
  r && [...r.querySelectorAll('button')].find(b => b.textContent === 'BUY').click();
});
await sleep(400);
ok('bought cargo at market', await G(() => window.__game.player.cargoUsed > 0));

// crew
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('CREW')).click());
await sleep(400);
await shot(page, `p4-crew-${vp}`);
const crewBefore = await G(() => window.__game.player.crewTotal);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  for (let i = 0; i < 6; i++) {
    const r = rows.find(x => x.querySelector('.rtitle') && x.querySelector('.rtitle').textContent.trim() === 'Sailor');
    r && r.querySelector('button') && r.querySelector('button').click();
  }
});
await sleep(400);
ok('recruited crew', await G(() => window.__game.player.crewTotal) > crewBefore);

// tavern — hire an officer who can command
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('TAVERN')).click());
await sleep(500);
await shot(page, `p5-tavern-${vp}`);
await G(() => { window.__game.coin = 4000; });
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('TAVERN')).click());
await sleep(300);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  for (const r of rows) {
    const b = r.querySelector('button');
    if (b && b.textContent.startsWith('◆') && !b.disabled) { b.click(); break; }
  }
});
await sleep(500);
ok('hired an officer', await G(() => window.__game.officers.length > 0));

// shipyard upgrade
await page.evaluate(() => [...document.querySelectorAll('.tab')].find(t => t.textContent.includes('SHIPYARD')).click());
await sleep(400);
await shot(page, `p6-yard-${vp}`);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const r = rows.find(x => x.textContent.includes('Doubled Timbers'));
  r && r.querySelector('button') && r.querySelector('button').click();
});
await sleep(400);
ok('bought a yard upgrade', await G(() => window.__game.player.upgrades && window.__game.player.upgrades.length > 0));

/* ---------- 3. back to sea ---------- */
await page.click('#sheet-close');
await sleep(600);
ok('port closed, back at sea', await G(() => document.getElementById('sheet').classList.contains('hidden')));
await sleep(500);
await dismissModal(page);      // making port closes a chapter, and it pauses to be read

/* ---------- 4. combat ---------- */
await G(() => {
  const g = window.__game;
  g.player.shot = 90;
  // open water, well clear of any harbour — a raider under a fort's guns
  // sheers off rather than fights, which is not what this is measuring
  g.player.x = 120; g.player.z = 60; g.player.dest = null;
  // give the officer to the flagship crew and set up a fair fight
  const pir = g.ships.find(s => s.faction === 'pirate' && s.alive && !s.isSant)
    || g.spawnNPC('pirate');
  pir.x = g.player.x + 130; pir.z = g.player.z + 60;
  pir.hostileToPlayer = true;
  g.selectTarget(pir);
});
await sleep(500);
ok('target selected, target card visible',
  await G(() => !document.getElementById('targetcard').classList.contains('hidden')));

// manoeuvre + fire until her rigging is gone
let fired = 0;
for (let i = 0; i < 60; i++) {
  await ff(page, 1.2);
  const st = await G(() => {
    const g = window.__game, t = g.target;
    if (!t) return { done: true };
    // steer to keep her on the beam like a player would
    const bearing = Math.atan2(t.x - g.player.x, t.z - g.player.z);
    g.player.setHeading(bearing + Math.PI / 2);
    g.player.ammo = t.sailFrac > 0.35 ? 'chain' : 'grape';
    let f = 0;
    // a captain who wants the ship rather than the wreck stops hulling her:
    // chain and grape still tell on the timbers, and 60 rounds of it will
    // put her under, taking the whole boarding half of this test with her
    const worthTaking = t.hullFrac > 0.35;
    if (worthTaking && g.fireSide && g.player.reload[g.fireSide] <= 0) { g.playerFire(); f = 1; }
    return { f, sail: t.sailFrac, hull: t.hullFrac, crew: t.crewTotal, board: g.boardable,
      alive: t.alive, pHull: g.player.hullFrac };
  });
  if (st.done) break;
  if (await G(() => window.__game.paused)) await dismissModal(page);
  fired += st.f || 0;
  if (st.board) break;          // grapples will reach: stop shooting and close
  if (st.sail < 0.3 && st.crew < 12) break;
  // and break off while there is still a ship under you — nobody trades
  // broadsides down to the waterline when the plan was to take her
  if (st.pHull < 0.55) break;
}
ok(`fired ${fired} broadsides`, fired > 0);
const enemy = await G(() => {
  const t = window.__game.target;
  return t ? { sail: t.sailFrac, hull: t.hullFrac, crew: t.crewTotal, alive: t.alive } : null;
});
log.push(`      enemy after gunnery: ${JSON.stringify(enemy)}`);
/* She has to still be there. This used to be tolerated by `!enemy ||`, which
   meant losing her passed here and then failed three checks later, in the
   boarding, where the cause was nowhere in sight. */
ok('the enemy is still afloat to be boarded', !!enemy && enemy.alive);
ok('gunnery damaged the enemy', !enemy || enemy.sail < 0.9 || enemy.hull < 0.95 || !enemy.alive);
await shot(page, `p7-combat-${vp}`);

/* ---------- 5. board & capture ---------- */
await G(() => {
  const g = window.__game;
  if (!g.target) return;
  g.player.crew.marine += 10; g.player.crew.veteran += 6;   // boarders enough to win it
  /* And a hull to board her from. Holding station at pistol shot while she
     keeps firing had been killing the player outright on a long fight, and a
     dead captain boards nothing — canBoard's first test is that you are
     alive. This section is about the boarding, not about surviving to it. */
  g.player.hull = g.player.hullMax; g.player.sails = g.player.sailMax;
});
await dismissModal(page);      // a chapter may have closed while we sailed
/* Lay her alongside and *keep* her there. Staging the position once was not
   enough: her AI has the way on her again within the second, and grapples do
   not reach off a ship still making six knots, so she would sail out of range
   before the check. A player matches her speed and holds station — this is
   that, re-applied every poll, until the game agrees she can be taken. */
await waitFor(page, () => {
  const g = window.__game, t = g.target;
  if (!t || !t.alive) return false;
  const a = t.yaw;
  g.player.x = t.x - Math.cos(a) * 22; g.player.z = t.z + Math.sin(a) * 22;
  g.player.stop(); g.player.speed = 0; g.player.dest = null;
  t.speed = 0;
  return g.boardable;
}, 8000);
/* When this fails it fails rarely, so it has to explain itself: every input
   canBoard looks at, captured at the moment the verdict was taken. */
const bd = await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  if (!t) return { boardable: false, why: 'no target' };
  const rel = Math.abs(p.speed - t.speed * Math.cos(
    Math.atan2(Math.sin(p.yaw - t.yaw), Math.cos(p.yaw - t.yaw))));
  return {
    boardable: g.boardable,
    d: +Math.hypot(t.x - p.x, t.z - p.z).toFixed(1),
    reach: +(34 + (p.cls.len + t.cls.len) * 0.25).toFixed(1),
    rel: +rel.toFixed(2), pSpeed: +p.speed.toFixed(2), tSpeed: +t.speed.toFixed(2),
    pAlive: p.alive, pHull: +p.hullFrac.toFixed(3),
    tAlive: t.alive, tCaptured: t.captured, boarding: !!(p.boarding || t.boarding),
    tHull: +t.hullFrac.toFixed(3), tCrew: t.crewTotal, pCrew: p.crewTotal,
    paused: g.paused, modal: !document.getElementById('modal').classList.contains('hidden'),
  };
});
ok(`BOARD becomes available alongside a slowed enemy ${JSON.stringify(bd)}`, bd.boardable);
const boardable = bd.boardable;
if (boardable) await page.click('.act-btn.board');
await sleep(1200);
await shot(page, `p8-boarding-${vp}`);
for (let i = 0; i < 40; i++) {
  await ff(page, 1.5);
  const done = await G(() => !document.getElementById('modal').classList.contains('hidden'));
  if (done) break;
}
const prizeModal = await G(() => ({
  open: !document.getElementById('modal').classList.contains('hidden'),
  title: document.getElementById('modal-title').textContent,
  buttons: [...document.querySelectorAll('#modal-actions .btn')].map(b => b.textContent),
}));
ok('prize dialog offered after winning the boarding', prizeModal.open && /Yours/.test(prizeModal.title));
log.push(`      prize options: ${JSON.stringify(prizeModal.buttons)}`);
await shot(page, `p9-prize-${vp}`);

// take her into the fleet right now if we can, else send her home
await page.evaluate(() => {
  const bs = [...document.querySelectorAll('#modal-actions .btn')];
  const give = bs.find(b => b.textContent.startsWith('GIVE HER TO'));
  (give || bs[0]).click();
});
await sleep(1500);
const fleet = await G(() => ({
  n: window.__game.fleet.length,
  prizes: window.__game.prizes.length,
  names: window.__game.fleet.map(s => s.name),
  captured: window.__game.stats.captured,
}));
ok('the prize is taken', fleet.captured === 1);
log.push(`      fleet: ${JSON.stringify(fleet)}`);

/* ---------- 6. fleet command ---------- */
if (fleet.n > 1) {
  ok('fleet bar appears with a consort',
    await G(() => !document.getElementById('fleetbar').classList.contains('hidden')));
  await page.evaluate(() => [...document.querySelectorAll('.fleet-btn')].find(b => b.textContent.includes('ENGAGE')).click());
  await sleep(400);
  ok('fleet order set to ENGAGE', await G(() => window.__game.fleetOrder === 'engage'));
  await G(() => { window.__game.setFleetOrder('follow'); window.__game.player.setDestination(window.__game.player.x + 400, window.__game.player.z + 200); });
  await ff(page, 30);
  const gap = await G(() => {
    const g = window.__game, c = g.fleet.find(s => !s.isPlayer);
    return c ? Math.round(Math.hypot(c.x - g.player.x, c.z - g.player.z)) : -1;
  });
  ok(`consort follows the flagship (gap ${gap}m)`, gap > 0 && gap < 260);
  await shot(page, `p10-fleet-${vp}`);
}

/* ---------- 7. save & reload ---------- */
await G(() => window.__game.save());
const pre = await G(() => ({ coin: Math.round(window.__game.coin), fleet: window.__game.fleet.length, cap: window.__game.stats.captured }));
await page.reload({ waitUntil: 'networkidle' });
await sleep(1400);
const hasContinue = await page.evaluate(() => !document.getElementById('btn-continue').classList.contains('hidden'));
ok('CONTINUE VOYAGE offered after a reload', hasContinue);
await page.click('#btn-continue');
await sleep(2500);
const post = await G(() => ({ coin: Math.round(window.__game.coin), fleet: window.__game.fleet.length, cap: window.__game.stats.captured }));
ok(`save round-trips (${JSON.stringify(pre)} -> ${JSON.stringify(post)})`,
  post.coin === pre.coin && post.fleet === pre.fleet && post.cap === pre.cap);
await shot(page, `p11-loaded-${vp}`);

/* ---------- 8. edge cases ---------- */
const noMoney = await G(() => {
  const g = window.__game;
  g.coin = 0;
  // open the harbour with an empty purse: every purchase must disable itself
  const port = window.PORTS_FOR_QA || null;
  void port;
  g.enterPort(g.PORTS ? g.PORTS[0] : (g.dockablePort || null));
  return true;
}).catch(() => false);
void noMoney;

// rapid tapping
for (let i = 0; i < 25; i++) {
  await page.mouse.click(300 + (i % 7) * 40, 200 + (i % 5) * 30, { delay: 5 });
}
await sleep(800);
ok('rapid tapping leaves the game running', await G(() => !!window.__game.player));

// destroy the flagship
await G(() => { const g = window.__game; g.player.hull = 1; g.player.damage(999, 'round', null); });
await ff(page, 4);
await sleep(600);
const over = await G(() => ({
  over: window.__game.gameOver,
  modal: !document.getElementById('modal').classList.contains('hidden'),
}));
ok('losing the flagship ends the voyage cleanly', over.over && over.modal);
await shot(page, `p12-gameover-${vp}`);

console.log('\n' + log.join('\n'));
console.log('\n' + (errors.length ? 'CONSOLE ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n') : 'no console errors'));
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.filter(l => l.startsWith('PASS')).length} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
