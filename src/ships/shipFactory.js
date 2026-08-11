/* ===========================================================
   Procedural ships. Every hull is lofted from stations so the
   silhouette reads at a glance: sharp bow, broad waist, high
   stern. Rig and colour come from the hull class and faction.
   Each ship is 3 meshes: body, sails, flag.
   =========================================================== */
import * as THREE from 'three';
import { mergeGeos, prep, xf, litMaterial } from '../core/geo.js';
import { HULLS, FACTIONS } from '../data/gamedata.js';
import { lerp, clamp01 } from '../core/util.js';

const STATIONS = 11;

/* hull cross-section profile helpers, t: 0 = stern, 1 = bow */
const widthAt = t => Math.pow(Math.sin(Math.PI * (0.13 + 0.85 * t)), 0.72);
const sheerAt = t => 1 + 0.85 * Math.pow(Math.abs(t - 0.42) / 0.58, 2.3);
const keelAt = t => 1 - 0.75 * clamp01((t - 0.52) / 0.48) ** 1.7 - 0.18 * clamp01((0.16 - t) / 0.16);

function hullGeometry(cls, col) {
  const L = cls.len, B = cls.beam, D = B * 0.52, FB = B * 0.30;
  const pos = [], colr = [];
  const cHull = new THREE.Color(col.hull);
  const cBelow = new THREE.Color(col.hull).multiplyScalar(0.42).lerp(new THREE.Color(0x2b2118), 0.5);
  const cTrim = new THREE.Color(col.trim);
  const cDeck = new THREE.Color(0xb99a6c);
  const tmp = new THREE.Color();

  const ring = (t) => {
    const w = (B / 2) * widthAt(t), d = -D * keelAt(t), fb = FB * sheerAt(t);
    const z = (t - 0.5) * L;
    return [
      [0, d, z], [w * 0.62, d * 0.55, z], [w, -0.05, z], [w * 0.93, fb, z],
      [-w * 0.93, fb, z], [-w, -0.05, z], [-w * 0.62, d * 0.55, z],
    ];
  };

  const shade = (y, out) => {
    if (y < -0.15) out.copy(cBelow).lerp(cHull, clamp01((y + D) / (D * 0.9)) * 0.5);
    else if (y > FB * 0.72) out.copy(cTrim);
    else out.copy(cHull);
    return out;
  };

  const push = (p, c) => { pos.push(p[0], p[1], p[2]); colr.push(c.r, c.g, c.b); };
  const quad = (a, b, c, d) => {
    const j = 1 + (Math.random() - 0.5) * 0.07;
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      for (const v of [p, q, r]) { shade(v[1], tmp).multiplyScalar(j); push(v, tmp); }
    }
  };

  const rings = [];
  for (let i = 0; i < STATIONS; i++) rings.push(ring(i / (STATIONS - 1)));

  for (let i = 0; i < STATIONS - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < a.length; k++) {
      const k2 = (k + 1) % a.length;
      if (k === 3) continue; // deck opening (port->starboard gap)
      quad(a[k], b[k], b[k2], a[k2]);
    }
  }
  // transom (stern cap) + bow cap
  const cap = (r, flip) => {
    const cx = [0, 0, 0];
    for (const p of r) { cx[0] += p[0] / r.length; cx[1] += p[1] / r.length; cx[2] += p[2] / r.length; }
    for (let k = 0; k < r.length; k++) {
      const k2 = (k + 1) % r.length;
      const tri = flip ? [cx, r[k2], r[k]] : [cx, r[k], r[k2]];
      const j = 1 + (Math.random() - 0.5) * 0.06;
      for (const v of tri) { shade(v[1], tmp).multiplyScalar(j); push(v, tmp); }
    }
  };
  cap(rings[0], false);
  cap(rings[STATIONS - 1], true);

  // outward-facing fixup: the loft is hand-built, so make every triangle
  // point away from the centre-line before normals are computed
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
    const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    // reference: outward from the keel axis at this station
    const rx = mx, ry = my + D * 0.35, rz = 0;
    if (nx * rx + ny * ry + nz * rz < 0) {
      pos[i + 3] = cx; pos[i + 4] = cy; pos[i + 5] = cz;
      pos[i + 6] = bx; pos[i + 7] = by; pos[i + 8] = bz;
      const c1 = colr.slice(i + 3, i + 6), c2 = colr.slice(i + 6, i + 9);
      colr[i + 3] = c2[0]; colr[i + 4] = c2[1]; colr[i + 5] = c2[2];
      colr[i + 6] = c1[0]; colr[i + 7] = c1[1]; colr[i + 8] = c1[2];
    }
    void rz;
  }

  // deck surface, set down inside the gunwale
  for (let i = 0; i < STATIONS - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    const dy = -FB * 0.45;
    const inset = 0.9;
    const p0 = [a[3][0] * inset, a[3][1] + dy, a[3][2]];
    const p1 = [b[3][0] * inset, b[3][1] + dy, b[3][2]];
    const p2 = [b[4][0] * inset, b[4][1] + dy, b[4][2]];
    const p3 = [a[4][0] * inset, a[4][1] + dy, a[4][2]];
    const j = 1 + (Math.random() - 0.5) * 0.09;
    tmp.copy(cDeck).multiplyScalar(j);
    for (const v of [p0, p2, p1, p0, p3, p2]) push(v, tmp);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3));
  g.computeVertexNormals();
  return g;
}

/** Where the guns poke out. Returns array of {x,y,z, side} in local space. */
export function gunPorts(cls) {
  const perSide = Math.max(1, Math.round(cls.guns / 2));
  const out = [];
  const L = cls.len, B = cls.beam, FB = B * 0.30;
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    for (let i = 0; i < perSide; i++) {
      const t = 0.24 + (perSide === 1 ? 0.26 : (i / (perSide - 1)) * 0.5);
      const w = (B / 2) * widthAt(t) * 0.98;
      out.push({ x: side * w, y: FB * sheerAt(t) * 0.42, z: (t - 0.5) * L, side: side > 0 ? 'stb' : 'port' });
    }
  }
  return out;
}

function detailGeos(cls, col) {
  const parts = [];
  const L = cls.len, B = cls.beam, FB = B * 0.30;
  const deckY = FB * 0.75;

  // rails
  for (const s of [1, -1]) {
    for (let i = 0; i < 7; i++) {
      const t = 0.14 + i * 0.11;
      const w = (B / 2) * widthAt(t) * 0.93;
      parts.push(prep(xf(new THREE.BoxGeometry(0.22, 1.0, 0.22), { x: s * w, y: FB * sheerAt(t) + 0.4, z: (t - 0.5) * L }), 0x8a7048));
    }
  }
  // gun barrels
  for (const p of gunPorts(cls)) {
    const g = new THREE.CylinderGeometry(0.24, 0.30, B * 0.42, 5);
    xf(g, { x: p.x + Math.sign(p.x) * B * 0.14, y: p.y, z: p.z, rz: Math.PI / 2 });
    parts.push(prep(g, 0x2e2a26));
    parts.push(prep(xf(new THREE.BoxGeometry(0.25, 1.5, 1.5), { x: p.x, y: p.y, z: p.z }), 0x3a2b1e));
  }
  // stern cabin / quarterdeck
  if (cls.len > 17) {
    const ch = B * 0.42, cl = L * 0.22;
    parts.push(prep(xf(new THREE.BoxGeometry(B * 0.66, ch, cl, 1, 1, 1), { y: deckY + ch * 0.5, z: -L * 0.31 }), col.hull, 0.06));
    parts.push(prep(xf(new THREE.BoxGeometry(B * 0.70, 0.4, cl * 1.06), { y: deckY + ch, z: -L * 0.31 }), col.trim, 0.05));
    // stern windows
    parts.push(prep(xf(new THREE.BoxGeometry(B * 0.44, ch * 0.4, 0.3), { y: deckY + ch * 0.55, z: -L * 0.31 - cl * 0.5 }), 0x5c7f8c));
  }
  // hatch + capstan
  parts.push(prep(xf(new THREE.BoxGeometry(B * 0.34, 0.5, L * 0.14), { y: deckY + 0.2, z: L * 0.02 }), 0x6f5636));
  parts.push(prep(xf(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 6), { y: deckY + 0.6, z: L * 0.16 }), 0x7d6242));

  // bowsprit
  const bs = new THREE.CylinderGeometry(0.20, 0.32, L * 0.34, 5);
  xf(bs, { y: FB * sheerAt(1) * 0.9, z: L * 0.56, rx: Math.PI / 2 - 0.28 });
  parts.push(prep(bs, 0x7a5c38));

  // rudder
  parts.push(prep(xf(new THREE.BoxGeometry(0.3, B * 0.5, B * 0.32), { y: -B * 0.2, z: -L * 0.5 - 0.2 }), 0x5b4429));

  return parts;
}

/* ===========================================================
   The rig is built flat and unbraced. Yards and canvas carry a
   pivot and a (u,v) parameter per vertex, and the shader swings
   them round and bellies the cloth to leeward from the live wind.
   That way the sails read the wind the way the compass does, and
   there is still one draw call for the whole rig.
   =========================================================== */
function rig(cls, col) {
  const L = cls.len, B = cls.beam, FB = B * 0.30;
  const deckY = FB * 0.75;
  const spars = [];       // masts: fixed, they belong to the hull mesh
  const parts = [];       // yards + canvas: braced by the shader
  const n = cls.masts;
  const mastH = L * (n === 1 ? 1.02 : 0.86);
  const cSail = new THREE.Color(col.sail);

  const mastZ = [];
  if (n === 1) mastZ.push(L * 0.06);
  else if (n === 2) mastZ.push(L * 0.24, -L * 0.16);
  else mastZ.push(L * 0.28, L * 0.0, -L * 0.26);

  mastZ.forEach((mz, mi) => {
    const h = mastH * (mi === 1 && n === 3 ? 1.1 : 1.0);
    spars.push(prep(xf(new THREE.CylinderGeometry(0.22, 0.36, h, 6), { y: deckY + h / 2, z: mz }), 0x8b6c44));

    const yardW = B * (n === 1 ? 1.5 : 1.28);
    const nYards = h > L * 0.9 ? 2 : (mi === n - 1 && n > 1 ? 1 : 2);
    for (let k = 0; k < nYards; k++) {
      const yy = deckY + h * (0.42 + k * 0.34);
      const pivot = [0, yy, mz];
      const w = yardW * (1 - k * 0.22);
      // the yard swings with its sail
      parts.push(rigPart(
        prep(xf(new THREE.BoxGeometry(w, 0.22, 0.22), { y: yy, z: mz }), 0x7d6242),
        pivot, 0, 0, 0, null));
      // flat canvas hanging from it; the belly is applied in the shader
      const sh = h * 0.30;
      const sg = new THREE.PlaneGeometry(w * 0.94, sh, 4, 3).toNonIndexed();
      const uv = flatSailParams(sg);
      xf(sg, { y: yy - sh / 2, z: mz });
      parts.push(rigPart(prep(sg, cSail.getHex(), 0.05), pivot, 0, 1, 0.24 * B, uv));
    }
  });

  // headsail: fore-and-aft, sheeted to leeward
  {
    const tackZ = L * (n === 1 ? 0.30 : 0.46);
    const { geo, params } = triSail(L * 0.30, mastH * 0.5);
    xf(geo, { y: deckY + mastH * 0.30, z: tackZ });
    parts.push(rigPart(prep(geo, cSail.clone().multiplyScalar(0.97).getHex(), 0.04),
      [0, deckY, tackZ], 1, 1, B * 0.20, params));
  }
  // spanker at the stern for multi-masted rigs
  if (n > 1) {
    const mz = mastZ[mastZ.length - 1];
    const sw = B * 0.9, sh = mastH * 0.34;
    const sg = new THREE.PlaneGeometry(sw, sh, 3, 3).toNonIndexed();
    const uv = flatSailParams(sg);
    xf(sg, { y: deckY + mastH * 0.28, z: mz - L * 0.12 });
    parts.push(rigPart(prep(sg, cSail.clone().multiplyScalar(0.95).getHex(), 0.04),
      [0, deckY, mz], 1, 1, B * 0.17, uv));
  }
  return { spars, parts, mastTop: deckY + mastH * 1.02, mastZ: mastZ[0], deckY };
}

/** Read (u,v) off a plane's own uvs: u across the sail, v from head to foot. */
function flatSailParams(planeGeo) {
  const uv = planeGeo.attributes.uv;
  const out = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    out[i * 2] = uv.getX(i) * 2 - 1;     // -1 .. 1 across
    out[i * 2 + 1] = 1 - uv.getY(i);     // 0 at the head, 1 at the foot
  }
  return out;
}

/** Tag a geometry with everything the rig shader needs. */
function rigPart(geo, pivot, kind, cloth, belly, uvSrc) {
  const n = geo.attributes.position.count;
  const aPivot = new Float32Array(n * 3);
  const aParam = new Float32Array(n * 3);
  const aCloth = new Float32Array(n);
  const aBelly = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    aPivot[i * 3] = pivot[0]; aPivot[i * 3 + 1] = pivot[1]; aPivot[i * 3 + 2] = pivot[2];
    aParam[i * 3 + 2] = kind;
    aCloth[i] = cloth;
    aBelly[i] = belly;
  }
  if (uvSrc) {
    for (let i = 0; i < n; i++) {
      aParam[i * 3] = uvSrc[i * 2];
      aParam[i * 3 + 1] = uvSrc[i * 2 + 1];
    }
  }
  geo.setAttribute('aPivot', new THREE.BufferAttribute(aPivot, 3));
  geo.setAttribute('aParam', new THREE.BufferAttribute(aParam, 3));
  geo.setAttribute('aCloth', new THREE.BufferAttribute(aCloth, 1));
  geo.setAttribute('aBelly', new THREE.BufferAttribute(aBelly, 1));
  return geo;
}
/** A flat triangular headsail: tack forward, head aloft, clew aft.
    Returns the geometry plus (u,v) per vertex for the belly in the shader. */
function triSail(len, h) {
  const g = new THREE.BufferGeometry();
  const A = [0, 0, 0], Bv = [0, h, -len * 0.15], C = [0, 0, -len];
  const tri = [], par = [];
  const M = 3;
  const push = (p, u, v) => { tri.push(p[0], p[1], p[2]); par.push(u, v); };
  for (let i = 0; i < M; i++) {
    const s0 = i / M, s1 = (i + 1) / M;
    const p0 = mix3(A, Bv, s0), p1 = mix3(A, Bv, s1);   // luff, forward edge
    const q0 = mix3(C, Bv, s0), q1 = mix3(C, Bv, s1);   // leech, after edge
    // u runs -1 at the luff to +1 at the leech; v from head (0) to foot (1)
    push(p0, -1, 1 - s0); push(p1, -1, 1 - s1); push(q1, 1, 1 - s1);
    push(p0, -1, 1 - s0); push(q1, 1, 1 - s1); push(q0, 1, 1 - s0);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri), 3));
  g.computeVertexNormals();
  return { geo: g, params: new Float32Array(par) };
}
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/* ---------------- rig merge + material ---------------- */
const RIG_ATTRS = [['aPivot', 3], ['aParam', 3], ['aCloth', 1], ['aBelly', 1]];

function mergeRig(geos) {
  const list = geos.filter(g => g && g.attributes.position);
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ...RIG_ATTRS]) {
    const buf = new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[name];
      const n = g.attributes.position.count;
      if (a) buf.set(a.array.subarray(0, n * size), o * size);
      o += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(buf, size));
  }
  for (const g of list) g.dispose();
  return out;
}

/**
 * Lambert, plus a vertex stage that swings the yards round and bellies the
 * canvas to leeward from the live wind. `uRel` is the wind's bearing relative
 * to the ship's head: 0 = dead astern (running), ±PI = dead ahead (in irons).
 */
function makeRigMaterial() {
  const mat = litMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const uniforms = { uRel: { value: 0 }, uHealth: { value: 1 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRel = uniforms.uRel;
    shader.uniforms.uHealth = uniforms.uHealth;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aPivot;
        attribute vec3 aParam;   // u across, v head-to-foot, kind (0 square, 1 fore-and-aft)
        attribute float aCloth;  // 1 = canvas, 0 = spar
        attribute float aBelly;
        uniform float uRel;
        uniform float uHealth;
        float rigCt, rigSt, rigWs, rigWc, rigFill;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        rigWs = sin(uRel); rigWc = cos(uRel);
        // square yards brace round to about half the wind angle; booms swing
        // out to leeward. Both are capped the way standing rigging caps them.
        float rigTh = (aParam.z < 0.5)
          ? clamp(uRel * 0.5, -1.05, 1.05)
          : clamp(-rigWs * 1.05, -1.15, 1.15);
        rigCt = cos(rigTh); rigSt = sin(rigTh);
        rigFill = mix(0.08, 1.0, smoothstep(3.05, 1.15, abs(uRel)));
        objectNormal = vec3(
          objectNormal.x * rigCt + objectNormal.z * rigSt,
          objectNormal.y,
          -objectNormal.x * rigSt + objectNormal.z * rigCt);`)
      .replace('#include <begin_vertex>', `
        vec3 rigQ = position - aPivot;
        if (aCloth > 0.5) {
          // shot-away canvas is reefed up to its yard and narrowed
          rigQ.y *= mix(0.30, 1.0, uHealth);
          rigQ.x *= mix(0.68, 1.0, uHealth);
        }
        vec3 transformed = vec3(
          rigQ.x * rigCt + rigQ.z * rigSt,
          rigQ.y,
          -rigQ.x * rigSt + rigQ.z * rigCt) + aPivot;
        if (aCloth > 0.5) {
          float bulge = cos(aParam.x * 1.5707963) * sin(aParam.y * 3.14159265)
                      * aBelly * rigFill * mix(0.25, 1.0, uHealth);
          transformed += vec3(rigWs, 0.0, rigWc) * bulge;
        }`);
  };
  return mat;
}

/** Build a complete ship object3D + metadata. */
export function buildShip(classId, factionId, opts = {}) {
  const cls = HULLS[classId];
  const fac = FACTIONS[factionId] || FACTIONS.freehold;
  const col = { hull: opts.hull ?? fac.hull, trim: opts.trim ?? fac.trim, sail: opts.sail ?? fac.sail, flag: opts.flag ?? fac.flag };

  const group = new THREE.Group();
  const rigParts = rig(cls, col);
  const body = mergeGeos([hullGeometry(cls, col), ...detailGeos(cls, col), ...rigParts.spars]);
  const bodyMesh = new THREE.Mesh(body, litMaterial());
  bodyMesh.name = 'body';
  group.add(bodyMesh);

  const rigGeo = mergeRig(rigParts.parts);
  const rigMat = makeRigMaterial();
  const rigMesh = new THREE.Mesh(rigGeo, rigMat);
  rigMesh.name = 'rig';
  group.add(rigMesh);

  // flag at the masthead
  const fg = new THREE.PlaneGeometry(cls.beam * 0.72, cls.beam * 0.42, 3, 1);
  xf(fg, { x: cls.beam * 0.36 });
  const flagMesh = new THREE.Mesh(prep(fg, col.flag, 0.04), litMaterial({ side: THREE.DoubleSide }));
  flagMesh.position.set(0, rigParts.mastTop, rigParts.mastZ);
  flagMesh.name = 'flag';
  group.add(flagMesh);

  group.userData = {
    cls, mastTop: rigParts.mastTop, deckY: rigParts.deckY,
    ports: gunPorts(cls), bodyMesh, rigMesh, flagMesh,
    rigUniforms: rigMat.userData.uniforms,
  };
  return group;
}

/** Simplified far-LOD proxy: hull + a suggestion of sail. Used beyond ~700 units. */
export function buildShipLOD(classId, factionId) {
  const cls = HULLS[classId];
  const fac = FACTIONS[factionId] || FACTIONS.freehold;
  const parts = [];
  parts.push(prep(xf(new THREE.BoxGeometry(cls.beam * 0.8, cls.beam * 0.5, cls.len * 0.92), { y: 0 }), fac.hull));
  parts.push(prep(xf(new THREE.BoxGeometry(cls.beam * 1.2, cls.len * 0.5, 0.4), { y: cls.len * 0.32 }), fac.sail));
  const m = new THREE.Mesh(mergeGeos(parts), litMaterial());
  return m;
}
