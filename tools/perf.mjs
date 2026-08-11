/* Render budget: draw calls, triangles and CPU frame cost in the worst
   case the game can produce (full traffic, a battle, smoke everywhere). */
import { launch, sleep, ff } from './qa.mjs';

const { browser, page, errors } = await launch('phone');
await sleep(900);
await page.click('#btn-new');
await sleep(2500);

const idle = await page.evaluate(() => {
  const r = window.__renderer;
  return r ? { calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs.length,
    geometries: r.info.memory.geometries, textures: r.info.memory.textures } : null;
});

// worst case: everything on screen at once
await page.evaluate(() => {
  const g = window.__game;
  const p = g.player;
  p.x = -190; p.z = 400;
  // drag every ship into the frame and set them all firing
  let i = 0;
  for (const s of g.ships) {
    if (s.isPlayer) continue;
    const a = (i / g.ships.length) * Math.PI * 2;
    s.x = p.x + Math.cos(a) * (80 + i * 18);
    s.z = p.z + Math.sin(a) * (80 + i * 18);
    s.hostileToPlayer = true; s.aggro = 1; s.lastAttacker = p;
    s.shot = 500;
    i++;
  }
  const t = g.ships.find(s => !s.isPlayer);
  g.selectTarget(t);
  p.shot = 999;
});
await ff(page, 6);
await sleep(3000);

const busy = await page.evaluate(async () => {
  const r = window.__renderer;
  const g = window.__game;
  // hammer the effects for a moment
  for (let k = 0; k < 40; k++) {
    g.fx.cannonSmoke(g.player.x + k, 3, g.player.z, 1, 0, 1);
    g.fx.splash(g.player.x - k, g.player.z + 10, 1);
    g.fx.woodHit(g.player.x, 4, g.player.z + k, 1);
  }
  await new Promise(r2 => requestAnimationFrame(r2));
  await new Promise(r2 => requestAnimationFrame(r2));
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const a = performance.now();
    g.update(1 / 60);
    samples.push(performance.now() - a);
  }
  samples.sort((x, y) => x - y);
  return {
    calls: r.info.render.calls, tris: r.info.render.triangles,
    programs: r.info.programs.length,
    ships: g.ships.length,
    projectiles: g.projectiles.list.length,
    simMedianMs: +samples[100].toFixed(3),
    simP99Ms: +samples[198].toFixed(3),
  };
});

console.log('idle frame :', JSON.stringify(idle));
console.log('busy frame :', JSON.stringify(busy));
console.log(errors.length ? 'ERRORS ' + errors.slice(0, 5).join('\n') : 'no console errors');
await browser.close();
