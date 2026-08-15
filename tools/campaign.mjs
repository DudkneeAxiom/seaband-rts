/* The campaign / encounter / battle spine.

   The three layers and every road between them, driven through the real game.
   Nothing here sets `mode` by hand: a raider is put on the water and told to
   hunt, and the chase, the contact, the encounter and the battle all happen
   because the systems made them happen. The only staging is placing ships and
   choosing the matchup — which is what a scenario is.

   Where an outcome is a roll, the scenario is stacked until the roll is
   lopsided and the check is "at least one of N", rather than pinned to a mean
   that will fail the first unlucky time. */
import { launch, sleep, ff, shot, newVoyage, waitFor, dismissModal, intoBattle, leaveBattle } from './qa.mjs';

const vp = process.argv[2] || 'phone';
const { browser, page, errors } = await launch(vp);
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);
await dismissModal(page);

/* ---------------------------------------------------------------
   Staging: a raider, out in open water, who wants you
   --------------------------------------------------------------- */

/** Put the player somewhere clear and give one hostile a reason to close. */
const stage = (opts = {}) => G(o => {
  const g = window.__game, p = g.player;
  // clear of any harbour, or she sheers off under the guns and never arrives
  p.x = 120; p.z = 60; p.dest = null; p.speed = 0; p.throttle = 0;
  p.hull = p.hullMax; p.sails = p.sailMax; p.shot = 200; p.provisions = 90;
  p.alive = true; p.hungry = 0;
  // everyone else out of the way, so the scenario is the two of us
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.x = 9e4; s.z = 9e4; s.target = null; s.hostileToPlayer = false; s.chaseHold = 0;
  }
  let hunter = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !hunter; i++) hunter = g.spawnNPC('pirate');
  hunter.x = p.x + (o.dist || 260); hunter.z = p.z + 40;
  hunter.hull = hunter.hullMax; hunter.sails = hunter.sailMax * (o.theirSails ?? 1);
  hunter.hostileToPlayer = true; hunter.target = p; hunter.aggro = 40;
  hunter.chaseHold = 0; hunter.fleeing = false;
  hunter.brain = { state: 'hunt', t: 0, cooldown: 0 };
  g.encounterCooling = 0;
  g.paused = false;
  return { hunter: hunter.name, cls: hunter.cls.name };
}, opts);

/** Let the world run until she is aboard us, or give up. */
const untilContact = async (max = 70) => {
  for (let i = 0; i < max; i++) {
    await ff(page, 1);
    if (await G(() => window.__game.mode !== 'campaign')) return true;
  }
  return false;
};

/* ---------------------------------------------------------------
   1 · she starts hunting, and the HUD says so
   --------------------------------------------------------------- */
await stage({ dist: 420 });
await ff(page, 6);
// ff() runs the simulation, not the renderer: the panel appears on a real frame
await waitFor(page, () => {
  const box = document.getElementById('pursuit');
  return !box.classList.contains('hidden')
    && document.getElementById('pur-name').textContent !== '—';
}, 14000);
const pur = await G(() => {
  const g = window.__game;
  return {
    mode: g.mode,
    has: !!g.pursuit,
    dist: g.pursuit && g.pursuit.dist,
    shown: !document.getElementById('pursuit').classList.contains('hidden'),
    name: document.getElementById('pur-name').textContent,
  };
});
ok(`a raider on your heel is reported (${pur.name} at ${pur.dist}m)`,
  pur.mode === 'campaign' && pur.has && pur.shown && pur.dist > 0);

// and she is actually closing, not merely present
await ff(page, 14);
const closing = await G(d0 => {
  const g = window.__game;
  return { d: g.pursuit && g.pursuit.dist, gaining: g.pursuit && g.pursuit.gaining, was: d0 };
}, pur.dist);
ok(`and the gap is closing (${closing.was}m -> ${closing.d}m, reported ${closing.gaining ? 'gaining' : 'not gaining'})`,
  closing.d < closing.was && closing.gaining);
await shot(page, `cm-pursuit-${vp}`);

/* ---------------------------------------------------------------
   2 · nobody opens fire on the campaign layer
   --------------------------------------------------------------- */
const noGuns = await G(() => {
  const g = window.__game;
  return {
    shots: g.projectiles.list.length + g.projectiles.pending.length,
    fireSide: g.fireSide, boardable: g.boardable, live: g.ctx.combatLive,
    hull: g.player.hullFrac,
  };
});
ok('no shot is fired on the campaign layer, however close she is',
  noGuns.shots === 0 && !noGuns.live && !noGuns.fireSide && noGuns.hull === 1);

/* Nor by your own consorts, which is the half this used to miss. The rule
   asked only whether the *target* sailed under your flag, so it stopped
   anyone shooting at you and said nothing about your ships shooting out —
   a consort under ENGAGE opened up on a marked enemy in open water and
   started the action before the encounter had asked whether you wanted one. */
const consortGuns = await G(() => {
  const g = window.__game, p = g.player;
  let con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !con; i++) con = g.spawnNPC('merchant');
  con.faction = 'player'; con.role = 'consort'; con.isPlayer = false;
  con.hostileToPlayer = false; con.fleeing = false; con.chaseHold = 0;
  con.formSlot = 1; con.shot = 90;
  con.x = p.x + 30; con.z = p.z + 20;
  g.fleet.push(con);
  g.setFleetOrder('engage', true);
  // a hostile squarely inside her arc, and marked, which is what she acts on
  let foe = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !foe; i++) foe = g.spawnNPC('pirate');
  foe.x = con.x + 60; foe.z = con.z;
  foe.hostileToPlayer = true; foe.chaseHold = 0; foe.fleeing = false;
  g.selectTarget(foe);
  g.encounterCooling = 900;      // hold the campaign layer while we watch
  const before = g.projectiles.list.length + g.projectiles.pending.length;
  for (let i = 0; i < 240; i++) g.update(1 / 30);
  return {
    fired: (g.projectiles.list.length + g.projectiles.pending.length) - before,
    order: con.fleetOrder, mode: g.mode, boarding: g.boardings.length,
    foeHull: +foe.hullFrac.toFixed(2),
  };
});
ok(`nor do your consorts, however you have set them (order ${consortGuns.order}, `
  + `${consortGuns.fired} shots, her hull ${consortGuns.foeHull})`,
consortGuns.fired === 0 && consortGuns.foeHull === 1 && consortGuns.boarding === 0);
await G(() => {
  const g = window.__game;
  g.setFleetOrder('follow', true);
  for (const s of g.fleet.slice(1)) {
    const i = g.fleet.indexOf(s);
    if (i > 0) g.fleet.splice(i, 1);
    s.faction = 'freehold'; s.role = 'merchant';
    s.x = 9e4; s.z = 9e4;
  }
  g.clearTarget();
  g.encounterCooling = 0;
});

/* ---------------------------------------------------------------
   3 · contact stops the world and asks
   --------------------------------------------------------------- */
const made = await untilContact();
const enc = await G(() => {
  const g = window.__game;
  return {
    mode: g.mode,
    open: !document.getElementById('encounter').classList.contains('hidden'),
    title: document.getElementById('enc-title').textContent,
    opts: [...document.querySelectorAll('.enc-opt')].map(b => b.dataset.opt),
    gauge: g.encounter && g.encounter.gauge,
    paused: g.paused,
  };
});
ok(`physical contact raises an encounter ("${enc.title}")`,
  made && enc.mode === 'encounter' && enc.open);
ok(`it offers a choice (${enc.opts.join(', ')})`,
  enc.opts.includes('fight') && enc.opts.includes('flee'));
ok('and the campaign is held while it is up', enc.paused);
await shot(page, `cm-encounter-${vp}`);

/* ---------------------------------------------------------------
   4 · a good runner gets away
   --------------------------------------------------------------- */
/* Stacked, not fixed: a sound cutter against a lugger with her rigging shot
   to pieces. The odds are read off the real function before trusting them. */
let escaped = false, bestChance = 0;
for (let attempt = 0; attempt < 5 && !escaped; attempt++) {
  await G(() => { const g = window.__game; if (g.mode === 'encounter') g.closeEncounter(); });
  /* Cut her rigging to a third — enough that a sound cutter walks away from
     her, not so much that she counts as crippled and gives up the chase
     entirely, which is what 12% did and why she sailed off instead. */
  await stage({ dist: 150, theirSails: 0.34 });
  await untilContact();
  const c = await G(() => {
    const g = window.__game;
    if (g.mode !== 'encounter') return null;
    return window.__enc.fleeChance(g, g.encounter).chance;
  });
  if (c != null) bestChance = Math.max(bestChance, c);
  const r = await G(() => {
    const g = window.__game;
    if (g.mode !== 'encounter') return null;
    return g.chooseEncounter('flee');
  });
  if (r && r.escaped) escaped = true;
  if (await G(() => window.__game.mode) === 'battle') {
    await G(() => { const g = window.__game; if (g.battle) g.battle.finish('fled'); });
    await sleep(200);
    await G(() => { const g = window.__game; g.paused = false; });
  }
}
ok(`a fast ship against cut rigging can run (best odds ${Math.round(bestChance * 100)}%)`,
  escaped && bestChance > 0.7);
const away = await G(() => ({ mode: window.__game.mode, cooling: window.__game.encounterCooling > 0 }));
ok('and getting clear hands the campaign back', away.mode === 'campaign');

/* ---------------------------------------------------------------
   5 · a bad runner is caught, and the battle starts against her
   --------------------------------------------------------------- */
let cutOff = false, worstChance = 1;
for (let attempt = 0; attempt < 5 && !cutOff; attempt++) {
  await G(() => {
    const g = window.__game;
    if (g.mode === 'encounter') g.closeEncounter();
    if (g.mode === 'battle') g.battle.finish('fled');
    g.paused = false;
    // rigging in ribbons: she is not outrunning anything
    g.player.sails = g.player.sailMax * 0.06;
  });
  await stage({ dist: 150 });
  await G(() => { window.__game.player.sails = window.__game.player.sailMax * 0.06; });
  await untilContact();
  const c = await G(() => {
    const g = window.__game;
    if (g.mode !== 'encounter') return null;
    return window.__enc.fleeChance(g, g.encounter).chance;
  });
  if (c != null) worstChance = Math.min(worstChance, c);
  const r = await G(() => {
    const g = window.__game;
    if (g.mode !== 'encounter') return null;
    return g.chooseEncounter('flee');
  });
  if (r && r.escaped === false) cutOff = true;
}
const cut = await G(() => ({ mode: window.__game.mode, fled: window.__game.battle && window.__game.battle.enc.fledAndFailed }));
ok(`a ship with no canvas is run down (worst odds ${Math.round(worstChance * 100)}%)`,
  cutOff && worstChance < 0.35);
ok('a failed run goes straight into the action, and she knows it',
  cut.mode === 'battle' && cut.fled);

/* ---------------------------------------------------------------
   6 · the battle instance holds only the fight
   --------------------------------------------------------------- */
/* Drive the clock rather than waiting on one. The HUD redraws off the render
   loop, and `dt` is clamped to 0.1 to survive a tab switch — so on a runner
   rendering software GL at a couple of frames a second, wall-clock seconds
   buy very little simulation, and an eight-second wait can expire before the
   chrome has caught up. ff() advances the sim itself and cannot be starved.
   The frames after it are only so the DOM reflects what the sim now says. */
await ff(page, 1);
await waitFor(page, () => !document.getElementById('battlebar').classList.contains('hidden')
  && document.getElementById('objective').classList.contains('hidden'), 15000);
const inst = await G(() => {
  const g = window.__game, b = g.battle;
  return {
    mode: g.mode, live: g.ctx.combatLive,
    ships: g.ships.length, benched: b.benched.length,
    kind: b.kind.id,
    enemies: b.enemies.length, allies: b.allies.length,
    barUp: !document.getElementById('battlebar').classList.contains('hidden'),
    objectiveHidden: document.getElementById('objective').classList.contains('hidden'),
  };
});
ok(`the fight is instanced (${inst.ships} sail in it, ${inst.benched} benched, ${inst.kind} water)`,
  inst.mode === 'battle' && inst.benched > 0 && inst.ships === inst.enemies + inst.allies);
ok(`guns are live inside it and the campaign chrome is gone (guns ${inst.live ? 'live' : 'cold'}, `
  + `bar ${inst.barUp ? 'up' : 'down'}, objective ${inst.objectiveHidden ? 'hidden' : 'showing'})`,
inst.live && inst.barUp && inst.objectiveHidden);
await shot(page, `cm-battle-${vp}`);

/* ---------------------------------------------------------------
   7 · you can break off once it has begun
   --------------------------------------------------------------- */
const ranFor = await G(() => {
  const g = window.__game, b = g.battle, p = g.player;
  /* You cannot run from a ship that matches your speed, which is the whole
     argument for chain shot. Take that as read here — her rigging is cut —
     and test the thing this check is about: that the boundary works. */
  for (const e of b.enemies) e.sails = e.sailMax * 0.08;
  p.sails = p.sailMax;
  const away = Math.atan2(p.x - b.x, p.z - b.z);
  g.commandMove(b.x + Math.sin(away) * 1100, b.z + Math.cos(away) * 1100);
  return { r: Math.round(Math.hypot(p.x - b.x, p.z - b.z)) };
});
let broke = false;
for (let i = 0; i < 110 && !broke; i++) {
  await ff(page, 1.5);
  broke = await G(() => {
    const g = window.__game;
    if (g.mode !== 'battle') return true;
    const b = g.battle, p = g.player;
    const away = Math.atan2(p.x - b.x, p.z - b.z);
    g.commandMove(b.x + Math.sin(away) * 1100, b.z + Math.cos(away) * 1100);
    return false;
  });
}
/* If she did not get out, say what was holding her: the boundary, the enemy
   close aboard, or her own canvas. A bare "did not escape" explains nothing. */
const stuck = broke ? null : await G(() => {
  const g = window.__game, b = g.battle, p = g.player;
  if (!b) return { note: 'battle already over' };
  return {
    fromCentre: Math.round(Math.hypot(p.x - b.x, p.z - b.z)), need: 640,
    nearestEnemy: Math.round(Math.min(...b.enemies.map(e => Math.hypot(e.x - p.x, e.z - p.z)))),
    armed: b.escapeArmed, speed: +p.speed.toFixed(1), sails: +p.sailFrac.toFixed(2),
    boarding: !!p.boarding, throttle: p.throttle,
    /* Aground is the one that reads as "she simply will not move", and it is
       invisible from every other number here. */
    depth: +window.__terrain.heightAt(p.x, p.z).toFixed(1), draft: +p.draft.toFixed(1),
    wind: +p.windFactor(g.windAng).toFixed(2),
  };
});
const outcome = await G(() => ({
  mode: window.__game.mode,
  open: !document.getElementById('encounter').classList.contains('hidden'),
  title: document.getElementById('enc-title').textContent,
  ships: window.__game.ships.length,
}));
ok(`sailing out of the action ends it ("${outcome.title}", from ${ranFor.r}m${stuck ? ', stuck ' + JSON.stringify(stuck) : ''})`,
  broke && outcome.mode === 'campaign');
ok('and the world comes back with it', outcome.ships > 2 && outcome.open);
await shot(page, `cm-result-${vp}`);
await G(() => { const g = window.__game; g.paused = false; });
await page.click('.enc-opt[data-opt="done"]').catch(() => {});
await sleep(300);

/* ---------------------------------------------------------------
   8 · beating her ends it too, and the world is whole afterwards
   --------------------------------------------------------------- */
await stage({ dist: 150 });
await G(() => {
  // half-beaten already: this check is about the action closing and the world
  // coming back, not about how long a even fight takes to settle
  const g = window.__game;
  const h = g.ships.find(s => s.hostileToPlayer && s.alive && !g.fleet.includes(s));
  if (h) h.hull = h.hullMax * 0.45;
});
await untilContact();
/* Counted either side of this one transition. Measuring across the whole
   suite counted the staging instead: ships parked at 9e4 to get them out of a
   scenario are culled as too distant, which is the world working correctly. */
/* Live hulls, not raw entries. A wreck still going down somewhere else is
   benched with everyone else and deliberately not handed back — "a hull that
   went down during it simply is not there" — so counting her before and not
   after reads as the world losing a ship when it has only lost a wreck. */
const worldBefore = await G(() => ({
  ships: window.__game.ships.filter(s => s.alive).length,
}));
await G(() => { const g = window.__game; if (g.mode === 'encounter') g.chooseEncounter('fight'); });
await waitFor(page, () => window.__game.mode === 'battle', 6000);
let ended = false;
for (let i = 0; i < 200 && !ended; i++) {
  await ff(page, 1.2);
  ended = await G(() => {
    const g = window.__game;
    if (g.mode !== 'battle') return true;
    // mode says battle but there is no battle: nothing left to press, stop
    if (!g.battle) return true;
    const t = g.battle.enemies[0];
    if (t) {
      /* Run her down and keep hitting — the bounded road to the action
         ending. The first driver here stopped pressing when she fled and
         waited for the routed rule's 320m, which is correct behaviour but
         unbounded: a ship whose canvas the fight shot away crawls, and
         crawling 320m can take longer than this suite has. Roughly one run
         in four did exactly that. Sinking her is the captain's other road
         to the same rule, and the guns bound it. */
      const p = g.player;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      const b = Math.atan2(t.x - p.x, t.z - p.z);
      p.throttle = 1;
      p.setHeading(d > 230 ? b : b + Math.PI / 2);
      p.ammo = 'round';
      if (g.fireSide && p.reload[g.fireSide] <= 0) g.playerFire();
    }
    return false;
  });
}
const won = await G(() => ({
  mode: window.__game.mode,
  enemy: window.__game.battle && window.__game.battle.enemies[0]
    ? (e => `${e.name} hull ${Math.round(e.hullFrac * 100)}% ${e.fleeing ? 'fleeing' : 'fighting'} `
      + `${Math.round(Math.hypot(e.x - window.__game.player.x, e.z - window.__game.player.z))}m off`)(window.__game.battle.enemies[0])
    : 'none left',
  ships: window.__game.ships.filter(s => s.alive).length,
  sunk: window.__game.battleLastSunk || 0,
  title: document.getElementById('enc-title').textContent,
  alive: window.__game.player.alive,
}));
ok(`fighting her out ends the action (${ended ? 'ended' : 'still running'}, ${won.mode}, ${won.enemy})`,
  ended && won.mode === 'campaign' && won.alive);
ok(`and the campaign world is whole again (${worldBefore.ships} sail before, ${won.ships} after, ${won.sunk} sunk)`,
  won.ships === worldBefore.ships - won.sunk);

/* ---------------------------------------------------------------
   9 · position and state survive the round trip
   --------------------------------------------------------------- */
const kept = await G(() => {
  const g = window.__game;
  return {
    coin: Math.round(g.coin), chapter: g.chapter, mode: g.mode,
    x: Math.round(g.player.x), z: Math.round(g.player.z),
    live: g.ctx.combatLive, battle: !!g.battle, target: !!g.target,
  };
});
ok(`you come back where the fight was (${kept.x},${kept.z}) with the campaign in hand`,
  kept.mode === 'campaign' && !kept.live && !kept.battle && Number.isFinite(kept.x));

/* ---------------------------------------------------------------
   10 · a fleet goes in together
   --------------------------------------------------------------- */
await G(() => { const g = window.__game; g.paused = false; });
await page.click('.enc-opt[data-opt="done"]').catch(() => {});
await sleep(300);
const fleet = await G(() => {
  const g = window.__game, p = g.player;
  // take a consort the honest way: beat her and commission her
  g.coin = 6000;
  p.crew.marine += 16; p.crew.veteran += 8;
  let prize = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s)) || g.spawnNPC('pirate');
  for (let i = 0; i < 80 && !g.boardings.length; i++) {
    prize.x = p.x + 20; prize.z = p.z; prize.speed = 0; prize.yaw = p.yaw;
    prize.hull = prize.hullMax * 0.4;
    prize.crew = { deckhand: 2, sailor: 1, gunner: 0, marine: 0, rigger: 0, veteran: 0 };
    p.speed = 0; p.dest = null;
    g.startBoarding(p, prize);
    g.update(0.1);
  }
  for (let i = 0; i < 900 && g.boardings.length; i++) g.update(0.1);
  return { beaten: !!prize.captured };
});
if (fleet.beaten) {
  await waitFor(page, () => !document.getElementById('modal').classList.contains('hidden'), 8000);
  await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#modal-actions .btn')];
    (bs.find(b => b.textContent.startsWith('GIVE HER TO')) || bs[0]).click();
  });
  await sleep(600);
  await dismissModal(page);
}
const fleetN = await G(() => window.__game.fleet.length);
await stage({ dist: 150 });
await untilContact();
await G(() => { const g = window.__game; if (g.mode === 'encounter') g.chooseEncounter('fight'); });
await waitFor(page, () => window.__game.mode === 'battle', 6000);
/* Guarded. A battle can finish between the poll above and this read — a
   short action against one beaten raider does — and an unguarded b.allies
   then threw, which took the whole suite down and explained nothing. A check
   that cannot reach its subject should say so and fail alone. */
const fb = await G(() => {
  const g = window.__game, b = g.battle;
  if (!b) return { none: true, mode: g.mode, fleet: g.fleet.length, order: g.fleetOrder };
  return { allies: b.allies.length, ships: g.ships.length, fleet: g.fleet.length, order: g.fleetOrder };
});
ok(`a fleet of ${fleetN} goes into action together (${fb.none
  ? `no action to read: mode ${fb.mode}` : `${fb.allies} under your flag on the water`})`,
fleetN < 2 || (!fb.none && fb.allies === fleetN));
ok('and the consorts are told to engage', fleetN < 2 || fb.order === 'engage');
await shot(page, `cm-fleet-${vp}`);

/* ---------------------------------------------------------------
   10b · falling back off the rail is a real way out
   --------------------------------------------------------------- */
const rail = await G(() => {
  const g = window.__game, p = g.player;
  p.crew = { deckhand: 4, sailor: 6, gunner: 3, marine: 5, rigger: 2, veteran: 3 };
  const t = (g.battle && g.battle.enemies[0]) || g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s));
  if (!t) return null;
  t.x = p.x + 16; t.z = p.z; t.yaw = p.yaw; t.speed = 0; p.speed = 0; p.dest = null;
  t.crew = { deckhand: 6, sailor: 8, gunner: 2, marine: 4, rigger: 1, veteran: 2 };
  g.startBoarding(p, t);
  const b = g.boardings[0];
  if (!b) return null;
  b.stance = 'fallback';
  // give it long enough for the grapples to come free
  for (let i = 0; i < 400 && !b.done; i++) g.update(0.1);
  return { result: b.result, captured: !!t.captured, free: !p.boarding };
});
ok(`falling back can get you off her rail (${rail && rail.result})`,
  !rail || (rail.result === 'broken' ? !rail.captured && rail.free : true));
ok('and the boarding card offers the choice at all',
  await G(() => {
    const g = window.__game, p = g.player;
    const t = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s) && !s.boarding);
    if (!t) return true;
    t.x = p.x + 16; t.z = p.z; t.yaw = p.yaw; t.speed = 0; p.speed = 0;
    g.startBoarding(p, t);
    const ok2 = [...document.querySelectorAll('.brd-act')].length >= 3;
    const b = g.boardings[0];
    if (b) { b.stance = 'fallback'; for (let i = 0; i < 400 && !b.done; i++) g.update(0.1); }
    return ok2;
  }));

/* ---------------------------------------------------------------
   11 · the save is never written from inside a battle
   --------------------------------------------------------------- */
/* The action from section 10 does not always live this long: the boarding
   checks above run the better part of a minute of simulation, and a capture
   that empties the instance ends the battle by itself — correctly. This check
   needs a battle to refuse from, so when the last one has settled, get back
   into one the real way rather than assuming it held. */
if (!await G(() => window.__game.mode === 'battle')) {
  // a won action can queue more than one card, and contact waits on them all
  for (let i = 0; i < 5 && await dismissModal(page); i++);
  await G(() => {
    const g = window.__game;
    if (g.mode === 'encounter') g.closeEncounter();
    document.getElementById('encounter').classList.add('hidden');
    g.paused = false;
  });
  await intoBattle(page);
}
const saveGuard = await G(() => {
  const g = window.__game;
  const before = localStorage.getItem('salt-and-tally-v1');
  g.save();
  const after = localStorage.getItem('salt-and-tally-v1');
  /* Say which half failed. "13 sail in the instance" is equally what you get
     when the guard leaks and when the battle ended before the check arrived —
     different bugs, and the count alone cannot tell them apart. */
  return { same: before === after, inBattle: g.mode === 'battle',
    mode: g.mode, battle: !!g.battle, ships: g.ships.length,
    roster: g.ships.map(s => `${s.name}${s.isPlayer ? '*' : ''}(${s.faction})`).join(' ') };
});
ok(`a battle cannot overwrite the save with a benched world (${saveGuard.ships} sail, `
  + `mode ${saveGuard.mode}, save ${saveGuard.same ? 'refused' : 'WRITTEN'})`,
saveGuard.inBattle && saveGuard.same);
if (!(saveGuard.inBattle && saveGuard.same)) console.log('  roster:', saveGuard.roster);

/* ---------------------------------------------------------------
   12 · out of the battle, and a save/load round trip still works
   --------------------------------------------------------------- */
/* Guarded like the rest: a fleet action can end on its own between the
   check above and this teardown, and a throw here takes the suite down. */
await G(() => { const g = window.__game; if (g.battle) g.battle.finish('fled'); });
await sleep(400);
await G(() => { const g = window.__game; g.paused = false; g.save(); });
const pre = await G(() => {
  // read what is actually on disk, not what is in memory: a check that cannot
  // say what was in the save has nothing useful to report when it fails
  let stored = null;
  try { stored = Math.round(JSON.parse(localStorage.getItem('salt-and-tally-v1')).coin); } catch (e) { stored = 'none'; }
  return {
    coin: Math.round(window.__game.coin), fleet: window.__game.fleet.length,
    mode: window.__game.mode, stored,
  };
});
await page.reload({ waitUntil: 'networkidle' });
await waitFor(page, () => !document.getElementById('btn-continue').classList.contains('hidden'), 9000);
await page.click('#btn-continue');
await waitFor(page, () => !!window.__game && !!window.__game.player
  && document.getElementById('title').classList.contains('hidden'), 9000);
const post = await G(() => ({
  coin: Math.round(window.__game.coin), fleet: window.__game.fleet.length,
  mode: window.__game.mode, live: window.__game.ctx.combatLive, ships: window.__game.ships.length,
}));
ok(`a voyage that has been in action round-trips (${JSON.stringify(pre)} -> ${JSON.stringify(post)})`,
  post.coin === pre.stored && post.fleet === pre.fleet);
ok(`and reloads onto the campaign layer with a whole world (${post.mode}, guns ${post.live ? 'live' : 'cold'}, ${post.ships} sail)`,
  post.mode === 'campaign' && !post.live && post.ships > 2);

/* ---------------------------------------------------------------
   13 · and the player can start one himself

   Every other scenario here stages a raider who is already hunting, which is
   how the one road nobody was testing stayed broken for a fortnight: contact
   asked only whether *she* meant it, so a Tally busy with somebody else —
   not hunting you, not flagged hostile to you — could be sailed clean
   through, and the chapter that says to go and put one down could not be
   finished. She is deliberately uninterested here: far weaker than you, so
   her own prey-picking rejects you and she cannot drift into hostility and
   pass this for the wrong reason.
   --------------------------------------------------------------- */
const quarry = await G(() => {
  const g = window.__game, p = g.player;
  p.x = 120; p.z = 60; p.dest = null; p.speed = 0; p.throttle = 0;
  p.hull = p.hullMax; p.sails = p.sailMax; p.alive = true; p.shot = 200;
  p.crew.marine += 14; p.crew.veteran += 10;        // plainly not worth her trouble
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.x = 9e4; s.z = 9e4; s.target = null; s.hostileToPlayer = false; s.chaseHold = 0;
  }
  let t = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !t; i++) t = g.spawnNPC('pirate');
  t.x = p.x + 190; t.z = p.z;
  t.hull = t.hullMax;
  /* Loitering, not running: two cutters at the same speed never close, so a
     pursuit test against full canvas measures nothing but the fact that
     equals cannot catch each other. */
  t.sails = t.sailMax * 0.3;
  t.hostileToPlayer = false; t.target = null; t.aggro = 0;
  t.chaseHold = 0; t.fleeing = false;
  t.brain = { state: 'idle', t: 0, cooldown: 0 };
  for (const k of ['marine', 'veteran', 'gunner']) t.crew[k] = 0;
  g.encounterCooling = 0; g.paused = false;
  return { name: t.name };
});
/* Marked once, and nothing else. The helm is supposed to do the chasing from
   there — that is the whole of the gesture, and re-pointing her by hand every
   second would test the harness rather than the game. */
const gap0 = await G(() => {
  const g = window.__game, p = g.player;
  const t = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s)
    && Math.hypot(s.x - p.x, s.z - p.z) < 1400);
  if (t) g.selectTarget(t);
  return t ? Math.round(Math.hypot(t.x - p.x, t.z - p.z)) : -1;
});
const brought = await untilContact(90);
const how = await G(() => {
  const g = window.__game;
  if (g.mode !== 'encounter' || !g.encounter) return null;
  const l = g.encounter.lead;
  return { flagged: !!l.hostileToPlayer, hunting: l.target === g.player };
});
ok(`marking her sets the helm after her (${gap0}m off when she was marked)`, gap0 > 120);
ok(`a raider who never came for you can still be brought to action (${quarry.name}`
  + `${how ? `, hunting you: ${how.hunting}, flagged hostile: ${how.flagged}` : ', no encounter'})`,
brought && !!how && !how.hunting && !how.flagged);
await G(() => { const g = window.__game; if (g.mode === 'encounter') g.closeEncounter(); g.paused = false; });


/* ---------------------------------------------------------------
   14 · a fleet fights beside you, not in front of you
   --------------------------------------------------------------- */
/* Get to a real battle with a consort in company: convert an NPC the way the
   consort-gunnery check does, mark a raider, sail to contact, clear for action. */
await G(() => {
  const g = window.__game, p = g.player;
  if (g.mode === 'encounter') g.closeEncounter();
  if (g.mode === 'battle') g.battle.finish('fled');
  g.paused = false; g.clearTarget();
  /* The surveyed corridor, so the battle is fought over water every pose in
     this section can trust. The foe starts already aboard us — contact is a
     range, and a chase would drag the arena wherever her flight ended. */
  p.x = -1450; p.z = 200; p.hull = p.hullMax; p.speed = 0; p.dest = null; p.shot = 200;
  let con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s) && s.faction !== 'pirate');
  for (let i = 0; i < 20 && !con; i++) con = g.spawnNPC('merchant');
  con.faction = 'player'; con.role = 'consort'; con.isPlayer = false;
  con.hostileToPlayer = false; con.fleeing = false; con.chaseHold = 0;
  con.formSlot = 1; con.shot = 90; con.hull = con.hullMax;
  con.x = p.x - 40; con.z = p.z - 30; con.name = 'CONSORT-14';
  if (!g.fleet.includes(con)) g.fleet.push(con);
  g.setFleetOrder('engage', true);
  let foe = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s));
  for (let i = 0; i < 20 && !foe; i++) foe = g.spawnNPC('pirate');
  foe.x = p.x + 60; foe.z = p.z; foe.hull = foe.hullMax; foe.speed = 0;
  foe.hostileToPlayer = true; foe.target = p; foe.chaseHold = 0; foe.fleeing = false; foe.name = 'FOE-14';
  /* A full complement, or the consort simply grapples her and the fight is
     over before there is any sailing to watch. Boarding has its own checks —
     this one is about where she puts her hull. */
  foe.crew.sailor += 40; foe.crew.marine += 10;
  g.encounterCooling = 0;
});
const inAction = await untilContact(20);
await G(() => { const g = window.__game; if (g.mode === 'encounter') g.chooseEncounter('fight'); });
ok('the fleet action for section 14 opened at all',
  inAction && (await G(() => window.__game.mode === 'battle')));

/* Your ball passes your own hull. Pose the consort square between muzzle and
   mark, fire a real broadside through her, and ask both hulls afterwards. */
const crossfire = await G(() => {
  const g = window.__game, p = g.player;
  const con = g.ships.find(s => s.name === 'CONSORT-14');
  const foe = g.ships.find(s => s.name === 'FOE-14');
  if (!con || !foe || g.mode !== 'battle') return null;
  g.target = foe;                                   // assignment, not selectTarget: that one toggles
  p.yaw = 0; p.speed = 0; p.reload.stb = 0; p.reload.port = 0; p.ammo = 'round';
  foe.x = p.x + 96; foe.z = p.z; foe.speed = 0;
  /* Only OUR guns speak during the measurement. The enemy is entitled to hit
     the consort — that is not team damage — so her answering broadside would
     muddy exactly the number this check exists to read. */
  foe.reload.stb = 99; foe.reload.port = 99;
  con.x = p.x + 48; con.z = p.z; con.speed = 0; con.yaw = 0;   // dead on the gun line
  const conHull = con.hull;
  g.update(0.03);                                   // fireSide settles on stb
  if (!g.fireSide) return { fired: 0 };
  g.playerFire();
  /* balls fly ~150 u/s: a second of small steps settles every one of them.
     The consort is frozen on the line the whole way — anything that can hit
     her, will. */
  for (let i = 0; i < 40; i++) { con.x = p.x + 48; con.z = p.z; con.speed = 0; g.update(0.03); }
  return { fired: 1, conLost: +(conHull - con.hull).toFixed(2), foeHull: +foe.hullFrac.toFixed(2) };
});
ok(`your broadside passes your own consort on its way to the enemy `
  + `(she lost ${crossfire ? crossfire.conLost : '?'} hull standing on the gun line)`,
!!crossfire && crossfire.fired === 1 && crossfire.conLost === 0);

/* And she works round to the disengaged side rather than orbiting through
   your line of fire. Watch the live battle and take the widest separation
   she manages: flag on one beam, consort working toward the other. */
const farSide = await G(() => {
  const g = window.__game, p = g.player;
  const con = g.ships.find(s => s.name === 'CONSORT-14');
  const foe = g.ships.find(s => s.name === 'FOE-14');
  if (!con || !foe || g.mode !== 'battle') {
    return { why: { con: !!con, foe: !!foe, foeAlive: foe && foe.alive, mode: g.mode } };
  }
  /* The tap on ENGAGE, as the fleet bar would send it: clearing for action
     put the standing order back to FOLLOW, which is its own bug-shaped fact —
     the commands the player reaches for mid-fight are exactly these. */
  g.setFleetOrder('engage', true);
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  /* The thing measured is where she SAILS, so the mark has to live long
     enough to be sailed around — the crossfire above already put a broadside
     into her. Propping her hull is a pose for the camera, not a rule change:
     nothing in the steering under test reads hull. */
  foe.hull = foe.hullMax;
  /* Stage the fault the rule exists to correct, rather than watching a duel
     and hoping it shows up. Put her exactly between the flagship and the
     enemy — masking the battery — and see whether the steering takes her off
     that line. Emergent behaviour over forty-five seconds was measured at
     anywhere from 0% to 92% of the action masked, so no threshold on it was
     ever going to mean anything; this asks the mechanism the question
     directly. */
  const bearing = Math.atan2(foe.x - p.x, foe.z - p.z);
  con.x = p.x + Math.sin(bearing) * 70;
  con.z = p.z + Math.cos(bearing) * 70;
  con.speed = 0;
  const sepAt = () => Math.abs(angDiff(
    Math.atan2(con.x - foe.x, con.z - foe.z),
    Math.atan2(p.x - foe.x, p.z - foe.z)));
  const before = sepAt();
  let best = before;
  for (let s = 0; s < 22 * 30 && foe.alive && con.alive; s++) {
    if (foe.hull < foe.hullMax * 0.25) foe.hull = foe.hullMax * 0.25;
    g.update(1 / 30);
    if (s % 10 === 0) best = Math.max(best, sepAt());
  }
  return { before: +before.toFixed(2), best: +best.toFixed(2), after: +sepAt().toFixed(2),
    foeAlive: foe.alive, conAlive: con.alive };
});
/* The flank steer pushes a consort clear of the flagship's bearing so she is
   not standing in front of the guns.

   Three assertions have been tried on this. The widest separation ever
   reached (flaky: 1.14 to 3.12 rad on identical staging). The separation she
   holds (flaky: 0.89 to 1.35). The share of the action she spends masking
   (measured across sixteen trials at anywhere from 0% to 92%). All three
   watched a duel and hoped the rule would show up in it — and how a duel
   swings belongs to the enemy's sailing, which no assertion should be hostage
   to, as the comment here has said all along while the assertion ignored it.

   So stage the fault instead: put her squarely between the flagship and the
   enemy, and ask whether the steering takes her off that line. That is the
   rule, tested directly, and it does not care how the fight goes. */
ok(`and a consort masking your guns steers off the line (${farSide && farSide.why
  ? 'no battle to watch: ' + JSON.stringify(farSide.why)
  : `${farSide ? farSide.before : '?'} rad -> ${farSide ? farSide.best : '?'} rad`})`,
!!farSide && farSide.best > farSide.before + 0.5 && farSide.best > 0.9);

await G(() => {
  const g = window.__game;
  if (g.mode === 'battle') g.battle.finish('fled');
  if (g.mode === 'encounter') g.closeEncounter();
  const con = g.ships.find(s => s.name === 'CONSORT-14');
  if (con) { const i = g.fleet.indexOf(con); if (i >= 0) g.fleet.splice(i, 1); con.faction = 'trader'; con.role = 'merchant'; }
  g.setFleetOrder('follow', true);
  g.paused = false;
});

/* ---------------------------------------------------------------
   15 · the campaign's guidance stands down for the action
   --------------------------------------------------------------- */
/* Where to sail next has nothing to say while the guns are out, and the HUD
   hides the chapter chip in a battle for exactly that reason. It did not
   work: the story tick calls setObjective every frame, which cleared the
   `hidden` class the HUD had just set, so the chip sat over the fight
   through most of every action — visible in a sweep screenshot of a battle
   with "Make Ilo Vantu and dock" still on the glass. */
await G(() => {
  const g = window.__game;
  if (g.mode === 'battle') g.battle.finish('fled');
  if (g.mode === 'encounter') g.closeEncounter();
  g.paused = false;
});
const inBattle15 = await intoBattle(page);
const chipGone = await waitFor(page,
  () => window.__game.mode === 'battle'
    && document.getElementById('objective').classList.contains('hidden'), 12000);
const chip = await G(() => ({ mode: window.__game.mode,
  cls: document.getElementById('objective').className,
  text: document.getElementById('obj-text').textContent.slice(0, 30) }));
ok(`the chapter chip stands down for a fleet action (${inBattle15 ? 'in action, ' : ''}chip "${chip.cls}")`,
  chipGone);
await leaveBattle(page);
const chipBack = await waitFor(page,
  () => !document.getElementById('objective').classList.contains('hidden'), 12000);
ok('and comes back when the sea is quiet again', chipBack);

/* ---------------------------------------------------------------
   a fleet that can be told to hold its fire

   Reported: "the player has no way to call off other ships in their fleet to
   stop firing if trying to capture a new ship, making boarding difficult if
   you have a larger fleet." Exactly so — every order fired, HOLD included,
   which slowed a consort to a crawl and went on shooting anything in range.
   The bigger the squadron, the harder it was to take anything alive, which
   is backwards.
   --------------------------------------------------------------- */
const holdTrial = h => G(hold => {
  const g = window.__game, p = g.player;
  if (g.mode === 'battle' && g.battle) g.battle.finish('fled');
  if (g.mode === 'encounter') g.closeEncounter();
  g.paused = false;
  p.x = -1450; p.z = 200; p.hull = p.hullMax; p.speed = 0; p.dest = null; p.shot = 200;
  for (let i = 0; i < 3; i++) {
    const con = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s) && s.faction !== 'pirate')
      || g.spawnNPC('merchant');
    if (!con) continue;
    con.faction = 'player'; con.role = 'consort'; con.isPlayer = false;
    con.hostileToPlayer = false; con.fleeing = false; con.chaseHold = 0;
    con.formSlot = i + 1; con.shot = 200; con.hull = con.hullMax;
    con.crew.gunner += 6;
    con.x = p.x - 60 + i * 40; con.z = p.z - 50;
    if (!g.fleet.includes(con)) g.fleet.push(con);
  }
  g.setFleetOrder('engage', true);
  g.setHoldFire(hold, true);
  const foe = g.ships.find(s => s.faction === 'pirate' && s.alive && !g.fleet.includes(s)) || g.spawnNPC('pirate');
  foe.x = p.x + 70; foe.z = p.z; foe.hull = foe.hullMax; foe.speed = 0;
  foe.hostileToPlayer = true; foe.target = p; foe.chaseHold = 0; foe.fleeing = false;
  g.encounterCooling = 0;
  for (let i = 0; i < 40 && g.mode === 'campaign'; i++) for (let k = 0; k < 30; k++) g.update(1 / 30);
  if (g.mode === 'encounter') g.chooseEncounter('fight');
  if (g.mode !== 'battle') return { err: 'no battle' };
  const shots0 = g.stats.broadsides;
  /* Count the shot out of the consorts' own lockers. Whether the prize
     happens to sink in the window is an outcome with the whole duel in it —
     56% hull on one run, nothing left on the next — and the toggle does not
     control that. What it controls is whether they fire at all. */
  const cons = g.fleet.filter(x => !x.isPlayer && x.alive);
  const lockers0 = cons.reduce((a, x) => a + x.shot, 0);
  g.target = foe;
  g.playerBoard();                                  // close and grapple, guns silent
  for (let i = 0; i < 70 * 30 && g.mode === 'battle'; i++) {
    g.update(1 / 30);
    if (p.boarding) break;
  }
  return {
    alive: foe.alive, hull: Math.round(foe.hullFrac * 100), boarding: !!p.boarding,
    playerFired: g.stats.broadsides - shots0,
    consorts: cons.length,
    consortShot: lockers0 - g.fleet.filter(x => !x.isPlayer && x.alive).reduce((a, x) => a + x.shot, 0),
  };
}, h);

const gunsFree = await holdTrial(false);
const gunsHeld = await holdTrial(true);
ok(`left free, ${gunsFree.consorts} consorts spend their shot on your prize `
  + `(${gunsFree.consortShot} rounds out of their lockers, her hull ${gunsFree.hull}%)`,
!gunsFree.err && gunsFree.consortShot > 0);
ok(`held, they fire not one round (${gunsHeld.consortShot} out of ${gunsHeld.consorts} lockers)`,
  !gunsHeld.err && gunsHeld.consortShot === 0);
ok(`so the prize is still afloat to be taken (her hull ${gunsHeld.hull}%, `
  + `boarding ${gunsHeld.boarding}, you fired ${gunsHeld.playerFired})`,
!gunsHeld.err && gunsHeld.alive && gunsHeld.boarding && gunsHeld.hull > 50);
await G(() => {
  const g = window.__game;
  if (g.mode === 'battle' && g.battle) g.battle.finish('fled');
  g.setHoldFire(false, true);
  g.setFleetOrder('follow', true);
  for (const s of g.fleet.slice(1)) { s.faction = 'freehold'; s.role = 'merchant'; s.x = 9e4; s.z = 9e4; }
  g.fleet.length = 1;
  g.paused = false;
});
for (let i = 0; i < 4 && await dismissModal(page); i++);

/* ---------------------------------------------------------------
   last · an action never opens with somebody standing on the land

   Reported from play: "the instance spawned my boat in the middle of the
   island, grounding it from the fight." The deployment walked twelve steps
   along one bearing — the way the ship was facing — looking for water, and
   gave up if that line was blocked. On a coast it usually is. Reverted
   against this check, Greywake puts the *player* eighty-seven metres up
   inside the rock before a shot is fired.

   Every waterfront in the world, because that is the hard case: the fleets
   meet on the beach itself and the arena has land on three sides.
   --------------------------------------------------------------- */
const beached = await G(() => {
  const g = window.__game, H = window.__terrain.heightAt;
  const out = [];
  for (const port of g.PORTS) {
    const sh = window.__shore[port.id];
    if (!sh) continue;
    if (g.mode === 'battle' && g.battle) g.battle.finish('fled');
    if (g.mode === 'encounter') g.closeEncounter();
    g.paused = false;
    const p = g.player;
    p.x = sh.x; p.z = sh.z; p.alive = true; p.hull = p.hullMax; p.speed = 0;
    let foe = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
    if (!foe) continue;
    foe.x = sh.x + 40; foe.z = sh.z + 20; foe.alive = true;
    foe.hostileToPlayer = true; foe.target = p; foe.chaseHold = 0; foe.fleeing = false;
    g.encounterCooling = 0;
    g.startEncounter(foe);
    if (g.mode !== 'encounter') continue;
    g.chooseEncounter('fight');
    if (g.mode !== 'battle' || !g.battle) continue;
    const all = [...g.battle.allies, ...g.battle.enemies];
    for (const s of all) {
      const depth = -H(s.x, s.z);
      if (depth < s.draft) out.push(`${port.id}:${s.isPlayer ? 'PLAYER' : s.name} in ${depth.toFixed(1)}m`);
    }
    g.battle.finish('fled');
  }
  return out;
});
ok(`no action opens with a hull on the ground (${beached.length ? beached.join(', ') : 'every waterfront clear'})`,
  beached.length === 0);
for (let i = 0; i < 4 && await dismissModal(page); i++);

/* ---------------------------------------------------------------
   16. A course is only clear from where you are, and only clear for
       the hull that has to sail it

   Half an hour of traffic put fifteen hulls on the ground while the player
   never touched it once. Two faults, both the same shape — a rule that
   sounded the destination and never the road to it.

   These are staged rather than watched. The honest aggregate over three runs
   each way moved 0.33% of ship-seconds aground to 0.27%, which is inside the
   noise of a world that spawns its own weather; the consort flank rule taught
   this repo that lesson three flaky assertions ago. So: build the fault the
   rule exists to correct, and ask whether the rule corrects it.
   --------------------------------------------------------------- */
const nav = await G(async () => {
  const R = await import('/src/core/route.js');
  const T = window.__terrain;
  const g = window.__game;
  const out = {};

  /* (a) A deep hull is not routed through a shallow road.
     The grid cleared every cell at a flat 6.5m — the player's cutter draws
     3.45m, so the constant looked like a fact for a year. A fluyt draws 7.13m
     and a frigate 8.97m. Measured on the water: `Ledger of Oosterhaven`,
     draft 7.1, hard aground in 5.3m with three legs of a good route in hand. */
  const DEEP = 8.97;                       // a frigate's draft
  const need = R.keelFor(DEEP);
  let worst = Infinity, legs = 0, routes = 0, worstAt = '';
  for (const a of g.PORTS) {
    for (const b of g.PORTS) {
      if (a === b) continue;
      const rt = R.findRoute(a.x, a.z, b.x, b.z, g.limit, need);
      if (!rt) continue;
      routes++;
      /* Judged from the first waypoint, not from the berth. Fort Escarra's
         mooring is 9.8m of water and a frigate draws 8.97m — she is already
         standing in less than she wants before any course is laid, and no
         routing can mend the ground she is floating over. What the road owes
         her is every leg after that. */
      let prev = rt[0];
      for (let k = 1; k < rt.length; k++) {
        const wp = rt[k];
        // sound the leg itself, not just its ends: a waypoint in deep water
        // is no use if the run to it crosses a bar
        const d = Math.hypot(wp.x - prev.x, wp.z - prev.z);
        const n = Math.max(1, Math.ceil(d / 14));
        for (let s = 0; s <= n; s++) {
          const t = s / n;
          const dep = T.depthAt(prev.x + (wp.x - prev.x) * t, prev.z + (wp.z - prev.z) * t);
          if (dep < worst) { worst = dep; worstAt = `${a.name}->${b.name} leg ${k}`; }
        }
        legs++; prev = wp;
      }
    }
  }
  out.deep = { routes, legs, shallowest: +worst.toFixed(1), worstAt, draft: DEEP, need: +need.toFixed(1) };
  return out;
});
ok(`a frigate's road is deep enough for a frigate (${nav.deep.routes} routes, `
  + `${nav.deep.legs} legs, shallowest water on any of them ${nav.deep.shallowest}m `
  + `under a ${nav.deep.draft}m draft${nav.deep.worstAt ? ' at ' + nav.deep.worstAt : ''})`,
  nav.deep.routes > 0 && nav.deep.legs > 0 && nav.deep.shallowest >= nav.deep.draft);

/* (b) A hull set down off a clear line notices the line has gone foul.
   `findRoute` returns null for "the rhumb line is already clear", and that
   answer was kept for the whole leg — so a merchant who left port on a good
   line and was then pushed off it by the wind or by `avoidLand` working round
   a headland went on steering it with nothing to notice. Staged: put a
   merchant where the line to her mark is squarely across land, and ask
   whether she comes up with a route instead of driving on. */
const resound = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game;
  // a stretch of water with land between it and the mark
  const port = g.PORTS.find(p => p.id === 'greywake');
  let spot = null;
  for (let r = 320; r <= 900 && !spot; r += 40) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x = port.x + Math.cos(a) * r, z = port.z + Math.sin(a) * r;
      if (window.__terrain.depthAt(x, z) < 14) continue;
      if (R.clearWater(x, z, port.x, port.z)) continue;      // must be foul, that is the point
      spot = { x, z }; break;
    }
  }
  if (!spot) return { staged: false };
  const s = g.ships.find(x => x.role === 'merchant' && x.alive);
  if (!s) return { staged: false };
  s.x = spot.x; s.z = spot.z; s.speed = 4;
  /* The fault exactly: she is holding the answer from a moment when the line
     WAS clear, and her brain has no reason to ask again. */
  s.brain.path = null;
  s.brain.pathGoal = { x: port.x, z: port.z };
  s.brain.resound = 0;
  s.brain.route = ['greywake', 'greywake'];
  s.brain.flee = 0;
  const before = { x: s.x, z: s.z, foul: !R.clearWater(s.x, s.z, port.x, port.z) };
  for (let i = 0; i < 90; i++) g.update(1 / 30);            // three seconds: two casts
  return {
    staged: true, before,
    gotRoute: !!(s.brain.path && s.brain.path.length),
    // and the leg she is now steering is water
    legClear: s.brain.path && s.brain.path.length
      ? R.clearWater(s.x, s.z, s.brain.path[0].x, s.brain.path[0].z, R.keelFor(s.draft))
      : R.clearWater(s.x, s.z, port.x, port.z, R.keelFor(s.draft)),
  };
});
ok(`a course that goes foul under her is laid again (${resound.staged
  ? (resound.gotRoute ? 'routed round it' : 'still steering the rhumb line')
    + `, leg ${resound.legClear ? 'clear' : 'FOUL'}`
  : 'could not stage'})`,
  resound.staged && resound.gotRoute && resound.legClear);

/* (c) An escort keeps station by a road she can sail.
   The station itself was sounded — that was last session's fix — and the run
   to it was not. When the charge rounds a point her station swings to the far
   side of it, the water there is deep, and the straight line goes over the
   headland. Escorts were the worst offenders on the sea for it: 1.25% of
   their time aground against 0.23% for the merchants they were guarding. */
const escort = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game, T = window.__terrain;
  const e = g.ships.find(s => s.role === 'escort' && s.alive)
    || g.ships.find(s => s.role === 'merchant' && s.alive);
  if (!e) return { staged: false };
  const port = g.PORTS.find(p => p.id === 'greywake');
  /* Put the charge on the far side of the land from her escort — and insist a
     way round exists before staging anything on the pair. A pair that is foul
     AND unroutable is not this fault, it is a lagoon, and asking the steering
     to produce a route there made this check pass or fail on which two hulls
     the world happened to hand it. Staged by construction, not by luck. */
  let a = null, b = null;
  for (let r = 300; r <= 800 && !b; r += 40) {
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2;
      const x1 = port.x + Math.cos(ang) * r, z1 = port.z + Math.sin(ang) * r;
      const x2 = port.x - Math.cos(ang) * r, z2 = port.z - Math.sin(ang) * r;
      if (T.depthAt(x1, z1) < 14 || T.depthAt(x2, z2) < 14) continue;
      if (R.clearWater(x1, z1, x2, z2)) continue;               // must be foul
      const way = R.findRoute(x1, z1, x2, z2, g.limit, R.keelFor(e.draft));
      if (!way || !way.length) continue;                        // and must be roundable
      a = { x: x1, z: z1 }; b = { x: x2, z: z2 }; break;
    }
  }
  if (!b) return { staged: false };
  const charge = g.ships.find(s => s !== e && s.alive && !s.isPlayer);
  if (!charge) return { staged: false };
  /* Nobody else on this water. An escort with a hostile in sight fights
     instead of stationing and never reaches the rule under test — which is
     what made this check fail one run in three, with the world quietly
     deciding whether the scenario happened at all. */
  for (const s of g.ships) {
    if (s === e || s === charge || s.isPlayer) continue;
    s.x = 9e4; s.z = 9e4; s.target = null; s.hostileToPlayer = false;
  }
  g.player.x = 9e4; g.player.z = 9e4;
  e.role = 'escort'; e.escortFor = charge; e.escortSlot = 1;
  e.aggro = 0; e.lastAttacker = null; e.target = null; e.fleeing = false;
  e.x = a.x; e.z = a.z; e.speed = 3;
  charge.x = b.x; charge.z = b.z; charge.speed = 3;
  charge.hostileToPlayer = false; charge.alive = true; charge.captured = false;
  /* Wipe what she was thinking before she was an escort. She had a life as a
     merchant a moment ago and her brain still holds that route — a check that
     reads a leftover `path` passes whatever the rule under test decides, which
     is how this one first passed with the fix taken back out. */
  e.brain.path = null; e.brain.pathGoal = null; e.brain.station = null;
  e.brain.resound = 0; e.brain.flee = 0; e.brain.state = 'idle';
  /* The question is which station she chose, not which way her bow ended up
     pointing. Sounding her heading measures `avoidLand` — a greedy rule that
     will deflect a bow off a rock whatever nonsense it was aimed at, and which
     duly passed this check with the fix taken back out. What the rule under
     test decides is the point she steers for, so read that.
     Where the abeam station cannot be sailed to she takes the charge's wake,
     which she can always see, because the charge is floating in it. */
  const abeam = {
    x: charge.x + Math.sin(charge.yaw + Math.PI / 2) * 78 - Math.sin(charge.yaw) * 46,
    z: charge.z + Math.cos(charge.yaw + Math.PI / 2) * 78 - Math.cos(charge.yaw) * 46,
  };
  g.update(1 / 30);
  const st = e.brain.station;
  const wp = e.brain.path && e.brain.path.length ? e.brain.path[0] : null;
  return {
    staged: true,
    abeamWasFoul: !R.clearWater(e.x, e.z, abeam.x, abeam.z, R.keelFor(e.draft)),
    tookIt: !!st && Math.hypot(st.x - abeam.x, st.z - abeam.z) < 20,
    // whatever she settled on, the line she is now sailing has to be water:
    // a clear run to a station in sight, or the first leg of a route round
    reachable: !!st && R.clearWater(e.x, e.z, st.x, st.z, R.keelFor(e.draft)),
    routed: !!wp && R.clearWater(e.x, e.z, wp.x, wp.z, R.keelFor(e.draft)),
    // so a failure says which half went wrong rather than only that it did
    why: !st ? 'she never stationed at all (fought or fled instead)'
      : !wp ? 'no route in hand' : 'route in hand',
  };
});
ok(`an escort cut off from her charge sails water, not the rhumb line (${escort.staged
  ? `abeam station ${escort.abeamWasFoul ? 'cut off by land' : 'NOT BLOCKED — bad staging'}, `
    + `she ${escort.tookIt ? 'TOOK IT ANYWAY' : 'let it go'}, `
    + `now on ${escort.reachable ? 'a clear run to station' : escort.routed ? 'a routed leg round' : 'A FOUL LINE — ' + escort.why}`
  : 'could not stage'})`,
  escort.staged && escort.abeamWasFoul && !escort.tookIt && (escort.reachable || escort.routed));

/* ---------------------------------------------------------------
   17. Reported from the deck: ships that go nowhere, and a ship that
       will not stay put
   --------------------------------------------------------------- */

/* (a) A mark dead upwind can be reached at all.
   `layToWind` laid the near edge of the no-go cone and held it, on the
   reasoning that the mark drifts out of the cone as she goes. True of a mark
   you are passing; false of a station, which does not move — she reached away
   until the bearing swung, came back, and did it again for ever. Measured at
   Greywake: both Sable gate-keepers with their post 0.50 and 0.61 rad inside
   a 0.82 rad cone, open water and a clear line, going nowhere. `Ship.beatTo`
   is the real beat and had been the player's alone. Staged in open water so
   this is a question about the wind and nothing else. */
const beat = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game, T = window.__terrain;
  g.paused = false;
  /* Open water with a clear line to a mark 380m dead upwind, so nothing here
     is about routing. Scanned for deterministically. */
  g.windAng = 0; g.windTargetAng = 0; g.windTimer = 1e6; g.world.windAng = 0;
  const eye = Math.PI;                       // where the wind blows from
  let c = null, bestScore = -1;
  for (let x = -900; x <= 900; x += 60) {
    for (let z = -900; z <= 900; z += 60) {
      const px = x + Math.sin(eye) * 380, pz = z + Math.cos(eye) * 380;
      if (!R.clearWater(x, z, px, pz, 12)) continue;
      /* Deep close in as well as far out. `avoidLand` sounds 42m plus her way
         ahead and deflects a full 1.5 rad when it does not like the answer, so
         a spot that is open at 400m and thin at 60m makes this check measure
         the deflection instead of the beat — which is exactly what it first
         did, reading 1.54 rad off close-hauled. */
      let worst = Infinity;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        for (const d of [40, 80, 140, 200, 320]) {
          worst = Math.min(worst, T.depthAt(x + Math.sin(a) * d, z + Math.cos(a) * d));
        }
      }
      if (worst > bestScore) { bestScore = worst; c = { x, z, px, pz }; }
    }
  }
  if (bestScore < 20) c = null;
  const s = g.ships.find(x => x.alive && !x.isPlayer && !g.fleet.includes(x));
  if (!c || !s) return { staged: false };

  /* The player kept well clear. The powers hostile to her find an enemy at
     640m, and parked 300m off she *was* the scenario: the guard steered at the
     player the whole time and the check read a bearing of exactly π/4 and
     called it a failed beat. Still inside the 2400m cull, so the world does
     not reap the hull under test. */
  const p = g.player;
  p.x = c.x + 1150; p.z = c.z; p.speed = 0; p.throttle = 0;
  p.dest = null; p.route = null; g.moveGoal = null; p.alive = true; p.hull = p.hullMax;
  for (const o of g.ships) {
    if (o === s || o.isPlayer) continue;
    o.x = c.x + 1400; o.z = c.z + 200; o.target = null; o.hostileToPlayer = false;
  }
  /* Wipe what she was doing in an earlier scenario. `updateAI` returns before
     any of the steering when a hull is holding off after a chase, fleeing, or
     grappled — and this check first read a null heading because the ship the
     world handed it was still shaking off section 1. */
  s.role = 'sable'; s.target = null; s.aggro = 0; s.fleeing = false;
  s.chaseHold = 0; s.boarding = null; s.lockTo = null; s.captured = false;
  s.hostileToPlayer = false; s.hull = s.hullMax; s.sails = s.sailMax; s.tack = 0;
  s.x = c.x; s.z = c.z; s.speed = 5; s.yaw = eye;
  s.brain = { post: { x: c.px, z: c.pz }, t: 0, cooldown: 0 };

  /* The decision, not the voyage. Letting her sail for four minutes and asking
     where she ended up measured the weather: the first two attempts had her
     2650m from the staging point (a teleport, not a beat) and drowned. What
     the fix decides is the heading she is given, so read that.
     One: with the mark dead in the eye she lays a board instead of pointing at
     it. `layToWind` never touched `tack` at all, so a non-zero tack is the
     signature of the beat being wired in. */
  s.headingCmd = null;               // so a stale order cannot be mistaken for a decision
  g.update(1 / 30);
  const board1 = s.tack;
  const head1 = s.headingCmd;
  const closeHauled = head1 == null ? 9 : Math.min(
    Math.abs(((head1 - (eye + 0.82) + Math.PI * 3) % (Math.PI * 2)) - Math.PI),
    Math.abs(((head1 - (eye - 0.82) + Math.PI * 3) % (Math.PI * 2)) - Math.PI));

  /* Two: she comes about. Stand her well off to the board's side, so the mark
     is now across the wind from her, and ask again — a captain who cannot do
     this is the one who reaches away for ever. */
  const across = eye + Math.PI / 2 * board1;
  s.x = c.x + Math.sin(across) * 300; s.z = c.z + Math.cos(across) * 300;
  let board2 = board1;
  for (let i = 0; i < 30 && board2 === board1; i++) { g.update(1 / 30); board2 = s.tack; }

  return { staged: true, board1, board2, cameAbout: !!board1 && board2 === -board1,
    closeHauled: +closeHauled.toFixed(2), seaRoom: Math.round(bestScore),
    head1: +head1.toFixed(2), eye: +eye.toFixed(2), alive: s.alive };
});
ok(`a mark dead upwind is beaten up to, not reached away from (${beat.staged
  ? `board ${beat.board1 === 0 ? 'NONE — she pointed at it' : beat.board1 > 0 ? 'starboard' : 'port'}, `
    + `${beat.closeHauled} rad off close-hauled, `
    + `then ${beat.cameAbout ? 'came about' : 'HELD THE SAME BOARD'}`
  : 'could not stage'})`,
  beat.staged && beat.board1 !== 0 && beat.closeHauled < 0.25 && beat.cameAbout);

/* (b) A mark she was sailed to is a place she meant to be.
   Arriving left 12% of throttle on — meant as "taking the way off her", read
   from the deck as a ship that never stops. She sailed 239m clear of the mark
   in the five minutes after reaching it, still making half a knot. */
const rest = await G(() => {
  const g = window.__game, p = g.player;
  g.paused = false; g.inPort = null;
  /* Every reason `commandMove` refuses, cleared first. It returns early for a
     hull that is boarding or grappled, and sixteen sections of staging leave
     both lying about — so the course was never laid, `moveGoal` was never set,
     the arrival loop exited on its first test and the check sat there
     measuring a ship that had not moved. It passed with the fix reverted,
     which is the only reason it was caught. */
  p.boarding = null; p.lockTo = null; p.captured = false; p.route = null; p.dest = null;
  for (const s of g.ships) { if (!s.isPlayer) { s.x = 9e4; s.z = 9e4; s.hostileToPlayer = false; } }
  /* Let the residue out of the world *before* the course is laid, not only
     before the tape measure comes out. Settling afterwards was not enough: the
     first tick still moved her, and on one run in three she was set down far
     enough away that she never fetched the mark at all and "throttle on
     arrival" was read off a ship still under way. */
  p.x = 120; p.z = 60; p.speed = 0; p.throttle = 0; p.alive = true; p.hull = p.hullMax;
  for (let i = 0; i < 300; i++) { g.update(1 / 30); g.paused = false; }
  p.boarding = null; p.lockTo = null; p.route = null; p.dest = null;
  p.x = 120; p.z = 60; p.speed = 0; p.throttle = 0;
  const from = { x: p.x, z: p.z };
  /* Hold the campaign layer for the measurement. Left free, the world sent
     somebody to find her during the five minutes, the encounter made a battle,
     and the deployment set her down 1805m away — which the check duly reported
     as drift on a ship making no way at all. */
  g.encounterCooling = 1e5;
  /* A mark in water, sounded rather than assumed. The first version tapped a
     fixed offset that turned out to be ashore, so she never arrived at all —
     600 seconds of sailing for a 452m trip — and "throttle on arrival" was
     read off a ship still under way. */
  const T = window.__terrain;
  let mark = null;
  for (let i = 0; i < 24 && !mark; i++) {
    const a = i / 24 * Math.PI * 2;
    const mx = p.x + Math.sin(a) * 60, mz = p.z + Math.cos(a) * 60;
    if (T.depthAt(mx, mz) < 20) continue;
    let clear = true;
    for (let k = 1; k <= 24; k++) {
      const t = k / 24;
      if (T.depthAt(p.x + (mx - p.x) * t, p.z + (mz - p.z) * t) < 12) { clear = false; break; }
    }
    if (clear) mark = { x: mx, z: mz };
  }
  if (!mark) return { staged: false };
  /* Sail it, and be willing to lay the course again. Something in a world this
     heavily staged displaces her occasionally — a 3588m jump on a single tick,
     measured — and one attempt meant one run in three read "throttle on
     arrival" off a ship that had never arrived. Three tries, and the check
     says plainly whether she got there. */
  let laid = false, arrived = false, tries = 0;

  for (; tries < 5 && !arrived; tries++) {
    /* Alive, whole and afloat at the start of every attempt. The first run of
       this found her displaced onto rising ground mid-leg — `depth -15.4m` is
       not water, it is fifteen metres of hillside — where she ground herself
       to death; and `commandMove` refuses for a dead hull, so the two retries
       sat there measuring a corpse and reported "0m sailed". */
    p.x = from.x; p.z = from.z; p.speed = 0; p.throttle = 0;
    p.alive = true; p.hull = p.hullMax; p.sails = p.sailMax;
    p.dest = null; p.route = null; p.boarding = null; p.lockTo = null;
    /* And nobody else has the helm. A marked ship is a ship the player is
       *running down* — `selectTarget` sets `chasing` and the helm goes after
       her — so a target left marked by an earlier section sails her 895m away
       from a mark 90m off and then on for another 695m at six knots, which is
       exactly what the full runner reported. */
    g.chasing = null; g.target = null; g.boardRun = null;
    g.commandMove(mark.x, mark.z);
    laid = laid || !!g.moveGoal;
    for (let i = 0; i < 45 * 30 && g.moveGoal; i++) {
      g.update(1 / 30);
      /* A modal pauses the world, and a bulk update loop inside `evaluate`
         then spins at dt = 0 for ever — which is exactly what "0m sailed in 3
         attempts" was. Answer it and carry on. */
      if (g.paused) {
        const btn = document.querySelector('#modal-actions .btn');
        if (btn) btn.click();
        g.paused = false;
      }
      if (!p.alive || window.__terrain.depthAt(p.x, p.z) < p.draft) break;
    }
    arrived = Math.hypot(p.x - mark.x, p.z - mark.z) < 32;
  }
  const throttleOnArrival = p.throttle;
  const sailed = Math.round(Math.hypot(p.x - from.x, p.z - from.z));
  /* Let the world settle before the tape measure comes out. Sixteen sections
     of staging leave residue — the first version of this recorded a 3588m jump
     on the very first tick after arrival, on a hull making no way at all, and
     reported it as drift. The decision above is the substance; this is only
     asking whether she then stays where she was put. */
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  const at = { x: p.x, z: p.z };
  let vMax = 0;
  for (let i = 0; i < 90 * 30; i++) { g.update(1 / 30); g.paused = false; vMax = Math.max(vMax, p.speed); }
  return { was: +throttleOnArrival.toFixed(2), mode: g.mode, vMax: +vMax.toFixed(2), laid, sailed,
    arrived, tries, drift: Math.round(Math.hypot(p.x - at.x, p.z - at.z)), v: +p.speed.toFixed(2) };
});
ok(`she lies where she was sailed to (${rest.staged === false ? 'could not find water to sail to'
  : `${rest.arrived ? 'fetched the mark' : 'NEVER FETCHED THE MARK'} in ${rest.tries} `
    + `attempt${rest.tries === 1 ? '' : 's'} (${rest.sailed}m sailed, ${rest.mode}), `
    + `throttle ${rest.was} on arrival, `
  + `${rest.drift}m of drift in the ninety seconds after, never above ${rest.vMax} knots`})`,
  rest.staged !== false && rest.laid && rest.arrived && rest.was === 0
  && rest.drift < 25 && rest.vMax < 0.5 && rest.mode === 'campaign');

/* (c) And closing the harbour screen does not make sail for her.
   `leavePort` set full throttle, so a captain who had finished her business
   looked up to find the ship sailing herself out of the roads. */
const left = await G(() => {
  const g = window.__game, p = g.player, port = g.PORTS.find(x => x.id === 'ilovantu');
  g.paused = false;
  g.enterPort(port);
  const inPort = { throttle: p.throttle, speed: p.speed };
  g.leavePort();
  return { inPort: +inPort.throttle.toFixed(2), after: +p.throttle.toFixed(2),
    dest: !!p.dest, route: !!(p.route && p.route.length) };
});
ok(`and leaving the harbour screen does not make sail for her `
  + `(throttle ${left.inPort} alongside, ${left.after} after)`,
  left.after === 0 && !left.dest && !left.route);
await G(() => {
  // enterPort opened the harbour screen; put it away without leaning on the UI
  document.getElementById('sheet').classList.add('hidden');
  window.__game.inPort = null; window.__game.paused = false;
});

/* (d) A gate she cannot fetch is a gate she gives up.
   Reported twice with the same screenshot, and it survived three fixes because
   none of them asked whether she was getting anywhere. A Sable guard whose post
   lies across Greywake's breakwater beats at it for ever: every board runs her
   at the masonry, `beatTo` comes about for the shore, and she gives back the
   ground she made. Never aground, never stationary — invisible to every check
   that counted either. Measured before: 98% of ten minutes within 60m of the
   arm, closest approach sixteen metres, and never within 188m of her post. */
const gate = await G(async () => {
  const R = await import('/src/core/route.js');
  const g = window.__game, T = window.__terrain;
  g.paused = false;
  const port = g.PORTS.find(p => p.id === 'greywake');
  const s = g.ships.find(x => x.alive && !x.isPlayer && !g.fleet.includes(x));
  if (!s) return { staged: false };
  // everyone else away, and the player near enough that the world keeps her
  for (const o of g.ships) {
    if (o === s || o.isPlayer) continue;
    o.x = port.x + 1500; o.z = port.z + 1500; o.target = null; o.hostileToPlayer = false;
  }
  const p = g.player;
  p.x = port.x + 900; p.z = port.z + 900; p.speed = 0; p.throttle = 0;
  p.dest = null; p.route = null; g.moveGoal = null; p.alive = true; p.hull = p.hullMax;

  /* Put her one side of the harbour and her post the other, so the arm is
     between the two — the scenario the rule exists for, built rather than
     waited for. */
  let here = null, there = null;
  for (let r = 260; r <= 520 && !there; r += 40) {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x1 = port.x + Math.sin(a) * r, z1 = port.z + Math.cos(a) * r;
      const x2 = port.x - Math.sin(a) * r, z2 = port.z - Math.cos(a) * r;
      if (T.depthAt(x1, z1) < 14 || T.depthAt(x2, z2) < 14) continue;
      if (R.clearWater(x1, z1, x2, z2, 6.5)) continue;         // must be cut off
      here = { x: x1, z: z1 }; there = { x: x2, z: z2 }; break;
    }
  }
  if (!there) return { staged: false };
  s.role = 'sable'; s.target = null; s.aggro = 0; s.fleeing = false;
  s.chaseHold = 0; s.boarding = null; s.lockTo = null; s.captured = false;
  s.hostileToPlayer = false; s.hull = s.hullMax; s.sails = s.sailMax; s.tack = 0;
  s.x = here.x; s.z = here.z; s.speed = 4;
  s.brain = { post: { x: there.x, z: there.z }, t: 0, cooldown: 0 };
  const first = { x: there.x, z: there.z };
  const startOff = Math.hypot(s.x - first.x, s.z - first.z);

  let best = startOff;
  for (let i = 0; i < 150 * 30; i++) {
    g.update(1 / 30);
    g.paused = false;
    best = Math.min(best, Math.hypot(s.x - s.brain.post.x, s.z - s.brain.post.z));
  }
  return {
    staged: true, startOff: Math.round(startOff),
    movedGate: Math.hypot(s.brain.post.x - first.x, s.brain.post.z - first.z) > 40,
    closest: Math.round(best),
    postSeen: R.clearWater(s.x, s.z, s.brain.post.x, s.brain.post.z, R.keelFor(s.draft)),
  };
});
ok(`a picket that cannot fetch her gate takes one she can (${gate.staged
  ? `cut off by ${gate.startOff}m of harbour, ${gate.movedGate ? 'shifted her gate' : 'HELD THE SAME GATE'}, `
    + `closed from ${gate.startOff}m to ${gate.closest}m`
  : 'could not stage'})`,
  gate.staged && (gate.movedGate || gate.closest < gate.startOff - 150));


console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
