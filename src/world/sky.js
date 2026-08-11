/* Sky dome, sun, drifting cloud shelf, distant headlands, fog. */
import * as THREE from 'three';
import { makeRNG, rngRange } from '../core/util.js';
import { mergeGeos, prep, xf, litMaterial } from '../core/geo.js';

export const SKY = {
  zenith: 0x3d84bd,
  horizon: 0xbfd8dd,
  fog: 0xafcdd4,
  fogDensity: 0.00046,
  sunColor: 0xfff0d0,
  sunDir: new THREE.Vector3(0.42, 0.68, -0.60).normalize(),
};

const DOME_VERT = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DOME_FRAG = `
precision mediump float;
uniform vec3 uZenith, uHorizon, uSunDir, uSunCol;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float t = clamp(d.y*1.25, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.78));
  // low warm haze
  col = mix(vec3(0.80,0.86,0.88), col, smoothstep(-0.02, 0.30, d.y));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunCol * (pow(sd, 26.0)*0.55 + pow(sd, 5.0)*0.16);
  gl_FragColor = vec4(col, 1.0);
}`;

let clouds = null, cloudSeeds = null;

export function createSky(scene) {
  scene.fog = new THREE.FogExp2(SKY.fog, SKY.fogDensity);
  scene.background = new THREE.Color(SKY.fog);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(SKY.zenith) },
        uHorizon: { value: new THREE.Color(SKY.horizon) },
        uSunDir: { value: SKY.sunDir.clone() },
        uSunCol: { value: new THREE.Color(SKY.sunColor) },
      },
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // ---- lights ----
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.45);
  sun.position.copy(SKY.sunDir).multiplyScalar(600);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x2c5a63, 0.75);
  scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0x8fd0e0, 0.32);
  bounce.position.set(-0.5, -0.3, 0.6);
  scene.add(bounce);

  // ---- clouds ----
  clouds = new THREE.Group();
  clouds.name = 'clouds';
  const rng = makeRNG(4242);
  const N = 26;
  cloudSeeds = [];
  const parts = [];
  for (let c = 0; c < N; c++) {
    const cx = rngRange(rng, -5200, 5200), cz = rngRange(rng, -5200, 5200);
    const cy = rngRange(rng, 430, 820);
    const scale = rngRange(rng, 0.9, 2.3);
    const puffs = 4 + ((rng() * 4) | 0);
    const local = [];
    for (let p = 0; p < puffs; p++) {
      const r = rngRange(rng, 42, 88) * scale;
      const g = new THREE.IcosahedronGeometry(r, 1);
      xf(g, {
        x: rngRange(rng, -100, 100) * scale, y: rngRange(rng, -14, 22) * scale,
        z: rngRange(rng, -70, 70) * scale, sy: rngRange(rng, 0.42, 0.62),
      });
      local.push(prep(g, 0xffffff, 0.05));
    }
    // opaque, depth-writing clouds: they belong in the opaque pass so the
    // sea always occludes them properly instead of being painted over
    const mesh = new THREE.Mesh(mergeGeos(local), new THREE.MeshLambertMaterial({
      vertexColors: true, emissive: 0x9fb8cc, emissiveIntensity: 0.55, fog: true,
    }));
    mesh.position.set(cx, cy, cz);
    mesh.renderOrder = 0;
    clouds.add(mesh);
    cloudSeeds.push({ mesh, spd: rngRange(rng, 0.55, 1.25) });
    void parts;
  }
  scene.add(clouds);

  // ---- distant headlands (pure silhouette, sells the horizon) ----
  const far = [];
  const rng2 = makeRNG(99);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rngRange(rng2, -0.2, 0.2);
    const d = rngRange(rng2, 5200, 6800);
    const w = rngRange(rng2, 700, 1900), h = rngRange(rng2, 150, 380);
    const g = new THREE.ConeGeometry(w * 0.5, h, 5 + ((rng2() * 3) | 0));
    xf(g, { x: Math.cos(a) * d, y: h * 0.42, z: Math.sin(a) * d, sz: rngRange(rng2, 0.5, 1.0) });
    far.push(prep(g, 0x8aa9b8, 0.05));
    if (rng2() > 0.45) {
      const g2 = new THREE.ConeGeometry(w * 0.32, h * 0.7, 5);
      xf(g2, { x: Math.cos(a) * d + rngRange(rng2, -400, 400), y: h * 0.3, z: Math.sin(a) * d + rngRange(rng2, -300, 300) });
      far.push(prep(g2, 0x94b2be, 0.05));
    }
  }
  const farMesh = new THREE.Mesh(mergeGeos(far), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  farMesh.renderOrder = -6;
  farMesh.frustumCulled = false;
  scene.add(farMesh);

  return { sun, hemi, clouds };
}

/** Clouds drift downwind and wrap around the player so the sky is never empty. */
export function updateSky(dt, focusX, focusZ, windAng) {
  if (!cloudSeeds) return;
  const dx = Math.sin(windAng), dz = Math.cos(windAng);
  const WRAP = 5600;
  for (const c of cloudSeeds) {
    const m = c.mesh;
    m.position.x += dx * c.spd * 7 * dt;
    m.position.z += dz * c.spd * 7 * dt;
    let ox = m.position.x - focusX, oz = m.position.z - focusZ;
    if (ox > WRAP) m.position.x -= WRAP * 2; else if (ox < -WRAP) m.position.x += WRAP * 2;
    if (oz > WRAP) m.position.z -= WRAP * 2; else if (oz < -WRAP) m.position.z += WRAP * 2;
  }
}
