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
      /* A cell is only as good as its shallowest cast, and five casts are not
         enough to find a wall. The middle and four sides left three quarters
         of a 48-metre cell unsounded, so Greywake's breakwater — 26 metres of
         League masonry — slipped clean between them: the grid called the cell
         open water and every route into the harbour was plotted straight
         through the arm. That is the answer to "ships drift into the stone
         walls in the same spot", asked twice.
         A 5×5 lattice across the whole cell costs one bake of 160k casts, once,
         and there is no gap left wide enough to hide a breakwater in. */
      let m = Infinity;
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
          const d = depthAt(x + (a / 4 - 0.5) * CELL, z + (b / 4 - 0.5) * CELL);
          if (d < m) m = d;
        }
      }
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

/** True if the straight line between two points never leaves water she can swim.
 *
 * The lead-in and the last few metres are left out on purpose: the start is
 * where the ship already is, and answering "your own berth is foul" for every
 * road makes a hull that is *already* touching declare the whole sea shut and
 * heave to on the rock she is on; the end is often a mark laid deliberately
 * close in — a berth, a quay, a mooring. Everything between them is sounded.
 *
 * It used to walk `ceil(d / 14)` steps from 1 to steps-1, which skipped both
 * ends outright. A line under fourteen metres therefore took *no cast at all*
 * and came back clear, and the first fourteen metres of every longer line went
 * unsounded — the same hole `smooth()` had when it string-pulled from the grid
 * cell nearest the ship rather than from the ship. It is how a consort came to
 * be sitting in 3.6m of water with a 4m draft, twenty-two metres from a station
 * in forty-three metres, with the road between the two reported clear.
 *
 * The two ends are not treated alike, and that asymmetry is the whole design.
 * The near end is sounded finely, because that is water the hull is in now and
 * will be in within seconds — it is where the fault above lives. The far end
 * keeps a wide run-out and coarse casts, because a mark is very often laid
 * deliberately close inshore: a berth, a quay, a mooring. Sounding the last
 * fourteen metres of every line as strictly as the first twenty makes those
 * marks unreachable — `smooth()` stops appending the destination, and a route
 * carefully worked round every headland ends forty-six metres short in open
 * water. Callers sound the *point* separately, which is the right place for
 * that question; this one is about the road.
 *
 * The middle keeps its old fourteen-metre stride. Nothing measured says it was
 * wrong, the grid has already vetted those cells, and `smooth()` string-pulls
 * over legs that can be kilometres long — a fine cast the whole way would be a
 * metre-by-metre walk of the entire sea, several times a second.
 */
const NEAR = 20, FINE = 2, COARSE = 14;
export function clearWater(x0, z0, x1, z1, need = KEEL) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  if (!(d > 0.001)) return true;
  const dx = (x1 - x0) / d, dz = (z1 - z0) / d;
  /* Both pads shrink with the line, or a short one is all pad and nothing gets
     sounded at all — which is exactly how the old walk let an eight-metre line
     across a bar pass as water. */
  const from = Math.min(4, d * 0.2), to = d - Math.min(14, d * 0.25);
  for (let s = from; ;) {
    if (depthAt(x0 + dx * s, z0 + dz * s) <= need) return false;
    if (s >= to - 1e-6) return true;
    s = Math.min(s + (s - from < NEAR ? FINE : COARSE), to);
  }
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
     answer if the deep one does not get her there. A frigate that can find no
     twelve-metre road to Fort Escarra is better off on the cutter's road,
     picking her way, than steering the rhumb line at a rock — and nothing in
     this game may make a place unreachable.

     "Does not get her there" is the part this first got wrong. It only fell
     back when the deep search *failed*, and at Fort Escarra it does not fail:
     the mooring is 9.8m of water and a frigate wants 10.5, so `nearestWater`
     reaches away up to eight cells, finds deep water somewhere off the
     approach, and returns a perfectly good road to the wrong place. The route
     came back 400m short of the quay and the port was quietly unreachable for
     the biggest hull in the game. So the answer is judged by where it ends. */
  let best = null;
  for (const want of need > KEEL ? [need, KEEL] : [KEEL]) {
    const s = nearestWater(...toCell(x0, z0), want);
    const t = nearestWater(...toCell(x1, z1), want);
    if (!s || !t) continue;
    const path = search(s[0], s[1], t[0], t[1], want);
    if (!path || path.length < 2) continue;
    // string-pulled from where she is, so the first leg is sounded like the rest
    const out = smooth([{ x: x0, z: z0 }, ...path], x1, z1, want);
    if (!out.length) continue;
    const end = out[out.length - 1];
    if (Math.hypot(end.x - x1, end.z - z1) <= CELL * 2.5) return out;
    if (!best) best = out;             // keep the deepest road as the fallback
  }
  return best;
}
