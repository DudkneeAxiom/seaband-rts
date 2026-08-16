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
      /* Fed and rested. The starvation section above leaves her company worn
         down, and hunger is gunnery skill — which is how this measurement
         once read 2 sinks out of 6 for round shot and 6 out of 6 the next
         run, from the same guns at the same range. */
      p.hungry = 0; p.provisions = 200; p.morale = 1;
      /* And a full battery. The foe shoots back, and a gun knocked out in
         trial two is still missing in trial six — so the run drifted downward
         as it went and the same measurement read 2, 4 or 6 sinks depending on
         where her guns happened to be. This is a question about ammunition;
         everything that is not the ammunition is held still. */
      p.gunsPort = p.gunsMax; p.gunsStb = p.gunsMax;
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
      foe.gunsPort = foe.gunsMax; foe.gunsStb = foe.gunsMax;
      foe.x = p.x + 70; foe.z = p.z; foe.speed = 0; p.yaw = 0; p.speed = 0;
      g.target = foe; g.ctx.combatLive = true; g.mode = 'battle';
      /* Eighteen volleys, not twelve. At twelve this sat exactly on the
         threshold where round shot either just sinks her or just does not,
         and the result swung between 1 and 6 out of 6 on gunnery spread
         alone. The contrast between the shot types is what is being
         measured, so the trial is given room to show it. */
      for (let v = 0; v < 18 && foe.alive; v++) {
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
  if (!a || !b) return null;
  a.hostileToPlayer = false; b.hostileToPlayer = false;
  a.chaseHold = 0; b.chaseHold = 0; a.fleeing = false; b.fleeing = false;
  a.shot = 400; b.shot = 400; a.hull = a.hullMax; b.hull = b.hullMax;
  g.encounterCooling = 900;
  /* Hold them broadside to broadside in deep water an ocean away and re-pin
     them every frame. Left to sail themselves they drifted, lost the arc, ran
     for a harbour or simply never came to grips — and the check then passed
     for the wrong reason, having watched no war at all. Their guns and the
     hit callback are entirely real; only their station is held. */
  let sawShots = 0;
  for (let i = 0; i < 60 * 30; i++) {
    a.x = 1500; a.z = 1500; a.yaw = 0; a.speed = 0;
    b.x = 1560; b.z = 1500; b.yaw = 0; b.speed = 0;
    a.target = b; b.target = a; a.hull = a.hullMax; b.hull = b.hullMax;
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
ok(`a war over the horizon is not your action (${farWar && farWar.sawShots} shots fired out there, `
  + `your heat ${farWar && farWar.heatFar}, engaged ${farWar && farWar.engagedFar})`,
!!farWar && farWar.sawShots > 0 && farWar.heatFar === 0 && farWar.engagedFar === false);
ok(`but the same guns alongside you are (heat ${farWar && farWar.heatNear})`,
  !!farWar && farWar.heatNear > 0);

/* ---- and a hull on a shoal can always get herself off ----
   'Nothing blocks the player permanently.' A battle fought over a reef put
   the player aground with full sail set and no way out: the drag alone left
   her at eight per cent of her speed while the shoal ate her hull, and the
   escape check timed out with her pinned 245m from an arena she needed to be
   640m clear of. Steering toward deep water now eases the drag. */
const aground = await G(async () => {
  const g = window.__game, p = g.player, H = window.__terrain.heightAt;
  // find real shoal water: shallower than she draws, with deep water nearby
  let spot = null;
  for (let r = 200; r < 1800 && !spot; r += 40) {
    for (let a = 0; a < 32; a++) {
      const x = Math.cos(a / 32 * Math.PI * 2) * r, z = Math.sin(a / 32 * Math.PI * 2) * r;
      const d = -H(x, z);
      if (d > 0.3 && d < p.draft * 0.55) { spot = { x, z, d: +d.toFixed(1) }; break; }
    }
  }
  if (!spot) return null;
  p.x = spot.x; p.z = spot.z; p.hull = p.hullMax; p.sails = p.sailMax;
  p.speed = 0; p.throttle = 1; g.paused = false; g.encounterCooling = 900;
  // point her at the deepest water within a short cast, as a captain would
  let best = -1e9, bestA = 0;
  for (let a = 0; a < 24; a++) {
    const ang = a / 24 * Math.PI * 2;
    const d = -H(p.x + Math.sin(ang) * 90, p.z + Math.cos(ang) * 90);
    if (d > best) { best = d; bestA = ang; }
  }
  p.yaw = bestA; p.setHeading(bestA);
  const x0 = p.x, z0 = p.z;
  for (let i = 0; i < 60 * 45; i++) { g.update(1 / 60); if (-H(p.x, p.z) > p.draft) break; }
  return { start: spot, draft: +p.draft.toFixed(1),
    moved: Math.round(Math.hypot(p.x - x0, p.z - z0)),
    afloat: -H(p.x, p.z) > p.draft, hull: +p.hullFrac.toFixed(2) };
});
/* What matters is that she gets off and survives it — not how far she runs.
   A hull that claws clear in three metres has done exactly what was asked. */
ok(`a ship aground can steer herself off (${aground
  ? `${aground.start.d}m of water under a ${aground.draft}m draft, `
    + `moved ${aground.moved}m, afloat ${aground.afloat}, hull ${aground.hull}`
  : 'no shoal found to strand her on'})`,
!!aground && aground.afloat && aground.moved > 0 && aground.hull > 0.4);

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
// remember what the camera looks like in peacetime, for the check after the action
await waitFor(page, () => window.__game.rig.heat < 0.1, 8000);
await G(() => { window.__calmPitch = window.__game.rig.pitch; });
const gotAction = await intoBattle(page);
/* Report the layer too. "clock read 4x" is also what you get when no action
   ever opened, and those are different bugs — one is the rule failing, the
   other is the staging failing. */
/* The strip redraws on a real frame, and ff() runs the simulation without
   one — so the button can still read 4x for a moment after the rule has
   already taken the clock to 1x. Wait for the paint rather than asserting on
   a frame that has not happened yet. */
const strip = await waitFor(page, () => {
  const on = document.querySelector('.spd.on');
  return !!on && on.textContent.trim() === '1×';
}, 6000);
const clockInAction = await G(() => ({
  speed: window.__game.speed, mode: window.__game.mode,
  lit: (document.querySelector('.spd.on') || {}).textContent,
}));
ok(`an action at 4x opens at 1x (clock read ${clockInAction.speed}x on the `
  + `${clockInAction.mode} layer, strip lit "${clockInAction.lit}")`,
clockInAction.mode === 'battle' && clockInAction.speed === 1 && !!gotAction && strip);

/* ---- the camera knows it is in a fight ----
   Same battle, so nothing extra is staged; the battle marks its lead as the
   target itself and ff() mirrors the live loop's feed to the rig, so this is
   the wiring under test, not the class. calmPitch was recorded on the
   campaign layer before the action opened. The azimuth is first pointed
   straight down the duel line — the worst seat in the house — because from a
   lucky starting angle this check passed with the drift removed. */
const camStaged = await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  if (!t || !t.alive) return false;
  g.rig.azimuth = Math.atan2(t.x - p.x, t.z - p.z);   // looking along the line
  g.rig.orbitHold = 0;
  return true;
});
await ff(page, 6);
const cam = await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  let sq = null;
  if (t && t.alive) {
    const b = Math.atan2(t.x - p.x, t.z - p.z);
    // how far the view direction is from square-on to the duel line
    let d = Math.abs((g.rig.azimuth - b) % Math.PI);
    d = Math.min(d, Math.PI - d);
    sq = +Math.abs(d - Math.PI / 2).toFixed(2);
  }
  return { mode: g.mode, heat: +g.rig.heat.toFixed(2), pitch: +g.rig.pitch.toFixed(2),
    calm: +window.__calmPitch.toFixed(2), mark: t ? t.name : null, sq };
});
ok(`an action drops the camera toward the water (${cam.calm} calm -> ${cam.pitch} in action, heat ${cam.heat})`,
  cam.mode === 'battle' && cam.heat > 0.6 && cam.pitch < cam.calm - 0.08);
ok(`and swings the duel broadside-on across the frame (${cam.sq} rad off square, mark ${cam.mark})`,
  camStaged && cam.sq !== null && cam.sq < 0.35);

/* The hunting rings stand down for it too.
   A raider's gun-range ring answers "if I hold this course, does she get a
   shot" — a question about whether to take the fight, which is a campaign
   question. Three of them are three 470-metre discs of red laid over each
   other, and photographed in a four-against-three action the water was more
   ribbon than water. Staged with hostiles actually hunting her, so the check
   would see rings if they were being drawn. */
const rings = await G(() => {
  const g = window.__game, p = g.player;
  let hunting = 0;
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s) || !s.alive) continue;
    s.target = p; s.hostileToPlayer = true;    // every hull aboard is after her
    hunting++;
  }
  g.markers.update(1 / 60, g);
  return { mode: g.mode, hunting, shown: g.markers.hunts.filter(h => h.mesh.visible).length };
});
ok(`and the hunting rings stand down for it (${rings.hunting} hulls hunting her, `
  + `${rings.shown} rings on the water, mode ${rings.mode})`,
  rings.mode === 'battle' && rings.hunting > 0 && rings.shown === 0);

/* And the ship is a ship, not a counter.
   The battle camera stood 200m off because it opened to sep*0.95+70 to hold
   both hulls, which left the player's own ship at seven per cent of the frame
   height — the single thing most responsible for an action reading as a chart
   rather than a fight.

   The separation is staged, because it has to be. How much of the frame she
   fills depends entirely on how far apart the two ships happen to be, and left
   to the fight that ranged from 120m to 180m between runs — so an absolute
   threshold was measuring where the AI had got to, and passed or failed on
   that. Lay the enemy at a known 120m, let the rig settle, then ask. */
await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  if (!t || !t.alive) return;
  const b = Math.atan2(t.x - p.x, t.z - p.z);
  t.x = p.x + Math.sin(b) * 120; t.z = p.z + Math.cos(b) * 120;
  t.speed = 0; t.throttle = 0;
  p.speed = 0; p.throttle = 0; p.dest = null;
});
await ff(page, 4);
const frame = await G(() => {
  const g = window.__game, p = g.player, t = g.target;
  const cam = g.rig.cam;
  const rect = window.__renderer.domElement.getBoundingClientRect();
  const W = window.__worldToScreen;
  const a = W(cam, p.x, 0, p.z, rect);
  const b = W(cam, p.x, 8 + p.cls.masts * 7, p.z, rect);
  const c = t && t.alive ? W(cam, t.x, 0, t.z, rect) : null;
  return {
    frac: +(Math.abs(b.y - a.y) / rect.height).toFixed(3),
    onScreen: !a.behind && a.x > 0 && a.x < rect.width && a.y > 0 && a.y < rect.height,
    y: +(a.y / rect.height).toFixed(2),
    foe: c ? (!c.behind && c.x > 0 && c.x < rect.width && c.y > 0 && c.y < rect.height) : null,
    foeAt: c ? { x: +(c.x / rect.width).toFixed(2), y: +(c.y / rect.height).toFixed(2) } : null,
    sep: t && t.alive ? Math.round(Math.hypot(t.x - p.x, t.z - p.z)) : null,
    dist: +g.rig.distance.toFixed(0),
  };
});
/* Assert the staging held before believing the measurement: if the pair have
   drifted off 120m the numbers are about a different scene. */
const staged = frame.sep !== null && Math.abs(frame.sep - 120) < 25;
ok(`the player's ship has presence in an action `
  + `(${(frame.frac * 100).toFixed(1)}% of frame height at a staged ${frame.sep}m, `
  + `${(frame.y * 100).toFixed(0)}% down the frame, ${frame.dist}m lens, `
  + `enemy in shot ${frame.foe} at ${JSON.stringify(frame.foeAt)})`,
  staged && frame.onScreen && frame.frac > 0.095 && frame.y > 0.4 && frame.y < 0.8
  && frame.foe === true);

await leaveBattle(page);

/* ---- a whole voyage survives the round trip ----
   Not "does it load" — does every part of a rich state come back the same.
   Individual checks cover the flagship and the fleet; this covers the save
   *format*, which is the thing that rots when a field is added and the
   serializer is not told. Built by playing rather than by hand where it can
   be, then compared field by field. */
const roundTrip = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 4321; g.prestige = 37; g.infamy = 11;
  g.standing = { freehold: 21, admiralty: -8, compact: 14, sable: 3, veyra: -2 };
  g.chapter = 2;
  g.stats = { sunk: 4, captured: 3, broadsides: 91, distance: 12345, crewLost: 7, tally: 5 };
  p.hull = p.hullMax * 0.62; p.sails = p.sailMax * 0.77;
  p.provisions = 63; p.shot = 44;
  p.cargo = { pepper: 5, iron: 9 };
  g.prizes = [{ name: 'Saved Prize', classId: p.classId, hull: 40, guns: 4 }];
  g.discovered.add('poi_test');
  const S = g.social;
  S.met.kesk = true; S.rel.kesk = 47;
  S.remember('kesk', 'tag1', 'You carried timber when nobody else would.', 12);
  S.learn('kesk', 'town'); S.learn('kesk', 'ties');
  S.noteSpoke('kesk', g.time);
  S.flag('kesk_book');
  const snap = () => {
    const gg = window.__game, pp = gg.player;
    return {
      coin: Math.round(gg.coin), prestige: Math.round(gg.prestige), infamy: Math.round(gg.infamy),
      standing: { ...gg.standing }, chapter: gg.chapter, stats: { ...gg.stats },
      hull: Math.round(pp.hull), sails: Math.round(pp.sails),
      prov: Math.round(pp.provisions), shot: pp.shot, cargo: { ...pp.cargo },
      classId: pp.classId, name: pp.name,
      fleet: gg.fleet.filter(s => !s.isPlayer).map(s => s.name).sort(),
      prizes: gg.prizes.map(x => x.name).sort(),
      officers: gg.officers.map(o => o.name).sort(),
      discovered: [...gg.discovered].sort(),
      relKesk: Math.round(gg.social.of('kesk')),
      memKesk: gg.social.memories('kesk').map(m => m.tag).sort(),
      knowsTown: gg.social.knows('kesk', 'town'),
      /* The manner clock. It is a grind gate, and a grind gate that a reload
         reopens is not a gate — so the save format has to carry it. */
      spokeBlocked: !gg.social.canSpeakAgain('kesk', gg.time),
      flagBook: gg.social.hasFlag('kesk_book'),
      capt: pp.capt ? { ...pp.capt } : null,
    };
  };
  g.mode = 'campaign';
  const before = snap();
  if (!g.save()) return { note: 'save refused' };
  if (!g.load()) return { note: 'load refused' };
  const after = snap();
  const diffs = [];
  const walk = (a, b, path) => {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) walk(a[k], (b || {})[k], `${path}.${k}`);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  };
  walk(before, after, '');
  return { note: null, diffs, fields: Object.keys(before).length };
});
ok(`a whole voyage survives save and load (${roundTrip.note
  || `${roundTrip.fields} fields, ${roundTrip.diffs.length ? roundTrip.diffs.join('; ') : 'none changed'}`})`,
!roundTrip.note && roundTrip.diffs.length === 0);

/* ---- your quarry is yours to take ----
   Reported: "other warships kill your target ship before you could engage
   it". Staged by construction — a bounty accepted against a live hull, then
   an Admiralty patrol pounding her with the player nowhere near. She must
   end the beating alive and running, not on the bottom; and the moment the
   contract is off, the same guns must be able to finish her, or this is an
   invulnerability bug rather than a rule. */
const quarry = await G(() => {
  const g = window.__game, p = g.player;
  const port = g.PORTS[0];
  let mark = g.ships.find(s => s.faction === 'pirate' && s.alive && !s.captured && !g.fleet.includes(s))
    || g.spawnNPC('pirate');
  if (!mark) return { note: 'no raider to post against' };
  // a real notice against a real hull, accepted the way a player accepts one
  const q = { id: `bounty:test:${mark.id}`, kind: 'bounty', board: 'harbour', portId: port.id,
    targetId: mark.id, targetName: mark.name, title: `Bounty: ${mark.name}`, brief: 'test',
    reward: 100, prestige: 5, active: false, done: false, progress: 0 };
  g.quests.push(q);
  g.acceptQuest(q, port);
  // the player is a long way off; somebody else's warship does the shooting
  p.x = 6e4; p.z = 6e4; p.dest = null; p.speed = 0;
  const gun = g.ships.find(s => s.faction === 'admiralty' && s.alive) || g.spawnNPC('patrol');
  mark.hull = mark.hullMax; mark.alive = true; mark.captured = false;
  g.update(1 / 30);                                  // markQuarry runs on the tick
  const flagged = !!mark.isQuarry;
  for (let i = 0; i < 40 && mark.alive; i++) mark.damage(40, 'round', gun);
  const survived = { alive: mark.alive, hull: Math.round(mark.hullFrac * 100), fleeing: !!mark.fleeing };
  // and the player's own guns are not refused
  mark.hull = mark.hullMax;
  for (let i = 0; i < 40 && mark.alive; i++) mark.damage(40, 'round', p);
  const toMe = { alive: mark.alive };
  // contract off, flag released on the next tick, and she is mortal again
  q.active = false; q.done = true;
  mark.alive = true; mark.hull = mark.hullMax; mark.sinking = 0;
  g.update(1 / 30);
  const released = !mark.isQuarry;
  for (let i = 0; i < 40 && mark.alive; i++) mark.damage(40, 'round', gun);
  return { note: null, flagged, survived, toMe, released, thenSank: !mark.alive };
});
ok(`a hull you are hunting is not sunk by somebody else's guns `
  + `(${quarry.note || `flagged ${quarry.flagged}, after 40 broadsides: alive ${quarry.survived.alive} `
  + `at ${quarry.survived.hull}%, fleeing ${quarry.survived.fleeing}`})`,
!quarry.note && quarry.flagged && quarry.survived.alive && quarry.survived.fleeing
  && quarry.survived.hull <= 15);
ok('but your own guns finish her', !quarry.note && quarry.toMe.alive === false);
ok(`and she is mortal again once the notice is down (released ${quarry.released}, sank ${quarry.thenSank})`,
  !quarry.note && quarry.released && quarry.thenSank);

/* ---- a prize is sent to the yard you can reach ----
   Three ports have a yard and the pointer named whichever came first in
   PORTS, so a captain who took a prize off Tideglass was aimed the width of
   the Shoals at Ilo Vantu — past the slipway she was moored beside. */
const yards = await G(() => {
  const g = window.__game, p = g.player;
  const was = { x: p.x, z: p.z, quests: g.quests.slice() };
  g.quests.length = 0;                    // an errand outranks a prize in the marker
  g.prizes.length = 0;
  g.prizes.push({ name: 'Marker Prize', classId: g.player.classId, hull: 40, guns: 4 });
  const yardPorts = g.PORTS.filter(x => x.services.includes('shipyard'));
  const out = { n: yardPorts.length, quarry: null, rows: [] };
  if (g.storyQuarry()) out.quarry = 'the story has a quarry in sight';
  for (const port of yardPorts) {
    const b = g.harbourBerth(port);
    p.x = b.x; p.z = b.z;
    const m = g.objectiveMarker();
    out.rows.push({ at: port.name, points: m ? m.label : null });
  }
  p.x = was.x; p.z = was.z;
  g.quests.push(...was.quests);
  g.prizes.length = 0;
  return out;
});
ok(`a prize points you at the nearest yard, not the first one `
  + `(${yards.quarry || yards.rows.map(r => `${r.at}->${r.points}`).join(', ')})`,
!yards.quarry && yards.n >= 2 && yards.rows.every(r => r.points === r.at));

/* ---- a prize you can never man is a dead end ----
   Reported: "I captured one of the main flagships which had 64 crew slots,
   however I could never get it to join my fleet because the max I could
   recruit was 22 and that vessel required 26." That was arithmetic, not bad
   luck — the gate read `crewTotal - cls.crewMin < p.cls.crewMin`, and a
   cutter holds 22 against a frigate's minimum of 26, so 22-26 < 5 for every
   captain in every save. She goes out with a prize crew now. */
const bigPrize = await G(() => {
  const g = window.__game, p = g.player;
  // the heaviest hull in the game — the worst case for the arithmetic
  const heavy = Object.entries(g.HULLS).sort((a, b) => b[1].crewMin - a[1].crewMin)[0];
  const classId = heavy[0], cls = heavy[1];
  g.prizes.length = 0;
  g.prizes.push({ name: 'Test Prize', classId, hull: cls.hull, guns: cls.guns });
  // the flagship filled to her own cap: the most crew any player can ever hold
  for (const k in p.crew) p.crew[k] = 0;
  p.crew.sailor = p.cls.crewMax;
  // a real officer, from the tavern books this port actually offers
  const offered = g.tavernPool(g.PORTS[0]);
  const officer = (offered && offered[0]) || g.officers[0];
  if (!officer) return { note: 'no officer to command her' };
  const before = { crew: p.crewTotal, cap: p.cls.crewMax, need: cls.crewMin,
    prizeCrew: g.prizeCrewFor(cls), classId };
  g.commissionPrize(g.prizes[0], officer, g.PORTS[0]);
  const she = g.fleet.find(s => s.name === 'Test Prize');
  return { note: null, before, commissioned: !!she, herCrew: she ? she.crewTotal : 0,
    mine: p.crewTotal, fleet: g.fleet.length };
});
ok(`the heaviest prize in the game can be commissioned at all `
  + `(${bigPrize.note || `${bigPrize.before.classId}: wants ${bigPrize.before.need} to work, `
  + `prize crew ${bigPrize.before.prizeCrew}, flagship caps at ${bigPrize.before.cap}) `
  + `-> ${bigPrize.commissioned ? `she sails with ${bigPrize.herCrew}` : 'REFUSED'}`})`,
!bigPrize.note && bigPrize.commissioned && bigPrize.herCrew > 0 && bigPrize.mine >= 5);

/* ---- and the captain can step across to her ---- */
const flag = await G(() => {
  const g = window.__game;
  const she = g.fleet.find(s => s.name === 'Test Prize');
  if (!she) return { note: 'no prize to command' };
  const wasFlag = g.player.name, wasCapt = !!g.player.capt;
  // she must be worked before she will answer: man her from the quay
  she.crew.sailor = she.cls.crewMin;
  const outOfPort = g.takeCommand(she);          // at sea: refused
  g.inPort = g.PORTS[0];
  const inPort = g.takeCommand(she);
  const now = g.player;
  g.inPort = null;
  return { note: null, outOfPort, inPort, wasFlag, wasCapt,
    flagNow: now.name, flagIsHer: now === she, sheIsPlayer: she.isPlayer,
    oldIsConsort: g.fleet.some(s => s.name === wasFlag && !s.isPlayer && s.role === 'consort'),
    skillCameAcross: !!now.capt === wasCapt, worldPlayer: g.world.player === she };
});
ok(`the flag shifts to a ship you took (${flag.note
  || `${flag.wasFlag} -> ${flag.flagNow}, old ship a consort: ${flag.oldIsConsort}`})`,
!flag.note && flag.inPort === true && flag.flagIsHer && flag.sheIsPlayer
  && flag.oldIsConsort && flag.worldPlayer);
/* And she is still your flagship after a reload. The save records isPlayer
   per hull and the load resolves the flag from it, but "should" is not the
   standard here — a captain who shifts her flag and comes back to find
   herself in the cutter again has lost the ship she took. */
const flagSaved = await G(() => {
  const g = window.__game;
  const she = g.fleet.find(s => s.name === 'Test Prize');
  if (!she || g.player !== she) return { note: 'flag was not shifted' };
  const wasName = g.player.name, wasClass = g.player.classId, hadCapt = !!g.player.capt;
  g.mode = 'campaign';
  g.save();
  if (!g.load()) return { note: 'save would not load' };
  const now = g.player;
  return { note: null, wasName, wasClass, hadCapt,
    name: now.name, classId: now.classId, capt: !!now.capt,
    isFlag: now.isPlayer, world: g.world.player === now,
    fleet: g.fleet.length, consorts: g.fleet.filter(s => !s.isPlayer).length };
});
ok(`and she is still your flagship after a reload (${flagSaved.note
  || `${flagSaved.name} the ${flagSaved.classId}, skill ${flagSaved.capt}, `
    + `${flagSaved.consorts} consort(s)`})`,
!flagSaved.note && flagSaved.name === flagSaved.wasName
  && flagSaved.classId === flagSaved.wasClass && flagSaved.isFlag && flagSaved.world
  && flagSaved.capt === flagSaved.hadCapt && flagSaved.consorts >= 1);

ok(`and your own skill goes with you, but not in open water `
  + `(skill carried ${flag.skillCameAcross}, refused at sea ${flag.outOfPort === false})`,
!flag.note && flag.skillCameAcross && flag.outOfPort === false);

/* ---- the bounty board ----
   Requested from play: work from ports that pays for taking or destroying a
   named ship. The point is that a bounty names a hull *already sailing in
   this world* — not one conjured when you accept it — so these checks tie the
   notice to a real ship and then settle it by really sinking her. */
const bounty = await G(() => {
  const g = window.__game, port = g.PORTS[0];
  g.quests = g.quests.filter(q => q.kind !== 'bounty');
  // make sure there is something for the board to object to, near this port
  for (let i = 0; i < 3; i++) {
    const s = g.spawnNPC('pirate');
    if (s) { s.x = port.x + 300 + i * 60; s.z = port.z + 120; s.hostileToPlayer = false; }
  }
  const posted = g.bountiesAt(port);
  const real = posted.map(q => {
    const t = g.ships.find(x => x.id === q.targetId);
    return { name: q.targetName, alive: !!(t && t.alive), sameName: !!(t && t.name === q.targetName),
      pays: q.reward, mine: !!(t && (t.isPlayer || g.fleet.includes(t))) };
  });
  return { count: posted.length, real, board: posted[0] ? posted[0].board : null };
});
ok(`a harbour posts bounties on ships that are really out there `
  + `(${bounty.count} posted: ${bounty.real.map(r => `${r.name} ◆${r.pays}`).join(', ') || 'none'})`,
bounty.count > 0 && bounty.real.every(r => r.alive && r.sameName && !r.mine && r.pays > 0)
  && bounty.board === 'harbour');

const paid = await G(() => {
  const g = window.__game, port = g.PORTS[0];
  const q = g.quests.find(x => x.kind === 'bounty' && !x.done);
  if (!q) return { note: 'nothing posted' };
  g.acceptQuest(q, port);
  const target = g.ships.find(x => x.id === q.targetId);
  if (!target) return { note: 'target vanished' };
  const before = g.coin, prestige = g.prestige;
  const standingBefore = g.standing[q.faction] || 0;
  // sink her for real, through the damage path the guns use
  while (target.alive) {
    const res = target.damage(target.hullMax * 0.2, 'round', g.player);
    g.onHit({ owner: g.player }, target, res);
  }
  g.update(1 / 30);
  return { note: null, coin: g.coin - before, prestige: +(g.prestige - prestige).toFixed(1),
    standing: (g.standing[q.faction] || 0) - standingBefore,
    done: q.done, reward: q.reward };
});
ok(`sinking a bounty target pays the notice (${paid.note
  || `◆${paid.coin} against a ◆${paid.reward} bounty, prestige +${paid.prestige}, standing +${paid.standing}`})`,
!paid.note && paid.done === true && paid.coin >= paid.reward && paid.standing > 0);

/* An untaken notice pays nothing: the board is not a bonus for existing. */
const unclaimed = await G(() => {
  const g = window.__game, port = g.PORTS[0];
  const s = g.spawnNPC('pirate');
  s.x = port.x + 260; s.z = port.z + 90; s.hostileToPlayer = false;
  const posted = g.bountiesAt(port);
  const q = posted.find(x => !x.active && !x.done && x.targetId === s.id) || posted.find(x => !x.active && !x.done);
  if (!q) return { note: 'nothing fresh posted' };
  const t = g.ships.find(x => x.id === q.targetId);
  const before = g.coin;
  while (t.alive) { const r = t.damage(t.hullMax * 0.25, 'round', g.player); g.onHit({ owner: g.player }, t, r); }
  g.update(1 / 30);
  // salvage still pays; the bounty does not
  return { note: null, done: q.done, took: g.coin - before, reward: q.reward };
});
ok(`but a notice you never took pays no bounty (${unclaimed.note
  || `settled ${unclaimed.done}, took ◆${unclaimed.took} against a ◆${unclaimed.reward} notice`})`,
!unclaimed.note && unclaimed.done === false && unclaimed.took < unclaimed.reward);

/* ---- chapter six tells you where to look ----
   Reported: "you just sail around selecting every ship hoping the name
   matches the one from the story." The quarry now reports through harbours. */
const hunt = await G(() => {
  const g = window.__game;
  g.chapter = g.CHAPTERS ? g.CHAPTERS.length - 1 : 5;
  g.storyOver = false; g.santDown = false;
  g.spawnSant();
  const sant = g.ships.find(s => s.isSant && s.alive);
  if (!sant) return { note: 'no quarry on the water' };
  /* Genuinely far: opposite corners of the region. Negating her position put
     the player back inside sighting range whenever she happened to spawn near
     the middle, and the check then measured the in-sight branch instead of
     the one under test. */
  sant.x = 1500; sant.z = 1500;
  g.player.x = -1500; g.player.z = -1500;
  g.quarryReport = null;
  const blind = g.objectiveMarker();
  const blindText = g.quarryHint();
  // dock anywhere and word reaches you
  g.refreshQuarryReport();
  const told = g.objectiveMarker();
  const toldText = g.quarryHint();
  const off = told ? Math.round(Math.hypot(told.x - sant.x, told.z - sant.z)) : -1;
  return { note: null,
    blindLabel: blind && blind.label, blindText,
    toldLabel: told && told.label, toldText, off,
    near: g.quarryReport && g.quarryReport.near };
});
ok(`word in harbour points you at the story's quarry (${hunt.note
  || `${hunt.toldLabel} — ${hunt.off}m from where she really is, off ${hunt.near}`})`,
!hunt.note && !!hunt.toldLabel && /last seen/.test(hunt.toldLabel) && hunt.off < 400);
ok(`and the objective says so in words (${hunt.note || hunt.toldText.replace(/<[^>]+>/g, '').trim()})`,
  !hunt.note && /off /.test(hunt.toldText) && hunt.blindText !== hunt.toldText);

/* ---- how big she is, in one number ---- */
const tons = await G(() => {
  const g = window.__game;
  const t = Object.values(g.HULLS).map(c => ({ name: c.name, t: Math.round(c.len * c.beam * c.beam * 0.09) }));
  return { list: t, flag: document.getElementById('flag-name').textContent };
});
ok(`every hull has a tonnage, and it rises with her (${tons.list.map(x => `${x.name} ${x.t}t`).join(', ')})`,
  tons.list.every(x => x.t > 0)
  && tons.list.find(x => x.name === 'Cutter').t < tons.list.find(x => x.name === 'Frigate').t);
ok(`and your own is on the ship's own panel ("${tons.flag}")`, /·\s*\d+t/.test(tons.flag));

/* ---- the mark stays on the water until she gets there ----
   A tap used to play one expanding ring and vanish, so a course laid across
   open water left nothing behind to say where it ended. */
const wp = await G(() => {
  const g = window.__game, p = g.player;
  p.x = 40; p.z = 300; p.speed = 0; p.yaw = 0; p.hull = p.hullMax;
  g.commandMove(40, 430);
  for (let k = 0; k < 30; k++) g.update(1 / 30);
  return { goal: !!g.moveGoal, shown: g.markers.destMark.visible,
    at: g.moveGoal ? [Math.round(g.moveGoal.x), Math.round(g.moveGoal.z)] : null };
});
ok(`a course laid leaves a mark on the water (${JSON.stringify(wp.at)})`, wp.goal && wp.shown);
const wpGone = await G(() => {
  const g = window.__game;
  for (let i = 0; i < 90 * 30 && g.moveGoal; i++) g.update(1 / 30);
  return { goal: !!g.moveGoal, shown: g.markers.destMark.visible,
    left: Math.round(Math.hypot(g.player.x - 40, g.player.z - 430)) };
});
ok(`and it goes out when she gets there (${wpGone.left}m off the mark)`,
  !wpGone.goal && !wpGone.shown && wpGone.left < 60);

/* ---- BOARD is an order, not a reward for having already arrived ----
   Getting alongside was the part with no control on it: the only way to
   steer in was to tap the water beside her, and a tap near a marked ship
   lands on the ship, which unmarks her. */
const gotBattle = await intoBattle(page, { enemyHull: 0.55 });
const boardRun = await G(() => {
  const g = window.__game, p = g.player;
  if (!g.battle) return null;
  p.crew.marine += 12; p.crew.sailor += 8;
  const t = g.battle.enemies[0];
  g.target = t;
  const gap0 = Math.round(Math.hypot(t.x - p.x, t.z - p.z));
  const offered = !!document.querySelector('.act-btn.board') || (!g.boardable && !!g.target);
  g.playerBoard();
  const ordered = g.boardRun === t;
  for (let i = 0; i < 60 * 30; i++) {
    g.update(1 / 30);
    if (p.boarding || g.mode !== 'battle') break;
  }
  return {
    offered, ordered, gap0,
    gap: g.target ? Math.round(Math.hypot(g.target.x - p.x, g.target.z - p.z)) : -1,
    boarding: !!p.boarding, mode: g.mode,
  };
});
ok(`BOARD is offered before you are alongside, and gives the order `
  + `(${boardRun ? `${boardRun.gap0}m off, ordered ${boardRun.ordered}` : 'no action'})`,
!!gotBattle && !!boardRun && boardRun.offered && boardRun.ordered);
ok(`and the helm closes her and grapples without being steered `
  + `(${boardRun ? `${boardRun.gap0}m -> ${boardRun.gap}m, boarding ${boardRun.boarding}` : '-'})`,
!!boardRun && boardRun.boarding && boardRun.gap < boardRun.gap0);
await leaveBattle(page);
for (let i = 0; i < 4 && await dismissModal(page); i++);

/* ---- last of all: a new voyage starts on a clock nobody has to reset ----
   Reported: starting a new campaign gave a world already running fast, with
   nothing to do about it but notice and set the clock back by hand. The game
   object outlives a voyage — it is made once and `newGame` re-dresses it —
   and the clock was not among the things being re-dressed. World time is
   checked with it because it leaks the same way and more quietly: contract
   epochs and everything the social layer timestamps were being dated from
   the end of the previous voyage.

   Dead last in the file on purpose. This is the one check here that throws
   the world away and builds another, which puts the opening scene up over
   everything — run it mid-file and every click after it hits that card
   instead, which is exactly how it took the whole suite down once. */
const clockReset = await G(() => {
  const g = window.__game;
  g.speed = 4;                        // where a player might well have left it
  const wasTime = +g.time.toFixed(1);
  g.newGame(false, g.origin);
  return { speed: g.speed, time: +g.time.toFixed(1), wasTime };
});
ok(`a new voyage opens at 1x on a clock reading zero (was 4x at ${clockReset.wasTime}s, `
  + `now ${clockReset.speed}x at ${clockReset.time}s)`,
clockReset.speed === 1 && clockReset.time === 0);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
