/* ===========================================================
   Ship entity: movement under sail, systemic damage, crew.
   =========================================================== */
import * as THREE from 'three';
import { HULLS, FACTIONS, RANKS, AMMO } from '../data/gamedata.js';
import { clamp, clamp01, lerp, angDiff, damp, TAU } from '../core/util.js';
import { buildShip } from './shipFactory.js';
import { waveHeight, waveTilt } from '../world/water.js';
import { depthAt } from '../world/terrain.js';

let NEXT_ID = 1;
const _tilt = { x: 0, z: 0 };

/** Half the no-go cone: ~47° either side of the wind's eye. Inside it a square
    rig makes no useful way, so the helm beats across it rather than into it. */
const NO_GO = 0.82;

export function emptyCrew() {
  return { deckhand: 0, sailor: 0, gunner: 0, marine: 0, rigger: 0, veteran: 0 };
}
export function crewCount(c) {
  let n = 0; for (const k in c) n += c[k]; return n;
}
export function crewPower(c, key) {
  let p = 0; for (const k in c) p += c[k] * (RANKS[k]?.[key] || 0); return p;
}

/** A ship's name is the one thing about her that never changes, so it is what
    her procedural details are drawn from: reload a save and she is herself. */
function nameSeed(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < (name || '').length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Ship {
  constructor(opts) {
    this.id = NEXT_ID++;
    this.classId = opts.classId || 'cutter';
    this.cls = HULLS[this.classId];
    this.faction = opts.faction || 'freehold';
    this.name = opts.name || 'Nameless';
    this.isPlayer = !!opts.isPlayer;
    this.role = opts.role || 'idle';     // merchant | fisher | pirate | patrol | player | escort

    this.x = opts.x || 0; this.z = opts.z || 0;
    this.yaw = opts.yaw ?? 0;
    this.speed = 0;
    this.dest = null;                    // {x,z}
    this.route = null;                   // remaining waypoints, when one was needed
    this.headingCmd = null;              // radians, used when no dest
    this.throttle = 1;                   // 0..1 sail set
    this.tack = 0;                       // -1/+1 while beating, 0 when she can fetch

    this.hullMax = this.cls.hull; this.hull = opts.hull ?? this.hullMax;
    this.sailMax = this.cls.sails; this.sails = opts.sails ?? this.sailMax;

    this.crew = opts.crew || defaultCrew(this.cls, this.faction, this.role);
    this.morale = 1;

    const perSide = Math.max(1, Math.round(this.cls.guns / 2));
    this.gunsMax = perSide;
    this.gunsPort = perSide; this.gunsStb = perSide;
    this.reload = { port: 0, stb: 0 };
    this.reloadTime = 7.5;
    this.ammo = 'round';

    this.cargo = opts.cargo || {};
    this.shot = opts.shot ?? Math.round(this.cls.guns * 3);
    this.provisions = opts.provisions ?? Math.round(crewCount(this.crew) * 2.5);

    this.alive = true;
    this.sinking = 0;
    this.captured = false;
    this.target = null;
    this.aggro = 0;
    this.groundedT = 0;
    this.hungry = 0;          // 0..1 — how far short commons have worn them down
    this.boarding = null;
    this.lockTo = null;
    this.smokeT = 0;
    this.lastHitT = -99;
    this.flashT = 0;
    this.brain = { state: 'idle', t: 0, wp: 0, route: null, home: null, flee: 0, cooldown: 0 };
    this.officers = [];                   // officer ids assigned (player fleet)
    this.captain = null;                  // officer object for consorts
    this.fleetOrder = 'follow';
    this.formSlot = 0;
    this.visible = true;
    this.wakeStrength = 0;

    this.colors = opts.colors || null;
    /** The yard she came out of. Never changes hands, whoever owns her. */
    this.builtBy = opts.builtBy || this.faction;
    /* Her history, kept as two counts and nothing else.
       `scars` is the number of times she has been brought in badly hurt and
       put back together; `prizes` is what she has taken. Everything the
       player sees of either is derived in the factory, so a save carries two
       small numbers and reopens on the same ship. */
    this.scars = opts.scars | 0;
    this.prizes = opts.prizes | 0;
    /** Her own thread of the variation stream: the same hull every time. */
    this.seed = nameSeed(this.name);
    this.mesh = buildShip(this.classId, this.faction, this.meshOpts());
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.yaw;
    this.mesh.userData.ship = this;
    this.baseSailOpacity = 1;
    this._hitFlash = 0;
  }

  /** Everything the factory needs to draw this particular ship. */
  meshOpts() {
    return {
      ...(this.colors || {}),
      upgrades: this.upgrades || [],
      guns: this.gunsMax ? this.gunsMax * 2 : undefined,
      /* Where she was built, which is not where she sails from. A prize taken
         into the fleet flies your colours and keeps her bones: League hulls
         stay heavy, Covenant hulls stay light, and a late fleet reads as a
         history of the campaign rather than five copies of one ship. */
      build: this.builtBy ? (FACTIONS[this.builtBy] || {}).build : undefined,
      seed: this.seed,
      history: { scars: this.scars | 0, prizes: this.prizes | 0 },
    };
  }

  /**
   * Mark what she has been through, and redraw her if it shows.
   *
   * Returns true when the hull needs rebuilding, so the caller can do it once
   * at the moment it happens — in harbour, where a refit belongs — rather than
   * the renderer checking every ship every frame for a number that changes
   * perhaps five times in a campaign.
   */
  recordHistory({ scar = 0, prize = 0 } = {}) {
    const was = `${Math.min(3, this.scars)}/${Math.min(3, this.prizes)}`;
    this.scars += scar; this.prizes += prize;
    return was !== `${Math.min(3, this.scars)}/${Math.min(3, this.prizes)}`;
  }

  /**
   * Rebuild her hull from her current state, in place.
   *
   * A refit is not a new ship: she keeps her name, her crew, her damage and
   * her place in the world, and the only thing that changes is what she looks
   * like. The old geometry is disposed rather than orphaned, because a captain
   * who refits a fleet of six should not pay for it in memory.
   */
  refitMesh(scene) {
    const old = this.mesh;
    const next = buildShip(this.classId, this.faction, this.meshOpts());
    next.position.copy(old.position);
    next.rotation.copy(old.rotation);
    next.scale.copy(old.scale);
    next.visible = old.visible;
    next.userData.ship = this;
    if (scene) { scene.add(next); scene.remove(old); }
    old.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.mesh = next;
    return next;
  }

  /* ---------- derived ---------- */
  get crewTotal() { return crewCount(this.crew); }
  get sailFrac() { return clamp01(this.sails / this.sailMax); }
  get hullFrac() { return clamp01(this.hull / this.hullMax); }
  get crewFrac() { return clamp01(this.crewTotal / this.cls.crewMax); }
  get draft() { return this.cls.draft * 11.5; }
  get cargoUsed() { let n = 0; for (const k in this.cargo) n += this.cargo[k]; return n; }
  get cargoFree() { return this.cls.cargo - this.cargoUsed; }

  /** Crew quality, multiplied by whatever the captain personally brings to it.
      `capt` is set on the flagship from the answers given before the voyage. */
  crewSkill(key) {
    const need = Math.max(4, this.cls.crewMax * 0.38);
    const base = clamp(crewPower(this.crew, key) / need, 0.25, 1.9);
    const fed = 1 - 0.35 * this.hungry;      // a starving crew works badly
    return base * fed * (this.capt ? (1 + (this.capt[key] || 0)) : 1);
  }
  officerBonus(role) {
    return this.officers.some(o => o.role === role) ? 1 : 0;
  }
  hasOfficer(role) { return this.officers.some(o => o.role === role); }

  get maxSpeed() {
    let s = this.cls.speed;
    s *= 0.35 + 0.65 * Math.pow(this.sailFrac, 0.75);
    s *= clamp(0.55 + 0.45 * this.crewSkill('sail'), 0.5, 1.15);
    s *= 1 - 0.18 * clamp01(this.cargoUsed / Math.max(1, this.cls.cargo));
    s *= 1 - 0.16 * (1 - this.hullFrac);
    if (this.hasOfficer('mate')) s *= 1.08;
    if (this.hasOfficer('navigator')) s *= 1.10;
    return s;
  }
  get turnSpeed() {
    let t = this.cls.turn;
    t *= 0.45 + 0.55 * this.sailFrac;
    t *= clamp(0.6 + 0.4 * this.crewSkill('sail'), 0.55, 1.2);
    if (this.hasOfficer('mate')) t *= 1.12;
    return t * Math.PI / 180;
  }
  /* A square-rigger's polar, not a cosine.

     The cosine this used to be had exactly one good heading and one bad one,
     which put 35% of all headings in the HUD's red band and — because a slow
     leg eats more of the clock than a fast one — half of every voyage's
     *minutes* under a red wind label. That is why an unbiased wind read as a
     wind that was always against you: the compass was fair, the stopwatch
     was not.

     A real ship of this rig is quickest on a broad reach (TWA ~120°), a
     little slower dead before the wind where the sails blanket each other,
     good on a beam reach, and pinched inside about 47° of the wind's eye.
     That shape puts the punishment where it belongs — in a narrow no-go cone
     you can tack out of — instead of spreading it over half the rose.

     Tuned once after playtest: the first cut of this curve had a 0.15 floor,
     and any fight that drifted upwind of the player turned into a crawl
     nobody enjoyed. The floor is now 0.28 — beating is still the wrong way
     to travel, but no longer a punishment for being in the wrong fight. The
     mean over all headings is 0.688 against the old cosine's 0.690, so the
     fleet as a whole neither quickened nor slowed. */
  windFactor(windAng, yaw = this.yaw) {
    // angle off the wind's eye: 0 = head to wind, π = dead run
    const twa = Math.PI - Math.abs(angDiff(windAng, yaw));
    const run = 0.5 - 0.5 * Math.cos(twa);          // 0 in irons .. 1 running
    const reach = Math.pow(Math.sin(twa), 1.2);     // peaks on the beam
    return 0.28 + 0.44 * Math.pow(run, 0.8) + 0.28 * reach;
  }

  /* Beating to windward.

     A mark inside the no-go cone cannot be sailed at, so the helm lays the
     nearest edge of the cone instead and crosses over when the mark has drawn
     far enough onto the other bow. Because the crossing point is an *angle*,
     the zig-zag converges on its own: every board brings the mark closer to
     the bow until it falls outside the cone and she can fetch it straight.
     The distance cap on top of that keeps a long leg from wandering half an
     ocean off the rhumb line before she comes about.

     Returns the heading to steer for a mark bearing `brg`, `d` away. */
  beatTo(brg, d, windAng) {
    const eye = windAng + Math.PI;          // where the wind is blowing from
    const off = angDiff(eye, brg);          // signed: how far the mark sits off the eye
    // outside the cone she fetches it; inside 90m there is nothing left to gain
    if (Math.abs(off) >= NO_GO || d < 90) { this.tack = 0; return brg; }
    if (!this.tack) {
      /* Open on the making board — the one that points nearest the mark. Only
         when the mark is dead in the eye is there nothing to choose between
         them, and then the smaller turn from her present heading decides. */
      if (Math.abs(off) > 0.09) this.tack = Math.sign(off);
      else {
        const a = angDiff(this.yaw, eye + NO_GO), b = angDiff(this.yaw, eye - NO_GO);
        this.tack = Math.abs(a) <= Math.abs(b) ? 1 : -1;
      }
    } else if (Math.sign(off) === -this.tack &&
               (Math.abs(off) > 0.34 || Math.abs(d * Math.sin(off)) > 150)) {
      this.tack = -this.tack;               // she has run far enough: come about
    }
    /* She also comes about for the shore. A beat swings wide of the rhumb line
       the route was plotted along, and no board is worth holding into the
       ground — so sound ahead, and if the water goes thin, take the other
       board early. Both thin means a cove the route should never have entered:
       give the helm the plain bearing and let the lead line argue with it. */
    const need = this.draft * 1.9 + 3;
    const look = 64 + this.speed * 4;
    const sound = a => depthAt(this.x + Math.sin(a) * look, this.z + Math.cos(a) * look);
    if (sound(eye + NO_GO * this.tack) < need) {
      if (sound(eye - NO_GO * this.tack) > need) this.tack = -this.tack;
      else { this.tack = 0; return brg; }
    }
    return eye + NO_GO * this.tack;
  }

  /* ---------- orders ---------- */
  setDestination(x, z) { this.dest = { x, z }; this.headingCmd = null; this.route = null; this.tack = 0; }
  /** A course that works its way round the islands instead of into them. */
  setRoute(pts) {
    if (!pts || !pts.length) return;
    this.route = pts.slice();
    this.dest = this.route.shift();
    this.headingCmd = null;
    this.tack = 0;
  }
  setHeading(a) { this.headingCmd = a; this.dest = null; this.route = null; this.tack = 0; }
  stop() { this.dest = null; this.route = null; this.headingCmd = this.yaw; this.throttle = 0; this.tack = 0; }

  /* ---------- update ---------- */
  update(dt, world) {
    if (!this.alive) { this.updateSinking(dt); return; }

    // --- steering ---
    let want = this.yaw;
    if (this.lockTo) {
      // grappled: hold alongside
      this.speed = damp(this.speed, 0, 3, dt);
    } else if (this.dest) {
      const dx = this.dest.x - this.x, dz = this.dest.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < Math.max(9, this.cls.len * 0.6)) {
        if (this.route && this.route.length) {
          // a waypoint, not the destination — round it and carry on
          this.dest = this.route.shift();
        } else {
          // arrived: hold the heading but take the way off her
          this.dest = null; this.headingCmd = this.yaw;
          if (this.isPlayer) this.throttle = 0.12;
        }
      }
      else {
        /* Inside a battle the tap is a tactical order, the distances are a few
           ship-lengths, and a helm that answers "somewhere else first" reads
           as a helm that ignored you — so the beat is a campaign manoeuvre
           only. In the action she sails the line you gave her, pinched or
           not, and the 0.28 floor keeps even that line honest. */
        want = world.combatLive ? Math.atan2(dx, dz) : this.beatTo(Math.atan2(dx, dz), d, world.windAng);
      }
    } else if (this.headingCmd != null) want = this.headingCmd;

    const diff = angDiff(this.yaw, want);
    /* 0.55 at a standstill: she answers the helm from bare steerage way. The
       old 0.35 floor made every slow ship feel like she was ignoring the
       wheel, and slow is what a battle mostly is. */
    const maxTurn = this.turnSpeed * dt * (0.55 + 0.45 * clamp01(this.speed / Math.max(2, this.cls.speed * 0.5)));
    const turn = clamp(diff, -maxTurn, maxTurn);
    this.yaw += turn;
    this.turnRateSmoothed = damp(this.turnRateSmoothed || 0, turn / Math.max(dt, 0.0001), 6, dt);

    // --- speed ---
    const wf = this.windFactor(world.windAng);
    let targetSpeed = this.maxSpeed * wf * this.throttle;
    if (!this.dest && this.headingCmd == null) targetSpeed *= 0.25;
    // shoal drag / grounding
    const dep = depthAt(this.x, this.z);
    if (dep < this.draft) {
      const over = clamp01((this.draft - dep) / Math.max(1, this.draft));
      targetSpeed *= (1 - over * 0.92);
      this.groundedT += dt;
      if (this.groundedT > 0.55) {
        this.groundedT = 0;
        // a captain raised on a net knows where the water goes thin
        this.damage((over * 9 + 2) * (this.shoalwise ? 0.35 : 1), 'round', null, true);
        if (world.onGround) world.onGround(this, over);
      }
    } else this.groundedT = 0;

    const accel = this.cls.accel * (targetSpeed > this.speed ? 1 : 2.4);
    this.speed += clamp(targetSpeed - this.speed, -accel * dt * 3, accel * dt);
    this.speed = Math.max(0, this.speed);

    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;

    // keep inside the region
    const LIM = world.limit || 2000;
    const r = Math.hypot(this.x, this.z);
    if (r > LIM) {
      const push = (r - LIM) * 0.9;
      this.x -= (this.x / r) * push * dt * 2;
      this.z -= (this.z / r) * push * dt * 2;
      if (this.isPlayer && world.onEdge) world.onEdge();
    }

    // --- reload (seconds; crew skill is baked into reloadTime when firing) ---
    if (this.reload.port > 0) this.reload.port = Math.max(0, this.reload.port - dt);
    if (this.reload.stb > 0) this.reload.stb = Math.max(0, this.reload.stb - dt);

    // --- boatswain repairs rigging under way ---
    if (this.hasOfficer('bosun') && this.sails < this.sailMax) {
      this.sails = Math.min(this.sailMax, this.sails + dt * 0.55);
    }

    // --- a captain remembers who shot at them for about half a minute ---
    if (this.aggro > 0) this.aggro = Math.max(0, this.aggro - dt * 0.033);

    // --- morale drifts back up ---
    this.morale = damp(this.morale, clamp(0.35 + 0.65 * this.crewFrac, 0.3, 1), 0.25, dt);

    this.syncMesh(dt, world);
  }

  syncMesh(dt, world) {
    const m = this.mesh;
    m.position.x = this.x; m.position.z = this.z;
    const wh = waveHeight(this.x, this.z);
    m.position.y = wh * 0.9;
    waveTilt(this.x, this.z, _tilt);
    const lean = clamp(-(this.turnRateSmoothed || 0) * this.speed * 0.055, -0.32, 0.32);
    m.rotation.order = 'YXZ';
    m.rotation.y = this.yaw;
    m.rotation.x = damp(m.rotation.x, _tilt.z * Math.cos(this.yaw) + _tilt.x * Math.sin(this.yaw), 8, dt);
    m.rotation.z = damp(m.rotation.z, lean + (_tilt.x * Math.cos(this.yaw) - _tilt.z * Math.sin(this.yaw)), 7, dt);

    // The rig reads the wind: yards brace round, canvas bellies to leeward,
    // and shot-away rigging reefs up to the yards. `rel` is the wind's bearing
    // relative to our head — 0 running before it, ±PI dead into it.
    const ud = m.userData;
    const sf = this.sailFrac;
    if (ud.rigUniforms) {
      ud.rigUniforms.uRel.value = angDiff(this.yaw, world.windAng);
      ud.rigUniforms.uHealth.value = sf;
    }
    ud.rigMesh.material.opacity = lerp(0.5, 1, sf);
    ud.rigMesh.visible = sf > 0.04;
    // flag streams downwind
    ud.flagMesh.rotation.y = angDiff(this.yaw, world.windAng + Math.PI) * 0.85
      + Math.sin(world.time * 3 + this.id) * 0.12;

    // hit flash
    if (this._hitFlash > 0) {
      this._hitFlash -= dt * 3.2;
      const k = clamp01(this._hitFlash);
      ud.bodyMesh.material.emissive.setRGB(k * 0.55, k * 0.16, k * 0.06);
    } else ud.bodyMesh.material.emissive.setRGB(0, 0, 0);
  }

  updateSinking(dt) {
    this.sinking += dt;
    const t = clamp01(this.sinking / 5.5);
    this.mesh.position.y = -14 * t * t;
    this.mesh.rotation.z = lerp(this.mesh.rotation.z, 0.9, dt * 0.5);
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, -0.35, dt * 0.4);
    if (t >= 1) this.dead = true;
  }

  /* ---------- damage ---------- */
  damage(amount, ammoId = 'round', from = null, silent = false) {
    if (!this.alive) return null;
    const a = AMMO[ammoId] || AMMO.round;
    const res = { hull: 0, sails: 0, crew: 0, guns: 0 };

    res.hull = amount * a.hull;
    this.hull -= res.hull;
    res.sails = amount * a.sail * 0.9;
    this.sails = Math.max(0, this.sails - res.sails);

    // crew casualties
    let losses = Math.round(amount * a.crew * 0.28 * (0.6 + Math.random() * 0.8));
    if (this.hasOfficer('surgeon')) losses = Math.round(losses * 0.65);
    if (losses > 0) res.crew = this.killCrew(losses);

    // guns
    if (Math.random() < a.gun * clamp01(amount / 22) && from) {
      const side = this.sideFacing(from) === 'port' ? 'port' : 'stb';
      if (side === 'port' && this.gunsPort > 0) { this.gunsPort--; res.guns = 1; }
      else if (this.gunsStb > 0) { this.gunsStb--; res.guns = 1; }
    }

    this.morale = clamp(this.morale - amount * 0.004 - res.crew * 0.012, 0.05, 1);
    this._hitFlash = 1;
    this.lastHitT = 0;
    if (from) { this.aggro = 1; this.lastAttacker = from; }
    if (this.hull <= 0) { this.hull = 0; this.sink(); }
    void silent;
    return res;
  }

  killCrew(n) {
    let left = n, killed = 0;
    const order = ['deckhand', 'sailor', 'rigger', 'gunner', 'marine', 'veteran'];
    for (const k of order) {
      while (left > 0 && this.crew[k] > 0) { this.crew[k]--; left--; killed++; }
      if (left <= 0) break;
    }
    return killed;
  }

  sideFacing(other) {
    const bearing = Math.atan2(other.x - this.x, other.z - this.z);
    return angDiff(this.yaw, bearing) > 0 ? 'stb' : 'port';
  }
  /** True when `other` is inside this ship's broadside arc on `side`. */
  inArc(other, side, arcDeg = 62) {
    const bearing = Math.atan2(other.x - this.x, other.z - this.z);
    const rel = angDiff(this.yaw, bearing);           // + = starboard
    const centre = side === 'stb' ? Math.PI / 2 : -Math.PI / 2;
    return Math.abs(angDiff(centre, rel)) < (arcDeg * Math.PI / 180);
  }
  gunsOn(side) { return side === 'stb' ? this.gunsStb : this.gunsPort; }

  get boardingPower() {
    let p = crewPower(this.crew, 'fight');
    if (this.hasOfficer('marine')) p *= 1.25;
    p *= 0.55 + 0.45 * this.morale;
    return p;
  }

  sink() {
    if (!this.alive) return;
    this.alive = false; this.sinking = 0; this.dest = null; this.route = null;
    this.speed *= 0.4;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); }
    });
  }

  serialize() {
    return {
      classId: this.classId, faction: this.faction, name: this.name, x: this.x, z: this.z, yaw: this.yaw,
      hull: this.hull, sails: this.sails, crew: { ...this.crew }, cargo: { ...this.cargo },
      shot: this.shot, provisions: this.provisions, gunsPort: this.gunsPort, gunsStb: this.gunsStb,
      officers: this.officers.map(o => o.id), captain: this.captain ? this.captain.id : null,
      role: this.role, isPlayer: this.isPlayer,
      scars: this.scars | 0, prizes: this.prizes | 0,
    };
  }
}

function defaultCrew(cls, faction, role) {
  const c = emptyCrew();
  const target = Math.round(cls.crewMax * (role === 'merchant' ? 0.42 : role === 'fisher' ? 0.35 : role === 'patrol' ? 0.82 : 0.6));
  let n = Math.max(cls.crewMin, target);
  const isFighter = role === 'pirate' || role === 'patrol';
  c.deckhand = Math.round(n * (isFighter ? 0.25 : 0.45));
  c.sailor = Math.round(n * (isFighter ? 0.35 : 0.40));
  c.gunner = Math.round(n * (isFighter ? 0.18 : 0.07));
  c.marine = Math.round(n * (isFighter ? 0.18 : 0.04));
  c.rigger = Math.round(n * 0.04);
  if (faction === 'admiralty') c.veteran = Math.round(n * 0.08);
  return c;
}

export { defaultCrew };
export const TAU_ = TAU;
export function factionColor(f) { return FACTIONS[f]?.flag ?? 0xffffff; }
