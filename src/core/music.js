/* ===========================================================
   The score. Open water, and one melody in many weathers.

   Two things live here. Out on the sea it is an adventure: a
   rolling six-eight in bright D major with the flat seventh a
   shanty leans on, warm strings under a flute, a harp running
   through the middle and a glockenspiel catching the light on
   the turn of each phrase. None of that is written down as a
   tune, because a written tune is a loop and a loop is what
   wears out on a long voyage — the chords come from a pool of
   four-bar phrases and the flute improvises over them, so it
   goes on inventing itself for as long as you sail.

   The other is "The Long Water", a single eight-bar folk tune
   that belongs to the harbours and to danger. Near a port the
   town picks it up in its power's dialect. When a hunter closes
   it breaks into fragments over a drum pulse, in a battle the
   drums own it and the whistle fights through in pieces, and
   when the fight is won the tune comes back whole for a few
   seconds before the sea takes over again.

   It was one tin whistle over a drone for a long time, and it
   was reported — correctly — as weak: silent for minutes at a
   stretch, nothing under it and nothing above three kilohertz.
   The checks in tools/audio.mjs now measure both of those, so
   the body and the daylight cannot quietly drain out again.

   Everything is synthesised live, like the rest of the audio:
   no files, no network, nothing to fail to load. The melody is
   data, the instruments are small subgraphs, and a lookahead
   scheduler places whole bars on the WebAudio clock so layers
   enter on bar lines instead of whenever a frame happened.

   The controller is deliberately the only place that decides
   what plays. Gameplay code reports facts ("mode is battle",
   "her hull is failing") through the state object updateAudio
   already passes, plus a couple of explicit events (victory,
   defeat, discovery). Nothing else in the game may start or
   stop music.
   =========================================================== */

/* ---------------- the tune ----------------

   Eight bars of 4/4 in D dorian, written as [semitone offset
   from D, start beat, length in beats]. Composed for this game;
   the shape is an arch that rises to the octave and settles on
   the second degree — home is implied, never quite granted,
   which is the wistful note the whole game leans on.

   The first four notes are the fingerprint. Fragments used by
   the tension and battle states are cut from here, so even the
   broken versions are recognisably the same tune. */
const MOTIF = [
  [0, 0, 1.5], [3, 1.5, 0.5], [5, 2, 1], [7, 3, 1],
  [7, 4, 2], [5, 6, 1], [7, 7, 1],
  [10, 8, 1.5], [7, 9.5, 0.5], [5, 10, 1], [3, 11, 1],
  [5, 12, 2], [0, 14, 2],
  [0, 16, 1], [3, 17, 1], [7, 18, 1], [12, 19, 1],
  [10, 20, 2], [7, 22, 1], [10, 23, 1],
  [12, 24, 1.5], [10, 25.5, 0.5], [7, 26, 1], [5, 27, 1],
  [2, 28, 3],
];
const MOTIF_BEATS = 32;
/** The fingerprint: the opening rise. What tension plays. */
const FRAG_OPEN = MOTIF.slice(0, 4);
/** The falling tail. What advantage and victory play. */
const FRAG_TAIL = MOTIF.slice(20);

/* Modal weathers for the same notes. Dorian is home; aeolian
   darkens the sixth for the League and for danger; the lift
   raises third and seventh into D major for powers that hold
   their harbours in good order. */
function inMode(semi, mode) {
  let s = semi % 12; const oct = semi - s;
  if (mode === 'aeolian' && s === 9) s = 8;
  if (mode === 'lift' && s === 3) s = 4;
  if (mode === 'lift' && s === 10) s = 11;
  return oct + s;
}

/* ---------------- dialects ----------------

   Every power arranges the same tune its own way. These are the
   knobs an arrangement reads; a port then perturbs its power's
   dialect with a couple of numbers seeded from its own id, so
   two Compact harbours share a language without sharing a voice. */
const DIALECTS = {
  freehold: { mode: 'dorian', bpm: 88, ornament: 0.5, whistle: 1, fiddle: 0.9, pluck: 0.9, drone: 0.5, drum: 0.35, horn: 0.0, bell: 0.1 },
  admiralty: { mode: 'lift', bpm: 76, ornament: 0.1, whistle: 0.8, fiddle: 0.3, pluck: 0.4, drone: 0.6, drum: 0.5, horn: 0.8, bell: 0.15 },
  compact: { mode: 'lift', bpm: 100, ornament: 0.3, whistle: 0.9, fiddle: 0.6, pluck: 1, drone: 0.4, drum: 0.45, horn: 0.15, bell: 0.5 },
  sable: { mode: 'aeolian', bpm: 66, ornament: 0.15, whistle: 0.55, fiddle: 0.4, pluck: 0.5, drone: 0.9, drum: 0.6, horn: 0.9, bell: 0.0 },
  veyra: { mode: 'dorian', bpm: 72, ornament: 0.7, whistle: 1, fiddle: 0.25, pluck: 0.5, drone: 0.8, drum: 0.15, horn: 0.2, bell: 0.25 },
  // the Tally hold no harbours; their dialect colours danger instead
  pirate: { mode: 'aeolian', bpm: 112, ornament: 0.4, whistle: 0.6, fiddle: 0.8, pluck: 0.6, drone: 0.7, drum: 1, horn: 0.5, bell: 0 },
};
const SEA_DIALECT = { mode: 'dorian', bpm: 80, ornament: 0.35, whistle: 1, fiddle: 0.35, pluck: 0.6, drone: 0.7, drum: 0.2, horn: 0.12, bell: 0 };

function portSeed(id) {
  let h = 0x51ab;
  for (let i = 0; i < (id || '').length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
/** A port's own voice: its power's dialect, bent a little, deterministically. */
function portDialect(faction, id) {
  const base = DIALECTS[faction] || SEA_DIALECT;
  const s = portSeed(id);
  const r = n => ((s >> n) & 255) / 255;
  return {
    ...base,
    bpm: base.bpm + Math.round((r(0) - 0.5) * 12),
    ornament: Math.min(1, Math.max(0, base.ornament + (r(8) - 0.5) * 0.3)),
    pluck: Math.min(1, base.pluck * (0.75 + r(16) * 0.5)),
    bell: r(4) < 0.3 ? Math.min(1, base.bell + 0.3) : base.bell,
    high: r(20) < 0.35,          // whistle up the octave for this town
  };
}

/* Which instruments the last scheduled bar used. Written by the voices
   themselves so it cannot drift from what was really played. */
const lastBarVoices = {};
function sounded(name) { lastBarVoices[name] = (lastBarVoices[name] || 0) + 1; }

/* ---------------- the graph ---------------- */
let G = null;                    // handles lent by audio.js at init
let layers = null;               // named gains the arrangers play into
let running = false;

/* the clock */
let barStart = 0;                // ctx time the next unscheduled bar begins
let barIdx = 0;                  // which bar of the tune we are on, forever
const LOOKAHEAD = 0.4;           // schedule when the next bar is this close

/* the state machine */
let state = 'sea';               // what is sounding now
let wanted = 'sea';              // what the game asks for
let wantedSince = 0;             // ctx time the ask began (debounce)
let dwellUntil = 0;              // no civil switches before this (min dwell)
let detail = {};                 // faction/port/phase for the current state
let wantedDetail = {};
let dialect = SEA_DIALECT;

/* one-shots */
let stinger = null;              // 'victory' | 'defeat' | 'discovery', latched
let stingerUntil = 0;

/* fatigue: the sea is mostly quiet */
let passage = 'rest';            // 'play' | 'rest'
let passageUntil = 0;

/* ---------------- the open water ----------------

   The sailing music is not the folk tune. The tune is what the
   Shoals sing about themselves — it belongs to harbours and to
   danger. Out on the water the game wanted something with air
   in it: a rolling 6/8, bright D major with the flattened
   seventh that makes a sea shanty sound like an adventure
   rather than a lament, warm strings under a flute, and a harp
   running arpeggios through the middle of it.

   It is generated rather than written, because a fixed melody
   is a loop and a loop is the thing that wears out. A phrase is
   four bars of chords drawn from a pool, and the flute improvises
   over those chords from a contour and a rhythm cell picked fresh
   each phrase. The harmony is always going somewhere and the tune
   is never the same twice, so there is no seam to hear. */

/** Chords as semitones from D, in D major with a borrowed flat seventh. */
const CH = {
  I: [0, 4, 7, 12], ii: [2, 5, 9, 14], iii: [4, 7, 11, 16],
  IV: [5, 9, 12, 17], V: [7, 11, 14, 19], vi: [9, 12, 16, 21],
  bVII: [10, 14, 17, 22],
};
/** Four-bar phrases. Each can follow any other, so the road never ends. */
const PROGRESSIONS = [
  ['I', 'V', 'vi', 'IV'],
  ['I', 'bVII', 'IV', 'I'],
  ['vi', 'IV', 'I', 'V'],
  ['IV', 'I', 'ii', 'V'],
  ['I', 'IV', 'vi', 'V'],
  ['bVII', 'IV', 'I', 'V'],
  ['I', 'iii', 'IV', 'V'],
  ['vi', 'V', 'IV', 'bVII'],
];
/** Where the flute goes across a phrase: rise, arch, fall, hover. */
const CONTOURS = [[0, 2, 4, 2], [0, 3, 5, 7], [7, 5, 4, 0], [4, 4, 2, 0], [0, 4, 2, 5]];
/** Rhythm cells in eighths, over a six-eighth bar. */
const CELLS = [
  [0, 1.5, 3, 4.5], [0, 1, 2, 3, 4, 5], [0, 1.5, 3], [0, 3, 4.5],
  [0, 0.75, 1.5, 3, 4.5], [1.5, 3, 4.5], [0, 2, 4], [0, 1.5, 2.5, 3, 4.5],
];
const SEA_BEATS = 6;             // 6/8: the roll of a hull under way

/* The phrase in progress. Regenerated every four bars, never repeating the
   progression it just played, so nothing comes round again on a timer. */
let phrase = null;
function newPhrase(bar) {
  const prev = phrase && phrase.prog;
  let prog = PROGRESSIONS[(Math.random() * PROGRESSIONS.length) | 0];
  for (let i = 0; i < 4 && prog === prev; i++) prog = PROGRESSIONS[(Math.random() * PROGRESSIONS.length) | 0];
  phrase = {
    prog,
    contour: CONTOURS[(Math.random() * CONTOURS.length) | 0],
    cells: [0, 1, 2, 3].map(() => CELLS[(Math.random() * CELLS.length) | 0]),
    // one bar in five the flute takes a breath, and the strings carry it
    breath: Math.random() < 0.22 ? (Math.random() * 4) | 0 : -1,
    arp: Math.random() < 0.75,
    at: bar,
  };
  return phrase;
}
function chordAt(bar) {
  if (!phrase || bar - phrase.at >= 4) newPhrase(bar - (bar % 4));
  return CH[phrase.prog[(bar - phrase.at + 4) % 4]] || CH.I;
}

/* D major, plus the flat seventh the sea chords borrow. Anything the melody
   invents is pulled onto one of these before it is played. */
const SCALE = [0, 2, 4, 5, 7, 9, 11];
function inKey(semi, ch) {
  const oct = Math.floor(semi / 12) * 12;
  const pc = semi - oct;
  // the chord's own notes are always in key, whatever the scale thinks
  const allowed = new Set(SCALE);
  for (const c of ch) allowed.add(((c % 12) + 12) % 12);
  if (allowed.has(pc)) return semi;
  let best = pc, bd = 99;
  for (const a of allowed) {
    const d = Math.min(Math.abs(a - pc), 12 - Math.abs(a - pc));
    if (d < bd) { bd = d; best = a; }
  }
  return oct + best;
}

/** A flute note over a chord: chord tones, with a neighbour to lean on. */
function melodyFor(bar, n) {
  const ch = chordAt(bar);
  const i = (bar - phrase.at + 4) % 4;
  const aim = phrase.contour[i];
  const notes = [];
  const cell = phrase.cells[i];
  for (let k = 0; k < cell.length; k++) {
    const lean = k / Math.max(1, cell.length - 1);
    // walk toward the contour target across the bar, landing on a chord tone
    const want = aim + lean * 2;
    let best = ch[0], bd = 99;
    for (const c of ch) { const d = Math.abs(c - want); if (d < bd) { bd = d; best = c; } }
    /* Passing notes on the weak parts of the bar, so it sings rather than
       steps — and snapped into the key, which they were not. A chord tone
       plus a whole step is the ninth above the root and G-sharp above the
       third, and G-sharp is in no chord this music owns. Out-of-key notes on
       an off-beat are exactly the "not pleasant" that generated melody is
       usually guilty of. */
    const pass = k > 0 && k < cell.length - 1 && Math.random() < 0.35;
    notes.push([pass ? inKey(best + (Math.random() < 0.5 ? 2 : -1), ch) : best, cell[k]]);
  }
  void n;
  return notes;
}

const LAYER_NAMES = ['whistle', 'fiddle', 'pluck', 'drone', 'drum', 'horn', 'bell',
  'strings', 'harp', 'bass', 'shake'];

export function initMusic(graph) {
  G = graph;
  layers = {};
  for (const n of LAYER_NAMES) {
    const g = G.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(G.musBus);
    layers[n] = g;
  }
  barStart = G.ctx.currentTime + 0.2;
  passage = 'rest';
  passageUntil = G.ctx.currentTime + 4 + Math.random() * 8;   // first tune soon after launch
  running = true;
}

/* ---------------- instruments ----------------

   Small, cheap, and every number passes the same guards the
   rest of the mixer uses. Notes are scheduled at absolute times
   so a whole bar lands with sample-accurate spacing. */
const F0 = 293.66;               // D4: the whistle lives an octave above the old score
const fOf = semi => F0 * Math.pow(2, semi / 12);

function whistle(t, semi, dur, vol, opts = {}) {
  sounded('flute');
  const c = G.ctx;
  const f = G.num(fOf(semi) * (opts.low ? 0.5 : 1) * (opts.high ? 2 : 1), 440, 80, 4000);
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  /* A flute is not a sine. A real one carries its octave and a touch of the
     twelfth above it, and without them the lead sat under everything else in
     the arrangement with no presence of its own — the whole band above three
     kilohertz measured thirty dB down. These two partials are most of what
     makes it read as an instrument being blown rather than a tone. */
  const p2 = c.createOscillator(); p2.type = 'sine';
  p2.frequency.setValueAtTime(f * 2, t);
  const p2g = c.createGain(); p2g.gain.setValueAtTime(0.07, t);
  const p3 = c.createOscillator(); p3.type = 'triangle';
  p3.frequency.setValueAtTime(f * 3, t);
  const p3g = c.createGain(); p3g.gain.setValueAtTime(0.015, t);
  // a grace note: the finger lifting into the note from below
  if (opts.grace) {
    o.frequency.setValueAtTime(f * 0.891, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  }
  // vibrato that arrives late, the way breath does
  const v = c.createOscillator(); v.frequency.value = 5.1;
  const vg = c.createGain(); vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.35, dur * 0.5));
  v.connect(vg); vg.connect(o.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.4), t + 0.045);
  g.gain.setTargetAtTime(G.gainOf(vol * 0.8, 0.4), t + 0.1, dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
  o.connect(g); p2.connect(p2g); p2g.connect(g); p3.connect(p3g); p3g.connect(g);
  g.connect(layers.whistle); g.connect(G.echoIn);
  p2.start(t); p2.stop(t + dur + 0.2); p3.start(t); p3.stop(t + dur + 0.2);
  // the breath under the tone
  const n = G.noiseSrc(false);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 6;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(G.gainOf(vol * 0.12, 0.1), t + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(bp); bp.connect(ng); ng.connect(layers.whistle);
  o.start(t); o.stop(t + dur + 0.2); v.start(t); v.stop(t + dur + 0.2);
  n.start(t); n.stop(t + dur + 0.05);
  o.onended = () => { o.disconnect(); v.disconnect(); vg.disconnect(); g.disconnect(); p2.disconnect(); p2g.disconnect(); p3.disconnect(); p3g.disconnect(); };
  n.onended = () => { n.disconnect(); bp.disconnect(); ng.disconnect(); };
}

function fiddle(t, semi, dur, vol) {
  sounded('fiddle');
  const c = G.ctx;
  const f = G.num(fOf(semi) * 0.5, 220, 60, 2000);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(G.gainOf(vol, 0.3), t + Math.min(0.12, dur * 0.3));
  g.gain.setTargetAtTime(G.gainOf(vol * 0.75, 0.3), t + 0.15, dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.7;
  for (const det of [0, 0.4]) {
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * (1 + det * 0.004), t);
    o.connect(lp);
    o.start(t); o.stop(t + dur + 0.15);
    o.onended = () => o.disconnect();
  }
  lp.connect(g); g.connect(layers.fiddle);
}

function pluck(t, semi, vol) {
  sounded('pluck');
  const c = G.ctx;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(G.num(fOf(semi) * 0.5, 147, 40, 1600), t);
  const bod = c.createBiquadFilter(); bod.type = 'lowpass'; bod.frequency.value = 2400; bod.Q.value = 0.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.3), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(bod); bod.connect(g); g.connect(layers.pluck); g.connect(G.echoIn);
  o.start(t); o.stop(t + 1.2);
  o.onended = () => { o.disconnect(); bod.disconnect(); g.disconnect(); };
}

function drone(t, semi, dur, vol) {
  sounded('drone');
  const c = G.ctx;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(G.gainOf(vol, 0.25), t + dur * 0.3);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 460; lp.Q.value = 0.4;
  for (const det of [-0.05, 0.05]) {
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(G.num(fOf(semi) * 0.25 * (1 + det * 0.02), 73, 30, 400), t);
    o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    o.onended = () => o.disconnect();
  }
  lp.connect(g); g.connect(layers.drone);
}

function drum(t, vol, deep = false) {
  sounded('drum');
  const c = G.ctx;
  const n = G.noiseSrc(false);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(deep ? 340 : 620, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.18);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(G.gainOf(vol * 0.6, 0.35), t + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + (deep ? 0.34 : 0.2));
  n.connect(lp); lp.connect(ng); ng.connect(layers.drum);
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(deep ? 72 : 96, t);
  o.frequency.exponentialRampToValueAtTime(deep ? 42 : 58, t + 0.16);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.4), t + 0.008);
  og.gain.exponentialRampToValueAtTime(0.0001, t + (deep ? 0.4 : 0.24));
  o.connect(og); og.connect(layers.drum);
  n.start(t); n.stop(t + 0.4); o.start(t); o.stop(t + 0.45);
  n.onended = () => { n.disconnect(); lp.disconnect(); ng.disconnect(); };
  o.onended = () => { o.disconnect(); og.disconnect(); };
}

function horn(t, semi, dur, vol) {
  sounded('horn');
  const c = G.ctx;
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(G.num(fOf(semi) * 0.25, 73, 30, 500), t);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(G.gainOf(vol, 0.3), t + Math.min(0.25, dur * 0.4));
  g.gain.setTargetAtTime(G.gainOf(vol * 0.7, 0.3), t + 0.3, dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  o.connect(lp); lp.connect(g); g.connect(layers.horn);
  o.start(t); o.stop(t + dur + 0.25);
  o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
}

/* ---------------- the adventure voices ----------------

   What the old score was missing was body. A sine whistle over a
   drone is a sketch of music; these are the parts that make it
   sound like somewhere you are going. */

/** Warm sustained strings — the floor everything else stands on. */
function strings(t, semis, dur, vol) {
  sounded('strings');
  const c = G.ctx;
  const g = c.createGain();
  const a = Math.min(0.7, dur * 0.35);   // strings swell, they do not start
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(G.gainOf(vol, 0.5), t + a);
  g.gain.setValueAtTime(G.gainOf(vol, 0.5), t + dur * 0.72);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  /* Triangles with one saw under them, not a bank of saws.
     Reported: "the synths are too much". Six sawtooth voices through a
     2.1kHz filter is the sound of a synthesiser pad and nothing else — a
     sawtooth carries every harmonic, and six of them detuned is a wall of
     them. A triangle has only the odd ones and they fall away fast, which
     is much closer to rosin on a string; a single quiet saw underneath
     keeps the bite that stops it sounding like a flute choir. The filter
     comes down with it, because the buzz lives above a kilohertz. */
  lp.frequency.setValueAtTime(620, t);
  lp.frequency.linearRampToValueAtTime(1250, t + a);      // the bow taking hold
  lp.Q.value = 0.4;
  for (const semi of semis) {
    for (const det of [-0.5, 0.5]) {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(G.num(fOf(semi) * 0.5 * (1 + det * 0.0035), 220, 50, 2400), t);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.15);
      o.onended = () => o.disconnect();
    }
    const sw = c.createOscillator(); sw.type = 'sawtooth';
    sw.frequency.setValueAtTime(G.num(fOf(semi) * 0.5, 220, 50, 2400), t);
    const swg = c.createGain(); swg.gain.setValueAtTime(0.18, t);
    sw.connect(swg); swg.connect(lp);
    sw.start(t); sw.stop(t + dur + 0.15);
    sw.onended = () => { sw.disconnect(); swg.disconnect(); };
  }
  lp.connect(g); g.connect(layers.strings); g.connect(G.echoIn);
}

/** A harp: the sparkle running through the middle of the sea music. */
function harp(t, semi, vol) {
  sounded('harp');
  const c = G.ctx;
  const f = G.num(fOf(semi), 440, 60, 3600);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.35), t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  /* Open at the top. A triangle through a 3.8k lowpass is a warm thud; the
     spectrum showed the whole band above 2.8k sitting thirty dB under the
     rest of the score, which is a soundtrack with no daylight in it. Two
     partials and room to breathe put the sparkle back. */
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.4;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(f, t);
  const o2 = c.createOscillator(); o2.type = 'sine';       // the string's second partial
  o2.frequency.setValueAtTime(f * 2.01, t);
  const g2 = c.createGain(); g2.gain.setValueAtTime(0.3, t);
  const o3 = c.createOscillator(); o3.type = 'sine';       // and the shimmer above it
  o3.frequency.setValueAtTime(f * 3.02, t);
  const g3 = c.createGain(); g3.gain.setValueAtTime(0.065, t);
  o3.connect(g3); g3.connect(lp);
  o3.start(t); o3.stop(t + 1.6);
  o.connect(lp); o2.connect(g2); g2.connect(lp);
  lp.connect(g); g.connect(layers.harp); g.connect(G.echoIn);
  o.start(t); o.stop(t + 1.6); o2.start(t); o2.stop(t + 1.6);
  o.onended = () => { o.disconnect(); o2.disconnect(); g2.disconnect(); o3.disconnect(); g3.disconnect(); lp.disconnect(); g.disconnect(); };
}

/** Pizzicato bass on the root: what gives the roll its bottom. */
function bass(t, semi, dur, vol) {
  sounded('bass');
  const c = G.ctx;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(G.num(fOf(semi) * 0.25, 73, 28, 400), t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.45), t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(1.4, dur));
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
  o.connect(lp); lp.connect(g); g.connect(layers.bass);
  o.start(t); o.stop(t + dur + 0.1);
  o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
}

/** A shaker on the off-beats: the thing that makes it move. */
function shake(t, vol) {
  sounded('shake');
  const c = G.ctx;
  const n = G.noiseSrc(false);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.2), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  n.connect(hp); hp.connect(g); g.connect(layers.shake);
  n.start(t); n.stop(t + 0.12);
  n.onended = () => { n.disconnect(); hp.disconnect(); g.disconnect(); };
}

function bellTing(t, semi, vol) {
  sounded('bell');
  const c = G.ctx;
  const f = G.num(fOf(semi) * 2, 1174, 200, 5000);
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.12), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(g); g.connect(layers.bell);
  /* A struck bar is not a sine. Its second mode sits near 2.7 times the
     fundamental and is not a harmonic of it, which is exactly why a
     glockenspiel rings rather than hums — and it is also the only thing in
     this score with any energy above three kilohertz now that the strings
     have been softened out of that range. It decays faster than the
     fundamental, the way a real bar does. */
  const p2 = c.createOscillator(); p2.type = 'sine';
  p2.frequency.setValueAtTime(G.num(f * 2.76, 3240, 300, 11000), t);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(G.gainOf(vol * 0.5, 0.08), t + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  p2.connect(g2); g2.connect(layers.bell);
  o.start(t); o.stop(t + 1.7); p2.start(t); p2.stop(t + 0.6);
  o.onended = () => { o.disconnect(); g.disconnect(); };
  p2.onended = () => { p2.disconnect(); g2.disconnect(); };
}

/* ---------------- arrangements ----------------

   Each state schedules ONE bar (4 beats) when asked, into the
   layer gains. Which layers are audible is the mixer's business,
   so a state change mid-bar fades rather than cuts. `bar` is the
   running bar count; bar % 8 is the position in the tune. */

/** The melody notes that fall inside this bar, in the given mode. */
function motifNotesInBar(bar, mode) {
  const b0 = (bar % 8) * 4;
  return MOTIF.filter(n => n[1] >= b0 && n[1] < b0 + 4)
    .map(([s, st, d]) => [inMode(s, mode), st - b0, d]);
}

/**
 * Open water: the adventure.
 *
 * Six eighths to the bar, a chord under each, strings holding the harmony,
 * a harp rolling through it and a flute improvising on top. Nothing here is
 * a fixed sequence — the chords come from a phrase pool and the tune is made
 * from them — so it can play for an hour without arriving anywhere it has
 * been. A "rest" passage thins the band to strings and a little harp rather
 * than falling silent, which is what the old score did for minutes at a time
 * and is most of why the music read as weak.
 */
function arrangeSea(t0, spb, bar) {
  const ch = chordAt(bar);
  const barLen = spb * SEA_BEATS;
  const thin = passage === 'rest';

  // the floor: strings on the chord, always, so the sea is never empty
  strings(t0, [ch[0], ch[1], ch[2]], barLen * 1.02, thin ? 0.055 : 0.085);
  // and the bottom of the roll
  bass(t0, ch[0], spb * 2.4, thin ? 0.055 : 0.095);
  if (!thin) bass(t0 + spb * 3, ch[0] + (phrase.arp ? 7 : 0), spb * 2.4, 0.065);

  // the harp: a rolled chord on the bar, running figures through the middle
  if (phrase.arp || thin) {
    const roll = [ch[0], ch[1], ch[2], ch[3]];
    for (let i = 0; i < roll.length; i++) {
      harp(t0 + i * 0.055, roll[i], (thin ? 0.04 : 0.055) * (1 - i * 0.08));
    }
  }
  if (!thin && phrase.arp) {
    const fig = [ch[1], ch[2], ch[3], ch[2]];
    for (let i = 0; i < 4; i++) harp(t0 + (1.5 + i * 0.75) * spb, fig[i] + 12, 0.032);
  }

  if (thin) return;

  // the flute, improvising over the chord
  const i = (bar - phrase.at + 4) % 4;
  if (i !== phrase.breath) {
    const notes = melodyFor(bar, 0);
    for (let k = 0; k < notes.length; k++) {
      const [semi, at] = notes[k];
      const next = notes[k + 1] ? notes[k + 1][1] : SEA_BEATS;
      whistle(t0 + at * spb, semi, (next - at) * spb * 0.88, 0.135 * dialect.whistle,
        { grace: Math.random() < 0.3, high: false });
    }
  }

  // the lilt: shaker on the back of each dotted beat, a soft drum on the bar
  for (const b of [1, 2, 4, 5]) shake(t0 + b * spb, b % 3 === 2 ? 0.045 : 0.028);
  drum(t0, 0.038);
  // a horn under the turn of every second phrase: the horizon opening
  if (bar % 8 === 0) horn(t0, ch[0] + 12, barLen * 1.6, 0.045);
  /* And a glockenspiel catching the light on the first bar of a phrase. It is
     the highest thing in the arrangement and the only one above 3kHz with any
     weight, which is what stops warm becoming muffled. */
  /* The glockenspiel is where the air comes from now. Softening the strings
     to stop them sounding like a synthesiser took the top off the whole
     score with them — a triangle has no harmonics up there to give — so the
     daylight has to come from something struck rather than from something
     bowed. One on the turn of the phrase, one across the middle of it, and
     a light one on the bar between; it is the least synthetic voice here and
     the only one that can hold that end of the spectrum. */
  const inPhrase = (bar - phrase.at + 4) % 4;
  if (inPhrase === 0) bellTing(t0, ch[2] + 12, 0.075);
  if (inPhrase === 2) bellTing(t0 + spb * 3, ch[1] + 12, 0.055);
  if (phrase.arp && inPhrase % 2 === 1) bellTing(t0 + spb * 1.5, ch[3] + 12, 0.04);
}

function arrangePort(t0, spb, bar) {
  const d = dialect;
  /* A harbour still plays the tune — that is what the tune is for — but the
     room has a floor under it now. Strings on the mode's own triad, quietly,
     so a town is warm rather than thin, and the folk band plays over that. */
  const tri = [inMode(0, d.mode), inMode(d.mode === 'aeolian' ? 3 : 4, d.mode), inMode(7, d.mode)];
  if (passage === 'rest') {
    // towns breathe too, but the room stays warm
    strings(t0, tri, spb * 4.1, 0.07);
    if (bar % 2 === 0) drone(t0, 0, spb * 8, 0.045);
    if (bar % 2 === 1) harp(t0 + spb * 2, inMode(7, d.mode), 0.05);
    if (bar % 4 === 1 && d.bell > 0.2) bellTing(t0 + spb, inMode(7, d.mode), 0.04);
    return;
  }
  strings(t0, tri, spb * 4.1, 0.085);
  if (bar % 4 === 0) drone(t0, 0, spb * 16, 0.08);
  // a harp behind the band, which is what turns a session into a place
  for (const b of [0.5, 1.5, 2.5, 3.5]) harp(t0 + b * spb, inMode(b < 2 ? 7 : 12, d.mode), 0.04);
  for (const b of [0.5, 1.5, 2.5, 3.5]) shake(t0 + b * spb, 0.06);
  for (const [s, st, len] of motifNotesInBar(bar, d.mode)) {
    whistle(t0 + st * spb, s, len * spb * 0.9, 0.14 * d.whistle,
      { grace: Math.random() < d.ornament, high: !!d.high });
    // the fiddle shadows the tune a sixth below, the way session players do
    if (d.fiddle > 0.4 && len >= 1) fiddle(t0 + st * spb, s - 9, len * spb, 0.05 * d.fiddle);
  }
  // an accompaniment with actual time in it
  for (let b = 0; b < 4; b++) {
    if (d.pluck > 0.3) pluck(t0 + b * spb, inMode(b % 2 ? 7 : 0, d.mode) - 12, 0.07 * d.pluck);
    if (d.drum > 0.3 && (b === 0 || b === 2)) drum(t0 + b * spb, 0.06 * d.drum);
  }
  if (d.horn > 0.4 && bar % 8 === 6) horn(t0, inMode(-5, d.mode), spb * 4, 0.06 * d.horn);
  if (d.bell > 0.3 && bar % 8 === 0) bellTing(t0, inMode(12, d.mode), 0.05 * d.bell);
}

function arrangeTension(t0, spb, bar, high) {
  // the tune goes to pieces: two or three notes of the opening, then silence
  const mode = 'aeolian';
  drone(t0, -2, spb * 4.2, high ? 0.12 : 0.09);
  const pulse = high ? [0, 1.5, 2, 3.5] : [0, 2];
  for (const b of pulse) drum(t0 + b * spb, high ? 0.1 : 0.07, true);
  if (bar % 4 === (high ? 1 : 2)) {
    for (const [s, st, len] of FRAG_OPEN.slice(0, high ? 2 : 3)) {
      whistle(t0 + st * spb, inMode(s, mode), len * spb * 0.8, 0.1, { low: true });
    }
  }
  if (high && bar % 8 === 5) horn(t0, inMode(-4, mode), spb * 3, 0.07);
}

function arrangeBattle(t0, spb, bar, phase) {
  const mode = 'aeolian';
  const den = { a: 0.5, b: 1, c: 1.3, d: 0.7 }[phase] || 1;
  // war drums: the frame drum answered by a deeper one
  const beats = phase === 'c'
    ? [0, 0.5, 1, 1.75, 2, 2.5, 3, 3.5]
    : phase === 'a' ? [0, 2, 3] : [0, 1, 1.5, 2, 3, 3.5];
  for (const b of beats) drum(t0 + b * spb, 0.09 * den, b % 2 === 0);
  drone(t0, phase === 'c' ? -4 : -2, spb * 4.2, 0.1);
  // low brass on the bar line, denser as it worsens
  if (bar % 2 === 0) horn(t0, inMode(phase === 'c' ? -4 : 0, mode), spb * (phase === 'a' ? 2 : 3), 0.08 * den);
  // the fiddle saws an ostinato through the middle phases
  if (phase === 'b' || phase === 'c') {
    for (let b = 0; b < 4; b++) fiddle(t0 + b * spb, inMode(b % 2 ? 3 : 0, mode) - 12, spb * 0.5, 0.045);
  }
  /* And the whistle refuses to die. In the worst of it there are only
     two notes of the tune; with the advantage the whole tail returns —
     which is how the player hears the fight turning before the UI says so. */
  if (phase === 'd') {
    if (bar % 4 === 0) {
      for (const [s, st, len] of FRAG_TAIL) {
        whistle(t0 + (st - 24) * spb, inMode(s, 'dorian'), len * spb * 0.9, 0.13);
      }
    }
  } else if (bar % 4 === 2 && phase !== 'c') {
    for (const [s, st, len] of FRAG_OPEN.slice(0, 2)) {
      whistle(t0 + st * spb, inMode(s, mode), len * spb * 0.8, 0.1);
    }
  }
}

function arrangeBoarding(t0, spb, bar) {
  // the fight is no longer around you — drums close, strings struck, no sea room
  for (const b of [0, 0.75, 1.5, 2, 2.75, 3.5]) drum(t0 + b * spb, 0.1, b % 1.5 === 0);
  for (let b = 0; b < 4; b++) pluck(t0 + b * spb, inMode(b % 2 ? 3 : 0, 'aeolian') - 12, 0.08);
  if (bar % 2 === 1) fiddle(t0, inMode(-2, 'aeolian'), spb * 2, 0.06);
  if (bar % 4 === 3) horn(t0, inMode(0, 'aeolian'), spb * 2.5, 0.07);
  if (bar % 8 === 6) {
    for (const [s, st, len] of FRAG_OPEN.slice(0, 3)) {
      whistle(t0 + st * spb, inMode(s, 'aeolian'), len * spb * 0.8, 0.11);
    }
  }
}

/* one-shots, scheduled entire when triggered */
function playVictory() {
  const c = G.ctx, t = c.currentTime + 0.1, spb = 60 / 84;
  // percussion falls away by itself: nothing here but the tune, whistle over horn
  for (const [s, st, len] of FRAG_TAIL) {
    const at = t + (st - 24) * spb;
    whistle(at, inMode(s, 'dorian'), len * spb, 0.16, { grace: false });
    horn(at, inMode(s, 'dorian') - 12, len * spb * 1.1, 0.06);
  }
  bellTing(t + 4 * spb, 0, 0.05);
}
function playDefeat() {
  const c = G.ctx, t = c.currentTime + 0.3, spb = 60 / 56;
  drone(t, -2, spb * 10, 0.08);
  // the opening, low, alone, and it does not finish
  for (const [s, st, len] of FRAG_OPEN.slice(0, 3)) {
    whistle(t + st * spb, inMode(s, 'aeolian'), len * spb, 0.12, { low: true });
  }
  horn(t + 5 * spb, inMode(-4, 'aeolian'), spb * 3, 0.05);
}
function playDiscovery() {
  const c = G.ctx, t = c.currentTime + 0.05, spb = 60 / 92;
  for (const [s, st, len] of FRAG_OPEN) {
    whistle(t + st * spb * 0.5, inMode(s, 'dorian'), len * spb * 0.5, 0.13, { grace: st > 0 });
  }
  horn(t + 2 * spb, inMode(0, 'dorian'), spb * 1.6, 0.045);
}

/* ---------------- the mixer ----------------

   Which layers are heard in which state. State changes ramp these
   over civil or urgent times; the arrangers keep writing notes into
   the same gains throughout, so a transition is a mix moving, not a
   track restarting. */
const MIX = {
  /* `bell` was 0.2 here, from when the glockenspiel was a rare ornament that
     belonged to harbours. It carries the whole top of the sea arrangement
     now — everything else was softened out of that range on purpose — and at
     a fifth of its level the score had no air in it whatever the instrument
     did. That is what "the levels seem off" was. */
  sea: { whistle: 1, fiddle: 0.7, pluck: 0.8, drone: 1, drum: 0.5, horn: 0.4, bell: 0.85, strings: 1, harp: 1, bass: 0.9, shake: 0.8, ramp: 6 },
  approach: { whistle: 1, fiddle: 0.8, pluck: 0.9, drone: 0.9, drum: 0.6, horn: 0.6, bell: 0.85, strings: 1, harp: 1, bass: 0.9, shake: 0.7, ramp: 8 },
  port: { whistle: 1, fiddle: 1, pluck: 1, drone: 0.8, drum: 0.8, horn: 0.8, bell: 1, strings: 0.9, harp: 0.8, bass: 0.5, shake: 0.6, ramp: 5 },
  /* Danger takes the adventure away with it. The strings hold on for a moment
     under the tension states — a threat is more frightening when the warmth
     is being pulled out from under you than when it was never there. */
  tension_low: { whistle: 0.8, fiddle: 0.3, pluck: 0.2, drone: 1, drum: 1, horn: 0.6, bell: 0, strings: 0.35, harp: 0.15, bass: 0.5, shake: 0, ramp: 4 },
  tension_high: { whistle: 0.8, fiddle: 0.3, pluck: 0.1, drone: 1, drum: 1, horn: 0.9, bell: 0, strings: 0.2, harp: 0, bass: 0.4, shake: 0, ramp: 2.5 },
  battle: { whistle: 0.9, fiddle: 0.8, pluck: 0.3, drone: 1, drum: 1, horn: 1, bell: 0, strings: 0.25, harp: 0, bass: 0.5, shake: 0, ramp: 1.6 },
  boarding: { whistle: 0.9, fiddle: 0.9, pluck: 1, drone: 0.7, drum: 1, horn: 0.9, bell: 0, strings: 0, harp: 0, bass: 0.4, shake: 0, ramp: 1.2 },
};

function applyMix(name) {
  const m = MIX[name] || MIX.sea;
  const t = G.ctx.currentTime;
  for (const n of LAYER_NAMES) {
    layers[n].gain.setTargetAtTime(Math.max(0.0001, (m[n] ?? 0)), t, m.ramp / 3);
  }
}

/* ---------------- state resolution ----------------

   The one place gameplay becomes music. st is whatever updateAudio
   was given; everything is optional and coerced, because the audio
   suite feeds this garbage on purpose. */
function resolveWanted(st) {
  const mode = typeof st.mode === 'string' ? st.mode : 'campaign';
  if (st.boarding === true) return ['boarding', {}];
  if (mode === 'battle') return ['battle', { phase: 'abcd'.includes(st.battlePhase) ? st.battlePhase : 'b' }];
  const tension = G.num(st.tension, 0, 0, 2);
  if (tension >= 2) return ['tension_high', {}];
  if (tension >= 1) return ['tension_low', {}];
  if (st.portId && typeof st.portId === 'string') {
    return ['port', { faction: st.portFaction, port: st.portId }];
  }
  const near = G.num(st.nearPort, 0, 0, 1);
  if (near > 0.55 && st.nearPortId) {
    return ['approach', { faction: st.nearPortFaction, port: st.nearPortId }];
  }
  return ['sea', {}];
}

/** How long a wish must hold before the music believes it. Combat is
    believed almost at once; civil states must persist, so sailing the
    rim of a harbour's radius cannot make the score stutter. */
const DEBOUNCE = { battle: 0.3, boarding: 0.3, tension_high: 1, tension_low: 2.2, approach: 3, port: 0.5, sea: 4 };
/** And once believed, civil states hold a while, so rapid flapping
    between two quiet truths cannot thrash the mix. */
const MIN_DWELL = { sea: 8, approach: 6, port: 8, tension_low: 5, tension_high: 3, battle: 2, boarding: 2 };

function enterState(next, det) {
  state = next;
  detail = det || {};
  dwellUntil = G.ctx.currentTime + (MIN_DWELL[next] || 4);
  if (next === 'port' || next === 'approach') dialect = portDialect(detail.faction, detail.port);
  else if (next === 'sea') dialect = SEA_DIALECT;
  else dialect = { ...SEA_DIALECT, bpm: DIALECTS.pirate.bpm };
  if (next === 'battle') dialect = { ...dialect, bpm: 112 };
  if (next === 'boarding') dialect = { ...dialect, bpm: 120 };
  if (next === 'tension_low' || next === 'tension_high') dialect = { ...dialect, bpm: 92 };
  applyMix(next);
  // a fight starts its music now, not at the end of the current bar
  if (next === 'battle' || next === 'boarding') barStart = Math.min(barStart, G.ctx.currentTime + 0.15);
}

/* ---------------- driving ---------------- */
export function musicUpdate(dt, st) {
  if (!running || !G) return;
  const now = G.ctx.currentTime;

  // one-shot latches override the machine briefly
  if (stinger && now > stingerUntil) stinger = null;

  const [want, det] = resolveWanted(st || {});
  const key = want + '|' + JSON.stringify(det);
  if (key !== wanted) { wanted = key; wantedSince = now; wantedDetail = det; }
  const askFor = want;
  const held = now - wantedSince;
  const currentKey = state + '|' + JSON.stringify(detail);
  /* Danger is never made to wait its turn. Civil states hold a minimum dwell
     so that sailing the rim of a harbour's radius cannot thrash the mix, but
     the whole point of the tension layer is to be heard BEFORE the thing it
     warns about — so anything with a threat in it preempts the dwell. */
  const urgent = askFor === 'battle' || askFor === 'boarding'
    || askFor === 'tension_high' || askFor === 'tension_low';
  if (key !== currentKey && held >= (DEBOUNCE[askFor] || 2) && (now >= dwellUntil || urgent)) {
    enterState(askFor, wantedDetail);
  }

  // fatigue: alternate passages of tune and passages of sea
  if (now > passageUntil) {
    if (passage === 'play') {
      passage = 'rest';
      passageUntil = now + (state === 'port' ? 25 + Math.random() * 35 : 50 + Math.random() * 110);
    } else {
      passage = 'play';
      passageUntil = now + (state === 'port' ? 60 + Math.random() * 60 : 55 + Math.random() * 35);
      barIdx += (8 - (barIdx % 8)) % 8;      // the tune re-enters at its beginning
    }
  }
  // danger does not rest
  const alwaysOn = state === 'battle' || state === 'boarding' || state === 'tension_high';

  /* The scheduler: place the next bar when it draws near.
     Open water is in six-eight and beats faster on the eighth; the tune's own
     states keep four-four, so the bar length is asked for rather than assumed
     — `spb * 4` was written into three places when there was only one metre. */
  const seaSide = state === 'sea' || state === 'approach';
  const beats = seaSide ? SEA_BEATS : 4;
  const spb = seaSide
    ? 60 / G.num(dialect.bpm * 1.95, 165, 60, 260)      // eighths, at a walking roll
    : 60 / G.num(dialect.bpm, 80, 40, 160);
  if (now > barStart - LOOKAHEAD) {
    const t0 = Math.max(barStart, now + 0.05);
    if (stinger === null) {
      const p = alwaysOn ? 'play' : passage;
      const keep = passage; passage = p;
      scheduleBar(t0, spb, barIdx);
      passage = keep;
    }
    barStart = t0 + spb * beats;
    barIdx++;
  }
}

function scheduleBar(t0, spb, bar) {
  for (const k in lastBarVoices) delete lastBarVoices[k];
  switch (state) {
    case 'battle': arrangeBattle(t0, spb, bar, detail.phase || 'b'); break;
    case 'boarding': arrangeBoarding(t0, spb, bar); break;
    case 'tension_low': arrangeTension(t0, spb, bar, false); break;
    case 'tension_high': arrangeTension(t0, spb, bar, true); break;
    case 'port': arrangePort(t0, spb, bar); break;
    case 'approach': {
      /* the approach is literally both mixes at once: the sea arrangement
         thinning while the town's dialect begins to answer — the crossfade
         in applyMix does the moving, this keeps both hands playing */
      arrangeSea(t0, spb, bar);
      if (bar % 2 === 0) arrangePort(t0, spb, bar);
      break;
    }
    default: arrangeSea(t0, spb, bar);
  }
}

/* ---------------- events ---------------- */
export function musicEvent(name) {
  if (!running || !G) return;
  const now = G.ctx.currentTime;
  if (name === 'victory') {
    stinger = 'victory'; stingerUntil = now + 5.5;
    playVictory();
    passage = 'rest'; passageUntil = now + 20 + Math.random() * 30;
  } else if (name === 'defeat') {
    stinger = 'defeat'; stingerUntil = now + 12;
    applyMix('sea');
    playDefeat();
  } else if (name === 'discovery') {
    // never over a fight: a discovery mid-battle can wait for the score
    if (state === 'battle' || state === 'boarding') return;
    playDiscovery();
  }
}

/* For the QA suite: the generator, so the score's own properties — that it
   keeps inventing something new and stays in its key — can be read rather
   than listened for. */
export function __phraseFor(bar) { newPhrase(bar); return phrase; }
/* What the last scheduled bar actually put on the clock. "Is this a band or
   is it a whistle and a drone" is a question about how many voices are
   sounding, and that is worth asking directly — measuring it through the
   spectrum instead means the answer moves whenever the timbres are retuned,
   which is a check that fails for taste rather than for regression. */
export function __lastBar() { return { ...lastBarVoices }; }
export function __melodyFor(bar) { return melodyFor(bar, 0); }

/** For the QA suite: what the controller believes, and why. */
export function musicState() {
  return running ? {
    state, detail, passage, bar: barIdx, stinger,
    bpm: dialect ? dialect.bpm : 0, mode: dialect ? dialect.mode : '',
  } : null;
}
