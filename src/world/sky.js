/* Sky dome, sun, drifting cloud shelf, distant headlands, fog. */
import * as THREE from 'three';
import { makeRNG, rngRange } from '../core/util.js';
import { mergeGeos, prep, xf, litMaterial } from '../core/geo.js';

/* The palette is doing the work here. A painted summer sky is not a photograph
   of one: the top of it is deeper and more saturated than a camera would give
   you, the horizon goes warm and pale rather than grey, and the shade under a
   cloud is blue, never black. */
export const SKY = {
  zenith: 0x2f7bc9,
  horizon: 0xdbe7da,
  fog: 0xc6dcd8,
  fogDensity: 0.00042,
  sunColor: 0xfff3cf,
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
  // a firmer curve than a linear fade: the blue holds most of the dome and
  // then gives way quickly near the horizon, the way a painted sky does
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.55));
  // and a band of warm light sitting on the sea, which is what sells distance
  col = mix(vec3(0.94,0.91,0.80), col, smoothstep(-0.03, 0.26, d.y));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunCol * (pow(sd, 26.0)*0.55 + pow(sd, 4.0)*0.20);
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
  /* Warm key, cool fill. Shade that goes grey looks like missing light; shade
     that goes blue-green looks like a summer afternoon, which is the whole
     trick behind how these skies are painted. */
  const sun = new THREE.DirectionalLight(0xfff1cb, 1.58);
  sun.position.copy(SKY.sunDir).multiplyScalar(600);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xd6ecff, 0x3a6f60, 0.82);
  scene.add(hemi);
  const bounce = new THREE.DirectionalLight(0x9fd8c6, 0.34);
  bounce.position.set(-0.5, -0.3, 0.6);
  scene.add(bounce);

  // ---- clouds ----
  clouds = new THREE.Group();
  clouds.name = 'clouds';
  const rng = makeRNG(4242);
  const N = 30;
  cloudSeeds = [];
  const parts = [];
  const TOP = new THREE.Color(0xffffff), BASE = new THREE.Color(0xa8c1de);
  for (let c = 0; c < N; c++) {
    const cx = rngRange(rng, -5200, 5200), cz = rngRange(rng, -5200, 5200);
    const cy = rngRange(rng, 360, 900);
    const scale = rngRange(rng, 1.0, 2.7);
    const puffs = 6 + ((rng() * 5) | 0);
    const local = [];
    /* Cumulus, not cotton wool: the puffs pile upward into a head rather than
       spreading into a pancake, and each one is shaded by how high it sits in
       the stack — white where the sun lands on top, blue underneath. That
       vertical sculpting is most of what makes a painted cloud read as one. */
    for (let p = 0; p < puffs; p++) {
      const lift = Math.pow(rng(), 1.7);              // most puffs low, a few towering
      const r = rngRange(rng, 46, 104) * scale * (1 - lift * 0.35);
      const g = new THREE.IcosahedronGeometry(r, 1);
      xf(g, {
        x: rngRange(rng, -96, 96) * scale * (1 - lift * 0.45),
        y: (lift * 118 - 12) * scale,
        z: rngRange(rng, -68, 68) * scale * (1 - lift * 0.45),
        sy: rngRange(rng, 0.58, 0.98),
      });
      local.push(prep(g, BASE.clone().lerp(TOP, 0.25 + lift * 0.75).getHex(), 0.04));
    }
    // opaque, depth-writing clouds: they belong in the opaque pass so the
    // sea always occludes them properly instead of being painted over
    const mesh = new THREE.Mesh(mergeGeos(local), new THREE.MeshLambertMaterial({
      vertexColors: true, emissive: 0xb9cfe4, emissiveIntensity: 0.42, fog: true,
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
    // headlands read as land, not cloud: green under the haze, and the further
    // shoulder paler than the near one so the distance stacks in layers
    far.push(prep(g, 0x74998c, 0.05));
    if (rng2() > 0.45) {
      const g2 = new THREE.ConeGeometry(w * 0.32, h * 0.7, 5);
      xf(g2, { x: Math.cos(a) * d + rngRange(rng2, -400, 400), y: h * 0.3, z: Math.sin(a) * d + rngRange(rng2, -300, 300) });
      far.push(prep(g2, 0x8fae9f, 0.05));
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
