/* ===========================================================
   Procedural audio — no asset files.
   Layered ambience (swell, wind, gulls, hull creak), one-shot
   effects, and the adaptive score that lives in music.js.
   =========================================================== */
import { initMusic, musicUpdate, musicEvent, musicState } from './music.js';

let ctx = null, master = null, ambBus = null, sfxBus = null, musBus = null;
let started = false, muted = false;
let waveLFO = null, windGain = null, waveGain = null;
let gullTimer = 0, creakTimer = 0, harbourGain = null;
let noiseBuf = null, echoIn = null, probe = null;

/* A broadside is one call per gun, and a fleet action is several broadsides
   at once. Past a couple of dozen simultaneous voices the mix is mud and the
   audio thread starts missing its deadline, which is what actually makes the
   harsh noise — so count them and drop the ones nobody would hear anyway. */
/** Where the master sits when it is not muted, in one place so unmuting
    cannot restore a level the mixer was never set to. */
const MASTER = 0.75;
const MAX_VOICES = 24;
let voices = 0;
function voice(seconds) {
  if (voices >= MAX_VOICES) return false;
  voices++;
  setTimeout(() => { voices--; }, Math.max(1, seconds * 1000));
  return true;
}

/* Every number that reaches an AudioParam goes through here first.

   This is not defensive tidiness. A NaN written to a gain or a frequency does
   not merely spoil one voice: it propagates into the internal state of every
   filter and compressor downstream, and those never recover — the graph
   screams until the page is reloaded. One bad distance from one bad frame is
   enough. So nothing reaches a param without being finite and in range. */
function num(v, fallback, lo, hi) {
  const n = (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}
/** Gains for exponential ramps must be positive and non-zero, never 0. */
function gainOf(v, hi = 1) { return num(v, 0.02, 0.0002, hi); }

/**
 * How loud something that far away should be, and zero once it is somebody
 * else's business entirely.
 *
 * Everything used to have a volume floor instead of a cutoff, so a boarding
 * or a broadside on the far side of the shoals arrived at the same level as
 * one alongside — and the world simulates those whether you are watching or
 * not. Out past `far` you hear nothing, which is both correct and what keeps
 * the voice count for things actually happening to you.
 */
function atten(dist, near, far) {
  const d = num(dist, 0, 0, 1e6);
  if (d >= far) return 0;
  if (d <= near) return 1;
  const t = 1 - (d - near) / (far - near);
  return t * t;                       // falls away quickly, then tails off
}

export const audio = {
  get ready() { return started && !!ctx; },
  get muted() { return muted; },
};

function noise() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;      // brownish
    d[i] = last * 3.2 + w * 0.25;
  }
  return noiseBuf;
}
function src(loop = true) {
  const s = ctx.createBufferSource();
  s.buffer = noise(); s.loop = loop;
  return s;
}

export function initAudio() {
  if (started) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = MASTER;
  /* Everything is synthesised live and a broadside can stack a dozen voices in
     one frame, which clips the sum into a fizzing mess.

     A compressor alone does not settle this: at a 4ms attack the front of a
     transient is already through before it acts, and a fleet action measured
     1.076 at the destination — past full scale, which is distortion, which is
     exactly the harshness this is meant to prevent. So: a lower threshold, a
     fast attack, and a fixed ceiling behind it. The headroom costs a little
     loudness and buys a mix that cannot be made to spit. */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -16; limiter.knee.value = 4;
  limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.14;
  const ceiling = ctx.createGain(); ceiling.gain.value = 0.82;
  master.connect(limiter); limiter.connect(ceiling); ceiling.connect(ctx.destination);
  // a tap on the very end of the chain, so a test can see what the ear gets
  probe = ctx.createAnalyser(); probe.fftSize = 2048;
  ceiling.connect(probe);
  ambBus = ctx.createGain(); ambBus.gain.value = 0.0; ambBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
  musBus = ctx.createGain(); musBus.gain.value = 0.0; musBus.connect(master);

  // --- swell ---
  const n1 = src(); const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
  waveGain = ctx.createGain(); waveGain.gain.value = 0.5;
  n1.connect(bp); bp.connect(waveGain); waveGain.connect(ambBus); n1.start();
  // slow surge
  waveLFO = ctx.createOscillator(); waveLFO.frequency.value = 0.11;
  const lg = ctx.createGain(); lg.gain.value = 0.28;
  waveLFO.connect(lg); lg.connect(waveGain.gain); waveLFO.start();

  // --- wind ---
  const n2 = src(); const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass'; hp.frequency.value = 900; hp.Q.value = 0.5;
  windGain = ctx.createGain(); windGain.gain.value = 0.10;
  n2.connect(hp); hp.connect(windGain); windGain.connect(ambBus); n2.start();
  const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
  const wlg = ctx.createGain(); wlg.gain.value = 0.05;
  wl.connect(wlg); wlg.connect(windGain.gain); wl.start();

  // --- harbour murmur (faded in near port) ---
  const n3 = src(); const hb = ctx.createBiquadFilter();
  hb.type = 'bandpass'; hb.frequency.value = 480; hb.Q.value = 1.1;
  harbourGain = ctx.createGain(); harbourGain.gain.value = 0;
  n3.connect(hb); hb.connect(harbourGain); harbourGain.connect(ambBus); n3.start();

  /* One echo line for the whole score. A delay inside a feedback loop is a
     cycle, and every node in a cycle has an incoming connection, so nothing in
     it is ever collected — building a fresh one per note leaked a live delay
     line every couple of seconds until the audio thread was carrying hundreds
     of them and started to screech. Build it once, send the notes to it. */
  echoIn = ctx.createGain(); echoIn.gain.value = 0.34;
  const dl = ctx.createDelay(1); dl.delayTime.value = 0.34;
  const fb = ctx.createGain(); fb.gain.value = 0.30;
  const tame = ctx.createBiquadFilter();          // each repeat duller than the last
  tame.type = 'lowpass'; tame.frequency.value = 2200;
  echoIn.connect(dl); dl.connect(tame); tame.connect(fb); fb.connect(dl); dl.connect(musBus);

  started = true;
  ambBus.gain.setTargetAtTime(0.55, ctx.currentTime, 2.5);
  musBus.gain.setTargetAtTime(0.30, ctx.currentTime, 4);

  /* The score gets the graph on loan — the context, its bus, the shared echo
     line, and the same guards every param here goes through. Music can never
     be the reason the game fails to load: if anything in there throws, the
     mixer keeps running and the world stays playable. */
  try {
    initMusic({ ctx, musBus, echoIn, num, gainOf, noiseSrc: src });
  } catch (e) { console.warn('music controller failed to start', e); }
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.1);
  return muted;
}

/* ---------------- ambience driving ---------------- */
export function updateAudio(dt, st) {
  if (!started || !st) return;
  const t = ctx.currentTime;
  /* This is the one path where the world writes into the audio graph every
     frame, so it is the one place a stray NaN — an unplaced ship, a divide by
     a zero-length voyage — would get in and stay in. Everything is coerced. */
  const speedN = num(st.speedN, 0, 0, 1);
  const shallow = num(st.shallow, 0, 0, 1);
  const nearShore = num(st.nearShore, 0, 0, 1);
  const nearPort = num(st.nearPort, 0, 0, 1);
  const step = num(dt, 0, 0, 1);

  if (waveGain) waveGain.gain.setTargetAtTime(0.34 + speedN * 0.30 + shallow * 0.18, t, 0.6);
  if (windGain) windGain.gain.setTargetAtTime(0.06 + speedN * 0.09, t, 0.8);
  if (harbourGain) harbourGain.gain.setTargetAtTime(nearPort * 0.30, t, 1.2);

  gullTimer -= step;
  if (gullTimer <= 0) {
    gullTimer = 2.2 + Math.random() * 6;
    if (nearShore > 0.25 && Math.random() < nearShore) gull();
  }
  creakTimer -= step;
  if (creakTimer <= 0) { creakTimer = 3 + Math.random() * 7; if (speedN > 0.15) creak(); }

  /* The score reads the same state bag, in its own module, behind the same
     rule: a music bug may cost the music, never the frame. */
  try { musicUpdate(step, st); } catch (e) { void e; }
}

/** Gameplay's only other door into the score: victory, defeat, discovery. */
export function sfxMusicEvent(name) {
  if (!started) return;
  try { musicEvent(name); } catch (e) { void e; }
}
export { musicState };

/**
 * What is actually coming out of the end of the chain.
 *
 * A test hook, and the reason this bug cannot come back quietly: `bad` counts
 * samples that are not finite, and `peak` is the loudest sample in the last
 * buffer. Assertions can watch both while the game throws everything it has at
 * the mixer, which is the only way to catch a sound nobody happens to be
 * listening for.
 */
/**
 * Hold the sea and the score quiet, for measurement only.
 *
 * The ambience beds run continuously and their level wanders over a wider
 * range than a single effect contributes, so any attempt to measure one sound
 * against the mix ends up measuring the swell instead. With these down, what
 * the analyser sees is the effect and nothing else.
 */
export function audioSolo(on) {
  if (!started) return;
  const t = ctx.currentTime;
  ambBus.gain.setTargetAtTime(on ? 0.0001 : 0.55, t, 0.05);
  musBus.gain.setTargetAtTime(on ? 0.0001 : 0.30, t, 0.05);
}

export function audioStats() {
  if (!started || !probe) return null;
  const buf = new Float32Array(probe.fftSize);
  probe.getFloatTimeDomainData(buf);
  let peak = 0, bad = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) { bad++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { peak, bad, voices, state: ctx.state, time: ctx.currentTime };
}

/* ---------------- one-shots ---------------- */
function env(node, gain, a, d, dest = sfxBus) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  const at = num(a, 0.005, 0.001, 4), dc = num(d, 0.2, 0.01, 12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gainOf(gain), t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + at + dc);
  node.connect(g); g.connect(dest);
  return g;
}

export function sfxCannon(dist = 0) {
  if (!started) return;
  // a broadside two thousand units away is somebody else's war
  const vol = 0.85 * atten(dist, 120, 900);
  if (vol <= 0.012 || !voice(0.6)) return;
  const n = src(false);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(2400, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.42);
  n.connect(f);
  env(f, vol * 0.75, 0.004, 0.5);
  n.start(); n.stop(ctx.currentTime + 0.6);

  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.30);
  env(o, vol * 0.9, 0.006, 0.34);
  o.start(); o.stop(ctx.currentTime + 0.42);
}
export function sfxSplash(dist = 0) {
  if (!started) return;
  const vol = 0.4 * atten(dist, 70, 560);
  if (vol <= 0.008 || !voice(0.4)) return;
  const n = src(false);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
  f.frequency.setValueAtTime(1500, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
  n.connect(f); env(f, vol, 0.01, 0.34);
  n.start(); n.stop(ctx.currentTime + 0.4);
}
export function sfxWood(dist = 0) {
  if (!started) return;
  const vol = 0.55 * atten(dist, 90, 700);
  if (vol <= 0.01 || !voice(0.3)) return;
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(220, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.16);
  env(o, vol, 0.003, 0.18); o.start(); o.stop(ctx.currentTime + 0.24);
  const n = src(false); const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
  n.connect(f); env(f, vol * 0.6, 0.002, 0.14); n.start(); n.stop(ctx.currentTime + 0.2);
}
/**
 * Steel on steel — and the sound this project got most wrong.
 *
 * It was three square waves between 700 and 2100 Hz. A square at two kilohertz
 * puts harmonics at six, ten and fourteen, which is the exact band the ear
 * refuses to forgive, and boarding ticks every 0.62 seconds for as long as a
 * boarding lasts. It had no distance term and no voice cap, and the world
 * simulates boardings between strangers whether you are near them or not — so
 * a melee anywhere on the map arrived in your ears at full volume, out of
 * nowhere, four times a second if a few were running at once.
 *
 * Now: a filtered noise scrape for the blade, two soft triangles well below a
 * kilohertz for the ring, everything lowpassed, attenuated by distance, cut
 * off entirely past 620 units, and counted against the voice budget.
 */
export function sfxClash(dist = 0) {
  if (!started) return;
  const vol = atten(dist, 90, 620);
  if (vol <= 0.012 || !voice(0.4)) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const at = t0 + i * 0.055;
    const o = ctx.createOscillator(); o.type = 'triangle';
    const base = num(300 + Math.random() * 210, 380, 120, 900);
    o.frequency.setValueAtTime(base, at);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, at + 0.14);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = 2100; lp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gainOf(0.05 * vol, 0.2), at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
    o.connect(lp); lp.connect(g); g.connect(sfxBus);
    o.start(at); o.stop(at + 0.22);
    o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
  }
  const n = src(false); const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.7;
  n.connect(f); env(f, 0.08 * vol, 0.008, 0.22);
  n.start(); n.stop(t0 + 0.32);
  n.onended = () => { n.disconnect(); f.disconnect(); };
}
export function sfxClick(freq = 620) {
  if (!started || !voice(0.15)) return;
  const o = ctx.createOscillator(); o.type = 'triangle';
  // the one param a caller passes straight through: a NaN or an out-of-range
  // frequency here throws, and every UI tap goes through this
  o.frequency.setValueAtTime(num(freq, 620, 40, 12000), ctx.currentTime);
  env(o, 0.10, 0.003, 0.07); o.start(); o.stop(ctx.currentTime + 0.12);
  o.onended = () => o.disconnect();
}
export function sfxCoin() {
  if (!started) return;
  [1180, 1560].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f, ctx.currentTime + i * 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.06);
    g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + i * 0.06 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.06 + 0.3);
    o.connect(g); g.connect(sfxBus); o.start(ctx.currentTime + i * 0.06); o.stop(ctx.currentTime + i * 0.06 + 0.34);
  });
}
export function sfxBell() {
  if (!started) return;
  [523, 784, 1046].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
    const g = ctx.createGain();
    const t0 = ctx.currentTime + i * 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.10 / (i + 1), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    o.connect(g); g.connect(sfxBus); o.start(t0); o.stop(t0 + 2.4);
  });
}
export function sfxHorn() {
  if (!started) return;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(96, ctx.currentTime);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  o.connect(f);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.18);
  g.gain.setValueAtTime(0.16, ctx.currentTime + 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.6);
  f.connect(g); g.connect(sfxBus); o.start(); o.stop(ctx.currentTime + 1.7);
}
function gull() {
  if (!voice(0.4)) return;
  /* A sawtooth through a narrow bandpass is a sound effect and a dentist's
     drill in equal measure. A triangle carries the same rising cry with none
     of the upper harmonics, and a lowpass keeps the top off it. */
  const o = ctx.createOscillator(); o.type = 'triangle';
  const t = ctx.currentTime;
  const base = 780 + Math.random() * 380;
  o.frequency.setValueAtTime(base, t);
  o.frequency.linearRampToValueAtTime(base * 1.55, t + 0.09);
  o.frequency.linearRampToValueAtTime(base * 0.78, t + 0.26);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 0.7;
  o.connect(f);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.038, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  f.connect(g); g.connect(ambBus); o.start(); o.stop(t + 0.36);
  o.onended = () => { o.disconnect(); f.disconnect(); g.disconnect(); };
}
function creak() {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(70 + Math.random() * 40, t);
  o.frequency.linearRampToValueAtTime(48 + Math.random() * 26, t + 0.9);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 6;
  o.connect(f);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.035, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  f.connect(g); g.connect(ambBus); o.start(); o.stop(t + 1.2);
}

/* The generative score that used to live here — random D-dorian plucks with a
   "tense" coin-flip — is superseded by the adaptive controller in music.js,
   which plays an actual tune and knows where the player is. */
