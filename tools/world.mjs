/* Does the ocean live without the player?
   Run the sim for ten minutes with the player parked and see what the
   NPC captains got up to on their own. Also measures frame cost. */
import { launch, sleep, shot } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
await sleep(900);
await page.click('#btn-new');
await sleep(1500);

const report = await page.evaluate(() => {
  const g = window.__game;
  g.paused = false;
  const p = g.player;
  p.throttle = 0;
  const events = { broadsides: 0, boardings: 0, arrivals: 0, sinkings: 0, chases: 0, spawns: 0 };
  const seen = new Set();
  const origBroad = g.ctx.onBroadside;
  g.ctx.onBroadside = (s, side, n) => { if (!s.isPlayer) events.broadsides++; origBroad(s, side, n); };
  const origBoard = g.startBoarding.bind(g);
  g.startBoarding = (a, b) => { const n = g.boardings.length; origBoard(a, b); if (g.boardings.length > n && !a.isPlayer && !b.isPlayer) events.boardings++; };
  const roles = {};
  const stateHist = {};

  for (let i = 0; i < 60 * 600; i++) {
    p.x = 0; p.z = 300; p.speed = 0;       // park the player mid-map
    g.update(1 / 60);
    if (i % 300 === 0) {
      for (const s of g.ships) {
        if (s.isPlayer) continue;
        roles[s.role] = (roles[s.role] || 0) + 1;
        const k = s.role + ':' + (s.brain.state || 'idle');
        stateHist[k] = (stateHist[k] || 0) + 1;
        if (s.target) events.chases++;
        seen.add(s.name);
      }
    }
  }
  events.sinkings = g.ships.filter(s => !s.alive).length;
  return {
    events,
    distinctShipsSeen: seen.size,
    alive: g.ships.filter(s => s.alive && !s.isPlayer).length,
    roles, stateHist,
    marketDrift: Object.fromEntries(Object.entries(g.market.ports).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v.stock).map(([g2, n]) => [g2, Math.round(n)]))])),
  };
});
console.log('=== ten simulated minutes with the player parked ===');
console.log('NPC broadsides fired :', report.events.broadsides);
console.log('NPC-vs-NPC boardings :', report.events.boardings);
console.log('ships that were hunting something (samples):', report.events.chases);
console.log('distinct ships seen  :', report.distinctShipsSeen);
console.log('alive NPCs at the end:', report.alive);
console.log('role samples         :', JSON.stringify(report.roles));
console.log('brain states         :', JSON.stringify(report.stateHist));
console.log('market stock after   :', JSON.stringify(report.marketDrift));

/* frame cost */
await page.evaluate(() => { window.__frames = []; });
const perf = await page.evaluate(async () => {
  const g = window.__game;
  const t0 = performance.now();
  let n = 0;
  const samples = [];
  for (let i = 0; i < 240; i++) {
    const a = performance.now();
    g.update(1 / 60);
    samples.push(performance.now() - a);
    n++;
  }
  samples.sort((x, y) => x - y);
  return {
    ships: g.ships.length,
    simMeanMs: +((performance.now() - t0) / n).toFixed(3),
    simP95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
  };
});
console.log('\n=== simulation cost (excludes GPU) ===');
console.log(JSON.stringify(perf));

await shot(page, 'world-after-10min');
console.log(errors.length ? 'ERRORS ' + errors.slice(0, 6).join('\n') : 'no console errors');
await browser.close();
