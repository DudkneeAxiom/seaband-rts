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

/* ---------- every port actually built a town ----------

   Nothing anywhere asserted that a settlement contains buildings. It was
   possible for a port to build *none* — and two did: what a builder would
   accept was two absolute numbers measured on Ilo Vantu's beach, so Fort
   Escarra, which stands on a seventy-metre rock, placed nothing at all and
   Greywake placed one shed, while their port screens photographed bare grass
   and captioned it an Admiralty station and a League fortress. Marasay lost
   its whole waterfront row the same way and so had no market building to
   frame. Every check above passed throughout, because they all ask where the
   town is rather than whether there is one.

   The service test is the sharp half: a port screen that captions a picture
   THE MARKET has to have a market to point the lens at. */
const towns = await G(() => {
  const g = window.__game;
  return g.PORTS.map(p => {
    const t = window.__shore[p.id] || {};
    const spots = t.spots || [];
    const kinds = [...new Set(spots.map(s => s.kind))];
    const want = ['tavern', 'market']
      .filter(k => p.services.includes(k))
      .concat(p.services.includes('shipyard') ? ['yard'] : []);
    return {
      id: p.id, size: p.size, spots: spots.length, piers: (t.piers || []).length,
      kinds, missing: want.filter(k => !kinds.includes(k)),
      front: spots.filter(s => s.front).length,
    };
  });
});
console.log('\n port        buildings  waterfront  piers  kinds');
for (const t of towns) {
  console.log(`  ${t.id.padEnd(10)} ${String(t.spots).padStart(9)} ${String(t.front).padStart(11)}`
    + ` ${String(t.piers).padStart(6)}  ${t.kinds.join(' ')}${t.missing.length ? '   MISSING ' + t.missing.join(' ') : ''}`);
}
ok(`every port built a town (${towns.map(t => `${t.id} ${t.spots}`).join(', ')})`,
  towns.every(t => t.spots >= (t.size === 'major' ? 12 : 6)));
ok('and every town has a waterfront row', towns.every(t => t.front >= 2));
ok(`and a building for every service it advertises `
  + `(${towns.filter(t => t.missing.length).map(t => `${t.id}: ${t.missing}`).join(', ') || 'all present'})`,
towns.every(t => t.missing.length === 0));

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

/* ---------- the road to a formation slot is sounded like the slot ----------
   Staged by construction: the flag past the arm head and off to one side, so
   her consort's echelon slot is in deep water but the straight line to it
   runs across the breakwater's apron. The check reads the *decision* — the
   point the brain recorded steering for — not the aftermath, and it first
   proves the fault is present (slot deep, road foul), because a check whose
   staging silently failed is decoration. */
const slotRoad = await G(async () => {
  const R = await import('/src/core/route.js');
  const T = await import('/src/world/terrain.js');
  const g = window.__game, p = g.player;
  const port = g.PORTS.find(x => x.id === 'greywake');
  const t = window.__shore.greywake;
  const ax = Math.atan2(port.x - t.x, port.z - t.z);
  const con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s) && s.faction !== 'pirate')
    || g.spawnNPC('merchant');
  con.faction = 'player'; con.role = 'consort'; con.hostileToPlayer = false;
  con.fleeing = false; con.chaseHold = 0; con.boarding = null; con.lockTo = null;
  con.brain = { state: 'idle', t: 0, cooldown: 0 };
  con.formSlot = 1; con.hull = con.hullMax;
  if (!g.fleet.includes(con)) g.fleet.push(con);
  g.setFleetOrder('follow', true);
  // consort in the channel; flag out past the arm head and swung to one side
  con.x = t.x + Math.sin(ax) * 70; con.z = t.z + Math.cos(ax) * 70;
  con.speed = 0; con.dest = null;
  let staged = null;
  for (let side = -1; side <= 1 && !staged; side += 2) {
    for (let off = 90; off <= 170 && !staged; off += 20) {
      p.x = t.x + Math.sin(ax) * 260 + Math.cos(ax) * off * side;
      p.z = t.z + Math.cos(ax) * 260 - Math.sin(ax) * off * side;
      p.yaw = ax; p.speed = 4; p.dest = null;
      const back = 46 + 26, sideOff = 34 + 8;
      const fx = p.x - Math.sin(p.yaw) * back + Math.cos(p.yaw) * sideOff;
      const fz = p.z - Math.cos(p.yaw) * back - Math.sin(p.yaw) * sideOff;
      const need = con.draft * 1.9 + 3;
      const slotDeep = T.depthAt(fx, fz) >= need;
      const roadFoul = !R.clearWater(con.x, con.z, fx, fz, need);
      if (slotDeep && roadFoul) staged = { fx, fz, need };
    }
  }
  if (!staged) return { note: 'could not stage a deep slot behind a foul road' };
  g.update(1 / 60);
  const aim = con.brain.stationAim;
  const out = {
    note: null,
    aimedAtSlot: aim ? Math.hypot(aim.x - staged.fx, aim.z - staged.fz) < 30 : null,
    aimedAtFlag: aim ? Math.hypot(aim.x - p.x, aim.z - p.z) < 30 : null,
  };
  const i = g.fleet.indexOf(con);
  if (i >= 0) g.fleet.splice(i, 1);
  con.faction = 'trader'; con.role = 'merchant'; con.brain = { state: 'idle', t: 0, cooldown: 0 };
  return out;
});
ok(`a slot behind a foul road is given up for the flag's own track `
  + `(${slotRoad.note || `aimed at flag: ${slotRoad.aimedAtFlag}, at slot: ${slotRoad.aimedAtSlot}`})`,
!slotRoad.note && slotRoad.aimedAtFlag === true && slotRoad.aimedAtSlot === false);

/* ---------- the fleet survives its captain's errand ashore ----------
   The report that forced this: a player sailed into Greywake to trade and
   every consort in company wrecked herself on the breakwater arms while the
   flag was at the quay. Echelon slots sat on the moles, the sound-ahead
   probe stepped clean over a thin wall, and a grounded hull had no idea how
   to get off again. So: sail the whole errand — in through the mouth, dock,
   trade-length pause, out again — and count the fleet afterwards. */
const errand = await G(() => {
  const g = window.__game, p = g.player;
  const port = g.PORTS.find(x => x.id === 'greywake');
  const t = window.__shore.greywake;
  const ax = Math.atan2(port.x - t.x, port.z - t.z);      // seaward axis of the mouth
  // the flag and two consorts, three hundred metres off the arm heads
  p.x = t.x + Math.sin(ax) * 330; p.z = t.z + Math.cos(ax) * 330;
  p.speed = 0; p.hull = p.hullMax; p.dest = null; p.yaw = ax + Math.PI;
  p.throttle = 1; g.paused = false;      // the screenshot pass above struck her sails
  const cons = [];
  for (let k = 0; k < 2 && g.ships.length; k++) {
    let con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s)
      && s.faction !== 'pirate' && !cons.includes(s));
    if (!con) con = g.spawnNPC('merchant');
    con.faction = 'player'; con.role = 'consort'; con.isPlayer = false;
    con.hostileToPlayer = false; con.fleeing = false; con.chaseHold = 0;
    con.formSlot = k + 1; con.hull = con.hullMax;
    con.x = p.x + Math.cos(ax) * (40 + k * 30) - Math.sin(ax) * 50;
    con.z = p.z - Math.sin(ax) * (40 + k * 30) - Math.cos(ax) * 50;
    if (!g.fleet.includes(con)) g.fleet.push(con);
    cons.push(con);
  }
  g.setFleetOrder('follow', true);
  g.encounterCooling = 9999;                              // the errand, not an ambush
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.hostileToPlayer = false; s.target = null; s.chaseHold = 9999;
  }
  const berth = g.harbourBerth(port);
  g.commandMove(berth.x, berth.z);
  // in through the mouth: give her four minutes of sea time, stop when docked
  let docked = false;
  for (let i = 0; i < 60 * 240 && !docked; i++) {
    g.update(1 / 60);
    if (g.dockablePort && g.dockablePort.id === 'greywake') { g.enterPort(g.dockablePort); docked = true; }
  }
  // the trade itself: the consorts hold station on their own while she haggles
  for (let i = 0; i < 60 * 30; i++) g.update(1 / 60);
  g.leavePort();
  // and out again, well past the arm heads
  g.commandMove(t.x + Math.sin(ax) * 360, t.z + Math.cos(ax) * 360);
  for (let i = 0; i < 60 * 180; i++) g.update(1 / 60);
  const out = {
    docked,
    fleet: cons.map(c => ({ alive: c.alive, hull: +c.hullFrac.toFixed(2) })),
  };
  // stand the staging down so the sections after this inherit a clean sea
  for (const c of cons) {
    const i = g.fleet.indexOf(c);
    if (i >= 0) g.fleet.splice(i, 1);
    c.faction = 'trader'; c.role = 'merchant';
  }
  g.encounterCooling = 0;
  return out;
});
ok(`the flag docked at Greywake through her own mouth (${errand.docked})`, errand.docked);
ok(`and the fleet is afloat and whole after the errand `
  + `(${errand.fleet.map(f => `${f.alive ? 'alive' : 'LOST'} ${Math.round(f.hull * 100)}%`).join(', ')})`,
errand.fleet.length === 2 && errand.fleet.every(f => f.alive && f.hull > 0.8));

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

/* ---------- the harbour works are there to the hull, not only to the eye ----------

   Reported twice with a screenshot: ships sitting on Greywake's left arm in
   the same place. It was never the steering. The arms were stamped into the
   baked height field, which is 384 cells across the whole world — a cell every
   26 metres, against a breakwater block 22 by 26 — so a 21-metre footing wrote
   about one cell and `heightAt` bilinearly smoothed that into a gentle ramp.
   To the route grid, to `clearWater`, to `avoidLand` and to the hull's own
   keel, two hundred metres of League masonry was open water. The works are
   asked directly now, at their real size. */
const walls = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game, T = window.__terrain;
  const port = g.PORTS.find(p => p.id === 'greywake');
  const shore = window.__shore[port.id];
  /* Walk out along both arms the way they are drawn — from the shore search's
     own frame, so this measures the masonry that exists rather than a guess at
     where it is. */
  const bx = shore.x, bz = shore.z;
  const inl = Math.atan2(shore.townX - bx, shore.townZ - bz);
  const ix = Math.sin(inl), iz = Math.cos(inl);
  const px = Math.cos(inl), pz = -Math.sin(inl);
  const at = (side, t) => {
    const out = 46 + t * 200, across = side * (128 - t * 48);
    return { x: bx - ix * out + px * across, z: bz - iz * out + pz * across };
  };
  /* Can a hull cross the arm? Sampling the block centres is not the question —
     the baked field is strongest exactly there, and this check passed with the
     fix reverted because that is where it was looking. What a ship does is
     cross *between* them, so cross between them: a line from forty metres
     outside the arm to forty metres inside it, at the midpoint of every gap. */
  let crossable = 0, tried = 0;
  for (const side of [1, -1]) {
    for (let i = 0; i < 12; i++) {
      const a = at(side, i / 12), b = at(side, (i + 1) / 12);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      // the arm runs along a->b, so cross it at right angles
      const ang = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      const ox = mx + Math.sin(ang) * 40, oz = mz + Math.cos(ang) * 40;
      const nx = mx - Math.sin(ang) * 40, nz = mz - Math.cos(ang) * 40;
      tried++;
      if (R.clearWater(ox, oz, nx, nz, 3.45)) crossable++;   // the player's draft
    }
  }
  return { tried, crossable, mouth: +T.depthAt(bx - ix * 246, bz - iz * 246).toFixed(1) };
});
ok(`Greywake's arms cannot be sailed through (${walls.crossable} of ${walls.tried} `
  + `gaps between blocks let a cutter across)`, walls.crossable === 0);
ok(`and the mouth between them is still water (${walls.mouth}m in the gate)`,
  walls.mouth > 8);

/* And nothing was made unreachable by making them solid — the harbour is a
   refuge, and a refuge every hull can reach is the whole point of one. */
const reach = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game, T = window.__terrain;
  const out = {};
  for (const port of g.PORTS) {
    const bad = [];
    for (const draft of [3.45, 4.6, 7.13, 8.97]) {
      let from = null;
      for (let d = 700; d <= 1300 && !from; d += 100) {
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2;
          const x = port.x + Math.sin(a) * d, z = port.z + Math.cos(a) * d;
          if (T.depthAt(x, z) > 28) { from = { x, z }; break; }
        }
      }
      if (!from) continue;
      const rt = R.findRoute(from.x, from.z, port.x, port.z, g.limit, R.keelFor(draft));
      const end = rt && rt.length ? rt[rt.length - 1] : null;
      /* null means the rhumb line was already clear, which is also reachable.
         The margin is deliberate: `smooth` ends a route in water and leaves
         the last stretch to the hull's own land-avoidance, so a frigate
         fetching Fort Escarra's road at 81m against a 74m dock radius has
         arrived. What this is looking for is the failure that actually
         happened — a port left 400m short and quietly unreachable. */
      const off = end ? Math.hypot(end.x - port.x, end.z - port.z) : 0;
      if (rt !== null && (!end || off > port.dockR + 90)) bad.push(draft + 'm@' + Math.round(off));
    }
    if (bad.length) out[port.id] = bad;
  }
  return out;
});
ok(`every port is still reachable by every hull afloat `
  + `(${Object.keys(reach).length ? JSON.stringify(reach) : 'all five, all four drafts'})`,
  Object.keys(reach).length === 0);


console.log('');
console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
