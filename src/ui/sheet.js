/* Bottom-sheet screens: harbour, market, crew, shipyard, tavern,
   plus the log/menu. Everything is a tall scrolling list of big rows —
   the shape thumbs are happiest with. */
import { $, el, clear, onTap, toast, modal } from './dom.js';
import { GOODS, RANKS, RANK_ORDER, OFFICER_ROLES, HULLS, FACTIONS } from '../data/gamedata.js';
import { repairCost, recruitCost, PROVISION_PRICE, SHOT_PRICE } from '../sim/economy.js';
import { drawPortrait, officerLabel, officerEffect } from '../sim/officers.js';
import { AMBITIONS, CHAPTERS } from '../data/origins.js';
import { KEYMAP } from '../core/keys.js';
import { COLOURS_STANDING, COLOURS_INFAMY } from '../sim/encounter.js';
import { fmtCoin, clamp } from '../core/util.js';
import { sfxCoin, toggleMute, audio } from '../core/audio.js';

let G = null;
let current = null;     // {tabs, tab, port}
let qtyMult = 1;

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
function renderTab() {
  const c = $('sheet-content');
  clear(c);
  c.scrollTop = 0;
  const t = current.tabs.find(x => x.id === current.tab);
  t && t.render(c);
}
function refresh() { renderTab(); }

/* =========================================================
   PORT
   ========================================================= */
export function openPort(port) {
  current = { port };
  const svc = port.services;
  const tabs = [];
  tabs.push({ id: 'harbour', label: 'HARBOUR', icon: '⚓', render: n => harbourTab(n, port) });
  if (svc.includes('market')) tabs.push({ id: 'market', label: 'MARKET', icon: '▣', render: n => marketTab(n, port) });
  if (svc.includes('crew')) tabs.push({ id: 'crew', label: 'CREW', icon: '☰', render: n => crewTab(n, port) });
  if (svc.includes('shipyard')) tabs.push({ id: 'yard', label: 'SHIPYARD', icon: '⚒', render: n => yardTab(n, port) });
  if (svc.includes('tavern')) tabs.push({ id: 'tavern', label: 'TAVERN', icon: '☕', render: n => tavernTab(n, port) });
  const fac = FACTIONS[port.faction];
  openSheet(port.name, `${port.tagline.toUpperCase()} · ${fac.short}`, tabs, 'harbour');
}

/* ---------------- harbour ---------------- */
function harbourTab(n, port) {
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
  n.appendChild(el('div', 'sec-title', 'HARBOURMASTER'));
  if (!contracts.length) n.appendChild(el('div', 'note', 'No work on the board today. Try the tavern.'));
  for (const q of contracts) n.appendChild(questRow(q, port));

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
  const avail = port.size === 'major' ? ['deckhand', 'sailor', 'gunner', 'marine', 'rigger'] : ['deckhand', 'sailor'];
  for (const rid of avail) {
    const rk = RANKS[rid];
    const cost = recruitCost(rid, port.id);
    const full = p.crewTotal >= p.cls.crewMax;
    const r = el('div', 'row');
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${rk.name}</div>
       <div class="rsub">${describeRank(rid)}</div>`));
    const b = el('button', 'btn gold', `◆${cost}`);
    b.disabled = full || G.coin < cost;
    onTap(b, () => {
      if (full) return toast('No berths left aboard.', 'bad');
      if (G.coin < cost) return toast('Not enough coin.', 'bad');
      G.coin -= cost; p.crew[rid]++;
      sfxCoin(); G.save(); refresh();
    });
    r.appendChild(b);
    n.appendChild(r);
  }
  if (p.crewTotal >= p.cls.crewMax) n.appendChild(el('div', 'note', 'Every berth is taken. A bigger hull would take more hands.'));
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
  n.appendChild(el('div', 'sec-title', 'YOUR FLEET'));
  for (const s of G.fleet) n.appendChild(fleetRow(s, port));

  if (G.prizes.length) {
    n.appendChild(el('div', 'sec-title', 'PRIZES IN THE ROADS'));
    for (const pr of G.prizes) {
      const cls = HULLS[pr.classId];
      const r = el('div', 'row');
      r.appendChild(el('div', 'rmain',
        `<div class="rtitle">${pr.name}</div>
         <div class="rsub">${cls.name} · hull ${Math.round(pr.hull)}/${cls.hull} · ${pr.guns} guns · needs ${cls.crewMin} hands and a captain</div>`));
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
       <span>crew <b>${s.crewTotal}/${s.cls.crewMax}</b></span>
       <span>speed <b>${s.cls.speed.toFixed(1)}</b></span>
     </div>`));
  if (!s.isPlayer) {
    const b = el('button', 'btn dim', 'CREW');
    onTap(b, () => transferFlow(s));
    r.appendChild(b);
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
  n.appendChild(el('div', 'note', 'Smoke, salt-fish stew, and every rumour in the Shoals — most of them wrong.'));

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
    r.appendChild(el('div', 'rmain',
      `<div class="rtitle">${o.name}</div>
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
export function openMenu() {
  const tabs = [
    { id: 'log', label: 'VOYAGE', icon: '✦', render: logTab },
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
  r.appendChild(el('div', 'rmain', `<div class="rtitle">Sound</div><div class="rsub">Waves, guns and a little music.</div>`));
  const b = el('button', 'btn', audio.muted ? 'OFF' : 'ON');
  onTap(b, () => { const m = toggleMute(); b.textContent = m ? 'OFF' : 'ON'; });
  r.appendChild(b);
  n.appendChild(r);

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
