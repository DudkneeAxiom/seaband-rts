/* ===========================================================
   Salt & Tally — boot, render loop, input wiring.
   =========================================================== */
import * as THREE from 'three';
import { Game } from './game.js';
import { SeaCamera } from './core/camera.js';
import { Input, screenToSea, pickShip } from './core/input.js';
import { HUD } from './ui/hud.js';
import { initSheet, openMenu, isSheetOpen, closeSheet } from './ui/sheet.js';
import { $, onTap, isModalOpen, hint, hideHint, setObjective } from './ui/dom.js';
import { initAudio, resumeAudio, updateAudio } from './core/audio.js';
import { clamp } from './core/util.js';

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance', alpha: false,
});
renderer.setClearColor(0xafcdd4, 1);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || 'ontouchstart' in window;
const MAXDPR = isMobile ? 1.75 : 2;

const scene = new THREE.Scene();
const rig = new SeaCamera(window.innerWidth / Math.max(1, window.innerHeight));
let game = null;
let hud = null;

function sizeRenderer() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(MAXDPR, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  rig.resize(w / Math.max(1, h));
  if (game) game.fx.setScale(h * 0.95);
  // wider default framing on short landscape screens
  if (h < 480) rig.minD = 130;
}
window.addEventListener('resize', sizeRenderer);
window.addEventListener('orientationchange', () => setTimeout(sizeRenderer, 250));
sizeRenderer();

/* ---------------- input ---------------- */
let rect = canvas.getBoundingClientRect();
window.addEventListener('resize', () => { rect = canvas.getBoundingClientRect(); });

new Input(canvas, {
  onTap: (x, y) => {
    if (!game || isModalOpen() || isSheetOpen() || game.gameOver) return;
    resumeAudio();
    rect = canvas.getBoundingClientRect();
    const s = pickShip(rig.cam, game.ships, x, y, rect, isMobile ? 64 : 48);
    if (s && s !== game.player && !game.fleet.includes(s) && s.alive) {
      game.selectTarget(s);
      hideHint();
      return;
    }
    const w = screenToSea(rig.cam, x, y, rect);
    if (w) { game.commandMove(w.x, w.z); hideHint(); }
  },
  onDrag: (dx) => { rig.orbit(dx); },
  onPinch: (f) => { rig.zoom(f); },
});

/* ---------------- boarding overlay ---------------- */
const brd = $('boarding');
let activeBoarding = null;
function boardStart(b) {
  activeBoarding = b;
  brd.classList.remove('hidden');
  $('brd-us').textContent = b.a.isPlayer ? b.a.name : b.a.name;
  $('brd-them').textContent = b.d.name;
  $('brd-log').textContent = b.a.isPlayer ? 'Grapples away — over the rail!' : 'They are coming aboard!';
}
function boardUI(b) {
  if (b !== activeBoarding) return;
  const pct = (b.progress * 100).toFixed(0) + '%';
  $('brd-fill').style.width = pct;
  $('brd-cus').textContent = `${b.a.name}: ${b.a.crewTotal}`;
  $('brd-cthem').textContent = `${b.d.crewTotal} :${b.d.name}`;
  const lines = b.progress > 0.7 ? ['They are giving ground.', 'The quarterdeck is ours.', 'Cut them off from the hatches!']
    : b.progress < 0.3 ? ['We are being pushed back!', 'They fight like devils.', 'Hold the rail!']
      : ['Cutlasses on the waist.', 'Neither side will give.', 'Pistols and pike.'];
  $('brd-log').textContent = lines[(Math.random() * lines.length) | 0];
}
function boardEnd(b, winner) {
  if (b !== activeBoarding) return;
  activeBoarding = null;
  $('brd-log').textContent = winner === 'attacker' ? 'Her colours are down.' : 'Beaten back!';
  setTimeout(() => brd.classList.add('hidden'), 900);
}

/* ---------------- boot ---------------- */
function boot() {
  game = new Game(scene, rig);
  game.onBoardStart = boardStart;
  game.onBoardUI = boardUI;
  game.onBoardEndUI = boardEnd;
  hud = new HUD(game);
  initSheet(game);
  onTap($('btn-menu'), () => { if (isSheetOpen()) closeSheet(); else openMenu(); }, 500);
  sizeRenderer();
  game.startAttract();
  // frame the free port from seaward and drift around it behind the title
  rig.focus.set(-20, 0, 555);
  rig.setZoom(205); rig.distance = 205;
  rig.azimuth = 1.55;
  window.__game = game;       // handy for QA
  window.__renderer = renderer;
  window.__ui = { hint, hideHint, setObjective };
}

function startGame(loadSave) {
  initAudio();
  resumeAudio();
  if (!loadSave || !game.load()) game.newGame(!loadSave);
  hud.show();
  const t = $('title');
  t.classList.add('out');
  setTimeout(() => t.classList.add('hidden'), 700);
  rig.focus.set(game.player.x, 0, game.player.z);
  rig.azimuth = -0.62;
  rig.setZoom(isMobile ? 165 : 190);
}

/* ---------------- loop ---------------- */
let last = performance.now();
let acc = 0, frames = 0, fpsCheck = 0, autoDropped = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;          // tab-switch guard
  if (dt <= 0) dt = 1 / 60;

  if (game) {
    // 2× runs the simulation twice at the normal step rather than one
    // double-length step, so physics and collision behave identically
    const steps = game.paused ? 0 : (game.player ? game.speed : 1);
    for (let i = 0; i < steps; i++) game.update(dt);
    if (steps === 0) game.update(0);      // keep UI-facing state fresh while paused
    const p = game.player;
    if (p) {
      const t = game.target;
      const interest = t && t.alive && !t.captured &&
        Math.hypot(t.x - p.x, t.z - p.z) < 420 ? { x: t.x, z: t.z } : null;
      rig.update(dt, { x: p.x, z: p.z, yaw: p.yaw, speed: p.speed }, interest, game.combatHeat > 0 ? 1 : 0);
    } else {
      // attract mode: a slow pass across the roads of Ilo Vantu
      rig.azimuth += dt * 0.028;
      rig.update(dt, { x: -20, z: 555, yaw: rig.azimuth, speed: 0 }, null, 0);
    }
    if (hud) hud.update(dt);
    if (activeBoarding) boardUI(activeBoarding);
  }
  renderer.render(scene, rig.cam);

  // --- automatic quality drop if the device is struggling ---
  frames++; acc += dt;
  if (acc > 3) {
    const fps = frames / acc;
    acc = 0; frames = 0;
    fpsCheck++;
    if (!autoDropped && fpsCheck > 1 && fps < 34 && game) {
      autoDropped = true;
      game.setQuality(0);
      renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
    }
  }
}

boot();
requestAnimationFrame(frame);

/* ---------------- title screen ---------------- */
if (Game.hasSave()) $('btn-continue').classList.remove('hidden');
onTap($('btn-new'), () => startGame(false), 760);
onTap($('btn-continue'), () => startGame(true), 700);
setTimeout(() => $('loading').classList.add('out'), 120);
setTimeout(() => $('loading').classList.add('hidden'), 700);

/* keep the page from ever scrolling or zooming under a fat thumb */
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); resumeAudio(); } });
void clamp; void updateAudio;
