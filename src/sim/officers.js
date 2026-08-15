/* Officers: named people with roles, wages, experience — and little
   hand-drawn portraits generated from their seed. */
import { OFFICER_ROLES, NAMES } from '../data/gamedata.js';
import { NAMED_OFFICERS } from '../data/notables.js';
import { makeRNG, rngPick, rngInt, rngRange, clamp } from '../core/util.js';

let NEXT = 1;

const TRAITS = [
  { id: 'steady', name: 'Steady', tip: 'Nothing hurries them.' },
  { id: 'lucky', name: 'Lucky', tip: 'Has walked away from two sinkings.' },
  { id: 'harsh', name: 'Harsh', tip: 'The crew obey. They do not smile.' },
  { id: 'lettered', name: 'Lettered', tip: 'Reads charts, and everything else.' },
  { id: 'reckless', name: 'Reckless', tip: 'First over the rail. Usually.' },
  { id: 'thrifty', name: 'Thrifty', tip: 'Counts every barrel twice.' },
];

export function makeOfficer(seed, roleId = null) {
  const r = makeRNG(seed * 7717 + 3);
  const role = roleId || rngPick(r, Object.keys(OFFICER_ROLES));
  const name = `${rngPick(r, NAMES.officer_first)} ${rngPick(r, NAMES.officer_last)}`;
  const skill = rngInt(r, 1, 3);
  const o = {
    id: NEXT++,
    seed,
    name, role, skill,
    trait: rngPick(r, TRAITS),
    xp: rngInt(r, 0, 30),
    level: 1,
    wage: 6 + skill * 4,
    hire: Math.round((110 + skill * 95) * rngRange(r, 0.85, 1.2)),
    canCaptain: skill >= 2 || role === 'mate',
    ship: null,
  };
  return o;
}

export function officerLabel(o) { return OFFICER_ROLES[o.role]?.name || 'Officer'; }
export function officerEffect(o) { return OFFICER_ROLES[o.role]?.effect || ''; }

export function addOfficerXP(o, n) {
  o.xp += n;
  const need = 100 * o.level;
  while (o.xp >= need) {
    o.xp -= need; o.level++;
    o.skill = clamp(o.skill + 1, 1, 5);
    o.canCaptain = o.canCaptain || o.skill >= 2;
  }
}

/* ---------------- portraits ---------------- */
const SKIN = ['#8d5a3b', '#c69068', '#6b3f28', '#e0b48c', '#a06a45', '#4e3220'];
const COATS = ['#3a5c72', '#6d3b32', '#4a5a3c', '#2f4858', '#6a5330', '#54405e'];

export function drawPortrait(canvas, o, size = 46) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const r = makeRNG(o.seed * 991 + 7);
  const skin = SKIN[(r() * SKIN.length) | 0];
  const coat = COATS[(r() * COATS.length) | 0];

  // background
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, '#1d3f4e'); grd.addColorStop(1, '#12262f');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);

  const cx = size * 0.5, S = size / 46;
  // shoulders
  g.fillStyle = coat;
  g.beginPath();
  g.ellipse(cx, size * 1.02, size * 0.44, size * 0.30, 0, Math.PI, 0);
  g.fill();
  // collar
  g.fillStyle = 'rgba(255,255,255,.16)';
  g.fillRect(cx - 10 * S, size - 12 * S, 20 * S, 3 * S);
  // neck
  g.fillStyle = skin;
  g.fillRect(cx - 4 * S, size * 0.62, 8 * S, 10 * S);
  // head
  g.beginPath();
  g.ellipse(cx, size * 0.47, 10.5 * S, 12 * S, 0, 0, Math.PI * 2);
  g.fill();
  // hair / beard
  const hair = ['#241a14', '#3d2a1c', '#5c4632', '#6b6b6b', '#1b1512'][(r() * 5) | 0];
  g.fillStyle = hair;
  if (r() > 0.35) { // beard
    g.beginPath();
    g.ellipse(cx, size * 0.56, 9 * S, 8 * S, 0, 0, Math.PI);
    g.fill();
  }
  // eyes
  g.fillStyle = '#15100c';
  g.fillRect(cx - 5.4 * S, size * 0.45, 2.2 * S, 2.2 * S);
  g.fillRect(cx + 3.2 * S, size * 0.45, 2.2 * S, 2.2 * S);

  // headgear by role
  g.fillStyle = ['#20303c', '#4a2f22', '#5b1f1a', '#2c3f2a'][(r() * 4) | 0];
  const role = o.role;
  if (role === 'mate' || role === 'marine') {          // bicorne
    g.beginPath();
    g.moveTo(cx - 15 * S, size * 0.38); g.quadraticCurveTo(cx, size * 0.18, cx + 15 * S, size * 0.38);
    g.quadraticCurveTo(cx, size * 0.34, cx - 15 * S, size * 0.38); g.fill();
  } else if (role === 'navigator' || role === 'gunner') { // tricorne-ish flat cap
    g.beginPath();
    g.ellipse(cx, size * 0.35, 13 * S, 4.4 * S, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(cx - 8 * S, size * 0.26, 16 * S, 8 * S);
  } else {                                              // kerchief
    g.beginPath();
    g.moveTo(cx - 11 * S, size * 0.40); g.lineTo(cx + 11 * S, size * 0.40);
    g.lineTo(cx + 9 * S, size * 0.30); g.lineTo(cx - 9 * S, size * 0.30); g.closePath(); g.fill();
  }
  // rank pips
  g.fillStyle = '#e6b25e';
  for (let i = 0; i < Math.min(4, o.skill); i++) g.fillRect(3 * S, size - (5 + i * 5) * S, 3 * S, 3 * S);

  // frame
  g.strokeStyle = 'rgba(230,178,94,.35)'; g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, size - 1, size - 1);
}

/**
 * Build one of the authored officers.
 *
 * They keep every field an ordinary officer has — role, skill, wage, hire,
 * xp, canCaptain — so nothing downstream needs to know the difference. What
 * they add is a person: an epithet, a background, traits with names people
 * use, and something they want that has nothing to do with the player.
 */
export function makeNamedOfficer(def) {
  const base = makeOfficer(def.seed, def.role);
  base.namedId = def.id;
  base.name = def.name;
  base.epithet = def.epithet || null;
  base.skill = def.skill;
  base.wage = 6 + def.skill * 4;
  base.hire = Math.round(150 + def.skill * 110);
  base.canCaptain = def.skill >= 2 || def.role === 'mate';
  base.bio = def.bio;
  base.ambition = def.ambition;
  base.namedTraits = def.traits.slice();
  base.arc = def.arc || null;
  base.arcState = 0;
  return base;
}

/**
 * Who is drinking here tonight.
 *
 * A port's own authored officers come first — Mercer is an Ilo Vantu fixture
 * and should be findable rather than a lottery — and the rest of the room is
 * filled procedurally as before. `taken` are the ones already hired or hired
 * and lost, so a named officer never appears twice in the world.
 */
export function rollTavernOfficers(seedBase, n = 3, exclude = [], portId = null, taken = []) {
  const out = [];
  const used = new Set(exclude.map(o => o.role));
  const gone = new Set(taken);
  for (const def of NAMED_OFFICERS) {
    if (out.length >= n) break;
    if (def.port !== portId || gone.has(def.id) || used.has(def.role)) continue;
    const o = makeNamedOfficer(def);
    used.add(o.role);
    out.push(o);
  }
  for (let i = out.length; i < n; i++) {
    let o = makeOfficer(seedBase + i * 131);
    let guard = 0;
    while (used.has(o.role) && guard++ < 8) o = makeOfficer(seedBase + i * 131 + guard * 977);
    used.add(o.role);
    out.push(o);
  }
  return out;
}
