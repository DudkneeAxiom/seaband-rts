/* ===========================================================
   Battle — the instance a fleet action happens inside.

   It is fought on the water where the two fleets actually met. That is a
   deliberate choice over building a separate arena scene: the reef you were
   running for is still under you, the harbour you were making for is still
   over there, and nothing has to be copied, rebuilt or disposed to make it
   so. What a battle does is narrow the world down — everyone not in this
   fight is benched — and put the two sides where the chase left them.

   Ownership: the Game owns the campaign, a Battle owns the fight. While one
   exists, `game.mode === 'battle'` and this object decides when it ends.
   =========================================================== */
import { dist } from '../core/util.js';
import { depthAt } from '../world/terrain.js';
import { portGuarding } from '../ships/ai.js';

/** How far from the middle of the action you have to get to be out of it. */
export const ARENA_R = 640;
/** No slipping away with a hostile this close aboard. */
const BREAK_OFF_R = 165;

/**
 * What kind of water this is being fought over.
 *
 * Read off the campaign position, so the answer is the truth about that
 * place rather than a label chosen for variety.
 */
export function arenaKind(x, z) {
  if (portGuarding(x, z)) return { id: 'port', name: 'Under the guns of a harbour' };
  const d = depthAt(x, z);
  if (d < 14) return { id: 'reef', name: 'Reef water' };
  // land close on one side makes a coast; sample a ring to find out
  let shallow = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (depthAt(x + Math.cos(a) * 320, z + Math.sin(a) * 320) < 10) shallow++;
  }
  if (shallow >= 4) return { id: 'channel', name: 'A narrow channel' };
  if (shallow >= 1) return { id: 'coast', name: 'Coastal water' };
  return { id: 'open', name: 'Open sea' };
}

export class Battle {
  constructor(game, enc) {
    this.game = game;
    this.enc = enc;
    this.x = enc.x; this.z = enc.z;
    this.kind = arenaKind(enc.x, enc.z);
    this.allies = enc.allies.filter(s => s.alive);
    this.enemies = enc.enemies.filter(s => s.alive && !s.captured);
    /** Everyone who started on their side, for counting up afterwards. */
    this.startEnemies = [...this.enemies];
    this.objective = 'destroy';
    this.t = 0;
    this.over = false;
    this.result = null;
    this.benched = [];
    this.prizes = [];
    this.startCrew = game.player.crewTotal;
    this.startHull = game.player.hull;
    this.escapeArmed = false;
  }

  /* ---------------------------------------------------------------
     Setting the board
     --------------------------------------------------------------- */

  begin() {
    const g = this.game, enc = this.enc;

    /* Bench the world. Splice rather than reassign: Projectiles and the AI
       world object both hold a reference to this exact array, and swapping it
       out from under them would leave shells colliding with a fleet that is
       no longer in the fight. */
    const fighting = new Set([...this.allies, ...this.enemies]);
    for (let i = g.ships.length - 1; i >= 0; i--) {
      const s = g.ships[i];
      if (fighting.has(s)) continue;
      s.mesh.visible = false;
      this.benched.push(s);
      g.ships.splice(i, 1);
    }

    /* Where the campaign left everybody. The line of battle runs along the
       bearing the two fleets closed on, and the wind decides which end is
       which — the ship with the weather gauge starts upwind, because that is
       what having it means. */
    const gap = enc.fledAndFailed ? 130 : enc.how === 'intercepted' ? 175 : 225;

    // the windward end of the axis
    const up = g.windAng;
    const alliesUpwind = enc.gauge === 'you';
    const mineAng = alliesUpwind ? up : up + Math.PI;
    const theirsAng = alliesUpwind ? up + Math.PI : up;

    this.deploy(this.allies, mineAng, gap * 0.5, theirsAng);
    this.deploy(this.enemies, theirsAng, gap * 0.5, mineAng);

    /* If they ran you down, they are astern and already coming. */
    if (enc.fledAndFailed) {
      for (const s of this.enemies) { s.throttle = 1; s.speed = s.cls.speed * 0.55; }
    }

    for (const s of this.enemies) {
      s.hostileToPlayer = true;
      s.aggro = 40;
      s.target = g.player;
      s.brain = { state: 'attack', t: 0, cooldown: 0 };
      s.fleeing = false;
    }
    // consorts fight unless the captain has said otherwise
    if (g.fleetOrder === 'follow') g.setFleetOrder('engage', true);
    for (const s of this.allies) if (!s.isPlayer) s.target = this.enemies[0] || null;

    g.target = this.enemies[0] || null;
    g.combatHeat = 20;
  }

  /** Lay a side out abeam of the enemy, in a loose line, facing the fight. */
  deploy(ships, fromAng, back, faceAng) {
    const cx = this.x + Math.sin(fromAng) * back;
    const cz = this.z + Math.cos(fromAng) * back;
    const across = fromAng + Math.PI / 2;
    const heading = faceAng;
    ships.forEach((s, i) => {
      const off = (i - (ships.length - 1) / 2) * (s.cls.len * 2.6 + 26);
      let x = cx + Math.sin(across) * off;
      let z = cz + Math.cos(across) * off;
      // never deploy a hull onto the putty; walk her out to water she floats in
      for (let g = 0; g < 12 && depthAt(x, z) < s.draft * 3 + 4; g++) {
        x += Math.sin(heading) * 18; z += Math.cos(heading) * 18;
      }
      s.x = x; s.z = z;
      s.yaw = heading + (Math.random() - 0.5) * 0.25;
      s.dest = null; s.headingCmd = null;
      s.speed = Math.max(s.speed, s.cls.speed * 0.3);
      s.throttle = 1;
    });
  }

  /* ---------------------------------------------------------------
     Running
     --------------------------------------------------------------- */

  update(dt) {
    if (this.over) return;
    this.t += dt;
    const g = this.game, p = g.player;

    this.allies = this.allies.filter(s => s.alive && !s.captured);
    this.enemies = this.enemies.filter(s => s.alive && !s.captured);

    if (!p.alive) { this.finish('lost'); return; }

    /* A prize taken mid-action changes sides on the spot: she is out of the
       enemy list the moment her colours come down, which is what lets a
       three-to-one fight become winnable if you board the right ship. */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const s = this.enemies[i];
      if (s.faction === 'player' || g.fleet.includes(s)) {
        this.enemies.splice(i, 1);
        if (!this.allies.includes(s)) this.allies.push(s);
      }
    }

    /* And anyone who has simply left. A ship that is no longer anywhere near
       this water is not in this action, whether she broke off, was driven off
       or was moved. Without this the fight has no way to end while she is
       alive and elsewhere — which is a battle that never closes, a campaign
       that never comes back, and a save that refuses for ever. */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (dist(this.enemies[i].x, this.enemies[i].z, this.x, this.z) > ARENA_R * 1.5) {
        this.enemies[i].fleeing = false;
        this.enemies.splice(i, 1);
      }
    }

    if (!this.enemies.length) { this.finish(this.startEnemies.some(s => !s.alive || s.captured) ? 'won' : 'routed'); return; }

    // getting clear: outside the arena, with nobody close aboard
    const d = dist(p.x, p.z, this.x, this.z);
    const nearest = Math.min(...this.enemies.map(s => dist(s.x, s.z, p.x, p.z)));
    this.escapeArmed = nearest > BREAK_OFF_R && !p.boarding;
    this.escapeDist = Math.max(0, ARENA_R - d);
    if (d > ARENA_R && this.escapeArmed) { this.finish('fled'); return; }

    /* The enemy can break too. A raider who has lost her rigging and half her
       people is not obliged to die for it — she strikes or she runs, and if
       every one of them has run, the action is over and you hold the water. */
    let running = 0;
    for (const s of this.enemies) {
      const beaten = s.hullFrac < 0.3 || s.crewTotal <= s.cls.crewMin;
      if (beaten) s.fleeing = true;
      /* Out of the action is measured from you, not from the middle of it.
         Waiting for a beaten ship to crawl the whole arena radius left the
         player sitting through a minute of nothing; and measuring it this way
         means that if you decide to run her down instead, she is still in the
         fight — which is the captain's choice to make, not the rule's. */
      if (s.fleeing && dist(s.x, s.z, p.x, p.z) > 320) running++;
    }
    if (running >= this.enemies.length) { this.finish('routed'); return; }
  }

  /* ---------------------------------------------------------------
     Striking the set
     --------------------------------------------------------------- */

  finish(outcome) {
    if (this.over) return;
    this.over = true;
    const g = this.game, p = g.player;

    // whoever ran is somebody else's problem again
    for (const s of this.enemies) {
      s.fleeing = false;
      s.target = null;
      s.aggro = 0;
      s.brain = { state: 'idle', t: 0, cooldown: 0 };
    }

    /* Put the world back exactly as it was. Ships are un-benched into the
       same array they left, so nothing downstream notices the fight
       happened — and a hull that went down during it simply is not there. */
    for (const s of this.benched) {
      if (!s.alive || s.dead) continue;
      s.mesh.visible = true;
      g.ships.push(s);
    }
    this.benched.length = 0;
    for (const s of g.ships) s.mesh.visible = true;

    /* Separation on the way out, so the campaign does not immediately hand
       you the same encounter again. Break off downwind of the action if you
       ran; hold the water you fought over if you won it. */
    if (outcome === 'fled' || outcome === 'lost') {
      const away = Math.atan2(p.x - this.x, p.z - this.z);
      for (const s of [p, ...g.fleet.filter(f => f !== p && f.alive)]) {
        s.x += Math.sin(away) * 260;
        s.z += Math.cos(away) * 260;
      }
      // and they do not simply turn round and start again
      for (const s of this.enemies) s.chaseHold = 45;
    }

    const taken = this.startEnemies.filter(s => g.fleet.includes(s) || s.faction === 'player');
    this.result = {
      outcome,
      kind: this.kind,
      crewLost: Math.max(0, this.startCrew - p.crewTotal),
      hullLost: Math.max(0, Math.round(this.startHull - p.hull)),
      sunk: this.startEnemies.filter(s => !s.alive).length,
      taken: taken.length,
      takenNames: taken.map(s => s.name),
      fought: this.startEnemies.length,
      seconds: Math.round(this.t),
    };
    g.endBattle(this);
  }
}
