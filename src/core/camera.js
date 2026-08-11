/* Elevated diorama camera. World-locked azimuth (stable for tap-to-sail),
   soft lead-ahead framing, and an automatic widen during action. */
import * as THREE from 'three';
import { clamp, damp, lerp, clamp01 } from './util.js';

export class SeaCamera {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(52, aspect, 1.5, 12000);
    this.focus = new THREE.Vector3(0, 0, 0);
    this.aim = new THREE.Vector3(0, 0, 0);
    this.azimuth = -0.62;
    this.distance = 205;
    this.targetDistance = 205;
    this.minD = 95; this.maxD = 430;
    this.shake = 0;
    this._shakeV = new THREE.Vector3();
    this.userAz = 0;
  }
  resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); }

  orbit(dx) { this.azimuth -= dx * 0.0055; }
  zoom(f) { this.targetDistance = clamp(this.targetDistance * f, this.minD, this.maxD); }
  setZoom(d) { this.targetDistance = clamp(d, this.minD, this.maxD); }
  addShake(v) { this.shake = Math.min(1.4, this.shake + v); }

  /** target: {x,z,yaw,speed}; interest: optional extra point to keep in frame */
  update(dt, target, interest, wideness = 0) {
    // lead the framing in the direction of travel
    const lead = clamp(target.speed * 2.6, 0, 46);
    let fx = target.x + Math.sin(target.yaw) * lead;
    let fz = target.z + Math.cos(target.yaw) * lead;
    if (interest) {
      fx = lerp(fx, (target.x + interest.x) / 2, 0.5);
      fz = lerp(fz, (target.z + interest.z) / 2, 0.5);
    }
    this.aim.set(fx, 0, fz);
    this.focus.x = damp(this.focus.x, fx, 2.6, dt);
    this.focus.z = damp(this.focus.z, fz, 2.6, dt);

    let want = this.targetDistance;
    if (interest) {
      const sep = Math.hypot(interest.x - target.x, interest.z - target.z);
      want = clamp(Math.max(this.targetDistance, sep * 0.95 + 70), this.minD, this.maxD);
    }
    want *= 1 + wideness * 0.12;
    this.distance = damp(this.distance, want, 1.8, dt);

    // low and cinematic when close in, high and tactical when zoomed out
    const t = clamp01((this.distance - this.minD) / (this.maxD - this.minD));
    const pitch = lerp(0.44, 0.88, t);       // radians above horizon
    const h = Math.sin(pitch) * this.distance;
    const r = Math.cos(pitch) * this.distance;
    // aim above the ship so the horizon sits in the upper third
    const lookY = this.distance * lerp(0.30, 0.16, t);

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
