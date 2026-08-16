/* Pooled GPU point-sprite particles: smoke, spray, splinters, shot. */
import * as THREE from 'three';

function softCircle(size = 64, hardness = 0.35) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * hardness * 0.5, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const VS = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vCol;
uniform float uScale;
void main(){
  vAlpha = aAlpha; vCol = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
precision mediump float;
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vCol;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  if(t.a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vCol, t.a * vAlpha);
}`;

export class Particles {
  constructor(scene, { max = 500, blending = THREE.NormalBlending, hardness = 0.3, depthWrite = false } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.windK = new Float32Array(max);
    this.cursor = 0;
    this.count = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, max);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softCircle(64, hardness) }, uScale: { value: 900 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite, blending, depthTest: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.geo = g;
    for (let i = 0; i < max; i++) this.alpha[i] = 0;
  }

  spawn(x, y, z, vx, vy, vz, opt = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size0[i] = opt.size0 ?? 6; this.size1[i] = opt.size1 ?? 12;
    this.size[i] = this.size0[i];
    const c = opt.color ?? [1, 1, 1];
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.maxLife[i] = this.life[i] = opt.life ?? 1;
    this.alpha[i] = opt.alpha ?? 1;
    this.drag[i] = opt.drag ?? 1.4;
    this.grav[i] = opt.gravity ?? 0;
    this.windK[i] = opt.wind ?? 0;
    this._a0 = opt.alpha ?? 1;
    return i;
  }

  update(dt, windX = 0, windZ = 0) {
    const { pos, vel, life, maxLife, alpha, size, size0, size1, drag, grav, windK } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      life[i] -= dt;
      const t = 1 - life[i] / maxLife[i];
      const d = Math.exp(-drag[i] * dt);
      vel[i * 3] = vel[i * 3] * d + windX * windK[i] * dt;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt;
      vel[i * 3 + 2] = vel[i * 3 + 2] * d + windZ * windK[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = size0[i] + (size1[i] - size0[i]) * t;
      alpha[i] = Math.max(0, (1 - t * t)) * (life[i] > 0 ? 1 : 0);
      if (life[i] <= 0) alpha[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
  setScale(px) { this.mat.uniforms.uScale.value = px; }
}

/* ---------------- named effect helpers ---------------- */
export class FX {
  constructor(scene, quality = 1) {
    this.q = quality;
    this.smoke = new Particles(scene, { max: quality > 0.5 ? 420 : 200, hardness: 0.15 });
    this.spray = new Particles(scene, { max: quality > 0.5 ? 380 : 180, hardness: 0.35 });
    this.debris = new Particles(scene, { max: 160, hardness: 0.9 });
    this.shot = new Particles(scene, { max: quality > 0.5 ? 420 : 220, hardness: 0.85, depthWrite: false });
  }
  update(dt, windX, windZ) {
    this.smoke.update(dt, windX, windZ);
    this.spray.update(dt, windX * 0.3, windZ * 0.3);
    this.debris.update(dt, 0, 0);
    this.shot.update(dt, 0, 0);
  }
  setScale(px) { this.smoke.setScale(px); this.spray.setScale(px); this.debris.setScale(px); this.shot.setScale(px); }

  /* One gun going off, not the whole battery.
   *
   * The guns already fire in sequence — seventy-five milliseconds apart, each
   * with its own muzzle — so the volley was always a run of separate reports.
   * You could not see that, because each one grew to forty-six metres across
   * in near-white and lived three seconds: six of those overlapping is a
   * single opaque sphere wider than the ship, and at close range it swallowed
   * the enemy whole. Smaller, greyer, quicker, and it reads as what it is —
   * a bank of smoke rolling down her side, one gun at a time. */
  cannonSmoke(x, y, z, dx, dz, power = 1) {
    const n = Math.round(3 * this.q) + 2;
    for (let i = 0; i < n; i++) {
      const s = 0.55 + Math.random() * 0.7;
      this.smoke.spawn(
        x + (Math.random() - .5) * 1.5, y + (Math.random() - .5) * 1.2, z + (Math.random() - .5) * 1.5,
        dx * (6 + Math.random() * 10) * power, 1.2 + Math.random() * 2.0, dz * (6 + Math.random() * 10) * power,
        { size0: 3.5 * s, size1: 15 * s, life: 1.0 + Math.random() * 0.9, drag: 1.5, gravity: 0.8, wind: 0.9, color: [0.80, 0.79, 0.77] }
      );
    }
    // the body of it, hanging off her side a moment longer
    this.smoke.spawn(x, y, z, dx * 3, 1.6, dz * 3,
      { size0: 7, size1: 22, life: 1.7, drag: 1.2, gravity: 0.4, wind: 1.1, color: [0.70, 0.69, 0.68] });
    this.muzzleFlash(x, y, z, dx, dz);
  }
  /** The moment of ignition: bright, tiny, and gone inside a tenth of a second. */
  muzzleFlash(x, y, z, dx, dz) {
    this.shot.spawn(x + dx * 1.2, y, z + dz * 1.2, dx * 6, 1, dz * 6,
      { size0: 9, size1: 2, life: 0.085, drag: 3, gravity: 0, color: [1, 0.88, 0.52] });
    this.shot.spawn(x + dx * 2.2, y, z + dz * 2.2, dx * 11, 1.5, dz * 11,
      { size0: 5, size1: 1, life: 0.06, drag: 3, gravity: 0, color: [1, 0.97, 0.86] });
  }
  /* A ball going into the sea.
   *
   * Where a shot falls is how a gunner learns anything, so a miss has to be as
   * legible as a hit — and at the ranges these are fired at, a low ring of
   * spray is lost in the swell. It goes up as a column now: a tight plume that
   * throws high and falls back, with a ring of lower spray thrown out around
   * the foot of it and a little foam left sitting on the water afterwards. */
  splash(x, z, power = 1) {
    const n = Math.round((5 + power * 5) * this.q) + 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 7) * power;
      this.spray.spawn(x, 0.3, z, Math.cos(a) * sp, 6 + Math.random() * 9 * power, Math.sin(a) * sp,
        { size0: 4 + Math.random() * 4, size1: 12 * power, life: 0.6 + Math.random() * 0.5, drag: 0.7, gravity: -22, color: [0.93, 0.98, 0.99] });
    }
    // the column: narrow, fast, and tall enough to be seen over a wave
    const col = Math.round(3 * this.q) + 2;
    for (let i = 0; i < col; i++) {
      this.spray.spawn(x + (Math.random() - .5) * 1.6, 0.4, z + (Math.random() - .5) * 1.6,
        (Math.random() - .5) * 2.2, (13 + Math.random() * 9) * power, (Math.random() - .5) * 2.2,
        { size0: 3, size1: 10 * power, life: 0.75 + Math.random() * 0.4, drag: 0.45, gravity: -24, color: [0.97, 1, 1] });
    }
    // and the disturbance it leaves behind
    this.spray.spawn(x, 0.35, z, 0, 0.4, 0,
      { size0: 5 * power, size1: 20 * power, life: 1.1, drag: 2.4, gravity: 0, color: [0.88, 0.95, 0.97] });
  }
  woodHit(x, y, z, power = 1) {
    const n = Math.round(5 * this.q) + 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 12 * power;
      this.debris.spawn(x, y, z, Math.cos(a) * sp, 3 + Math.random() * 11, Math.sin(a) * sp,
        { size0: 2.5, size1: 1.2, life: 0.8 + Math.random() * 0.6, drag: 0.5, gravity: -26, color: [0.55, 0.4, 0.26] });
    }
    this.smoke.spawn(x, y, z, 0, 2, 0, { size0: 5, size1: 18, life: 0.7, drag: 1.5, gravity: 1, color: [0.5, 0.45, 0.4] });
  }
  fireHit(x, y, z) {
    for (let i = 0; i < 4; i++) {
      this.debris.spawn(x, y, z, (Math.random() - .5) * 6, 2 + Math.random() * 5, (Math.random() - .5) * 6,
        { size0: 5, size1: 1, life: 0.35, drag: 2, gravity: 2, color: [1, 0.75, 0.3] });
    }
  }
  burning(x, y, z, dt, intensity) {
    if (Math.random() > dt * 14 * intensity) return;
    this.smoke.spawn(x + (Math.random() - .5) * 4, y + 1, z + (Math.random() - .5) * 4,
      (Math.random() - .5) * 1.5, 3 + Math.random() * 3, (Math.random() - .5) * 1.5,
      { size0: 6, size1: 40, life: 2.4 + Math.random(), drag: 0.6, gravity: 1.6, wind: 1.1, color: [0.24, 0.22, 0.21] });
  }
  bowSpray(x, y, z, vx, vz, power) {
    if (Math.random() > power * 0.7) return;
    this.spray.spawn(x, y + 0.2, z, vx * 0.25 + (Math.random() - .5) * 3, 2.4 + Math.random() * 3, vz * 0.25 + (Math.random() - .5) * 3,
      { size0: 3, size1: 9, life: 0.55, drag: 1.4, gravity: -14, color: [0.95, 0.99, 1] });
  }
  grape(x, y, z, dx, dz) {
    for (let i = 0; i < 5; i++) {
      this.debris.spawn(x, y, z, dx * (12 + Math.random() * 8) + (Math.random() - .5) * 5, 1, dz * (12 + Math.random() * 8) + (Math.random() - .5) * 5,
        { size0: 2, size1: 1, life: 0.4, drag: 1.2, gravity: -6, color: [0.85, 0.85, 0.8] });
    }
  }
}
