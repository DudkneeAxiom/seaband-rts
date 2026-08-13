/* ===========================================================
   Salt & Tally — game state, world simulation and rules.
   =========================================================== */
import * as THREE from 'three';
import {
  PORTS, POIS, ISLANDS, HULLS, FACTIONS, NAMES, GOODS, RANKS, WORLD_SIZE, EDGE_NODES,
} from './data/gamedata.js';
import { clamp, clamp01, lerp, dist, angDiff, normAng, makeRNG, rngInt, TAU, fmtCoin } from './core/util.js';
import { findRoute } from './core/route.js';
import { bakeHeights, makeDepthTexture, buildTerrain, depthAt, PORT_SHORE } from './world/terrain.js';
import { createWater, updateWater, waveHeight, setWaterQuality } from './world/water.js';
import { createSky, updateSky, SKY } from './world/sky.js';
import { WakeField } from './fx/wake.js';
import { FX } from './fx/particles.js';
import { Ship, emptyCrew, crewCount } from './ships/ship.js';
import { updateAI, isHostile, strength, portGuarding } from './ships/ai.js';
import {
  Projectiles, fireBroadside, bestSide, canBoard, Boarding, boardOdds, GUN_RANGE, BOARD_RANGE,
} from './combat/combat.js';
import { Market, repairCost, SHOT_PRICE } from './sim/economy.js';
import { makeOfficer, rollTavernOfficers, addOfficerXP, officerLabel } from './sim/officers.js';
import {
  CHAPTERS, NEMESES, ENDINGS, AMBITIONS, sumOrigin, rollOrigin, rollCaptainName, findOption,
} from './data/origins.js';
import { toast, hint, hideHint, modal, isModalOpen, setObjective } from './ui/dom.js';
import {
  CONTACT_R, PURSUIT_R, buildEncounter, enemyBand, resolveFlee, talkChance, bribeCost,
  duesFor, chartFor,
} from './sim/encounter.js';
import { Battle } from './sim/battle.js';
import { openPort, closeSheet, isSheetOpen } from './ui/sheet.js';
import {
  sfxCannon, sfxWood, sfxSplash, sfxClash, sfxBell, sfxHorn, sfxCoin, sfxClick, updateAudio,
  sfxMusicEvent,
} from './core/audio.js';

/** A stream of its own for one named thing — see the note on seeds in CLAUDE.md. */
function seedFrom(name) {
  let h = 0x9e3779b9;
  for (let i = 0; i < (name || '').length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const SAVE_KEY = 'salt-and-tally-v1';
const TRAFFIC = { merchant: 4, fisher: 3, pirate: 3, patrol: 2, sable: 2, veyra: 2 };

/* The two regional powers keep to their own water. A Sable channel patrol is
   guarding the Iron Sound, not looking for you, and a Veyra navigator is
   crossing the Glass Reach because that is where the passages are — so they
   spawn in their region rather than over the player's shoulder. Sailing far
   enough to meet them is the point of them existing. */
const HOMES = {
  sable: { x: -1450, z: -1280, r: 620 },
  veyra: { x: 1440, z: 1300, r: 640 },
};

export class Game {
  constructor(scene, cameraRig) {
    this.scene = scene;
    this.rig = cameraRig;
    this.buildTag = 'build 1.0';
    this.quality = 1;

    /* Boot is one long synchronous run — the height field, the shaders, every
       island — and if it stops partway the loading card is the only witness a
       tablet has. Each step names itself on the way past. */
    const mark = s => { if (typeof window !== 'undefined' && window.__boot) window.__boot(s); };

    mark('sounding the bottom');
    bakeHeights();
    mark('raising the sky');
    createSky(scene);
    mark('making the islands');
    buildTerrain(scene);          // harbour works stamp their footings into the field…
    mark('drawing the seabed');
    this.depthTex = makeDepthTexture();   // …so the seabed is read after they land
    mark('setting the sea');
    createWater(scene, this.depthTex, SKY);
    mark('rigging the world');

    this.wakes = new WakeField(scene);
    this.fx = new FX(scene, 1);
    this.ships = [];
    this.fleet = [];
    this.projectiles = new Projectiles(this.fx, this.ships);
    this.boardings = [];
    this.markers = new Markers(scene);

    this.time = 0;
    this.windAng = 2.1;
    this.windTargetAng = 2.1;
    this.windTimer = 20;
    this.limit = WORLD_SIZE * 0.46;

    this.coin = 0; this.prestige = 0; this.infamy = 0;
    this.standing = { freehold: 0, admiralty: 0, compact: 0, sable: 0, veyra: 0 };
    this.crewXP = 0;
    this.stats = { sunk: 0, captured: 0, broadsides: 0, distance: 0, crewLost: 0 };
    this.officers = [];
    this.prizes = [];
    this.quests = [];
    this.quarryReport = null;
    this.discovered = new Set();
    this.tavernSeed = 1;
    this.tavernCache = {};
    this.contractEpoch = {};       // bumped per port so the board turns over
    this.market = new Market();
    this.fleetOrder = 'follow';
    /* Which layer the game is on. The ocean is the campaign; contact between
       hostile fleets makes an encounter; an encounter can make a battle. Only
       one of these owns the world at a time, and everything that asks "can I
       fire", "can I dock", "what do the buttons say" asks this first. */
    this.mode = 'campaign';          // 'campaign' | 'encounter' | 'battle'
    this.encounter = null;
    this.battle = null;
    this.pursuit = null;             // who is coming for you, for the HUD
    this.chasing = null;             // who you are running down, if anyone
    this._chaseAim = null; this._chaseT = 0;
    this.encounterCooling = 0;       // grace after one resolves
    this.target = null;
    this.dockablePort = null;
    this.boardable = false;
    this.boardOdds = 0;
    this.fireSide = null;
    this.inPort = null;
    this.paused = false;
    this.gameOver = false;
    this.hintState = {};
    this.spawnTimer = 3;
    this.saveTimer = 0;
    this.combatHeat = 0;
    this.speed = 1;              // 0 paused, 1 normal, 2 or 4 fast-forward
    this.PORTS = PORTS;
    this.HULLS = HULLS;          // for the QA harnesses, like PORTS
    this.CHAPTERS = CHAPTERS;    // likewise

    // ---- who you are, and how far into your own story ----
    this.origin = null;
    this.chapter = 0;
    this.nemesisDown = false;
    this.santDown = false;
    this.storyOver = false;

    /** ship id -> when we last said she was dry, so it is news and not nagging */
    this.dryWarned = new Map();
    this.ctx = {
      // guns are live in a battle instance and nowhere else
      combatLive: false,
      fx: this.fx,
      projectiles: this.projectiles,
      onHit: (p, s, res) => this.onHit(p, s, res),
      onSplash: (x, z) => this.onSplash(x, z),
      onBroadside: (sh, side, n) => this.onBroadside(sh, side, n),
      onGunFired: () => { },
      startBoarding: (a, b) => this.startBoarding(a, b),
      onArrive: () => { },
      onOutOfShot: (sh) => {
        if (sh.isPlayer) { toast('Shot lockers are empty.', 'bad'); return; }
        if (!this.fleet.includes(sh)) return;
        /* A consort running dry used to say nothing at all, so a fleet quietly
           stopped being a fleet and the captain never learned why. Once per
           ship rather than once per gun per second. */
        const last = this.dryWarned.get(sh.id) || -99;
        if (this.time - last < 25) return;
        this.dryWarned.set(sh.id, this.time);
        toast(`${sh.name} has fired her last shot.`, 'bad', 2300);
      },
    };
    this.world = {
      ships: this.ships, windAng: this.windAng, time: 0, limit: this.limit,
      market: this.market, player: null, playerTarget: null,
      onGround: (s, o) => this.onGround(s, o),
      onEdge: () => this.onEdge(),
    };
  }

  /* =========================================================
     lifecycle
     ========================================================= */
  newGame(clearSave = false, origin = null) {
    if (clearSave) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { void e; } }
    for (const s of this.ships.slice()) this.removeShip(s, true);
    this.ships.length = 0; this.fleet.length = 0;
    this.setOrigin(origin);
    this.coin = 240; this.prestige = 0; this.infamy = 0;
    this.standing = { freehold: 6, admiralty: 0, compact: 0, sable: 0, veyra: 0 };
    this.crewXP = 0;
    this.stats = { sunk: 0, captured: 0, broadsides: 0, distance: 0, crewLost: 0 };
    this.officers = []; this.prizes = []; this.quests = [];
    this.discovered = new Set();
    this.tavernCache = {};
    this.contractEpoch = {};
    this.market = new Market();
    this.world.market = this.market;
    this.gameOver = false;
    this.paused = false;
    this.hintState = {};
    this.fleetOrder = 'follow';
    /* Which layer the game is on. The ocean is the campaign; contact between
       hostile fleets makes an encounter; an encounter can make a battle. Only
       one of these owns the world at a time, and everything that asks "can I
       fire", "can I dock", "what do the buttons say" asks this first. */
    this.mode = 'campaign';          // 'campaign' | 'encounter' | 'battle'
    this.encounter = null;
    this.battle = null;
    this.pursuit = null;             // who is coming for you, for the HUD
    this.chasing = null;             // who you are running down, if anyone
    this._chaseAim = null; this._chaseT = 0;
    this.encounterCooling = 0;       // grace after one resolves
    this.target = null;
    this.chapter = 0;
    this._chEarned = false; this._storyCool = 0;
    this.nemesisDown = false; this.santDown = false; this.storyOver = false;

    const fx = this.originFx;
    const crew = emptyCrew();
    crew.deckhand = 6; crew.sailor = 5; crew.gunner = 1; crew.marine = 1;
    for (const k in fx.crew) crew[k] = (crew[k] || 0) + fx.crew[k];

    /* The opening leg, laid out rather than left to chance.

       This used to start the ship at a fixed yaw of 2.5 with the wind fixed at
       2.1 — which pointed her 170° away from Ilo Vantu, the one place the game
       then told her to go, and put the bearing to it at 0.43 on the old wind
       curve. Every single voyage opened facing the wrong way with a dead beat
       to the first harbour, which is a poor first impression and reads as a
       wind that has it in for you.

       So: she starts bows-on to the first mark, and the wind is laid at a
       broad reach off that bearing — seeded from the captain's own name, so
       two captains get two different mornings and the same captain always
       gets hers. */
    const home = PORTS[0];
    const openBrg = Math.atan2(home.x - -110, home.z - 236);
    const wr = makeRNG(seedFrom(this.origin.captain));
    this.windAng = openBrg + (wr() < 0.5 ? -1 : 1) * (0.85 + wr() * 0.35);
    this.windTargetAng = this.windAng;
    this.windTimer = 26 + wr() * 40;
    this.world.windAng = this.windAng;   // before the first update, not after it

    const p = new Ship({
      classId: 'cutter', faction: 'player', name: NAMES.ship_player[0], isPlayer: true,
      x: -110, z: 236, yaw: openBrg, crew, role: 'player',
      colors: { hull: 0x7d5230, trim: 0xe6b25e, sail: 0xefe3c8, flag: 0xc94f2f },
    });
    p.provisions = 42 + fx.provisions; p.shot = 16 + fx.shot;
    p.hull = p.hullMax * Math.min(1, 0.78 + fx.hull); p.sails = p.sailMax * 0.9;
    this.addShip(p);
    this.fleet.push(p);
    this.player = p; this.world.player = p;

    this.coin += fx.coin;
    for (const k in fx.standing) this.standing[k] = (this.standing[k] || 0) + fx.standing[k];
    this.equipCaptain();

    this.seedTraffic();
    this.setupIntro();
    this.save();
  }

  /* ---------- who you are ----------
     The answers given before the first sail. Everything derived from them
     is recomputed from the answers themselves, never persisted, so a save
     can never disagree with the questionnaire. */
  setOrigin(origin) {
    const picks = (origin && origin.picks) || rollOrigin();
    this.origin = {
      picks,
      captain: (origin && origin.captain) || rollCaptainName(),
      nemesis: 'vell',
      ambition: 'clear',
    };
    this.originFx = sumOrigin(picks);
    this.origin.nemesis = this.originFx.nemesis || 'vell';
    this.origin.ambition = this.originFx.ambition || 'clear';
  }
  /** Push the captain's own competence onto the flagship and the harbour books. */
  equipCaptain() {
    const fx = this.originFx;
    if (this.player) {
      this.player.capt = fx.capt;
      this.player.shoalwise = this.origin.picks.youth === 'net';
    }
    this.market.haggle = fx.capt.trade || 0;
  }
  /** Contract money and salvage, after what you told them you wanted. */
  get coinMult() { return this.origin && this.origin.ambition === 'clear' ? 1.2 : 1; }
  prestigeMult(fromPirate = false) {
    const a = this.origin && this.origin.ambition;
    if (a === 'settle' && fromPirate) return 1.5;
    if (a === 'known') return 1.25;
    return 1;
  }
  gainCoin(n) { const v = Math.round(n * this.coinMult); this.coin += v; return v; }
  gainPrestige(n, fromPirate = false) {
    const v = Math.round(n * this.prestigeMult(fromPirate) * 10) / 10;
    this.prestige += v; return v;
  }
  get captainName() { return (this.origin && this.origin.captain) || 'the captain'; }
  /** Ask the questions again. Falls back to a rolled captain if nothing wired it. */
  restart() { if (this.onRestart) this.onRestart(); else this.newGame(true); }
  get nemesisDef() { return NEMESES[this.origin ? this.origin.nemesis : 'vell'] || NEMESES.vell; }
  /** A spot inside a harbour with enough water under it to float a hull. */
  harbourBerth(port) {
    const town = PORT_SHORE[port.id];
    // start on the seaward side of the town and work outward until she swims
    const away = town
      ? Math.atan2(port.z - town.z, port.x - town.x)
      : port.ang;
    for (const spread of [0.9, -0.9, 0, 1.8, -1.8]) {
      for (const r of [0.55, 0.75, 0.95]) {
        const a = away + spread;
        const x = port.x + Math.cos(a) * port.dockR * r;
        const z = port.z + Math.sin(a) * port.dockR * r;
        if (depthAt(x, z) > 9) return { x, z };
      }
    }
    return { x: port.x, z: port.z };
  }

  /** Ship names the story owns. All three antagonists are held back, not just
      yours — meeting a random "Third Name" would muddy the one that matters. */
  reservedNames() {
    return [...Object.values(NEMESES).map(n => n.ship), 'Long Answer'];
  }

  /** Populate the sea and let it run behind the title screen. */
  startAttract() {
    this.seedTraffic();
    this.attract = true;
  }

  setupIntro() {
    this.refreshObjective();
    const opening = findOption('wrong', this.origin.picks.wrong);
    const amb = AMBITIONS[this.origin.ambition];
    setTimeout(() => {
      modal({
        title: this.captainName,
        text: `${opening ? opening.text + '<br><br>' : ''}`
          + `What is left is a tired cutter called the <em>Marlin’s Debt</em>, `
          + `${crewCount(this.player.crew)} hands who have not been paid yet, and `
          + `<em>${amb ? amb.line : 'a reason to go'}</em>.<br><br>`
          + 'Ilo Vantu is under your lee. Start there.',
        actions: [{ label: 'MAKE SAIL', cls: 'gold', fn: () => { this.paused = false; } }],
      });
      this.paused = true;
      setTimeout(() => hint('Tap the water to set your course.', 6500), 400);
    }, 700);
  }

  /* ---------- persistence ---------- */
  /** Writes the voyage. Returns false when it refused, so a caller can tell. */
  save() {
    // belt and braces: the one state where the ship list is not the world
    if (this.mode === 'battle') return false;
    if (this.gameOver) return false;
    try {
      const data = {
        v: 1,
        coin: this.coin, prestige: this.prestige, infamy: this.infamy,
        standing: this.standing, crewXP: this.crewXP, stats: this.stats,
        windAng: this.windAng,
        officers: this.officers.map(o => ({ ...o, ship: o.ship ? o.ship.id : null })),
        fleet: this.fleet.map(s => ({ ...s.serialize(), upgrades: s.upgrades || [], builtBy: s.builtBy })),
        prizes: this.prizes,
        quests: this.quests.map(q => ({
          id: q.id, active: q.active, done: q.done, progress: q.progress, portId: q.portId,
          // a contract's terms are fixed when it is written, not re-derived from
          // a market that has moved since
          good: q.good, amount: q.amount, toPort: q.toPort, fromPort: q.fromPort,
          reward: q.reward, advance: q.advance, loaded: q.loaded,
        })),
        contractEpoch: this.contractEpoch,
        discovered: [...this.discovered],
        market: this.market.save(),
        hintState: this.hintState,
        fleetOrder: this.fleetOrder,
        // only the answers are stored; everything they imply is recomputed
        origin: { picks: this.origin.picks, captain: this.origin.captain },
        chapter: this.chapter,
        nemesisDown: this.nemesisDown,
        santDown: this.santDown,
        storyOver: this.storyOver,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) { void e; return false; }
  }
  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { void e; return false; }
  }
  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { void e; return false; }
    if (!data || data.v !== 1 || !data.fleet || !data.fleet.length) return false;
    try {
      for (const s of this.ships.slice()) this.removeShip(s, true);
      this.ships.length = 0; this.fleet.length = 0;
      // a voyage begun before the questionnaire existed gets a captain rolled
      this.setOrigin(data.origin || null);
      this.chapter = data.chapter || 0;
      this.nemesisDown = !!data.nemesisDown;
      this.santDown = !!data.santDown;
      this.storyOver = !!data.storyOver;
      this.coin = data.coin ?? 200;
      this.prestige = data.prestige ?? 0; this.infamy = data.infamy ?? 0;
      /* A voyage begun before these factions existed has no standing with
         them. Fill the gaps rather than replacing the object, so an old save
         opens on a world that simply has two more powers in it than it had. */
      this.standing = { freehold: 0, admiralty: 0, compact: 0, sable: 0, veyra: 0, ...(data.standing || {}) };
      this.crewXP = data.crewXP || 0;
      this.stats = Object.assign({ sunk: 0, captured: 0, broadsides: 0, distance: 0, crewLost: 0 }, data.stats);
      this.windAng = data.windAng ?? 2.1; this.windTargetAng = this.windAng;
      this._chEarned = false; this._storyCool = 0;   // re-earned from state, not remembered
      this.discovered = new Set(data.discovered || []);
      this.market = new Market(data.market);
      this.world.market = this.market;
      this.hintState = data.hintState || {};
      this.fleetOrder = data.fleetOrder || 'follow';
      this.prizes = data.prizes || [];
      this.officers = (data.officers || []).map(o => ({ ...o, ship: null, trait: o.trait || { name: 'Steady', tip: '' } }));
      this.contractEpoch = data.contractEpoch || {};
      this.quests = (data.quests || []).map(q => {
        const nq = makeQuest(q.id, this.market);
        if (!nq) return null;
        nq.active = q.active; nq.done = q.done; nq.progress = q.progress || 0; nq.portId = q.portId;
        if (nq.kind === 'cargo') {
          // restore the terms as written, so a delivery cannot change price
          for (const k of ['good', 'amount', 'toPort', 'fromPort', 'reward', 'advance']) {
            if (q[k] !== undefined) nq[k] = q[k];
          }
          nq.loaded = q.loaded || 0;
          const to = PORTS.find(x => x.id === nq.toPort);
          if (to) nq.title = `${GOODS[nq.good].name} for ${to.name}`;
        }
        return nq;
      }).filter(Boolean);

      for (const sd of data.fleet) {
        const sh = new Ship({
          classId: sd.classId, faction: sd.isPlayer ? 'player' : 'player', name: sd.name,
          isPlayer: sd.isPlayer, x: sd.x, z: sd.z, yaw: sd.yaw, crew: sd.crew, cargo: sd.cargo,
          role: sd.isPlayer ? 'player' : 'consort',
          colors: { hull: FACTIONS.player.hull, trim: FACTIONS.player.trim, sail: FACTIONS.player.sail, flag: FACTIONS.player.flag },
        });
        sh.hull = sd.hull; sh.sails = sd.sails; sh.shot = sd.shot; sh.provisions = sd.provisions;
        if (sd.builtBy) sh.builtBy = sd.builtBy;
        sh.scars = sd.scars | 0; sh.prizes = sd.prizes | 0;
        sh.gunsPort = sd.gunsPort; sh.gunsStb = sd.gunsStb;
        sh.upgrades = sd.upgrades || [];
        applyUpgrades(sh);
        // her refit history is saved; her hull is rebuilt from it
        if ((sh.upgrades || []).length || sh.scars || sh.prizes) sh.refitMesh(this.scene);
        this.addShip(sh);
        this.fleet.push(sh);
        if (sd.isPlayer) { this.player = sh; this.world.player = sh; }
        if (sd.captain) {
          const o = this.officers.find(x => x.id === sd.captain);
          if (o) { o.ship = sh; sh.captain = o; }
        }
        for (const oid of sd.officers || []) {
          const o = this.officers.find(x => x.id === oid);
          if (o && !o.ship) sh.officers.push(o);
        }
      }
      if (!this.player) return false;
      let slot = 1;
      for (const s of this.fleet) if (!s.isPlayer) s.formSlot = slot++;
      this.gameOver = false;
      this.equipCaptain();
      this.seedTraffic();
      this.mode = 'campaign';
      this.encounter = null; this.battle = null; this.pursuit = null; this.chasing = null;
      this.ctx.combatLive = false;
      setObjective(null);
      this.refreshObjective();
      return true;
    } catch (e) {
      console.warn('save load failed', e);
      return false;
    }
  }

  /* =========================================================
     ships
     ========================================================= */
  addShip(s) {
    this.ships.push(s);
    this.scene.add(s.mesh);
    this.wakes.register(s);
    return s;
  }
  removeShip(s, immediate = false) {
    const i = this.ships.indexOf(s);
    if (i >= 0) this.ships.splice(i, 1);
    const j = this.fleet.indexOf(s);
    if (j >= 0) this.fleet.splice(j, 1);
    this.wakes.release(s);
    s.dispose(this.scene);
    if (this.target === s) this.target = null;
    void immediate;
  }

  seedTraffic() {
    const rng = makeRNG(7 + this.ships.length);
    for (const kind in TRAFFIC) {
      for (let i = 0; i < TRAFFIC[kind]; i++) this.spawnNPC(kind, rng, true);
    }
  }

  spawnNPC(kind, rng = Math.random, initial = false) {
    const r = typeof rng === 'function' ? rng : Math.random;
    const p = this.player;
    let x, z, guard = 0;
    const home = HOMES[kind];
    if (home) {
      for (let i = 0; i < 40; i++) {
        const a = r() * TAU, d = r() * home.r;
        x = home.x + Math.cos(a) * d; z = home.z + Math.sin(a) * d;
        if (depthAt(x, z) > 22 && Math.hypot(x, z) < this.limit * 0.95) break;
      }
      if (depthAt(x, z) < 18) return null;
    } else do {
      if (initial || !p) {
        const a = r() * TAU, d = 260 + r() * (this.limit * 0.85);
        x = Math.cos(a) * d; z = Math.sin(a) * d;
      } else {
        const a = r() * TAU, d = 900 + r() * 500;
        x = p.x + Math.cos(a) * d; z = p.z + Math.sin(a) * d;
      }
      guard++;
    } while (guard < 30 && (depthAt(x, z) < 20 || Math.hypot(x, z) > this.limit * 0.95));
    if (depthAt(x, z) < 16) return null;

    let classId, faction, role, names;
    if (kind === 'merchant') {
      faction = r() > 0.45 ? 'compact' : 'freehold';
      classId = faction === 'compact' ? (r() > 0.4 ? 'fluyt' : 'dhow') : 'dhow';
      role = 'merchant';
      names = faction === 'compact' ? NAMES.ship_compact : NAMES.ship_freehold;
    } else if (kind === 'fisher') {
      faction = 'freehold'; classId = 'cutter'; role = 'fisher'; names = NAMES.ship_freehold;
    } else if (kind === 'pirate') {
      // the Tally send bigger hulls after captains who have earned the attention
      // a captain who set out to be talked about gets bigger visitors sooner
      const notoriety = this.stats.captured + this.stats.sunk + (this.fleet.length - 1) * 2
        + (this.origin && this.origin.ambition === 'known' ? 2 : 0);
      const heavy = clamp01((notoriety - 1) / 5) * 0.7;
      faction = 'pirate'; classId = r() < heavy ? 'lugger' : 'cutter'; role = 'pirate'; names = NAMES.ship_pirate;
    } else if (kind === 'sable') {
      // heavy, and they do not travel far from what they are guarding
      faction = 'sable'; classId = r() > 0.55 ? 'brig' : 'lugger';
      role = 'sable'; names = NAMES.ship_sable;
    } else if (kind === 'veyra') {
      faction = 'veyra'; classId = r() > 0.5 ? 'dhow' : 'cutter';
      role = 'veyra'; names = NAMES.ship_veyra;
    } else {
      faction = 'admiralty'; classId = r() > 0.6 ? 'frigate' : 'brig'; role = 'patrol'; names = NAMES.ship_admiralty;
    }
    const used = new Set([...this.ships.map(s => s.name), ...this.reservedNames()]);
    let name = names[(r() * names.length) | 0];
    let g2 = 0;
    while (used.has(name) && g2++ < 12) name = names[(r() * names.length) | 0];
    if (used.has(name)) name += ' II';

    const s = new Ship({ classId, faction, name, role, x, z, yaw: r() * TAU });
    // the first Tally captains a new captain meets are thin-crewed opportunists
    if (kind === 'pirate') {
      const green = clamp01(1 - (this.stats.captured + this.stats.sunk) / 3);
      if (green > 0) {
        for (const k of ['gunner', 'marine', 'veteran']) s.crew[k] = Math.round(s.crew[k] * (1 - green * 0.55));
        s.crew.sailor = Math.round(s.crew.sailor * (1 - green * 0.25));
      }
    }
    s.brain.t = r() * 5;
    this.addShip(s);
    return s;
  }

  /* =========================================================
     main update
     ========================================================= */
  update(dt) {
    if (this.paused) dt = 0;
    this.time += dt;
    this.world.time = this.time;

    // ---- wind drifts ----
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = 26 + Math.random() * 40;
      this.windTargetAng += (Math.random() - 0.5) * 1.5;
    }
    this.windAng += angDiff(this.windAng, this.windTargetAng) * Math.min(1, dt * 0.06);
    this.world.windAng = this.windAng;
    this.world.playerTarget = this.target;
    this.world.combatLive = this.ctx.combatLive;
    this.world.flagDocked = !!this.inPort;
    if (this._storyCool > 0) this._storyCool -= dt;   // the breath between chapter pages

    const p = this.player;

    // ---- ships ----
    for (const s of this.ships) {
      if (!s.isPlayer && s.alive && !s.captured) updateAI(s, dt, this.world, this.ctx);
      s.update(dt, this.world);
      // she went down or struck to somebody else while you were doing the work
      if ((!s.alive || s.captured) && !s.rewarded && s.dmgMine > 0) this.settleSharedKill(s);
      if (s.alive && s.hullFrac < 0.42) this.fx.burning(s.x, 4, s.z, dt, 1 - s.hullFrac);
      if (s.alive && s.speed > 3) {
        const bx = s.x + Math.sin(s.yaw) * s.cls.len * 0.45;
        const bz = s.z + Math.cos(s.yaw) * s.cls.len * 0.45;
        this.fx.bowSpray(bx, waveHeight(bx, bz), bz, Math.sin(s.yaw) * s.speed, Math.cos(s.yaw) * s.speed,
          clamp01(s.speed / s.cls.speed) * (s.isPlayer ? 1 : 0.5));
      }
    }
    // reap
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (s.dead) {
        if (s.isPlayer) continue;
        this.removeShip(s);
      }
    }

    this.projectiles.update(dt, this.ctx);
    for (let i = this.boardings.length - 1; i >= 0; i--) {
      const b = this.boardings[i];
      b.update(dt);
      if (b.done) this.boardings.splice(i, 1);
    }

    /* ---- population ----
       Not during a fleet action. The world keeps its traffic topped up, and
       left running it would sail fresh merchants straight into the middle of
       a battle that had deliberately benched everyone else — the ship count
       went up while the action was on. The sea outside waits. */
    this.spawnTimer -= this.mode === 'battle' ? 0 : dt;
    if (this.spawnTimer <= 0 && this.mode !== 'battle') {
      this.spawnTimer = 6;
      this.cullDistant();
      const counts = { merchant: 0, fisher: 0, pirate: 0, patrol: 0 };
      for (const s of this.ships) if (counts[s.role] != null && s.alive && !s.captured) counts[s.role]++;
      for (const k in TRAFFIC) {
        if (counts[k] < TRAFFIC[k]) { this.spawnNPC(k); break; }
      }
    }

    if (this.mode !== 'battle') this.market.tick(dt);

    // ---- world visuals: these run even with no flagship, so the title
    // screen shows a real, moving ocean rather than a still frame ----
    const wx = Math.sin(this.windAng) * 9, wz = Math.cos(this.windAng) * 9;
    this.fx.update(dt, wx, wz);
    this.wakes.update(dt);
    updateWater(dt, this.rig.focus.x, this.rig.focus.z, this.windAng);
    updateSky(dt, this.rig.focus.x, this.rig.focus.z, this.windAng);

    if (!p || !p.alive) { this.checkGameOver(); return; }

    // ---- player upkeep ----
    // Empty barrels used to kill a hand every twenty seconds, which turned a
    // bad afternoon into an unrecoverable one. Hunger now takes the edge off
    // the crew long before it takes any of them: you lose performance, get
    // told about it, and have time to make port.
    const eat = (p.crewTotal * dt) / 380;
    p.provisions -= eat;
    const low = p.provisions <= p.crewTotal * 0.8;
    if (low && !this.hintState.lowProv) {
      this.hintState.lowProv = 1;
      toast('The barrels are running low. Make port before they are empty.', 'bad', 4200);
    } else if (!low && this.hintState.lowProv && p.provisions > p.crewTotal * 1.6) {
      this.hintState.lowProv = 0;
    }
    if (p.provisions <= 0) {
      p.provisions = 0;
      p.hungry = Math.min(1, p.hungry + dt * 0.05);      // ~20s to fully worn down
      p.morale = Math.max(0.15, p.morale - dt * 0.012);
      if (!this.hintState.starving) {
        this.hintState.starving = 1;
        toast('Empty barrels. The hands are on short commons and working badly.', 'bad', 5000);
      }
      // a death only once hunger has properly set in, and never below a
      // working crew — a captain alone on a becalmed deck is not a game
      if (p.hungry > 0.85 && Math.random() < dt * 0.008 && p.crewTotal > p.cls.crewMin) {
        p.killCrew(1); this.stats.crewLost++;
        toast('A hand has died of want.', 'bad');
      }
    } else if (p.hungry > 0) {
      p.hungry = Math.max(0, p.hungry - dt * 0.14);      // fed again, back on their feet
      if (this.hintState.starving && p.hungry === 0) this.hintState.starving = 0;
    }
    this.crewXP += dt * 0.35 * (this.combatHeat > 0 ? 3 : 1);
    this.stats.distance += p.speed * dt;

    // ---- the campaign layer ----
    this.encounterCooling = Math.max(0, this.encounterCooling - dt);
    if (this.mode === 'battle' && this.battle) this.battle.update(dt);
    else { this.updateChase(dt); this.updatePursuit(dt); this.checkContact(); }

    // ---- contextual state ----
    this.updateContext(dt);
    this.updateQuests(dt);
    this.updateHints(dt);
    this.markers.update(dt, this);

    this.combatHeat = Math.max(0, this.combatHeat - dt);
    const shoreD = this.nearestShoreDist(p);
    /* One state bag for ambience and score alike. The music controller is the
       only thing that decides what plays; this is the only place the game
       tells it what is true. */
    let nearPortObj = null, nearPortD = 1e9;
    for (const port of PORTS) {
      const d = dist(p.x, p.z, port.x, port.z);
      if (d < nearPortD) { nearPortD = d; nearPortObj = port; }
    }
    /* Danger, graded: a pursuer gaining is the knife at your back; one merely
       out there, or powder smoke still in the air, is the low unease. */
    const tension = this.mode === 'battle' ? 0
      : this.pursuit ? (this.pursuit.gaining ? 2 : 1)
        : (this.combatHeat > 0 ? 1 : 0);
    updateAudio(dt, {
      speedN: clamp01(p.speed / p.cls.speed),
      shallow: clamp01(1 - depthAt(p.x, p.z) / 40),
      nearShore: clamp01(1 - shoreD / 420),
      nearPort: this.dockablePort ? 1 : clamp01(1 - nearPortD / 420),
      combat: this.combatHeat > 0 ? 1 : 0,
      mode: this.mode,
      portId: this.inPort ? this.inPort.id : null,
      portFaction: this.inPort ? this.inPort.faction : null,
      nearPortId: nearPortD < 460 ? nearPortObj.id : null,
      nearPortFaction: nearPortD < 460 ? nearPortObj.faction : null,
      tension,
      battlePhase: this.mode === 'battle' ? this.battleMusicPhase() : null,
      boarding: this.boardings.some(b => b.a === p || b.d === p),
    });

    /* Never mid-action. save() writes this.ships, and during a battle that
       array holds only the fighters — everyone else is benched. An autosave
       landing here would write a world with eleven ships missing from it and
       reload into that. The battle saves itself when it ends. */
    if (this.mode === 'campaign') {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) { this.saveTimer = 25; this.save(); }
    }
  }

  updateQuests(dt) {
    this._questT = (this._questT || 0) - dt;
    if (this._questT > 0) return;
    this._questT = 2.5;
    // keep the hunt's quarry in the world while the contract is live
    const hunt = this.quests.find(q => q.active && q.kind === 'hunt' && !q.done);
    if (hunt && !this.ships.some(s => s.isSant)) this.spawnSant();
    // and keep whoever the story is currently pointing you at
    const ch = this.currentChapter;
    if (ch && ch.id === 'nemesis' && !this.nemesisDown && !this.ships.some(s => s.nemesisId)) {
      this.spawnNemesis();
    }
    this.updateStory();
    this.refreshObjective();
  }

  /* =========================================================
     the story spine
     ========================================================= */
  get currentChapter() { return this.storyOver ? null : CHAPTERS[this.chapter] || null; }

  /** Busy with somebody. Guns lately, a ship marked and close, or a hostile
      in your lap — no time to be handed a page of prose. */
  get engaged() {
    const p = this.player;
    if (!p) return false;
    if (this.combatHeat > 0) return true;
    const t = this.target;
    if (t && t.alive && !t.captured && dist(p.x, p.z, t.x, t.z) < 520) return true;
    return this.ships.some(s => s.alive && !s.captured && !s.isPlayer && s.hostileToPlayer
      && !this.fleet.includes(s) && dist(p.x, p.z, s.x, s.z) < 420);
  }
  /** Chapter text can depend on who you are, so everything is a call. */
  chapterText(ch, key) {
    const v = ch && ch[key];
    return typeof v === 'function' ? v(this) : (v || '');
  }

  updateStory() {
    const ch = this.currentChapter;
    if (!ch || this.gameOver) return;
    /* The earning and the telling are two moments, and only the second one
       waits. A busy hour ashore can finish two or three chapters at once —
       take a prize on the way in, turn a contract in at the counter, give the
       prize a captain — and when the cards all kept until open water they
       arrived as a stack of three, which read as the game having only just
       noticed. So: the tick lands the moment the thing is done, wherever you
       are, and the full page still keeps until there is quiet to read it in —
       with a breath between pages when more than one is owed. */
    if (!this._chEarned && ch.done(this)) {
      this._chEarned = true;
      toast(`✓ ${this.chapterText(ch, 'title')} — done`);
      sfxBell();
    }
    if (!this._chEarned) return;
    // a chapter scene does not open in the middle of a fleet action
    if (this.mode !== 'campaign') return;
    // never interrupt a harbour, a boarding, another dialog — or a fight.
    // The scene keeps until the guns are quiet; it reads better there anyway.
    if (isSheetOpen() || isModalOpen() || this.boardings.length || this.engaged) return;
    if ((this._storyCool || 0) > 0) return;

    this._chEarned = false;
    this._storyCool = 8;
    const coin = ch.coin ? this.gainCoin(ch.coin) : 0;
    const pres = ch.prestige ? this.gainPrestige(ch.prestige) : 0;
    this.chapter++;
    const next = this.currentChapter;
    if (next && next.onOpen) next.onOpen(this);

    const loot = (coin || pres)
      ? `<div class="loot">${coin ? `<span>◆ ${coin}</span>` : ''}${pres ? `<span>★ ${pres} prestige</span>` : ''}</div>`
      : '';
    const opening = next ? this.chapterText(next, 'open') : '';
    /* Name the chapter *and* say where it sits. On its own, "A Purse of Your
       Own" is a phrase that arrives from nowhere; with "Chapter 2 of 6" over
       it, it is plainly the next beat of a story that has a shape and an end. */
    const where = next ? `<span class="story-count">Chapter ${this.chapter + 1} of ${CHAPTERS.length}</span>` : '';
    const body = `${this.chapterText(ch, 'close')}${loot}`
      + (opening ? `<div class="story-next">${where}<span>${this.chapterText(next, 'title')}</span>${opening}</div>` : '');

    if (!next) { this.endStory(body); return; }
    this.paused = true;
    sfxBell();
    modal({
      title: this.chapterText(ch, 'title'),
      text: body,
      actions: [{ label: 'ON', cls: 'gold', fn: () => { this.paused = false; this.refreshObjective(); } }],
    });
    this.save();
  }

  /** The last chapter closes on the ambition you named at the start. */
  endStory(body) {
    this.storyOver = true;
    const end = ENDINGS[this.origin.ambition] || ENDINGS.clear;
    this.paused = true;
    sfxBell();
    modal({
      title: end.title,
      text: `${body}<hr>${end.text}<br><br><em>${this.captainName}</em> — ${this.stats.sunk} sunk, `
        + `${this.stats.captured} taken, ${Math.round(this.stats.distance / 100)} leagues sailed.<br><br>`
        + 'The Shoals are still here. So are you. Keep sailing as long as you like.',
      actions: [{ label: 'KEEP SAILING', cls: 'gold', fn: () => { this.paused = false; this.refreshObjective(); } }],
    });
    this.save();
  }

  /** Sunk or taken — if she was the story's, the story moves on. */
  markStoryTarget(s) {
    if (s.nemesisId && s.nemesisId === this.origin.nemesis) this.nemesisDown = true;
    if (s.isSant) this.santDown = true;
  }

  /** Put the person you are owed an answer by into the world. */
  spawnNemesis() {
    const def = this.nemesisDef;
    if (this.nemesisDown || this.ships.some(s => s.nemesisId === def.id)) return;
    const a = Math.random() * TAU;
    const px = this.player.x + Math.cos(a) * 850, pz = this.player.z + Math.sin(a) * 850;
    const s = new Ship({
      classId: def.classId, faction: 'pirate', name: def.ship, role: 'pirate',
      x: clamp(px, -this.limit * 0.8, this.limit * 0.8), z: clamp(pz, -this.limit * 0.8, this.limit * 0.8),
      yaw: Math.random() * TAU,
      colors: { hull: 0x33291f, trim: 0x8f2f2a, sail: 0xb3a48c, flag: 0x8f2f2a },
    });
    s.nemesisId = def.id;
    s.captainName = def.name;
    for (const k in def.crew) s.crew[k] += def.crew[k];
    this.addShip(s);
  }

  cullDistant() {
    const p = this.player;
    if (!p) return;
    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      if (s.isPlayer || this.fleet.includes(s) || s === this.target) continue;
      if (s.boarding) continue;
      const d = dist(s.x, s.z, p.x, p.z);
      if (d > 2400 || (!s.alive && s.sinking > 6)) this.removeShip(s);
    }
  }

  updateContext(dt) {
    const p = this.player;
    // dockable port. Inside the buoys you are under the shore's guns and the
    // Tally have already sheered off, so the harbour is always open — running
    // for port is the one move a losing captain has, and it has to work.
    let dock = null;
    for (const port of PORTS) {
      if (dist(p.x, p.z, port.x, port.z) < port.dockR && p.speed < 7.5) { dock = port; break; }
    }
    // outside them, a hostile alongside still stops you warping to a quay
    if (dock) {
      for (const s of this.ships) {
        if (!s.alive || s.captured || s.isPlayer || this.fleet.includes(s)) continue;
        if (!isHostile(p, s) && !s.hostileToPlayer) continue;
        if (dist(s.x, s.z, dock.x, dock.z) < dock.dockR) { dock = null; break; }
      }
    }
    if (dock !== this.dockablePort) {
      this.dockablePort = dock;
      if (dock) sfxBell();
    }

    // target validity
    if (this.target && (!this.target.alive || this.target.captured || dist(p.x, p.z, this.target.x, this.target.z) > 1200)) {
      this.target = null;
    }
    /* Guns and grapples belong to the battle instance. On the campaign layer
       a marked ship is something you are looking at, not something you are
       shooting at — which is the whole point of the encounter sitting between
       the two. */
    const live = this.mode === 'battle';
    this.fireSide = live && this.target ? bestSide(p, this.target, 70) : null;
    this.boardable = live && this.target
      ? canBoard(p, this.target) && (this.target.hullFrac < 0.98 || this.target.crewTotal < p.crewTotal) : false;
    this.boardOdds = this.target ? boardOdds(p, this.target) : 0;

    // POI discovery
    for (const poi of POIS) {
      if (this.discovered.has(poi.id)) continue;
      if (dist(p.x, p.z, poi.x, poi.z) < poi.r) this.discoverPOI(poi);
    }
    void dt;
  }

  /* =========================================================
     the campaign layer: pursuit, contact, encounters
     ========================================================= */

  /**
   * Who is actually coming for you, and how the chase is going.
   *
   * The HUD needs more than "an enemy is near": it needs to say whether she
   * is gaining, because that is the only fact a captain can act on. Closing
   * speed is measured off the change in range rather than off her heading —
   * a ship pointed at you but losing ground is not a threat, and a ship
   * quartering across your bow may be.
   */
  updatePursuit(dt) {
    const p = this.player;
    if (this.mode !== 'campaign' || !p || !p.alive) { this.pursuit = null; return; }
    let lead = null, bd = PURSUIT_R;
    for (const s of this.ships) {
      if (s.isPlayer || this.fleet.includes(s) || !s.alive || s.captured) continue;
      if (s.target !== p && !s.hostileToPlayer) continue;
      if (s.chaseHold > 0 || s.fleeing) continue;
      const d = dist(s.x, s.z, p.x, p.z);
      if (d < bd) { bd = d; lead = s; }
    }
    if (!lead) { this.pursuit = null; this._pursuitLast = null; return; }

    const last = this._pursuitLast;
    const rate = last && last.s === lead ? (last.d - bd) / Math.max(1e-3, dt) : 0;
    this._pursuitLast = { s: lead, d: bd };
    // smoothed, or it flickers between gaining and losing on every swell
    this._closing = last && last.s === lead ? this._closing * 0.9 + rate * 0.1 : rate;

    const w = this.weighUp(lead);
    this.pursuit = {
      ship: lead,
      dist: Math.round(bd),
      closing: this._closing,
      gaining: this._closing > 0.35,
      losing: this._closing < -0.35,
      // at this rate, how long until she is aboard you
      eta: this._closing > 0.35 ? Math.round((bd - CONTACT_R) / this._closing) : null,
      faction: lead.faction,
      verdict: w.verdict,
      tier: w.tier,
      band: enemyBand(this, lead).length,
    };
  }

  /** Physical contact. This is the only thing that starts a fight. */
  checkContact() {
    if (this.mode !== 'campaign' || this.encounterCooling > 0) return;
    const p = this.player;
    if (!p || !p.alive || this.inPort || isSheetOpen() || isModalOpen()) return;
    // a harbour is a refuge and stays one
    if (portGuarding(p.x, p.z)) return;
    for (const s of this.ships) {
      if (s.isPlayer || this.fleet.includes(s) || !s.alive || s.captured) continue;
      if (s.chaseHold > 0 || s.fleeing) continue;
      /* Either side can mean it.
         She is coming for you; or you have marked her and sailed into her; or
         you are simply at odds and have run out of sea between you. The first
         of those used to be the only one, which meant the player could not
         start a fight at all: a raider busy with a merchant is not hunting
         you and is not flagged hostile to you, so a captain sent to hunt one
         could sail clean through her and nothing would happen. Marking her is
         the gesture the game already teaches — the chapter says to tap her —
         so it is what "I mean this one" is spelled with. */
      const sheMeansIt = s.target === p || s.hostileToPlayer;
      const youMeanIt = this.target === s;
      const atOdds = isHostile(p, s) || isHostile(s, p);
      if (!sheMeansIt && !youMeanIt && !atOdds) continue;
      if (dist(s.x, s.z, p.x, p.z) > CONTACT_R) continue;
      this.startEncounter(s);
      return;
    }
  }

  /** The world stops and asks. */
  startEncounter(lead) {
    if (this.mode !== 'campaign') return null;
    this.encounter = buildEncounter(this, lead);
    this.mode = 'encounter';
    this.paused = true;
    /* Fast-forward is for empty sea. Being brought to is the opposite of that,
       so the clock comes back to 1× and stays there — the player picks the
       speed up again when they are ready, rather than being handed back a
       world already running at four times life. */
    this.speed = Math.min(this.speed, 1);
    this.clearTarget();
    sfxHorn();
    if (this.onEncounter) this.onEncounter(this.encounter);
    return this.encounter;
  }

  /**
   * Answer it. Every branch either ends the encounter and hands the world
   * back, or opens a battle — nothing is left half-resolved.
   */
  chooseEncounter(id) {
    const enc = this.encounter;
    if (!enc || this.mode !== 'encounter') return null;
    const p = this.player;
    let out = { id };

    if (id === 'fight') {
      this.enterBattle(enc);
      return { id, went: 'battle' };
    }

    if (id === 'flee') {
      const r = resolveFlee(this, enc);
      out = { ...out, ...r };
      if (r.escaped) {
        this.breakOff(enc, 340);
        out.went = 'away';
        this.closeEncounter();
      } else {
        enc.fledAndFailed = true;
        out.went = 'battle';
        this.enterBattle(enc);
      }
      return out;
    }

    if (id === 'cargo') {
      // she came for the hold; she gets the hold
      const taken = { ...p.cargo };
      for (const k in p.cargo) p.cargo[k] = 0;
      this.infamy = Math.max(0, this.infamy - 2);
      this.breakOff(enc, 300);
      this.closeEncounter();
      return { ...out, went: 'away', taken };
    }

    if (id === 'bribe') {
      const cost = bribeCost(this, enc);
      if (this.coin < cost) return { ...out, went: 'refused' };
      this.coin -= cost;
      this.breakOff(enc, 300);
      this.closeEncounter();
      return { ...out, went: 'away', cost };
    }

    /* Harbour dues. Paying is not a defeat — it is what the League's water
       costs, and paying it is how you come to be known there. */
    if (id === 'dues') {
      const cost = duesFor(this, enc);
      if (this.coin < cost) return { ...out, went: 'refused' };
      this.coin -= cost;
      this.standing.sable = Math.min(100, (this.standing.sable || 0) + 3);
      this.breakOff(enc, 300);
      this.closeEncounter();
      return { ...out, went: 'away', cost };
    }

    /* A passage bought from the Covenant. You are paying for knowledge, and
       they think better of you for valuing it. */
    if (id === 'chart') {
      const cost = chartFor(this, enc);
      if (this.coin < cost) return { ...out, went: 'refused' };
      this.coin -= cost;
      this.standing.veyra = Math.min(100, (this.standing.veyra || 0) + 4);
      this.breakOff(enc, 300);
      this.closeEncounter();
      return { ...out, went: 'away', cost };
    }

    if (id === 'colours') {
      // a patrol that knows your colours has no business boarding you
      this.breakOff(enc, 300);
      this.closeEncounter();
      return { ...out, went: 'away' };
    }

    if (id === 'parley' || id === 'demand') {
      const chance = talkChance(this, enc, id);
      const roll = Math.random();
      out.chance = chance; out.roll = roll;
      if (roll < chance) {
        if (id === 'demand') {
          // she strikes: her cargo and her powder, and no one killed for it
          const coin = this.gainCoin(Math.round(40 + enc.theirs * 1.6));
          this.gainPrestige(4, enc.faction === 'pirate');
          out.coin = coin;
        }
        this.breakOff(enc, 320);
        this.closeEncounter();
        return { ...out, went: 'away' };
      }
      // she was not impressed, and now she is closer than she was
      out.went = 'battle';
      enc.fledAndFailed = false;
      this.enterBattle(enc);
      return out;
    }

    return out;
  }

  /** Put some water between the two fleets and give her something else to do. */
  breakOff(enc, sep) {
    const p = this.player;
    for (const s of enc.enemies) {
      const away = Math.atan2(s.x - p.x, s.z - p.z);
      s.x = p.x + Math.sin(away) * sep;
      s.z = p.z + Math.cos(away) * sep;
      s.target = null;
      s.hostileToPlayer = false;
      s.aggro = 0;
      s.chaseHold = 60;
    }
  }

  closeEncounter() {
    this.encounter = null;
    this.mode = 'campaign';
    this.paused = false;
    this.encounterCooling = 8;
    this.pursuit = null;
    this._pursuitLast = null;
    if (this.onEncounterEnd) this.onEncounterEnd();
  }

  /* =========================================================
     the battle instance
     ========================================================= */

  enterBattle(enc) {
    this.encounter = null;
    this.mode = 'battle';
    this.paused = false;
    this.ctx.combatLive = true;
    this.battle = new Battle(this, enc);
    this.battle.begin();
    this.speed = 1;                       // no fast-forwarding a fleet action
    if (this.onBattleStart) this.onBattleStart(this.battle);
    return this.battle;
  }

  /** Which movement of the battle music this moment is. The score hears the
      fight the way the player reads it: closing, trading iron, sinking, or
      winning — and it hears the turn before the reckoning card says so. */
  battleMusicPhase() {
    const b = this.battle, p = this.player;
    if (!b || !p) return 'b';
    if (p.hullFrac < 0.38) return 'c';                      // your own ship failing outranks all
    const foes = b.enemies.filter(s => s.alive && !s.captured);
    if (!foes.length) return 'd';
    const meanHull = foes.reduce((a, s) => a + s.hullFrac, 0) / foes.length;
    const allRunning = foes.every(s => s.fleeing);
    if (meanHull < 0.4 || allRunning) return 'd';           // theirs collapsing: advantage
    let nearest = 1e9;
    for (const s of foes) nearest = Math.min(nearest, dist(p.x, p.z, s.x, s.z));
    if (nearest > GUN_RANGE * 0.95 && this.combatHeat < 16) return 'a';  // still closing
    return 'b';
  }

  endBattle(battle) {
    this.ctx.combatLive = false;
    this.mode = 'campaign';
    /* The guns are quiet the moment the action is. combatHeat is set to 20 at
       the start of a battle and only bleeds off a second at a time, and the
       story refuses to open a chapter while it is burning — so finishing the
       chapter that sends you to fight left the player waiting the better part
       of half a minute, after the reckoning card had already told them they
       had won. Long enough to read as broken. */
    this.combatHeat = Math.min(this.combatHeat, 3);
    this.battle = null;
    this.encounterCooling = 12;
    this.pursuit = null;
    this._pursuitLast = null;
    this.target = null;
    this.fireSide = null;
    this.boardable = false;
    /** What the last action cost the other side, for the record and the tests. */
    this.battleLastSunk = battle.result.sunk;
    /* A won fight resolves musically — a few seconds of the tune in the clear.
       A fled or broken-off one just hands the mix back to the sea. */
    if (battle.result.outcome === 'won') sfxMusicEvent('victory');
    if (this.onBattleEnd) this.onBattleEnd(battle.result);
    // a lost flagship is still a lost flagship
    if (battle.result.outcome === 'lost') this.checkGameOver();
    else this.save();
  }

  /* =========================================================
     fighting weight — what a captain sizes another ship up by
     ========================================================= */
  /** Everything sailing under your flag, added together. */
  get fleetStrength() {
    let n = 0;
    for (const s of this.fleet) if (s.alive) n += strength(s);
    return n;
  }
  /**
   * The state of the fleet's shot lockers, and what filling them would cost.
   *
   * Stores only ever went aboard the flagship and nothing refilled a consort,
   * so a prize fired off whatever was in her when you took her and was a hull
   * with sails after that — a captain with four ships had one ship and three
   * witnesses. A full locker is three rounds a gun, the same as she is built
   * with, at the same price a barrel costs you.
   */
  fleetStores() {
    const consorts = this.fleet.filter(s => !s.isPlayer && s.alive);
    const full = s => Math.round(s.cls.guns * 3);
    const short = consorts.reduce((t, s) => t + Math.max(0, full(s) - s.shot), 0);
    return {
      consorts, short, full,
      dry: consorts.filter(s => s.shot < 3).length,
      cost: Math.ceil(short * SHOT_PRICE / 10),
    };
  }
  /** Fill them. False if there is nothing to fill or the purse will not stretch. */
  storeFleet() {
    const { consorts, short, cost, full } = this.fleetStores();
    if (!short || this.coin < cost) return false;
    this.coin -= cost;
    for (const s of consorts) s.shot = full(s);
    this.save();
    return true;
  }

  /**
   * Careen and refit a hull, and remember whether she needed it badly.
   *
   * A yard can make a ship sound again; it cannot make her new. Coming in
   * with her side beaten in or her rigging in the water leaves a mark — new
   * strakes that never match, a rail cap in fresh timber — and after enough
   * of them the ship the player is sailing plainly has a past. The threshold
   * is deliberately low-frequency: a scratch does not count, so a captain who
   * pays for a touch-up every visit does not accumulate a patchwork.
   */
  repair(ship) {
    const badly = ship.hull < ship.hullMax * 0.55 || ship.sails < ship.sailMax * 0.45;
    ship.hull = ship.hullMax;
    ship.sails = ship.sailMax;
    ship.gunsPort = ship.gunsMax;
    ship.gunsStb = ship.gunsMax;
    if (badly && ship.recordHistory({ scar: 1 })) ship.refitMesh(this.scene);
    return badly;
  }

  /** Ratio of their weight to yours, and the verdict a sailing master would give. */
  weighUp(other) {
    const mine = Math.max(1, this.fleetStrength);
    const theirs = strength(other);
    const ratio = theirs / mine;
    let tier, verdict;
    if (ratio < 0.55) { tier = 0; verdict = 'FAR WEAKER'; }
    else if (ratio < 0.85) { tier = 1; verdict = 'WEAKER'; }
    else if (ratio < 1.25) { tier = 2; verdict = 'EVEN'; }
    else if (ratio < 2.0) { tier = 3; verdict = 'STRONGER'; }
    else { tier = 4; verdict = 'FAR STRONGER'; }
    return { mine: Math.round(mine), theirs: Math.round(theirs), ratio, tier, verdict };
  }

  /** Where the current objective is, for the on-screen pointer. */
  /** The ship the story is currently about, if any is on the water. */
  storyQuarry() {
    const ch = CHAPTERS[this.chapter];
    if (!ch) return null;
    if (ch.id === 'sant') return this.ships.find(s => s.isSant && s.alive && !s.captured) || null;
    if (ch.id === 'nemesis') return this.ships.find(s => s.nemesisId && s.alive && !s.captured) || null;
    return null;
  }

  /**
   * Word of where she was last seen.
   *
   * Chapter six used to name a brig and leave you to tap every sail in the
   * Shoals hoping for the right one, which is not a hunt, it is a lottery.
   * Harbours talk: dock anywhere and you hear roughly where she has been
   * working. The report is deliberately *stale and approximate* — it is where
   * she was when somebody last saw her, blurred by a few hundred metres —
   * so it points you at the right water without sailing the ship for you.
   * Inside sighting range the report gives way to the real thing.
   */
  refreshQuarryReport() {
    const q = this.storyQuarry();
    if (!q) { this.quarryReport = null; return; }
    const blur = 260;
    const a = Math.random() * TAU, r = Math.random() * blur;
    this.quarryReport = {
      name: q.name,
      x: q.x + Math.sin(a) * r, z: q.z + Math.cos(a) * r,
      at: this.time,
      near: this.nearestPortName(q.x, q.z),
    };
  }
  /** "12 leagues NE of Ilo Vantu" — how a harbour would actually put it. */
  bearingWords(x, z) {
    const p = this.player;
    if (!p) return '';
    const near = this.nearestPortName(x, z);
    const d = Math.round(dist(p.x, p.z, x, z));
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const a = Math.atan2(x - p.x, z - p.z);
    const dir = dirs[Math.round(normAng(a) / (TAU / 8)) % 8];
    return `${dir}, ${d}m${near ? ` (off ${near})` : ''}`;
  }
  nearestPortName(x, z) {
    let best = null, bd = 1e9;
    for (const p of PORTS) { const d = dist(x, z, p.x, p.z); if (d < bd) { bd = d; best = p; } }
    return best ? best.name : null;
  }

  objectiveMarker() {
    const p = this.player;
    if (!p || !p.alive) return null;
    /* The story's own quarry outranks the errands. Within sight, she is the
       mark; beyond it, the last report is. */
    const quarry = this.storyQuarry();
    if (quarry) {
      const d = dist(p.x, p.z, quarry.x, quarry.z);
      if (d < 1100) return { x: quarry.x, z: quarry.z, label: quarry.name };
      if (this.quarryReport) {
        return { x: this.quarryReport.x, z: this.quarryReport.z,
          label: `${this.quarryReport.name} · last seen` };
      }
    }
    const q = this.quests.find(x => x.active && !x.done);
    if (q && q.kind === 'cargo') {
      const port = PORTS.find(x => x.id === q.toPort);
      if (port) return { x: port.x, z: port.z, label: port.name };
    }
    if (q && q.kind === 'hunt') {
      const sant = this.ships.find(s => s.isSant && s.alive);
      if (sant) return { x: sant.x, z: sant.z, label: sant.name };
    }
    if (q && q.kind === 'bounty') {
      const t = this.ships.find(s => s.id === q.targetId && s.alive && !s.captured);
      if (t) return { x: t.x, z: t.z, label: t.name };
    }
    if (this.prizes.length) {
      const yard = PORTS.find(x => x.services.includes('shipyard'));
      if (yard) return { x: yard.x, z: yard.z, label: yard.name };
    }
    if (!this.hintState.docked) {
      const port = PORTS[0];
      return { x: port.x, z: port.z, label: port.name };
    }
    if (this.stats.captured === 0) {
      let best = null, bd = 2600;
      for (const s of this.ships) {
        if (!s.alive || s.faction !== 'pirate' || s.captured) continue;
        const d = dist(p.x, p.z, s.x, s.z);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) return { x: best.x, z: best.z, label: 'Tally sail' };
    }
    return null;
  }

  nearestPortDist(s) {
    let d = 1e9;
    for (const p of PORTS) d = Math.min(d, dist(s.x, s.z, p.x, p.z));
    return d;
  }
  nearestShoreDist(s) {
    let d = 1e9;
    for (const i of ISLANDS) for (const b of i.blobs) d = Math.min(d, dist(s.x, s.z, i.x + b.x, i.z + b.z) - b.r);
    return Math.max(0, d);
  }

  /* =========================================================
     player commands
     ========================================================= */
  commandMove(x, z) {
    const p = this.player;
    if (!p || !p.alive || p.boarding) return;
    if (p.lockTo) return;
    /* Steer round the islands rather than into them. findRoute returns null
       when the rhumb line is already clear, which is most taps — a course
       across open water is still a straight run at the point you touched. */
    // a course of your own is the helm taken back: stop running her down
    this.chasing = null;
    const route = findRoute(p.x, p.z, x, z, this.limit);
    if (route) p.setRoute(route);
    else p.setDestination(x, z);
    p.throttle = 1;
    this.markers.pingMove(x, z);
    this.mark('sailed');
  }
  selectTarget(s) {
    if (!s || s === this.player || this.fleet.includes(s)) { this.clearTarget(); return; }
    // tapping the ship you already have marked lets her go again
    if (s === this.target) { this.clearTarget(); return; }
    this.target = s;
    /* And the helm goes after her. Marking a ship is a statement of intent —
       there is nothing else you can do with a mark — so making the player
       then separately steer at a moving ship is asking them to do the
       chasing by hand. Tap her, run her down, and contact does the rest. */
    this.chasing = s;
    this._chaseAim = null;
    this._chaseT = 0;
    if (!this.hintState.chasing) {
      this.hintState.chasing = 1;
      hint('Running her down. Tap the water to take the helm back.', 3400);
    }
    sfxClick(560);
    this.mark('targeted');
  }

  /**
   * Run her down.
   *
   * Re-plotted only when she has drawn away from the point we were steering
   * for, because the course round the islands is an A* search and re-running
   * it every frame to move the mark a couple of metres is work for nothing.
   */
  updateChase(dt) {
    const p = this.player;
    const t = this.chasing;
    if (!t) return;
    if (this.mode !== 'campaign' || !p || !p.alive || p.boarding || p.lockTo
      || this.inPort || t !== this.target || !t.alive || t.captured) {
      this.chasing = null;
      return;
    }
    this._chaseT -= dt;
    const aim = this._chaseAim;
    const drifted = !aim || dist(aim.x, aim.z, t.x, t.z) > 60;
    if (!drifted && this._chaseT > 0) return;
    this._chaseT = 1.2;
    this._chaseAim = { x: t.x, z: t.z };
    const route = findRoute(p.x, p.z, t.x, t.z, this.limit);
    if (route) p.setRoute(route);
    else p.setDestination(t.x, t.z);
    p.throttle = 1;
  }
  /** Stop tracking whoever is marked. Never refuses — a mistaken tap
      should not commit you to anything. */
  clearTarget() {
    if (!this.target) return;
    this.target = null;
    this.chasing = null;
    this.fireSide = null;
    this.boardable = false;
    sfxClick(380);
  }
  playerFire() {
    const p = this.player;
    if (!p || !this.target || !this.fireSide) return;
    /* Silently. The button already says RELOADING and carries a ring that
       fills as she loads — a message on top of that is telling the player
       what they are looking at, once per tap, in a stack up the middle of
       the screen. A control that is plainly not ready does not also need to
       be told about. */
    if (p.reload[this.fireSide] > 0) return;
    const n = fireBroadside(p, this.fireSide, this.target, this.ctx);
    if (n > 0) { this.mark('fired'); this.combatHeat = 12; }
  }
  playerBoard() {
    const p = this.player;
    if (!p || !this.target) return;
    if (!canBoard(p, this.target)) { toast('Get alongside and take way off her first.', '', 2000); return; }
    this.startBoarding(p, this.target);
  }
  setFleetOrder(o, silent = false) {
    this.fleetOrder = o;
    for (const s of this.fleet) if (!s.isPlayer) s.fleetOrder = o;
    if (silent) return;
    toast({
      follow: 'Consorts: form on the flagship.',
      engage: 'Consorts: engage!',
      hold: 'Consorts: hold station.',
      withdraw: 'Consorts: break off and get clear.',
    }[o], '', 1700);
  }

  /* =========================================================
     combat callbacks
     ========================================================= */
  onBroadside(ship, side, n) {
    const d = this.player ? dist(ship.x, ship.z, this.player.x, this.player.z) : 0;
    sfxCannon(d);
    if (ship.isPlayer) {
      this.stats.broadsides++;
      this.rig.addShake(0.35 + n * 0.02);
    } else if (d < 420) this.rig.addShake(0.06);
    // the firing ship is both parties as far as "is this near me" goes
    this.heatFrom(ship, ship, d, 10);
    void side;
  }
  onSplash(x, z) {
    const p = this.player;
    if (p) sfxSplash(dist(x, z, p.x, p.z));
  }
  onHit(proj, s, res) {
    const p = this.player;
    const d = p ? dist(s.x, s.z, p.x, p.z) : 0;
    sfxWood(d);
    if (s.isPlayer) {
      this.rig.addShake(0.30);
      if (res.crew > 0) this.stats.crewLost += res.crew;
      if (res.guns) toast('A gun is dismounted!', 'bad', 1800);
    }
    // Book who is doing the work on her. An Admiralty patrol that sails in and
    // fires the last shot used to take the whole prize, leaving you the bill
    // for the shot and the hull you spent bringing her to that point.
    const work = res.hull + res.sails * 0.6 + res.crew * 3;
    const mine = proj.owner === p || this.fleet.includes(proj.owner);
    s.dmgAll = (s.dmgAll || 0) + work;
    if (mine) s.dmgMine = (s.dmgMine || 0) + work;

    if (mine) {
      if (!s.alive) this.onKill(s, proj.owner);
      if (!isHostile(p, s) && s.faction !== 'pirate' && !s.hostileToPlayer) this.provoke(s);
    }
    this.heatFrom(s, proj.owner, d, 10);
  }

  /* ---- whose fight is this? ----

     combatHeat means "the player is in action", and half the game reads it:
     the score raises the tension layer on it, `engaged` holds a chapter card
     back until it cools, and crew earn treble sea-time while it burns.

     It used to be set by ANY ball striking ANY hull anywhere. The world
     simulates its own wars whether you are watching or not, so a skirmish
     over the horizon kept the player permanently "in action": tension music
     with nothing in sight, chapter cards queueing up for minutes and then
     arriving in a stack, and free crew experience for other people's
     battles. That stacked delivery is exactly what a playtester reported.

     So it asks whose fight it is. Yours, your fleet's, or one close enough
     to be your problem — and out past that, somebody else's war. */
  heatFrom(target, owner, d, amount) {
    const p = this.player;
    if (!p) return;
    const mine = target === p || owner === p
      || this.fleet.includes(target) || this.fleet.includes(owner);
    // 520m: the range at which `engaged` already counts a marked ship as yours
    if (!mine && !(Number.isFinite(d) && d < 520)) return;
    this.combatHeat = Math.max(this.combatHeat, amount);
  }
  onGround(s, over) {
    if (s.isPlayer) {
      this.rig.addShake(0.5);
      toast('You are touching bottom!', 'bad', 2200);
      sfxWood(0);
      this.mark('grounded');
    }
    void over;
  }
  onEdge() {
    if (this.hintState.edge) return;
    this.hintState.edge = 1;
    hint('The Shoals end here. Beyond is open ocean — another voyage.', 4200);
  }

  provoke(s) {
    if (s.hostileToPlayer) return;
    s.hostileToPlayer = true;
    s.aggro = 1;
    if (s.role === 'merchant' || s.role === 'fisher') {
      this.infamy += 4;
      this.standing[s.faction] = (this.standing[s.faction] || 0) - 8;
      toast(`Word will get out. Infamy +4`, 'bad');
    } else if (s.role === 'patrol') {
      this.infamy += 6;
      this.standing[s.faction] = (this.standing[s.faction] || 0) - 14;
      toast('You have fired on the Admiralty.', 'bad');
    }
    // her friends take notice
    for (const o of this.ships) {
      if (o.faction === s.faction && dist(o.x, o.z, s.x, s.z) < 500) o.hostileToPlayer = true;
    }
  }

  /** Somebody else finished a ship you had been fighting. You do not get the
      prize, but you are not spending shot for nothing either: the salvage and
      the credit are split by who actually did the damage. */
  settleSharedKill(s) {
    s.rewarded = true;
    const share = clamp01((s.dmgMine || 0) / Math.max(1, s.dmgAll || 1));
    if (share < 0.25) return;                 // a parting shot is not a claim
    this.markStoryTarget(s);
    if (s.faction !== 'pirate') return;       // no bounty for other people's civilians
    this.stats.sunk += s.alive ? 0 : 1;
    const full = Math.round(HULLS[s.classId].value * 0.10 + s.cls.guns * 6);
    const coin = this.gainCoin(Math.round(full * share));
    const pres = this.gainPrestige((6 + s.cls.guns * 0.5) * share, true);
    this.standing.admiralty += 2;
    this.progressQuest('hunt', s);
    sfxCoin();
    toast(`${s.name} struck to another captain — your share, ◆${coin} and ${pres} prestige.`, 'gold', 4200);
    this.save();
  }

  onKill(s, killer) {
    if (s.rewarded) return;
    s.rewarded = true;
    this.stats.sunk++;
    this.markStoryTarget(s);
    const value = Math.round(HULLS[s.classId].value * 0.10 + s.cls.guns * 6);
    if (s.faction === 'pirate') {
      const pres = this.gainPrestige(6 + s.cls.guns * 0.5, true);
      this.standing.admiralty += 3; this.standing.freehold += 2;
      const got = this.gainCoin(value);
      toast(`${s.name} goes down. Prestige +${pres} · ◆${got} in salvage`, 'gold');
      this.progressQuest('hunt', s);
      this.settleBounty(s, false);
      sfxCoin();
    } else {
      this.infamy += 5;
      toast(`${s.name} sinks. That will be remembered.`, 'bad');
    }
    for (const o of (killer && killer.officers) || []) addOfficerXP(o, 20);
    this.save();
  }

  startBoarding(a, b) {
    if (a.boarding || b.boarding) return;
    if (!canBoard(a, b)) return;
    const bd = new Boarding(a, b, {
      onBoardTick: (bb, ka, kd) => {
        /* Where the fighting is. The world boards ships whether you are there
           or not, and this fires every 0.62s for as long as it lasts — without
           a distance the whole map's melee arrived in your ears at once. */
        const p = this.player;
        sfxClash(p ? dist(bb.a.x, bb.a.z, p.x, p.z) : 9e4);
        if (bb.a.isPlayer || bb.d.isPlayer) {
          this.stats.crewLost += bb.a.isPlayer ? ka : kd;
          if (this.onBoardUI) this.onBoardUI(bb);
        }
      },
      onBoardEnd: (bb, winner) => this.endBoarding(bb, winner),
    });
    this.boardings.push(bd);
    a.grapples = b;
    this.markers.grapple(a, b);
    if (a.isPlayer || b.isPlayer) {
      this.combatHeat = 14;
      sfxClash();
      if (this.onBoardStart) this.onBoardStart(bd);
      this.mark('boarded');
    }
  }

  endBoarding(bd, winner) {
    this.markers.clearGrapple();
    if (this.onBoardEndUI) this.onBoardEndUI(bd, winner);
    const p = this.player;
    /* Grapples cut. Nobody has taken anything and both ships are under way
       again — the one outcome of a boarding that leaves the action still to
       be decided, and the reason FALL BACK is worth having on the card. */
    if (winner === 'broken') {
      if (bd.a === p || bd.d === p) toast('The grapples are cut. She sheers off.', '', 2200);
      return;
    }
    const playerAttacked = bd.a === p;
    const playerDefended = bd.d === p;
    if (!playerAttacked && !playerDefended) {
      // an AI took a prize — she changes hands quietly
      if (winner === 'attacker') {
        const prize = bd.d;
        // if you were the one who beat her down, you are owed a share of her
        if (!prize.rewarded && prize.dmgMine > 0) this.settleSharedKill(prize);
        prize.rewarded = true;
        prize.faction = bd.a.faction;
        prize.captured = false;
        prize.role = bd.a.role;
        prize.hostileToPlayer = bd.a.hostileToPlayer;
        prize.mesh.userData.flagMesh.material.color.setHex(FACTIONS[prize.faction].flag);
      }
      return;
    }
    if (playerDefended && winner === 'attacker') {
      // the player has been taken
      this.playerLost('Your deck is carried. The colours come down.');
      return;
    }
    if (playerAttacked && winner === 'defender') {
      toast('Beaten back over the rail. Sheer off!', 'bad', 3000);
      p.morale = Math.max(0.3, p.morale);
      return;
    }
    // player wins
    const prize = playerAttacked ? bd.d : bd.a;
    this.offerPrize(prize);
  }

  offerPrize(prize) {
    prize.rewarded = true;       // she is yours; no shared-kill share on top
    const cls = HULLS[prize.classId];
    const p = this.player;
    this.paused = true;
    const loot = this.rollLoot(prize);
    const freeOfficer = this.officers.find(o => !o.ship && o.canCaptain);
    const spareCrew = p.crewTotal - cls.crewMin;
    const canMan = !!freeOfficer && spareCrew >= p.cls.crewMin;

    let lootHtml = '<div class="loot">';
    lootHtml += `<span>◆ ${loot.coin} coin</span>`;
    for (const g in loot.cargo) lootHtml += `<span>${GOODS[g].icon} ${loot.cargo[g]} ${GOODS[g].name}</span>`;
    if (loot.shot) lootHtml += `<span>◉ ${loot.shot} shot</span>`;
    if (loot.provisions) lootHtml += `<span>◎ ${loot.provisions} provisions</span>`;
    lootHtml += '</div>';

    const actions = [];
    if (canMan) {
      actions.push({
        label: `GIVE HER TO ${freeOfficer.name.split(' ')[0].toUpperCase()}`, cls: 'gold',
        fn: () => this.takePrizeNow(prize, freeOfficer, loot),
      });
    }
    actions.push({
      label: 'SEND HER HOME AS A PRIZE', cls: canMan ? '' : 'gold',
      fn: () => this.sendPrizeHome(prize, loot),
    });
    actions.push({ label: `SALVAGE HER (◆${Math.round(cls.value * 0.28)})`, fn: () => this.salvagePrize(prize, loot) });
    actions.push({ label: 'SCUTTLE HER', cls: 'dim', fn: () => this.scuttlePrize(prize, loot) });

    modal({
      title: `${prize.name} is Yours`,
      text: `A <b>${cls.name}</b> of <b>${FACTIONS[prize.faction].name}</b>, ${Math.round(prize.hullFrac * 100)}% sound, ${prize.gunsPort + prize.gunsStb} guns still mounted.
             ${prize.crewTotal} of her people are alive and have thrown down their arms.<br>${lootHtml}
             ${canMan ? `<br><em>${freeOfficer.name}</em> is aboard and ready for a command of their own.`
        : `<br><span style="opacity:.75">You have no officer free to command her — send her home and find one ashore.</span>`}`,
      actions,
    });
  }

  rollLoot(prize) {
    const cls = HULLS[prize.classId];
    const loot = { coin: Math.round((60 + cls.value * 0.08) * (0.7 + Math.random() * 0.7)), cargo: {}, shot: 0, provisions: 0 };
    for (const g in prize.cargo) if (prize.cargo[g] > 0) loot.cargo[g] = prize.cargo[g];
    if (prize.role === 'merchant' && !Object.keys(loot.cargo).length) {
      const keys = Object.keys(GOODS);
      const g = keys[(Math.random() * keys.length) | 0];
      loot.cargo[g] = 6 + ((Math.random() * 14) | 0);
    }
    loot.shot = Math.min(prize.shot, 8 + ((Math.random() * 10) | 0));
    loot.provisions = Math.round(prize.provisions * 0.5);
    return loot;
  }
  applyLoot(loot) {
    const p = this.player;
    this.coin += loot.coin;
    let spilled = 0;
    for (const g in loot.cargo) {
      const take = Math.min(loot.cargo[g], p.cargoFree);
      if (take > 0) p.cargo[g] = (p.cargo[g] || 0) + take;
      spilled += loot.cargo[g] - take;
    }
    p.shot += loot.shot;
    p.provisions += loot.provisions;
    if (spilled > 0) toast(`${spilled} tons left behind — the hold is full.`, '', 2600);
    sfxCoin();
  }

  finishPrize(prize) {
    this.paused = false;
    this.target = null;
    this.stats.captured++;
    /* The flagship wears the mark for it. A pennant per prize, three at most,
       so a captain who has taken thirty ships still looks like a ship. */
    if (this.player && this.player.recordHistory({ prize: 1 })) this.player.refitMesh(this.scene);
    this.markStoryTarget(prize);
    this.gainPrestige(10, prize.faction === 'pirate');
    // taken, not sunk — worth a quarter more to whoever posted the notice
    this.settleBounty(prize, true);
    if (prize.faction === 'pirate') { this.standing.admiralty += 4; this.progressQuest('hunt', prize); }
    else this.infamy += 6;
    for (const o of this.player.officers) addOfficerXP(o, 40);
    this.save();
    this.refreshObjective();
  }

  takePrizeNow(prize, officer, loot) {
    this.applyLoot(loot);
    const p = this.player;
    const cls = HULLS[prize.classId];
    // convert her to your colours
    prize.faction = 'player';
    prize.captured = false;
    prize.role = 'consort';
    prize.isPlayer = false;
    prize.hostileToPlayer = false;
    prize.target = null;
    prize.brain = { state: 'idle', t: 0 };
    /* And everything that made her somebody else's ship. `fleeing` and
       `chaseHold` are both tested before the role dispatch in updateAI, and
       both mean "run from the player at full throttle" — so a prize that kept
       either sailed off the moment the action ended and answered no order
       given to her afterwards. She misses the battle's own reset too: that
       clears the enemy list, and she left it the moment her colours came
       down. This is the one place she changes hands, so it is the place to
       put every trace of the old allegiance down. */
    prize.fleeing = false;
    prize.chaseHold = 0;
    prize.aggro = 0;
    prize.lastAttacker = null;
    prize.fleetOrder = this.fleetOrder;
    prize.formSlot = this.fleet.length;
    prize.captain = officer; officer.ship = prize;
    prize.officers = [officer];
    /* Your colours, her bones. The flag and the trim change hands; the way she
       was built does not — so she is rebuilt as what she is: a League brig
       under your flag, and she still looks like a League brig. */
    prize.colors = { hull: FACTIONS[prize.builtBy] ? FACTIONS[prize.builtBy].hull : undefined,
      trim: FACTIONS.player.trim, sail: FACTIONS.player.sail, flag: FACTIONS.player.flag };
    prize.refitMesh(this.scene);
    prize.mesh.userData.flagMesh.material.color.setHex(FACTIONS.player.flag);
    // man her: pressed hands plus a prize crew from the flagship
    const need = Math.max(0, cls.crewMin - prize.crewTotal);
    const send = Math.min(need + 6, Math.max(0, p.crewTotal - p.cls.crewMin));
    this.transferCrew(p, prize, send, true);
    this.fleet.push(prize);
    this.finishPrize(prize);
    sfxHorn();
    toast(`${prize.name} sails under your colours, ${officer.name} commanding.`, 'gold', 4200);
    hint(`Look astern. That is your fleet.`, 5200);
    this.mark('fleet');
  }

  /**
   * Step across and take command of another ship in your fleet.
   *
   * The captain is the player, not the hull: her skills, her story and the
   * camera all follow her across, and the ship she leaves becomes a consort
   * under whichever officer is aboard. Without this a captain who takes a
   * flagship worth ten of her cutter has no way to sail it, which is most of
   * the point of taking it.
   *
   * Only in harbour. Swapping flags in open water — never mind mid-action —
   * is not a thing a boat's crew can do, and the battle instance holds
   * references to the player ship that must not change under it.
   */
  takeCommand(ship) {
    if (!ship || ship === this.player) return false;
    if (this.mode !== 'campaign' || !this.inPort) {
      toast('You can only shift your flag in harbour.', 'bad', 3000);
      return false;
    }
    if (!this.fleet.includes(ship) || !ship.alive || ship.captured) return false;
    const old = this.player;

    // the officer who was sailing her stands aside; the one you leave takes yours
    const herCaptain = ship.captain;
    old.captain = herCaptain || old.captain;
    if (herCaptain) herCaptain.ship = old;
    ship.captain = null;

    old.isPlayer = false; old.role = 'consort';
    old.fleetOrder = this.fleetOrder;
    old.officers = old.officers || [];

    ship.isPlayer = true; ship.role = 'player';
    ship.fleetOrder = 'follow';
    ship.dest = null; ship.route = null; ship.headingCmd = ship.yaw; ship.throttle = 0;
    ship.tack = 0;

    /* Skill belongs to the captain, not the timber. */
    ship.capt = old.capt; old.capt = null;
    ship.shoalwise = old.shoalwise; old.shoalwise = false;

    this.player = ship;
    this.world.player = ship;

    // formation slots renumber around the new flag
    let slot = 1;
    for (const s of this.fleet) { if (s !== ship) s.formSlot = slot++; }
    ship.formSlot = 0;

    // she is where you are: put your new deck under the camera
    if (this.rig) this.rig.focus.set(ship.x, 0, ship.z);
    this.clearTarget();
    sfxHorn();
    toast(`Your flag is shifted to ${ship.name}.`, 'gold', 4000);
    this.mark('flagship');
    this.save();
    return true;
  }

  sendPrizeHome(prize, loot) {
    this.applyLoot(loot);
    this.prizes.push({
      name: prize.name, classId: prize.classId, hull: prize.hull, guns: prize.gunsPort + prize.gunsStb,
    });
    this.removeShip(prize);
    this.finishPrize(prize);
    toast(`${prize.name} taken. A prize crew will bring her into port.`, 'gold', 4000);
    hint('Find her a captain at the shipyard in Ilo Vantu.', 5000);
    this.mark('prize');
  }
  salvagePrize(prize, loot) {
    const cls = HULLS[prize.classId];
    this.applyLoot(loot);
    this.coin += Math.round(cls.value * 0.28);
    prize.sink();
    this.finishPrize(prize);
    toast('Stripped and left to settle.', 'gold', 3000);
  }
  scuttlePrize(prize, loot) {
    this.applyLoot(loot);
    prize.sink();
    this.finishPrize(prize);
    toast('Scuttled.', '', 2400);
  }

  transferCrew(from, to, n, silent = false) {
    let moved = 0;
    const order = ['deckhand', 'sailor', 'rigger', 'gunner', 'marine', 'veteran'];
    const keepMin = from.isPlayer ? from.cls.crewMin : from.cls.crewMin;
    for (const k of order) {
      while (moved < n && from.crew[k] > 0 && from.crewTotal > keepMin && to.crewTotal < to.cls.crewMax) {
        from.crew[k]--; to.crew[k]++; moved++;
      }
    }
    if (!silent) {
      if (moved === 0) toast('No hands to spare.', 'bad', 2000);
      else toast(`${moved} hands moved to ${to.name}.`, '', 2000);
    }
    this.save();
    return moved;
  }

  playerLost(reason) {
    if (this.gameOver) return;
    this.gameOver = true;
    sfxMusicEvent('defeat');
    this.paused = true;
    modal({
      title: 'The Sea Keeps Her Books',
      text: `${reason}<br><br>You sailed <b>${Math.round(this.stats.distance / 100)}</b> leagues, sank <b>${this.stats.sunk}</b> ships and took <b>${this.stats.captured}</b>.`,
      actions: [
        { label: 'BEGIN A NEW VOYAGE', cls: 'gold', fn: () => { this.paused = false; this.restart(); } },
        ...(Game.hasSave() ? [{ label: 'RETURN TO THE LAST LOG', fn: () => { this.paused = false; if (!this.load()) this.newGame(true); } }] : []),
      ],
    });
  }
  checkGameOver() {
    const p = this.player;
    if (p && !p.alive && p.sinking > 2.4 && !this.gameOver) {
      this.playerLost(`<b>${p.name}</b> has gone down under you.`);
    }
  }

  /* =========================================================
     ports
     ========================================================= */
  enterPort(port) {
    if (!port) return;
    const p = this.player;
    p.dest = null; p.headingCmd = p.yaw; p.throttle = 0; p.speed = 0;
    this.inPort = port;
    this.paused = false;
    // harbours talk: this is where you hear where she has been working
    this.refreshQuarryReport();
    // the first time she raises this particular harbour is worth two bars
    if (!this.hintState['port_' + port.id]) {
      this.hintState['port_' + port.id] = 1;
      sfxMusicEvent('discovery');
    }
    sfxHorn();
    this.promoteCrew();
    this.restockPrizes(port);
    openPort(port);
    this.mark('docked');
    this.save();
  }
  leavePort() {
    this.inPort = null;
    const p = this.player;
    if (p && p.alive) { p.throttle = 1; p.headingCmd = p.yaw; }
    this.refreshObjective();
    this.save();
  }
  restockPrizes(port) {
    // prizes sent home turn up at the major yard
    if (port && port.services.includes('shipyard') && this.prizes.length) {
      toast(`${this.prizes.length} prize${this.prizes.length > 1 ? 's' : ''} waiting in the roads.`, 'gold', 3200);
    }
  }

  promoteCrew() {
    const p = this.player;
    let promoted = 0, specialised = 0;
    // sea time rates deckhands up, then lets some specialise
    while (this.crewXP >= 40 && p.crew.deckhand > 0) {
      this.crewXP -= 40; p.crew.deckhand--; p.crew.sailor++; promoted++;
    }
    while (this.crewXP >= 120 && p.crew.sailor > 2) {
      this.crewXP -= 120;
      const roll = Math.random();
      const to = roll < 0.4 ? 'gunner' : roll < 0.75 ? 'marine' : 'rigger';
      p.crew.sailor--; p.crew[to]++; specialised++;
    }
    while (this.crewXP >= 300 && (p.crew.gunner + p.crew.marine + p.crew.rigger) > 2) {
      this.crewXP -= 300;
      const pool = ['gunner', 'marine', 'rigger'].filter(k => p.crew[k] > 0);
      const from = pool[(Math.random() * pool.length) | 0];
      p.crew[from]--; p.crew.veteran++;
      toast('An old salt has earned the name.', 'good', 3000);
    }
    if (promoted) toast(`${promoted} deckhand${promoted > 1 ? 's are' : ' is'} rated Sailor.`, 'good', 3200);
    if (specialised) toast(`${specialised} sailor${specialised > 1 ? 's have' : ' has'} taken a trade.`, 'good', 3400);
    for (const o of this.officers) addOfficerXP(o, 8);
  }

  /* ---------- shops ---------- */
  tavernPool(port) {
    if (!this.tavernCache[port.id]) {
      this.tavernCache[port.id] = rollTavernOfficers(port.id.length * 3301 + Math.floor(this.time / 600) * 17 + 5, 3, this.officers);
    }
    return this.tavernCache[port.id].filter(o => !this.officers.includes(o));
  }
  hireOfficer(o, port) {
    if (this.coin < o.hire) { toast('Not enough coin.', 'bad'); return; }
    if (this.officers.length >= 6) { toast('You have officers enough.', 'bad'); return; }
    this.coin -= o.hire;
    this.officers.push(o);
    this.player.officers.push(o);
    sfxCoin();
    toast(`${o.name} signs on as ${officerLabel(o)}.`, 'good', 3200);
    this.save();
    void port;
  }
  /** The hands a prize needs to be worked out of harbour under your colours.
      Not her full complement — a prize crew is famously thin, and she sails
      undermanned until you hire her up, which the crew-skill curve already
      models as slower reloads and a heavier helm. */
  prizeCrewFor(cls) { return Math.max(4, Math.min(cls.crewMin, 8)); }

  commissionPrize(prizeRec, officer, port) {
    const p = this.player;
    const cls = HULLS[prizeRec.classId];
    /* This used to demand her full minimum out of the flagship's own company,
       which for anything above a lugger was arithmetically impossible: a
       frigate wants 26 hands and a cutter holds 22, so the gate read
       22 − 26 < 5 and no captain in any save could ever have passed it. A
       prize you cannot ever commission is a dead end, and this game does not
       have those. She goes out with a prize crew and you man her properly at
       the rail afterwards. */
    const need = this.prizeCrewFor(cls);
    if (p.crewTotal - need < p.cls.crewMin) {
      toast(`Not enough hands to spare her a prize crew — ${need} needed.`, 'bad', 3200);
      return;
    }
    // moor her in the harbour on the seaward side of the town, in water she
    // actually floats in rather than wherever a fixed bearing happens to land
    const berth = this.harbourBerth(port);
    const s = new Ship({
      classId: prizeRec.classId, faction: 'player', name: prizeRec.name, role: 'consort',
      x: berth.x, z: berth.z,
      yaw: port.ang, crew: emptyCrew(),
      colors: { hull: FACTIONS.player.hull, trim: FACTIONS.player.trim, sail: FACTIONS.player.sail, flag: FACTIONS.player.flag },
    });
    s.hull = prizeRec.hull;
    s.captain = officer; officer.ship = s;
    s.officers = [officer];
    s.formSlot = this.fleet.length;
    s.fleetOrder = this.fleetOrder;
    this.addShip(s);
    this.fleet.push(s);
    this.transferCrew(p, s, need, true);
    const idx = this.prizes.indexOf(prizeRec);
    if (idx >= 0) this.prizes.splice(idx, 1);
    sfxHorn();
    toast(`${s.name} commissioned — ${officer.name} commanding.`, 'gold', 4200);
    this.mark('fleet');
    this.save();
  }

  /**
   * What this yard will do to your ship.
   *
   * The four common refits are available anywhere with a shipyard. What each
   * faction *adds* is the thing it is good at, so sailing somewhere is worth
   * doing for a reason other than the scenery: the League builds heavy and
   * controls channels, the Covenant re-rigs and shallows a draught. A captain
   * who never leaves home water never sees either.
   */
  upgradesFor(ship, port = this.inPort) {
    ship.upgrades = ship.upgrades || [];
    const local = {
      sable: [
        { id: 'breakwater', name: 'Breakwater Frames', cost: 1150,
          desc: 'League framing, doubled at the bow. +18% hull.',
          seen: 'She is framed like a harbour wall.' },
        { id: 'rudder', name: 'Deep-Rudder Gear', cost: 880,
          desc: 'A deeper blade and better tackle. Turns far better at slow speed.',
          seen: 'A deeper rudder, and gear to work it.' },
      ],
      veyra: [
        { id: 'reefkeel', name: 'Reef Keel', cost: 990,
          desc: 'Cut down and re-shod. She draws a third less water.',
          seen: 'She sits noticeably higher.' },
        { id: 'veyrarig', name: 'Covenant Rig', cost: 1080,
          desc: 'Re-rigged Covenant fashion. Quicker off the mark, and better by the wind.',
          seen: 'Her whole sail plan has changed.' },
      ],
    }[port && port.faction] || [];
    const defs = [
      { id: 'copper', name: 'Copper Sheathing', desc: 'Clean bottom, half a knot more. +8% speed.',
        cost: 620, seen: 'Her bottom is plated to the boot-top.' },
      { id: 'timbers', name: 'Doubled Timbers', desc: 'Extra frames along the waterline. +25% hull.',
        cost: 780, seen: 'Heavy wales run her whole length now.' },
      { id: 'ports', name: 'Cut Two More Gunports', desc: 'One more gun to a side. +2 guns.',
        cost: 900, seen: 'Two new muzzles run out.' },
      { id: 'lockers', name: 'Deepened Lockers', desc: 'More room for shot and stores. +20 cargo.',
        cost: 460, seen: 'A wider hatch, and stores lashed on deck.' },
    ];
    return [...defs, ...local].map(d => ({ ...d, owned: ship.upgrades.includes(d.id) }));
  }
  /** Recompute a ship's numbers from her refit list. Exposed for QA. */
  applyUpgradesTo(ship) { applyUpgrades(ship); }

  buyUpgrade(ship, up) {
    if (this.coin < up.cost) { toast('Not enough coin.', 'bad'); return; }
    this.coin -= up.cost;
    ship.upgrades = ship.upgrades || [];
    ship.upgrades.push(up.id);
    applyUpgrades(ship);
    /* And she is rebuilt on the spot. A refit that only moved numbers made
       every upgrade feel like a spreadsheet entry; the point is that the
       captain leaves the yard, looks at his ship and sees the work. */
    ship.refitMesh(this.scene);
    sfxCoin();
    toast(`${up.name} fitted. ${up.seen}`, 'good', 3600);
    this.save();
  }

  onGoodsSold(gid, cnt, port) {
    this.progressQuest('cargo', { gid, cnt, port });
  }
  /** Freight has to be loaded where the contract was written. Buying it at the
      far end is shopping, not carrying, and the harbourmaster knows it. */
  onGoodsBought(gid, cnt, port) {
    for (const q of this.quests) {
      if (!q.active || q.done || q.kind !== 'cargo') continue;
      if (q.good !== gid || q.fromPort !== port.id) continue;
      q.loaded = Math.min(q.amount, (q.loaded || 0) + cnt);
      this.refreshObjective();
    }
  }

  /* =========================================================
     quests & discoveries
     ========================================================= */
  /** The harbourmaster's board. Three runs, always, always out of this port —
      a captain who can reach a quay can always find work. */
  contractsAt(port) {
    const out = [];
    for (const q of this.quests) {
      if (q.active || q.done || q.board !== 'harbour') continue;
      if (q.portId && q.portId !== port.id) continue;
      out.push(q);
    }
    const epoch = this.contractEpoch[port.id] || 0;
    for (let slot = 0; slot < 3; slot++) {
      const id = `cargo:${port.id}:${slot}:${epoch}`;
      if (this.quests.some(q => q.id === id)) continue;
      const nq = makeQuest(id, this.market);
      if (nq) { this.quests.push(nq); out.push(nq); }
    }
    /* And the bounty board.
     *
     * Cargo work is the honest half of a harbour's noticeboard; this is the
     * other half. Every port here sits under somebody's guns and every one of
     * them has a name it would pay to stop hearing — so a bounty names a
     * *real ship already sailing in this world*, not a spawn made up when you
     * accept it. Take her or sink her and the port pays, and the power that
     * posted it thinks better of you.
     *
     * Posted against live hulls only, and cleaned up when the hull is gone,
     * because a board advertising a ship that is already on the bottom is a
     * board nobody believes.
     */
    for (const b of this.bountiesAt(port)) out.push(b);
    return out;
  }

  /** The named hulls this port would pay to be rid of. */
  bountiesAt(port) {
    const out = [];
    // whatever is already posted here and still standing
    for (const q of this.quests) {
      if (q.kind !== 'bounty' || q.done || q.portId !== port.id) continue;
      const alive = this.ships.some(s => s.id === q.targetId && s.alive && !s.captured);
      if (!alive && !q.active) continue;      // she is gone; the notice comes down
      out.push(q);
    }
    const posted = out.filter(q => !q.done).length;
    if (posted >= 2) return out;

    /* Who this port objects to. A harbour posts against whoever its own power
       is at war with — the Tally for everyone, and the rival powers besides —
       so the board reads differently in different water, and taking Admiralty
       work is a way of choosing a side. */
    const fa = FACTIONS[port.faction];
    const enemies = new Set(['pirate', ...(fa ? fa.hostileTo : [])]);
    enemies.delete('player');
    const seen = new Set(this.quests.filter(q => q.kind === 'bounty' && !q.done).map(q => q.targetId));
    const cands = this.ships.filter(s => s.alive && !s.captured && !s.isPlayer
      && !this.fleet.includes(s) && enemies.has(s.faction) && !seen.has(s.id)
      && dist(s.x, s.z, port.x, port.z) < 2600);
    // the worst of them first: a bounty should name someone worth naming
    cands.sort((a, b) => strength(b) - strength(a));
    for (const s of cands.slice(0, 2 - posted)) {
      const q = makeBounty(this, port, s);
      this.quests.push(q);
      out.push(q);
    }
    return out;
  }

  /** Pay off any bounty this hull was carrying. Sunk or taken, both count. */
  settleBounty(ship, taken) {
    let paid = 0;
    for (const q of this.quests) {
      if (q.kind !== 'bounty' || q.done || !q.active) continue;
      if (q.targetId !== ship.id) continue;
      q.done = true; q.progress = 1;
      const reward = taken ? Math.round(q.reward * 1.25) : q.reward;
      const got = this.gainCoin(reward);
      const pres = this.gainPrestige(q.prestige, ship.faction === 'pirate');
      if (q.faction) this.standing[q.faction] = (this.standing[q.faction] || 0) + 4;
      paid += got;
      toast(`Bounty settled on ${ship.name} — ◆${got}, prestige +${pres}.`, 'gold', 4600);
      sfxCoin();
    }
    if (paid) this.save();
    return paid;
  }
  /** A sentence of guidance appended to the story objective, when there is a
      quarry on the water and word to give about her. */
  quarryHint() {
    const q = this.storyQuarry();
    if (!q) return '';
    const p = this.player;
    if (p && dist(p.x, p.z, q.x, q.z) < 1100) return ' <em>She is in sight of you now.</em>';
    const r = this.quarryReport;
    if (!r) return ' <em>Make port and ask after her.</em>';
    const mins = Math.max(0, Math.round((this.time - r.at) / 60));
    const where = r.near ? ` off <b>${r.near}</b>` : '';
    return ` <em>Word in harbour puts her${where}${mins > 0 ? `, ${mins} minutes ago` : ''}.</em>`;
  }

  rumoursAt(port) {
    const out = [];
    const huntQ = this.quests.find(q => q.id === 'hunt_sant');
    if (this.stats.captured + this.stats.sunk >= 1 && huntQ && !huntQ.active && !huntQ.done) {
      out.push({
        title: 'The Long Answer',
        text: 'A brig out of nowhere, black topsides, takes ships between here and the Spine. Her captain keeps a tally cut into the mainmast. They call her Mireya Sant.',
        quest: huntQ,
      });
    } else if (huntQ && huntQ.active) {
      const r = this.quarryReport;
      out.push({ title: 'The Long Answer',
        text: r && r.near
          ? `Working the water off ${r.near}, they say, and in no hurry to leave it. She does not run.`
          : 'Last seen standing east of the Thimbles. She does not run.' });
    }
    if (!this.discovered.has('bellcove')) {
      out.push({ title: 'A Bell Under Water', text: 'Old hands talk about a chapel bell you can hear through the hull off Bellcurrent, away to the north-west. Nobody has ever gone and looked.' });
    }
    if (!this.discovered.has('lighthouse')) {
      out.push({ title: 'The Dead Lantern', text: 'The light on the far eastern stack has been dark two seasons. The keeper was paid through the year.' });
    }
    out.push({ title: 'Shoal Water', text: 'Pale water is thin water. A cutter goes where a frigate opens her bottom — remember that when something bigger is chasing you.' });
    void port;
    return out;
  }
  acceptQuest(q, port) {
    if (!this.quests.includes(q)) this.quests.push(q);
    q.active = true; q.portId = q.portId || port.id;
    if (q.kind === 'hunt' && q.id === 'hunt_sant') this.spawnSant();
    if (q.advance) {
      this.coin += q.advance;
      sfxCoin();
      toast(`${q.title} — ◆${q.advance} advanced against the freight.`, 'gold', 3600);
    } else {
      toast(`Undertaking accepted: ${q.title}`, 'gold', 3200);
    }
    this.refreshObjective();
    this.save();
  }
  questStatus(q) {
    if (q.done) return q.doneText || 'Settled.';
    if (q.kind === 'cargo') {
      const p = PORTS.find(x => x.id === q.toPort);
      const from = PORTS.find(x => x.id === q.fromPort);
      const loaded = q.loaded || 0;
      if (loaded < q.amount) {
        return `Load <b>${q.amount} ${GOODS[q.good].name}</b> at <b>${from ? from.name : 'the contract port'}</b>`
          + ` — ${loaded}/${q.amount} aboard — then carry it to <b>${p.name}</b>.`;
      }
      return `Carry <b>${q.amount} ${GOODS[q.good].name}</b> to <b>${p.name}</b>.`;
    }
    if (q.kind === 'hunt') return `Sink or take <b>${q.targetName}</b>. ${q.progress || 0}/${q.count}`;
    if (q.kind === 'bounty') {
      const t = this.ships.find(x => x.id === q.targetId && x.alive && !x.captured);
      if (!t) return `<b>${q.targetName}</b> is off the water. Report to ${(PORTS.find(pp => pp.id === q.portId) || {}).name || 'the port'}.`;
      return `Bounty on <b>${q.targetName}</b> — ${this.bearingWords(t.x, t.z)}. Sink her or take her.`;
    }
    return q.brief;
  }
  canCompleteHere(q, port) {
    if (q.done || !q.active) return false;
    if (q.kind === 'cargo') {
      return q.toPort === port.id
        && (this.player.cargo[q.good] || 0) >= q.amount
        && (q.loaded || 0) >= q.amount;
    }
    if (q.kind === 'hunt') return (q.progress || 0) >= q.count;
    return false;
  }
  completeQuest(q) {
    const p = this.player;
    if (q.kind === 'cargo') {
      p.cargo[q.good] -= q.amount;
      if (p.cargo[q.good] <= 0) delete p.cargo[q.good];
    }
    q.done = true; q.active = false;
    const balance = Math.max(0, q.reward - (q.advance || 0));
    const got = this.gainCoin(balance);
    const pres = this.gainPrestige(q.prestige);
    // the board where it was written turns over, so the work is never the same twice
    if (q.fromPort) this.contractEpoch[q.fromPort] = (this.contractEpoch[q.fromPort] || 0) + 1;
    this.pruneContracts();
    sfxCoin();
    toast(`${q.title} — settled. ◆${got} on delivery, prestige +${pres}`, 'gold', 4000);
    this.refreshObjective();
    this.save();
  }
  /** Drop contracts nobody took from a board that has since turned over. */
  pruneContracts() {
    this.quests = this.quests.filter(q => {
      if (q.active || q.done || q.kind !== 'cargo') return true;
      const epoch = +(q.id.split(':')[3] || 0);
      return epoch === (this.contractEpoch[q.portId] || 0);
    });
  }

  progressQuest(kind, payload) {
    for (const q of this.quests) {
      if (!q.active || q.done || q.kind !== kind) continue;
      if (kind === 'hunt') {
        if (payload.isSant || payload.name === q.targetName) {
          q.progress = (q.progress || 0) + 1;
          if (q.progress >= q.count) {
            const got = this.gainCoin(q.reward), pres = this.gainPrestige(q.prestige, true);
            q.done = true; q.active = false;
            modal({
              title: 'The Tally is Settled',
              text: `<b>${q.targetName}</b> is finished. The Admiralty pays without argument, which is rarer than the money.<br><br><em>◆${got}</em> and <em>${pres} prestige</em>.<br><br>Word of this will travel further than you think. Captains talk.`,
              actions: [{ label: 'GOOD', cls: 'gold', fn: () => { } }],
            });
            this.refreshObjective();
          } else toast(`${q.title}: ${q.progress}/${q.count}`, 'gold');
        }
      } else if (kind === 'cargo') {
        // delivery is settled at the harbourmaster, not by selling
      }
    }
  }
  spawnSant() {
    if (this.ships.some(s => s.isSant)) return;
    const a = Math.random() * TAU;
    const px = this.player.x + Math.cos(a) * 900, pz = this.player.z + Math.sin(a) * 900;
    const s = new Ship({
      classId: 'brig', faction: 'pirate', name: 'Long Answer', role: 'pirate',
      x: clamp(px, -this.limit * 0.8, this.limit * 0.8), z: clamp(pz, -this.limit * 0.8, this.limit * 0.8),
      yaw: Math.random() * TAU,
      colors: { hull: 0x2f2724, trim: 0x8f2f2a, sail: 0xa89b85, flag: 0x8f2f2a },
    });
    s.isSant = true;
    s.crew.marine += 6; s.crew.veteran += 5; s.crew.gunner += 4;
    this.addShip(s);
  }

  discoverPOI(poi) {
    this.discovered.add(poi.id);
    sfxMusicEvent('discovery');
    this.paused = true;
    let reward = 0, extra = '';
    if (poi.id === 'bellcove') {
      reward = 420;
      this.gainPrestige(8);
      extra = 'Bar silver, a sealed case of pepper, and a ship’s bell with another vessel’s name on it.';
      this.player.cargo.spice = (this.player.cargo.spice || 0) + Math.min(8, this.player.cargoFree);
    } else {
      reward = 260;
      this.gainPrestige(6);
      const o = makeOfficer(9001 + this.discovered.size * 37, 'navigator');
      o.hire = 0;
      this.officers.push(o); this.player.officers.push(o);
      extra = `The keeper is still here, in a manner of speaking — ${o.name} has been living off gull eggs and is very glad to see a sail. They sign on as Navigator.`;
    }
    reward = this.gainCoin(reward);
    sfxBell();
    modal({
      title: poi.title,
      text: `${poi.text}<br><br>${extra}<div class="loot"><span>◆ ${reward}</span><span>★ prestige</span></div>`,
      actions: [{ label: 'MAKE SAIL', cls: 'gold', fn: () => { this.paused = false; } }],
    });
    this.save();
  }
  poiById(id) { return POIS.find(p => p.id === id); }

  refreshObjective() {
    // the story comes first — it is the thread the whole voyage hangs on
    const ch = this.currentChapter;
    if (ch) {
      // the chapter's name over its task, so the objective chip reads as a
      // place in the story rather than an instruction from nowhere
      setObjective(this.chapterText(ch, 'obj') + this.quarryHint(),
        `Chapter ${this.chapter + 1} of ${CHAPTERS.length} · ${this.chapterText(ch, 'title')}`);
      return;
    }
    const q = this.quests.find(x => x.active && !x.done);
    if (q) { setObjective(this.questStatus(q)); return; }
    if (this.prizes.length) {
      setObjective('Your prize is waiting at <b>Ilo Vantu</b>. Dock there, open the <b>SHIPYARD</b>, and give her a captain.');
      return;
    }
    if (!this.hintState.docked) {
      setObjective('Sail to <b>Ilo Vantu</b> and dock. Buy shot and provisions before you go hunting.');
      return;
    }
    if (this.stats.captured === 0) {
      // the step players were getting stuck on: say who, where, and how
      const p = this.player;
      const near = this.ships.find(s => s.alive && s.faction === 'pirate' && !s.captured
        && dist(p.x, p.z, s.x, s.z) < 700);
      if (near) {
        setObjective(`A <b>Tally</b> raider is close — <b>${near.name}</b>. Tap her to mark her, then work up onto her beam and fire.`);
      } else {
        setObjective('Hunt a <b>Tally</b> raider: black hull, red trim, a red flag. Follow the arrow, then <b>tap her</b> to mark her.');
      }
      return;
    }
    if (this.fleet.length > 1) {
      setObjective('Two ships under your flag. Try <b>ENGAGE</b>, and take something bigger than you could alone.');
      return;
    }
    setObjective('Ask after work at the harbourmaster, or a name at the tavern.');
  }

  /* =========================================================
     onboarding hints
     ========================================================= */
  mark(id) { if (!this.hintState[id]) this.hintState[id] = 1; }
  updateHints(dt) {
    this._hintT = (this._hintT || 0) - dt;
    if (this._hintT > 0) return;
    this._hintT = 1.1;
    const H = this.hintState;
    const p = this.player;
    if (isSheetOpen()) return;

    /* The first time she declines to sail the course you set, say why — a ship
       heading 40° off the line you tapped looks like a bug until you know she
       is beating, and then it looks like sailing. */
    if (H.sailed && !H.beatTip && p.tack && p.dest) {
      H.beatTip = 1;
      hint('She cannot sail into the wind’s eye — she is beating up to your mark in legs.', 5600);
    }
    if (H.sailed && !H.windTip && !p.tack) {
      if (p.windFactor(this.windAng) < 0.55 && p.speed > 1) {
        H.windTip = 1;
        hint('You are close to the wind and slow. The rose shows where it blows from.', 5200);
      }
    }
    if (!H.dockTip && this.dockablePort && !H.docked) {
      H.dockTip = 1;
      hint(`Ease your speed inside the buoys and tap <b>DOCK</b>.`, 5000);
    }
    if (H.docked && !H.targetTip) {
      const hostile = this.ships.find(s => s.alive && s.faction === 'pirate' && dist(s.x, s.z, p.x, p.z) < 620);
      if (hostile) { H.targetTip = 1; hint('A Tally sail. <b>Tap her</b> to mark your target.', 5200); }
    }
    if (H.targeted && !H.arcTip) {
      H.arcTip = 1;
      hint('Guns bear on the beam. Turn until FIRE lights, then let fly.', 5600);
    }
    if (H.fired && !H.ammoTip && this.target) {
      if (this.target.sailFrac > 0.55 && this.target.speed > p.speed * 0.9) {
        H.ammoTip = 1;
        hint('She is faster than you. <b>Chain shot</b> will cut her rigging.', 5200);
      }
    }
    if (this.target && !H.boardTip && this.target.sailFrac < 0.45 && this.target.alive) {
      H.boardTip = 1;
      hint('Her rigging is gone. Come alongside, take way off, and <b>BOARD</b>.', 6000);
    }
    if (H.fleet && !H.fleetTip) {
      H.fleetTip = 1;
      hint('Fleet orders are at the bottom of the screen. ENGAGE sets your consort loose.', 5600);
    }
  }
  setQuality(q) {
    this.quality = q;
    setWaterQuality(q);
    this.fx.q = q >= 1 ? 1 : 0.5;
  }
}

/* =========================================================
   upgrades
   ========================================================= */
function applyUpgrades(ship) {
  const cls = HULLS[ship.classId];
  ship.cls = { ...cls };
  ship.hullMax = cls.hull; ship.sailMax = cls.sails;
  ship.gunsMax = Math.max(1, Math.round(cls.guns / 2));
  for (const u of ship.upgrades || []) {
    if (u === 'copper') ship.cls.speed *= 1.08;
    if (u === 'timbers') { ship.hullMax = Math.round(cls.hull * 1.25); }
    if (u === 'ports') { ship.gunsMax += 1; ship.gunsPort = Math.min(ship.gunsMax, ship.gunsPort + 1); ship.gunsStb = Math.min(ship.gunsMax, ship.gunsStb + 1); }
    if (u === 'lockers') ship.cls.cargo = cls.cargo + 20;
    // Greywake: heavy construction and control
    if (u === 'breakwater') ship.hullMax = Math.round(ship.hullMax * 1.18);
    if (u === 'rudder') ship.cls.turn = cls.turn * 1.28;
    // Tideglass: draught and rigging
    if (u === 'reefkeel') ship.cls.draft = cls.draft * 0.66;
    if (u === 'veyrarig') { ship.cls.accel = cls.accel * 1.35; ship.cls.speed *= 1.03; }
  }
  ship.hull = Math.min(ship.hull, ship.hullMax);
}

/* =========================================================
   quest definitions
   ========================================================= */
/* A carrying contract, written for the port you are standing in.
   It always names somewhere else to take the cargo, it has to be loaded
   *here* — buying it at the far end is not carrying, it is shopping — and it
   pays an advance big enough to buy the load, so a captain with an empty
   strongbox can still take work. That last part is what stops a bad run
   turning into a dead voyage. */
function makeCargoQuest(id, market) {
  const bits = id.split(':');                       // cargo:<port>:<slot>:<epoch>
  const from = bits[1] || 'ilovantu';
  const slot = +(bits[2] || 0);
  const epoch = +(bits[3] || 0);
  const fromPort = PORTS.find(p => p.id === from);
  if (!fromPort) return null;
  const rng = makeRNG(from.length * 7919 + slot * 313 + epoch * 97);

  // pick something this port actually sells cheaply, and somewhere that wants it
  const goods = Object.keys(GOODS);
  const scored = goods.map(g => {
    const here = fromPort.prices[g] ?? 1;
    let bestTo = null, bestGap = -9;
    for (const p of PORTS) {
      if (p.id === from) continue;
      const gap = (p.prices[g] ?? 1) - here;
      if (gap > bestGap) { bestGap = gap; bestTo = p; }
    }
    return { g, to: bestTo, gap: bestGap };
  }).filter(x => x.to).sort((a, b) => b.gap - a.gap);
  const pick = scored[Math.min(slot, scored.length - 1)] || scored[0];
  const good = pick.g, toPort = pick.to;

  const amount = rngInt(rng, 8, 18);
  const unit = market ? market.buyPrice(from, good) : GOODS[good].base;
  const leg = dist(fromPort.x, fromPort.z, toPort.x, toPort.z);
  // the fee: what the load costs you, plus a carrying rate on value and distance
  const fee = Math.round(unit * amount * 1.55 + leg * 0.06 * amount / 10 + 90);
  // enough up front to buy the cargo and a few barrels with it
  const advance = Math.round(unit * amount * 1.05 + 40);
  return {
    id, kind: 'cargo', board: 'harbour', portId: from,
    title: `${GOODS[good].name} for ${toPort.name}`,
    brief: `Load ${amount} ${GOODS[good].name} here and carry it to the harbourmaster at ${toPort.name}.`,
    good, amount, fromPort: from, toPort: toPort.id,
    reward: fee, advance, prestige: 4,
    active: false, done: false, progress: 0, loaded: 0,
    doneText: 'Delivered and signed for.',
  };
}

/* A bounty on a hull that is already out there.
 *
 * The reward is her own weight — a fat raider with a full battery is worth
 * more than a tired lugger — and the port's own coin, so a major harbour with
 * something to lose pays better than a fishing village that merely disapproves.
 */
function makeBounty(g, port, ship) {
  const worth = Math.round(strength(ship) * 1.5 + ship.cls.guns * 22 + 120);
  const purse = Math.round(worth * (port.size === 'major' ? 1.25 : 0.9));
  const who = ship.captainName ? `${ship.captainName} of the <i>${ship.name}</i>` : `the <i>${ship.name}</i>`;
  return {
    id: `bounty:${port.id}:${ship.id}`,
    kind: 'bounty', board: 'harbour', portId: port.id,
    targetId: ship.id, targetName: ship.name, faction: port.faction,
    title: `Bounty: ${ship.name}`,
    brief: `${port.name} will pay for ${who} — a ${ship.cls.name} of `
      + `${ship.gunsPort + ship.gunsStb} guns, ${FACTIONS[ship.faction] ? FACTIONS[ship.faction].name : ship.faction}. `
      + `Sink her or take her; taking her pays a quarter more.`,
    reward: purse, prestige: 6 + Math.round(ship.cls.guns * 0.4),
    active: false, done: false, progress: 0,
    doneText: 'The notice comes down.',
  };
}

function makeQuest(id, market) {
  if (id.startsWith('cargo:')) return makeCargoQuest(id, market);
  if (id === 'hunt_sant') {
    return {
      id, kind: 'hunt', board: 'tavern', portId: null,
      title: 'The Long Answer',
      brief: 'Sink or take the brig Long Answer and her captain, Mireya Sant.',
      targetName: 'Long Answer', count: 1, reward: 1400, prestige: 24,
      active: false, done: false, progress: 0,
      doneText: 'The tally is settled.',
    };
  }
  return null;
}

/* ---- firing arcs -----------------------------------------------------
   A wedge that lies *on* the water rather than through it: built flat and
   tessellated, its heights stamped from the wave field every frame. Every
   boundary fades, so what you see is a glow across the reach of the guns,
   not a sheet of glass floating on the sea. */
function arcWedge(r0, r1, start, span, tSeg = 34, rSeg = 10) {
  const pos = [], aR = [], aT = [], idx = [];
  for (let i = 0; i <= rSeg; i++) {
    const fr = i / rSeg, r = r0 + (r1 - r0) * fr;
    for (let j = 0; j <= tSeg; j++) {
      const ft = j / tSeg, a = start + span * ft;
      pos.push(Math.cos(a) * r, 0, -Math.sin(a) * r);
      aR.push(fr); aT.push(ft * 2 - 1);
    }
  }
  const row = tSeg + 1;
  for (let i = 0; i < rSeg; i++) {
    for (let j = 0; j < tSeg; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r1 * 1.5);
  return g;
}
const ARC_VS = /* glsl */`
attribute float aR; attribute float aT;
varying float vR; varying float vT;
void main(){
  vR = aR; vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const ARC_FS = /* glsl */`
precision mediump float;
varying float vR; varying float vT;
uniform vec3 uCol;
uniform float uK;
void main(){
  float ends = 1.0 - smoothstep(0.70, 1.0, abs(vT));            // no hard side edges
  float rim  = smoothstep(0.58, 0.92, vR) * (1.0 - smoothstep(0.92, 1.0, vR));
  float body = (1.0 - smoothstep(0.0, 0.85, vR)) * 0.30;        // faint wash off the beam
  float a = (body + rim * 0.95) * ends * uK;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a);
}`;

/* ---- hunting rings ---------------------------------------------------
   The water a raider is watching. Built like the firing arcs — flat,
   tessellated, heights stamped from the wave field each frame — because a
   ring this wide drawn at a fixed height cuts through every crest it
   crosses. No end-fade here: the band closes on itself, and fading the
   seam would put a gap in it. */
function ringBand(r0, r1, tSeg = 72, rSeg = 2) {
  const pos = [], aR = [], idx = [];
  for (let i = 0; i <= rSeg; i++) {
    const fr = i / rSeg, r = r0 + (r1 - r0) * fr;
    for (let j = 0; j <= tSeg; j++) {
      const a = (j / tSeg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, -Math.sin(a) * r);
      aR.push(fr);
    }
  }
  const row = tSeg + 1;
  for (let i = 0; i < rSeg; i++) {
    for (let j = 0; j < tSeg; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r1 * 1.5);
  return g;
}
const RING_VS = /* glsl */`
attribute float aR;
varying float vR;
void main(){
  vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}`;
const RING_FS = /* glsl */`
precision mediump float;
varying float vR;
uniform vec3 uCol;
uniform float uK;
void main(){
  // soft on both edges, brightest along the middle of the band
  float band = smoothstep(0.0, 0.5, vR) * (1.0 - smoothstep(0.5, 1.0, vR));
  float a = band * uK;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a);
}`;

/* =========================================================
   world markers: destination ping, target ring, port pennants
   ========================================================= */
class Markers {
  constructor(scene) {
    this.scene = scene;
    this.moveRings = [];
    const ringGeo = new THREE.RingGeometry(6, 8.5, 28);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffe6b0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.moveRings.push({ mesh: m, t: 0 });
    }
    const tgeo = new THREE.RingGeometry(1, 1.26, 40);
    tgeo.rotateX(-Math.PI / 2);
    this.targetRing = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({
      color: 0xff7a5c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.targetRing.visible = false;
    this.targetRing.renderOrder = 5;
    scene.add(this.targetRing);

    // broadside arcs — shown only while a target is marked, so exploring stays clean
    this.arcs = new THREE.Group();
    this.arcMats = {};
    for (const side of ['stb', 'port']) {
      const half = 70 * Math.PI / 180;
      const start = side === 'stb' ? -half : Math.PI - half;
      const m = new THREE.ShaderMaterial({
        vertexShader: ARC_VS, fragmentShader: ARC_FS,
        uniforms: { uCol: { value: new THREE.Color(0xe6b25e) }, uK: { value: 0.06 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(arcWedge(26, GUN_RANGE, start, half * 2), m);
      mesh.renderOrder = 4;
      this.arcs.add(mesh);
      this.arcMats[side] = m;
    }
    this.arcs.visible = false;
    scene.add(this.arcs);

    /* Hunting rings: the water each raider is watching, so a fight can be
       steered around instead of blundered into. Pooled, because stamping the
       swell into one costs a few hundred wave lookups a frame. */
    this.hunts = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.ShaderMaterial({
        vertexShader: RING_VS, fragmentShader: RING_FS,
        uniforms: { uCol: { value: new THREE.Color(0xff6a4d) }, uK: { value: 0.0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringBand(GUN_RANGE - 13, GUN_RANGE), m);
      mesh.renderOrder = 4;
      mesh.visible = false;
      scene.add(mesh);
      this.hunts.push({ mesh, mat: m });
    }

    // fighting-weight pips: one shared texture per tier, sprites pooled per ship
    this.pipTex = PIP_TIERS.map(makePip);
    this.pips = new Map();     // ship.id -> Sprite
    this.pipPool = [];

    // port pennants
    this.labels = [];
    for (const p of PORTS) {
      const spr = makeLabel(p.name.toUpperCase(), p.size === 'major' ? '#ffe6b0' : '#dfe9ea');
      // over the town, not over the mooring — a name floating on open water
      // reads as a bug even when the harbour behind it is right
      const at = PORT_SHORE[p.id];
      spr.position.set(at ? at.townX : p.x, at ? at.townY : 74, at ? at.townZ : p.z);
      scene.add(spr);
      this.labels.push({ spr, port: p });
    }
    // grapple lines
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.grappleLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xd9c9a4, transparent: true, opacity: 0.85 }));
    this.grappleLines.visible = false;
    this.grappleLines.frustumCulled = false;
    scene.add(this.grappleLines);
    this.grapplePair = null;
  }

  /** A pip over every ship that is not yours, coloured by how she compares. */
  updatePips(game, p) {
    this._pipT = (this._pipT || 0) - 0.016;
    const RANGE = 1150;
    const live = new Set();
    for (const s of game.ships) {
      if (!s.alive || s.captured || s.isPlayer || game.fleet.includes(s)) continue;
      const d = dist(p.x, p.z, s.x, s.z);
      if (d > RANGE) continue;
      live.add(s.id);
      let spr = this.pips.get(s.id);
      if (!spr) {
        spr = this.pipPool.pop();
        if (!spr) {
          spr = new THREE.Sprite(new THREE.SpriteMaterial({
            transparent: true, depthTest: false, depthWrite: false,
          }));
          spr.renderOrder = 9;
          this.scene.add(spr);
        }
        spr.visible = true;
        this.pips.set(s.id, spr);
      }
      const w = game.weighUp(s);
      if (spr.material.map !== this.pipTex[w.tier]) {
        spr.material.map = this.pipTex[w.tier];
        spr.material.needsUpdate = true;
      }
      const top = (s.mesh.userData.mastTop || s.cls.len * 0.9) + 7;
      spr.position.set(s.x, waveHeight(s.x, s.z) + top, s.z);
      const sc = clamp(d * 0.032, 11, 26);
      spr.scale.set(sc * 2, sc, 1);
      spr.material.opacity = clamp01(1 - (d - RANGE * 0.8) / (RANGE * 0.2)) * 0.92;
    }
    for (const [id, spr] of this.pips) {
      if (live.has(id)) continue;
      spr.visible = false;
      this.pips.delete(id);
      this.pipPool.push(spr);
    }
  }

  pingMove(x, z) {
    const r = this.moveRings.find(r => r.t <= 0) || this.moveRings[0];
    r.t = 1;
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.6, z);
  }
  grapple(a, b) { this.grapplePair = [a, b]; this.grappleLines.visible = true; }
  clearGrapple() { this.grapplePair = null; this.grappleLines.visible = false; }

  update(dt, game) {
    if (!game.player) return;
    for (const r of this.moveRings) {
      if (r.t <= 0) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t -= dt * 0.85;
      const k = 1 - r.t;
      r.mesh.scale.setScalar(0.6 + k * 1.9);
      r.mesh.material.opacity = Math.max(0, r.t * 0.8);
      r.mesh.position.y = waveHeight(r.mesh.position.x, r.mesh.position.z) + 0.5;
      if (r.t <= 0) r.mesh.visible = false;
    }
    const p = game.player;
    const t = game.target;
    // gun arcs follow the flagship whenever there is something to shoot at
    const showArcs = !!(t && t.alive && !t.captured && p.alive);
    this.arcs.visible = showArcs;
    if (showArcs) {
      this.arcs.position.set(p.x, 0, p.z);
      this.arcs.rotation.y = p.yaw;
      const lit = game.fireSide;
      const ready = lit && p.reload[lit] <= 0;
      for (const side of ['stb', 'port']) {
        const on = lit === side;
        this.arcMats[side].uniforms.uK.value = on ? (ready ? 0.24 : 0.13) : 0.05;
        this.arcMats[side].uniforms.uCol.value.setHex(on && ready ? 0xffd27a : 0xe6b25e);
      }
      // Ride the swell: local y is absolute height, the group sits at y = 0.
      // The clearance matters — the sea is drawn from a 22-unit grid, so its
      // rendered surface sits up to a wave-crest below the true one; hug it any
      // closer and the water saws the arc into shards.
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      for (const mesh of this.arcs.children) {
        const attr = mesh.geometry.attributes.position, a = attr.array;
        for (let i = 0; i < a.length; i += 3) {
          const lx = a[i], lz = a[i + 2];
          a[i + 1] = waveHeight(p.x + lx * cy + lz * sy, p.z - lx * sy + lz * cy) + 1.5;
        }
        attr.needsUpdate = true;
      }
    }
    /* The water a ship that is coming for you can actually shoot into.
       An 820-unit ring drawn round every raider who *might* take an interest
       covered half the horizon and told you nothing you could steer by. This
       is her gun range, and it only appears once she has picked you — so the
       circle answers the one question worth asking: if I hold this course,
       does she get a shot? Ships that would hunt you but have not committed
       stay off the water; the fighting-weight pip over the mast is what warns
       you about those. */
    const hunters = [];
    for (const s of game.ships) {
      if (s.isPlayer || game.fleet.includes(s)) continue;
      if (!s.alive || s.captured) continue;
      if (s.target !== p) continue;              // she has to be coming for you
      const d = dist(s.x, s.z, p.x, p.z);
      if (d > GUN_RANGE * 3.5) continue;         // and near enough to matter
      hunters.push({ s, d });
    }
    hunters.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.hunts.length; i++) {
      const h = this.hunts[i], hunter = hunters[i];
      if (!hunter) { h.mesh.visible = false; continue; }
      const { s, d } = hunter;
      h.mesh.visible = true;
      h.mesh.position.set(s.x, 0, s.z);
      // inside her guns it pulses; outside it is a quiet line you can stay off
      const inside = d < GUN_RANGE;
      h.mat.uniforms.uK.value = inside ? 0.34 + 0.12 * Math.sin(game.time * 4) : 0.20;
      h.mat.uniforms.uCol.value.setHex(inside ? 0xff7d55 : 0xd8734f);
      const attr = h.mesh.geometry.attributes.position, a = attr.array;
      for (let k = 0; k < a.length; k += 3) {
        a[k + 1] = waveHeight(s.x + a[k], s.z + a[k + 2]) + 1.5;
      }
      attr.needsUpdate = true;
    }

    if (t && t.alive && !t.captured) {
      this.targetRing.visible = true;
      const s = t.cls.len * 0.72;
      this.targetRing.scale.setScalar(s);
      this.targetRing.position.set(t.x, waveHeight(t.x, t.z) + 0.7, t.z);
      this.targetRing.rotation.y += dt * 0.6;
      this.targetRing.material.opacity = 0.55 + 0.35 * Math.sin(game.time * 3);
    } else this.targetRing.visible = false;

    this.updatePips(game, p);

    // pennant labels fade with distance
    for (const l of this.labels) {
      const d = dist(p.x, p.z, l.port.x, l.port.z);
      const vis = d > 120 && d < 1500;
      l.spr.visible = vis;
      if (vis) {
        const k = clamp01(1 - (d - 1200) / 300) * clamp01((d - 120) / 120);
        l.spr.material.opacity = 0.35 + k * 0.55;
        const sc = clamp(d * 0.055, 22, 90);
        l.spr.scale.set(sc * 3.4, sc, 1);
      }
    }

    if (this.grapplePair) {
      const [a, b] = this.grapplePair;
      const arr = this.grappleLines.geometry.attributes.position.array;
      for (let i = 0; i < 3; i++) {
        const t2 = (i - 1) * 0.3;
        const ax = a.x + Math.sin(a.yaw) * a.cls.len * t2, az = a.z + Math.cos(a.yaw) * a.cls.len * t2;
        const bx = b.x + Math.sin(b.yaw) * b.cls.len * t2, bz = b.z + Math.cos(b.yaw) * b.cls.len * t2;
        arr[i * 6] = ax; arr[i * 6 + 1] = waveHeight(ax, az) + 3.5; arr[i * 6 + 2] = az;
        arr[i * 6 + 3] = bx; arr[i * 6 + 4] = waveHeight(bx, bz) + 3.5; arr[i * 6 + 5] = bz;
      }
      this.grappleLines.geometry.attributes.position.needsUpdate = true;
    }
  }
}

/* ---------- fighting-weight pips ----------
   Five tiers, drawn once and shared. Chevrons rather than words: they stay
   legible at the size a ship half a mile off deserves on a phone screen. */
const PIP_TIERS = [
  { glyph: '▼▼', col: '#7fe08d', ring: 'rgba(127,224,141,.75)' },
  { glyph: '▼', col: '#b9dd85', ring: 'rgba(185,221,133,.7)' },
  { glyph: '●', col: '#eccb76', ring: 'rgba(236,203,118,.7)' },
  { glyph: '▲', col: '#f0a071', ring: 'rgba(240,160,113,.75)' },
  { glyph: '▲▲', col: '#f2705f', ring: 'rgba(242,112,95,.85)' },
];
function makePip(tier) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const r = 18;
  g.beginPath();
  g.moveTo(14 + r, 10); g.arcTo(114, 10, 114, 54, r); g.arcTo(114, 54, 14, 54, r);
  g.arcTo(14, 54, 14, 10, r); g.arcTo(14, 10, 114, 10, r); g.closePath();
  g.fillStyle = 'rgba(8,20,27,.78)';
  g.fill();
  g.strokeStyle = tier.ring; g.lineWidth = 2.5; g.stroke();
  g.font = '700 30px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = tier.col;
  g.fillText(tier.glyph, 64, 33);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function makeLabel(text, color = '#ffe6b0') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 150;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = '600 62px ui-serif, Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 18;
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fillText(text, 256, 84);
  g.shadowBlur = 10;
  g.fillStyle = color;
  g.fillText(text, 256, 84);
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(230,178,94,.55)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(150, 26); g.lineTo(362, 26); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.8 });
  const s = new THREE.Sprite(m);
  s.renderOrder = 8;
  return s;
}

export { GUN_RANGE, BOARD_RANGE };
