/* ===========================================================
   The score. One melody, many weathers.

   Salt & Tally's music is a single eight-bar folk tune — "The
   Long Water" — that the whole soundtrack is arrangements of.
   Alone on open water it is a tin whistle over a drone. Near a
   harbour the town's instruments pick it up in that power's
   dialect. When a hunter closes it breaks into fragments over
   a drum pulse, in a battle the drums own it and the whistle
   fights through in pieces, and when the fight is won the tune
   comes back whole for a few seconds before the sea takes over.

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

const LAYER_NAMES = ['whistle', 'fiddle', 'pluck', 'drone', 'drum', 'horn', 'bell'];

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
  const c = G.ctx;
  const f = G.num(fOf(semi) * (opts.low ? 0.5 : 1) * (opts.high ? 2 : 1), 440, 80, 4000);
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
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
  o.connect(g); g.connect(layers.whistle); g.connect(G.echoIn);
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
  o.onended = () => { o.disconnect(); v.disconnect(); vg.disconnect(); g.disconnect(); };
  n.onended = () => { n.disconnect(); bp.disconnect(); ng.disconnect(); };
}

function fiddle(t, semi, dur, vol) {
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

function bellTing(t, semi, vol) {
  const c = G.ctx;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(G.num(fOf(semi) * 2, 1174, 200, 5000), t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(G.gainOf(vol, 0.12), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(g); g.connect(layers.bell);
  o.start(t); o.stop(t + 1.7);
  o.onended = () => { o.disconnect(); g.disconnect(); };
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

function arrangeSea(t0, spb, bar) {
  const d = dialect;
  if (passage === 'rest') {
    // the rest of a rest is genuine: at most a low drone breathing
    if (bar % 4 === 0) drone(t0, 0, spb * 16, 0.05);
    return;
  }
  if (bar % 8 === 0) drone(t0, 0, spb * 32, 0.09);
  // the whistle carries the tune, and sometimes simply doesn't play a phrase
  const phrase = (bar / 2 | 0) % 4;
  const skip = (bar % 16 >= 12);       // last two bars of every other pass: sea only
  if (!skip) {
    for (const [s, st, len] of motifNotesInBar(bar, d.mode)) {
      whistle(t0 + st * spb, s, len * spb * 0.92, 0.16 * d.whistle,
        { grace: Math.random() < d.ornament, high: false });
    }
  }
  // sparse answers underneath
  if (phrase % 2 === 1 && bar % 2 === 0) pluck(t0, inMode(0, d.mode) - 12, 0.09 * d.pluck);
  if (bar % 8 === 4 && d.fiddle > 0.2) fiddle(t0, inMode(-5, d.mode), spb * 6, 0.05 * d.fiddle);
  if (bar % 4 === 2 && Math.random() < 0.4) drum(t0 + spb * 3.5, 0.05 * d.drum);
}

function arrangePort(t0, spb, bar) {
  const d = dialect;
  if (passage === 'rest') {
    // towns breathe too, but the room stays warm
    if (bar % 2 === 0) drone(t0, 0, spb * 8, 0.05);
    if (bar % 4 === 1 && d.bell > 0.2) bellTing(t0 + spb, inMode(7, d.mode), 0.04);
    return;
  }
  if (bar % 4 === 0) drone(t0, 0, spb * 16, 0.08);
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
  sea: { whistle: 1, fiddle: 0.7, pluck: 0.8, drone: 1, drum: 0.5, horn: 0.4, bell: 0.2, ramp: 6 },
  approach: { whistle: 1, fiddle: 0.8, pluck: 0.9, drone: 0.9, drum: 0.6, horn: 0.6, bell: 0.7, ramp: 8 },
  port: { whistle: 1, fiddle: 1, pluck: 1, drone: 0.8, drum: 0.8, horn: 0.8, bell: 1, ramp: 5 },
  tension_low: { whistle: 0.8, fiddle: 0.3, pluck: 0.2, drone: 1, drum: 1, horn: 0.6, bell: 0, ramp: 4 },
  tension_high: { whistle: 0.8, fiddle: 0.3, pluck: 0.1, drone: 1, drum: 1, horn: 0.9, bell: 0, ramp: 2.5 },
  battle: { whistle: 0.9, fiddle: 0.8, pluck: 0.3, drone: 1, drum: 1, horn: 1, bell: 0, ramp: 1.6 },
  boarding: { whistle: 0.9, fiddle: 0.9, pluck: 1, drone: 0.7, drum: 1, horn: 0.9, bell: 0, ramp: 1.2 },
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

  // the scheduler: place the next bar when it draws near
  const spb = 60 / G.num(dialect.bpm, 80, 40, 160);
  if (now > barStart - LOOKAHEAD) {
    const t0 = Math.max(barStart, now + 0.05);
    if (stinger === null) {
      const p = alwaysOn ? 'play' : passage;
      const keep = passage; passage = p;
      scheduleBar(t0, spb, barIdx);
      passage = keep;
    }
    barStart = t0 + spb * 4;
    barIdx++;
  }
}

function scheduleBar(t0, spb, bar) {
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

/** For the QA suite: what the controller believes, and why. */
export function musicState() {
  return running ? {
    state, detail, passage, bar: barIdx, stinger,
    bpm: dialect ? dialect.bpm : 0, mode: dialect ? dialect.mode : '',
  } : null;
}
