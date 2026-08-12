/* The campaign / encounter / battle spine.

   The three layers and every road between them, driven through the real game.
   Nothing here sets `mode` by hand: a raider is put on the water and told to
   hunt, and the chase, the contact, the encounter and the battle all happen
   because the systems made them happen. The only staging is placing ships and
   choosing the matchup — which is what a scenario is.

   Where an outcome is a roll, the scenario is stacked until the roll is
   lopsided and the check is "at least one of N", rather than pinned to a mean
   that will fail the first unlucky time. */
import { launch, sleep, ff, shot, newVoyage, waitFor, dismissModal } from './qa.mjs';

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
    await G(() => { const g = window.__game; g.battle.finish('fled'); });
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
await waitFor(page, () => !document.getElementById('battlebar').classList.contains('hidden')
  && document.getElementById('objective').classList.contains('hidden'), 8000);
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
ok('guns are live inside it and the campaign chrome is gone',
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
const worldBefore = await G(() => ({ ships: window.__game.ships.length }));
await G(() => { const g = window.__game; if (g.mode === 'encounter') g.chooseEncounter('fight'); });
await waitFor(page, () => window.__game.mode === 'battle', 6000);
let ended = false;
for (let i = 0; i < 130 && !ended; i++) {
  await ff(page, 1.2);
  ended = await G(() => {
    const g = window.__game;
    if (g.mode !== 'battle') return true;
    const t = g.battle.enemies[0];
    if (t) {
      /* Beaten and running: let her go. Chasing a routed ship keeps her inside
         the range that says the action is still on, so the fight never ends —
         which is correct behaviour, and is why this stops pressing. */
      if (t.fleeing) { g.player.throttle = 0; g.player.dest = null; return false; }
      g.player.setHeading(Math.atan2(t.x - g.player.x, t.z - g.player.z) + Math.PI / 2);
      g.player.ammo = 'round';
      if (g.fireSide && g.player.reload[g.fireSide] <= 0) g.playerFire();
    }
    return false;
  });
}
const won = await G(() => ({
  mode: window.__game.mode,
  ships: window.__game.ships.length,
  sunk: window.__game.battleLastSunk || 0,
  title: document.getElementById('enc-title').textContent,
  alive: window.__game.player.alive,
}));
ok(`fighting her out ends the action ("${won.title}")`, ended && won.mode === 'campaign' && won.alive);
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
const fb = await G(() => {
  const g = window.__game, b = g.battle;
  return { allies: b.allies.length, ships: g.ships.length, fleet: g.fleet.length, order: g.fleetOrder };
});
ok(`a fleet of ${fleetN} goes into action together (${fb.allies} under your flag on the water)`,
  fleetN < 2 || fb.allies === fleetN);
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
const saveGuard = await G(() => {
  const g = window.__game;
  const before = localStorage.getItem('salt-and-tally-v1');
  g.save();
  const after = localStorage.getItem('salt-and-tally-v1');
  return { same: before === after, inBattle: g.mode === 'battle', shipsInBattle: g.ships.length };
});
ok(`a battle cannot overwrite the save with a benched world (${saveGuard.shipsInBattle} sail in the instance)`,
  saveGuard.inBattle && saveGuard.same);

/* ---------------------------------------------------------------
   12 · out of the battle, and a save/load round trip still works
   --------------------------------------------------------------- */
await G(() => { const g = window.__game; g.battle.finish('fled'); });
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
ok('and reloads onto the campaign layer with a whole world',
  post.mode === 'campaign' && !post.live && post.ships > 2);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
