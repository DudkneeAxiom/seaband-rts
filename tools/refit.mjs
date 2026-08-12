/* Refits: the work has to show on the ship, not just in the numbers.

   The rule this suite defends is the one the design pass exists for — if an
   upgrade physically modifies a vessel, the player can see it. So every check
   here asserts on two things at once: the stat that changed, and the geometry
   that changed with it. A refit that moved a number without moving a vertex
   fails, which is exactly the failure that made upgrades feel like a
   spreadsheet.

   Bought through the real shipyard where possible, so the price, the coin and
   the rebuild all go through the code a player's thumb goes through. */
import { launch, sleep, shot, newVoyage, waitFor, dismissModal } from './qa.mjs';

const vp = process.argv[2] || 'desktop';
const { browser, page, errors } = await launch(vp);
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);
await dismissModal(page);

/** Everything about her that a refit could move. */
const survey = () => G(() => {
  const g = window.__game, p = g.player;
  let verts = 0, tris = 0;
  p.mesh.traverse(o => {
    if (!o.geometry || !o.geometry.attributes.position) return;
    verts += o.geometry.attributes.position.count;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  const box = new (Object.getPrototypeOf(p.mesh.position).constructor)();
  void box;
  return {
    verts, tris: Math.round(tris),
    ports: p.mesh.userData.ports.length,
    upgrades: (p.mesh.userData.upgrades || []).slice(),
    guns: p.gunsPort + p.gunsStb,
    gunsMax: p.gunsMax,
    speed: +p.cls.speed.toFixed(2),
    hullMax: p.hullMax,
    cargo: p.cls.cargo,
    coin: Math.round(g.coin),
    // the colour actually written into the hull below the boot-top
    lowHull: (() => {
      const geo = p.mesh.userData.bodyMesh.geometry;
      const pos = geo.attributes.position, col = geo.attributes.color;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > -0.4 || pos.getY(i) < -2.5) continue;
        r += col.getX(i); gg += col.getY(i); b += col.getZ(i); n++;
      }
      return n ? [+(r / n).toFixed(3), +(gg / n).toFixed(3), +(b / n).toFixed(3)] : null;
    })(),
  };
});

/** Buy one through the shipyard, the way a player does. */
const buy = async (id) => {
  await G(() => { window.__game.coin = 9000; });
  await G(i => {
    const g = window.__game;
    const up = g.upgradesFor(g.player).find(u => u.id === i);
    g.buyUpgrade(g.player, up);
  }, id);
  await sleep(250);
};

const stock = await survey();
await shot(page, `rf-stock-${vp}`);
ok(`a stock cutter is where we start (${stock.tris} triangles, ${stock.ports} ports, ${stock.guns} guns)`,
  stock.upgrades.length === 0 && stock.ports === 4);

/* ---------------- copper ---------------- */
await buy('copper');
const copper = await survey();
await shot(page, `rf-copper-${vp}`);
ok(`copper sheathing is worth speed (${stock.speed} -> ${copper.speed} knots)`, copper.speed > stock.speed);
/* No new geometry for this one by design: plating bolted over the hull as a
   separate shell z-fights and juts at the bow. It is the hull's own colour
   below the boot-top, which follows her lines however far she heels — so the
   evidence it happened is the colour of those vertices, not the count. */
ok(`and it is on the hull, not in the ledger (below-water colour ${JSON.stringify(stock.lowHull)} -> ${JSON.stringify(copper.lowHull)})`,
  !!copper.lowHull && !!stock.lowHull
  && (copper.lowHull[0] !== stock.lowHull[0] || copper.lowHull[2] !== stock.lowHull[2])
  && copper.lowHull[0] > copper.lowHull[2]);        // copper is warm: more red than blue
ok('copper is recorded on the hull she was built with', copper.upgrades.includes('copper'));

/* ---------------- doubled timbers ---------------- */
await buy('timbers');
const timbers = await survey();
await shot(page, `rf-timbers-${vp}`);
ok(`doubled timbers are worth hull (${stock.hullMax} -> ${timbers.hullMax})`, timbers.hullMax > stock.hullMax);
ok(`and she is visibly more heavily built (${copper.tris} -> ${timbers.tris} triangles)`,
  timbers.tris > copper.tris + 200);

/* ---------------- gunports ---------------- */
await buy('ports');
const ports = await survey();
await shot(page, `rf-ports-${vp}`);
ok(`two more gunports are worth two more guns (${stock.guns} -> ${ports.guns})`, ports.guns === stock.guns + 2);
ok(`and the ship carries them (${stock.ports} -> ${ports.ports} muzzles on the model)`,
  ports.ports === stock.ports + 2);

/* the shot has to come out of the new ports, not out of thin air */
const firing = await G(() => {
  const g = window.__game, p = g.player;
  const xs = p.mesh.userData.ports.filter(o => o.side === 'stb').map(o => +o.z.toFixed(2));
  return { perSide: xs.length, spread: Math.max(...xs) - Math.min(...xs) };
});
ok(`the new guns have their own positions along her side (${firing.perSide} a side, ${firing.spread.toFixed(1)}m apart)`,
  firing.perSide === 3 && firing.spread > 1);

/* ---------------- lockers ---------------- */
await buy('lockers');
const lockers = await survey();
await shot(page, `rf-lockers-${vp}`);
ok(`deepened lockers are worth cargo (${stock.cargo} -> ${lockers.cargo})`, lockers.cargo === stock.cargo + 20);
ok(`and there is visibly more on her deck (${ports.tris} -> ${lockers.tris} triangles)`,
  lockers.tris > ports.tris + 60);

/* ---------------- they compose ---------------- */
ok(`all four refits stand together (${lockers.upgrades.join(', ')})`,
  ['copper', 'timbers', 'ports', 'lockers'].every(u => lockers.upgrades.includes(u)));
ok(`a fully refitted cutter is a different ship (${stock.tris} -> ${lockers.tris} triangles, ${stock.guns} -> ${lockers.guns} guns)`,
  lockers.tris > stock.tris + 300 && lockers.guns > stock.guns);

/* ---------------- and they survive a reload ---------------- */
await G(() => { window.__game.save(); });
const pre = await survey();
await page.reload({ waitUntil: 'networkidle' });
await waitFor(page, () => !document.getElementById('btn-continue').classList.contains('hidden'), 9000);
await page.click('#btn-continue');
await waitFor(page, () => !!window.__game && !!window.__game.player
  && document.getElementById('title').classList.contains('hidden'), 9000);
await sleep(400);
const post = await survey();
ok(`a refitted ship comes back refitted (${post.upgrades.join(', ') || 'none'})`,
  ['copper', 'timbers', 'ports', 'lockers'].every(u => post.upgrades.includes(u)));
ok(`and she is rebuilt from that, not from her class (${pre.tris} -> ${post.tris} triangles, ${post.ports} ports)`,
  post.ports === pre.ports && Math.abs(post.tris - pre.tris) < 40);
await shot(page, `rf-reloaded-${vp}`);

/* ---------------- a refit costs a rebuild, not a leak ---------------- */
const churn = await G(async () => {
  const g = window.__game, p = g.player, r = window.__renderer;
  const before = r.info.memory.geometries;
  for (let i = 0; i < 8; i++) p.refitMesh(g.scene);
  await new Promise(res => setTimeout(res, 60));
  return { before, after: r.info.memory.geometries, inScene: g.scene.children.length };
});
ok(`eight refits do not pile up geometry (${churn.before} -> ${churn.after})`,
  churn.after <= churn.before + 4);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
