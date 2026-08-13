/* Harbours: settlements standing on land, and credit for a fight you won
   but somebody else finished. */
import { launch, sleep, shot, newVoyage } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);

/* ---------- every port is built on its own island ---------- */
const geo = await G(() => {
  const g = window.__game, H = window.__terrain.heightAt;
  return g.PORTS.map(p => {
    const town = window.__shore[p.id];
    // where does the settlement builder think the waterfront is?
    const shoreH = H(town.x, town.z);
    const townH = H(town.townX, town.townZ);
    // the mooring itself must still float a hull
    const moorD = -H(p.x, p.z);
    // and the piers should reach from that shore toward the mooring
    const gap = Math.hypot(town.x - p.x, town.z - p.z);
    return { id: p.id, shoreH: +shoreH.toFixed(1), townH: +townH.toFixed(1),
      moorD: +moorD.toFixed(1), gap: Math.round(gap), dockR: p.dockR,
      labelY: Math.round(town.townY) };
  });
});
console.log('\n port        waterfront  town height  mooring depth  shore gap');
for (const r of geo) {
  console.log(`  ${r.id.padEnd(10)} ${String(r.shoreH).padStart(8)} ${String(r.townH).padStart(11)} `
    + `${String(r.moorD).padStart(13)} ${String(r.gap).padStart(10)}`);
}
ok('every settlement is anchored on dry land', geo.every(r => r.shoreH > 0.5));
ok('and its name sits over the roofs, not the water', geo.every(r => r.townH > 1.5));
ok(`and clears the ground it stands on (${geo.map(r => `${r.id} ${r.labelY}`).join(', ')})`,
  geo.every(r => r.labelY - r.townH > 30));
ok('while the mooring still floats a hull', geo.every(r => r.moorD > 8));
ok(`and the town is within reach of its own harbour (gaps ${geo.map(r => r.gap).join(', ')})`,
  geo.every(r => r.gap < r.dockR * 1.6));

/* ---------- nothing is left standing in open water ---------- */
const floating = await G(() => {
  const g = window.__game, H = window.__terrain.heightAt;
  const bad = [];
  const terrain = g.scene.getObjectByName('terrain');
  terrain.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    /* Harbour works stand in open water because that is what they are for: a
       breakwater on dry land is a wall. They live in their own mesh so this
       check can go on meaning "no *building* is floating". */
    if (o.name === 'seaworks') return;
    const a = o.geometry.attributes.position.array;
    // sample the mesh and look for structure standing well above water in
    // places where there is no ground under it
    for (let i = 0; i < a.length; i += 3 * 97) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      // piers, bollards and buoys stand over water on purpose; a building does not
      if (y < 8) continue;
      if (H(x, z) < -6) bad.push({ x: Math.round(x), z: Math.round(z), y: Math.round(y) });
    }
  });
  return bad.slice(0, 8);
});
ok(`no building stands in open water (${floating.length} suspect points)`, floating.length === 0);
if (floating.length) console.log('  floating at:', JSON.stringify(floating));

/* ---------- Greywake's arms are masonry, not scenery ---------- */
/* The stone arms used to exist only as a mesh, and a cutter could sail
   through the middle of a 22-metre block. They are stamped into the depth
   field now, so the same soundings the hull answers to must find them —
   shallow on both flanks of the approach, while the mouth between the arm
   heads still carries any hull in the game. */
const gwArms = await G(() => {
  const g = window.__game, H = window.__terrain.heightAt;
  const p = g.PORTS.find(x => x.id === 'greywake');
  const t = window.__shore.greywake;              // the waterfront the works run out from
  const ax = Math.atan2(p.x - t.x, p.z - t.z);    // seaward, straight out the mouth
  let mouth = 1e9, left = 1e9, right = 1e9;
  for (let out = 60; out <= 300; out += 8) {
    const cx = t.x + Math.sin(ax) * out, cz = t.z + Math.cos(ax) * out;
    mouth = Math.min(mouth, -H(cx, cz));
    for (let s = 30; s <= 140; s += 8) {
      const dL = -H(cx + Math.cos(ax) * s, cz - Math.sin(ax) * s);
      const dR = -H(cx - Math.cos(ax) * s, cz + Math.sin(ax) * s);
      left = Math.min(left, dL); right = Math.min(right, dR);
    }
  }
  return { mouth: +mouth.toFixed(1), left: +left.toFixed(1), right: +right.toFixed(1) };
});
ok(`the breakwater arms stand in the water itself (shallowest ${gwArms.left}m / ${gwArms.right}m either side)`,
  gwArms.left < 1.5 && gwArms.right < 1.5);
ok(`while the harbour mouth still carries a hull (${gwArms.mouth}m on the axis)`, gwArms.mouth > 6.5);

/* ---------- a prize is berthed in water, not on the beach ---------- */
const berths = await G(() => {
  const g = window.__game, H = window.__terrain.heightAt;
  return g.PORTS.map(p => {
    const b = g.harbourBerth(p);
    return { id: p.id, depth: +(-H(b.x, b.z)).toFixed(1) };
  });
});
ok(`a prize is moored in water at every port (${berths.map(b => `${b.id} ${b.depth}m`).join(', ')})`,
  berths.every(b => b.depth > 8));

for (const id of ['ilovantu', 'marasay', 'escarra']) {
  await G((pid) => {
    const g = window.__game, p = g.player;
    const port = g.PORTS.find(x => x.id === pid);
    p.x = port.x; p.z = port.z; p.speed = 0; p.dest = null; p.throttle = 0;
    g.rig.focus.set(port.x, 0, port.z);
    g.rig.azimuth = 1.2; g.rig.setZoom(260); g.rig.distance = 260;
    g.paused = true;
  }, id);
  await sleep(1100);
  await shot(page, `shore-${id}`);
}

/* ---------- credit for a fight somebody else finishes ---------- */
const stolen = await G(() => {
  const g = window.__game, p = g.player;
  g.paused = false;
  g.coin = 1000; g.prestige = 0;
  const pir = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
  pir.x = p.x + 120; pir.z = p.z; pir.hostileToPlayer = true;
  pir.hull = pir.hullMax;
  const before = { coin: g.coin, prestige: g.prestige, sunk: g.stats.sunk };
  // you beat her down to a quarter of her hull, spending your shot on it...
  while (pir.alive && pir.hullFrac > 0.25) {
    const res = pir.damage(pir.hullMax * 0.05, 'round', p);
    g.onHit({ owner: p }, pir, res);
  }
  const killedByPlayer = !pir.alive;
  // ...and an Admiralty frigate sails in and fires the last shots
  const pat = g.ships.find(s => s.faction === 'admiralty' && s.alive) || g.spawnNPC('patrol');
  while (pir.alive) {
    const res = pir.damage(pir.hullMax * 0.05, 'round', pat);
    g.onHit({ owner: pat }, pir, res);
  }
  const mineShare = pir.dmgMine / pir.dmgAll;
  g.update(1 / 30);
  return {
    share: +mineShare.toFixed(2), rewarded: !!pir.rewarded, killedByPlayer,
    coin: g.coin - before.coin, prestige: +(g.prestige - before.prestige).toFixed(1),
    sunk: g.stats.sunk - before.sunk,
  };
});
ok('the Admiralty really did land the last shot', !stolen.killedByPlayer && stolen.share < 0.9);
ok(`work on a hull another captain finishes still pays (share ${Math.round(stolen.share * 100)}% -> ◆${stolen.coin}, ${stolen.prestige} prestige)`,
  stolen.coin > 0 && stolen.prestige > 0 && stolen.rewarded);
ok('and it counts on your tally', stolen.sunk === 1);

/* ---------- the same when she strikes to somebody else's boarders ---------- */
const boarded = await G(() => {
  const g = window.__game, p = g.player;
  const pir = g.spawnNPC('pirate');
  pir.x = p.x + 140; pir.z = p.z; pir.hull = pir.hullMax;
  const before = g.coin;
  while (pir.alive && pir.hullFrac > 0.3) {
    const res = pir.damage(pir.hullMax * 0.05, 'round', p);
    g.onHit({ owner: p }, pir, res);
  }
  const pat = g.ships.find(s => s.faction === 'admiralty' && s.alive) || g.spawnNPC('patrol');
  g.endBoarding({ a: pat, d: pir }, 'attacker');       // her colours come down to them
  return { coin: g.coin - before, faction: pir.faction, rewarded: !!pir.rewarded };
});
ok(`a prize another captain boards still pays your share (◆${boarded.coin})`,
  boarded.coin > 0 && boarded.rewarded);
ok(`and she flies their colours afterwards (${boarded.faction})`, boarded.faction === 'admiralty');

/* ---------- but a parting shot is not a claim ---------- */
const potshot = await G(() => {
  const g = window.__game, p = g.player;
  const pir = g.spawnNPC('pirate');
  pir.x = p.x + 200; pir.z = p.z; pir.hull = pir.hullMax;
  const before = g.coin;
  // one token hit from you, the rest from somebody else
  let res = pir.damage(pir.hullMax * 0.05, 'round', p);
  g.onHit({ owner: p }, pir, res);
  const pat = g.ships.find(s => s.faction === 'admiralty' && s.alive) || g.spawnNPC('patrol');
  while (pir.alive) {
    res = pir.damage(pir.hullMax * 0.08, 'round', pat);
    g.onHit({ owner: pat }, pir, res);
  }
  g.update(1 / 30);
  return { share: +(pir.dmgMine / pir.dmgAll).toFixed(2), coin: g.coin - before };
});
ok(`a parting shot earns nothing (${Math.round(potshot.share * 100)}% of the work -> ◆${potshot.coin})`,
  potshot.coin === 0);

/* ---------- and your own kill still pays in full, once ---------- */
const own = await G(() => {
  const g = window.__game, p = g.player;
  const pir = g.spawnNPC('pirate');
  pir.x = p.x + 120; pir.z = p.z; pir.hull = pir.hullMax;
  const before = g.coin;
  while (pir.alive) {
    const res = pir.damage(pir.hullMax * 0.1, 'round', p);
    g.onHit({ owner: p }, pir, res);
  }
  const paid = g.coin - before;
  for (let i = 0; i < 5; i++) g.update(1 / 30);      // no second helping
  return { paid, after: g.coin - before };
});
ok(`sinking her yourself pays the whole prize (◆${own.paid})`, own.paid > 0);
ok('and pays it exactly once', own.after === own.paid);

console.log('');
console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
