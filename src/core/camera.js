/* Elevated diorama camera: soft lead-ahead framing, a lazy chase astern, and
   an automatic widen during action.

   Two moods sit on top of that base. Under way on the campaign the camera
   eases down and opens its field a little, so speed reads as speed rather
   than as scenery sliding past a fixed survey. In an action it drops much
   lower — gunwale height, not chart height — and, when the player has a
   mark, drifts round to put the duel broadside-on across the frame. The
   drift is a suggestion, not a seizure: a finger on the sea always wins,
   and the camera waits five seconds after the last drag before resuming.

   The azimuth used to be world-locked outright, which is stable for
   tap-to-sail and reads as a survey: turning the ship swung the whole ocean
   round a hull that never appeared to move. It now trails astern of her
   instead — but slowly, at a rate that takes several seconds to come round,
   so what the player sees is the ship turning first and the view following.
   That lag is the point. Snapping to her heading would trade one wrong
   reading for its opposite: a ship pinned to the middle of the screen with
   the sea rotating about her, and a tap-to-sail gesture that lands somewhere
   different every time she yaws. Slow enough to read as the ship's turn,
   never fast enough to become the ship's turn. */
import * as THREE from 'three';
import { clamp, damp, lerp, clamp01, angDiff } from './util.js';

export class SeaCamera {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(52, aspect, 1.5, 12000);
    this.focus = new THREE.Vector3(0, 0, 0);
    this.aim = new THREE.Vector3(0, 0, 0);
    this.azimuth = -0.62;
    this.distance = 168;
    this.targetDistance = 168;
    this.minD = 72; this.maxD = 430;
    this.shake = 0;
    this._shakeV = new THREE.Vector3();
    this.heat = 0;         // 0 campaign … 1 battle, damped so the move is a move
    this.orbitHold = 0;    // seconds left of "the player is steering the camera"
    this.pitch = 0.6;      // published for anything that wants to know the angle
  }
  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }

  orbit(dx) { this.azimuth -= dx * 0.0055; this.orbitHold = 5; }
  zoom(f) { this.targetDistance = clamp(this.targetDistance * f, this.minD, this.maxD); }
  setZoom(d) { this.targetDistance = clamp(d, this.minD, this.maxD); }
  addShake(v) { this.shake = Math.min(1.4, this.shake + v); }

  /** target: {x,z,yaw,speed}; interest: optional extra point to keep in frame;
      battle: how much of an action this is, 0..1 — the rig eases between. */
  update(dt, target, interest, wideness = 0, battle = 0) {
    this.heat = damp(this.heat, clamp01(battle), 1.5, dt);
    this.orbitHold = Math.max(0, this.orbitHold - dt);

    /* Broadside-on framing: swing so the line between the ships runs across
       the screen, not into it. Two bearings satisfy that; take the nearer,
       so the camera never crosses the fight to get to its seat. */
    if (this.heat > 0.4 && interest && this.orbitHold <= 0) {
      const b = Math.atan2(interest.x - target.x, interest.z - target.z);
      const c1 = b + Math.PI / 2, c2 = b - Math.PI / 2;
      const wantAz = Math.abs(angDiff(this.azimuth, c1)) <= Math.abs(angDiff(this.azimuth, c2)) ? c1 : c2;
      this.azimuth += angDiff(this.azimuth, wantAz) * (1 - Math.exp(-0.8 * this.heat * dt));
    } else if (this.orbitHold <= 0) {
      /* Otherwise trail astern of her. The rate is the whole design: at 0.55
         a ninety-degree turn takes something like four seconds to come round,
         which is slow enough that the eye reads the ship swinging and the view
         following it rather than the ocean spinning. It also eases off as she
         loses way, so a hull lying still does not have her camera creep round
         behind whatever heading she happens to be pointing. */
      const astern = target.yaw + Math.PI;
      const keen = 0.55 * clamp01((target.speed - 0.6) / 3);
      this.azimuth += angDiff(this.azimuth, astern) * (1 - Math.exp(-keen * dt));
    }

    // lead the framing in the direction of travel — further when she has way on
    const sail = clamp01((target.speed - 2.5) / 6) * (1 - this.heat);
    const lead = clamp(target.speed * (2.6 + sail * 1.3), 0, 58);
    let fx = target.x + Math.sin(target.yaw) * lead;
    let fz = target.z + Math.cos(target.yaw) * lead;
    /* Centred between the two ships, which looks like the camera declining to
       take the player's side and is really the opposite. Both hulls are then
       the same distance from the middle of the frame, so holding the pair
       needs the least stand-off there is — and stand-off is exactly what was
       making the player's ship small. Bias the frame toward her instead and
       the enemy swings out toward one edge, which buys nothing and costs the
       lens: tried at a fifth and a third, the enemy left the frame in three
       shots out of four and the distance had to go back up to fetch her. */
    if (interest) {
      fx = lerp(fx, (target.x + interest.x) / 2, 0.5);
      fz = lerp(fz, (target.z + interest.z) / 2, 0.5);
    }
    this.aim.set(fx, 0, fz);
    this.focus.x = damp(this.focus.x, fx, 2.6, dt);
    this.focus.z = damp(this.focus.z, fz, 2.6, dt);

    /* Only as far off as it takes to hold the pair. `sep * 0.95 + 70` put a
       duel at 130m separation on a 190m lens, and at 190m the player's own
       ship is seven per cent of the frame — a counter on a chart, which is the
       reading this whole pass exists to fix. Centred between them each hull is
       half the separation from the middle of the frame, and the lens covers
       about seven-tenths of its own distance either side, so a little over
       three-quarters of the separation is all it takes. The rest was habit. */
    let want = this.targetDistance;
    if (interest) {
      const sep = Math.hypot(interest.x - target.x, interest.z - target.z);
      want = clamp(Math.max(this.targetDistance * 0.5, sep * 0.86 + 26), this.minD, this.maxD);
    }
    want *= 1 + wideness * 0.12;
    this.distance = damp(this.distance, want, 1.8, dt);

    // low and cinematic when close in, high and tactical when zoomed out
    const t = clamp01((this.distance - this.minD) / (this.maxD - this.minD));
    let pitch = lerp(0.44, 0.88, t);
    pitch = lerp(pitch, 0.34, this.heat * 0.6);   // an action drops toward the water
    pitch -= sail * 0.06;                          // and a ship with way on, a little
    this.pitch = pitch = Math.max(0.3, pitch);
    const h = Math.sin(pitch) * this.distance;
    const r = Math.cos(pitch) * this.distance;
    /* Aim a little above the water so the horizon sits high and the ship sits
       near the middle of the frame. This was 0.30 of the distance, which at
       the old 205m stand-off put the aim sixty metres up: the horizon landed a
       third of the way down and the ship fell into the bottom corner, under
       the FIRE button. Closer in, the same fraction was still throwing her
       down there. Aim lower and she comes back to the middle. */
    const lookY = this.distance * lerp(0.10, 0.09, t);

    // a touch more field under sail, a touch less in a fight — speed reads as
    // speed, and the long lens flattens a duel into one picture
    const fovWant = 52 + sail * 5 - this.heat * 4;
    if (Math.abs(this.cam.fov - fovWant) > 0.05) {
      this.cam.fov = damp(this.cam.fov, fovWant, 2.2, dt);
      this.cam.updateProjectionMatrix();
    }

    let sx = 0, sy = 0, sz = 0;
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - dt * 1.9);
      const s = this.shake * this.shake * 3.4;
      sx = (Math.random() - .5) * s; sy = (Math.random() - .5) * s; sz = (Math.random() - .5) * s;
    }
    this.cam.position.set(
      this.focus.x + Math.sin(this.azimuth) * r + sx,
      h + 6 + sy,
      this.focus.z + Math.cos(this.azimuth) * r + sz
    );
    this.cam.lookAt(this.focus.x + sx * 0.4, lookY + sy * 0.4, this.focus.z + sz * 0.4);
    void this._shakeV;
  }
}
