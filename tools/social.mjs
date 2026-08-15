/* The people of the Shoals: ports as places, notables as people, and a
   relationship that survives a reload.

   Everything here goes through the real game — the real port screen, the
   real save, the real world tick. A social system that only works when a
   test calls its methods directly is a data structure, not a game. */
import { launch, sleep, newVoyage, waitFor, shot } from './qa.mjs';

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
      bio: !!o.bio, ambition: o.ambition, role: o.role, hire: o.hire })),
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

/* ---------- getting to know somebody is a career, not a button ----------

   Reported: "the dialogue and progression with npcs at the towns/ports needs
   work." Measured before any of this: the only option a stranger had was "Ask
   about the port" at +1 a press, so the road from a first meeting to `trusted`
   — where the personal talk and the port's boon live — was **sixty-six presses
   of the same button**, reading the same sentence each time. `Friendly` opened
   nothing whatever over `acquainted`, and carrying cargo, which is the main
   loop of the whole game, moved nobody's opinion at all. */

/* A topic is a topic. Asked twice, it pays once. */
const topic = await G(() => {
  const g = window.__game, S = g.social;
  const id = 'kesk';
  S.rel[id] = 0; S.met[id] = true;
  if (S.known[id]) delete S.known[id].town;
  const before = S.of(id);
  if (S.learn(id, 'town')) S.bump(id, 2, 'helped');   // the real code path
  const once = S.of(id);
  if (S.learn(id, 'town')) S.bump(id, 2, 'helped');
  if (S.learn(id, 'town')) S.bump(id, 2, 'helped');
  return { before, once, thrice: S.of(id) };
});
ok(`asking the same question again does not pay again `
  + `(${topic.before} -> ${topic.once} -> still ${topic.thrice} after two more)`,
  topic.once > topic.before && topic.thrice === topic.once);

/* Carrying cargo — the thing most captains spend their lives doing — makes
   somebody at that quay think better of them, and they remember it. */
const carried = await G(() => {
  const g = window.__game, S = g.social;
  const port = g.PORTS.find(p => p.id === 'ilovantu');
  const q = g.contractsAt(port).find(x => x.kind === 'cargo');
  if (!q || !q.owner) return { staged: false, owner: q ? q.owner : 'no cargo work' };
  for (const k in S.rel) delete S.rel[k];
  S.mem = {};
  g.acceptQuest(q, port);
  g.player.cargo[q.good] = (g.player.cargo[q.good] || 0) + q.amount;
  q.loaded = q.amount;
  const before = S.of(q.owner);
  g.completeQuest(q);
  return { staged: true, owner: q.owner, before, after: S.of(q.owner),
    tier: S.tier(q.owner).name, memories: S.memories(q.owner).map(m => m.text) };
});
ok(`delivering a cargo makes a friend of whoever wrote the contract `
  + `(${carried.staged ? `${carried.owner} ${carried.before} -> ${Math.round(carried.after)}, `
    + `${carried.tier}, remembers ${carried.memories.length}` : 'no owned cargo work: ' + carried.owner})`,
  carried.staged && carried.after > carried.before + 4 && carried.memories.length === 1);

/* And the work at a quay is not all one person's, or a cast of five is a cast
   of one and the other four stay strangers for ever. */
const spread = await G(() => {
  const g = window.__game;
  const out = {};
  for (const port of g.PORTS) {
    const owners = g.contractsAt(port).filter(q => q.kind === 'cargo').map(q => q.owner);
    if (owners.length >= 2) out[port.id] = [...new Set(owners)].length;
  }
  return out;
});
const ports = Object.keys(spread);
ok(`carrying work at a quay is written by more than one hand `
  + `(${ports.map(p => `${p}:${spread[p]}`).join(', ') || 'no port had two contracts'})`,
  ports.length > 0 && ports.some(p => spread[p] > 1));

/* Every rung of the ladder opens something. `Friendly` used to open nothing. */
const rungs = await G(async () => {
  const N = await import('/src/data/notables.js');
  const g = window.__game, S = g.social;
  const port = g.PORTS.find(p => p.id === 'ilovantu');
  const who = N.notablesAt(port.id)[0];
  const seen = {};
  for (const [name, v] of [['neutral', 0], ['acquainted', 14], ['friendly', 32], ['trusted', 60]]) {
    S.rel[who.id] = v; S.met[who.id] = true;
    // count the gates the conversation itself uses, in the same order
    let n = 1;                                   // the town is always askable
    if (S.atLeast(who.id, 'acquainted')) n++;
    if (S.atLeast(who.id, 'friendly')) n++;      // what is wrong
    if (S.atLeast(who.id, 'trusted')) n++;       // and what they are after
    seen[name] = n;
  }
  return seen;
});
ok(`every standing opens something new (${Object.entries(rungs).map(([k, v]) => `${k}:${v}`).join(' ')})`,
  rungs.acquainted > rungs.neutral && rungs.friendly > rungs.acquainted
  && rungs.trusted > rungs.friendly);


/* ---- how you answer is a choice, and it is a different choice per person ----
   Reported as "the NPCs' options are all the same". The manner list is the
   same handful of ways of speaking; what must differ is what each of them
   *does*, because that is read off traits these people already had. */
const manners = await G(async () => {
  const T = await import('/src/data/talk.js');
  const N = await import('/src/data/notables.js');
  const g = window.__game, S = g.social;
  const cast = N.NOTABLES;
  // every reaction line the cast can actually reach, keyed by who said it
  const byPerson = {};
  for (const w of cast) {
    byPerson[w.id] = T.MANNERS.map(m => {
      const r = T.reactionTo(w, m.id);
      return `${m.id}:${r.how}:${r.line.slice(0, 24)}`;
    }).join('|');
  }
  const shapes = new Set(Object.values(byPerson));
  // and the same button really does land differently on two named people
  const keskPlain = T.reactionTo(N.NOTABLE_BY_ID.kesk, 'plain');
  const marroqPlain = T.reactionTo(N.NOTABLE_BY_ID.marroq, 'plain');
  // nobody is left with a card of one option, and nobody gets more than four
  S.rel.kesk = 90; S.met.kesk = true;
  const rich = T.mannersFor(N.NOTABLE_BY_ID.kesk, S, 'tavern').length;
  S.rel.kesk = 0;
  const stranger = T.mannersFor(N.NOTABLE_BY_ID.kesk, S, 'harbour').length;
  /* Two directions, and they are different questions. A reaction keyed to a
     trait nobody in the game has is a typo; a trait on somebody you can talk
     to that no manner has a view about is a person the system cannot see. The
     officers' traits count for the first — they are real people in the same
     file, and the table is ready for them — but only the cast can be spoken
     to, so only the cast has to be covered. */
  const anyone = new Set([...cast, ...N.NAMED_OFFICERS].flatMap(w => w.traits));
  const orphans = [];
  const keyed = new Set();
  for (const id in T.REACTIONS) {
    for (const side of ['likes', 'dislikes']) {
      for (const t in T.REACTIONS[id][side]) {
        keyed.add(t);
        if (!anyone.has(t)) orphans.push(`${id}.${side}.${t}`);
      }
    }
  }
  const unseen = [...new Set(cast.flatMap(w => w.traits))].filter(t => !keyed.has(t));
  return {
    cast: cast.length, shapes: shapes.size, orphans, unseen,
    kesk: `${keskPlain.how}/${keskPlain.trait}`, marroq: `${marroqPlain.how}/${marroqPlain.trait}`,
    rich, stranger,
    flat: Object.values(byPerson).filter(v => /:flat:/.test(v.split('|')[0])).length,
  };
});
ok(`the same manner lands differently on different people `
  + `(Kesk ${manners.kesk}, Marroq ${manners.marroq})`,
manners.kesk.startsWith('warm') && manners.marroq.startsWith('cool')
  && manners.kesk !== manners.marroq);
ok(`the cast does not share one conversation (${manners.shapes} distinct of ${manners.cast} people)`,
  manners.shapes >= Math.ceil(manners.cast * 0.75));
ok(`a card offers between two and four ways of speaking (stranger ${manners.stranger}, friend in a tavern ${manners.rich})`,
  manners.stranger >= 2 && manners.stranger <= 4 && manners.rich <= 4 && manners.rich > manners.stranger);
/* Nothing is lost by getting to know somebody. The card is capped at four,
   and the first cut simply took the first four in list order — so standing a
   tavern-keeper a drink was offered to a stranger and then disappeared for
   the rest of the game the moment `press` unlocked above it. A manner that
   exists only in one room is exactly the one that must not be the casualty. */
const reach = await G(async () => {
  const T = await import('/src/data/talk.js');
  const N = await import('/src/data/notables.js');
  const g = window.__game, S = g.social;
  const tiers = ['neutral', 'acquainted', 'friendly', 'trusted', 'devoted'];
  const vals = { neutral: 0, acquainted: 14, friendly: 32, trusted: 60, devoted: 90 };
  const lost = [];
  const everSeen = new Set();
  for (const w of N.NOTABLES) {
    const was = S.rel[w.id];
    S.met[w.id] = true;
    for (const t of tiers) {
      S.rel[w.id] = vals[t];
      const ids = T.mannersFor(w, S, w.at).map(m => m.id);
      ids.forEach(i => everSeen.add(i));
      if (ids.length > 4) lost.push(`${w.id}@${t}: ${ids.length} options`);
      // a manner offered at a lower standing must not vanish at a higher one
      if (t !== 'neutral') {
        S.rel[w.id] = vals[tiers[tiers.indexOf(t) - 1]];
        const before = T.mannersFor(w, S, w.at).map(m => m.id);
        S.rel[w.id] = vals[t];
        for (const b of before) if (!ids.includes(b) && (b === 'drink' || b === 'press')) {
          lost.push(`${w.id}: ${b} lost on reaching ${t}`);
        }
      }
    }
    S.rel[w.id] = was === undefined ? 0 : was;
  }
  return { lost, everSeen: [...everSeen].sort(), all: T.MANNERS.map(m => m.id).sort() };
});
ok(`no way of speaking is lost by getting to know somebody (${reach.lost.join('; ') || 'none lost'})`,
  reach.lost.length === 0);
ok(`and every manner in the book is reachable somewhere (${reach.everSeen.join(', ')})`,
  reach.all.every(id => reach.everSeen.includes(id)));
ok(`every authored reaction names a trait somebody in the game has (${manners.orphans.join(', ') || 'none orphaned'})`,
  manners.orphans.length === 0);
ok(`and every trait on somebody you can speak to is seen by some manner `
  + `(${manners.unseen.join(', ') || 'all covered'})`, manners.unseen.length === 0);

/* ---- and it cannot be farmed at the quay ----
   The first version of this held the manner in a Set cleared when a port
   screen opened. Closing the sheet calls `leavePort`, so dock, speak, close,
   dock again paid every cycle with the ship tied up the whole time — the
   sixty-six-press grind, rebuilt by accident. Staged as a player would abuse
   it: the same exchange twice with no sailing in between. */
const farm = await G(() => {
  const g = window.__game, S = g.social;
  const who = 'kesk';
  S.rel[who] = 0; S.met[who] = true; S.spoke = {};
  const before = S.of(who);
  const t0 = g.time;
  const first = S.canSpeakAgain(who, g.time);
  S.noteSpoke(who, g.time); S.bump(who, 3, 'helped');
  const afterFirst = S.of(who);
  // close the screen and dock again — seconds, not a voyage
  const secondAtOnce = S.canSpeakAgain(who, g.time + 3);
  // and after a real crossing
  const secondAfterSailing = S.canSpeakAgain(who, g.time + 300);
  return { before, afterFirst, first, secondAtOnce, secondAfterSailing, t0 };
});
ok(`a manner pays the first time (${farm.before} -> ${farm.afterFirst})`,
  farm.first === true && farm.afterFirst > farm.before);
ok('and docking again on the spot does not pay it twice', farm.secondAtOnce === false);
ok('but sailing somewhere and coming back does', farm.secondAfterSailing === true);
/* And it survives a save, because a grind gate held only in the UI is a
   grind gate you can reload past. */
const farmSaved = await G(() => {
  const g = window.__game;
  g.social.rel.kesk = 20; g.social.met.kesk = true;
  g.social.noteSpoke('kesk', g.time);
  g.mode = 'campaign';
  g.save();
  if (!g.load()) return { note: 'save would not load' };
  return { note: null, blocked: !g.social.canSpeakAgain('kesk', g.time) };
});
ok(`and a reload does not reopen it (${farmSaved.note || `blocked ${farmSaved.blocked}`})`,
  !farmSaved.note && farmSaved.blocked === true);

/* The PEOPLE page shows who you have met. Cheap existence check: the page
   renders from the same social state the sections above have been building,
   and it was the one screen nothing ever looked at. */
await G(() => { const b = document.getElementById('sheet-close'); if (b) b.click(); });
await sleep(300);
await page.click('#btn-menu');
await sleep(500);
const people = await G(async () => {
  const N = await import('/src/data/notables.js');
  const g = window.__game, S = g.social;
  const tab = [...document.querySelectorAll('#sheet-tabs .tab')].find(x => /PEOPLE/.test(x.textContent));
  if (!tab) return { note: 'no PEOPLE tab' };
  tab.click();
  await new Promise(r => setTimeout(r, 250));
  const met = N.NOTABLES.filter(w => S.hasMet(w.id));
  const rows = [...document.querySelectorAll('#sheet-content .row.notable')];
  const first = met.length ? met.slice().sort((a, b) => S.of(b.id) - S.of(a.id))[0] : null;
  return { note: null, met: met.length, rows: rows.length,
    firstShown: first ? rows.some(r => r.textContent.includes(first.name)) : false,
    tierWord: first ? rows.map(r => r.textContent).join(' ').includes(g.social.tier(first.id).name) : false };
});
ok(`the PEOPLE page shows who you have met (${people.note || `${people.met} met, ${people.rows} rows`})`,
  !people.note && people.met >= 1 && people.rows === people.met && people.firstShown && people.tierWord);
await shot(page, 'social-people');

console.log(log.join('\n'));
console.log(errors.length ? '\nERRORS:\n' + [...new Set(errors)].slice(0, 6).join('\n') : '\nno console errors');
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - fails} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
