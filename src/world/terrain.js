/* ===========================================================
   Terrain: height field, seabed depth texture, island meshes,
   settlements, vegetation.
   The height field is authored analytically, then baked into a
   grid (for fast gameplay queries) and a texture (for the water
   shader, which uses it to tint shallows and draw shore foam).
   =========================================================== */
import * as THREE from 'three';
import { ISLANDS, REEFS, PORTS, WORLD_SIZE } from '../data/gamedata.js';
import { clamp, clamp01, smoothstep, fbm, makeRNG, rngRange, rngInt, lerp } from '../core/util.js';
import { mergeGeos, prep, xf, taperedBox, litMaterial } from '../core/geo.js';

export const SEA_FLOOR = -70;
export const HEIGHT_SPAN = 140; // maps [-70, +70] into 0..1

const GRID = 384;                       // bake resolution
const CELL = WORLD_SIZE / (GRID - 1);
let heightGrid = null;

/* ---------------- analytic height ---------------- */
function analyticHeight(x, z) {
  let h = SEA_FLOOR;

  // a soft continental shelf so the far ocean reads as deep
  const rEdge = Math.hypot(x, z) / (WORLD_SIZE * 0.5);
  h += -8 * smoothstep(0.55, 1.0, rEdge);

  for (const isl of ISLANDS) {
    for (const b of isl.blobs) {
      const cx = isl.x + b.x, cz = isl.z + b.z;
      const dx = x - cx, dz = z - cz;
      let d = Math.hypot(dx, dz);
      // wobble the coastline
      const a = Math.atan2(dz, dx);
      d += fbm(Math.cos(a) * 2.1 + isl.seed, Math.sin(a) * 2.1 - isl.seed, 3) * b.r * 0.24;
      if (d > b.r * 1.35) continue;
      const t = smoothstep(b.r, b.r * 0.12, d);
      // rise from the seabed: below the waterline it slopes out into a shelf
      const val = -24 + (b.h + 24) * Math.pow(t, 1.55);
      if (val > h) h = val;
    }
    // ridge / dune detail on land
  }

  if (h > -30) {
    const n = fbm(x * 0.0055, z * 0.0055, 4) * 9 + fbm(x * 0.021, z * 0.021, 3) * 3.2;
    h += n * clamp01((h + 30) / 40);
  }

  for (const rf of REEFS) {
    const d = Math.hypot(x - rf.x, z - rf.z);
    if (d > rf.r * 1.2) continue;
    const a = Math.atan2(z - rf.z, x - rf.x);
    const wob = fbm(Math.cos(a) * 3.4 + rf.x * 0.01, Math.sin(a) * 3.4, 3) * rf.r * 0.3;
    const t = smoothstep(rf.r + wob, rf.r * 0.2, d);
    const ridge = Math.abs(fbm(x * 0.012, z * 0.012, 3));
    const val = lerp(-30, -3.0 - rf.depth * 8 + ridge * 5.0, Math.pow(t, 1.4));
    if (val > h) h = val;
  }

  // carve harbours flat & deep enough to sail into
  for (const p of PORTS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.dockR * 1.5) {
      const t = smoothstep(p.dockR * 1.5, p.dockR * 0.3, d);
      h = lerp(h, Math.min(h, -14), t * 0.92);
    }
  }
  return h;
}

/* ---------------- bake ---------------- */
export function bakeHeights() {
  heightGrid = new Float32Array(GRID * GRID);
  const half = WORLD_SIZE * 0.5;
  for (let j = 0; j < GRID; j++) {
    const z = -half + j * CELL;
    for (let i = 0; i < GRID; i++) {
      heightGrid[j * GRID + i] = analyticHeight(-half + i * CELL, z);
    }
  }
  return heightGrid;
}

/* Raise the baked field around a point — a rubble footing stamped in after the
   bake, because harbour works are laid out from the shore search, which needs
   the bake done first. Everything that reads heightAt (hulls, the AI's probes,
   the route grid, the water shader's texture) then agrees the works are there.
   The stones used to be scenery: a 22-metre block of League masonry a cutter
   could sail through the middle of. */
function raiseSeabed(x, z, r, top) {
  const half = WORLD_SIZE * 0.5;
  const i0 = Math.max(0, Math.floor((x - r + half) / CELL)), i1 = Math.min(GRID - 1, Math.ceil((x + r + half) / CELL));
  const j0 = Math.max(0, Math.floor((z - r + half) / CELL)), j1 = Math.min(GRID - 1, Math.ceil((z + r + half) / CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(-half + i * CELL - x, -half + j * CELL - z);
      if (d > r) continue;
      const v = top - (d / r) * (d / r) * (top + 11);   // core awash, toes on the bottom
      const o = j * GRID + i;
      if (v > heightGrid[o]) heightGrid[o] = v;
    }
  }
}

/** Bilinear sample of the baked field. Fast enough to call per-ship per-frame. */
export function heightAt(x, z) {
  const half = WORLD_SIZE * 0.5;
  const fx = (x + half) / CELL, fz = (z + half) / CELL;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= GRID - 1 || j >= GRID - 1) return SEA_FLOOR - 10;
  const tx = fx - i, tz = fz - j;
  const g = heightGrid, o = j * GRID + i;
  const a = g[o], b = g[o + 1], c = g[o + GRID], d = g[o + GRID + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
export const depthAt = (x, z) => -heightAt(x, z);

/** Texture the water shader samples: R = normalised terrain height. */
export function makeDepthTexture() {
  const N = GRID;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = heightGrid[j * N + i];
      const t = clamp01((h - SEA_FLOOR) / HEIGHT_SPAN);
      const o = (j * N + i) * 4;
      data[o] = (t * 255) | 0; data[o + 1] = data[o]; data[o + 2] = data[o]; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------- island geometry ---------------- */
const C_SAND = new THREE.Color(0xe0c896);
const C_WETSAND = new THREE.Color(0xb69a6e);
const C_GRASS = new THREE.Color(0x6d8d4e);
const C_GRASS_D = new THREE.Color(0x4f7040);
const C_ROCK = new THREE.Color(0x8d8577);
const C_ROCK_D = new THREE.Color(0x6b655c);
const C_SEABED = new THREE.Color(0x93825e);

/* The Iron Sound is dark wet rock with almost nothing growing on it, and the
   Glass Reach is pale sand barely out of the water. Both are the same shading
   function with a different palette, because the geography is the argument
   each of those factions makes and it should be legible from a mile off. */
const C_IRON = new THREE.Color(0x4a4f55);
const C_IRON_D = new THREE.Color(0x33383d);
const C_IRON_SCRUB = new THREE.Color(0x4f5a4a);
const C_PALE = new THREE.Color(0xe8dcbb);
const C_PALE_SCRUB = new THREE.Color(0x9fb383);

function shadeLand(h, slope, out, ground) {
  if (ground === 'iron') {
    if (h < -1.2) out.copy(C_SEABED).lerp(C_IRON_D, clamp01((h + 14) / 13));
    else if (h < 3) out.copy(C_IRON_D).lerp(C_IRON, clamp01((h + 1.2) / 4.2));
    else if (h < 40) out.copy(C_IRON).lerp(C_IRON_SCRUB, clamp01((h - 3) / 37) * 0.5);
    else out.copy(C_IRON).lerp(C_IRON_D, clamp01((h - 40) / 60));
    if (slope > 0.5) out.lerp(C_IRON_D, clamp01((slope - 0.5) / 0.34) * 0.9);
    return out;
  }
  if (ground === 'pale') {
    if (h < -1.2) out.copy(C_SEABED).lerp(C_PALE, clamp01((h + 14) / 13) * 0.7);
    else if (h < 4) out.copy(C_PALE);
    else out.copy(C_PALE).lerp(C_PALE_SCRUB, clamp01((h - 4) / 20));
    if (slope > 0.7) out.lerp(C_ROCK, clamp01((slope - 0.7) / 0.3) * 0.5);
    return out;
  }
  if (h < -1.2) out.copy(C_SEABED).lerp(C_WETSAND, clamp01((h + 14) / 13));
  else if (h < 2.2) out.copy(C_WETSAND).lerp(C_SAND, clamp01((h + 1.2) / 3.4));
  else if (h < 8) out.copy(C_SAND).lerp(C_GRASS, clamp01((h - 2.2) / 5.8));
  else if (h < 42) out.copy(C_GRASS).lerp(C_GRASS_D, clamp01((h - 8) / 34));
  else out.copy(C_GRASS_D).lerp(C_ROCK, clamp01((h - 42) / 26));
  if (slope > 0.62) out.lerp(C_ROCK_D, clamp01((slope - 0.62) / 0.3) * 0.8);
  return out;
}

/* What this one island's own blobs raise at (x, z) — the same maths as the
   island term in analyticHeight, so the comparison below is exact. */
function islandContribution(isl, x, z) {
  let best = -1e9;
  for (const b of isl.blobs) {
    const cx = isl.x + b.x, cz = isl.z + b.z;
    const dx = x - cx, dz = z - cz;
    let d = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    d += fbm(Math.cos(a) * 2.1 + isl.seed, Math.sin(a) * 2.1 - isl.seed, 3) * b.r * 0.24;
    if (d > b.r * 1.35) continue;
    const t = smoothstep(b.r, b.r * 0.12, d);
    const val = -24 + (b.h + 24) * Math.pow(t, 1.55);
    if (val > best) best = val;
  }
  return best;
}

function islandBounds(isl) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const b of isl.blobs) {
    minX = Math.min(minX, isl.x + b.x - b.r * 1.6); maxX = Math.max(maxX, isl.x + b.x + b.r * 1.6);
    minZ = Math.min(minZ, isl.z + b.z - b.r * 1.6); maxZ = Math.max(maxZ, isl.z + b.z + b.r * 1.6);
  }
  return { minX, maxX, minZ, maxZ };
}

function islandMesh(isl) {
  const { minX, maxX, minZ, maxZ } = islandBounds(isl);

  /* Neighbours whose bounding boxes cross ours. Where boxes overlap, both
     meshes used to build the same shared ground — Bellcurrent's mesh rebuilt
     Sable Head's mound in grass green on top of the iron original, and the
     two copies z-fought as coloured shards up the hillside. Each patch of
     ground now belongs to whichever island raises it highest, and only the
     owner builds it. */
  const rivals = ISLANDS.filter(o => {
    if (o === isl) return false;
    const b = islandBounds(o);
    return b.minX < maxX && b.maxX > minX && b.minZ < maxZ && b.maxZ > minZ;
  });
  const step = 11;
  const nx = Math.ceil((maxX - minX) / step), nz = Math.ceil((maxZ - minZ) / step);
  const sx = (maxX - minX) / nx, sz = (maxZ - minZ) / nz;

  // The shelf around an island sits within a metre of the waterline over a
  // wide area, so the beach and the sea plane interleave and the seabed shows
  // through as flat grey shards. Bias the submerged part down — continuously,
  // so the shoreline itself does not step — and the sea covers it cleanly.
  // Only the mesh moves: the depth field the water and gameplay read is untouched.
  const sink = h => (h < 0 ? h * 1.35 - 0.9 * smoothstep(0, -1.5, h) : h);

  const H = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++)
      H[j * (nx + 1) + i] = sink(analyticHeight(minX + i * sx, minZ + j * sz));

  const pos = [], col = [];
  const cA = new THREE.Color(), tmpN = new THREE.Vector3();
  const v = (i, j) => [minX + i * sx, H[j * (nx + 1) + i], minZ + j * sz];
  const CUT = -13; // don't build geometry deeper than this — water hides it

  const tri = (p0, p1, p2) => {
    const hMax = Math.max(p0[1], p1[1], p2[1]);
    if (hMax < CUT) return;
    if (rivals.length) {
      const mx = (p0[0] + p1[0] + p2[0]) / 3, mz = (p0[2] + p1[2] + p2[2]) / 3;
      const mine = islandContribution(isl, mx, mz);
      // strictly greater: where neither owns it (open reef, shelf), keep it —
      // a hole is worse than the harmless double-build this used to be
      for (const o of rivals) if (islandContribution(o, mx, mz) > mine) return;
    }
    tmpN.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
      .cross(new THREE.Vector3(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2])).normalize();
    const slope = 1 - Math.abs(tmpN.y);
    const hAvg = (p0[1] + p1[1] + p2[1]) / 3;
    shadeLand(hAvg, slope, cA, isl.ground);
    const j2 = 1 + (Math.random() - 0.5) * 0.11;
    for (const p of [p0, p1, p2]) { pos.push(p[0], p[1], p[2]); col.push(cA.r * j2, cA.g * j2, cA.b * j2); }
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1);
      tri(a, c, b); tri(b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

/* ---------------- vegetation & rocks ---------------- */
function scatterProps(isl, group) {
  const rng = makeRNG(isl.seed * 7919 + 13);
  const trunks = [], canopy = [], rocks = [];
  const dummy = new THREE.Object3D();

  let attempts = 0;
  const trees = [];
  while (trees.length < isl.trees && attempts < isl.trees * 40) {
    attempts++;
    const b = isl.blobs[(rng() * isl.blobs.length) | 0];
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * b.r * 0.86;
    const x = isl.x + b.x + Math.cos(a) * r, z = isl.z + b.z + Math.sin(a) * r;
    const h = analyticHeight(x, z);
    if (h < 4.5 || h > 66) continue;
    const hl = analyticHeight(x + 4, z), hr = analyticHeight(x - 4, z);
    if (Math.abs(hl - hr) > 7) continue;
    trees.push([x, h, z, rngRange(rng, 0.75, 1.45), rng()]);
  }
  attempts = 0;
  const stones = [];
  while (stones.length < isl.rocks && attempts < isl.rocks * 40) {
    attempts++;
    const b = isl.blobs[(rng() * isl.blobs.length) | 0];
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * b.r * 1.02;
    const x = isl.x + b.x + Math.cos(a) * r, z = isl.z + b.z + Math.sin(a) * r;
    const h = analyticHeight(x, z);
    if (h < -3 || h > 80) continue;
    stones.push([x, h, z, rngRange(rng, 1.6, 5.2), rng() * 6.28]);
  }

  if (trees.length) {
    const trunkG = prep(new THREE.CylinderGeometry(0.5, 0.8, 5, 5), 0x6b5236);
    const canG = prep(new THREE.ConeGeometry(3.4, 9, 6), 0x53763f, 0.14);
    const canG2 = prep(new THREE.ConeGeometry(4.0, 6, 5), 0x668a45, 0.14);
    const tm = new THREE.InstancedMesh(trunkG, litMaterial(), trees.length);
    const cm = new THREE.InstancedMesh(canG, litMaterial(), trees.length);
    const cm2 = new THREE.InstancedMesh(canG2, litMaterial(), trees.length);
    trees.forEach((t, i) => {
      const [x, y, z, s, v] = t;
      dummy.position.set(x, y + 2.2 * s, z); dummy.rotation.set(0, v * 6.28, 0); dummy.scale.setScalar(s);
      dummy.updateMatrix(); tm.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y + 7.6 * s, z); dummy.updateMatrix(); cm.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y + 11.6 * s, z); dummy.scale.setScalar(s * 0.72); dummy.updateMatrix(); cm2.setMatrixAt(i, dummy.matrix);
    });
    group.add(tm, cm, cm2);
  }
  if (stones.length) {
    const rockG = prep(new THREE.IcosahedronGeometry(1, 0), 0x7f776a, 0.18);
    const rm = new THREE.InstancedMesh(rockG, litMaterial(), stones.length);
    stones.forEach((t, i) => {
      const [x, y, z, s, a] = t;
      dummy.position.set(x, y + s * 0.25, z);
      dummy.rotation.set(a * 0.3, a, a * 0.2);
      dummy.scale.set(s, s * rngRange(rng, 0.5, 0.9), s * rngRange(rng, 0.8, 1.2));
      dummy.updateMatrix(); rm.setMatrixAt(i, dummy.matrix);
    });
    group.add(rm);
  }
  void trunks; void canopy; void rocks;
}

/* ---------------- settlements ---------------- */
const WALLS = [0xe8ddc6, 0xdcc9a8, 0xcbb896, 0xe3d2b0];
const ROOFS = [0xa8503a, 0x8c4331, 0x7a5a3a, 0xb35f42, 0x5d6b6e];

function building(rng, w, h, d) {
  const parts = [];
  const wall = WALLS[(rng() * WALLS.length) | 0];
  const roof = ROOFS[(rng() * ROOFS.length) | 0];
  parts.push(prep(xf(taperedBox(w, h, d, 0.98, 0.98), { y: h / 2 }), wall, 0.07));
  const rg = new THREE.ConeGeometry(Math.max(w, d) * 0.79, h * 0.62, 4);
  parts.push(prep(xf(rg, { y: h + h * 0.31, ry: Math.PI / 4 }), roof, 0.09));
  return parts;
}

/** The nearest dry land to a mooring, and the unit vector pointing at it.
    Ties break toward the port's own declared bearing so a symmetric rock still
    faces the way its author intended. Falls back to that bearing if a mooring
    somehow has no land within reach at all. */
function nearestShore(x, z, declaredAng, maxD = 420) {
  const want = new THREE.Vector2(-Math.cos(declaredAng), -Math.sin(declaredAng));
  let best = null;
  for (let a = 0; a < 72; a++) {
    const th = (a / 72) * Math.PI * 2;
    const dx = Math.cos(th), dz = Math.sin(th);
    for (let d = 4; d < maxD; d += 4) {
      if (heightAtAnalytic(x + dx * d, z + dz * d) > 1.0) {
        // a shade of preference for the declared side, worth a few units
        const score = d - (dx * want.x + dz * want.y) * 12;
        if (!best || score < best.score) best = { score, d, dx, dz };
        break;
      }
    }
  }
  if (!best) {
    return { dir: want, point: new THREE.Vector2(x + want.x * 60, z + want.y * 60), dist: 60 };
  }
  return {
    dir: new THREE.Vector2(best.dx, best.dz),
    point: new THREE.Vector2(x + best.dx * best.d, z + best.dz * best.d),
    dist: best.d,
  };
}

/** Where each port's town actually stands, so a label can sit over the roofs
    instead of over the water its mooring happens to occupy. */
export const PORT_SHORE = {};

function buildSettlement(port, group) {
  const rng = makeRNG(port.id.length * 4211 + port.x | 0);
  const parts = [];
  const isMajor = port.size === 'major';
  const count = isMajor ? 26 : 11;

  // Find the waterfront by asking the terrain, not by trusting a hand-written
  // bearing: sweep every direction and take the nearest dry land. A port whose
  // angle was a degree out used to build its whole harbour in open water, and
  // nothing in the geometry noticed.
  const anchor = new THREE.Vector2(port.x, port.z);
  const shore = nearestShore(anchor.x, anchor.y, port.ang);
  const inland = shore.dir;
  const base = shore.point;
  const shoreRec = {
    x: base.x, z: base.y, dist: shore.dist,
    inland: { x: inland.x, z: inland.y },
    // a little way up the beach: the name belongs over the roofs
    townX: base.x + inland.x * (isMajor ? 46 : 34),
    townZ: base.y + inland.y * (isMajor ? 46 : 34),
    townY: 0,
    /* Where the town actually put its buildings and its piers.
       The settlement is procedural and used to throw these away the moment it
       had drawn them — which meant nothing could ever point at a particular
       building. The port screen frames real ones now, so the town records
       what it placed. Cheap: a few dozen small objects per port, built once. */
    spots: [],
    piers: [],
  };
  // clear of whatever the town is standing on — Escarra's is a 70-metre rock,
  // and a fixed height put its name inside the hill
  shoreRec.townY = Math.max(74, heightAtAnalytic(shoreRec.townX, shoreRec.townZ) + 46);
  PORT_SHORE[port.id] = shoreRec;
  const perpG = new THREE.Vector2(-inland.y, inland.x);

  /* ---- how a harbour town is laid out ----

     This used to be a scatter: a random distance along the shore, a random
     distance inland, and a random rotation through a full circle. From the
     deck at two hundred metres that reads as a town. Framed close for the
     port screen it reads as what it is — sheds dropped on a hillside at
     angles no builder would choose, some of them half-buried in a slope and
     some standing on one corner.

     A real waterfront grows in terraces: a dense front row facing the water,
     thinning as it climbs, everything square to the shore because that is
     where the road and the boats are. So:

       · rows at increasing distance inland, jittered so it is not a grid
       · every building faces the water, ±12° so it is not a parade
       · the ground under the whole footprint is sampled, not just its centre;
         too steep and nothing is built there, and what is built sits on the
         lowest corner so it digs in rather than floats
       · the front row is bigger — warehouses and the harbourmaster — and it
         thins and shrinks going up the hill

     The visible result is a town with a waterfront, which is also what makes
     a close-up of one of its buildings worth looking at. */
  const facing = Math.atan2(-inland.x, -inland.y);      // square to the water
  const rows = isMajor ? [22, 46, 72, 100, 132] : [20, 44, 70];
  const spread = isMajor ? 130 : 74;

  /** Is this footprint buildable, and how low does it sit? */
  const ground = (x, z, w, d) => {
    let lo = Infinity, hi = -Infinity;
    for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]]) {
      const gx = x + perpG.x * ox * w + inland.x * oz * d;
      const gz = z + perpG.y * ox * w + inland.y * oz * d;
      const h = heightAtAnalytic(gx, gz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return { lo, hi, slope: hi - lo };
  };

  /* Bands, not a grid.

     A fixed set of positions along each row does not survive real ground:
     measured under Ilo Vantu, one end of a row is twenty metres under water
     and the other is up a cliff, and a footprint there falls eight or nine
     metres across its own width. So each row is a band that is *searched* —
     candidates are tried until enough of them stand on ground a builder would
     accept. That keeps the terracing where the coast allows it and lets the
     town bend around the parts where it does not, which is what real ones do. */
  let placed = 0;
  for (let r = 0; r < rows.length && placed < count; r++) {
    const nearWater = 1 - r / rows.length;
    // dense at the front, thinning as it climbs
    const inRow = Math.max(2, Math.round((isMajor ? 7 : 4) * (0.45 + nearWater * 0.75)));
    let inThisRow = 0;
    for (let attempt = 0; attempt < inRow * 14 && inThisRow < inRow && placed < count; attempt++) {
      const along = rngRange(rng, -1, 1) * spread * (0.55 + nearWater * 0.45);
      const into = rows[r] + rngRange(rng, -9, 9);
      const x = base.x + inland.x * into + perpG.x * along;
      const z = base.y + inland.y * into + perpG.y * along;
      // bigger and squarer at the waterfront; cottages up the hill
      const w = rngRange(rng, 7, isMajor ? 15 : 11) * (0.72 + nearWater * 0.42);
      const d = rngRange(rng, 7, 13) * (0.72 + nearWater * 0.34);
      const bh = rngRange(rng, 6, isMajor ? 15 : 10) * (0.7 + nearWater * 0.45);
      const g = ground(x, z, w, d);
      /* No building on water, on a cliff, or on ground that falls away under
         it. Ten metres of fall across a footprint is the limit — measured,
         not guessed: this coast runs eight to nine under a normal house, and
         a stricter number built one shed and called it a town. */
      if (g.lo < 1.6 || g.hi > 46 || g.slope > 10) continue;
      // and not on top of a neighbour
      let clash = false;
      for (const o of shoreRec.spots) {
        if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < Math.pow((w + o.w) * 0.62, 2)) { clash = true; break; }
      }
      if (clash) continue;
      const ry = facing + rngRange(rng, -0.21, 0.21);
      for (const part of building(rng, w, bh, d)) parts.push(xf(part, { x, y: g.lo - 1, z, ry }));
      shoreRec.spots.push({ x, z, y: g.lo, w, h: bh, front: r === 0 });
      placed++; inThisRow++;
    }
  }

  // piers: run from the waterfront out over the water
  const pierCount = isMajor ? 3 : 2;
  const pierAng = Math.atan2(inland.x, inland.y);
  for (let i = 0; i < pierCount; i++) {
    const off = (i - (pierCount - 1) / 2) * (isMajor ? 48 : 36);
    const rootX = base.x + perpG.x * off + inland.x * 4;
    const rootZ = base.y + perpG.y * off + inland.y * 4;
    // long enough to reach out toward the mooring, never a stub or a causeway
    const reach = clampNum(shore.dist * 0.8, 34, 84);
    const len = reach * rngRange(rng, 0.85, 1.1);
    const midX = rootX - inland.x * len * 0.5, midZ = rootZ - inland.y * len * 0.5;
    parts.push(prep(xf(new THREE.BoxGeometry(6.5, 1.5, len), { x: midX, y: 2.4, z: midZ, ry: pierAng }), 0x8a6f4c, 0.09));
    shoreRec.piers.push({ x: midX, z: midZ });
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const lx = rootX - inland.x * len * t, lz = rootZ - inland.y * len * t;
      for (const s of [2.5, -2.5]) {
        parts.push(prep(xf(new THREE.CylinderGeometry(0.65, 0.65, 16, 5), {
          x: lx + perpG.x * s, y: -4.5, z: lz + perpG.y * s,
        }), 0x6a5136));
      }
    }
    // a bollard at the head
    parts.push(prep(xf(new THREE.CylinderGeometry(0.8, 1.0, 3, 6), {
      x: rootX - inland.x * len * 0.95, y: 4.2, z: rootZ - inland.y * len * 0.95,
    }), 0x554130));
  }

  // warehouse and crane just behind the waterfront
  {
    const wx = base.x + inland.x * 24, wz = base.y + inland.y * 24;
    const h = Math.max(1.6, heightAtAnalytic(wx, wz));
    for (const g of building(rng, isMajor ? 26 : 16, 11, 14)) parts.push(xf(g, { x: wx, y: h - 1, z: wz, ry: pierAng }));
    const cx = base.x + perpG.x * (isMajor ? 30 : 20) + inland.x * 12;
    const cz = base.y + perpG.y * (isMajor ? 30 : 20) + inland.y * 12;
    const ch = Math.max(1.2, heightAtAnalytic(cx, cz));
    parts.push(prep(xf(new THREE.CylinderGeometry(0.9, 0.9, 24, 6), { x: cx, y: ch + 11, z: cz }), 0x6a5136));
    parts.push(prep(xf(new THREE.BoxGeometry(1.4, 1.4, 18), {
      x: cx - inland.x * 8, y: ch + 22, z: cz - inland.y * 8, ry: pierAng,
    }), 0x6a5136));
    // stacked crates on the quay
    for (let k = 0; k < (isMajor ? 7 : 3); k++) {
      const qx = base.x + perpG.x * rngRange(rng, -60, 60) + inland.x * rngRange(rng, 6, 20);
      const qz = base.y + perpG.y * rngRange(rng, -60, 60) + inland.y * rngRange(rng, 6, 20);
      const qh = heightAtAnalytic(qx, qz);
      if (qh < 1) continue;
      const sz = rngRange(rng, 2.2, 3.6);
      parts.push(prep(xf(new THREE.BoxGeometry(sz, sz, sz), { x: qx, y: qh + sz / 2, z: qz, ry: rng() * 3 }), 0x8a6a44, 0.12));
    }
  }

  /* ---------------------------------------------------------------
     Faction construction. A port should say who holds it before the player
     opens any interface — and the approach is where that has to happen,
     because that is what they see first from seaward.
     --------------------------------------------------------------- */
  /* Harbour works — breakwaters, marks, beacons — go in their own mesh.
     They stand in open water on purpose, which is the whole point of a
     breakwater and of a staked channel, so they are kept apart from the
     buildings: a check asking "is anything standing on nothing" still means
     something, and these do not trip it. */
  const seaworks = [];
  if (port.style === 'fortified') {
    /* GREYWAKE: two stone arms reaching out to very nearly meet, with the
       harbour mouth between them. The League's whole argument, in masonry:
       whoever controls where ships can safely stop controls the sea. */
    const stone = 0x5b5f63, stoneLit = 0x7d8288;
    for (const side of [1, -1]) {
      const armLen = 200, seg = 13;
      for (let i = 0; i < seg; i++) {
        const t = i / (seg - 1);
        // each arm curves in toward the mouth as it runs out
        const out = 46 + t * armLen;
        const across = side * (128 - t * 74);
        const bx = base.x - inland.x * out + perpG.x * across;
        const bz = base.y - inland.y * out + perpG.y * across;
        const h = 13 - t * 3;
        seaworks.push(prep(xf(new THREE.BoxGeometry(22, h, 26), { x: bx, y: h * 0.5 - 3, z: bz, ry: pierAng }),
          i % 3 === 0 ? stoneLit : stone, 0.05));
        // and the rubble mound the masonry stands on — the part a hull answers to
        raiseSeabed(bx, bz, 21, 1.6);
      }
      // a light on the head of each arm, where the mouth is
      const hx = base.x - inland.x * (46 + armLen) + perpG.x * side * 54;
      const hz = base.y - inland.y * (46 + armLen) + perpG.y * side * 54;
      seaworks.push(prep(xf(new THREE.CylinderGeometry(3.4, 4.6, 22, 7), { x: hx, y: 10, z: hz }), stoneLit, 0.04));
      seaworks.push(prep(xf(new THREE.BoxGeometry(5, 4, 5), { x: hx, y: 22, z: hz }), 0x8e2b28, 0.05));
      raiseSeabed(hx, hz, 14, 1.2);
    }
    // signal towers along the waterfront, and a dry dock cut into it
    for (const off of [-96, 0, 96]) {
      const tx = base.x + perpG.x * off + inland.x * 30;
      const tz = base.y + perpG.y * off + inland.y * 30;
      const th = Math.max(2, heightAtAnalytic(tx, tz));
      const hgt = 34 + Math.abs(off) * 0.06;
      seaworks.push(prep(xf(new THREE.CylinderGeometry(4.5, 6.5, hgt, 6), { x: tx, y: th + hgt * 0.5 - 2, z: tz }), stone, 0.04));
      seaworks.push(prep(xf(new THREE.BoxGeometry(11, 3, 11), { x: tx, y: th + hgt - 1, z: tz }), stoneLit, 0.05));
      seaworks.push(prep(xf(new THREE.BoxGeometry(2, 9, 2), { x: tx, y: th + hgt + 5, z: tz }), 0x8e2b28, 0.06));
    }
  } else if (port.style === 'lagoon') {
    /* TIDEGLASS: nothing defended. The reef is the wall and the way in is the
       gate, so what the approach shows is stakes — a marked channel through
       water that has drowned better captains — and light timber on stilts. */
    const teal = 0x2f8f86, pale = 0xd9d2c0;
    /* A stake is driven into a reef flat, so a stake standing over deep water
       is a lie about the bottom — and twelve of them in a row read as a jetty
       marching into open ocean, which is exactly what this looked like. Each
       pair now sounds its own spot: shallow enough to drive a stake, deep
       enough that it is marking water and not standing on the beach — and the
       stake is cut to length for the bottom it stands on. */
    const chLen = 420;
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const out = 40 + t * chLen;
      for (const side of [1, -1]) {
        /* Each stake finds the reef for itself: walk out from the channel's
           axis until the bottom comes up to a flat a stake can be driven
           into, and stand it there — a metre inside the edge, the way a
           channel is actually marked. Where the sweep meets no reef there is
           no stake, because there is nothing there to warn anyone off. */
        let sx = null, sz = null, bot = 0;
        for (let s = 26; s <= 180; s += 6) {
          const px = base.x - inland.x * out + perpG.x * side * s;
          const pz = base.y - inland.y * out + perpG.y * side * s;
          const h = heightAtAnalytic(px, pz);
          if (h > -0.6) break;                    // the flat has become beach: stop short of it
          if (h > -7.5) {
            sx = base.x - inland.x * out + perpG.x * side * (s + 4);
            sz = base.y - inland.y * out + perpG.y * side * (s + 4);
            bot = heightAtAnalytic(sx, sz);
            break;
          }
        }
        if (sx === null || bot > -0.6) continue;
        const top = 6.5 + (i % 3) * 0.5;
        const len = top - bot + 1.5;
        seaworks.push(prep(xf(new THREE.CylinderGeometry(0.75, 0.95, len, 5),
          { x: sx, y: top - len / 2, z: sz }), 0x9a8560, 0.06));
        // a painted top, so the line of them reads from seaward
        seaworks.push(prep(xf(new THREE.BoxGeometry(2.2, 2.2, 2.2), { x: sx, y: top + 1.6, z: sz }),
          side > 0 ? teal : 0xc4553a, 0.05));
      }
    }
    // low waterfront under sailcloth, and a beacon platform on stilts
    for (const off of [-70, 12, 82]) {
      const ax = base.x + perpG.x * off + inland.x * 16;
      const az = base.y + perpG.y * off + inland.y * 16;
      const ah = Math.max(1.4, heightAtAnalytic(ax, az));
      for (const s2 of [-6, 6]) {
        seaworks.push(prep(xf(new THREE.CylinderGeometry(0.55, 0.55, 12, 5),
          { x: ax + perpG.x * s2, y: ah + 5, z: az + perpG.y * s2 }), 0x8a7048));
      }
      seaworks.push(prep(xf(new THREE.BoxGeometry(20, 0.9, 14), { x: ax, y: ah + 11, z: az, ry: pierAng }), pale, 0.07));
    }
    {
      const bx = base.x - inland.x * 74 + perpG.x * 70;
      const bz = base.y - inland.y * 74 + perpG.y * 70;
      for (const [ox, oz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        seaworks.push(prep(xf(new THREE.CylinderGeometry(0.8, 0.8, 26, 5),
          { x: bx + perpG.x * ox + inland.x * oz, y: 6, z: bz + perpG.y * ox + inland.y * oz }), 0x8a7048));
      }
      seaworks.push(prep(xf(new THREE.BoxGeometry(16, 1.2, 16), { x: bx, y: 19, z: bz, ry: pierAng }), pale, 0.06));
      seaworks.push(prep(xf(new THREE.BoxGeometry(3, 7, 3), { x: bx, y: 23, z: bz }), teal, 0.05));
    }
  }

  if (seaworks.length) {
    const m = new THREE.Mesh(mergeGeos(seaworks), litMaterial());
    m.name = 'seaworks';
    group.add(m);
  }

  // lighthouse for the major port, signal mast for the fort
  if (isMajor) {
    // headland with a clear view of the approach — must actually be dry land
    const perp = perpG;
    let lx = 0, lz = 0, lh = -99;
    for (let i = 0; i < 24; i++) {
      const along = (i % 2 ? 1 : -1) * (60 + (i >> 1) * 22);
      const into = 34 + (i % 5) * 22;
      const x = base.x + perp.x * along + inland.x * into;
      const z = base.y + perp.y * along + inland.y * into;
      const h = heightAtAnalytic(x, z);
      if (h > lh) { lh = h; lx = x; lz = z; }
      if (h > 12) break;
    }
    if (lh > 4) {
      parts.push(prep(xf(new THREE.CylinderGeometry(3.4, 5.2, 30, 8), { x: lx, y: lh + 13, z: lz }), 0xf0e7d2, 0.05));
      parts.push(prep(xf(new THREE.CylinderGeometry(4.2, 4.2, 4, 8), { x: lx, y: lh + 29, z: lz }), 0xb8492f, 0.05));
      parts.push(prep(xf(new THREE.ConeGeometry(4.4, 5, 8), { x: lx, y: lh + 33, z: lz }), 0x40525c));
    }
  }
  if (port.faction === 'admiralty') {
    const mx = base.x + inland.x * 96, mz = base.y + inland.y * 96;
    const mh = Math.max(4, heightAtAnalytic(mx, mz));
    parts.push(prep(xf(new THREE.CylinderGeometry(0.8, 1.2, 34, 6), { x: mx, y: mh + 17, z: mz }), 0x6a5136));
    parts.push(prep(xf(new THREE.BoxGeometry(12, 7, 0.5), { x: mx + 6, y: mh + 29, z: mz }), 0x2b3f7a, 0.06));
    // battery wall
    parts.push(prep(xf(new THREE.BoxGeometry(70, 9, 8), { x: base.x + inland.x * 56, y: 4, z: base.y + inland.y * 56, ry: Math.atan2(inland.x, inland.y) + Math.PI / 2 }), 0x9a9184, 0.07));
  }

  const merged = mergeGeos(parts);
  const mesh = new THREE.Mesh(merged, litMaterial());
  mesh.castShadow = false;
  group.add(mesh);

  // mooring buoys arc across the seaward side of the harbour, worked out from
  // where the land actually is rather than from the port's declared bearing
  const seaAng = Math.atan2(-inland.y, -inland.x);
  const buoys = [];
  for (let i = 0; i < 7; i++) {
    const a = seaAng + (i / 6 - 0.5) * 2.4;
    const bx = port.x + Math.cos(a) * port.dockR * 0.94;
    const bz = port.z + Math.sin(a) * port.dockR * 0.94;
    const col = i % 2 ? 0xd94f2f : 0xe6b25e;
    buoys.push(prep(xf(new THREE.SphereGeometry(2.4, 7, 5), { x: bx, y: 0.5, z: bz, sy: 0.8 }), col));
    buoys.push(prep(xf(new THREE.ConeGeometry(0.9, 4.5, 5), { x: bx, y: 3.6, z: bz }), col));
  }
  group.add(new THREE.Mesh(mergeGeos(buoys), litMaterial()));
}

const clampNum = (v, a, b) => (v < a ? a : v > b ? b : v);

// settlements are built before the bake in some paths; use analytic directly
const heightAtAnalytic = analyticHeight;

/* ---------------- public build ---------------- */
export function buildTerrain(scene) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const mat = litMaterial();
  for (const isl of ISLANDS) {
    const g = islandMesh(isl);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = true;
    group.add(m);
    scatterProps(isl, group);
  }
  for (const p of PORTS) buildSettlement(p, group);
  scene.add(group);
  return group;
}

export { analyticHeight };
