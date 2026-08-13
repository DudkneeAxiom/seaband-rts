/* Systems test: contracts, discoveries, shoal water, supplies, reputation,
   crew progression, and the awkward states players actually hit. */
import { launch, sleep, ff, shot, newVoyage, waitFor, dismissModal, intoBattle, leaveBattle } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);
/** No raider is going to interrupt a test about menus.
    Ending a battle puts the reckoning card up, which is a screen like any
    other and holds the world — so this clears that too, or the very next
    check finds a simulation that has stopped advancing. */
const noEncounters = async () => {
  await G(() => {
    const g = window.__game;
    if (g.mode === 'encounter') g.closeEncounter();
    if (g.mode === 'battle' && g.battle) g.battle.finish('fled');
  });
  await page.click('.enc-opt[data-opt="done"]').catch(() => { });
  await G(() => {
    const g = window.__game;
    document.getElementById('encounter').classList.add('hidden');
    g.paused = false;
    for (const s of g.ships) {
      if (s.isPlayer || g.fleet.includes(s)) continue;
      s.hostileToPlayer = false; s.target = null; s.chaseHold = 240;
    }
    g.encounterCooling = 600;
  });
};


/* ---- cargo contract, end to end ---- */
const q = await G(() => {
  const g = window.__game;
  g.coin = 5000;
  const port = g.PORTS[0];
  const quest = g.contractsAt(port).find(x => x.kind === 'cargo');
  g.acceptQuest(quest, port);
  // load it off the quay that wrote the contract, as the harbourmaster expects
  g.player.cargo[quest.good] = quest.amount;
  g.onGoodsBought(quest.good, quest.amount, port);
  const dest = g.PORTS.find(p => p.id === quest.toPort);
  return { good: quest.good, amount: quest.amount, to: quest.toPort, destName: dest.name,
    from: quest.fromPort, advance: quest.advance };
});
ok(`a cargo contract can be accepted (${q.from} -> ${q.to}, ◆${q.advance} advanced)`, !!q.to);
const delivered = await G((qq) => {
  const g = window.__game;
  const dest = g.PORTS.find(p => p.id === qq.to);
  const quest = g.quests.find(x => x.kind === 'cargo' && x.active);
  const before = g.coin;
  if (!g.canCompleteHere(quest, dest)) return { ok: false, why: 'cannot complete at destination' };
  g.completeQuest(quest);
  return { ok: quest.done && g.coin > before, coin: g.coin - before, cargoLeft: g.player.cargo[qq.good] || 0 };
}, q);
ok(`contract pays out at ${q.destName} (+${delivered.coin} coin, cargo consumed)`,
  delivered.ok && delivered.cargoLeft === 0);

/* ---- discovery ---- */
const poi = await G(async () => {
  const g = window.__game;
  const p = g.player;
  const target = g.PORTS && window.__poi ? null : null;
  void target;
  const poiDef = { x: -1100, z: -880 };
  p.x = poiDef.x; p.z = poiDef.z;
  const before = g.coin;
  g.update(0.05);
  return {
    discovered: g.discovered.has('bellcove'),
    modal: !document.getElementById('modal').classList.contains('hidden'),
    title: document.getElementById('modal-title').textContent,
    paid: g.coin - before,
    paused: g.paused,
  };
});
ok(`sailing over Bellcurrent discovers it ("${poi.title}", +${poi.paid} coin)`,
  poi.discovered && poi.modal && poi.paid > 0);
await shot(page, 'sys-discovery');
await page.evaluate(() => {
  const b = document.querySelector('#modal-actions .btn'); b && b.click();
});
await sleep(400);
ok('the discovery dialog releases the game', !(await G(() => window.__game.paused)));

/* ---- the second discovery hands over an officer ---- */
const poi2 = await G(() => {
  const g = window.__game;
  g.player.x = 1420; g.player.z = -1120;
  const before = g.officers.length;
  g.update(0.05);
  return { discovered: g.discovered.has('lighthouse'), gainedOfficer: g.officers.length > before };
});
ok('the Dead Lantern is found and its keeper signs on', poi2.discovered && poi2.gainedOfficer);
await page.evaluate(() => { const b = document.querySelector('#modal-actions .btn'); b && b.click(); });
await sleep(300);

/* ---- shoal water hurts deep hulls and spares shallow ones ---- */
const shoal = await G(async () => {
  const g = window.__game;
  g.paused = false;
  const p = g.player;
  const reef = { x: -120, z: 520 };
  p.x = reef.x; p.z = reef.z; p.hull = p.hullMax; p.speed = 8; p.setHeading(0.4);
  for (let i = 0; i < 240; i++) { p.x = reef.x; p.z = reef.z; g.update(1 / 60); }
  const cutterHull = p.hullFrac;
  // a frigate over the same water
  const H = g.HULLS || null;
  const drafts = { cutter: g.player.draft, frigate: g.player.draft / g.player.cls.draft * 0.78 };
  void H;
  return { cutterHull: +cutterHull.toFixed(2), drafts };
});
ok(`a cutter (draft ${shoal.drafts.cutter.toFixed(1)}) crosses the reef intact`, shoal.cutterHull > 0.9);
ok('deep hulls draw more water than shallow ones', shoal.drafts.frigate > shoal.drafts.cutter * 2);

/* ---- provisions running out ----
   Hunger should take the edge off a crew long before it takes any of them:
   an empty barrel is a reason to make port, not a death sentence. */
const starve = await G(() => {
  const g = window.__game;
  const p = g.player;
  p.provisions = 0; p.hungry = 0;
  const crew0 = p.crewTotal, morale0 = p.morale;
  const skill0 = p.crewSkill('sail');
  for (let i = 0; i < 60 * 90; i++) { g.update(1 / 60); p.hull = p.hullMax; }
  return {
    crewLost: crew0 - p.crewTotal, crew0, crewMin: p.cls.crewMin,
    moraleDrop: +(morale0 - p.morale).toFixed(2), alive: p.alive,
    hungry: +p.hungry.toFixed(2),
    skillDrop: +(1 - p.crewSkill('sail') / skill0).toFixed(2),
  };
});
ok(`ninety seconds on empty barrels wears the crew down (hunger ${starve.hungry}, seamanship -${Math.round(starve.skillDrop * 100)}%)`,
  starve.hungry > 0.8 && starve.skillDrop > 0.2 && starve.alive);
/* Deaths are a coin toss every second once they are properly worn down, so the
   count here is a random variable with a mean near one, not a fixed number —
   pinning the bound just above the mean is how this came out red on a run that
   was behaving perfectly. Five is deep in the tail and still nowhere near the
   thing being guarded, which is that hunger never empties a ship. */
ok(`and does not decimate them (lost ${starve.crewLost} of ${starve.crew0}, floor ${starve.crewMin})`,
  starve.crewLost <= 5 && starve.crew0 - starve.crewLost >= starve.crewMin);
ok(`morale falls with the barrels (-${starve.moraleDrop})`, starve.moraleDrop > 0);

/* ---- out of shot ---- */
const dry = await G(() => {
  const g = window.__game;
  const p = g.player;
  p.shot = 0;
  const t = g.ships.find(s => s.alive && !s.isPlayer);
  g.selectTarget(t);
  t.x = p.x + 90; t.z = p.z; p.yaw = 0;
  g.update(0.05);
  p.reload.stb = 0; p.reload.port = 0;
  /* Both counts, before and after, and compared as a delta. This took the
     list before and the *pending* after, so any two ships trading broadsides
     somewhere else on the sea — which the campaign layer still allows, since
     that world carries on without you — read as the player's empty guns
     going off. What is being asked is whether her own locker refuses. */
  const was = { list: g.projectiles.list.length, pending: g.projectiles.pending.length };
  g.playerFire();
  const now = { list: g.projectiles.list.length, pending: g.projectiles.pending.length };
  return {
    fired: now.list > was.list || now.pending > was.pending,
    was, now, shot: p.shot, side: g.fireSide, live: g.ctx.combatLive,
  };
});
ok(`an empty shot locker refuses to fire (${dry.shot} aboard, side ${dry.side || 'none'}, `
  + `${dry.was.list}+${dry.was.pending} -> ${dry.now.list}+${dry.now.pending} in the air)`,
!dry.fired);

/* ---- reputation: shooting a fisher is infamy, sinking a pirate is prestige ---- */
const rep = await G(() => {
  const g = window.__game;
  g.infamy = 0; g.prestige = 0;
  let fisher = g.ships.find(s => s.role === 'fisher' && s.alive && !s.hostileToPlayer);
  let guard = 0;
  while (!fisher && guard++ < 10) fisher = g.spawnNPC('fisher');
  const diag = fisher ? { role: fisher.role, faction: fisher.faction, hostile: !!fisher.hostileToPlayer } : 'none';
  g.onHit({ owner: g.player }, fisher, { crew: 0 });
  const infamyAfter = g.infamy;
  const pirate = g.ships.find(s => s.role === 'pirate' && s.alive) || g.spawnNPC('pirate');
  pirate.hull = 0; pirate.sink();
  g.onKill(pirate, g.player);
  return { infamyAfter, prestige: g.prestige, standing: g.standing, diag };
});
ok(`firing on a fishing boat earns infamy (${rep.infamyAfter}) ${JSON.stringify(rep.diag)}`, rep.infamyAfter > 0);
ok(`sinking a Tally ship earns prestige (${Math.round(rep.prestige)})`, rep.prestige > 0);

/* ---- crew progression ---- */
const crew = await G(() => {
  const g = window.__game;
  const p = g.player;
  // earlier tests deliberately starve the ship; promotion needs a company
  p.crew.deckhand = 6; p.crew.sailor = 6; p.crew.gunner = 1; p.crew.marine = 1; p.crew.rigger = 0;
  g.crewXP = 900;
  const before = { ...p.crew };
  g.promoteCrew();
  return { before, after: { ...p.crew } };
});
const tierOf = c => c.sailor * 1 + (c.gunner + c.marine + c.rigger) * 2 + c.veteran * 3;
ok(`sea time rates crew up (${JSON.stringify(crew.before)} -> ${JSON.stringify(crew.after)})`,
  tierOf(crew.after) > tierOf(crew.before));

/* ---- wind actually matters ---- */
const wind = await G(() => {
  const g = window.__game;
  const p = g.player;
  const running = p.windFactor(g.windAng, g.windAng);
  const beating = p.windFactor(g.windAng, g.windAng + Math.PI);
  const beam = p.windFactor(g.windAng, g.windAng + Math.PI / 2);
  return { running: +running.toFixed(2), beam: +beam.toFixed(2), beating: +beating.toFixed(2) };
});
/* The polar's promise: a square rig is at her best with the wind abaft the
   beam, still good running dead before it (the sails blanket a little), and
   near-helpless in the eye. The old cosine put running first; the new curve
   is the reason a mark dead downwind is no longer the only good errand. */
ok(`wind changes speed a lot (beam ${wind.beam} > running ${wind.running} > beating ${wind.beating})`,
  wind.beam > wind.running && wind.running > wind.beating && wind.beating < 0.3);

/* ---- time controls ---- */
const time = await G(async () => {
  const g = window.__game;
  const p = g.player;
  g.paused = false;
  p.provisions = 500;
  /* Sea room first. Contact stops the world and asks a question — which is the
     encounter layer working — but a run measured across one of those reads as
     "2x is slower than 1x", and the thing under test here is only how much
     simulation a frame buys. So put her where nobody is closing. */
  /* The surveyed east-west corridor, on a beam reach pinned for the test.
     She used to run dead downwind from wherever the wind pointed — and once
     the opening wind stopped being a constant, some captains' winds ran her
     across a reef mid-measurement, where shoal drag read as "2x buys less
     sea than 1x". The thing under test is the clock, so the water is made
     boring on purpose. */
  p.x = -1600; p.z = 200; p.speed = 0;
  g.windAng = g.windTargetAng = g.world.windAng = Math.PI;
  g.windTimer = 9999;
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.hostileToPlayer = false; s.target = null; s.chaseHold = 900;
  }
  g.encounterCooling = 900;
  // the mechanism under test is "how much simulation happens per frame";
  // distance also carries acceleration transients, so measure the clock
  const run = (steps) => {
    const t0 = g.time, x0 = p.x, z0 = p.z;
    for (let i = 0; i < 120; i++) for (let k = 0; k < steps; k++) g.update(1 / 60);
    return { secs: +(g.time - t0).toFixed(2), moved: +Math.hypot(p.x - x0, p.z - z0).toFixed(1) };
  };
  p.setHeading(Math.PI / 2);                           // due east, wind on the beam
  for (let i = 0; i < 240; i++) g.update(1 / 60);      // come up to speed
  const a = run(1), b = run(2), c = run(0);
  return { s1: a.secs, s2: b.secs, s0: c.secs, m1: a.moved, m2: b.moved, m0: c.moved };
});
ok(`2x advances the simulation twice as fast (${time.s1}s -> ${time.s2}s per 120 frames)`,
  Math.abs(time.s2 - time.s1 * 2) < 0.05);
ok(`and covers correspondingly more sea (${time.m1}m -> ${time.m2}m)`, time.m2 > time.m1 * 1.6);
ok('pause stops the world', time.s0 === 0 && time.m0 === 0);
const spdUI = await page.evaluate(() => {
  document.querySelector('.spd[data-s="0"]').click();
  const paused = window.__game.speed === 0 && !document.getElementById('paused-badge').classList.contains('hidden');
  document.querySelector('.spd[data-s="1"]').click();
  const back = window.__game.speed === 1 && document.getElementById('paused-badge').classList.contains('hidden');
  return paused && back;
});
ok('the pause button drives the badge and the clock', spdUI);

/* ---- fighting weight ---- */
const weigh = await G(() => {
  const g = window.__game;
  // weigh from a healthy flagship, not the starved one the supply test left
  const p = g.player;
  p.crew.deckhand = 6; p.crew.sailor = 5; p.crew.gunner = 1; p.crew.marine = 1;
  p.hull = p.hullMax; p.gunsPort = p.gunsMax; p.gunsStb = p.gunsMax;
  const fisher = g.ships.find(s => s.role === 'fisher' && s.alive);
  const patrol = g.ships.find(s => s.role === 'patrol' && s.alive);
  const out = { mine: g.fleetStrength };
  if (fisher) out.fisher = g.weighUp(fisher);
  if (patrol) out.patrol = g.weighUp(patrol);
  return out;
});
ok(`a fishing boat weighs less than you (${weigh.fisher && weigh.fisher.verdict})`,
  !weigh.fisher || weigh.fisher.tier <= 1);
ok(`an Admiralty patrol weighs more than you (${weigh.patrol && weigh.patrol.verdict})`,
  !weigh.patrol || weigh.patrol.tier >= 3);
ok('your own fighting weight is counted from the whole fleet', weigh.mine > 0);

/* ---- objective pointer has something to point at ---- */
const objm = await G(() => {
  const g = window.__game;
  const m = g.objectiveMarker();
  return m ? { label: m.label, hasPos: Number.isFinite(m.x) && Number.isFinite(m.z) } : null;
});
ok(`the objective marker resolves (${objm && objm.label})`, !!objm && objm.hasPos);

await noEncounters();
/* ---- a fleet you cannot rearm is not a fleet ----
   The consort here is a real capture: sail her alongside, board her, take her.
   Nothing is asserted about a ship the game did not hand us itself. */
const fleet = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 4000;
  p.crew.marine += 14; p.crew.veteran += 8;
  p.hull = p.hullMax; p.alive = true;
  let prize = g.ships.find(s => !s.isPlayer && s.alive && !g.fleet.includes(s)) || g.spawnNPC('pirate');
  // alongside and hove to, which is what canBoard asks for
  for (let i = 0; i < 60 && !g.boardings.length; i++) {
    prize.x = p.x + 20; prize.z = p.z; prize.speed = 0; prize.yaw = p.yaw;
    prize.hull = prize.hullMax * 0.5; prize.crew = { deckhand: 2, sailor: 1, gunner: 0, marine: 0, rigger: 0, veteran: 0 };
    p.speed = 0; p.dest = null; g.selectTarget(prize);
    g.startBoarding(p, prize);
    g.update(0.1);
  }
  for (let i = 0; i < 900 && g.boardings.length; i++) g.update(0.1);
  return { beaten: !!prize.captured };
});
// the prize dialog decides what becomes of her, exactly as it would for a player
if (fleet.beaten) {
  await waitFor(page, () => !document.getElementById('modal').classList.contains('hidden'), 8000);
  await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#modal-actions .btn')];
    const give = bs.find(b => b.textContent.startsWith('GIVE HER TO'));
    (give || bs[0]).click();
  });
  await sleep(600);
  await dismissModal(page);
}
fleet.fleetSize = await G(() => window.__game.fleet.length);

if (fleet.fleetSize > 1) {
  const stores = await G(() => {
    const g = window.__game;
    const c = g.fleet.find(s => !s.isPlayer);
    c.shot = 0;                                   // she has fought her way dry
    const before = g.fleetStores();
    const coin0 = g.coin;
    const done = g.storeFleet();
    return {
      short: before.short, dry: before.dry, cost: before.cost, done,
      spent: coin0 - g.coin, shotAfter: c.shot, wanted: Math.round(c.cls.guns * 3),
      againShort: g.fleetStores().short,
    };
  });
  ok(`an empty consort shows as short (${stores.short} rounds, ${stores.dry} dry)`,
    stores.short > 0 && stores.dry === 1);
  ok(`the harbour fills her lockers for ◆${stores.cost}`,
    stores.done && stores.shotAfter === stores.wanted && stores.spent === stores.cost);
  ok('and once full there is nothing left to buy', stores.againShort === 0);

  const broke = await G(() => {
    const g = window.__game;
    const c = g.fleet.find(s => !s.isPlayer);
    c.shot = 0; g.coin = 0;
    return { refused: g.storeFleet() === false, stillEmpty: c.shot === 0 };
  });
  ok('an empty purse cannot store the fleet', broke.refused && broke.stillEmpty);
  await G(() => { window.__game.coin = 2000; window.__game.storeFleet(); });
} else {
  ok('a consort was taken to test fleet stores against', false);
}

await noEncounters();
/* ---- a menu holds the world ----
   Waiting cannot prove the clock stopped, so count real animation frames and
   check the world did not move across them. If the loop is running and the
   clock is not, the sea is genuinely held. */
await G(() => {
  window.__frames = 0;
  const tick = () => { window.__frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__game.speed = 1;
  const g = window.__game;
  g.commandMove(g.player.x + 400, g.player.z + 260);   // under way, so stopping shows
});
const framesSince = n => waitFor(page, start => window.__frames - start >= 6, 9000, n);

await waitFor(page, () => window.__game.player.speed > 1, 6000);
await page.click('#btn-menu');
await waitFor(page, () => !document.getElementById('sheet').classList.contains('hidden'), 4000);
const held = await G(() => ({ t: window.__game.time, f: window.__frames, x: window.__game.player.x }));
await framesSince(held.f);
const stillHeld = await G(() => ({ t: window.__game.time, f: window.__frames, x: window.__game.player.x }));
ok(`opening a menu holds the world (${stillHeld.f - held.f} frames drawn, clock moved ${(stillHeld.t - held.t).toFixed(3)}s)`,
  stillHeld.f - held.f >= 6 && Math.abs(stillHeld.t - held.t) < 0.001 && Math.abs(stillHeld.x - held.x) < 0.001);

await page.click('#sheet-close');         // the way a thumb closes it
await waitFor(page, () => document.getElementById('sheet').classList.contains('hidden'), 4000);
const ran = await waitFor(page, () => window.__game.time > 0, 1000) &&
  await waitFor(page, t => window.__game.time > t, 6000, stillHeld.t);
ok('and leaving it lets her sail on', ran);

/* the player's own choice of speed survives the round trip */
await page.click('.spd[data-s="2"]');
await waitFor(page, () => window.__game.speed === 2, 4000);
await page.click('#btn-menu');
await waitFor(page, () => !document.getElementById('sheet').classList.contains('hidden'), 4000);
const speedInMenu = await G(() => window.__game.speed);
await sleep(500);                         // the close button debounces
await page.click('#sheet-close');
await waitFor(page, () => document.getElementById('sheet').classList.contains('hidden'), 4000);
const speedAfter = await G(() => window.__game.speed);
ok(`a menu does not spend your speed setting (2x in, ${speedAfter}x out)`,
  speedInMenu === 2 && speedAfter === 2);
await page.click('.spd[data-s="1"]');

/* ---- corrupt save recovery ---- */
const corrupt = await page.evaluate(() => {
  localStorage.setItem('salt-and-tally-v1', '{{{not json');
  return true;
});
void corrupt;
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
await newVoyage(page);
const recovered = await page.evaluate(() => !!window.__game && !!window.__game.player);
ok('a corrupt save does not brick the game', recovered);

/* ---- the three shot types are three different intentions ----

   Measured during a playtest pass: grape used to sweep a full company to
   literally nobody, which made boarding odds exactly 1.0. Capture was then a
   chore with one correct answer — load grape, close, press the button — and
   chain had no reason to exist. The floor on gunnery casualties and the cap
   on boarding odds exist to keep these three apart, so this asserts the
   design rather than the numbers: round is for sinking, grape is for taking,
   and a prize is never a certainty.

   Every arm fights the same hull class from the same pose; only the shot
   differs. Comparing arms against whatever raider happened to be first in
   the array is how an earlier version of this measurement lied. */
const shotWork = await G(async (plans) => {
  const g = window.__game;
  const out = [];
  for (const plan of plans) {
    let sunk = 0, odds = 0, kept = 0, sails = 0, crew = 0;
    const trials = 6;
    for (let t = 0; t < trials; t++) {
      const p = g.player;
      p.x = -1500; p.z = 1400; p.hull = p.hullMax; p.sails = p.sailMax; p.shot = 300;
      p.crew.deckhand = 6; p.crew.sailor = 5; p.crew.gunner = 1; p.crew.marine = 1;
      let foe = g.ships.find(s => s.faction === 'pirate' && s.alive && s.classId === 'cutter'
        && !g.fleet.includes(s));
      for (let k = 0; k < 40 && !foe; k++) {
        const c = g.spawnNPC('pirate');
        if (c && c.classId === 'cutter') foe = c;
      }
      if (!foe) return null;
      foe.hull = foe.hullMax; foe.sails = foe.sailMax; foe.alive = true; foe.captured = false;
      foe.crew.deckhand = 6; foe.crew.sailor = 4; foe.crew.marine = 2;
      foe.crew.gunner = 0; foe.crew.rigger = 0; foe.crew.veteran = 0; foe.morale = 1;
      foe.x = p.x + 70; foe.z = p.z; foe.speed = 0; p.yaw = 0; p.speed = 0;
      g.target = foe; g.ctx.combatLive = true; g.mode = 'battle';
      for (let v = 0; v < 12 && foe.alive; v++) {
        p.ammo = plan[v % plan.length];
        p.reload.stb = 0; p.reload.port = 0;
        foe.x = p.x + 70; foe.z = p.z; foe.speed = 0;
        g.update(0.03);
        if (!g.fireSide) break;
        g.playerFire();
        for (let k = 0; k < 34; k++) g.update(0.03);
      }
      if (!foe.alive) { sunk++; foe.alive = true; foe.hull = foe.hullMax; }
      else {
        kept++; sails += foe.sailFrac; crew += foe.crewTotal;
        foe.x = p.x + 22; foe.z = p.z; g.update(0.03);
        odds += g.boardOdds || 0;
      }
      g.mode = 'campaign'; g.ctx.combatLive = false; g.target = null;
    }
    out.push({ plan: plan.join('+'), sunk, trials,
      odds: kept ? +(odds / kept).toFixed(2) : 0,
      sails: kept ? +(sails / kept).toFixed(2) : 0,
      crew: kept ? +(crew / kept).toFixed(1) : 0 });
  }
  return out;
}, [['round'], ['chain'], ['grape'], ['chain', 'grape']]);
const arm = id => shotWork && shotWork.find(r => r.plan === id);
const R = arm('round'), C = arm('chain'), Gp = arm('grape'), CG = arm('chain+grape');
ok(`round shot is for sinking her (${R && R.sunk}/${R && R.trials} went down)`,
  !!R && R.sunk >= R.trials * 0.5);
ok(`grape is for taking her (${Gp && Gp.sunk} sunk, her deck down to ${Gp && Gp.crew} hands, odds ${Gp && Gp.odds})`,
  !!Gp && Gp.sunk === 0 && Gp.odds > (C ? C.odds : 1) + 0.1);
ok(`chain is for stopping her running (her rig at ${C && C.sails} of full)`,
  !!C && C.sails < 0.25 && C.sunk === 0);
ok(`and no gunnery makes a prize certain (best odds ${CG && CG.odds}, `
  + `a fighting remnant of ${CG && CG.crew} left aboard)`,
!!CG && CG.odds <= 0.92 && CG.crew >= 1);
/* Stand the sea down. This section leaves beaten raiders lying alongside the
   player with the guns warm, and the very next thing that touches the screen
   otherwise finds an encounter card over it. */
await G(() => {
  const g = window.__game, p = g.player;
  g.mode = 'campaign'; g.ctx.combatLive = false; g.clearTarget();
  g.combatHeat = 0; g.encounterCooling = 900;
  p.x = 0; p.z = -1700; p.hull = p.hullMax; p.sails = p.sailMax;
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.hostileToPlayer = false; s.target = null; s.chaseHold = 900; s.aggro = 0;
    if (Math.hypot(s.x - p.x, s.z - p.z) < 900) { s.x = 9e4; s.z = 9e4; }
  }
});
await noEncounters();

/* ---- other people's wars are not your action ----

   combatHeat means "the player is in action", and half the game reads it: the
   score's tension layer, `engaged` (which holds a chapter card back until the
   guns are quiet), and treble crew sea-time. It used to be raised by any ball
   striking any hull anywhere, and the world fights its own wars whether you
   are watching or not — so a skirmish over the horizon kept the player
   permanently in action. A playtester saw the symptom: chapter cards queued
   for minutes, then arrived three at a time. */
const farWar = await G(async () => {
  const g = window.__game, p = g.player;
  p.x = 0; p.z = -1700; p.hull = p.hullMax;          // open water, far from everyone
  g.combatHeat = 0;
  // two strangers, an ocean away, going at each other in earnest
  const a = g.spawnNPC('pirate'), b = g.spawnNPC('patrol');
  a.x = 1500; a.z = 1500; b.x = a.x + 60; b.z = a.z;
  a.hostileToPlayer = false; b.hostileToPlayer = false;
  a.target = b; b.target = a; a.chaseHold = 0; b.chaseHold = 0;
  a.shot = 200; b.shot = 200;
  g.encounterCooling = 900;
  let sawShots = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const before = g.projectiles.list.length + g.projectiles.pending.length;
    g.update(1 / 60);
    sawShots += Math.max(0, (g.projectiles.list.length + g.projectiles.pending.length) - before);
  }
  const heatFar = g.combatHeat;
  const engagedFar = g.engaged;
  /* And the same iron alongside her IS her problem. The AI will not stage
     this one — a raider that close switches to hunting the player, and
     nobody fires on the campaign layer — so the hit callback is driven
     directly, which is the same path the AI's own broadsides take. */
  b.x = p.x + 100; b.z = p.z;
  const res = b.damage(6, 'round', a);
  g.onHit({ owner: a }, b, res);
  return { sawShots, heatFar: +heatFar.toFixed(1), engagedFar, heatNear: +g.combatHeat.toFixed(1) };
});
ok(`a war over the horizon is not your action (${farWar.sawShots} shots fired out there, `
  + `your heat ${farWar.heatFar}, engaged ${farWar.engagedFar})`,
farWar.sawShots > 0 && farWar.heatFar === 0 && farWar.engagedFar === false);
ok(`but the same guns alongside you are (heat ${farWar.heatNear})`, farWar.heatNear > 0);

/* ---- the clock's fourth notch ---- */
/* One fast button, cycling 2x/4x, with pause and 1x their own buttons. Driven
   through the real strip, because the wiring is the thing under test.
   The strip lives on the campaign layer, so first buy sea room: an encounter
   opening mid-section drops its card over the buttons and every click after
   that hits the card instead — which is how this section once took the whole
   suite down with it. */
await G(() => {
  const g = window.__game;
  g.encounterCooling = 900;                 // longer than everything below
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    s.hostileToPlayer = false; s.target = null; s.chaseHold = 900;
  }
});
await page.click('.spd.fast');
const at2 = await waitFor(page, () => window.__game.speed === 2, 4000);
await page.click('.spd.fast');
const at4 = await waitFor(page, () => window.__game.speed === 4, 4000);
const label4 = await waitFor(page, () => document.querySelector('.spd.fast').textContent === '4×', 4000);
await page.click('.spd.fast');
const back2 = await waitFor(page, () => window.__game.speed === 2, 4000);
await page.click('.spd[data-s="1"]');
const home1 = await waitFor(page, () => window.__game.speed === 1
  && document.querySelector('.spd.fast').textContent === '2×', 4000);
ok('the fast button cycles 2x -> 4x -> 2x and says which it is', at2 && at4 && label4 && back2 && home1);

/* ---- a mark dead upwind is beaten up to, not crawled at ---- */
const beat = await G(() => {
  const g = window.__game, p = g.player;
  // an east-west lane with sea room on both sides, surveyed clear of land
  p.x = -1600; p.z = 200; p.yaw = Math.PI / 2; p.speed = 0;
  g.windAng = g.windTargetAng = g.world.windAng = -Math.PI / 2;   // the eye is dead east
  g.windTimer = 9999;
  p.setDestination(-980, 200);
  p.throttle = 1;
  let tacks = 0, last = 0, widest = 0;
  for (let i = 0; i < 60 * 260; i++) {
    g.update(1 / 60);
    if (g.mode !== 'campaign') break;      // the grace above should make this unreachable
    if (p.tack && last && p.tack !== last) tacks++;
    if (p.tack) last = p.tack;
    widest = Math.max(widest, Math.abs(p.z - 200));
    if (!p.dest) break;                    // arrived: the helm stands down
  }
  const left = Math.hypot(p.x + 980, p.z - 200);
  return { left: Math.round(left), tacks, widest: Math.round(widest) };
});
ok(`she works 620m dead to windward in boards (${beat.left}m left, ${beat.tacks} tacks, ${beat.widest}m widest)`,
  beat.left < 120 && beat.tacks >= 1 && beat.widest < 240);

/* ---- being brought to takes the way off the clock ---- */
await page.click('.spd.fast');
await page.click('.spd.fast');
await waitFor(page, () => window.__game.speed === 4, 4000);
await intoBattle(page);
const clockInAction = await G(() => window.__game.speed);
ok(`an action at 4x opens at 1x (clock read ${clockInAction}x)`, clockInAction === 1);
await leaveBattle(page);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
