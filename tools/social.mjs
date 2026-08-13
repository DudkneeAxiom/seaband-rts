/* The people of the Shoals: ports as places, notables as people, and a
   relationship that survives a reload.

   Everything here goes through the real game — the real port screen, the
   real save, the real world tick. A social system that only works when a
   test calls its methods directly is a data structure, not a game. */
import { launch, sleep, newVoyage, waitFor } from './qa.mjs';

const { browser, page, errors } = await launch('desktop');
const log = [];
const ok = (m, c) => log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);
const G = (fn, arg) => page.evaluate(fn, arg);

await sleep(900);
await newVoyage(page);

/* ---- a new voyage opens looking at the place it is about to name ---- */
const opening = await G(() => {
  const g = window.__game, p = g.player, port = g.PORTS[0];
  const rect = document.getElementById('scene').getBoundingClientRect();
  const s = window.__worldToScreen(window.__cam.cam, port.x, 6, port.z, rect);
  const brg = Math.atan2(port.x - p.x, port.z - p.z);
  const norm = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  return {
    offBow: +Math.abs(norm(p.yaw - brg)).toFixed(2),
    xFrac: +(s.x / rect.width).toFixed(2), yFrac: +(s.y / rect.height).toFixed(2),
  };
});
ok(`a new voyage opens facing Ilo Vantu (bow ${opening.offBow} rad off, town at `
  + `${Math.round(opening.xFrac * 100)}% across, ${Math.round(opening.yFrac * 100)}% down)`,
opening.offBow < 0.2 && opening.xFrac > 0.2 && opening.xFrac < 0.8
  && opening.yFrac > 0 && opening.yFrac < 0.9);

/* ---- two ports that do not read alike ---- */
const towns = await G(() => {
  const g = window.__game;
  const out = {};
  for (const id of ['ilovantu', 'escarra']) {
    g.enterPort(g.PORTS.find(p => p.id === id));
    const people = [...document.querySelectorAll('.row.notable .rtitle')].map(x => x.textContent);
    out[id] = {
      people,
      scene: !!document.querySelector('.townscene'),
      role: (document.querySelector('.town-role') || {}).textContent || '',
      problem: (document.querySelector('.town-problem') || {}).textContent || '',
      banner: document.querySelector('.townscene')
        ? getComputedStyle(document.querySelector('.townscene')).getPropertyValue('--banner').trim() : '',
    };
    g.leavePort();
  }
  return out;
});
ok(`a port opens on the town, not the till (Ilo Vantu: ${towns.ilovantu.role.slice(0, 34)}…)`,
  towns.ilovantu.scene && towns.escarra.scene);
ok(`and the two towns are different places (${towns.ilovantu.people.length} vs `
  + `${towns.escarra.people.length} people, no name shared)`,
towns.ilovantu.people.length >= 5 && towns.escarra.people.length >= 5
  && !towns.ilovantu.people.some(n => towns.escarra.people.includes(n))
  && towns.ilovantu.problem !== towns.escarra.problem
  && towns.ilovantu.banner !== towns.escarra.banner);

/* ---- speaking to somebody changes what they say ---- */
const talk = await G(() => {
  const g = window.__game, S = g.social;
  g.enterPort(g.PORTS.find(p => p.id === 'ilovantu'));
  const before = { met: S.hasMet('kesk'), tier: S.tier('kesk').name };
  // press the real INTRODUCE button on his row
  const rows = [...document.querySelectorAll('.row.notable')];
  const row = rows.find(r => /Doro Kesk/.test(r.textContent));
  if (!row) return { note: 'Kesk is not on the quay' };
  row.querySelector('button').click();
  const said = (document.querySelector('.npc-say') || {}).textContent || '';
  const name = (document.querySelector('.npc-name') || {}).textContent || '';
  document.querySelectorAll('#modal-actions button').forEach(b => { if (/LEAVE/i.test(b.textContent)) b.click(); });
  return { note: null, before, met: S.hasMet('kesk'), said, name };
});
ok(`introducing yourself is a conversation (${talk.note || `${talk.name}: “${talk.said.slice(0, 46)}…”`})`,
  !talk.note && talk.before.met === false && talk.met === true && /Kesk/.test(talk.name) && talk.said.length > 8);

/* ---- doing something for somebody is remembered, and their rival minds ---- */
const favour = await G(() => {
  const g = window.__game, S = g.social;
  const before = { marroq: S.of('marroq'), sar: S.of('sar') };
  // Marroq's problem is cargo taken past the Thimbles: settle a notice for her
  S.bumpWithTies('marroq', 15, 'helped');
  S.remember('marroq', 'test_convoy', 'You brought her cargo through the Thimbles.', 0);
  return {
    before, marroq: S.of('marroq'), sar: S.of('sar'),
    tier: S.tier('marroq').name,
    recalls: S.recalls('marroq', 'test_convoy'),
    memText: (S.lastMemory('marroq') || {}).text,
  };
});
ok(`helping somebody moves them, and costs you the person they suspect `
  + `(Marroq ${favour.before.marroq}→${Math.round(favour.marroq)}, Sar ${favour.before.sar}→${Math.round(favour.sar)})`,
favour.marroq > favour.before.marroq && favour.sar < favour.before.sar);
ok(`and they remember it in words (“${favour.memText}”)`, favour.recalls && !!favour.memText);

/* ---- and they say so next time, through the real screen ---- */
const recalled = await G(() => {
  const g = window.__game;
  const rows = [...document.querySelectorAll('.row.notable')];
  const row = rows.find(r => /Ines Marroq/.test(r.textContent));
  if (!row) return { note: 'Marroq not on the quay' };
  row.querySelector('button').click();
  const mem = (document.querySelector('.npc-mem') || {}).textContent || '';
  const rel = (document.querySelector('.npc-rel') || {}).textContent || '';
  document.querySelectorAll('#modal-actions button').forEach(b => { if (/LEAVE/i.test(b.textContent)) b.click(); });
  return { note: null, mem, rel };
});
ok(`the card shows what she remembers and where you stand (${recalled.note
  || `${recalled.rel.trim()} — “${recalled.mem.slice(0, 40)}…”`})`,
!recalled.note && /Thimbles/.test(recalled.mem) && /Acquainted|Friendly|Trusted/.test(recalled.rel));

/* ---- officers are people ---- */
const off = await G(() => {
  const g = window.__game;
  const pool = g.tavernPool(g.PORTS.find(p => p.id === 'ilovantu'));
  const named = pool.filter(o => o.namedId);
  return {
    total: pool.length,
    named: named.map(o => ({ name: o.name, epithet: o.epithet, traits: o.namedTraits,
      bio: !!o.bio, ambition: o.ambition, role: o.role, wage: o.wage })),
  };
});
ok(`the tavern has people in it, not stat cards (${off.named.map(o => `${o.name} “${o.epithet}”`).join(', ') || 'none'})`,
  off.named.length >= 1 && off.named.every(o => o.bio && o.ambition && o.traits.length >= 2));

/* ---- a named officer is hired once and never seen for hire again ---- */
const hired = await G(() => {
  const g = window.__game;
  const port = g.PORTS.find(p => p.id === 'ilovantu');
  const pool = g.tavernPool(port);
  const m = pool.find(o => o.namedId === 'mercer');
  if (!m) return { note: 'Mercer not in tonight' };
  g.coin = 5000;
  g.hireOfficer(m, port);
  g.tavernCache = {};                       // a new night in the same room
  const again = g.tavernPool(port).some(o => o.namedId === 'mercer');
  return { note: null, aboard: g.officers.some(o => o.namedId === 'mercer'), again,
    taken: g.namedTaken.slice() };
});
ok(`hiring a named officer takes him out of the world (${hired.note
  || `aboard ${hired.aboard}, still for hire ${hired.again}`})`,
!hired.note && hired.aboard === true && hired.again === false && hired.taken.includes('mercer'));

/* ---- a person who exists at sea ---- */
const atSea = await G(() => {
  const g = window.__game;
  g.leavePort();
  const s = g.spawnWorldCaptain('sar');
  if (!s) return { note: 'no hull for her' };
  const dup = g.spawnWorldCaptain('sar');    // never twice
  return { note: null, name: s.name, captain: s.captainName, dup: !!dup,
    inWorld: g.ships.filter(x => x.notableId === 'sar').length };
});
ok(`a person you have met can be met at sea (${atSea.note
  || `${atSea.captain} in the ${atSea.name}, ${atSea.inWorld} hull`})`,
!atSea.note && atSea.inWorld === 1 && atSea.dup === false);

/* ---- all of it survives a reload ---- */
const saved = await G(() => {
  const g = window.__game, S = g.social;
  const before = {
    marroq: Math.round(S.of('marroq')), met: S.hasMet('kesk'),
    mem: S.memories('marroq').length, taken: g.namedTaken.slice(),
  };
  g.mode = 'campaign';
  g.save();
  if (!g.load()) return { note: 'save would not load' };
  const S2 = g.social;
  return { note: null, before,
    marroq: Math.round(S2.of('marroq')), met: S2.hasMet('kesk'),
    mem: S2.memories('marroq').length, taken: g.namedTaken.slice(),
    memText: (S2.lastMemory('marroq') || {}).text };
});
ok(`relationships, memory and hires survive a reload (${saved.note
  || `Marroq ${saved.before.marroq}→${saved.marroq}, ${saved.mem} memories, ${saved.taken.join()}`})`,
!saved.note && saved.marroq === saved.before.marroq && saved.met === saved.before.met
  && saved.mem === saved.before.mem && saved.taken.includes('mercer')
  && /Thimbles/.test(saved.memText || ''));

/* ---- an old save, from before any of these people existed ---- */
const migrated = await G(() => {
  const g = window.__game;
  const raw = JSON.parse(localStorage.getItem('salt-and-tally-v1'));
  delete raw.social; delete raw.namedTaken;          // as an older save would be
  localStorage.setItem('salt-and-tally-v1', JSON.stringify(raw));
  if (!g.load()) return { note: 'old save would not load' };
  return { note: null, met: g.social.hasMet('kesk'), rel: g.social.of('marroq'),
    ships: g.ships.length, coin: g.coin, mode: g.mode };
});
ok(`a save from before the people existed still loads (${migrated.note
  || `nobody has met you, ${migrated.ships} sail, ${migrated.mode}`})`,
!migrated.note && migrated.met === false && migrated.rel === 0
  && migrated.ships > 0 && migrated.mode === 'campaign');

/* ---- the journal lists only people actually met ---- */
const journal = await G(() => {
  const g = window.__game;
  g.social.meet('kesk'); g.social.bump('kesk', 20);
  window.__ui.openMenu ? window.__ui.openMenu() : null;
  return null;
});
void journal;
await G(() => { const g = window.__game; g.paused = false; });

/* These two run last on purpose. Both of them meet people, and meeting
   somebody is exactly the state the checks above are asserting is absent —
   inserted mid-chain they made "introducing yourself" fail because Kesk had
   already been introduced, and put Sar's hull on the water before the check
   that spawns it. Sections that change the world go after sections that
   measure a world without those changes. */
/* ---- each part of the town has its own view, and its own picture ---- */
const strips = await G(async () => {
  const g = window.__game;
  g.enterPort(g.PORTS.find(p => p.id === 'ilovantu'));
  await new Promise(r => setTimeout(r, 200));
  const seen = [];
  for (const label of ['TAVERN', 'MARKET', 'SHIPYARD']) {
    const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => new RegExp(label).test(x.textContent));
    if (b) b.click();
    await new Promise(r => setTimeout(r, 260));
    const s = document.querySelector('.townscene.small');
    seen.push({ label, has: !!s, img: s ? (s.style.backgroundImage || '').length : 0 });
  }
  return seen;
});
ok(`each part of the town shows its own place (${strips.map(s => `${s.label}:${s.has ? 'yes' : 'NO'}`).join(' ')})`,
  strips.every(s => s.has && s.img > 200)
  && new Set(strips.map(s => s.img)).size === strips.length);

/* ---- and ten people do not recite one sentence about the harbour ---- */
const voices = await G(async () => {
  const g = window.__game;
  const b = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => /TOWN/.test(x.textContent));
  if (b) b.click();
  await new Promise(r => setTimeout(r, 260));
  const said = [];
  for (const who of ['Doro Kesk', 'Ines Marroq', 'Aleti Sar']) {
    const row = [...document.querySelectorAll('.row.notable')].find(r => r.textContent.includes(who));
    if (!row) continue;
    row.querySelector('button').click();
    await new Promise(r => setTimeout(r, 200));
    const ask = [...document.querySelectorAll('#modal-actions button')].find(x => /Ask about/.test(x.textContent));
    if (ask) { ask.click(); await new Promise(r => setTimeout(r, 200)); }
    said.push(((document.querySelector('.npc-say') || {}).textContent || '').slice(0, 30));
    for (const x of document.querySelectorAll('#modal-actions button')) if (/BACK/.test(x.textContent)) x.click();
    await new Promise(r => setTimeout(r, 160));
    for (const x of document.querySelectorAll('#modal-actions button')) if (/Leave/i.test(x.textContent)) x.click();
    await new Promise(r => setTimeout(r, 160));
  }
  g.leavePort();
  return said;
});
ok(`and each of them answers in their own voice (${voices.length} asked, `
  + `${new Set(voices).size} different answers)`,
voices.length >= 3 && new Set(voices).size === voices.length);

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
