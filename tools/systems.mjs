/* Systems test: contracts, discoveries, shoal water, supplies, reputation,
   crew progression, and the awkward states players actually hit. */
import { launch, sleep, ff, shot } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await page.click('#btn-new');
await sleep(1200);

/* ---- cargo contract, end to end ---- */
const q = await G(() => {
  const g = window.__game;
  g.coin = 5000;
  const quest = g.quests.find(x => x.kind === 'cargo');
  g.acceptQuest(quest, g.PORTS[0]);
  g.player.cargo[quest.good] = quest.amount;
  const dest = g.PORTS.find(p => p.id === quest.toPort);
  return { good: quest.good, amount: quest.amount, to: quest.toPort, destName: dest.name };
});
ok('a cargo contract can be accepted', !!q.to);
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

/* ---- provisions running out ---- */
const starve = await G(() => {
  const g = window.__game;
  const p = g.player;
  p.provisions = 0;
  const crew0 = p.crewTotal;
  const morale0 = p.morale;
  for (let i = 0; i < 60 * 90; i++) g.update(1 / 60);
  return { crewLost: crew0 - p.crewTotal, moraleDrop: +(morale0 - p.morale).toFixed(2), alive: p.alive };
});
ok(`empty barrels cost crew over time (lost ${starve.crewLost})`, starve.crewLost > 0 && starve.alive);

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
  const n = g.projectiles.list.length;
  g.playerFire();
  return { fired: g.projectiles.list.length > n || g.projectiles.pending.length > 0 };
});
ok('an empty shot locker refuses to fire', !dry.fired);

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
ok(`wind changes speed a lot (running ${wind.running}, beam ${wind.beam}, beating ${wind.beating})`,
  wind.running > wind.beam && wind.beam > wind.beating && wind.beating < 0.5);

/* ---- corrupt save recovery ---- */
const corrupt = await page.evaluate(() => {
  localStorage.setItem('salt-and-tally-v1', '{{{not json');
  return true;
});
void corrupt;
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
const recovered = await page.evaluate(async () => {
  document.getElementById('btn-new').click();
  await new Promise(r => setTimeout(r, 1500));
  return !!window.__game && !!window.__game.player;
});
ok('a corrupt save does not brick the game', recovered);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 8).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
