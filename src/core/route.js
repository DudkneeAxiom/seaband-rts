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

/** Water deep enough for anything the player will sail, plus room to swing. */
function passable(x, z) { return depthAt(x, z) > 6.5; }

function build(limit) {
  gLimit = limit;
  gx0 = -limit; gz0 = -limit;
  gw = Math.ceil((limit * 2) / CELL) + 1;
  gh = gw;
  grid = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      // a cell counts as water only if its middle and its corners are, which
      // keeps the route off headlands the hull would clip on the way past
      const ok = passable(x, z)
        && passable(x - CELL * 0.4, z) && passable(x + CELL * 0.4, z)
        && passable(x, z - CELL * 0.4) && passable(x, z + CELL * 0.4)
        && Math.hypot(x, z) < limit * 0.99;
      grid[j * gw + i] = ok ? 1 : 0;
    }
  }
}

const idx = (i, j) => j * gw + i;
const inGrid = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh;
const toCell = (x, z) => [Math.round((x - gx0) / CELL), Math.round((z - gz0) / CELL)];
const toWorld = (i, j) => ({ x: gx0 + i * CELL, z: gz0 + j * CELL });

/** Nearest water cell to a point, for courses laid onto a beach. */
function nearestWater(i, j) {
  if (inGrid(i, j) && grid[idx(i, j)]) return [i, j];
  for (let r = 1; r <= 8; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di, b = j + dj;
        if (inGrid(a, b) && grid[idx(a, b)]) return [a, b];
      }
    }
  }
  return null;
}

/** True if the straight line between two points never leaves the water. */
export function clearWater(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(d / 14);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (!passable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

/* A* over the grid. Eight-way, with the diagonals costed properly so the
   route does not zig-zag its way across open sea. */
function search(si, sj, ti, tj) {
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
        if (!grid[k]) continue;
        // no cutting a corner diagonally between two spits of land
        if (di && dj && (!grid[idx(ci + di, cj)] || !grid[idx(ci, cj + dj)])) continue;
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

/** Drop every waypoint we can see past, so open water is one straight run. */
function smooth(pts, x1, z1) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearWater(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    i = j;
  }
  if (!out.length || Math.hypot(out[out.length - 1].x - x1, out[out.length - 1].z - z1) > 1) {
    out.push({ x: x1, z: z1 });
  }
  return out;
}

/**
 * Waypoints from one point to another that stay in water.
 * Returns null when the rhumb line is already clear — the common case, and
 * the caller should just steer for the destination as it always did.
 */
export function findRoute(x0, z0, x1, z1, limit = 2000) {
  if (clearWater(x0, z0, x1, z1)) return null;
  if (!grid || gLimit !== limit) build(limit);

  const s = nearestWater(...toCell(x0, z0));
  const t = nearestWater(...toCell(x1, z1));
  if (!s || !t) return null;

  const path = search(s[0], s[1], t[0], t[1]);
  if (!path || path.length < 2) return null;
  return smooth(path, x1, z1);
}
