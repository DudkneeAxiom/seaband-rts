/* ===========================================================
   Autonomous captains. Small state machines — merchants run
   cargo, fishers work the banks, the Tally hunt the weak, and
   Admiralty patrols hunt the Tally. None of it needs the player.
   =========================================================== */
import { PORTS, EDGE_NODES, FISH_GROUNDS, FACTIONS } from '../data/gamedata.js';
import { clamp, clamp01, angDiff, dist, TAU } from '../core/util.js';
import { depthAt } from '../world/terrain.js';
import { fireBroadside, bestSide, GUN_RANGE, canBoard } from '../combat/combat.js';
import { crewPower } from './ship.js';

const nodePos = id => EDGE_NODES[id] || PORTS.find(p => p.id === id);

export function isHostile(a, b) {
  if (!a || !b) return false;
  if (a.faction === b.faction) return false;
  const fa = FACTIONS[a.faction], fb = FACTIONS[b.faction];
  if (!fa || !fb) return false;
  if (a.isPlayer || a.faction === 'player') return !!(b.faction === 'pirate' || b.hostileToPlayer);
  if (b.isPlayer || b.faction === 'player') return !!(fa.hostileTo.includes('player') || a.hostileToPlayer);
  return !!(fa.hostileTo.includes(b.faction) || fb.hostileTo.includes(a.faction));
}

/** Rough combat weight — the number captains actually judge each other by.
    A fat merchant with six guns and nobody trained to serve them is not
    the same proposition as a lean privateer with the same battery. */
export function strength(s) {
  const battery = (s.gunsPort + s.gunsStb) * 8.5 * s.crewSkill('gun');
  const hands = crewPower(s.crew, 'fight') * 2.2;
  return battery + hands + s.hull * 0.10;
}

/* ---------- helpers ---------- */
function avoidLand(ship, wantAng, dt) {
  const probe = 42 + ship.speed * 3.2;
  const need = ship.draft * 1.9 + 3;
  const at = (a, d) => depthAt(ship.x + Math.sin(a) * d, ship.z + Math.cos(a) * d);
  const c = at(wantAng, probe);
  if (c > need) return wantAng;
  const l = at(wantAng - 0.75, probe), r = at(wantAng + 0.75, probe);
  const l2 = at(wantAng - 1.5, probe * 0.8), r2 = at(wantAng + 1.5, probe * 0.8);
  const best = Math.max(l, r, l2, r2);
  if (best <= need * 0.7) return wantAng + Math.PI * (Math.random() > 0.5 ? 0.5 : -0.5);
  if (best === l) return wantAng - 0.75;
  if (best === r) return wantAng + 0.75;
  if (best === l2) return wantAng - 1.5;
  return wantAng + 1.5;
  void dt;
}

/* The wind this tick, cached at the top of updateAI so fifteen steerTo call
   sites do not each have to carry the world on their backs. */
let WIND = 0;

/** A mark inside the no-go cone cannot be steered at. An NPC captain has no
    tack state to beat with, so she lays the near edge of the cone and holds
    it — the mark drifts out of the cone as she goes, and one long board with
    a fetch at the end looks like a captain who knows her trade. Holding the
    plain bearing looked like a ship becalmed in open water. */
function layToWind(ship, want) {
  const eye = WIND + Math.PI;
  const off = angDiff(eye, want);
  if (Math.abs(off) >= 0.82) return want;
  const side = off !== 0 ? Math.sign(off) : (ship.id % 2 ? 1 : -1);
  return eye + 0.82 * side;
}

function steerTo(ship, x, z, dt) {
  const want = Math.atan2(x - ship.x, z - ship.z);
  const safe = avoidLand(ship, layToWind(ship, want), dt);
  ship.headingCmd = safe;
  ship.dest = null;
  ship.throttle = 1;
}

/** Station-keeping off the target's beam: the classic circling gun duel. */
function combatSteer(ship, target, dt, range = 120) {
  const dx = target.x - ship.x, dz = target.z - ship.z;
  const d = Math.hypot(dx, dz) || 1;
  const bearing = Math.atan2(dx, dz);
  const side = ship.reload.stb <= ship.reload.port ? 1 : -1;
  // aim for a point abeam of the target so our battery bears
  const want = range;
  let ang;
  if (d > want * 1.45) ang = bearing;                        // close the range
  else if (d < want * 0.55) ang = bearing + Math.PI * 0.62 * side; // sheer off
  else ang = bearing + (Math.PI / 2) * side * clamp(want / d, 0.7, 1.25);
  ship.headingCmd = avoidLand(ship, ang, dt);
  ship.dest = null;
  ship.throttle = 1;
}

/** Sails under the player's colours — her own ship or one of her consorts. */
function underYourFlag(s) { return !!s && (s.isPlayer || s.faction === 'player'); }

function tryFire(ship, target, ctx, arc = 62) {
  if (!target || !target.alive || target.captured) return;
  /* The campaign layer is not a gunfight. A raider who has run you down does
     not open fire on the open sea — she makes contact, the world stops, and
     the encounter decides whether there is a battle at all. Ships still shoot
     at each other out there, because that world carries on without you.

     Both ends of it, not one. This used to ask only whether the *target* was
     yours, which protected your ships from being fired on and said nothing
     about yours doing the firing — so a consort under ENGAGE opened up on a
     marked enemy out on the open sea and started the action before the
     encounter had asked whether you wanted one. Your flag does not fire
     outside an action, and nothing fires at it. */
  if (!ctx.combatLive && (underYourFlag(target) || underYourFlag(ship))) return;
  const d = dist(ship.x, ship.z, target.x, target.z);
  if (d > GUN_RANGE) return;
  const side = bestSide(ship, target, arc);
  if (side && ship.reload[side] <= 0) {
    // pick shot: cripple runners, sweep boarders, else smash hulls
    if (target.speed > ship.speed * 0.95 && target.sailFrac > 0.5) ship.ammo = 'chain';
    else if (d < 55) ship.ammo = 'grape';
    else ship.ammo = 'round';
    fireBroadside(ship, side, target, ctx);
  }
}

/* ---------- harbours are refuges ----------
   Every port here sits under somebody's guns. A raider that follows a prize
   into the roads is picking a fight with the shore, and none of them want
   that — so the approaches are the one place a beaten captain can run to.
   This is also what makes DOCK reachable when you are being chased. */
/* Roughly two and a half times the harbour itself: wide enough that a chased
   captain is safe once the buoys are in sight, tight enough that it does not
   sterilise the sea around every port. */
export const GUARD_R = 190;
export function portGuarding(x, z) {
  for (const p of PORTS) {
    if (dist(x, z, p.x, p.z) < GUARD_R + (p.size === 'major' ? 60 : 0)) return p;
  }
  return null;
}
/** Turn a hunter away from guarded water. Returns true if it sheered off.
    Somebody already shooting at her is a different matter — she will finish
    that where she stands. This only stops cold pursuit into a harbour. */
function sheerOffFromPort(ship, dt) {
  if (ship.aggro > 0) return false;
  const guard = portGuarding(ship.x, ship.z);
  if (!guard) return false;
  const away = Math.atan2(ship.x - guard.x, ship.z - guard.z);
  ship.headingCmd = avoidLand(ship, away, dt);
  ship.dest = null;
  ship.throttle = 1;
  ship.target = null;
  ship.brain.state = 'sheer';
  return true;
}

function nearestPort(ship, factionOK) {
  let best = null, bd = 1e9;
  for (const p of PORTS) {
    if (factionOK && !factionOK(p)) continue;
    const d = dist(ship.x, ship.z, p.x, p.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** How far a raider looks for prey. */
const PREY_RANGE = 820;
/** The Tally are bold, not suicidal: they want the odds on their side. */
const PREY_ODDS = 0.95;

function findPrey(ship, ships) {
  let best = null, bs = -1;
  const myStr = strength(ship);
  for (const o of ships) {
    if (o === ship || !o.alive || o.captured) continue;
    if (!isHostile(ship, o) && !(ship.role === 'pirate' && o.faction !== 'pirate')) continue;
    const d = dist(ship.x, ship.z, o.x, o.z);
    if (d > PREY_RANGE) continue;
    if (portGuarding(o.x, o.z)) continue;      // she is under the shore batteries
    const ratio = myStr / (strength(o) + 1);
    if (ratio < PREY_ODDS) continue;
    const score = ratio * 100 - d * 0.25 + (o.cargoUsed > 8 ? 40 : 0) + (o.isPlayer ? 25 : 0);
    if (score > bs) { bs = score; best = o; }
  }
  return best;
}
function findEnemy(ship, ships, maxD = 760) {
  let best = null, bd = maxD;
  for (const o of ships) {
    if (o === ship || !o.alive || o.captured) continue;
    if (!isHostile(ship, o)) continue;
    const d = dist(ship.x, ship.z, o.x, o.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/* ---------------- main tick ---------------- */
export function updateAI(ship, dt, world, ctx) {
  if (!ship.alive || ship.captured || ship.isPlayer) return;
  if (ship.boarding) return;
  WIND = world.windAng;
  const b = ship.brain;
  b.t += dt;
  if (b.cooldown > 0) b.cooldown -= dt;
  /* Beaten off, or shaken off. She keeps her distance for a while rather than
     wearing round and handing you the same encounter ten seconds later. */
  if (ship.chaseHold > 0) {
    ship.chaseHold -= dt;
    ship.target = null;
    const p = world.player;
    if (p) {
      const away = Math.atan2(ship.x - p.x, ship.z - p.z);
      if (dist(ship.x, ship.z, p.x, p.z) < 620) {
        ship.headingCmd = avoidLandPublic(ship, away);
        ship.throttle = 1;
        return;
      }
    }
  }
  /* Broken off inside a battle: get to the edge of the action and out. */
  if (ship.fleeing) {
    const p = world.player;
    const away = p ? Math.atan2(ship.x - p.x, ship.z - p.z) : world.windAng;
    ship.headingCmd = avoidLandPublic(ship, away);
    ship.throttle = 1;
    ship.target = null;
    return;
  }

  const hurt = ship.hullFrac < 0.34 || (ship.crewTotal <= ship.cls.crewMin * 0.55);
  const crippled = ship.sailFrac < 0.22;

  // anyone who is being shot at answers, whatever their day job was
  if (ship.aggro > 0 && ship.lastAttacker && ship.lastAttacker.alive && !ship.lastAttacker.captured) {
    if ((ship.role === 'pirate' || ship.role === 'patrol') && !ship.target) ship.target = ship.lastAttacker;
    if (ship.lastAttacker.isPlayer || ship.lastAttacker.faction === 'player') ship.hostileToPlayer = true;
  }

  switch (ship.role) {
    case 'merchant': merchantAI(ship, dt, world, ctx, hurt); break;
    case 'fisher': fisherAI(ship, dt, world, ctx, hurt); break;
    case 'pirate': pirateAI(ship, dt, world, ctx, hurt, crippled); break;
    case 'patrol': patrolAI(ship, dt, world, ctx, hurt); break;
    case 'sable': sableAI(ship, dt, world, ctx, hurt); break;
    case 'veyra': veyraAI(ship, dt, world, ctx, hurt); break;
    case 'consort': consortAI(ship, dt, world, ctx); break;
    default: idleAI(ship, dt, world);
  }
}

/* ---------- merchant ---------- */
function merchantAI(ship, dt, world, ctx, hurt) {
  const b = ship.brain;
  const threat = nearestThreat(ship, world.ships, 420);
  if (threat) {
    b.state = 'flee';
    b.flee = 6;
    // run downwind, away from the threat
    // she can be hurt with nothing in sight — run downwind then, not at a ghost
    const away = threat
      ? Math.atan2(ship.x - threat.x, ship.z - threat.z)
      : world.windAng + Math.PI;
    const dw = world.windAng;
    const use = Math.abs(angDiff(away, dw)) < 1.5 ? dw : away;
    ship.headingCmd = avoidLandPublic(ship, use);
    ship.throttle = 1;
    // stern chaser spite
    tryFire(ship, threat, ctx, 66);
    return;
  }
  if (b.flee > 0) { b.flee -= dt; return; }
  if (!b.route) newTradeRoute(ship);
  runRoute(ship, dt, world, ctx);
  void hurt;
}
function nearestThreat(ship, ships, range) {
  let best = null, bd = range;
  for (const o of ships) {
    if (o === ship || !o.alive || o.captured) continue;
    const hostile = isHostile(ship, o) || (o.faction === 'pirate')
      || (ship.aggro > 0 && ship.lastAttacker === o);
    if (!hostile) continue;
    if (strength(o) < strength(ship) * 0.75) continue;
    const d = dist(ship.x, ship.z, o.x, o.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function avoidLandPublic(ship, a) { return avoidLand(ship, a, 0.016); }

function newTradeRoute(ship) {
  const ids = [...PORTS.map(p => p.id), 'edge_w', 'edge_n', 'edge_e', 'edge_s'];
  const from = ids[(Math.random() * ids.length) | 0];
  let to = ids[(Math.random() * ids.length) | 0];
  let g = 0;
  while (to === from && g++ < 6) to = ids[(Math.random() * ids.length) | 0];
  ship.brain.route = [from, to];
  ship.brain.wp = 0;
}
function runRoute(ship, dt, world, ctx) {
  const b = ship.brain;
  const dest = nodePos(b.route[b.wp % 2 === 0 ? 1 : 1]);
  const node = nodePos(b.route[1]);
  const p = node || dest;
  if (!p) { newTradeRoute(ship); return; }
  const d = dist(ship.x, ship.z, p.x, p.z);
  if (d < (p.dockR ? p.dockR + 30 : 120)) {
    if (p.id && world.market) world.market.merchantArrived(p.id);
    if (ctx && ctx.onArrive) ctx.onArrive(ship, p);
    b.route = [b.route[1], pickFarNode(b.route[1])];
    return;
  }
  steerTo(ship, p.x, p.z, dt);
}
function pickFarNode(fromId) {
  const ids = [...PORTS.map(p => p.id), 'edge_w', 'edge_n', 'edge_e', 'edge_s'];
  let to = ids[(Math.random() * ids.length) | 0], g = 0;
  while (to === fromId && g++ < 6) to = ids[(Math.random() * ids.length) | 0];
  return to;
}

/* ---------- fisher ---------- */
function fisherAI(ship, dt, world, ctx) {
  const b = ship.brain;
  const threat = nearestThreat(ship, world.ships, 300);
  if (threat) {
    // she can be hurt with nothing in sight — run downwind then, not at a ghost
    const away = threat
      ? Math.atan2(ship.x - threat.x, ship.z - threat.z)
      : world.windAng + Math.PI;
    ship.headingCmd = avoidLandPublic(ship, away);
    ship.throttle = 1;
    return;
  }
  if (!b.home) b.home = nearestPort(ship);
  if (!b.ground) b.ground = FISH_GROUNDS[(Math.random() * FISH_GROUNDS.length) | 0];
  if (b.state === 'idle' || !b.state) b.state = 'out';

  if (b.state === 'out') {
    const d = dist(ship.x, ship.z, b.ground.x, b.ground.z);
    if (d < 60) { b.state = 'work'; b.workT = 22 + Math.random() * 30; }
    else steerTo(ship, b.ground.x, b.ground.z, dt);
  } else if (b.state === 'work') {
    b.workT -= dt;
    ship.throttle = 0.22;
    ship.headingCmd = (ship.headingCmd ?? ship.yaw) + dt * 0.10;
    if (b.workT <= 0) { b.state = 'home'; ship.cargo.fish = (ship.cargo.fish || 0) + 6; }
  } else {
    const h = b.home;
    const d = dist(ship.x, ship.z, h.x, h.z);
    if (d < h.dockR + 25) {
      b.state = 'out';
      b.ground = FISH_GROUNDS[(Math.random() * FISH_GROUNDS.length) | 0];
      ship.cargo.fish = 0;
      if (world.market) world.market.addStock(h.id, 'fish', 8);
    } else steerTo(ship, h.x, h.z, dt);
  }
  void ctx;
}

/* ---------- pirate ---------- */
function pirateAI(ship, dt, world, ctx, hurt, crippled) {
  const b = ship.brain;
  // no Tally captain follows a chase in under a fort's guns
  if (sheerOffFromPort(ship, dt)) return;
  if (hurt || crippled) {
    b.state = 'flee';
    const t = ship.target || nearestThreat(ship, world.ships, 600);
    const away = t ? Math.atan2(ship.x - t.x, ship.z - t.z) : world.windAng;
    ship.headingCmd = avoidLandPublic(ship, away);
    ship.throttle = 1;
    ship.target = null;
    if (t) tryFire(ship, t, ctx, 70);
    return;
  }
  if (!ship.target || !ship.target.alive || ship.target.captured) {
    if (b.cooldown <= 0) { ship.target = findPrey(ship, world.ships); b.cooldown = 1.2; }
  }
  const t = ship.target;
  if (t) {
    const d = dist(ship.x, ship.z, t.x, t.z);
    if (d > 900) { ship.target = null; return; }
    b.state = 'hunt';
    /* Standing off at gun range is a gunnery station, and on the campaign
       layer there are no guns to station for — she would sit at a hundred
       yards for ever and the chase would never resolve. Against the player
       out there she closes to touching distance, which is what makes contact
       an event. Inside a battle she works the beam as before. */
    const runDown = !ctx.combatLive && (t.isPlayer || t.faction === 'player');
    if (runDown || d > GUN_RANGE * 1.1) steerTo(ship, t.x, t.z, dt);
    else combatSteer(ship, t, dt, 105);
    tryFire(ship, t, ctx, 62);
    // board weak prize
    if (!underYourFlag(t) && !underYourFlag(ship)
      && canBoard(ship, t) && t.crewTotal < ship.crewTotal * 0.75 && ctx.startBoarding) {
      ctx.startBoarding(ship, t);
    }
    return;
  }
  // patrol dangerous water
  if (!b.wpPos || dist(ship.x, ship.z, b.wpPos.x, b.wpPos.z) < 90) {
    const a = Math.random() * TAU, r = 500 + Math.random() * 900;
    b.wpPos = { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
  steerTo(ship, b.wpPos.x, b.wpPos.z, dt);
}

/* ---------- Sable League: hold the water, do not chase it ----------
   Their whole argument is that controlling where ships can stop controls the
   sea, so their captains behave like it. A Sable brig works a station, closes
   on anything hostile inside it, and turns back the moment the chase would
   take her away from what she is guarding. She will not follow you across the
   Shoals; she does not have to. */
const SABLE_STATION = { x: -1450, z: -1280 };
const SABLE_REACH = 900;

function sableAI(ship, dt, world, ctx, hurt) {
  const b = ship.brain;
  if (!b.post) {
    // each of them keeps a different gate of the Sound
    const a = (ship.name.length * 1.7) % TAU;
    b.post = { x: SABLE_STATION.x + Math.cos(a) * 380, z: SABLE_STATION.z + Math.sin(a) * 380 };
  }
  const fromPost = dist(ship.x, ship.z, b.post.x, b.post.z);

  if (hurt) {                                  // damaged ships go home to the yard
    const home = nearestPort(ship, p => p.faction === 'sable') || nearestPort(ship);
    steerTo(ship, home.x, home.z, dt);
    ship.target = null;
    return;
  }

  if (!ship.target || !ship.target.alive || ship.target.captured) {
    if (b.cooldown <= 0) { ship.target = findEnemy(ship, world.ships, 640); b.cooldown = 1.2; }
  }
  const t = ship.target;
  if (t) {
    // she breaks off rather than be drawn off station
    const theirFromPost = dist(t.x, t.z, b.post.x, b.post.z);
    if (theirFromPost > SABLE_REACH || fromPost > SABLE_REACH) { ship.target = null; }
    else {
      const d = dist(ship.x, ship.z, t.x, t.z);
      if (d > GUN_RANGE || (!ctx.combatLive && (t.isPlayer || t.faction === 'player'))) steerTo(ship, t.x, t.z, dt);
      else combatSteer(ship, t, dt, 118);
      tryFire(ship, t, ctx, 62);
      return;
    }
  }
  // back to the gate, and hold it
  if (fromPost > 120) steerTo(ship, b.post.x, b.post.z, dt);
  else { ship.throttle = 0.22; ship.headingCmd = avoidLandPublic(ship, ship.yaw + dt * 0.25); }
}

/* ---------- Veyra Covenant: knowledge of the water, used ----------
   They do not fight things they can outsail. Threatened, a Veyra captain runs
   for water too thin for whatever is chasing her — which is the faction's
   identity taught by watching it happen rather than by reading a blurb. */
function veyraAI(ship, dt, world, ctx, hurt) {
  const b = ship.brain;
  const threat = nearestThreat(ship, world.ships, 520);
  if (threat || hurt) {
    b.state = 'flee';
    /* Not simply downwind: toward the shallowest water she can find that she
       still floats in. A deeper hull following her into it grounds. */
    // she can be hurt with nothing in sight — run downwind then, not at a ghost
    const away = threat
      ? Math.atan2(ship.x - threat.x, ship.z - threat.z)
      : world.windAng + Math.PI;
    let best = away, bestScore = -1e9;
    for (let i = 0; i < 9; i++) {
      const a = away + (i - 4) * 0.34;
      const px = ship.x + Math.sin(a) * 320, pz = ship.z + Math.cos(a) * 320;
      const d = depthAt(px, pz);
      if (d < ship.draft * 3.2 + 3) continue;         // she has to float too
      // thin water is worth more the deeper the thing behind her draws
      const thin = threat ? clamp(1 - (d - 12) / 40, 0, 1) : 0;
      const score = thin * 60 - Math.abs(i - 4) * 3;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    ship.headingCmd = avoidLandPublic(ship, best);
    ship.throttle = 1;
    ship.target = null;
    return;
  }
  // otherwise she is going somewhere, by a route she knows
  if (!b.wpPos || dist(ship.x, ship.z, b.wpPos.x, b.wpPos.z) < 110) {
    const a = Math.random() * TAU, r = 260 + Math.random() * 620;
    b.wpPos = { x: 1440 + Math.cos(a) * r, z: 1300 + Math.sin(a) * r };
  }
  steerTo(ship, b.wpPos.x, b.wpPos.z, dt);
  void ctx;
}

/* ---------- patrol ---------- */
function patrolAI(ship, dt, world, ctx, hurt) {
  const b = ship.brain;
  if (hurt) {
    const home = nearestPort(ship, p => p.faction === ship.faction) || nearestPort(ship);
    steerTo(ship, home.x, home.z, dt);
    ship.target = null;
    return;
  }
  if (!ship.target || !ship.target.alive || ship.target.captured) {
    if (b.cooldown <= 0) { ship.target = findEnemy(ship, world.ships, 780); b.cooldown = 1.0; }
  }
  const t = ship.target;
  if (t) {
    const d = dist(ship.x, ship.z, t.x, t.z);
    if (d > 1100) { ship.target = null; return; }
    // same as the raider: an interception on the campaign layer is physical
    if (d > GUN_RANGE || (!ctx.combatLive && (t.isPlayer || t.faction === 'player'))) steerTo(ship, t.x, t.z, dt);
    else combatSteer(ship, t, dt, 115);
    tryFire(ship, t, ctx, 62);
    if (ctx.combatLive && canBoard(ship, t) && t.crewTotal < ship.crewTotal * 0.6 && ctx.startBoarding) {
      ctx.startBoarding(ship, t);
    }
    return;
  }
  if (!b.wpPos || dist(ship.x, ship.z, b.wpPos.x, b.wpPos.z) < 110) {
    const home = nearestPort(ship, p => p.faction === ship.faction);
    const a = Math.random() * TAU, r = 380 + Math.random() * 620;
    const cx = home ? home.x : 0, cz = home ? home.z : 0;
    b.wpPos = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  }
  steerTo(ship, b.wpPos.x, b.wpPos.z, dt);
}

/* ---------- consorts under the player's flag ---------- */
function consortAI(ship, dt, world, ctx) {
  const flag = world.player;
  if (!flag) return;
  const order = ship.fleetOrder || 'follow';

  if (order === 'hold') {
    ship.throttle = 0.12;
    const e = findEnemy(ship, world.ships, GUN_RANGE);
    if (e) tryFire(ship, e, ctx, 62);
    return;
  }
  if (order === 'engage') {
    let t = world.playerTarget && world.playerTarget.alive && !world.playerTarget.captured ? world.playerTarget : null;
    if (!t) t = findEnemy(ship, world.ships, 900);
    if (t) {
      const d = dist(ship.x, ship.z, t.x, t.z);
      if (d > GUN_RANGE * 1.05) steerTo(ship, t.x, t.z, dt);
      else combatSteer(ship, t, dt, 110);
      tryFire(ship, t, ctx, 62);
        /* Grapples are the action too. A consort that cannot fire out here must
         not simply climb aboard instead. */
      if (ctx.combatLive && canBoard(ship, t) && t.crewTotal < ship.crewTotal * 0.7 && ctx.startBoarding) {
        ctx.startBoarding(ship, t);
      }
      return;
    }
  }
  // follow in echelon off the flagship's quarter
  const slot = ship.formSlot || 1;
  const back = 46 + slot * 26, side = (slot % 2 ? 1 : -1) * (34 + slot * 8);
  const fx = flag.x - Math.sin(flag.yaw) * back + Math.cos(flag.yaw) * side;
  const fz = flag.z - Math.cos(flag.yaw) * back - Math.sin(flag.yaw) * side;
  const d = dist(ship.x, ship.z, fx, fz);
  steerTo(ship, fx, fz, dt);
  // press on harder the further astern she is, so a slower hull can still keep station
  ship.throttle = clamp01(d / 60) * 0.65 + 0.35 + clamp01((d - 80) / 140) * 0.95;
  if (d < 22) ship.throttle = 0.25;
  // consorts fire at anything hostile that wanders into the arc
  const e = findEnemy(ship, world.ships, GUN_RANGE);
  if (e) tryFire(ship, e, ctx, 55);
}

function idleAI(ship, dt) {
  ship.throttle = 0.15;
  void dt;
}

export { combatSteer, steerTo, tryFire, nearestThreat, findEnemy };
