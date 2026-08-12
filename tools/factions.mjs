/* Two new powers, two new regions, two new ports.

   The Sable League and the Veyra Covenant exist to make the world political
   rather than large, so what this checks is whether they are actually *there*:
   their ships in their own water, their harbours reachable and dockable, their
   yards selling things nobody else sells, their standing moving when you deal
   with them — and an old save, written before either existed, opening without
   complaint.

   Ships are read for construction, not colour. A player who cannot see colour
   still has to be able to tell a League hull from a Covenant one. */
import { launch, sleep, ff, shot, newVoyage, waitFor, dismissModal } from './qa.mjs';

const vp = process.argv[2] || 'desktop';
const { browser, page, errors } = await launch(vp);
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);
await dismissModal(page);

/* ---------------------------------------------------------------
   they exist, and they keep to their own water
   --------------------------------------------------------------- */
await ff(page, 30);
const world = await G(() => {
  const g = window.__game;
  const of = f => g.ships.filter(s => s.faction === f && s.alive);
  const home = { sable: { x: -1450, z: -1280 }, veyra: { x: 1440, z: 1300 } };
  const far = f => of(f).map(s => Math.round(Math.hypot(s.x - home[f].x, s.z - home[f].z)));
  return {
    sable: of('sable').length, veyra: of('veyra').length,
    sableFar: far('sable'), veyraFar: far('veyra'),
    roles: [...new Set(g.ships.map(s => s.role))],
    standing: g.standing,
  };
});
ok(`the League keeps ${world.sable} sail in the Iron Sound (${world.sableFar.join(', ')}m from station)`,
  world.sable > 0 && world.sableFar.every(d => d < 1100));
ok(`the Covenant keeps ${world.veyra} in the Glass Reach (${world.veyraFar.join(', ')}m)`,
  world.veyra > 0 && world.veyraFar.every(d => d < 1200));
ok('and both have standing to gain or lose',
  'sable' in world.standing && 'veyra' in world.standing);

/* ---------------------------------------------------------------
   you can tell them apart without reading the label
   --------------------------------------------------------------- */
const built = await G(() => {
  const g = window.__game;
  const out = {};
  for (const f of ['admiralty', 'sable', 'veyra']) {
    const s = g.ships.find(x => x.faction === f && x.alive);
    if (!s) { out[f] = null; continue; }
    let tris = 0;
    s.mesh.traverse(o => {
      if (o.geometry && o.geometry.attributes.position) {
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    out[f] = { build: s.mesh.userData.build, tris: Math.round(tris), cls: s.classId };
  }
  return out;
});
ok(`the League build heavy and the Covenant build light (${built.sable && built.sable.build} / ${built.veyra && built.veyra.build})`,
  built.sable && built.sable.build === 'heavy' && built.veyra && built.veyra.build === 'light');
/* Construction, not paint: a League hull carries wales, a reinforced bow and a
   signal staff that nothing else has, so she is a different object even before
   anyone looks at her colour. Compared against a plain hull of the same class
   — the ships actually at sea are whatever classes their powers sail, and a
   frigate outweighing a lugger would prove nothing about either yard. */
const weight = await G(() => {
  const tris = m => {
    let t = 0;
    m.traverse(o => {
      if (o.geometry && o.geometry.attributes.position) {
        t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    return Math.round(t);
  };
  return { plain: tris(window.__buildShip('lugger', 'player', { seed: 11 })),
    sable: tris(window.__buildShip('lugger', 'sable', { seed: 11 })) };
});
ok(`and a League hull is more ship than a plain one (${weight.plain} -> ${weight.sable} triangles, same class)`,
  weight.sable > weight.plain * 1.4);
await shot(page, `fx-ships-${vp}`);

/* ---------------------------------------------------------------
   six powers, six ships — not six recolours
   --------------------------------------------------------------- */
const lineup = await G(() => {
  const g = window.__game, p = g.player;
  /* One hull class for all six, so nothing below can be put down to a lugger
     simply being a bigger boat than a cutter. Whatever separates these ships
     is how their yards build. These are meshes, not ships — nothing here
     touches the simulation, it is a photograph of six hulls. */
  const out = {};
  const facs = ['freehold', 'admiralty', 'compact', 'pirate', 'sable', 'veyra'];
  /* Deep water with nothing in it for six hundred metres in every direction:
     the point of the photograph is six hulls, and an island across the frame
     is the one thing guaranteed to be in front of one of them. */
  p.x = -300; p.z = -1250; p.speed = 0; p.dest = null; p.throttle = 0; p.yaw = 0;
  g.encounterCooling = 900;
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.hostileToPlayer = false; s.target = null; s.chaseHold = 900;
    if (Math.hypot(s.x - p.x, s.z - p.z) < 700) { s.x += 1500; s.z += 900; }
  }
  window.__lineupMeshes = [];
  /* Ranged round her rather than in a row: the camera's azimuth is fixed and
     world-locked, so a row laid out along one axis walks off the side of the
     frame. A ring puts every one of them the same distance from the middle. */
  facs.forEach((f, i) => {
    const m = window.__buildShip('lugger', f, { seed: 4242 });
    const a = (i / facs.length) * Math.PI * 2;
    m.position.set(p.x + Math.sin(a) * 44, 0, p.z + Math.cos(a) * 44);
    m.rotation.y = a + Math.PI / 2;
    g.scene.add(m);
    window.__lineupMeshes.push(m);
    let tris = 0;
    m.traverse(o => {
      if (o.geometry && o.geometry.attributes.position) {
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    out[f] = { build: m.userData.build, tris: Math.round(tris) };
  });
  window.__cam.setZoom(185);
  return out;
});
await ff(page, 4);
await shot(page, `fx-lineup-${vp}`);
const builds = Object.values(lineup).filter(Boolean).map(v => v.build);
ok(`each power builds her own way (${builds.join(', ')})`,
  builds.length === 6 && new Set(builds).size === 6);
/* Triangle counts are a crude proxy for "these are different objects", but a
   crude proxy is the point: if two builds produced the same body they would
   land on the same number, and no amount of paint would tell them apart. */
const counts = Object.values(lineup).filter(Boolean).map(v => v.tris);
ok(`and they are different hulls, not the same hull painted (${counts.join(', ')} triangles)`,
  new Set(counts).size === 6 && Math.max(...counts) < 4000);
await G(() => {
  const g = window.__game;
  for (const m of window.__lineupMeshes || []) {
    g.scene.remove(m);
    m.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => x.dispose());
    });
  }
  window.__lineupMeshes = [];
  window.__cam.setZoom(205);
});

/* ---------------------------------------------------------------
   a ship carries what has happened to her
   --------------------------------------------------------------- */
const history = await G(() => {
  const g = window.__game, p = g.player;
  const tris = () => {
    let t = 0;
    p.mesh.traverse(o => {
      if (o.geometry && o.geometry.attributes.position) {
        t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      }
    });
    return Math.round(t);
  };
  const before = { tris: tris(), scars: p.scars, prizes: p.prizes };
  // a scratch is not a scar: the yard tidies her up and she is the same ship
  p.hull = p.hullMax * 0.95; p.sails = p.sailMax;
  g.repair(p);
  const light = { tris: tris(), scars: p.scars };
  // beaten in, three times, is another matter
  for (let i = 0; i < 3; i++) { p.hull = p.hullMax * 0.2; p.sails = p.sailMax * 0.2; g.repair(p); }
  g.save();
  return { before, light, after: { tris: tris(), scars: p.scars }, sameName: p.name };
});
ok(`a touch-up leaves no mark (${history.before.tris} -> ${history.light.tris} triangles, ${history.light.scars} scars)`,
  history.light.scars === 0 && history.light.tris === history.before.tris);
ok(`three hard refits do (${history.light.tris} -> ${history.after.tris} triangles, ${history.after.scars} scars)`,
  history.after.scars === 3 && history.after.tris > history.light.tris);

/* ---------------------------------------------------------------
   the harbours are real places you can reach and use
   --------------------------------------------------------------- */
for (const [id, name] of [['greywake', 'Greywake'], ['tideglass', 'Tideglass']]) {
  const reach = await G(pid => {
    const g = window.__game, p = g.player;
    const port = g.PORTS.find(x => x.id === pid);
    const shore = window.__shore[pid];
    // stand her in the berth the harbour actually offers
    const b = g.harbourBerth(port);
    p.x = b.x; p.z = b.z; p.speed = 0; p.dest = null; p.throttle = 0;
    for (const s of g.ships) {
      if (s.isPlayer || g.fleet.includes(s)) continue;
      s.hostileToPlayer = false; s.target = null; s.chaseHold = 600;
    }
    g.encounterCooling = 600; g.paused = false;
    g.update(0.1);
    return {
      built: !!shore, dist: shore ? Math.round(shore.dist) : -1,
      depth: Math.round(window.__terrain.depthAt(p.x, p.z)),
      landed: window.__terrain.heightAt(shore.x, shore.z) > 0,
      dockable: !!g.dockablePort && g.dockablePort.id === pid,
      faction: port.faction,
    };
  }, id);
  ok(`${name} is built on land, not in open water (waterfront ${reach.dist}m off, berth ${reach.depth}m deep)`,
    reach.built && reach.landed && reach.depth > 6);
  ok(`and you can put into her (${reach.faction})`, reach.dockable);

  // and her yard sells what her people are good at
  const yard = await G(pid => {
    const g = window.__game;
    const port = g.PORTS.find(x => x.id === pid);
    g.enterPort(port);
    const ups = g.upgradesFor(g.player, port).map(u => u.id);
    return { ups, name: port.name };
  }, id);
  const local = { greywake: ['breakwater', 'rudder'], tideglass: ['reefkeel', 'veyrarig'] }[id];
  ok(`${name}'s yard does work nobody else does (${yard.ups.join(', ')})`,
    local.every(u => yard.ups.includes(u)) && yard.ups.includes('copper'));
  await shot(page, `fx-${id}-${vp}`);
  await G(() => { const g = window.__game; g.leavePort(); });
  await page.click('#sheet-close').catch(() => { });
  await sleep(200);
}

/* ---------------------------------------------------------------
   their refits do what they say, and show
   --------------------------------------------------------------- */
const local = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 9000;
  const before = { hull: p.hullMax, turn: p.cls.turn, draft: p.cls.draft, accel: p.cls.accel };
  const gw = g.PORTS.find(x => x.id === 'greywake');
  const tg = g.PORTS.find(x => x.id === 'tideglass');
  for (const [port, id] of [[gw, 'breakwater'], [gw, 'rudder'], [tg, 'reefkeel'], [tg, 'veyrarig']]) {
    const up = g.upgradesFor(p, port).find(u => u.id === id);
    if (up) g.buyUpgrade(p, up);
  }
  return {
    before,
    after: { hull: p.hullMax, turn: p.cls.turn, draft: p.cls.draft, accel: p.cls.accel },
    upgrades: p.upgrades.slice(),
  };
});
ok(`League framing is worth hull (${local.before.hull} -> ${local.after.hull})`, local.after.hull > local.before.hull);
ok(`deep-rudder gear is worth handling (${local.before.turn.toFixed(0)} -> ${local.after.turn.toFixed(0)} deg/s)`,
  local.after.turn > local.before.turn);
ok(`a reef keel is worth draught (${local.before.draft.toFixed(2)} -> ${local.after.draft.toFixed(2)})`,
  local.after.draft < local.before.draft);
ok(`a Covenant rig is worth acceleration (${local.before.accel.toFixed(2)} -> ${local.after.accel.toFixed(2)})`,
  local.after.accel > local.before.accel);

/* ---------------------------------------------------------------
   dealing with them moves standing
   --------------------------------------------------------------- */
const deal = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 4000;
  const out = {};
  for (const [fac, opt] of [['sable', 'dues'], ['veyra', 'chart']]) {
    /* Well clear of their own harbour. Inside the buoys a port is a refuge and
       contact is refused outright — which is the rule working, not a fault,
       but it means an encounter has to be staged out in the open. */
    p.x = fac === 'sable' ? -1450 : 1440; p.z = fac === 'sable' ? -1720 : 1720;
    p.speed = 0; p.dest = null;
    let s = g.ships.find(x => x.faction === fac && x.alive);
    for (let i = 0; i < 12 && !s; i++) s = g.spawnNPC(fac);
    if (!s) { out[fac] = 'no ship'; continue; }
    s.x = p.x + 40; s.z = p.z; s.hostileToPlayer = true; s.target = p; s.chaseHold = 0;
    g.encounterCooling = 0;
    for (let i = 0; i < 60 && g.mode === 'campaign'; i++) g.update(0.2);
    if (g.mode !== 'encounter') { out[fac] = 'no encounter: ' + g.mode; continue; }
    const has = g.encounter.options.some(o => o.id === opt);
    const was = g.standing[fac];
    const r = g.chooseEncounter(opt);
    out[fac] = { has, was, now: g.standing[fac], went: r && r.went, cost: r && r.cost };
    if (g.mode !== 'campaign') g.closeEncounter();
    g.paused = false;
  }
  return out;
});
ok(`the League charge for their water and remember who paid (${JSON.stringify(deal.sable)})`,
  deal.sable && deal.sable.has && deal.sable.went === 'away' && deal.sable.now > deal.sable.was);
ok(`the Covenant sell the passage and think better of you for it (${JSON.stringify(deal.veyra)})`,
  deal.veyra && deal.veyra.has && deal.veyra.went === 'away' && deal.veyra.now > deal.veyra.was);

/* ---------------------------------------------------------------
   a voyage that predates both of them still opens
   --------------------------------------------------------------- */
const old = await G(() => {
  // a save written before these factions existed: no standing for them at all
  const raw = JSON.parse(localStorage.getItem('salt-and-tally-v1'));
  raw.standing = { freehold: 4, admiralty: 1, compact: 0 };
  for (const sh of raw.fleet) delete sh.builtBy;
  localStorage.setItem('salt-and-tally-v1', JSON.stringify(raw));
  return true;
});
void old;
await page.reload({ waitUntil: 'networkidle' });
await waitFor(page, () => !document.getElementById('btn-continue').classList.contains('hidden'), 9000);
await page.click('#btn-continue');
await waitFor(page, () => !!window.__game && !!window.__game.player
  && document.getElementById('title').classList.contains('hidden'), 9000);
const opened = await G(() => {
  const g = window.__game;
  return {
    alive: !!g.player && g.player.alive,
    standing: g.standing,
    ships: g.ships.length,
    builtBy: g.player.builtBy,
    scars: g.player.scars,
  };
});
ok(`a save from before these powers existed opens without complaint (${JSON.stringify(opened.standing)})`,
  opened.alive && opened.ships > 2);
ok('and it simply has two more powers in it than it did',
  opened.standing.sable === 0 && opened.standing.veyra === 0);
ok('a ship with no recorded builder falls back to her own colours', !!opened.builtBy);
ok(`and what she has been through comes back with her (${opened.scars} scars)`, opened.scars === 3);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
