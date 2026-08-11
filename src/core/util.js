/* Small math / helper toolbox. No dependencies. */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const invLerp = (a, b, v) => (v - a) / (b - a);

/** Shortest signed angular difference b-a, in (-PI, PI]. */
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
export function normAng(a) { a %= TAU; if (a < 0) a += TAU; return a; }

/** Frame-rate independent exponential smoothing. */
export function damp(cur, target, lambda, dt) { return lerp(cur, target, 1 - Math.exp(-lambda * dt)); }

/* ---------- deterministic RNG (mulberry32) ---------- */
export function makeRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rngRange = (r, a, b) => a + r() * (b - a);
export const rngPick = (r, arr) => arr[(r() * arr.length) | 0];
export const rngInt = (r, a, b) => a + ((r() * (b - a + 1)) | 0);

/* ---------- value noise (cheap, tileable-ish) ---------- */
const P = new Uint8Array(512);
(function initPerm() {
  const r = makeRNG(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function grad2(h, x, y) {
  switch (h & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; }
}
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = P[P[X] + Y], ab = P[P[X] + Y + 1], ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v); // ~[-1,1]
}
export function fbm(x, y, oct = 4, lac = 2.0, gain = 0.5) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

/* ---------- misc ---------- */
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function fmtCoin(n) {
  n = Math.round(n);
  return n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function shuffled(arr, r = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
/** Compass point for a heading in radians (0 = +Z / south-ish in our world = 'N' baseline). */
export function compassOf(rad) {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return pts[Math.round(normAng(rad) / (TAU / 8)) % 8];
}
