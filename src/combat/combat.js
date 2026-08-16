/* ===========================================================
   Gunnery, ballistics and boarding.
   Shots are real objects with an arc: they hit a hull, or they
   raise a splash. Nothing is decided by a dice roll you can't see.
   =========================================================== */
import { AMMO } from '../data/gamedata.js';
import { clamp, clamp01, angDiff, lerp } from '../core/util.js';
import { waveHeight } from '../world/water.js';

export const GUN_RANGE = 235;
export const BOARD_RANGE = 34;
export const GRAVITY = 34;
const MUZZLE = 152;      // ball speed; elevation is solved per shot from the range

/* Measured against a fresh cutter, hove to, taking every ball: at 4.4 + len×0.145
   a four-gun raider killed in 9 volleys and had half the hull off in 4, which
   is where a fight stops being a fight and starts being an execution — you are
   dead a minute after the first shot, and the first thirty seconds go by before
   most players notice they are under fire. A fifth off gives room to bear away,
   and the aggro rings give warning enough to avoid it in the first place. */
export function gunDamage(ship) { return 3.55 + ship.cls.len * 0.116; }
export function reloadFor(ship) {
  let t = 7.6 - ship.cls.masts * 0.3;
  t /= clamp(0.55 + 0.55 * ship.crewSkill('gun'), 0.5, 1.7);
  if (ship.hasOfficer('gunner')) t *= 0.8;
  return clamp(t, 3.4, 14);
}

/* ---------------- projectiles ---------------- */
export class Projectiles {
  constructor(fx, ships) {
    this.list = [];
    this.pending = [];
    this.fx = fx;
    this.ships = ships;
  }
  schedule(delay, fn) { this.pending.push({ t: delay, fn }); }

  spawn(o) { this.list.push(o); }

  update(dt, ctx) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { p.fn(); this.pending.splice(i, 1); }
    }
    const G = -GRAVITY;
    // balls travel ~150 u/s and hulls are ~6 wide: step small enough to never tunnel
    const steps = Math.max(1, Math.min(6, Math.ceil(dt / 0.017)));
    const sdt = dt / steps;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      let resolved = false;
      for (let s = 0; s < steps && !resolved; s++) {
        p.vy += G * sdt;
        p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
        p.t += sdt;
        resolved = this.resolve(p, ctx);
      }
      if (resolved) this.list.splice(i, 1);
      else this.trace(p, dt);
    }
  }

  /* Draw the ball, and the air it just went through.
   *
   * The trace was one dark dot — 0.16 grey, two metres, gone in a seventh of a
   * second — which against deep blue water at a hundred metres is nothing at
   * all. Being able to *watch* a volley cross the sea is most of what makes
   * firing one feel like anything, so the ball keeps its dark head and now
   * drags a pale trail behind it: laid down every frame and fading over about
   * a third of a second, which draws the arc without drawing a laser.
   *
   * The trail is laid by *distance*, not once a frame. A ball covers a hundred
   * and fifty metres a second, so one mark per frame is a tight line at sixty
   * frames and a row of well-spaced dots at eight — and eight is what the QA
   * renderer gives, and what a slow machine gives. Marking every few metres
   * along the length actually travelled looks the same either way. */
  trace(p, dt = 1 / 60) {
    if (p.ammo === 'grape') {
      if (Math.random() < 0.55) this.fx.debris.spawn(p.x, p.y, p.z, 0, 0, 0,
        { size0: 1.6, size1: 1.2, life: 0.12, drag: 0, color: [0.9, 0.88, 0.8] });
      return;
    }
    this.fx.shot.spawn(p.x, p.y, p.z, 0, 0, 0,
      { size0: p.ammo === 'chain' ? 2.6 : 2.2, size1: 1.4, life: 0.14, drag: 0, color: [0.16, 0.15, 0.14] });
    const run = Math.hypot(p.vx, p.vy, p.vz) * dt;
    const marks = Math.max(1, Math.min(8, Math.round(run / 4.5)));
    for (let k = 0; k < marks; k++) {
      const b = (k / marks) * dt;      // how far back along this frame's flight
      this.fx.trail.spawn(p.x - p.vx * b, p.y - p.vy * b, p.z - p.vz * b, 0, 0, 0,
        { size0: 1.4, size1: 0.4, life: 0.3, drag: 0, gravity: 0, color: [0.97, 0.98, 1] });
    }
  }

  /** Returns true when the ball is spent. */
  resolve(p, ctx) {
    for (const s of this.ships) {
      if (!s.alive || s === p.owner) continue;
      /* Her own squadron does not stop her shot. The AI keeps friends out of
         the line as best it can, but on a crowded gun deck "as best it can"
         still meant a consort crossing your broadside and eating it — team
         damage nobody ordered and nobody enjoyed. A ball passes a hull that
         sails under the same colours as the gun that fired it. */
      if (p.owner && s.faction === p.owner.faction) continue;
      const dx = p.x - s.x, dz = p.z - s.z;
      if (dx * dx + dz * dz > 3600) continue;
      const c = Math.cos(-s.yaw), sn = Math.sin(-s.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const halfL = s.cls.len * 0.52, halfB = s.cls.beam * 0.62;
      // chain shot flies high and takes the rigging; the rest hit the hull
      const deckTop = s.cls.beam * 0.55 + (p.ammo === 'chain' ? s.cls.len * 0.75 : 2.5);
      if (Math.abs(lx) < halfB && Math.abs(lz) < halfL && p.y < deckTop + 1 && p.y > -2.5) {
        this.hit(p, s, ctx);
        return true;
      }
    }
    if (p.y <= waveHeight(p.x, p.z) + 0.2) {
      this.fx.splash(p.x, p.z, p.ammo === 'grape' ? 0.5 : 1.1);
      if (ctx.onSplash) ctx.onSplash(p.x, p.z);
      return true;
    }
    return p.t > 7;
  }

  hit(p, s, ctx) {
    const res = s.damage(p.dmg, p.ammo, p.owner);
    const hy = Math.max(0.6, p.y);
    if (p.ammo === 'chain') {
      this.fx.woodHit(p.x, hy, p.z, 0.7);
      for (let k = 0; k < 3; k++) this.fx.debris.spawn(p.x, hy + 2, p.z, (Math.random() - .5) * 6, 1, (Math.random() - .5) * 6,
        { size0: 3, size1: 2, life: 1.1, drag: 0.6, gravity: -12, color: [0.86, 0.82, 0.72] });
    } else if (p.ammo === 'grape') {
      this.fx.grape(p.x, hy, p.z, p.vx * 0.05, p.vz * 0.05);
    } else {
      /* Scale the splinters to the damage. Every round shot threw the same
         handful of wood whatever it did, so a graze and a hit that took a gun
         off its carriage looked identical — and what a player reads first is
         the picture, not the number that floats up afterwards. */
      const bite = Math.max(0, Math.min(1.6, (res.hull || 0) / Math.max(1, s.hullMax * 0.08)));
      this.fx.woodHit(p.x, hy, p.z, 0.8 + bite * 0.9);
      this.fx.fireHit(p.x, hy, p.z);
      if (bite > 0.9) {
        // a heavier one takes a piece of her with it
        for (let k = 0; k < 5; k++) {
          const a = Math.random() * Math.PI * 2, sp = 7 + Math.random() * 14;
          this.fx.debris.spawn(p.x, hy + 1, p.z, Math.cos(a) * sp, 5 + Math.random() * 10, Math.sin(a) * sp,
            { size0: 3.4, size1: 1.6, life: 1.2 + Math.random() * 0.5, drag: 0.45, gravity: -24, color: [0.5, 0.36, 0.23] });
        }
        this.fx.smoke.spawn(p.x, hy + 1.5, p.z, 0, 2.5, 0,
          { size0: 6, size1: 26, life: 1.3, drag: 1.2, gravity: 1.2, wind: 0.8, color: [0.42, 0.39, 0.36] });
      }
    }
    if (ctx.onHit) ctx.onHit(p, s, res);
  }
}

/* ---------------- firing ---------------- */
const _muz = { x: 0, y: 0, z: 0 };
function muzzleWorld(ship, port, out) {
  const c = Math.cos(ship.yaw), s = Math.sin(ship.yaw);
  out.x = ship.x + port.x * c + port.z * s;
  out.z = ship.z - port.x * s + port.z * c;
  out.y = port.y + 1.4 + waveHeight(ship.x, ship.z) * 0.9;
  return out;
}

/**
 * Fire one broadside. Returns number of guns fired.
 * Shots are lofted at the target's predicted position with spread
 * from range, gunnery skill and the roll of the deck.
 */
export function fireBroadside(ship, side, target, ctx) {
  if (!ship.alive || !target || !target.alive) return 0;
  if (ship.reload[side] > 0) return 0;
  const n = ship.gunsOn(side);
  if (n <= 0) return 0;
  if (ship.shot <= 0) { if (ctx.onOutOfShot) ctx.onOutOfShot(ship); return 0; }

  const ports = ship.mesh.userData.ports.filter(p => p.side === side);
  const dmg = gunDamage(ship);
  const skill = ship.crewSkill('gun') * (ship.hasOfficer('gunner') ? 1.15 : 1);
  const dist = Math.hypot(target.x - ship.x, target.z - ship.z);
  const ammo = ship.ammo;

  const fired = Math.min(n, ports.length || n);
  ship.shot = Math.max(0, ship.shot - Math.ceil(fired * 0.5));
  ship.reloadTime = reloadFor(ship);
  ship.reload[side] = ship.reloadTime;      // seconds, counted down in Ship.update

  for (let i = 0; i < fired; i++) {
    const port = ports[i % Math.max(1, ports.length)] || { x: side === 'stb' ? ship.cls.beam * 0.5 : -ship.cls.beam * 0.5, y: 2, z: 0, side };
    ctx.projectiles.schedule(i * 0.075, () => {
      if (!ship.alive) return;
      muzzleWorld(ship, port, _muz);
      const sideDir = (side === 'stb' ? 1 : -1);
      const nx = Math.cos(ship.yaw) * sideDir, nz = -Math.sin(ship.yaw) * sideDir;

      // lead the target
      const tt = clamp(dist / 150, 0.25, 2.4);
      const tx = target.x + Math.sin(target.yaw) * target.speed * tt;
      const tz = target.z + Math.cos(target.yaw) * target.speed * tt;
      let ax = tx - _muz.x, az = tz - _muz.z;
      const ad = Math.hypot(ax, az) || 1;
      ax /= ad; az /= ad;

      // spread: much worse at long range, much better with trained gunners.
      // this is the whole reason to close before you fire.
      const spread = (0.028 + (ad / GUN_RANGE) * 0.105) / clamp(skill, 0.4, 1.8)
        * (ammo === 'grape' ? 1.7 : 1);
      const a = Math.atan2(ax, az) + (Math.random() - 0.5) * spread * 2;

      // solve the elevation that actually puts the ball on the target range,
      // then miss short or long by the gun captain's error
      const rangeErr = 1 + (Math.random() - 0.5) * spread * 1.7;
      const R = clamp(ad * rangeErr, 18, GUN_RANGE * 1.3);
      const S = MUZZLE;
      let th = 0.5 * Math.asin(clamp(R * GRAVITY / (S * S), 0, 0.999));
      th += (Math.random() - 0.5) * spread * 0.12;     // laid a shade high or low
      const vh = Math.cos(th) * S, vy = Math.sin(th) * S;

      ctx.projectiles.spawn({
        x: _muz.x + nx * 1.5, y: _muz.y, z: _muz.z + nz * 1.5,
        vx: Math.sin(a) * vh, vy, vz: Math.cos(a) * vh,
        ammo, dmg: dmg * (0.85 + Math.random() * 0.3), owner: ship, t: 0,
      });
      ctx.fx.cannonSmoke(_muz.x + nx * 2, _muz.y, _muz.z + nz * 2, nx, nz, 1);
      if (ctx.onGunFired) ctx.onGunFired(ship, _muz.x, _muz.z);
    });
  }
  if (ctx.onBroadside) ctx.onBroadside(ship, side, fired);
  return fired;
}

/** Best side to fire on, or null. */
export function bestSide(ship, target, arc = 62) {
  if (!target || !target.alive) return null;
  const d = Math.hypot(target.x - ship.x, target.z - ship.z);
  if (d > GUN_RANGE) return null;
  const stb = ship.inArc(target, 'stb', arc) && ship.gunsStb > 0;
  const prt = ship.inArc(target, 'port', arc) && ship.gunsPort > 0;
  if (stb && prt) return ship.reload.stb <= ship.reload.port ? 'stb' : 'port';
  if (stb) return 'stb';
  if (prt) return 'port';
  return null;
}

/* ---------------- boarding ---------------- */
export function canBoard(a, b) {
  if (!a.alive || !b || !b.alive || b.captured) return false;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d > BOARD_RANGE + (a.cls.len + b.cls.len) * 0.25) return false;
  if (a.boarding || b.boarding) return false;
  // must have slowed enough to throw grapples
  const rel = Math.abs(a.speed - b.speed * Math.cos(angDiff(a.yaw, b.yaw)));
  return rel < 7.5;
}

export class Boarding {
  constructor(attacker, defender, ctx) {
    this.a = attacker; this.d = defender; this.ctx = ctx;
    attacker.boarding = this; defender.boarding = this;
    attacker.lockTo = defender; defender.lockTo = attacker;
    this.t = 0; this.tick = 0;
    this.progress = 0.5;
    this.done = false;
    this.result = null;
    this.log = [];
    this.aStart = attacker.crewTotal; this.dStart = defender.crewTotal;
    /* How the captain wants it fought. A boarding used to resolve entirely on
       its own, which made the most dramatic moment in the game a thing you
       watched. These change the exchange rate between ground gained and
       people lost — press and you take the deck faster and bury more of your
       own; fall back and you buy time to cut the grapples. */
    this.stance = 'steady';
    this.marinesSent = false;
    this.lastKa = 0; this.lastKd = 0;
    this.broke = false;
    // pull the ships alongside
    const dx = defender.x - attacker.x, dz = defender.z - attacker.z;
    this.pullAng = Math.atan2(dx, dz);
    this.lines = [];
  }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const a = this.a, d = this.d;

    // drag alongside
    const want = (a.cls.beam + d.cls.beam) * 0.62;
    const dx = d.x - a.x, dz = d.z - a.z;
    const dist = Math.hypot(dx, dz) || 1;
    const pull = (dist - want) * 0.9 * dt;
    a.x += (dx / dist) * pull; a.z += (dz / dist) * pull;
    d.x -= (dx / dist) * pull; d.z -= (dz / dist) * pull;
    const align = Math.atan2(dx, dz) + Math.PI / 2;
    a.yaw += angDiff(a.yaw, align) * Math.min(1, dt * 1.6);
    d.yaw += angDiff(d.yaw, align) * Math.min(1, dt * 1.6);
    a.speed *= Math.exp(-dt * 2.2); d.speed *= Math.exp(-dt * 2.2);

    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.62;
      this.resolveTick();
    }
  }

  /** What the current stance does to weight of attack, ground and casualties. */
  stanceMods() {
    switch (this.stance) {
      // everything into the rail: ground fast, and it is paid for in people
      case 'press': return { power: 1.28, ground: 1.45, ourLoss: 1.5, theirLoss: 1.2 };
      // back off the rail and work the grapples instead of the deck
      case 'fallback': return { power: 0.62, ground: 0.45, ourLoss: 0.5, theirLoss: 0.6, breaking: true };
      // the best fighters aboard, spent once
      case 'marines': return { power: 1.55, ground: 1.3, ourLoss: 0.85, theirLoss: 1.45 };
      default: return { power: 1, ground: 1, ourLoss: 1, theirLoss: 1 };
    }
  }

  resolveTick() {
    const a = this.a, d = this.d;
    const m = this.stanceMods();
    const pa = a.boardingPower * (0.75 + Math.random() * 0.5) * m.power;
    const pd = d.boardingPower * (0.75 + Math.random() * 0.5) * 1.12; // defender's advantage
    const total = pa + pd || 1;
    const swing = (pa - pd) / total;
    this.progress = clamp(this.progress + swing * 0.20 * m.ground, 0, 1);

    /* Falling back is an attempt to get off her, not a way of winning. Given
       a little sea room and a moment where they are not pressing, the
       grapples come free and both ships are their own again. */
    if (m.breaking && this.t > 3 && Math.random() < 0.22 + (swing > 0 ? 0.12 : 0)) {
      this.broke = true;
      this.finish('broken');
      return;
    }

    const lossA = Math.max(0, Math.round((pd / (pa + 1)) * 1.5 * (0.6 + Math.random()) * m.ourLoss));
    const lossD = Math.max(0, Math.round((pa / (pd + 1)) * 1.5 * (0.6 + Math.random()) * m.theirLoss));
    /* Pressing spends the people you would rather keep — see `killCrew`.
       Only the *extra* losses, though: press kills at 1.5x, and it is that
       surplus third which comes off the top of the muster book. Taking all of
       them from the top instead swung it too far the other way — a boarding
       loses power as it loses its best fighters, so pressing went from
       winning 67% of an even fight to winning 4% of one, and the dead option
       was simply the other one. A third is the difference between spending
       your veterans and throwing them away. */
    const cap = Math.min(lossA, Math.max(0, a.crewTotal - 1));
    const best = this.stance === 'press' ? Math.round(cap / 3) : 0;
    const ka = a.killCrew(best, true) + a.killCrew(cap - best);
    const kd = d.killCrew(Math.min(lossD, Math.max(0, d.crewTotal - 1)));
    a.morale = clamp(a.morale - ka * 0.012 + (swing > 0 ? 0.02 : 0), 0.05, 1);
    d.morale = clamp(d.morale - kd * 0.018 + (swing < 0 ? 0.02 : 0), 0.05, 1);

    this.lastKa = ka; this.lastKd = kd;
    // one throw of the marines, then back to whatever was working
    if (this.stance === 'marines') this.stance = 'steady';
    if (this.ctx.onBoardTick) this.ctx.onBoardTick(this, ka, kd);

    const dBroken = d.morale < 0.22 || d.crewTotal <= Math.max(1, this.dStart * 0.22) || this.progress > 0.965;
    const aBroken = a.morale < 0.18 || a.crewTotal <= Math.max(1, this.aStart * 0.20) || this.progress < 0.035;
    if (dBroken) this.finish('attacker');
    else if (aBroken) this.finish('defender');
    else if (this.t > 34) this.finish(this.progress > 0.5 ? 'attacker' : 'defender');
  }

  finish(winner) {
    this.done = true; this.result = winner;
    const a = this.a, d = this.d;
    a.boarding = null; d.boarding = null;
    a.lockTo = null; d.lockTo = null;
    if (winner === 'attacker') { d.captured = true; d.speed = 0; d.dest = null; d.target = null; }
    else if (winner === 'broken') {
      // grapples cut: nobody has taken anything, and both are under way again
      a.morale = Math.max(0.3, a.morale); d.morale = Math.max(0.3, d.morale);
    } else { a.morale = Math.max(0.25, a.morale); }
    if (this.ctx.onBoardEnd) this.ctx.onBoardEnd(this, winner);
  }
}

/* Never a certainty, in either direction.

   A pure ratio reached 1.0 the moment gunnery emptied the other deck, and a
   guaranteed capture is not a decision — it is a chore with a good reward.
   The clamp keeps the last of a beaten crew dangerous and leaves a desperate
   boarding just possible, so closing alongside stays a risk the player takes
   rather than a button they press. */
export function boardOdds(a, d) {
  const pa = a.boardingPower, pd = d.boardingPower * 1.12;
  return clamp(pa / (pa + pd || 1), 0.06, 0.92);
}
export { lerp };
