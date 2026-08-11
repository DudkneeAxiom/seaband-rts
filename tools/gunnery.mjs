/* Gunnery calibration.
   1) Accuracy vs range, measured in isolation (world emptied of everyone
      but the firing ship and a pinned butt).
   2) Duel outcomes over several runs — the number that actually matters:
      is a first Tally fight winnable, and does it cost you something? */
import { launch, sleep } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
await sleep(900);
await page.click('#btn-new');
await sleep(1200);

const acc = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  const keep = g.ships.slice();
  for (const range of [50, 100, 150, 200, 235]) {
    // isolate: only the flagship and one butt exist
    const butt = keep.find(s => s.faction === 'pirate') || keep[1];
    g.ships.length = 0;
    g.ships.push(g.player, butt);
    g.paused = false;
    butt.role = 'idle'; butt.target = null; butt.hostileToPlayer = false;
    butt.hullMax = 1e6; butt.hull = 1e6; butt.sails = butt.sailMax;

    let hits = 0, shots = 0;
    const origSpawn = g.projectiles.spawn.bind(g.projectiles);
    g.projectiles.spawn = o => { shots++; origSpawn(o); };
    const origHit = g.ctx.onHit;
    g.ctx.onHit = (p, s) => { if (s === butt) hits++; };

    for (let trial = 0; trial < 40; trial++) {
      const p = g.player;
      p.x = 0; p.z = 0; p.yaw = 0; p.speed = 0; p.shot = 900;
      p.gunsPort = p.gunsMax; p.gunsStb = p.gunsMax;
      p.reload.stb = 0; p.reload.port = 0;
      butt.x = range; butt.z = 0; butt.yaw = 0; butt.speed = 0;
      g.target = butt; g.fireSide = 'stb';
      g.playerFire();
      for (let i = 0; i < 260; i++) {
        p.x = 0; p.z = 0; p.yaw = 0; p.speed = 0;
        butt.x = range; butt.z = 0; butt.yaw = 0; butt.speed = 0;
        g.update(1 / 60);
      }
    }
    g.projectiles.spawn = origSpawn; g.ctx.onHit = origHit;
    out.push({ range, shots, hits, pct: shots ? Math.round(hits / shots * 100) : -1 });
  }
  return out;
});
console.log('accuracy — green player crew, stationary target broadside-on');
console.log(' range  shots  hits   hit%');
for (const r of acc) console.log(String(r.range).padStart(6), String(r.shots).padStart(6), String(r.hits).padStart(6), String(r.pct + '%').padStart(6));

const duels = await page.evaluate(() => {
  const g = window.__game;
  const runs = [];
  for (let k = 0; k < 6; k++) {
    g.newGame(true);
    g.paused = false;
    const p = g.player;
    p.shot = 400;
    const t = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
    t.x = p.x + 190; t.z = p.z + 40; t.hostileToPlayer = true; t.aggro = 1; t.lastAttacker = p;
    g.selectTarget(t);
    let ticks = 0;
    while (t.alive && !t.captured && p.alive && ticks < 60 * 200) {
      ticks++;
      const dx = t.x - p.x, dz = t.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const bearing = Math.atan2(dx, dz);
      const side = p.reload.stb <= p.reload.port ? 1 : -1;
      let ang;
      if (d > 165) ang = bearing;
      else if (d < 62) ang = bearing + Math.PI * 0.62 * side;
      else ang = bearing + (Math.PI / 2) * side * Math.max(0.7, Math.min(1.25, 110 / d));
      p.setHeading(ang);
      p.ammo = t.sailFrac > 0.45 ? 'chain' : (d < 70 ? 'grape' : 'round');
      if (g.fireSide && p.reload[g.fireSide] <= 0) g.playerFire();
      g.update(1 / 60);
    }
    runs.push({
      foe: t.cls.name, s: Math.round(ticks / 60),
      playerHull: +p.hullFrac.toFixed(2), playerCrew: p.crewTotal, alive: p.alive,
      foeHull: +t.hullFrac.toFixed(2), foeSail: +t.sailFrac.toFixed(2), foeCrew: t.crewTotal,
    });
  }
  return runs;
});
console.log('\nfirst-fight duels (player cutter, green crew, holds the beam):');
for (const d of duels) console.log(' ', JSON.stringify(d));
console.log(`  player survived ${duels.filter(d => d.alive).length}/${duels.length}`);
console.log('  median length', duels.map(d => d.s).sort((a, b) => a - b)[duels.length >> 1] + 's');
console.log(errors.length ? 'ERRORS ' + errors.slice(0, 5).join('\n') : 'no console errors');
await browser.close();
