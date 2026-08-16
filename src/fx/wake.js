/* Wake ribbons. One shared mesh for every hull on the map. */
import * as THREE from 'three';
import { waveHeight } from '../world/water.js';
import { clamp01 } from '../core/util.js';

const SEG = 26;         // trail points per ship
const MAXSHIPS = 26;
const VPS = (SEG - 1) * 6;   // verts per ship

const VS = `
attribute float aAlpha;
attribute vec2 aUv;
varying float vA;
varying vec2 vUv;
void main(){
  vA = aAlpha; vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const FS = `
precision mediump float;
varying float vA;
varying vec2 vUv;
uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
void main(){
  float edge = 1.0 - abs(vUv.x*2.0-1.0);
  float churn = n2(vec2(vUv.x*6.0, vUv.y*26.0 - uTime*1.2));
  /* Foam with texture in it, not foam made of texture. At a 0.45 floor against
     0.85 of noise the ribbon was more gap than water and read as glitter on
     the surface rather than as disturbed sea; the churn belongs on top of a
     solid wake, so most of the brightness is the wake and the rest is churn. */
  float a = vA * smoothstep(0.0,0.42,edge) * (0.72 + churn*0.42);
  if(a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.94,0.99,1.0), a);
}`;

export class WakeField {
  constructor(scene) {
    this.slots = new Map();
    this.free = [];
    for (let i = 0; i < MAXSHIPS; i++) this.free.push(i);
    const N = MAXSHIPS * VPS;
    this.pos = new Float32Array(N * 3);
    this.alpha = new Float32Array(N);
    this.uv = new Float32Array(N * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.geo = g;
    this.t = 0;
  }

  register(ship) {
    if (this.slots.has(ship.id)) return;
    const idx = this.free.pop();
    if (idx === undefined) return;
    this.slots.set(ship.id, { idx, pts: [], ship });
  }
  release(ship) {
    const s = this.slots.get(ship.id);
    if (!s) return;
    this.clearSlot(s.idx);
    this.free.push(s.idx);
    this.slots.delete(ship.id);
  }
  clearSlot(idx) {
    const o = idx * VPS;
    for (let i = 0; i < VPS; i++) this.alpha[o + i] = 0;
  }

  update(dt) {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    for (const s of this.slots.values()) {
      const sh = s.ship;
      const pts = s.pts;
      const moving = sh.alive && sh.speed > 0.6;
      const last = pts[pts.length - 1];
      const d = last ? Math.hypot(sh.x - last.x, sh.z - last.z) : 999;
      if (d > 90) pts.length = 0;    // teleport / respawn — drop the old trail
      if (moving && d > 3.2) {
        /* A hull dragging her quarter round throws more water than one running
           straight, so the ribbon widens with the rate of turn. It is the same
           curve the wake already traces — this just makes the turn read in the
           water's width as well as in its shape. */
        const swing = clamp01(Math.abs(sh.turnRateSmoothed || 0) * 2.6);
        pts.push({
          x: sh.x, z: sh.z,
          w: sh.cls.beam * (0.45 + swing * 0.35),
          a: clamp01(sh.speed / (sh.cls.speed * 0.75)) * (0.86 + swing * 0.14),
        });
        if (pts.length > SEG) pts.shift();
      } else if (!moving && pts.length && this.t % 0.2 < dt) {
        pts.shift();
      }
      this.writeSlot(s.idx, pts, sh);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aUv.needsUpdate = true;
  }

  writeSlot(idx, pts, sh) {
    const base = idx * VPS;
    let v = 0;
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const t0 = i / (SEG - 1), t1 = (i + 1) / (SEG - 1);
      // f runs 0 at the oldest point (far astern) to 1 at the newest (the stern).
      // A wake is narrow and bright where the hull just cut it, then spreads
      // wide and dies away behind — so width falls with f and alpha rises with it.
      const f0 = i / Math.max(1, n - 1), f1 = (i + 1) / Math.max(1, n - 1);
      let dx = p1.x - p0.x, dz = p1.z - p0.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      const w0 = p0.w * (1 + (1 - f0) * 2.8);
      const w1 = p1.w * (1 + (1 - f1) * 2.8);
      /* Fade along the trail, not off the stern. This was `f * f * 0.7`, and
         since f is 0 at the oldest point the wake was down to a tenth of its
         strength within a hull-length astern — so the wide, old, interesting
         part of the ribbon was written every frame and never seen, and what
         reached the screen was a pale smudge under the counter. A gentler
         curve shows the whole trail, which is most of what makes a moving ship
         look like it is moving. */
      const a0 = p0.a * Math.pow(f0, 0.55), a1 = p1.a * Math.pow(f1, 0.55);
      /* Every corner sits on the swell under it, not on the swell under the
         middle of the ribbon. The height used to be sampled once per trail
         point and applied across the whole width — and the ribbon is up to
         nine or ten metres across on a wide hull, so its edges hung above the
         water on one side of a wave and sank under it on the other. At the old
         alpha that was invisible; brightened, it turned the wake into a row of
         flat white plates lying on the sea at angles to it. */
      const ax0 = p0.x + nx * w0, az0 = p0.z + nz * w0;
      const bx0 = p0.x - nx * w0, bz0 = p0.z - nz * w0;
      const ax1 = p1.x + nx * w1, az1 = p1.z + nz * w1;
      const bx1 = p1.x - nx * w1, bz1 = p1.z - nz * w1;
      const ya0 = waveHeight(ax0, az0) + 0.2, yb0 = waveHeight(bx0, bz0) + 0.2;
      const ya1 = waveHeight(ax1, az1) + 0.2, yb1 = waveHeight(bx1, bz1) + 0.2;
      const quad = [
        [ax0, ya0, az0, a0, 0, t0],
        [bx0, yb0, bz0, a0, 1, t0],
        [bx1, yb1, bz1, a1, 1, t1],
        [ax0, ya0, az0, a0, 0, t0],
        [bx1, yb1, bz1, a1, 1, t1],
        [ax1, ya1, az1, a1, 0, t1],
      ];
      for (const q of quad) {
        const o = base + v;
        this.pos[o * 3] = q[0]; this.pos[o * 3 + 1] = q[1]; this.pos[o * 3 + 2] = q[2];
        this.alpha[o] = q[3];
        this.uv[o * 2] = q[4]; this.uv[o * 2 + 1] = q[5];
        v++;
      }
    }
    for (; v < VPS; v++) this.alpha[base + v] = 0;
    void sh;
  }
}
