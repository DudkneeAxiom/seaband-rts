/* ===========================================================
   Procedural audio — no asset files.
   Layered ambience (swell, wind, gulls, hull creak), one-shot
   effects, and a sparse generative score in D dorian.
   =========================================================== */

let ctx = null, master = null, ambBus = null, sfxBus = null, musBus = null;
let started = false, muted = false;
let waveLFO = null, windGain = null, waveGain = null;
let gullTimer = 0, creakTimer = 0, musicTimer = 0, harbourGain = null;
let noiseBuf = null, echoIn = null;

/* A broadside is one call per gun, and a fleet action is several broadsides
   at once. Past a couple of dozen simultaneous voices the mix is mud and the
   audio thread starts missing its deadline, which is what actually makes the
   harsh noise — so count them and drop the ones nobody would hear anyway. */
const MAX_VOICES = 24;
let voices = 0;
function voice(seconds) {
  if (voices >= MAX_VOICES) return false;
  voices++;
  setTimeout(() => { voices--; }, seconds * 1000);
  return true;
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
  master = ctx.createGain(); master.gain.value = 0.9;
  /* Everything is synthesised live and a broadside can stack a dozen voices in
     one frame, which clips the sum into a fizzing mess. One limiter across the
     end of the chain costs nothing and keeps the peaks civil. */
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.knee.value = 6;
  limiter.ratio.value = 12; limiter.attack.value = 0.004; limiter.release.value = 0.18;
  master.connect(limiter); limiter.connect(ctx.destination);
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
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.1);
  return muted;
}

/* ---------------- ambience driving ---------------- */
export function updateAudio(dt, st) {
  if (!started) return;
  const t = ctx.currentTime;
  if (waveGain) waveGain.gain.setTargetAtTime(0.34 + st.speedN * 0.30 + st.shallow * 0.18, t, 0.6);
  if (windGain) windGain.gain.setTargetAtTime(0.06 + st.speedN * 0.09, t, 0.8);
  if (harbourGain) harbourGain.gain.setTargetAtTime(st.nearPort * 0.30, t, 1.2);

  gullTimer -= dt;
  if (gullTimer <= 0) {
    gullTimer = 2.2 + Math.random() * 6;
    if (st.nearShore > 0.25 && Math.random() < st.nearShore) gull();
  }
  creakTimer -= dt;
  if (creakTimer <= 0) { creakTimer = 3 + Math.random() * 7; if (st.speedN > 0.15) creak(); }

  musicTimer -= dt;
  if (musicTimer <= 0) { musicTimer = musicStep(st); }
}

/* ---------------- one-shots ---------------- */
function env(node, gain, a, d, dest = sfxBus) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), ctx.currentTime + a);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + a + d);
  node.connect(g); g.connect(dest);
  return g;
}

export function sfxCannon(dist = 0) {
  if (!started || !voice(0.6)) return;
  const vol = Math.max(0.06, 0.85 - dist * 0.0016);
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
  if (!started || !voice(0.4)) return;
  const vol = Math.max(0.03, 0.4 - dist * 0.0011);
  const n = src(false);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
  f.frequency.setValueAtTime(1500, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
  n.connect(f); env(f, vol, 0.01, 0.34);
  n.start(); n.stop(ctx.currentTime + 0.4);
}
export function sfxWood(dist = 0) {
  if (!started || !voice(0.3)) return;
  const vol = Math.max(0.05, 0.55 - dist * 0.0013);
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(220, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.16);
  env(o, vol, 0.003, 0.18); o.start(); o.stop(ctx.currentTime + 0.24);
  const n = src(false); const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
  n.connect(f); env(f, vol * 0.6, 0.002, 0.14); n.start(); n.stop(ctx.currentTime + 0.2);
}
export function sfxClash() {
  if (!started) return;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); o.type = 'square';
    const base = 700 + Math.random() * 1400;
    o.frequency.setValueAtTime(base, ctx.currentTime + i * 0.03);
    o.frequency.exponentialRampToValueAtTime(base * 0.4, ctx.currentTime + i * 0.03 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.03);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.03 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.03 + 0.16);
    o.connect(g); g.connect(sfxBus); o.start(ctx.currentTime + i * 0.03); o.stop(ctx.currentTime + i * 0.03 + 0.2);
  }
  const n = src(false); const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.6;
  n.connect(f); env(f, 0.12, 0.01, 0.3); n.start(); n.stop(ctx.currentTime + 0.4);
}
export function sfxClick(freq = 620) {
  if (!started) return;
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  env(o, 0.10, 0.003, 0.07); o.start(); o.stop(ctx.currentTime + 0.12);
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

/* ---------------- generative score ---------------- */
const SCALE = [0, 2, 3, 5, 7, 9, 10];    // D dorian degrees
const ROOT = 146.83;                      // D3
let musIdx = 0;
function midiToF(semi) { return ROOT * Math.pow(2, semi / 12); }

function pad(semi, dur, vol) {
  const t = ctx.currentTime;
  for (const det of [-0.06, 0.06]) {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = midiToF(semi) * (1 + det * 0.02);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(musBus);
    o.start(); o.stop(t + dur + 0.1);
  }
}
function pluck(semi, vol) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.value = midiToF(semi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
  o.connect(g); g.connect(musBus); g.connect(echoIn);
  o.start(); o.stop(t + 2.0);
  o.onended = () => { o.disconnect(); g.disconnect(); };
}
function musicStep(st) {
  const tense = st.combat ? 1 : 0;
  musIdx++;
  if (musIdx % 4 === 1) {
    const chords = tense ? [[0, 3, 7], [-2, 3, 5]] : [[0, 3, 7], [5, 9, 12], [-2, 2, 5], [3, 7, 10]];
    const ch = chords[(musIdx / 4 | 0) % chords.length];
    for (const s of ch) pad(s - 12, tense ? 5 : 9, tense ? 0.055 : 0.04);
  }
  if (Math.random() < (tense ? 0.75 : 0.42)) {
    const deg = SCALE[(Math.random() * SCALE.length) | 0] + (Math.random() < 0.35 ? 12 : 0);
    pluck(deg, tense ? 0.07 : 0.05);
  }
  return tense ? 1.15 + Math.random() * 0.9 : 2.2 + Math.random() * 2.6;
}
