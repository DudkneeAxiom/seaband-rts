/* ===========================================================
   Coarse navigation around land.

   Tap-to-sail used to steer the rhumb line and nothing else, so a course
   laid across the shoals ran the ship aground: grounding cuts speed to 8%
   and takes a bite out of the hull every half second, and since the
   destination was still dead ahead she sat there grinding until somebody
   noticed. Marasay to Fort Escarra was unsailable without steering round
   the islands by hand, which is most of why crossings felt endless.

   So: a coarse grid over the region, A* across the water, and the corners
   pulled out of the result so a clear stretch stays one straight run. The
   grid is built once on the baked depth field — the same field the hull
   collides with — and the search is only ever run when a course is laid.
   =========================================================== */
import { depthAt } from '../world/terrain.js';

const CELL = 48;              // fine enough to find the gaps, coarse enough to be instant
let grid = null, gw = 0, gh = 0, gx0 = 0, gz0 = 0, gLimit = 0;

/** The shallowest water anything drawing less than this may be routed through. */
export const KEEL = 6.5;

/**
 * How much water a hull wants under her before a route will send her over it.
 *
 * 6.5m was the whole answer, and it is the player's cutter's answer: she draws
 * 3.45m, so every route ever laid had three metres to spare and the constant
 * looked like a fact. It is not. A fluyt draws 7.13m and a frigate 8.97m, and
 * the grid was cheerfully routing both of them through six and a half metres of
 * water — which is a merchant following a perfectly valid course onto the
 * bottom. Measured: `Ledger of Oosterhaven`, draft 7.1, aground in 5.3m with
 * three legs of a good route still in hand.
 */
export const keelFor = (draft) => Math.max(KEEL, (draft || 0) + 1.5);

/* The grid holds the depth of the shallowest cast in each cell rather than a
   yes/no, so one bake answers the question for every draft afloat. */
function build(limit) {
  gLimit = limit;
  gx0 = -limit; gz0 = -limit;
  gw = Math.ceil((limit * 2) / CELL) + 1;
  gh = gw;
  grid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      // a cell is only as good as its shallowest cast: middle and four sides,
      // which keeps the route off headlands the hull would clip on the way past
      let m = depthAt(x, z);
      m = Math.min(m, depthAt(x - CELL * 0.4, z), depthAt(x + CELL * 0.4, z),
        depthAt(x, z - CELL * 0.4), depthAt(x, z + CELL * 0.4));
      if (Math.hypot(x, z) >= limit * 0.99) m = -Infinity;   // off the edge of the world
      grid[j * gw + i] = m;
    }
  }
}

const idx = (i, j) => j * gw + i;
const inGrid = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh;
const toCell = (x, z) => [Math.round((x - gx0) / CELL), Math.round((z - gz0) / CELL)];
const toWorld = (i, j) => ({ x: gx0 + i * CELL, z: gz0 + j * CELL });

/** Nearest cell with water enough to a point, for courses laid onto a beach. */
function nearestWater(i, j, need) {
  if (inGrid(i, j) && grid[idx(i, j)] >= need) return [i, j];
  for (let r = 1; r <= 8; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di, b = j + dj;
        if (inGrid(a, b) && grid[idx(a, b)] >= need) return [a, b];
      }
    }
  }
  return null;
}

/** True if the straight line between two points never leaves water she can swim. */
export function clearWater(x0, z0, x1, z1, need = KEEL) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(d / 14);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (depthAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) <= need) return false;
  }
  return true;
}

/* A* over the grid. Eight-way, with the diagonals costed properly so the
   route does not zig-zag its way across open sea. */
function search(si, sj, ti, tj, need) {
  const n = gw * gh;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const open = new Uint8Array(n);
  const h = (i, j) => Math.hypot(i - ti, j - tj);

  const start = idx(si, sj), goal = idx(ti, tj);
  g[start] = 0; f[start] = h(si, sj); open[start] = 1;
  const queue = [start];

  while (queue.length) {
    // small maps, so a linear scan for the best node beats a heap to maintain
    let best = 0;
    for (let q = 1; q < queue.length; q++) if (f[queue[q]] < f[queue[best]]) best = q;
    const cur = queue.splice(best, 1)[0];
    open[cur] = 0;
    if (cur === goal) break;
    const ci = cur % gw, cj = (cur / gw) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = ci + di, b = cj + dj;
        if (!inGrid(a, b)) continue;
        const k = idx(a, b);
        if (grid[k] < need) continue;
        // no cutting a corner diagonally between two spits of land
        if (di && dj && (grid[idx(ci + di, cj)] < need || grid[idx(ci, cj + dj)] < need)) continue;
        const step = (di && dj) ? 1.4142 : 1;
        const ng = g[cur] + step;
        if (ng < g[k]) {
          g[k] = ng; f[k] = ng + h(a, b); prev[k] = cur;
          if (!open[k]) { open[k] = 1; queue.push(k); }
        }
      }
    }
  }

  if (prev[goal] < 0 && goal !== start) return null;
  const out = [];
  for (let c = goal; c >= 0; c = prev[c]) {
    out.push(toWorld(c % gw, (c / gw) | 0));
    if (c === start) break;
  }
  return out.reverse();
}

/**
 * Drop every waypoint we can see past, so open water is one straight run.
 *
 * `pts[0]` must be where the ship actually is, not the grid cell nearest her.
 * The string was pulled from the nearest cell, and the run from her real
 * position to the first waypoint was the one leg of the route nobody ever
 * sounded — `nearestWater` will reach eight cells for a berth in thin water,
 * and the line back out to that cell can cross anything. Measured across every
 * pair of ports: five foul legs on a frigate's road and all five of them leg
 * zero, one of them over ground thirty-one metres above the sea.
 */
function smooth(pts, x1, z1, need) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearWater(pts[i].x, pts[i].z, pts[j].x, pts[j].z, need)) j--;
    out.push(pts[j]);
    i = j;
  }
  /* The last leg has to be sounded like every other one.
     This used to append the destination unconditionally, so a route that had
     been carefully worked round every headland finished with an unchecked
     straight line from the last water cell to the mark. Usually harmless —
     usually the mark is in open water. Into Greywake it is not: the run from
     the last cell to the mooring crosses a breakwater arm, and hulls that had
     just been routed neatly through the harbour mouth turned and drove onto
     the masonry inside it. The player's tap-to-sail had the same hole.
     Where the mark cannot be seen from the last waypoint, the route ends in
     the water instead; the last few metres are close enough for the ship's
     own land-avoidance, which is what that rule is good at. */
  const last = out.length ? out[out.length - 1] : null;
  const short = last && Math.hypot(last.x - x1, last.z - z1) <= 1;
  if (!short && (!last || clearWater(last.x, last.z, x1, z1, need))) {
    out.push({ x: x1, z: z1 });
  }
  return out;
}

/**
 * Waypoints from one point to another that stay in water she can swim.
 *
 * `need` is the depth this particular hull wants under her — pass `keelFor(draft)`.
 * Returns null when the rhumb line is already clear — the common case, and
 * the caller should just steer for the destination as it always did.
 */
export function findRoute(x0, z0, x1, z1, limit = 2000, need = KEEL) {
  if (clearWater(x0, z0, x1, z1, need)) return null;
  if (!grid || gLimit !== limit) build(limit);

  /* A deep hull asks for her own depth first, and settles for the shallow
     answer if the deep one does not exist. A frigate that can find no
     twelve-metre road to Fort Escarra is better off on the cutter's road,
     picking her way, than steering the rhumb line at a rock — and nothing in
     this game may make a place unreachable. */
  for (const want of need > KEEL ? [need, KEEL] : [KEEL]) {
    const s = nearestWater(...toCell(x0, z0), want);
    const t = nearestWater(...toCell(x1, z1), want);
    if (!s || !t) continue;
    const path = search(s[0], s[1], t[0], t[1], want);
    if (!path || path.length < 2) continue;
    // string-pulled from where she is, so the first leg is sounded like the rest
    return smooth([{ x: x0, z: z0 }, ...path], x1, z1, want);
  }
  return null;
}
