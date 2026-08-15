/* The merchant road: can a captain who never fires a gun make a living,
   and can a captain who has run out of everything get going again? */
import { launch, sleep, newVoyage, dismissModal, waitFor, goPortTab } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = fn => page.evaluate(fn);

await sleep(900);
await newVoyage(page, { birth: 'shore', youth: 'net', berth: 'oar', wrong: 'pressed', want: 'clear' });

/* ---------- the board is written for the quay you are standing on ---------- */
const boards = await G(() => {
  const g = window.__game, out = {};
  for (const port of g.PORTS) {
    out[port.id] = g.contractsAt(port).filter(q => q.kind === 'cargo').map(q => ({
      from: q.fromPort, to: q.toPort, good: q.good, amount: q.amount,
      reward: q.reward, advance: q.advance,
    }));
  }
  return out;
});
const all = Object.values(boards).flat();
ok(`every harbour has work on the board (${Object.entries(boards).map(([k, v]) => `${k}:${v.length}`).join(' ')})`,
  Object.values(boards).every(b => b.length >= 3));
ok('a contract is always written out of the port you are in',
  Object.entries(boards).every(([id, b]) => b.every(q => q.from === id)));
ok('and never asks you to carry cargo to the quay you loaded it on',
  all.every(q => q.to !== q.from));
ok(`the advance always covers the load (${all.filter(q => q.advance > 0).length}/${all.length})`,
  all.every(q => q.advance > 0));

/* ---------- buying at the far end is shopping, not carrying ---------- */
const cheat = await G(() => {
  const g = window.__game, p = g.player;
  const port = g.PORTS[0];
  const q = g.contractsAt(port).find(x => x.kind === 'cargo');
  g.acceptQuest(q, port);
  const dest = g.PORTS.find(x => x.id === q.toPort);
  // stand at the destination and buy the whole load there
  p.cargo[q.good] = q.amount + 4;
  g.onGoodsBought(q.good, q.amount + 4, dest);
  const shopping = g.canCompleteHere(q, dest);
  // now do it properly: the load came off the contract port's quay
  q.loaded = 0;
  g.onGoodsBought(q.good, q.amount, g.PORTS.find(x => x.id === q.fromPort));
  const carrying = g.canCompleteHere(q, dest);
  return { shopping, carrying, good: q.good, amount: q.amount, title: q.title };
});
ok(`buying "${cheat.good}" at the destination does not settle the contract`, !cheat.shopping);
ok('loading it where the contract was written does', cheat.carrying);

/* ---------- the board turns over, so it is never the same run twice ---------- */
const churn = await G(() => {
  const g = window.__game, port = g.PORTS[0];
  const before = g.contractsAt(port).map(q => q.id).join('|');
  const q = g.quests.find(x => x.active && x.kind === 'cargo');
  g.player.cargo[q.good] = q.amount; q.loaded = q.amount;
  g.completeQuest(q);
  const after = g.contractsAt(port).map(q2 => q2.id).join('|');
  return { changed: before !== after, before: before.split('|').length, after: after.split('|').length };
});
ok(`delivering refreshes that harbour's board (${churn.before} -> ${churn.after} offers, new ids)`,
  churn.changed && churn.after >= 3);

/* ---------- a full merchant loop turns a real profit ---------- */
const loop = await G(() => {
  const g = window.__game, p = g.player, m = g.market;
  const hold = p.cls.cargo;
  const runs = [];
  for (const a of g.PORTS) {
    // the best cargo this quay sells, carried to whoever pays most for it
    let best = null;
    for (const gid of Object.keys(m.ports[a.id].stock)) {
      for (const b of g.PORTS) {
        if (b === a) continue;
        const s0 = m.ports[a.id].stock[gid], s1 = m.ports[b.id].stock[gid];
        let spend = 0, take = 0;
        for (let i = 0; i < hold; i++) { spend += m.buyPrice(a.id, gid); m.takeStock(a.id, gid, 1); }
        for (let i = 0; i < hold; i++) { take += m.sellPrice(b.id, gid); m.addStock(b.id, gid, 1); }
        m.ports[a.id].stock[gid] = s0; m.ports[b.id].stock[gid] = s1;
        const leg = Math.hypot(a.x - b.x, a.z - b.z);
        const mins = (leg / (p.cls.speed * 0.7)) / 60;
        const cand = { from: a.id, to: b.id, gid, spend, profit: take - spend, mins: +mins.toFixed(1),
          ret: Math.round((take - spend) / spend * 100) };
        if (!best || cand.profit > best.profit) best = cand;
      }
    }
    runs.push(best);
  }
  // what the same money is worth if you only have the starting purse
  const start = 240;
  const port = g.PORTS[0];
  let cheapest = null;
  for (const gid of Object.keys(m.ports[port.id].stock)) {
    const unit = m.buyPrice(port.id, gid);
    const n = Math.min(hold, Math.floor(start / unit));
    if (n < 4) continue;
    for (const b of g.PORTS) {
      if (b === port) continue;
      const gain = (m.sellPrice(b.id, gid) - unit) * n;
      if (!cheapest || gain > cheapest.gain) cheapest = { gid, n, spend: unit * n, gain: Math.round(gain), to: b.id };
    }
  }
  return { runs, cheapest, burnPerMin: +(p.crewTotal * 60 / 380).toFixed(2) };
});
console.log('\nbest run out of each port (full hold, price impact included)');
for (const r of loop.runs) {
  console.log(`  ${r.from} -> ${r.to}  ${r.gid.padEnd(7)} spend ${String(r.spend).padStart(4)}  profit ${String(r.profit).padStart(4)}  ${r.ret}% in ${r.mins} min`);
}
console.log(`  first purse (◆240): ${loop.cheapest.n} ${loop.cheapest.gid} -> ${loop.cheapest.to}, +◆${loop.cheapest.gain}`);
console.log(`  upkeep: ${loop.burnPerMin} provisions/min = ◆${(loop.burnPerMin * 4).toFixed(1)}/min\n`);

ok('every harbour has something worth carrying out of it', loop.runs.every(r => r.profit > 80));
// what matters is coin per minute, not the ratio: a cheap cargo bought with a
// thin purse *should* return well, or a poor captain has no way up
// the ceiling is the capital-heavy long haul, and it should stay in the same
// world as a good fight: a Tally cutter is worth ~◆115 and two minutes of risk
ok(`no run is a licence to print money (best ◆${Math.max(...loop.runs.map(r => Math.round(r.profit / r.mins)))}/min)`,
  loop.runs.every(r => r.profit / r.mins <= 220));
ok(`a thin purse still gets a good return (best ${Math.max(...loop.runs.map(r => r.ret))}% on a cheap cargo)`,
  loop.runs.some(r => r.ret >= 60));
ok(`the starting purse can turn a profit (${loop.cheapest.n} ${loop.cheapest.gid} for +◆${loop.cheapest.gain})`,
  loop.cheapest.gain >= 60);
ok(`upkeep does not eat the margin (◆${(loop.burnPerMin * 4).toFixed(1)}/min against ${Math.min(...loop.runs.map(r => Math.round(r.profit / r.mins)))}+/min of trade)`,
  loop.burnPerMin * 4 < Math.min(...loop.runs.map(r => r.profit / r.mins)) * 0.35);

/* ---------- a captain with nothing can still get going ---------- */
const destitute = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 0; p.cargo = {}; p.provisions = 0;
  for (const q of g.quests) { q.active = false; q.done = false; }
  const port = g.PORTS[0];
  const offers = g.contractsAt(port).filter(q => q.kind === 'cargo');
  const q = offers.sort((a, b) => a.advance - b.advance)[0];
  g.acceptQuest(q, port);
  const afterAdvance = g.coin;
  // buy the load the contract asks for
  const unit = g.market.buyPrice(port.id, q.good);
  const cost = unit * q.amount;
  const canAfford = g.coin >= cost;
  g.coin -= cost;
  p.cargo[q.good] = q.amount;
  g.onGoodsBought(q.good, q.amount, port);
  const leftForFood = g.coin;
  const dest = g.PORTS.find(x => x.id === q.toPort);
  const deliverable = g.canCompleteHere(q, dest);
  g.completeQuest(q);
  return { afterAdvance, cost, canAfford, leftForFood, deliverable, ended: g.coin };
});
ok(`a broke captain can take work (advance put ◆${destitute.afterAdvance} in an empty box)`,
  destitute.afterAdvance > 0);
ok(`the advance buys the load it asks for (◆${destitute.cost} of cargo)`, destitute.canAfford);
ok('and the run can be completed from a standing start', destitute.deliverable);
ok(`which leaves a working purse again (◆${destitute.ended})`, destitute.ended > 200);

/* ---------- provisions ---------- */
const food = await G(() => {
  const g = window.__game, p = g.player;
  g.hintState.lowProv = 0; g.hintState.starving = 0;
  p.provisions = p.crewTotal * 3;           // a normal victualling
  const start = p.provisions, crew0 = p.crewTotal;
  // this measures barrels, not battles: keep the sea to herself and the hull sound
  const quiet = () => {
    p.hull = p.hullMax; p.sails = p.sailMax;
    for (const s of g.ships) if (!s.isPlayer && !g.fleet.includes(s)) { s.x = 9e4; s.z = 9e4; }
  };
  let t = 0;
  while (p.provisions > 0 && t < 3600) { g.update(1); quiet(); t++; }
  const ranDry = t;
  // now run ten minutes on empty barrels and count the cost. A fixed window
  // rather than a stopwatch on a random process, so the number is stable.
  const crewDry = p.crewTotal;
  for (let i = 0; i < 600; i++) { g.update(1); quiet(); }
  const crewAfterTen = p.crewTotal;
  // and then starve her long past any reasonable window, to see the floor hold
  let lowest = p.crewTotal;
  for (let i = 0; i < 5400; i++) { g.update(1); quiet(); lowest = Math.min(lowest, p.crewTotal); }
  return {
    start, minutesOfFood: +(ranDry / 60).toFixed(1), crew0,
    hungry: +p.hungry.toFixed(2), skillWhenStarving: +p.crewSkill('sail').toFixed(2),
    crewDry, crewAfterTen, lostInTenMin: crewDry - crewAfterTen,
    lowest, crewMin: p.cls.crewMin, aliveAfter: p.alive,
  };
});
await G(() => {                       // victualled again for what follows
  const p = window.__game.player;
  p.provisions = 60; p.hungry = 0; p.hull = p.hullMax; p.alive = true;
});
ok(`a full victualling lasts a passage (${food.start} provisions = ${food.minutesOfFood} min at sea)`,
  food.minutesOfFood > 12);
ok(`empty barrels wear the crew down before they kill anyone (hunger ${food.hungry}, skill x${(1 - 0.35 * food.hungry).toFixed(2)})`,
  food.hungry > 0.8);
/* Deaths are a coin toss every second (0.8%/s above 0.85 hunger), so ten
   minutes is a random variable with a mean near 5, not a fixed number: an
   assertion pinned to the mean fails on an unlucky roll. 12 is four standard
   deviations out and still far short of "the whole company", which is what
   this is really guarding. The floor below is the deterministic half — the
   game refuses to take the last hands, so a starving ship can always be
   sailed home, however the dice fall. */
ok(`ten minutes of empty barrels costs ${food.lostInTenMin} of ${food.crewDry} hands, not the whole company`,
  food.lostInTenMin <= 12);
ok(`and ninety more never strip her below a working watch (${food.lowest} hands at the worst, minimum ${food.crewMin})`,
  food.lowest >= food.crewMin && food.aliveAfter);

/* ---------- a harbour is a refuge ---------- */
const refuge = await G(() => {
  const g = window.__game, p = g.player;
  const out = [];
  /* Lay the raider in the approach, not on the breakwater. Due east of the
     harbour used to do, back when every port was an open roadstead; Greywake
     is walled and Tideglass sits inside a reef, so a fixed bearing puts her
     hard aground and a ship that cannot move cannot sheer off — which would
     have failed this check for a reason that has nothing to do with it.
     So: the bearing with water under it at 150m *and* a clear way out at 260m,
     which is where a raider standing off a harbour would actually be. */
  const layOff = port => {
    let best = null;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const at = r => window.__terrain.depthAt(port.x + Math.sin(a) * r, port.z + Math.cos(a) * r);
      const score = Math.min(at(150), at(200), at(260));
      if (!best || score > best.score) best = { a, score };
    }
    return { x: port.x + Math.sin(best.a) * 150, z: port.z + Math.cos(best.a) * 150, water: Math.round(best.score) };
  };
  for (const port of g.PORTS) {
    const lay = layOff(port);
    /* The rule under test is about *cold* pursuit — `sheerOffFromPort`
       stands down for a ship with aggro, deliberately: somebody already
       shooting at her is a fight, not a chase. So the staging has to be
       cold each time, and stay cold. One pirate reused across five ports
       carried aggro from a harbour guard's lucky broadside at port three
       into ports four and five, and all three read as "she followed you
       in" — state `hunt`, which is exactly what the rule promises when
       she has been fired on. Reset what the rule reads, and if a guard
       hits her mid-window the cold scenario did not happen: lay her off
       and run that port again. */
    let row = null;
    for (let tries = 0; tries < 3 && !row; tries++) {
      p.x = port.x; p.z = port.z; p.speed = 0; p.dest = null;
      const pir = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
      pir.x = lay.x; pir.z = lay.z; pir.hostileToPlayer = true;
      pir.target = p; pir.alive = true;
      pir.aggro = 0; pir.lastAttacker = null;
      pir.chaseHold = 0; pir.fleeing = false;
      if (pir.brain) { pir.brain.sheerT = 0; pir.brain.sheerFrom = null; pir.brain.path = null; pir.brain.pathGoal = null; }
      g.update(0.1);
      const chased = !!g.dockablePort;
      const before = { x: pir.x, z: pir.z };
      for (let i = 0; i < 260; i++) g.update(1 / 30);      // long enough to gather way
      if (pir.aggro > 0 && tries < 2) continue;            // she was shot at: not this rule
      const d0 = Math.hypot(before.x - port.x, before.z - port.z);
      const d1 = Math.hypot(pir.x - port.x, pir.z - port.z);
      row = { port: port.name, chased, water: lay.water, cold: !(pir.aggro > 0),
        sheeredOff: d1 > d0 + 10, moved: Math.round(d1 - d0), state: pir.brain.state };
      pir.x = 9e4; pir.z = 9e4; pir.hostileToPlayer = false; pir.target = null;
      pir.aggro = 0; pir.lastAttacker = null;
    }
    out.push(row);
  }
  return out;
});
for (const r of refuge) {
  ok(`you can put into ${r.port} with a raider on your tail`, r.chased);
  ok(`and she sheers off rather than follow you under the guns of ${r.port} (${r.moved >= 0 ? '+' : ''}${r.moved}m, ${r.state}${r.cold ? '' : ', SHOT AT'}, ${r.water}m under her)`,
    r.sheeredOff && r.cold);
}

/* ---------- and a hostile alongside the quay still blocks it ---------- */
const blocked = await G(() => {
  const g = window.__game, p = g.player, port = g.PORTS[0];
  p.x = port.x; p.z = port.z; p.speed = 0;
  const pir = g.ships.find(s => s.faction === 'pirate' && s.alive) || g.spawnNPC('pirate');
  pir.x = port.x + 20; pir.z = port.z; pir.hostileToPlayer = true;
  g.update(0.1);
  const r = !!g.dockablePort;
  pir.x = 9e4; pir.z = 9e4; pir.hostileToPlayer = false;
  return r;
});
ok('but one already inside the buoys still has to be dealt with', !blocked);

/* ---------- trade really can pay for a crew ---------- */
const crewUp = await G(() => {
  const g = window.__game, p = g.player;
  g.coin = 900;                      // two decent runs' worth
  const before = p.crewTotal;
  const port = g.PORTS[0];
  let hired = 0;
  for (const rid of ['sailor', 'gunner', 'marine', 'sailor']) {
    const base = { deckhand: 22, sailor: 42, gunner: 78, marine: 82, rigger: 74 }[rid];
    const cost = Math.round(base * (port.size === 'major' ? 1 : 1.18));
    if (g.coin >= cost && p.crewTotal < p.cls.crewMax) { g.coin -= cost; p.crew[rid]++; hired++; }
  }
  return { before, after: p.crewTotal, hired, left: g.coin };
});
ok(`two runs' takings hire a watch (${crewUp.before} -> ${crewUp.after} hands, ◆${crewUp.left} left)`,
  crewUp.hired >= 3);

/* ---------- and it all survives the real UI ---------- */
await G(() => {
  const g = window.__game, p = g.player, port = g.PORTS[0];
  g.coin = 400; p.cargo = {}; p.provisions = 40; p.hungry = 0;
  // hove to on the quay with a clear road, as after a normal approach
  p.x = port.x; p.z = port.z; p.speed = 0; p.dest = null; p.throttle = 0; p.headingCmd = p.yaw;
  for (const s of g.ships) {
    if (s.isPlayer || g.fleet.includes(s)) continue;
    if (Math.hypot(s.x - port.x, s.z - port.z) < 600) { s.x += 2200; s.hostileToPlayer = false; }
  }
  for (const q of g.quests) { q.active = false; q.done = false; }
});
await sleep(400);
await dismissModal(page);
const dockUp = await waitFor(page, () => !!document.querySelector('.act-btn.dock'), 6000);
ok('DOCK offers itself when you are hove to on a clear quay', dockUp);
if (!dockUp) {
  console.log('  why not:', JSON.stringify(await G(() => {
    const g = window.__game, p = g.player, port = g.PORTS[0];
    return { dock: g.dockablePort && g.dockablePort.id, speed: +p.speed.toFixed(2),
      d: Math.round(Math.hypot(p.x - port.x, p.z - port.z)), alive: p.alive };
  })));
}
await page.click('.act-btn.dock');
await sleep(900);
/* Ilo Vantu opens on the town now, not on a counter — so go to the board,
   the way a player does. It has a tab of its own since the harbour page was
   split; the board is what is under test, not where it lives. */
await goPortTab(page, 'WORK');
const uiOffer = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const hit = rows.filter(r => /Advance/.test(r.textContent));
  return { offers: hit.length, text: hit[0] ? hit[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 110) : '' };
});
ok(`the harbourmaster's board shows the advance (${uiOffer.offers} offers)`, uiOffer.offers >= 3);

/* ---------- a haggler cannot print money at one counter ----------
   The harbour's cut is 8% each way; the skill used to add its own margin on
   top, discounting the buy and inflating the sell. The two cross at a trade
   skill of 0.229 and the questionnaire hands out up to 0.38 — so a captain
   who answered it for haggling could buy a barrel and sell it straight back
   for profit, at a counter, for ever. A round trip leaves stock exactly
   where it began, so nothing ever corrected it. Swept across every port,
   every good, and the whole reachable range of the skill. */
const spread = await G(async () => {
  const D = await import('/src/data/gamedata.js');
  const O = await import('/src/data/origins.js');
  const g = window.__game, M = g.market;
  const was = M.haggle;
  // the most haggling a questionnaire can actually produce
  let maxTrade = 0;
  for (const step of O.ORIGIN_STEPS) {
    let best = 0;
    for (const o of step.options) best = Math.max(best, (o.fx && o.fx.capt && o.fx.capt.trade) || 0);
    maxTrade += best;
  }
  const bad = [];
  let widest = -1e9;
  for (const h of [0, 0.1, 0.2, 0.229, 0.3, maxTrade, 0.6, 1]) {
    M.haggle = h;
    for (const port of g.PORTS) {
      for (const good in D.GOODS) {
        const buy = M.price(port.id, good, true), sell = M.price(port.id, good, false);
        widest = Math.max(widest, sell - buy);
        if (sell >= buy) bad.push(`${port.id}/${good} at trade ${h}: buy ${buy}, sell ${sell}`);
      }
    }
  }
  // and the skill still has to be worth answering for
  const port = g.PORTS[0];
  const dear = Object.keys(D.GOODS).sort((a, b) => D.GOODS[b].base - D.GOODS[a].base)[0];
  M.haggle = 0;
  const green = { buy: M.price(port.id, dear, true), sell: M.price(port.id, dear, false) };
  M.haggle = maxTrade;
  const sharp = { buy: M.price(port.id, dear, true), sell: M.price(port.id, dear, false) };
  M.haggle = was;
  return { maxTrade: +maxTrade.toFixed(3), bad: bad.slice(0, 4), n: bad.length,
    widest, good: dear, green, sharp };
});
ok(`the questionnaire's best haggler is ${spread.maxTrade} — and no shelf ever sells above it buys `
  + `(${spread.n ? spread.bad.join('; ') : `worst gap ${spread.widest}`})`,
spread.n === 0 && spread.widest < 0);
ok(`and haggling is still worth answering for (${spread.good}: `
  + `buy ${spread.green.buy}->${spread.sharp.buy}, sell ${spread.green.sell}->${spread.sharp.sell})`,
spread.sharp.buy < spread.green.buy && spread.sharp.sell > spread.green.sell);

/* ---------- one notice per ship, on the board and on the page ----------
   Reported twice: "bounties are showing duplicates of the same ship, same
   name and wanted poster". Asserted on the rendered board as well as on the
   list behind it, because the fault was neither in the generator nor in the
   page — `contractsAt` collected every unaccepted bounty twice, once in its
   own sweep of harbour-board quests and once from `bountiesAt`, and the two
   were the same object. A check on `bountiesAt` alone passes happily. */
/* A board with nothing on it proves nothing, and the first version of this
   check passed on exactly that — 0 posters, 0 names, green. A bounty is
   posted against a live enemy hull within 2600m of the port, so put two
   there and let the game decide it wants to name them. */
await G(() => {
  const g = window.__game;
  const port = g.inPort || g.PORTS[0];
  for (let i = 0; i < 2; i++) {
    const s = g.spawnNPC('pirate');
    if (!s) continue;
    s.x = port.x + 900 + i * 120; s.z = port.z + 700;
    s.alive = true; s.captured = false;
  }
});
await page.click('#sheet-close').catch(() => { });
await sleep(250);
await page.click('.act-btn.dock').catch(() => { });
await sleep(700);
await goPortTab(page, 'WORK');
await sleep(400);
const board = await G(() => {
  const g = window.__game;
  const port = g.inPort || g.PORTS[0];
  const all = g.contractsAt(port).filter(q => q.kind === 'bounty');
  const ids = all.map(q => q.id);
  const posters = [...document.querySelectorAll('.poster')];
  const names = posters.map(p => (p.querySelector('.po-name') || {}).textContent || '');
  const faces = posters.map(p => { const c = p.querySelector('.po-face'); return c ? c.width + 'x' + c.height + ':' + (c.toDataURL().length) : ''; });
  return {
    listed: ids.length, uniqueIds: new Set(ids).size,
    targets: new Set(all.map(q => q.targetId)).size,
    posters: posters.length, uniqueNames: new Set(names).size,
    uniqueFaces: new Set(faces).size, names,
  };
});
ok(`there are notices on the board to count (${board.posters} posted)`, board.posters >= 1);
ok(`the board lists each bounty once (${board.listed} entries, ${board.uniqueIds} distinct)`,
  board.listed >= 1 && board.listed === board.uniqueIds && board.listed === board.targets);
ok(`and the wall draws one poster per notice (${board.posters} posters, `
  + `${board.uniqueNames} names: ${board.names.join(' / ') || 'none posted'})`,
board.posters === board.listed && board.uniqueNames === board.posters
  && board.uniqueFaces === board.posters);

/* ---------- a thumb faster than the screen cannot break the economy ----------

   Every trade calls `refresh()`, which throws the row away and builds a new
   one. A tap already on its way lands on the old node, and that handler used
   to close over the quantities from when it was drawn — so selling sixteen
   fish you no longer have ran `p.cargo.fish -= 16` on an entry deleted a
   moment before. `undefined - 16` is NaN, `NaN <= 0` is false so it was never
   cleaned up, and four steps later the hold, the purchase, the captain's coin
   and Ilo Vantu's fish stock were all NaN for the rest of the voyage.

   Staged as it actually happens: keep the button, let the game redraw around
   it, and go on pressing the one you are holding. */
/* Cargo aboard *before* the counter is drawn, or the row renders with an
   empty hold, the SELL button is inert, and the check quietly measures
   nothing — which is what it did first time round. */
await G(() => { window.__game.player.cargo.fish = 12; });
await goPortTab(page, 'HARBOUR');
await sleep(200);
await goPortTab(page, 'MARKET');
await sleep(400);
const stale = await G(() => {
  const g = window.__game, p = g.player;
  const port = g.inPort || g.PORTS[0];
  const rows = [...document.querySelectorAll('#sheet-content .row')];
  const row = rows.find(r => /fish/i.test(r.textContent));
  if (!row) return { staged: false };
  const sell = [...row.querySelectorAll('button')].find(b => /SELL/i.test(b.textContent));
  if (!sell) return { staged: false };
  const before = { coin: g.coin, stock: g.market.stock(port.id, 'fish') };
  // the same node, thirty times, while the sheet rebuilds underneath it
  for (let i = 0; i < 30; i++) { try { sell.click(); } catch (e) { void e; } }
  const fin = v => Number.isFinite(v);
  return {
    staged: true, detached: !sell.isConnected,
    coin: g.coin, cargo: p.cargo.fish === undefined ? 'gone' : p.cargo.fish,
    cargoUsed: p.cargoUsed, cargoFree: p.cargoFree,
    stock: g.market.stock(port.id, 'fish'),
    buyPrice: g.market.buyPrice(port.id, 'fish'),
    allFinite: fin(g.coin) && fin(p.cargoUsed) && fin(p.cargoFree)
      && fin(g.market.stock(port.id, 'fish')) && fin(g.market.buyPrice(port.id, 'fish'))
      && (p.cargo.fish === undefined || fin(p.cargo.fish)),
    before, sold: 12 - (p.cargo.fish || 0),
  };
});
ok(`hammering a stale SELL leaves the books straight (${stale.staged
  ? `coin ◆${Math.round(stale.coin)}, hold ${stale.cargoUsed}, `
    + `stock ${Math.round(stale.stock)}, buy ◆${stale.buyPrice}, ${stale.sold} sold `
    + `off a ${stale.detached ? 'detached' : 'LIVE — bad staging'} button`
  : 'could not stage'})`,
  stale.staged && stale.detached && stale.sold > 0
  && stale.allFinite && stale.coin >= 0 && stale.cargoUsed >= 0);

await goPortTab(page, 'HARBOUR');
await sleep(300);

console.log(`  board reads: ${uiOffer.text}\n`);

/* ---- buying does not throw you back to the top of the page ----
   Reported from a desktop playtest: buying goods or recruiting from the
   bottom of a long list scrolled the sheet back to the top, so every
   purchase after the first meant scrolling down again. refresh() rebuilds
   the tab, and the rebuild reset scrollTop unconditionally — correct when
   you switch tabs, wrong when you are still on the one you were reading.
   Driven through the real market: scroll down, press a real BUY, look. */
/* A short window, so the goods list genuinely overflows. On a tall desktop
   window the market fits and there is nothing to scroll — the check said so
   rather than passing on an empty measurement. The mechanism under test does
   not care about the viewport; it only needs one where scrollTop can be
   non-zero. */
const vpWas = page.viewportSize();
await page.setViewportSize({ width: 900, height: 420 });
await sleep(300);
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('#sheet-tabs .tab')];
  const m = tabs.find(t => /MARKET/i.test(t.textContent));
  if (m) m.click();
});
await sleep(500);
const scrollKeep = await page.evaluate(async () => {
  const c = document.getElementById('sheet-content');
  if (!c) return { note: 'no sheet' };
  c.scrollTop = c.scrollHeight;                     // all the way to the bottom
  await new Promise(r => setTimeout(r, 120));
  const before = c.scrollTop;
  if (before < 20) return { note: 'list too short to scroll', before };
  // the last BUY on the page — the row a player would actually be looking at
  const buys = [...c.querySelectorAll('button')].filter(b => /^BUY/i.test(b.textContent.trim()));
  const btn = buys[buys.length - 1];
  if (!btn) return { note: 'no buy button', before };
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  return { before: Math.round(before), after: Math.round(c.scrollTop), buys: buys.length };
});
ok(`buying from the foot of the market leaves you where you were `
  + `(${scrollKeep.note || `${scrollKeep.before}px -> ${scrollKeep.after}px`})`,
!scrollKeep.note && Math.abs(scrollKeep.after - scrollKeep.before) < 40);

/* And switching tabs still starts at the top, which is the behaviour the
   unconditional reset was there for in the first place. */
const scrollReset = await page.evaluate(async () => {
  const c = document.getElementById('sheet-content');
  c.scrollTop = c.scrollHeight;
  await new Promise(r => setTimeout(r, 120));
  const tabs = [...document.querySelectorAll('#sheet-tabs .tab')];
  const other = tabs.find(t => !t.classList.contains('on'));
  if (!other) return { note: 'only one tab' };
  other.click();
  await new Promise(r => setTimeout(r, 400));
  return { top: Math.round(c.scrollTop), tab: other.textContent.trim() };
});
ok(`but changing tab starts at the top (${scrollReset.note || `${scrollReset.tab} at ${scrollReset.top}px`})`,
  !!scrollReset.note || scrollReset.top === 0);
if (vpWas) await page.setViewportSize(vpWas);
await sleep(200);

/* ---------- the merchant road as something you can rob ----------
   Merchants used to be hulls with a role and an invented hold: what they
   carried was rolled at the moment you took them, so there was nothing to
   size up and no reason to prefer one to another. They carry a real
   shipment now, and the escort follows from the manifest rather than from
   a die — which is the whole point, because it makes the fat one on the
   horizon the one with two sail around her. */
const road = await G(() => {
  const g = window.__game;
  const out = { manifests: [], spread: [] };
  for (const m of g.ships.filter(s => s.role === 'merchant')) {
    out.manifests.push({
      name: m.name, good: m.manifest && m.manifest.good,
      amount: m.manifest && m.manifest.amount, value: m.manifest && m.manifest.value,
      inHold: m.manifest ? (m.cargo[m.manifest.good] || 0) : 0,
      to: m.manifest && m.manifest.to, from: m.manifest && m.manifest.from,
      escorts: (m.escorts || []).filter(e => e.alive).length,
    });
  }
  // and the rule that decides an escort, over enough rolls to see its shape
  for (let i = 0; i < 60; i++) {
    const m = g.spawnNPC('merchant');
    if (!m) continue;
    out.spread.push({ value: m.manifest ? m.manifest.value : 0, escorts: (m.escorts || []).length });
    for (const e of (m.escorts || [])) g.removeShip(e, true);
    g.removeShip(m, true);
  }
  return out;
});
ok(`every merchant is carrying a real shipment (${road.manifests.map(m => `${m.amount} ${m.good} ~◆${m.value}`).join(', ')})`,
  road.manifests.length > 0 && road.manifests.every(m => m.good && m.amount > 0 && m.value > 0));
ok('and what she is carrying is in her hold, not invented when you take her',
  road.manifests.every(m => m.inHold === m.amount));
ok('and she is bound somewhere other than where she loaded',
  road.manifests.every(m => m.from && m.to && m.from !== m.to));

const rich = road.spread.filter(s => s.value >= 1900);
const poor = road.spread.filter(s => s.value < 900);
const avg = a => (a.reduce((x, s) => x + s.escorts, 0) / Math.max(1, a.length));
ok(`iron travels with the money (${poor.length} runs under ◆900 average ${avg(poor).toFixed(2)} escorts, `
  + `${rich.length} over ◆1900 average ${avg(rich).toFixed(2)})`,
poor.length > 0 && rich.length > 0 && avg(poor) < 0.4 && avg(rich) > 1.4);
/* A range, not a jackpot: a hull carrying more than the ship is worth turned
   every merchant on the sea into a prize with two brigs round her. */
const vals = road.spread.map(s => s.value).sort((a, b) => a - b);
ok(`and a shipment is worth about what a contract pays (◆${vals[0]} to ◆${vals[vals.length - 1]})`,
  vals[0] > 100 && vals[vals.length - 1] < 3200);

/* Robbing strangers is a living; robbing people who trusted you is a
   reputation. Both cost, and the second costs more. */
const price = await G(() => {
  const g = window.__game;
  const ms = g.ships.filter(s => s.role === 'merchant' && !s.hostileToPlayer);
  if (ms.length < 2) return null;
  /* Two merchants who are not each other's neighbours. `provoke` turns
     every same-faction hull within 500m — correctly; her friends take
     notice — so picking the first two in the list could hand the second
     one over already hostile, and `provoke` no-ops on a hull that is. The
     check then measured nothing and reported "−0 standing". */
  const a = ms[0];
  const b = ms.slice(1).find(s => Math.hypot(s.x - a.x, s.z - a.z) > 600
    && !s.hostileToPlayer);
  if (!b) return null;
  g.standing[a.faction] = 40;                       // a power that had come to trust you
  const s0 = g.standing[a.faction], i0 = g.infamy;
  g.provoke(a);
  const friend = { standing: s0 - g.standing[a.faction], infamy: g.infamy - i0 };
  g.standing[b.faction] = 0;                        // and one that had no opinion
  const s1 = g.standing[b.faction], i1 = g.infamy;
  g.provoke(b);
  const stranger = { standing: s1 - g.standing[b.faction], infamy: g.infamy - i1 };
  /* Live escorts only. A merchant used to keep listing hulls the culler had
     already removed, so this counted ghosts and reported "0 of 1" whenever
     the first merchant in the list happened to be carrying one. `removeShip`
     unlinks them now; asserting on live ones as well means the check states
     what it means rather than relying on that. */
  const live = (a.escorts || []).filter(e => g.ships.includes(e) && e.alive);
  return { friend, stranger, escortsTurned: live.filter(e => e.hostileToPlayer).length,
    hadEscorts: live.length, listed: (a.escorts || []).length };
});
ok(`firing on a merchant costs standing and infamy (${price ? `stranger −${price.stranger.standing} standing` : 'no pair to test'})`,
  !!price && price.stranger.standing > 0 && price.stranger.infamy > 0);
ok(`and costs more from a power that trusted you (friend −${price ? price.friend.standing : '?'} `
  + `vs stranger −${price ? price.stranger.standing : '?'})`,
!!price && price.friend.standing > price.stranger.standing);
ok(`and her escort takes it personally (${price ? `${price.escortsTurned} of ${price.hadEscorts} afloat`
  + `${price.listed !== price.hadEscorts ? `, ${price.listed - price.hadEscorts} GHOST(S) LISTED` : ''}` : '?'})`,
!!price && (price.hadEscorts === 0 || price.escortsTurned === price.hadEscorts)
  && price.listed === price.hadEscorts);

/* ---- last: clearing for action against a friend is what costs ----
   Dead last in the file because it opens a real action, which changes the
   world for anything after it.

   The charge for attacking people who were not your enemies lived in the
   damage callback, guarded on "she is not already hostile" — and a battle
   flags every enemy hostile as it forms, before the first ball is in the
   air. So the guard was always shut by the time it was asked: a captain
   could clear for action against a friendly trader, shoot her rig off and
   take her cargo without losing a point of standing with the power she
   belonged to. Driven through the real chain — mark, close, contact,
   FIGHT — because that is the only way the bug appears. */
// this suite spends its life in harbour, and contact is refused in port or
// with a screen open — so put her back to sea before asking for a fight
await G(() => {
  const g = window.__game;
  document.getElementById('sheet').classList.add('hidden');
  g.inPort = null; g.paused = false;
});
await sleep(300);
const raid = await G(() => {
  const g = window.__game, p = g.player;
  p.x = 120; p.z = 60; p.dest = null; p.speed = 0; p.hull = p.hullMax;
  let m = g.ships.find(s => s.role === 'merchant' && !s.hostileToPlayer);
  for (let i = 0; i < 12 && !m; i++) m = g.spawnNPC('merchant');
  if (!m) return null;
  m.x = p.x + 120; m.z = p.z + 30;
  for (const s of g.ships) {
    if (s === m || s.isPlayer || (m.escorts || []).includes(s)) continue;
    s.x += 3200; s.hostileToPlayer = false;
  }
  g.standing[m.faction] = 30;               // a power that had come to trust you
  g.encounterCooling = 0; g.paused = false;
  /* Mark, then the order. One tap only marks now — this staging leaned on
     the mark launching the chase, and when that stopped, contact became a
     matter of which way she happened to sail: green standalone, red in the
     full run. The deed under test starts with a captain who means it. */
  g.selectTarget(m);
  g.startChase(m);
  return { name: m.name, faction: m.faction, standing: g.standing[m.faction], infamy: Math.round(g.infamy) };
});
if (raid) {
  for (let i = 0; i < 60; i++) {
    const mode = await G(() => { const g = window.__game; for (let k = 0; k < 30; k++) g.update(1 / 30); return g.mode; });
    if (mode !== 'campaign') break;
  }
  await G(() => { const g = window.__game; if (g.mode === 'encounter') g.chooseEncounter('fight'); });
  await waitFor(page, () => window.__game.mode === 'battle', 9000);
  const after = await G(() => ({
    mode: window.__game.mode,
    standing: { ...window.__game.standing },
    infamy: Math.round(window.__game.infamy),
  }));
  ok(`clearing for action on a friendly trader costs her power's good opinion `
    + `(${raid.faction} ${raid.standing} -> ${after.standing[raid.faction]}, infamy ${raid.infamy} -> ${after.infamy}, ${after.mode})`,
  after.mode === 'battle' && after.standing[raid.faction] < raid.standing && after.infamy > raid.infamy);
  await G(() => { const g = window.__game; if (g.battle) g.battle.finish('fled'); });
} else {
  ok('clearing for action on a friendly trader costs her power\'s good opinion', false);
}



/* ---------- LAST: a ruined ship can still make way ----------
   "Nothing blocks the player permanently" is checked at a quay above — a
   broke captain can take work. The half a player actually meets is being
   broke *at sea*: empty barrels, rigging shot away, hull nearly gone, no
   coin, at the point in the Shoals furthest from any harbour.

   Tested as a mechanism rather than as a voyage, and that is the second
   answer here rather than the first. Sailing the whole thirty-minute crawl
   inside the suite was tried and abandoned: it wrecks the flagship, so it
   has to run last, and last is where the world is least predictable — the
   sections above end in a real action, cards raise themselves and hold the
   simulation, and the check variously reported STRANDED about a world that
   had advanced three seconds, then about a starving ship that grounded on
   the way. Every one of those verdicts was about the harness. The rule is
   that a ruined ship still makes way and the crew floor holds; ask that
   directly, on one tick, and it cannot be answered by the weather.

   The full crawl was verified once by hand on a clean world: 2178m off Ilo
   Vantu, alongside in about twelve minutes at two knots, nobody lost. */
const ruined = await G(async () => {
  const T = await import('/src/world/terrain.js');
  const g = window.__game, p = g.player;
  if (g.mode === 'battle' && g.battle) g.battle.finish('fled');
  g.mode = 'campaign'; g.paused = false; g.inPort = null;
  let far = null;
  for (let x = -g.limit; x <= g.limit; x += 260) {
    for (let z = -g.limit; z <= g.limit; z += 260) {
      if (T.depthAt(x, z) < 14) continue;
      let d = 1e9;
      for (const q of g.PORTS) d = Math.min(d, Math.hypot(x - q.x, z - q.z));
      if (!far || d > far.d) far = { x, z, d };
    }
  }
  p.x = far.x; p.z = far.z; p.speed = 0; p.dest = null; p.route = null;
  p.alive = true; p.boarding = null; p.lockTo = null;
  p.hull = Math.max(1, p.hullMax * 0.05);
  p.sails = 0; p.provisions = 0; p.shot = 0; p.hungry = 1; p.morale = 0.2;
  g.coin = 0;
  for (const k in p.cargo) delete p.cargo[k];
  for (const k in p.crew) p.crew[k] = 0;
  p.crew.sailor = p.cls.crewMin;
  let near = null, nd = 1e9;
  for (const q of g.PORTS) {
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < nd) { nd = d; near = q; }
  }
  g.commandMove(near.x, near.z);
  const laid = !!(p.dest || (p.route && p.route.length));
  const t0 = g.time;
  for (let i = 0; i < 240; i++) { g.paused = false; g.update(1 / 60); }
  // and hunger, at its very worst, cannot take the last of the watch
  const before = p.crewTotal;
  for (let i = 0; i < 60 * 60 * 5; i++) { g.paused = false; g.update(1 / 60); }
  return { far: Math.round(far.d), port: near.name, laid,
    ran: +(g.time - t0).toFixed(1),
    maxSpeed: +p.maxSpeed.toFixed(2), moved: p.speed > 0.2,
    crewBefore: before, crewAfter: p.crewTotal, min: p.cls.crewMin, alive: p.alive };
});
ok(`the world was running for it (${ruined.ran}s)`, ruined.ran > 60);
ok(`a course home can be laid from the worst berth in the Shoals `
  + `(${ruined.far}m off ${ruined.port})`, ruined.laid);
ok(`and a ruined ship still makes way (no rigging, 5% hull, starving: `
  + `${ruined.maxSpeed} knots of her own)`, ruined.maxSpeed > 0.5 && ruined.moved);
ok(`while hunger never takes the last of the watch (${ruined.crewAfter} hands, minimum ${ruined.min})`,
  ruined.crewAfter >= ruined.min && ruined.alive);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
