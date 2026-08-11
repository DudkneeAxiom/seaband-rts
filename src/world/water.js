/* ===========================================================
   Water. The most-looked-at surface in the game.
   Gerstner swell + depth-tinted shallows + shore foam + crest
   foam + fresnel sky + sun glitter, all in one material.
   The same wave maths exists on the CPU so hulls, wakes and
   splashes sit exactly on the surface.
   =========================================================== */
import * as THREE from 'three';
import { WORLD_SIZE } from '../data/gamedata.js';
import { SEA_FLOOR, HEIGHT_SPAN, depthAt } from './terrain.js';

/* --- wave definitions shared by GPU + CPU (dir is rotated off wind) --- */
const W = [
  { amp: 1.55, len: 150, spd: 8.5, off: 0.00, q: 0.62 },
  { amp: 0.85, len: 64, spd: 6.5, off: 1.15, q: 0.48 },
  { amp: 0.42, len: 27, spd: 5.0, off: -1.55, q: 0.35 },
];

let uniforms = null;
let waveDirAngle = 0;
let time = 0;

const VERT = /* glsl */`
uniform float uTime;
uniform float uWaveAng;
uniform vec2  uDepthOrigin;
uniform float uDepthScale;
uniform sampler2D uDepthMap;
uniform float uDetail;
varying vec3 vWorld;
varying float vDepth;
varying vec3 vNormal2;
varying float vCrest;

const float PI = 3.14159265;

float sampleTerrain(vec2 p){
  vec2 uv = (p - uDepthOrigin) * uDepthScale;
  uv = clamp(uv, 0.002, 0.998);
  return texture2D(uDepthMap, uv).r * ${HEIGHT_SPAN.toFixed(1)} + (${SEA_FLOOR.toFixed(1)});
}

void gerstner(vec2 p, float shallow, out float h, out vec3 n, out float crest){
  h = 0.0; crest = 0.0;
  vec3 tang = vec3(1.0,0.0,0.0), bino = vec3(0.0,0.0,1.0);
  float amps[3]; float lens[3]; float spds[3]; float offs[3]; float qs[3];
  amps[0]=${W[0].amp.toFixed(3)}; amps[1]=${W[1].amp.toFixed(3)}; amps[2]=${W[2].amp.toFixed(3)};
  lens[0]=${W[0].len.toFixed(2)}; lens[1]=${W[1].len.toFixed(2)}; lens[2]=${W[2].len.toFixed(2)};
  spds[0]=${W[0].spd.toFixed(3)}; spds[1]=${W[1].spd.toFixed(3)}; spds[2]=${W[2].spd.toFixed(3)};
  offs[0]=${W[0].off.toFixed(3)}; offs[1]=${W[1].off.toFixed(3)}; offs[2]=${W[2].off.toFixed(3)};
  qs[0]=${W[0].q.toFixed(3)}; qs[1]=${W[1].q.toFixed(3)}; qs[2]=${W[2].q.toFixed(3)};
  for(int i=0;i<3;i++){
    float a = amps[i] * shallow;
    float k = 2.0*PI/lens[i];
    float ang = uWaveAng + offs[i];
    vec2 d = vec2(sin(ang), cos(ang));
    float ph = k*dot(d,p) - spds[i]*k*uTime;
    float s = sin(ph), c = cos(ph);
    h += a * s;
    if(i==0) crest = s;
    float wa = k*a;
    tang += vec3(-qs[i]*d.x*d.x*wa*s, d.x*wa*c, -qs[i]*d.x*d.y*wa*s);
    bino += vec3(-qs[i]*d.x*d.y*wa*s, d.y*wa*c, -qs[i]*d.y*d.y*wa*s);
  }
  n = normalize(cross(bino, tang));
}

void main(){
  vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;
  float terr = sampleTerrain(wp.xz);
  float depth = max(0.0, -terr);
  vDepth = depth;
  float shallow = smoothstep(0.0, 16.0, depth);
  float h = 0.0; vec3 n = vec3(0.0,1.0,0.0); float crest = 0.0;
#ifndef FAR
  gerstner(wp.xz, shallow, h, n, crest);
  wp.y += h;
#endif
  vCrest = crest;
  vWorld = wp;
  vNormal2 = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uDeep, uMid, uShallow, uSandy, uFoam;
uniform vec3 uSkyLow, uSkyHigh, uSunDir, uSunCol;
uniform vec3 uFogCol;
uniform float uFogDensity;
uniform float uDetail;
varying vec3 vWorld;
varying float vDepth;
varying vec3 vNormal2;
varying float vCrest;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm2(vec2 p){ return 0.62*vnoise(p) + 0.38*vnoise(p*2.03); }
float fbm(vec2 p){
  float s=0.0, a=0.5;
  for(int i=0;i<3;i++){ s += a*vnoise(p); p*=2.03; a*=0.5; }
  return s;
}

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal2);
  float d = vDepth;

  // ---- ripple normal detail ----
  vec2 rp = vWorld.xz * 0.055;
  float t = uTime * 0.35;
  float n1 = fbm2(rp + vec2(t, t*0.6));
  float n2 = fbm2(rp*2.1 - vec2(t*0.8, t*0.3));
  vec3 rip = normalize(vec3((n1-n2)*0.9, 1.0, (n2-n1)*0.9));
  N = normalize(mix(N, normalize(N + rip*0.55), uDetail));

  // ---- base colour by depth ----
  vec3 col = uDeep;
  col = mix(uMid, uDeep, smoothstep(9.0, 42.0, d));
  col = mix(uShallow, col, smoothstep(3.0, 11.0, d));
  col = mix(uSandy, col, smoothstep(0.5, 3.6, d));

  // reef / seabed mottling seen through clear water (shallows only)
  if (d < 16.0) {
    float bed = fbm2(vWorld.xz*0.035);
    float bedVis = 1.0 - smoothstep(2.0, 15.0, d);
    col = mix(col, col * (0.72 + bed*0.62), bedVis*0.85);
  }

  // ---- fresnel sky ----
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.4);
  float upness = clamp(V.y*1.4, 0.0, 1.0);
  vec3 sky = mix(uSkyLow, uSkyHigh, upness);
  col = mix(col, sky, clamp(fres*0.80, 0.0, 0.52));

  // ---- sun glitter ----
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N,H),0.0), 55.0);
  float sparkle = pow(max(dot(N,H),0.0), 220.0) * (0.5 + 0.5*vnoise(vWorld.xz*0.5 + uTime*0.7));
  col += uSunCol * (spec*0.16 + sparkle*0.30);

  // ---- foam: crests offshore, surf and reef-break inshore ----
  float foam = 0.0;
  if (d > 6.0) {
    float crestF = smoothstep(0.86, 0.995, vCrest) * smoothstep(6.0, 22.0, d);
    foam = crestF * smoothstep(0.52, 0.86, fbm2(vWorld.xz*0.045 + uTime*0.2)) * 0.62;
  }
  if (d < 8.0) {
    float band = 1.0 - smoothstep(0.0, 4.6, d);
    float wob = fbm2(vWorld.xz*0.07 + vec2(uTime*0.14, -uTime*0.1));
    float surge = 0.5 + 0.5*sin(uTime*0.9 + vWorld.x*0.02 + vWorld.z*0.017);
    float shoreF = smoothstep(0.35, 0.95, band * (0.55 + wob*0.9) * (0.7 + surge*0.6));
    shoreF += (1.0 - smoothstep(0.0, 1.3, d)) * 0.55;
    float reefF = (1.0 - smoothstep(1.5, 6.5, d)) * smoothstep(0.55, 0.9, fbm2(vWorld.xz*0.05 - uTime*0.2)) * 0.8;
    foam += shoreF + reefF;
  }
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0)*0.92);

  // ---- fog to horizon ----
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist*uFogDensity, 2.0));
  col = mix(col, uFogCol, clamp(fog,0.0,1.0));

  gl_FragColor = vec4(col, 1.0);
}`;

export const WATER_COLORS = {
  deep: 0x14608a, mid: 0x2492b0, shallow: 0x3ec2b6, sandy: 0x8ee0c6, foam: 0xf0fbf8,
};

let nearMesh, farMesh, matNear, matFar;

export function createWater(scene, depthTex, sky) {
  uniforms = {
    uTime: { value: 0 },
    uWaveAng: { value: 0 },
    uDepthMap: { value: depthTex },
    uDepthOrigin: { value: new THREE.Vector2(-WORLD_SIZE / 2, -WORLD_SIZE / 2) },
    uDepthScale: { value: 1 / WORLD_SIZE },
    uDeep: { value: new THREE.Color(WATER_COLORS.deep) },
    uMid: { value: new THREE.Color(WATER_COLORS.mid) },
    uShallow: { value: new THREE.Color(WATER_COLORS.shallow) },
    uSandy: { value: new THREE.Color(WATER_COLORS.sandy) },
    uFoam: { value: new THREE.Color(WATER_COLORS.foam) },
    uSkyLow: { value: new THREE.Color(sky.horizon) },
    uSkyHigh: { value: new THREE.Color(sky.zenith) },
    uSunDir: { value: sky.sunDir.clone() },
    uSunCol: { value: new THREE.Color(sky.sunColor) },
    uFogCol: { value: new THREE.Color(sky.fog) },
    uFogDensity: { value: sky.fogDensity },
    uDetail: { value: 1.0 },
  };

  matNear = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG });
  matFar = new THREE.ShaderMaterial({
    uniforms, vertexShader: '#define FAR 1\n' + VERT, fragmentShader: FRAG,
  });

  const seg = detailSegments();
  nearMesh = new THREE.Mesh(new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, seg, seg), matNear);
  nearMesh.rotation.x = -Math.PI / 2;
  nearMesh.frustumCulled = false;
  nearMesh.renderOrder = 0;
  scene.add(nearMesh);

  farMesh = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000, 12, 12), matFar);
  farMesh.rotation.x = -Math.PI / 2;
  farMesh.position.y = -4.0;
  farMesh.frustumCulled = false;
  farMesh.renderOrder = -1;
  scene.add(farMesh);

  return { nearMesh, farMesh, uniforms };
}

const NEAR_SIZE = 2900;
function detailSegments() {
  const px = window.innerWidth * window.innerHeight;
  if (px < 380000) return 128;       // small phones
  if (px < 1100000) return 160;
  return 192;
}

export function setWaterQuality(level) {
  if (uniforms) uniforms.uDetail.value = level >= 1 ? 1 : 0.35;
}

/** Follow the camera focus, snapped so the wave field never swims. */
export function updateWater(dt, focusX, focusZ, windAng) {
  time += dt;
  if (!uniforms) return;
  uniforms.uTime.value = time;
  // waves lag the wind
  const d = ((windAng - waveDirAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  waveDirAngle += d * Math.min(1, dt * 0.12);
  uniforms.uWaveAng.value = waveDirAngle;
  const cell = NEAR_SIZE / detailSegments();
  nearMesh.position.x = Math.round(focusX / cell) * cell;
  nearMesh.position.z = Math.round(focusZ / cell) * cell;
  farMesh.position.x = focusX; farMesh.position.z = focusZ;
}

/* ---------------- CPU-side surface ---------------- */
export function waveHeight(x, z) {
  const depth = Math.max(0, depthAt(x, z));
  const shallow = smooth01(depth / 16);
  let h = 0;
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    const k = (Math.PI * 2) / w.len;
    const ang = waveDirAngle + w.off;
    const dx = Math.sin(ang), dz = Math.cos(ang);
    h += w.amp * shallow * Math.sin(k * (dx * x + dz * z) - w.spd * k * time);
  }
  return h;
}
/** Approximate surface normal — used to tilt hulls with the swell. */
export function waveTilt(x, z, out) {
  const e = 6;
  const hx = waveHeight(x + e, z) - waveHeight(x - e, z);
  const hz = waveHeight(x, z + e) - waveHeight(x, z - e);
  out.x = -hx / (2 * e); out.z = -hz / (2 * e);
  return out;
}
function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
export const getWaterTime = () => time;
