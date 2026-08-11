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

function rig(cls, col) {
  const L = cls.len, B = cls.beam, FB = B * 0.30;
  const deckY = FB * 0.75;
  const spars = [], sails = [];
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
    // yards
    const yardW = B * (n === 1 ? 1.5 : 1.28);
    const nYards = h > L * 0.9 ? 2 : (mi === n - 1 && n > 1 ? 1 : 2);
    for (let k = 0; k < nYards; k++) {
      const yy = deckY + h * (0.42 + k * 0.34);
      spars.push(prep(xf(new THREE.BoxGeometry(yardW * (1 - k * 0.22), 0.22, 0.22), { y: yy, z: mz }), 0x7d6242));
      // square sail — bellied toward the stern
      const sw = yardW * (1 - k * 0.22) * 0.94, sh = h * 0.30;
      const sg = bellySail(sw, sh, 0.20 * B);
      xf(sg, { y: yy - sh / 2, z: mz });
      sails.push(prep(sg, cSail.getHex(), 0.05));
    }
  });

  // fore-and-aft jib
  {
    const sg = triSail(L * 0.30, mastH * 0.5, B * 0.16);
    xf(sg, { y: deckY + mastH * 0.30, z: L * (n === 1 ? 0.30 : 0.46) });
    sails.push(prep(sg, cSail.clone().multiplyScalar(0.97).getHex(), 0.04));
  }
  // spanker at the stern for multi-masted rigs
  if (n > 1) {
    const sg = bellySail(B * 0.9, mastH * 0.34, B * 0.14);
    xf(sg, { x: B * 0.02, y: deckY + mastH * 0.28, z: mastZ[mastZ.length - 1] - L * 0.12, ry: 0.16 });
    sails.push(prep(sg, cSail.clone().multiplyScalar(0.95).getHex(), 0.04));
  }
  return { spars, sails, mastTop: deckY + mastH * 1.02, mastZ: mastZ[0], deckY };
}

/** A square sail with a wind belly (curved along X and Z). */
function bellySail(w, h, belly) {
  const NX = 4, NY = 3;
  const g = new THREE.PlaneGeometry(w, h, NX, NY);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const u = (x / w) * 2, v = (y / h) + 0.5;
    const b = Math.cos(u * Math.PI * 0.5) * Math.sin(v * Math.PI) * belly;
    p.setZ(i, -b - 0.05);
  }
  p.needsUpdate = true;
  return g.toNonIndexed();
}
function triSail(len, h, belly) {
  const g = new THREE.BufferGeometry();
  const pts = [];
  const N = 4;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const z0 = -len * t0, z1 = -len * t1;
    const y0 = h * t0, y1 = h * t1;
    const b0 = Math.sin(t0 * Math.PI) * belly, b1 = Math.sin(t1 * Math.PI) * belly;
    pts.push(b0, -y0 * 0 + y0 * 0, z0, b1, y1 * 0, z1, b1, -h * (1 - t1) * 0 + 0, z1);
  }
  // simple triangular sheet: bow point -> masthead -> deck
  const A = [0, 0, 0], Bv = [0, h, -len * 0.15], C = [0, 0, -len];
  const tri = [];
  const M = 3;
  for (let i = 0; i < M; i++) {
    const s0 = i / M, s1 = (i + 1) / M;
    const p0 = mix3(A, Bv, s0), p1 = mix3(A, Bv, s1);
    const q0 = mix3(C, Bv, s0), q1 = mix3(C, Bv, s1);
    const bl = (p) => [p[0] + Math.sin((p[1] / h) * Math.PI) * belly, p[1], p[2]];
    const a = bl(p0), b = bl(p1), c = bl(q1), d = bl(q0);
    tri.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri), 3));
  g.computeVertexNormals();
  void pts;
  return g;
}
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

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

  const sailGeo = mergeGeos(rigParts.sails);
  const sailMesh = new THREE.Mesh(sailGeo, litMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1 }));
  sailMesh.name = 'sails';
  group.add(sailMesh);

  // flag at the masthead
  const fg = new THREE.PlaneGeometry(cls.beam * 0.72, cls.beam * 0.42, 3, 1);
  xf(fg, { x: cls.beam * 0.36 });
  const flagMesh = new THREE.Mesh(prep(fg, col.flag, 0.04), litMaterial({ side: THREE.DoubleSide }));
  flagMesh.position.set(0, rigParts.mastTop, rigParts.mastZ);
  flagMesh.name = 'flag';
  group.add(flagMesh);

  group.userData = {
    cls, mastTop: rigParts.mastTop, deckY: rigParts.deckY,
    ports: gunPorts(cls), bodyMesh, sailMesh, flagMesh,
    baseSailScale: 1,
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
