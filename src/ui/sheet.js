/* Bottom-sheet screens: harbour, market, crew, shipyard, tavern,
   plus the log/menu. Everything is a tall scrolling list of big rows —
   the shape thumbs are happiest with. */
import { $, el, clear, onTap, toast, modal } from './dom.js';
import { GOODS, RANKS, RANK_ORDER, OFFICER_ROLES, HULLS, FACTIONS } from '../data/gamedata.js';
import { repairCost, recruitCost, PROVISION_PRICE, SHOT_PRICE } from '../sim/economy.js';
import { drawPortrait, officerLabel, officerEffect } from '../sim/officers.js';
import { AMBITIONS, CHAPTERS } from '../data/origins.js';
import { KEYMAP } from '../core/keys.js';
import { PORT_IDENTITY, NOTABLES, notablesAt, tiesFor, NOTABLE_BY_ID } from '../data/notables.js';
import { greetingFor, tierOf } from '../sim/social.js';
import { COLOURS_STANDING, COLOURS_INFAMY } from '../sim/encounter.js';
import { fmtCoin, clamp } from '../core/util.js';
import { sfxCoin, toggleMute, audio, getMix, setMixLevel, mixDefaults } from '../core/audio.js';

let G = null;
let current = null;     // {tabs, tab, port}
let qtyMult = 1;
/* Which deck new hands join. Reset when a port opens, so it can never point
   at a ship you sold or a prize in another harbour. */
let recruitTo = null;

export function initSheet(game) {
  G = game;
  onTap($('sheet-close'), () => closeSheet(), 420);
  $('sheet-scrim').addEventListener('click', () => closeSheet());
}

export function isSheetOpen() { return !$('sheet').classList.contains('hidden'); }

export function closeSheet() {
  $('sheet').classList.add('hidden');
  const wasPort = current && current.port;
  current = null;
  if (wasPort) G.leavePort();
}

function openSheet(title, sub, tabs, initial) {
  current = { tabs, tab: initial || tabs[0].id, port: current?.port };
  $('sheet').classList.remove('hidden');
  $('sheet-title').innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  renderTabs();
  renderTab();
}

function renderTabs() {
  const box = $('sheet-tabs');
  clear(box);
  if (current.tabs.length < 2) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  for (const t of current.tabs) {
    const b = el('button', 'tab' + (t.id === current.tab ? ' on' : ''), `${t.icon || ''} ${t.label}`);
    onTap(b, () => { current.tab = t.id; renderTabs(); renderTab(); }, 700);
    box.appendChild(b);
  }
}
/** Walk to another part of the town. Used by the hub's WHERE TO GO rows. */
function goTab(id) {
  if (!current || !current.tabs.some(t => t.id === id)) return;
  current.tab = id;
  renderTabs();
  renderTab();
}

function renderTab(keepScroll = false) {
  const c = $('sheet-content');
  /* Switching tabs starts at the top; redrawing the tab you are already on
     must not move your eye. Every purchase, recruitment and refit calls
     refresh(), which rebuilds the whole list — and that used to throw the
     player back to the top of a long market or tavern, so buying the last
     goods on the page meant scrolling all the way down again to buy more. */
  const y = keepScroll ? c.scrollTop : 0;
  clear(c);
  const t = current.tabs.find(x => x.id === current.tab);
  t && t.render(c);
  // clamp: the list can be shorter after a purchase than it was before
  c.scrollTop = Math.max(0, Math.min(y, c.scrollHeight - c.clientHeight));
}
function refresh() { renderTab(true); }

/* =========================================================
   PORT
   ========================================================= */
export function openPort(port) {
  current = { port };
  recruitTo = null;   // this harbour's fleet, not the last one's
  const svc = port.services;
  const tabs = [];
  /* The town before the transactions.
     A port used to open on a row of shop counters, which is how a place
     becomes a dashboard. It opens on the place now — who is here, what they
     are worried about, and where in the town you could go — and the counters
     are still one tap away for anybody who just wants to buy shot. Only the
     two ports authored with people get it; the rest open as they always did,
     which is also how this scales without a half-finished town anywhere. */
  if (PORT_IDENTITY[port.id]) {
    tabs.push({ id: 'town', label: 'THE TOWN', icon: '⌂', render: n => townTab(n, port) });
  }
  tabs.push({ id: 'harbour', label: 'HARBOUR', icon: '⚓', render: n => harbourTab(n, port) });
  if (svc.includes('market')) tabs.push({ id: 'market', label: 'MARKET', icon: '▣', render: n => marketTab(n, port) });
  if (svc.includes('crew')) tabs.push({ id: 'crew', label: 'CREW', icon: '☰', render: n => crewTab(n, port) });
  if (svc.includes('shipyard')) tabs.push({ id: 'yard', label: 'SHIPYARD', icon: '⚒', render: n => yardTab(n, port) });
  if (svc.includes('tavern')) tabs.push({ id: 'tavern', label: 'TAVERN', icon: '☕', render: n => tavernTab(n, port) });
  const fac = FACTIONS[port.faction];
  openSheet(port.name, `${port.tagline.toUpperCase()} · ${fac.short}`, tabs,
    PORT_IDENTITY[port.id] ? 'town' : 'harbour');
}

/** A view of the part of the town you are standing in. Authored ports only —
    everywhere else the tabs open as they always did, with no strip at all. */
function placeStrip(n, port, place, label) {
  if (!PORT_IDENTITY[port.id]) return;
  const shot = portPortrait(port, place);
  const strip = el('div', 'townscene small');
  strip.style.setProperty('--banner', PORT_IDENTITY[port.id].banner);
  if (shot) strip.style.backgroundImage = `url(${shot})`;
  else strip.classList.add('noshot');
  strip.innerHTML = `<div class="ts-grade"></div>
    <div class="ts-name">${label}<span>${port.name}</span></div>`;
  n.appendChild(strip);
}

/* ---------------- the town ----------------
   Place, then people, then opportunities — in that order, because that is the
   order a person arriving somewhere actually takes it in. */
function townTab(n, port) {
  const idn = PORT_IDENTITY[port.id];
  const S = G.social;

  /* The place, photographed rather than drawn.
     A real render of this harbour from the water — the same buildings and the
     same light the player just sailed past — with the town's name and its
     power's colour over it. Cached per port for the life of the session: the
     view does not change while you are standing in it, and re-rendering the
     world every time a tab redraws would be absurd. */
  const scene = el('div', 'townscene');
  scene.style.setProperty('--banner', idn.banner);
  const shot = portPortrait(port);
  if (shot) scene.style.backgroundImage = `url(${shot})`;
  else scene.classList.add('noshot');
  scene.innerHTML = `<div class="ts-grade"></div>
    <div class="ts-name">${port.name}<span>${idn.role}</span></div>
    <div class="ts-flag"></div>`;
  n.appendChild(scene);
  n.appendChild(el('div', 'town-role', `${idn.tone}`));
  n.appendChild(el('div', 'note', idn.line));

  // what the town is worried about — the reason there is work here at all
  const prob = el('div', 'town-problem');
  prob.innerHTML = `<span class="tp-k">TALK ON THE QUAY</span><span>${idn.problem}</span>`;
  n.appendChild(prob);

  /* the people, at the places they actually stand */
  n.appendChild(el('div', 'sec-title', 'PEOPLE HERE'));
  for (const who of notablesAt(port.id)) {
    n.appendChild(notableRow(who, port));
  }

  /* and the ways further in, named for what they are rather than what they sell */
  n.appendChild(el('div', 'sec-title', 'WHERE TO GO'));
  const places = [
    { tab: 'harbour', label: 'The Quay', sub: 'Repairs, stores, the harbourmaster’s board' },
    { tab: 'market', label: 'The Market', sub: 'Cargo, bought and sold' },
    { tab: 'crew', label: 'The Hiring Steps', sub: 'Hands for the fleet' },
    { tab: 'yard', label: 'The Yard', sub: 'Prizes, refits, your fleet' },
    { tab: 'tavern', label: 'The Tavern', sub: 'Officers, rumours, whoever is in' },
  ];
  for (const pl of places) {
    if (!current.tabs.some(t => t.id === pl.tab)) continue;
    const r = el('div', 'row place');
    r.appendChild(el('div', 'rmain', `<div class="rtitle">${pl.label}</div><div class="rsub">${pl.sub}</div>`));
    const b = el('button', 'btn', 'GO');
    onTap(b, () => goTab(pl.tab), 500);
    r.appendChild(b);
    n.appendChild(r);
  }
  void S;
}

/* One render per port *and place* per session. Pressing TAVERN should move
   the view to a building in the town, not merely relabel the same picture. */
const PORTRAITS = {};

/** Which of the town's own buildings belongs to which part of the port.
    Chosen by hashing the place name against the list the settlement recorded,
    so a given town always puts its tavern in the same building — and two
    different towns put theirs somewhere different. */
function spotFor(port, place) {
  const shore = (window.__shore || {})[port.id];
  if (!shore) return null;
  if ((place === 'harbour' || place === 'crew') && shore.piers && shore.piers.length) {
    return { ...shore.piers[0], quay: true };
  }
  const spots = shore.spots || [];
  if (!spots.length) return null;
  /* The actual building. The town builds a real tavern, a real market stall
     and a real shipyard frame on its waterfront and records which is which,
     so THE TAVERN frames the thing with the sign and the barrels outside it
     rather than a house that happened to hash to that slot. */
  const named = spots.find(s => s.kind === place);
  if (named) return named;
  let h = 0x9e37;
  for (let i = 0; i < place.length; i++) h = Math.imul(h ^ place.charCodeAt(i), 0x01000193) >>> 0;
  const front = spots.filter(s => s.front);
  const rank = (front.length >= 3 ? front : spots)
    .slice().sort((a, b) => (b.w * b.h) - (a.w * a.h)).slice(0, 8);
  return rank.length ? rank[h % rank.length] : null;
}
/** The angle each harbour actually looks best from — chosen by eye, not by
    formula: a town wants to be seen from the water it is entered from. */
const PORTRAIT_VIEW = {
  ilovantu: { dist: 165, high: 52 },
  escarra: { dist: 130, high: 44 },
};
function portPortrait(port, place = 'town') {
  const key = `${port.id}:${place}`;
  if (PORTRAITS[key] !== undefined) return PORTRAITS[key];
  const v = PORTRAIT_VIEW[port.id] || {};
  if (typeof window === 'undefined' || !window.__portrait) { PORTRAITS[key] = null; return null; }
  /* A named place in the town: stand close to that building, from the water
     side, so the player sees the actual thing they just chose. */
  if (place !== 'town') {
    const spot = spotFor(port, place);
    if (spot) {
      const sh = (window.__shore || {})[port.id];
      const ang = sh ? Math.atan2(sh.x - sh.townX, sh.z - sh.townZ) : 0;
      /* Far enough back that a building reads as a building, and aimed at the
         building rather than at the grass beside it. At fifty metres the lens
         was inside the hedge; at ninety it was looking downhill past the roof. */
      const top = (spot.y || 0) + (spot.h || 10);
      /* Closer for a building we actually know the identity of: it has been
         given elbow room on the waterfront, so the lens can come in and let
         it fill the frame instead of hedging against its neighbours. */
      const known = !!spot.kind && spot.kind !== 'house' && spot.kind !== 'warehouse';
      PORTRAITS[key] = window.__portrait(spot.x, spot.z, {
        w: 720, h: 220, ang,
        dist: spot.quay ? 110 : (known ? 54 : 78),
        high: spot.quay ? 34 : top + (known ? 6 : 16),
        lookY: spot.quay ? 4 : (spot.y || 0) + (spot.h || 10) * 0.5,
      });
      return PORTRAITS[key];
    }
  }
  /* Aim between the harbour and the town it belongs to, and stand off on the
     seaward side. Pointed at the port marker alone the camera looks at open
     water with the buildings shoved into one corner — the harbour is the
     water, but the *town* is what a picture of a town should be about. */
  const shore = (window.__shore || {})[port.id];
  const tx = shore ? port.x + (shore.x - port.x) * 0.45 : port.x;
  const tz = shore ? port.z + (shore.z - port.z) * 0.45 : port.z;
  const ang = shore ? Math.atan2(port.x - shore.x, port.z - shore.z) : (v.ang || 0);
  PORTRAITS[key] = window.__portrait(tx, tz, {
    w: 720, h: 260, dist: 250, high: 78, ...v, ang: v.ang ?? ang,
  });
  return PORTRAITS[key];
}

/** One person, as they would appear to somebody standing on the quay. */
function notableRow(who, port) {
  const S = G.social;
  const v = S.of(who.id);
  const t = tierOf(v);
  const r = el('div', 'row notable');
  const pc = document.createElement('canvas');
  pc.className = 'npc-face';
  drawPortrait(pc, { seed: who.seed }, 44);
  r.appendChild(pc);
  const known = S.hasMet(who.id);
  r.appendChild(el('div', 'rmain',
    `<div class="rtitle">${who.name}</div>
     <div class="rsub">${who.title} · <span class="rel ${t.id}">${known ? t.name : 'Stranger'}</span></div>
     <div class="statline"><span>${who.blurb}</span></div>`));
  const b = el('button', 'btn' + (known ? '' : ' gold'), known ? 'SPEAK' : 'INTRODUCE');
  onTap(b, () => openNotable(who, port), 520);
  r.appendChild(b);
  return r;
}

/* ---------------- a conversation ----------------
   Restrained: a face, a name, what they think of you, one thing they say, and
   a few things worth asking. Not every simulation variable — what they want is
   theirs until you earn it. */
function openNotable(who, port) {
  const S = G.social;
  const first = S.meet(who.id);
  if (first) S.bump(who.id, 3, 'helped');
  const g = greetingFor(who, S);
  const t = tierOf(S.of(who.id));

  const body = [];
  body.push(`<div class="npc-card">
      <canvas class="npc-face big" data-seed="${who.seed}"></canvas>
      <div class="npc-id">
        <div class="npc-name">${who.name}</div>
        <div class="npc-title">${who.title} — ${port.name}</div>
        <div class="npc-rel"><span class="rel ${t.id}">${t.name}</span></div>
      </div>
    </div>`);
  body.push(`<p class="npc-say">“${g.line}”</p>`);
  if (g.memory) body.push(`<p class="npc-mem">${g.memory}</p>`);

  const acts = [];
  // what they know about the town — always available, and how rumours travel
  /* Their own view of the place, not the town's press release. Ten people
     reciting one sentence about the harbour is how a cast of characters turns
     back into a menu — so each of them answers this in their own voice, and
     what the town at large is worried about is on the town screen where it
     belongs. */
  acts.push({
    label: `Ask about ${port.name}`,
    fn: () => {
      S.bump(who.id, 1, 'helped');
      S.learn(who.id, 'town');
      modal({
        title: who.name, dismissable: true,
        text: `<p class="npc-say">“${who.onTown || PORT_IDENTITY[port.id].problem}”</p>`,
        actions: [{ label: 'BACK', fn: () => openNotable(who, port) }],
      });
    },
  });
  // who they cannot stand — earned, not given
  if (S.atLeast(who.id, 'acquainted')) {
    acts.push({
      label: 'Ask about the others',
      fn: () => {
        const ties = tiesFor(who.id);
        for (const ti of ties) S.learn(who.id, 'ties');
        const txt = ties.length
          ? ties.map(ti => `<p class="npc-mem">${ti.line}</p>`).join('')
          : '<p class="npc-mem">“I keep to my own business.”</p>';
        modal({
          title: `${who.name} on the town`, dismissable: true, text: txt,
          actions: [{ label: 'BACK', fn: () => openNotable(who, port) }],
        });
      },
    });
  }
  // and what they actually want — only from someone they trust
  if (S.atLeast(who.id, 'trusted') && who.hidden) {
    acts.push({
      label: 'Personal matters',
      cls: 'gold',
      fn: () => {
        S.learn(who.id, 'ambition'); S.learn(who.id, 'problem');
        modal({
          title: who.name, dismissable: true,
          text: `<p class="npc-say">“${who.hidden.problem}”</p>`
            + `<p class="npc-mem">What they want: ${who.hidden.ambition}</p>`,
          actions: [{ label: 'BACK', fn: () => openNotable(who, port) }],
        });
      },
    });
  }
  // the one thing this port can give you, if the right person likes you
  const boon = PORT_IDENTITY[port.id].boon;
  if (boon && boon.from === who.id && S.atLeast(who.id, boon.need) && !S.hasFlag(boon.id)) {
    acts.push({
      label: boon.name.toUpperCase(), cls: 'gold',
      fn: () => {
        S.flag(boon.id);
        G.grantBoon(boon, who);
        toast(`${boon.name} — ${who.name} owes you nothing now.`, 'gold', 5200);
      },
    });
  }
  acts.push({ label: 'Leave', cls: 'dim', fn: () => { } });

  modal({ title: null, dismissable: true, text: body.join(''), actions: acts });
  // portraits draw after the modal exists
  setTimeout(() => {
    for (const c of document.querySelectorAll('canvas.npc-face[data-seed]')) {
      drawPortrait(c, { seed: +c.dataset.seed }, 64);
    }
  }, 0);
}

/* ---------------- harbour ---------------- */
function harbourTab(n, port) {
  placeStrip(n, port, 'harbour', 'The Quay');
  const p = G.player;
  n.appendChild(el('div', 'note', port.desc));

  n.appendChild(el('div', 'sec-title', 'REPAIRS'));
  const cost = repairCost(p);
  const needsWork = cost > 0;
  const row = el('div', 'row');
  row.appendChild(el('div', 'rmain',
    `<div class="rtitle">Careen &amp; Refit</div>
     <div class="rsub">${needsWork
      ? `Hull ${Math.round(p.hull)}/${p.hullMax} · rigging ${Math.round(p.sails)}/${p.sailMax} · ${p.gunsPort + p.gunsStb}/${p.gunsMax * 2} guns`
      : 'Sound from keel to truck. Nothing to do.'}</div>`));
  const b = el('button', 'btn' + (needsWork ? ' gold' : ' dim'), needsWork ? `◆ ${cost}` : 'READY');
  b.disabled = !needsWork || G.coin < cost;
  onTap(b, () => {
    if (G.coin < cost) return toast('Not enough coin.', 'bad');
    G.coin -= cost;
    const marked = G.repair(p);
    sfxCoin();
    toast(marked ? 'Refitted — and she carries the marks of it.' : 'Refitted and watertight.', 'good');
    G.save(); refresh();
  });
  row.appendChild(b);
  n.appendChild(row);

  // consorts
  for (const s of G.fleet) {
    if (s.isPlayer) continue;
    const c2 = repairCost(s);
    if (c2 <= 0) continue;
    const r2 = el('div', 'row');
    r2.appendChild(el('div', 'rmain', `<div class="rtitle">${s.name}</div><div class="rsub">${s.cls.name} · hull ${Math.round(s.hull)}/${s.hullMax}</div>`));
    const b2 = el('button', 'btn gold', `◆ ${c2}`);
    b2.disabled = G.coin < c2;
    onTap(b2, () => {
      G.coin -= c2; G.repair(s);
      sfxCoin(); toast(`${s.name} refitted.`, 'good'); G.save(); refresh();
    });
    r2.appendChild(b2);
    n.appendChild(r2);
  }

  n.appendChild(el('div', 'sec-title', 'STORES'));
  n.appendChild(supplyRow('Provisions', '◎', `Feeds the crew at sea. ${Math.floor(p.provisions)} aboard.`,
    PROVISION_PRICE, () => { p.provisions += 10 * qtyMult; }, 10));
  n.appendChild(supplyRow('Shot &amp; Powder', '◉', `Each broadside burns a few. ${p.shot} aboard.`,
    SHOT_PRICE, () => { p.shot += 10 * qtyMult; }, 10));

  /* Powder for the rest of the fleet.
     Stores only ever went aboard the flagship, and nothing anywhere refilled a
     consort — so a prize taken into the fleet fired off what was in her lockers
     when you took her and was a hull with sails after that. A captain with four
     ships had one ship and three witnesses. This fills every locker in the
     fleet at the same price a barrel costs the flagship. */
  const stores = G.fleetStores();
  if (stores.consorts.length) {
    const { short, dry, cost } = stores;
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">Powder for the Consorts</div>
       <div class="rsub">${short
        ? `${stores.consorts.length} consort${stores.consorts.length > 1 ? 's' : ''}, ${short} short between them`
          + `${dry ? ` · <b>${dry} with empty lockers</b>` : ''}`
        : 'Every locker in the fleet is full.'}</div>`));
    const bb = el('button', 'btn' + (short ? ' gold' : ' dim'), short ? `◆ ${cost}` : 'FULL');
    bb.disabled = !short || G.coin < cost;
    onTap(bb, () => {
      if (!G.storeFleet()) return toast('Not enough coin.', 'bad');
      sfxCoin(); toast('The fleet is stored.', 'good'); refresh();
    });
    r.appendChild(bb);
    n.appendChild(r);
  }

  const contracts = G.contractsAt(port);
  const carrying = contracts.filter(q => q.kind !== 'bounty');
  const bounties = contracts.filter(q => q.kind === 'bounty');
  n.appendChild(el('div', 'sec-title', 'HARBOURMASTER'));
  if (!carrying.length) n.appendChild(el('div', 'note', 'No work on the board today. Try the tavern.'));
  for (const q of carrying) n.appendChild(questRow(q, port));

  /* The other half of the board. A bounty names a ship already out there, so
     the row says who and how heavy — enough to judge whether she is worth the
     powder before you sail. */
  if (bounties.length) {
    n.appendChild(el('div', 'sec-title', 'NOTICES POSTED'));
    for (const q of bounties) {
      const t = G.ships.find(x => x.id === q.targetId);
      const gone = !t || !t.alive || t.captured;
      const r = el('div', 'row');
      const bearing = t && !gone ? G.bearingWords(t.x, t.z) : null;
      r.appendChild(el('div', 'rmain',
        `<div class="rtitle">${q.title}${q.active ? ' <span class="pill">TAKEN</span>' : ''}</div>
         <div class="rsub">${q.brief}</div>
         <div class="statline">
           <span>pays <b>◆${q.reward}</b></span>
           <span>prestige <b>${q.prestige}</b></span>
           ${bearing ? `<span>last word <b>${bearing}</b></span>` : '<span>no word of her</span>'}
         </div>`));
      if (!q.active && !gone) {
        const b = el('button', 'btn gold', 'TAKE IT');
        onTap(b, () => { G.acceptQuest(q, port); refresh(); });
        r.appendChild(b);
      }
      n.appendChild(r);
    }
  }

  const activeQ = G.quests.filter(q => q.active);
  if (activeQ.length) {
    n.appendChild(el('div', 'sec-title', 'YOUR UNDERTAKINGS'));
    for (const q of activeQ) {
      const r = el('div', 'row');
      r.appendChild(el('div', 'rmain', `<div class="rtitle">${q.title}</div><div class="rsub">${G.questStatus(q)}</div>`));
      if (G.canCompleteHere(q, port)) {
        const bb = el('button', 'btn gold', 'DELIVER');
        onTap(bb, () => { G.completeQuest(q); refresh(); });
        r.appendChild(bb);
      }
      n.appendChild(r);
    }
  }

  const sail = el('button', 'btn wide gold', 'PUT TO SEA');
  onTap(sail, () => closeSheet(), 760);
  n.appendChild(sail);
}

function supplyRow(name, icon, sub, unit, apply, per) {
  const row = el('div', 'row');
  row.appendChild(el('div', 'rmain', `<div class="rtitle">${icon} ${name}</div><div class="rsub">${sub}</div>`));
  const price = unit * per * qtyMult;
  const b = el('button', 'btn gold', `+${per * qtyMult} ◆${price}`);
  b.disabled = G.coin < price;
  onTap(b, () => {
    if (G.coin < price) return toast('Not enough coin.', 'bad');
    G.coin -= price; apply(); sfxCoin(); G.save(); refresh();
  });
  row.appendChild(b);
  return row;
}

function questRow(q, port) {
  const r = el('div', 'row');
  r.appendChild(el('div', 'rmain',
    `<div class="rtitle">${q.title} ${q.kind === 'hunt' ? '<span class="pill r">HUNT</span>' : '<span class="pill b">CARGO</span>'}</div>
     <div class="rsub">${q.brief}</div>
     <div class="statline"><span>Freight <b>◆${q.reward}</b></span>${q.advance
      ? `<span>Advance <b>◆${q.advance}</b></span>` : ''}<span>Prestige <b>+${q.prestige}</b></span></div>`));
  const b = el('button', 'btn gold', 'ACCEPT');
  onTap(b, () => { G.acceptQuest(q, port); refresh(); });
  r.appendChild(b);
  return r;
}

/* ---------------- market ---------------- */
function marketTab(n, port) {
  placeStrip(n, port, 'market', 'The Market');
  const p = G.player;
  const head = el('div', 'row');
  head.appendChild(el('div', 'rmain', `<div class="rtitle">Hold: ${p.cargoUsed}/${p.cls.cargo}</div><div class="rsub">Buy where it is common. Sell where it is not.</div>`));
  const qbtn = el('button', 'btn dim', `×${qtyMult}`);
  onTap(qbtn, () => { qtyMult = qtyMult === 1 ? 5 : qtyMult === 5 ? 20 : 1; refresh(); });
  head.appendChild(qbtn);
  n.appendChild(head);

  for (const gid in GOODS) {
    const good = GOODS[gid];
    const buy = G.market.buyPrice(port.id, gid);
    const sell = G.market.sellPrice(port.id, gid);
    const stock = Math.floor(G.market.stock(port.id, gid));
    const have = p.cargo[gid] || 0;
    // measured against the other quays, not against a book price: a harbour's
    // cut made almost everything look "cheap", which told a trader nothing
    const mods = G.PORTS.map(x => x.prices[gid] ?? 1);
    const here = port.prices[gid] ?? 1;
    const cheap = here <= Math.min(...mods) + 0.001 && here < 0.95;
    const dear = here >= Math.max(...mods) - 0.001 && here > 1.05;

    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${good.icon} ${good.name} ${cheap
        ? '<span class="pill g">SOLD HERE</span>' : dear ? '<span class="pill r">WANTED HERE</span>' : ''}</div>
       <div class="rsub">Buy ◆${buy} · Sell ◆${sell} · ${stock} in store${have ? ` · <b style="color:var(--parch)">${have} aboard</b>` : ''}</div>`));
    const q = el('div', 'qty');
    const nb = Math.min(qtyMult, stock, p.cargoFree, Math.floor(G.coin / buy));
    const bb = el('button', 'btn' + (nb > 0 ? ' gold' : ' dim'), `BUY`);
    bb.disabled = nb <= 0;
    onTap(bb, () => {
      const cnt = Math.min(qtyMult, stock, p.cargoFree, Math.floor(G.coin / buy));
      if (cnt <= 0) return toast(p.cargoFree <= 0 ? 'Hold is full.' : 'Not enough coin.', 'bad');
      G.coin -= buy * cnt;
      p.cargo[gid] = (p.cargo[gid] || 0) + cnt;
      G.market.takeStock(port.id, gid, cnt);
      G.onGoodsBought(gid, cnt, port);
      sfxCoin(); G.save(); refresh();
    });
    const sb = el('button', 'btn' + (have > 0 ? '' : ' dim'), `SELL`);
    sb.disabled = have <= 0;
    onTap(sb, () => {
      const cnt = Math.min(qtyMult, have);
      G.coin += sell * cnt;
      p.cargo[gid] -= cnt;
      if (p.cargo[gid] <= 0) delete p.cargo[gid];
      G.market.addStock(port.id, gid, cnt);
      G.onGoodsSold(gid, cnt, port);
      sfxCoin(); G.save(); refresh();
    });
    q.appendChild(bb); q.appendChild(sb);
    r.appendChild(q);
    n.appendChild(r);
  }
}

/* ---------------- crew ---------------- */
function crewTab(n, port) {
  placeStrip(n, port, 'crew', 'The Hiring Steps');
  const p = G.player;
  n.appendChild(el('div', 'note',
    `Your people are <em>${p.crewTotal}</em> of a possible ${p.cls.crewMax}. Sailors work the rig, gunners the battery, marines the rail.`));

  n.appendChild(el('div', 'sec-title', 'SHIP’S COMPANY'));
  for (const rid of RANK_ORDER) {
    const cnt = p.crew[rid];
    if (!cnt) continue;
    const rk = RANKS[rid];
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${cnt} × ${rk.name}</div>
       <div class="statline"><span>rig <b>${rk.sail.toFixed(1)}</b></span><span>gun <b>${rk.gun.toFixed(1)}</b></span><span>fight <b>${rk.fight.toFixed(1)}</b></span></div>`));
    n.appendChild(r);
  }
  const xp = Math.floor(G.crewXP);
  n.appendChild(el('div', 'note', `Sea time earned: <em>${xp}</em>. Crew are rated up between voyages — every fight and every league sailed counts.`));

  n.appendChild(el('div', 'sec-title', 'RECRUITING'));
  /* Hands can be signed straight onto any ship in the fleet that is in this
     harbour with you. A prize goes out with a thin prize crew, and this is
     how she is manned properly afterwards — without it, the only berths you
     could ever fill were your own, and a big ship you had captured stayed
     unusable no matter how much coin you had. */
  const berths = G.fleet.filter(s => s.alive && !s.captured);
  if (!recruitTo || !berths.includes(recruitTo)) recruitTo = G.player;
  if (berths.length > 1) {
    const pickRow = el('div', 'row');
    pickRow.appendChild(el('div', 'rmain',
      `<div class="rtitle">Sign them aboard</div><div class="rsub">Which deck these hands join.</div>`));
    const wrap = el('div', 'fwrap');
    for (const s of berths) {
      const b = el('button', 'btn' + (s === recruitTo ? ' gold' : ' dim'),
        `${s.isPlayer ? '⚑ ' : ''}${s.name.split(' ')[0]} ${s.crewTotal}/${s.cls.crewMax}`);
      onTap(b, () => { recruitTo = s; refresh(); });
      wrap.appendChild(b);
    }
    pickRow.appendChild(wrap);
    n.appendChild(pickRow);
  }
  const avail = port.size === 'major' ? ['deckhand', 'sailor', 'gunner', 'marine', 'rigger'] : ['deckhand', 'sailor'];
  for (const rid of avail) {
    const rk = RANKS[rid];
    const cost = recruitCost(rid, port.id);
    const full = recruitTo.crewTotal >= recruitTo.cls.crewMax;
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${rk.name}</div>
       <div class="rsub">${describeRank(rid)}</div>`));
    const b = el('button', 'btn gold', `◆${cost}`);
    b.disabled = full || G.coin < cost;
    onTap(b, () => {
      if (full) return toast(`No berths left aboard ${recruitTo.name}.`, 'bad');
      if (G.coin < cost) return toast('Not enough coin.', 'bad');
      G.coin -= cost; recruitTo.crew[rid]++;
      sfxCoin(); G.save(); refresh();
    });
    r.appendChild(b);
    n.appendChild(r);
  }
  if (recruitTo.crewTotal >= recruitTo.cls.crewMax) {
    n.appendChild(el('div', 'note',
      `Every berth aboard ${recruitTo.name} is taken. A bigger hull would take more hands.`));
  }
}
/** Skill as something you read rather than parse. */
function stars(n) {
  // skill runs 1..3; a hand-picked veteran shows as four or five, not always five
  const k = Math.max(1, Math.min(5, (n | 0) + 2));
  return `<span class="stars">${'★'.repeat(k)}${'☆'.repeat(5 - k)}</span>`;
}

function describeRank(id) {
  return {
    deckhand: 'Willing, green, cheap. They learn.',
    sailor: 'Knows the ropes. The backbone of any watch.',
    gunner: 'Serves a gun properly. Faster, straighter broadsides.',
    marine: 'Fights over the rail. Doubles your boarding weight.',
    rigger: 'Keeps canvas drawing even when it is torn.',
    veteran: 'Twenty years at sea and still here.',
  }[id] || '';
}

/* ---------------- shipyard ---------------- */
function yardTab(n, port) {
  placeStrip(n, port, 'yard', 'The Yard');
  n.appendChild(el('div', 'sec-title', 'YOUR FLEET'));
  for (const s of G.fleet) n.appendChild(fleetRow(s, port));

  if (G.prizes.length) {
    n.appendChild(el('div', 'sec-title', 'PRIZES IN THE ROADS'));
    for (const pr of G.prizes) {
      const cls = HULLS[pr.classId];
      const r = el('div', 'row');
      r.appendChild(el('div', 'rmain',
        `<div class="rtitle">${pr.name}</div>
         <div class="rsub">${cls.name} · hull ${Math.round(pr.hull)}/${cls.hull} · ${pr.guns} guns · a prize crew of ${G.prizeCrewFor(cls)} and a captain; ${cls.crewMin} hands to work her properly</div>`));
      const b = el('button', 'btn', 'SELL ◆' + Math.round(cls.value * 0.55 * (pr.hull / cls.hull)));
      onTap(b, () => {
        G.coin += Math.round(cls.value * 0.55 * (pr.hull / cls.hull));
        G.prizes.splice(G.prizes.indexOf(pr), 1);
        sfxCoin(); toast('Prize sold to the yard.', 'gold'); G.save(); refresh();
      });
      r.appendChild(b);
      n.appendChild(r);
      const cmd = el('button', 'btn wide gold', 'COMMISSION INTO YOUR FLEET');
      onTap(cmd, () => commissionFlow(pr, port));
      n.appendChild(cmd);
    }
  }

  n.appendChild(el('div', 'sec-title', 'YARD WORK'));
  const p = G.player;
  for (const up of G.upgradesFor(p, port)) {
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain', `<div class="rtitle">${up.name}</div><div class="rsub">${up.desc}</div>`));
    if (up.owned) r.appendChild(el('span', 'pill g', 'FITTED'));
    else {
      const b = el('button', 'btn gold', `◆${up.cost}`);
      b.disabled = G.coin < up.cost;
      onTap(b, () => { G.buyUpgrade(p, up); refresh(); });
      r.appendChild(b);
    }
    n.appendChild(r);
  }
}

function fleetRow(s, port) {
  const r = el('div', 'row');
  const capt = s.captain ? s.captain.name : (s.isPlayer ? 'You' : '— no captain —');
  r.appendChild(el('div', 'rmain',
    `<div class="rtitle">${s.name} ${s.isPlayer ? '<span class="pill">FLAGSHIP</span>' : ''}</div>
     <div class="rsub">${s.cls.name} · ${capt}</div>
     <div class="statline">
       <span>hull <b>${Math.round(s.hull)}/${s.hullMax}</b></span>
       <span>guns <b>${s.gunsPort + s.gunsStb}</b></span>
       <span>crew <b>${s.crewTotal}/${s.cls.crewMax}</b>${
  s.crewTotal < s.cls.crewMin ? ` <em class="warn">needs ${s.cls.crewMin}</em>` : ''}</span>
       <span>speed <b>${s.cls.speed.toFixed(1)}</b></span>
     </div>`));
  if (!s.isPlayer) {
    const b = el('button', 'btn dim', 'CREW');
    onTap(b, () => transferFlow(s));
    r.appendChild(b);
    /* Take her yourself. A captain who has just taken a ship worth ten of her
       own should not have to keep sailing the cutter — that was most of the
       point of taking it. Only in harbour, and only if she can be worked:
       the hull carries the hands, but the captain carries the skill. */
    /* Not disabled when she is short-handed. A greyed button gives no reason,
       and on a phone there is no tooltip to give one either — so it stays live
       and says what she wants, which is a thing the player can then go and do
       on the crew page two taps away. */
    const cmd = el('button', 'btn gold', 'COMMAND');
    const short = s.crewTotal < s.cls.crewMin;
    if (short) cmd.classList.add('dim');
    onTap(cmd, () => {
      if (short) {
        return toast(`${s.name} wants ${s.cls.crewMin} hands to answer the helm — `
          + `she has ${s.crewTotal}. Sign more on at the crew page.`, 'bad', 4200);
      }
      modal({
        title: `Shift your flag?`,
        text: `You will command <b>${s.name}</b>, and <b>${G.player.name}</b> falls in`
          + ` as a consort. Your own skill goes with you.`,
        actions: [
          { label: 'SHIFT MY FLAG', cls: 'gold', fn: () => { G.takeCommand(s); refresh(); } },
          { label: 'STAY WHERE I AM', cls: 'dim', fn: () => { } },
        ],
      });
    });
    r.appendChild(cmd);
  }
  void port;
  return r;
}

function transferFlow(s) {
  const p = G.player;
  modal({
    title: `${s.name}`,
    text: `Move hands between the flagship and your consort. <b>${s.name}</b> carries <em>${s.crewTotal}</em>; she needs at least <em>${s.cls.crewMin}</em> to work.<br><br>Flagship: <em>${p.crewTotal}</em> aboard.`,
    dismissable: true,
    actions: [
      { label: 'SEND 5 HANDS ACROSS', cls: 'gold', fn: () => { G.transferCrew(p, s, 5); refresh(); } },
      { label: 'BRING 5 HANDS BACK', fn: () => { G.transferCrew(s, p, 5); refresh(); } },
      { label: 'CLOSE', cls: 'dim', fn: () => { } },
    ],
  });
}

function commissionFlow(prize, port) {
  const cands = G.officers.filter(o => !o.ship && o.canCaptain);
  if (!cands.length) {
    modal({
      title: 'No-one to Give Her To',
      text: 'A prize is only a hull until somebody stands on her quarterdeck. Find an officer of some standing in the tavern — a first mate or better — and give them their own command.',
      actions: [{ label: 'UNDERSTOOD', cls: 'gold', fn: () => { } }],
    });
    return;
  }
  const box = document.createElement('div');
  modal({
    title: 'Give Her a Captain',
    text: `<b>${prize.name}</b> — ${HULLS[prize.classId].name}. Choose who takes her out.` +
      cands.map(o => `<div style="margin-top:10px;padding:9px 11px;background:rgba(255,255,255,.05);border-radius:11px">
        <b>${o.name}</b> · ${officerLabel(o)} <span class="pill">skill ${o.skill}</span><br>
        <span style="font-size:12px;color:var(--parch-dim)">${o.trait.name} — ${o.trait.tip}</span></div>`).join(''),
    actions: cands.map(o => ({
      label: `${o.name.toUpperCase()} TAKES COMMAND`, cls: 'gold',
      fn: () => { G.commissionPrize(prize, o, port); refresh(); },
    })).concat([{ label: 'NOT YET', cls: 'dim', fn: () => { } }]),
  });
  void box;
}

/* ---------------- tavern ---------------- */
function tavernTab(n, port) {
  placeStrip(n, port, 'tavern', 'The Tavern');
  n.appendChild(el('div', 'note', 'Smoke, salt-fish stew, and every rumour in the Shoals — most of them wrong.'));

  /* Who is in tonight. The tavern's own notables stand here, so the room has
     faces in it before the hiring board does. */
  const inRoom = notablesAt(port.id).filter(w => w.at === 'tavern');
  if (inRoom.length) {
    n.appendChild(el('div', 'sec-title', 'IN TONIGHT'));
    for (const w of inRoom) n.appendChild(notableRow(w, port));
  }

  n.appendChild(el('div', 'sec-title', 'OFFICERS SEEKING A BERTH'));
  const pool = G.tavernPool(port);
  if (!pool.length) n.appendChild(el('div', 'note', 'Nobody worth hiring tonight.'));
  for (const o of pool) {
    const r = el('div', 'row');
    const pt = el('div', 'portrait');
    const cv = document.createElement('canvas');
    pt.appendChild(cv);
    drawPortrait(cv, o, 46);
    r.appendChild(pt);
    /* An authored officer is introduced as a person: what he is called, what
       he is like, what he has done and what he is still after. The numbers are
       underneath, where they belong — you recruit Mercer, not Navigator +8%. */
    r.appendChild(el('div', 'rmain', o.namedId
      ? `<div class="rtitle">${o.name}${o.epithet ? ` <span class="epithet">“${o.epithet}”</span>` : ''}</div>
         <div class="rsub">${officerLabel(o)} · ${stars(o.skill)} ${o.canCaptain ? '<span class="pill g">CAN COMMAND</span>' : ''}</div>
         <div class="rsub trait-line">${o.namedTraits.map(t => `<span class="tr">${t}</span>`).join('')}</div>
         <div class="npc-mem">${o.bio}</div>
         <div class="statline"><span>wants <b>${o.ambition}</b></span><span>wage <b>◆${o.wage}</b>/wk</span></div>`
      : `<div class="rtitle">${o.name}</div>
         <div class="rsub">${officerLabel(o)} · <span class="pill">skill ${o.skill}</span> ${o.canCaptain ? '<span class="pill g">CAN COMMAND</span>' : ''}</div>
         <div class="rsub">${officerEffect(o)} — <em style="color:var(--parch)">${o.trait.name}</em>, ${o.trait.tip}</div>`));
    const b = el('button', 'btn gold', `◆${o.hire}`);
    b.disabled = G.coin < o.hire;
    onTap(b, () => { G.hireOfficer(o, port); refresh(); });
    r.appendChild(b);
    n.appendChild(r);
  }

  if (G.officers.length) {
    n.appendChild(el('div', 'sec-title', 'YOUR OFFICERS'));
    for (const o of G.officers) {
      const r = el('div', 'row');
      const pt = el('div', 'portrait'); const cv = document.createElement('canvas');
      pt.appendChild(cv); drawPortrait(cv, o, 46); r.appendChild(pt);
      const where = o.ship ? `commands ${o.ship.name}` : `aboard ${G.player.name}`;
      r.appendChild(el('div', 'rmain',
        `<div class="rtitle">${o.name}</div>
         <div class="rsub">${officerLabel(o)} · ${where}</div>
         <div class="statline"><span>skill <b>${o.skill}</b></span><span>level <b>${o.level}</b></span><span>xp <b>${o.xp}</b></span></div>`));
      n.appendChild(r);
    }
  }

  n.appendChild(el('div', 'sec-title', 'RUMOURS'));
  for (const rum of G.rumoursAt(port)) {
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain', `<div class="rtitle">${rum.title}</div><div class="rsub">${rum.text}</div>`));
    if (rum.quest) {
      const b = el('button', 'btn gold', 'TAKE IT');
      onTap(b, () => { G.acceptQuest(rum.quest, port); refresh(); });
      r.appendChild(b);
    }
    n.appendChild(r);
  }
}

/* =========================================================
   LOG / MENU
   ========================================================= */
/* ---------------- who you know ----------------
   Once the Shoals contain named people, the player needs somewhere to ask
   "who was that, and what did I do to them". Only people actually met are
   listed — a roster of strangers is a spoiler, not a journal. */
function peopleTab(n) {
  const S = G.social;
  const met = NOTABLES.filter(w => S.hasMet(w.id));
  if (!met.length) {
    n.appendChild(el('div', 'note',
      'You have not stopped to speak to anyone yet. Dock somewhere and go into the town.'));
    return;
  }
  // best-regarded first: the people who would actually take your call
  met.sort((a, b) => S.of(b.id) - S.of(a.id));
  for (const w of met) {
    const t = tierOf(S.of(w.id));
    const mem = S.memories(w.id);
    const ties = tiesFor(w.id);
    const r = el('div', 'row notable');
    const pc = document.createElement('canvas');
    pc.className = 'npc-face';
    drawPortrait(pc, { seed: w.seed }, 44);
    r.appendChild(pc);
    const knownAmb = S.knows(w.id, 'ambition');
    const knownTies = S.knows(w.id, 'ties');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${w.name}</div>
       <div class="rsub">${w.title} · ${(G.PORTS.find(p => p.id === w.port) || {}).name || w.port}
         · <span class="rel ${t.id}">${t.name}</span></div>
       <div class="trait-line">${w.traits.map(x => `<span class="tr">${x}</span>`).join('')}</div>
       ${knownTies && ties.length ? `<div class="npc-mem">${ties.map(x => x.line).join(' ')}</div>` : ''}
       ${knownAmb && w.hidden ? `<div class="npc-mem">Wants: ${w.hidden.ambition}</div>` : ''}
       ${mem.length ? mem.map(m => `<div class="statline"><span>${m.text}</span></div>`).join('') : ''}
       ${!knownAmb ? '<div class="statline"><span class="dimtxt">You do not know what they are after.</span></div>' : ''}`));
    n.appendChild(r);
  }
}

export function openMenu() {
  const tabs = [
    { id: 'log', label: 'VOYAGE', icon: '✦', render: logTab },
    { id: 'people', label: 'PEOPLE', icon: '☺', render: peopleTab },
    { id: 'help', label: 'HELM', icon: '⎈', render: helpTab },
    { id: 'set', label: 'SETTINGS', icon: '⚙', render: settingsTab },
  ];
  openSheet('Ship’s Log', 'THE VANTU SHOALS', tabs, 'log');
}

/**
 * Where you stand with each power, and what it buys you.
 *
 * The heading said STANDING and then showed the player their own coin. With
 * six powers in the water — two of whom price their water off this number —
 * that was a page about nothing. Each row says the word, the number, and
 * whether your colours will be taken, and the threshold it tests is the one
 * the encounter rules test, imported rather than retyped, so the page cannot
 * promise something the sea will not honour.
 */
function standingWord(v) {
  if (v >= 45) return { word: 'Trusted', cls: 'g' };
  if (v >= COLOURS_STANDING) return { word: 'Known', cls: 'g' };
  if (v >= 5) return { word: 'Civil', cls: '' };
  if (v > -5) return { word: 'A stranger', cls: '' };
  if (v > -25) return { word: 'Watched', cls: 'b' };
  return { word: 'Unwelcome', cls: 'r' };
}

function factionStanding(n) {
  const ids = Object.keys(G.standing).filter(id => FACTIONS[id]);
  if (!ids.length) return;
  n.appendChild(el('div', 'sec-title', 'THE POWERS'));
  const known = G.infamy < COLOURS_INFAMY;
  for (const id of ids) {
    const fac = FACTIONS[id];
    const v = Math.round(G.standing[id] || 0);
    const s = standingWord(v);
    const takes = known && v >= COLOURS_STANDING;
    const row = el('div', 'row');
    row.appendChild(el('div', 'rmain',
      `<div class="rtitle">${fac.name}</div>
       <div class="rsub">${s.word}${takes ? ' · they will take your colours' : ''}</div>`));
    row.appendChild(el('span', 'pill' + (s.cls ? ' ' + s.cls : ''), `${v >= 0 ? '+' : ''}${v}`));
    n.appendChild(row);
  }
  if (!known) {
    n.appendChild(el('div', 'note',
      `A name like yours travels. At <em>infamy ${Math.round(G.infamy)}</em> nobody is
       taking your word for anything, whatever the books say.`));
  }
}

function logTab(n) {
  const p = G.player;
  storySection(n);

  n.appendChild(el('div', 'sec-title', 'STANDING'));
  const r = el('div', 'row');
  r.appendChild(el('div', 'rmain',
    `<div class="rtitle">${p.name}</div>
     <div class="rsub">${p.cls.name} under your own colours</div>
     <div class="statline">
      <span>coin <b>◆${fmtCoin(G.coin)}</b></span><span>prestige <b>${Math.round(G.prestige)}</b></span>
      <span>infamy <b>${Math.round(G.infamy)}</b></span><span>fleet <b>${G.fleet.length}</b></span>
     </div>`));
  n.appendChild(r);
  factionStanding(n);

  n.appendChild(el('div', 'sec-title', 'TALLY'));
  const st = G.stats;
  const grid = el('div', 'grid2');
  const stat = (k, v) => { const d = el('div', 'row'); d.appendChild(el('div', 'rmain', `<div class="rsub">${k}</div><div class="rtitle">${v}</div>`)); return d; };
  grid.appendChild(stat('Ships sunk', st.sunk));
  grid.appendChild(stat('Ships taken', st.captured));
  grid.appendChild(stat('Broadsides fired', st.broadsides));
  grid.appendChild(stat('Leagues sailed', Math.round(st.distance / 100)));
  grid.appendChild(stat('Crew lost', st.crewLost));
  grid.appendChild(stat('Places found', G.discovered.size));
  n.appendChild(grid);

  if (G.quests.some(q => q.active || q.done)) {
    n.appendChild(el('div', 'sec-title', 'UNDERTAKINGS'));
    for (const q of G.quests) {
      if (!q.active && !q.done) continue;
      const qr = el('div', 'row');
      qr.appendChild(el('div', 'rmain',
        `<div class="rtitle">${q.title} ${q.done ? '<span class="pill g">DONE</span>' : ''}</div>
         <div class="rsub">${G.questStatus(q)}</div>`));
      n.appendChild(qr);
    }
  }

  if (G.discovered.size) {
    n.appendChild(el('div', 'sec-title', 'CHARTED'));
    for (const id of G.discovered) {
      const poi = G.poiById(id);
      if (!poi) continue;
      const d = el('div', 'row');
      d.appendChild(el('div', 'rmain', `<div class="rtitle">${poi.name}</div><div class="rsub">${poi.title}</div>`));
      n.appendChild(d);
    }
  }
}

/** Who you are, what you are sailing for, and how far along you are. */
function storySection(n) {
  if (!G.origin) return;
  const fx = G.originFx;
  const ch = G.currentChapter;
  const amb = AMBITIONS[G.origin.ambition];

  n.appendChild(el('div', 'sec-title', 'YOUR STORY'));
  const head = el('div', 'row');
  head.appendChild(el('div', 'rmain',
    `<div class="rtitle">${G.captainName}</div>
     <div class="rsub">Sailing ${amb ? amb.line : 'for reasons of your own'}.</div>`));
  n.appendChild(head);

  const done = G.storyOver ? CHAPTERS.length : G.chapter;
  const step = el('div', 'row');
  step.appendChild(el('div', 'rmain',
    `<div class="rtitle">${G.storyOver ? 'The account is closed' : G.chapterText(ch, 'title')}
       <span class="pill">${Math.min(done + (G.storyOver ? 0 : 1), CHAPTERS.length)} / ${CHAPTERS.length}</span></div>
     <div class="rsub">${G.storyOver ? 'Every chapter behind you. The Shoals are still open.' : G.chapterText(ch, 'obj')}</div>`));
  n.appendChild(step);

  if (fx.traits && fx.traits.length) {
    const t = el('div', 'row');
    t.appendChild(el('div', 'rmain',
      `<div class="rsub">TRAITS</div>
       <div class="rtitle">${fx.traits.map(x => x.name).join(' · ')}</div>`));
    n.appendChild(t);
  }
  const bits = [];
  for (const k of ['sail', 'gun', 'fight', 'trade']) {
    if (fx.capt[k]) bits.push(`${SKILL_LABEL[k]} +${Math.round(fx.capt[k] * 100)}%`);
  }
  if (bits.length) {
    const s = el('div', 'row');
    s.appendChild(el('div', 'rmain', `<div class="rsub">THE CAPTAIN’S OWN</div><div class="rtitle">${bits.join(' · ')}</div>`));
    n.appendChild(s);
  }
}
const SKILL_LABEL = { sail: 'Seamanship', gun: 'Gunnery', fight: 'Boarding', trade: 'Haggling' };

function helpTab(n) {
  // keys first for anyone at a desk, and rendered from the bindings themselves
  if (matchMedia('(pointer: fine)').matches) {
    n.appendChild(el('div', 'sec-title', 'AT A DESK'));
    n.appendChild(el('div', 'note',
      '<em>Left-click</em> the water to set a course, a ship to mark her. '
      + '<em>Right-drag</em> or <em>left-drag</em> swings the view; the <em>wheel</em> zooms.'));
    let group = null;
    const grid = el('div', 'keygrid');
    for (const k of KEYMAP) {
      if (k.group !== group) {
        group = k.group;
        grid.appendChild(el('div', 'keygroup', group));
      }
      const row = el('div', 'keyrow');
      const keys = el('div', 'keycaps');
      for (const cap of k.keys) keys.appendChild(el('kbd', '', cap));
      if (k.also) keys.appendChild(el('span', 'keyalso', k.also));
      row.appendChild(keys);
      row.appendChild(el('span', 'keywhat', k.what));
      grid.appendChild(row);
    }
    n.appendChild(grid);
  }

  n.appendChild(el('div', 'sec-title', 'SAILING'));
  n.appendChild(el('div', 'note',
    `<em>Tap the water</em> to set a course. Your ship carries her way — she will not stop dead, and she will not turn on the spot.<br><br>
     <em>Drag</em> to swing the view. <em>Pinch</em> or scroll to zoom.<br><br>
     The rose at the top right shows which way the wind blows and what fraction of your speed you are making. Running before the wind is fast; beating into it is slow. Use that when you run, and when you are run down.`));
  n.appendChild(el('div', 'sec-title', 'FIGHTING'));
  n.appendChild(el('div', 'note',
    `<em>Tap a ship</em> to mark her. Guns only bear on the beam, so turn to bring a broadside round; the FIRE button lights when a battery bears.<br><br>
     <em>Round shot</em> smashes hulls. <em>Chain shot</em> cuts rigging and stops a runner. <em>Grapeshot</em> sweeps the deck before you board.<br><br>
     Come alongside a beaten ship and slow down — the BOARD button appears when grapples can be thrown. Win, and she is yours.`));
  n.appendChild(el('div', 'sec-title', 'SHOAL WATER'));
  n.appendChild(el('div', 'note',
    `Pale turquoise water is shallow. A cutter draws little and can cut over reefs that would open a frigate's bottom. Use them.`));
}

function settingsTab(n) {
  const r = el('div', 'row');
  r.appendChild(el('div', 'rmain', `<div class="rtitle">Sound</div><div class="rsub">Waves, guns and the score.</div>`));
  const b = el('button', 'btn', audio.muted ? 'OFF' : 'ON');
  onTap(b, () => { const m = toggleMute(); b.textContent = m ? 'OFF' : 'ON'; });
  r.appendChild(b);
  n.appendChild(r);

  /* Four faders, because one volume control cannot settle an argument between
     the sea and the score — and that argument was real: ambience shipped at
     nearly twice the music. Live: you hear the change as you drag, which is
     the only way to set a level honestly. */
  const mix = getMix();
  const FADERS = [
    ['music', 'Music', 'The score.'],
    ['amb', 'Sea &amp; weather', 'Swell, wind, gulls, the harbour.'],
    ['sfx', 'Guns &amp; ship', 'Broadsides, timber, steel.'],
    ['master', 'Overall', 'Everything at once.'],
  ];
  for (const [key, label, sub] of FADERS) {
    const row = el('div', 'row fader');
    row.appendChild(el('div', 'rmain', `<div class="rtitle">${label}</div><div class="rsub">${sub}</div>`));
    const val = el('span', 'fval', `${Math.round(mix[key] * 100)}`);
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '0'; sl.max = '100'; sl.step = '1';
    sl.value = String(Math.round(mix[key] * 100));
    sl.className = 'slider';
    sl.setAttribute('aria-label', label.replace('&amp;', 'and'));
    const move = () => { val.textContent = sl.value; setMixLevel(key, +sl.value / 100); };
    sl.addEventListener('input', move);
    sl.addEventListener('change', move);
    const wrap = el('div', 'fwrap');
    wrap.appendChild(sl); wrap.appendChild(val);
    row.appendChild(wrap);
    n.appendChild(row);
  }
  const reset = el('button', 'btn wide dim', 'RESET THE MIX');
  onTap(reset, () => {
    const d = mixDefaults();
    for (const k in d) setMixLevel(k, d[k]);
    refresh();
  });
  n.appendChild(reset);

  const r2 = el('div', 'row');
  r2.appendChild(el('div', 'rmain', `<div class="rtitle">Graphics</div><div class="rsub">Lower this if the sea stutters.</div>`));
  const b2 = el('button', 'btn', G.quality >= 1 ? 'FULL' : 'LIGHT');
  onTap(b2, () => { G.setQuality(G.quality >= 1 ? 0 : 1); b2.textContent = G.quality >= 1 ? 'FULL' : 'LIGHT'; });
  r2.appendChild(b2);
  n.appendChild(r2);

  n.appendChild(el('div', 'sec-title', 'SAVE'));
  n.appendChild(el('div', 'note', 'Your voyage is written to this device whenever you make port or take a prize.'));
  const sv = el('button', 'btn wide', 'SAVE NOW');
  onTap(sv, () => { G.save(); toast('Log written.', 'good'); });
  n.appendChild(sv);
  const nv = el('button', 'btn wide danger', 'ABANDON &amp; START A NEW VOYAGE');
  onTap(nv, () => {
    modal({
      title: 'Start Again?',
      text: 'Everything — your ship, your people, your prizes — goes to the bottom. There is no getting it back.',
      actions: [
        { label: 'YES, NEW VOYAGE', cls: 'danger', fn: () => { closeSheet(); G.restart(); } },
        { label: 'NO', cls: 'dim', fn: () => { } },
      ],
    });
  });
  n.appendChild(nv);
  n.appendChild(el('div', 'note', `<span style="opacity:.5">Salt &amp; Tally — a vertical slice. ${G.buildTag}</span>`));
}

export { refresh as refreshSheet };
export function clampQty(v) { return clamp(v, 1, 50); }
