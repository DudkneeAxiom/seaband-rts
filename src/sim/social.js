/* ===========================================================
   What the people of the Shoals think of you.

   Kept entirely separate from who they are: `data/notables.js`
   is the cast, this is the relationship. A save carries only
   what happened — a number per person, a short list of things
   they remember, and what you have found out about them — so
   rewriting a character's biography never invalidates a save,
   and a save from before any of this existed loads into a
   world where nobody has met you yet, which is correct.
   =========================================================== */
import { NOTABLES, NOTABLE_BY_ID, TIES } from '../data/notables.js';

/* Descriptive first, numeric underneath — the player should read a word. */
const TIERS = [
  { at: -100, id: 'hostile', name: 'Hostile' },
  { at: -40, id: 'resentful', name: 'Resentful' },
  { at: -15, id: 'suspicious', name: 'Suspicious' },
  { at: 0, id: 'neutral', name: 'Neutral' },
  { at: 12, id: 'acquainted', name: 'Acquainted' },
  { at: 30, id: 'friendly', name: 'Friendly' },
  { at: 55, id: 'trusted', name: 'Trusted' },
  { at: 85, id: 'devoted', name: 'Devoted' },
];
const ORDER = TIERS.map(t => t.id);

export function tierOf(v) {
  let out = TIERS[0];
  for (const t of TIERS) if (v >= t.at) out = t;
  return out;
}
/** True when a relationship is at least this good — for gated access. */
export function atLeast(v, tierId) {
  return ORDER.indexOf(tierOf(v).id) >= ORDER.indexOf(tierId);
}

/* How much a given trait cares. Traits are not stat labels the player reads;
   they are why two people react differently to the same act. */
const TRAIT_WEIGHT = {
  proud: { slighted: 1.6 },
  vindictive: { slighted: 2.2, helped: 0.8 },
  generous: { helped: 1.3 },
  loyal: { helped: 1.4, slighted: 1.3 },
  suspicious: { helped: 0.7 },
  opportunistic: { paid: 1.5, helped: 0.8 },
  pragmatic: { paid: 1.3 },
  idealistic: { helped: 1.4, paid: 0.6 },
  honorable: { helped: 1.2, slighted: 1.5 },
};

export class Social {
  constructor() {
    this.rel = {};        // id -> number
    this.mem = {};        // id -> [{tag, text, at}]
    this.known = {};      // id -> { ambition:true, ... } what you have learned
    this.met = {};        // id -> true once you have actually spoken
    this.flags = {};      // one-off world facts: rivalries resolved, boons taken
  }

  /* ---------------- relationship ---------------- */
  of(id) { return this.rel[id] || 0; }
  tier(id) { return tierOf(this.of(id)); }
  atLeast(id, tierId) { return atLeast(this.of(id), tierId); }

  /**
   * Move a relationship, weighted by who they are.
   *
   * `kind` says what sort of act it was — helped, slighted, paid — and their
   * traits decide how much it lands. A vindictive factor remembers a slight
   * twice as long as a generous tavern keeper does.
   */
  bump(id, n, kind = 'helped') {
    const who = NOTABLE_BY_ID[id];
    let w = 1;
    if (who) for (const t of who.traits) w *= (TRAIT_WEIGHT[t] && TRAIT_WEIGHT[t][kind]) || 1;
    const before = this.of(id);
    this.rel[id] = Math.max(-100, Math.min(100, before + n * w));
    return this.rel[id] - before;
  }

  /* Everyone in a port hears about it, a little. A town is not a set of
     people in separate rooms — but the person it happened to feels it most,
     and somebody's enemy may feel the opposite. */
  bumpPort(portId, n, kind = 'helped') {
    for (const w of NOTABLES) if (w.port === portId) this.bump(w.id, n, kind);
  }
  /** Helping one person can cost you their rival. */
  bumpWithTies(id, n, kind = 'helped') {
    this.bump(id, n, kind);
    for (const t of TIES) {
      const other = t.a === id ? t.b : t.b === id ? t.a : null;
      if (!other) continue;
      if (t.kind === 'suspects' || t.kind === 'hunts') this.bump(other, -n * 0.4, 'slighted');
      if (t.kind === 'trusts') this.bump(other, n * 0.3, kind);
    }
  }

  /* ---------------- memory ----------------
     Short, specific, and capped. A character who recites your whole career
     is a log file with a face; three things they will not let go of is a
     person. */
  remember(id, tag, text, at = 0) {
    if (!this.mem[id]) this.mem[id] = [];
    if (this.mem[id].some(m => m.tag === tag)) return false;
    this.mem[id].push({ tag, text, at });
    if (this.mem[id].length > 4) this.mem[id].shift();
    return true;
  }
  memories(id) { return this.mem[id] || []; }
  /** The one they would bring up first. */
  lastMemory(id) {
    const m = this.mem[id];
    return m && m.length ? m[m.length - 1] : null;
  }
  recalls(id, tag) { return (this.mem[id] || []).some(m => m.tag === tag); }

  /* ---------------- what you have found out ---------------- */
  learn(id, field) {
    if (!this.known[id]) this.known[id] = {};
    if (this.known[id][field]) return false;
    this.known[id][field] = true;
    return true;
  }
  knows(id, field) { return !!(this.known[id] && this.known[id][field]); }
  meet(id) { const first = !this.met[id]; this.met[id] = true; return first; }
  hasMet(id) { return !!this.met[id]; }

  flag(k, v = true) { this.flags[k] = v; }
  hasFlag(k) { return !!this.flags[k]; }

  /* ---------------- save ----------------
     Only what happened. Rounded, because a relationship is a feeling and
     nobody needs it stored to fourteen decimal places. */
  serialize() {
    const rel = {};
    for (const k in this.rel) if (Math.abs(this.rel[k]) >= 0.5) rel[k] = Math.round(this.rel[k]);
    return { v: 1, rel, mem: this.mem, known: this.known, met: this.met, flags: this.flags };
  }
  static load(d) {
    const s = new Social();
    if (!d || typeof d !== 'object') return s;      // a save from before people existed
    s.rel = (d.rel && typeof d.rel === 'object') ? { ...d.rel } : {};
    s.mem = (d.mem && typeof d.mem === 'object') ? { ...d.mem } : {};
    s.known = (d.known && typeof d.known === 'object') ? { ...d.known } : {};
    s.met = (d.met && typeof d.met === 'object') ? { ...d.met } : {};
    s.flags = (d.flags && typeof d.flags === 'object') ? { ...d.flags } : {};
    // a character deleted from the cast should not haunt the save
    for (const k in s.rel) if (!NOTABLE_BY_ID[k]) delete s.rel[k];
    return s;
  }
}

/* ---------------- what they say ----------------
   One greeting, chosen by how well they know you, with the thing they cannot
   let go of on the end. Concise on purpose: this is a sailing game. */
export function greetingFor(who, social) {
  const v = social.of(who.id);
  const line = v >= 55 ? who.lines.warm : v >= 12 ? who.lines.known : who.lines.cold;
  const m = social.lastMemory(who.id);
  return { line, memory: m ? m.text : null };
}
