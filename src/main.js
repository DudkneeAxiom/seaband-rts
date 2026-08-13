/* ===========================================================
   Salt & Tally — boot, render loop, input wiring.
   =========================================================== */
import * as THREE from 'three';
import { Game } from './game.js';
import { SeaCamera } from './core/camera.js';
import { Input, screenToSea, pickShip, worldToScreen } from './core/input.js';
import { HUD } from './ui/hud.js';
import { initSheet, openMenu, isSheetOpen, closeSheet } from './ui/sheet.js';
import { $, el, clear, onTap, isModalOpen, hint, hideHint, setObjective } from './ui/dom.js';
import { openOrigin, isOriginOpen } from './ui/origin.js';
import { buildShip } from './ships/shipFactory.js';
import { initEncounter, openEncounter, closeEncounter, isEncounterOpen, showBattleResult } from './ui/encounter.js';
import { fleeChance, talkChance, buildEncounter, CONTACT_R } from './sim/encounter.js';
import { bindKeys, applyHeld } from './core/keys.js';
import {
  initAudio, resumeAudio, updateAudio, audioStats, audioSolo, musicState, sfxMusicEvent,
  getMix, setMixLevel, mixDefaults,
  sfxCannon, sfxWood, sfxSplash, sfxClash, sfxClick, sfxBell, sfxHorn, sfxCoin,
} from './core/audio.js';
import { clamp } from './core/util.js';
import { heightAt, depthAt, PORT_SHORE } from './world/terrain.js';

/* Boot reports itself to the loading card. Declared before anything else
   happens, because the very first thing that happens is asking for a 3D
   context, and that is the single likeliest thing to fail on a strange
   machine — a hang with nothing on screen names no step at all. */
const mark = s => { if (window.__boot) window.__boot(s); };

mark('opening a 3d canvas');
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
let keys = null;

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
    if (!game || isModalOpen() || isSheetOpen() || isOriginOpen() || isEncounterOpen() || game.gameOver) return;
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

/* ---------------- boarding overlay ----------------
   The most dramatic thing that happens in this game used to resolve entirely
   on its own while the player watched a bar move. It still resolves on the
   same numbers — but the composition of both decks is on screen, the dead are
   counted as they fall, and the captain has something to say about how it is
   fought. */
const brd = $('boarding');
let activeBoarding = null;

const CREW_ROWS = [
  ['marine', 'Marines', 'the best of them over the rail'],
  ['veteran', 'Old salts', 'steady, and hard to shift'],
  ['gunner', 'Gunners', 'wasted in a melee'],
  ['rigger', 'Riggers', 'first across, quick on the lines'],
  ['sailor', 'Sailors', 'the body of the crew'],
  ['deckhand', 'Hands', 'willing, and not much else'],
];

function crewBox(node, ship, lost) {
  clear(node);
  const head = el('div', 'bc-head', `${ship.name}<b>${ship.crewTotal}</b>`);
  node.appendChild(head);
  for (const [k, label] of CREW_ROWS) {
    const n = ship.crew[k] | 0;
    if (!n) continue;
    node.appendChild(el('div', 'bc-row', `<span>${label}</span><b>${n}</b>`));
  }
  const off = (ship.officers || []).filter(o => o);
  if (off.length) node.appendChild(el('div', 'bc-off', off.map(o => o.name).join(', ')));
  if (lost > 0) node.appendChild(el('div', 'bc-lost', `−${lost} this rush`));
}

const STANCES = [
  { id: 'press', label: 'PRESS THE ATTACK', sub: 'Ground fast, and pay for it' },
  { id: 'steady', label: 'STEADY', sub: 'Hold the rail and grind' },
  { id: 'marines', label: 'SEND THE MARINES', sub: 'The best fighters aboard, once' },
  { id: 'fallback', label: 'FALL BACK', sub: 'Cut the grapples and get off her' },
];

function renderStances(b) {
  const box = $('brd-acts');
  clear(box);
  // only a boarding you are actually in is yours to command
  if (b.a !== window.__game.player) return;
  for (const st of STANCES) {
    if (st.id === 'marines' && (b.a.crew.marine | 0) < 1) continue;
    const btn = el('button', 'brd-act' + (b.stance === st.id ? ' on' : ''), `${st.label}<small>${st.sub}</small>`);
    btn.dataset.stance = st.id;
    onTap(btn, () => { b.stance = st.id; renderStances(b); }, 260);
    box.appendChild(btn);
  }
}

function boardStart(b) {
  activeBoarding = b;
  brd.classList.remove('hidden');
  $('brd-us').textContent = b.a.name;
  $('brd-them').textContent = b.d.name;
  $('brd-log').textContent = b.a.isPlayer ? 'Grapples away — over the rail!' : 'They are coming aboard!';
  crewBox($('brd-crew-us'), b.a, 0);
  crewBox($('brd-crew-them'), b.d, 0);
  renderStances(b);
}
function boardUI(b) {
  if (b !== activeBoarding) return;
  const pct = (b.progress * 100).toFixed(0) + '%';
  $('brd-fill').style.width = pct;
  $('brd-cus').textContent = `${b.a.name}: ${b.a.crewTotal}`;
  $('brd-cthem').textContent = `${b.d.crewTotal} :${b.d.name}`;
  crewBox($('brd-crew-us'), b.a, b.lastKa);
  crewBox($('brd-crew-them'), b.d, b.lastKd);
  const lines = b.progress > 0.7 ? ['They are giving ground.', 'The quarterdeck is ours.', 'Cut them off from the hatches!']
    : b.progress < 0.3 ? ['We are being pushed back!', 'They fight like devils.', 'Hold the rail!']
      : ['Cutlasses on the waist.', 'Neither side will give.', 'Pistols and pike.'];
  $('brd-log').textContent = lines[(Math.random() * lines.length) | 0];
}
function boardEnd(b, winner) {
  if (b !== activeBoarding) return;
  activeBoarding = null;
  clear($('brd-acts'));
  $('brd-log').textContent = winner === 'attacker' ? 'Her colours are down.'
    : winner === 'broken' ? 'The grapples are cut — we are clear of her.' : 'Beaten back!';
  setTimeout(() => brd.classList.add('hidden'), 900);
}

/* ---------------- boot ---------------- */
function boot() {
  mark('building the world');
  game = new Game(scene, rig);
  game.onBoardStart = boardStart;
  game.onBoardUI = boardUI;
  game.onBoardEndUI = boardEnd;
  hud = new HUD(game);
  game.onRestart = restart;
  initSheet(game);
  initEncounter(game);

  /* The three layers hand off to each other here, and nowhere else. The Game
     decides *that* a state changed; these decide what the player sees. */
  game.onEncounter = enc => openEncounter(enc);
  game.onEncounterEnd = () => closeEncounter();
  game.onBattleStart = b => {
    closeEncounter();
    // tighten in on the action, so entering a battle is felt rather than read
    rig.setZoom(Math.min(rig.distance, isMobile ? 150 : 172));
    hint(`${b.kind.name}. Clear for action.`, 3200);
  };
  game.onBattleEnd = res => {
    game.paused = true;
    /* One decision at a time. Taking a prize on the last boarding of an action
       opens the prize dialog, and the reckoning would land on top of it — two
       cards stacked, the one underneath still waiting to be answered. The
       result waits its turn. */
    const show = () => showBattleResult(res, () => { game.paused = false; });
    if (!isModalOpen()) { show(); return; }
    const wait = setInterval(() => {
      if (isModalOpen()) return;
      clearInterval(wait);
      show();
    }, 220);
  };
  onTap($('btn-menu'), () => { if (isSheetOpen()) closeSheet(); else openMenu(); }, 500);
  mark('putting ships on the water');
  sizeRenderer();
  game.startAttract();
  // frame the free port from seaward and drift around it behind the title
  rig.focus.set(-20, 0, 555);
  rig.setZoom(205); rig.distance = 205;
  rig.azimuth = 1.55;
  window.__game = game;       // handy for QA
  /* A handle on the mixer for the audio suite. Sound is the one part of this
     that no screenshot and no assertion about game state can check, so the
     tests drive it directly and listen to what comes out. */
  window.__audio = {
    stats: audioStats,
    solo: audioSolo,
    music: musicState,
    musicEvent: sfxMusicEvent,
    getMix, setMix: setMixLevel, mixDefaults,
    update: updateAudio,
    cannon: sfxCannon, wood: sfxWood, splash: sfxSplash, clash: sfxClash,
    click: sfxClick, bell: sfxBell, horn: sfxHorn, coin: sfxCoin,
  };
  // the encounter rules, so the campaign suite can read the odds it is about
  // to gamble on rather than inferring them from outcomes
  window.__enc = { fleeChance, talkChance, buildEncounter, CONTACT_R };
  window.__renderer = renderer;
  window.__applyUp = sh => window.__game.applyUpgradesTo(sh);
  /* The factory itself, so a suite can put six hulls of the same class side by
     side and photograph them. Comparing a Covenant dhow with a League brig
     proves nothing about how the two powers build. */
  window.__buildShip = buildShip;
  window.__ui = { hint, hideHint, setObjective };

  // desk play: a keyboard is a better tiller than a tap, and a mouse should
  // not have to drag to turn a ship
  keys = bindKeys({
    game, rig, hud,
    isBusy: () => isModalOpen() || isSheetOpen() || isOriginOpen() || isEncounterOpen() || game.gameOver,
    isSheetOpen, closeSheet, openMenu,
  });
  window.__terrain = { heightAt, depthAt };   // for the QA harnesses
  window.__shore = PORT_SHORE;
  window.__hud = hud;
  window.__worldToScreen = worldToScreen;
  window.__keys = keys;
  window.__cam = rig;                         // the camera rig, for framing shots
}

/** New voyages go through the questionnaire first; a saved one resumes. */
function startGame(loadSave) {
  initAudio();
  resumeAudio();
  if (loadSave && game.load()) { enterWorld(); return; }
  $('title').classList.add('out');
  setTimeout(() => $('title').classList.add('hidden'), 700);
  openOrigin(origin => { game.newGame(true, origin); enterWorld(); });
}

/** Any road back to a new voyage goes through the questions. */
function restart() {
  openOrigin(origin => { game.newGame(true, origin); enterWorld(); });
}

function enterWorld() {
  hud.show();
  const t = $('title');
  t.classList.add('out');
  setTimeout(() => t.classList.add('hidden'), 700);
  rig.focus.set(game.player.x, 0, game.player.z);
  /* Look where she is pointed, which is at Ilo Vantu.
     This was a fixed -0.62 from when the opening heading was also fixed, so
     a new voyage opened staring off into empty water with the town somewhere
     over your shoulder. Squaring the view on her heading is the same thing
     the C key does, and she now starts bows-on to the first mark — so the
     first thing a new captain sees is the place the game is about to tell
     her to go. */
  rig.azimuth = Math.PI + game.player.yaw;
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
    if (keys) applyHeld(keys.held, { game, rig, isBusy: () => isModalOpen() || isSheetOpen() || isOriginOpen() || isEncounterOpen() || game.gameOver }, dt);
    /* Reading a screen is not sailing: the sea waits while a panel is open and
       picks up again the moment it closes. Derived from what is actually on
       screen rather than a flag set beside it, so a panel that closes by some
       path nobody thought of cannot leave the world frozen — and because the
       player's own choice of speed is never touched, closing the sheet resumes
       at 2x if that is where they left it, or stays paused if they paused it.
       The questionnaire is deliberately not in here: no voyage has begun, and
       the traffic drifting past behind it is the attract screen. */
    const inMenu = isModalOpen() || isSheetOpen() || isEncounterOpen();
    const steps = (game.paused || inMenu) ? 0 : (game.player ? game.speed : 1);
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

mark('starting the game');
boot();
mark('ready');
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
