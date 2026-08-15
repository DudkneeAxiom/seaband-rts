/* ===========================================================
   The encounter screen — the moment the campaign stops and asks.

   Everything shown here is a fact the player could otherwise only guess at:
   who she is, what she is carrying, who holds the wind, and what the odds of
   running actually are. The flee chance in particular is stated as a number
   and broken into its terms, because the player is about to gamble on it and
   a hidden roll is not a decision.
   =========================================================== */
import { $, el, clear, onTap, toast } from './dom.js';
import { fleeChance, bribeCost, talkChance } from '../sim/encounter.js';
import { sfxClick, sfxHorn } from '../core/audio.js';

let G = null;
let current = null;

export function initEncounter(game) { G = game; }
export function isEncounterOpen() { return !$('encounter').classList.contains('hidden'); }

/** One side of the balance: her ships, her people, her guns. */
function sideBox(title, ships, them) {
  const box = el('div', 'enc-side' + (them ? ' them' : ''));
  box.appendChild(el('h4', '', title));
  for (const s of ships.slice(0, 4)) {
    box.appendChild(el('div', 'enc-ship', `${s.name}<br><small>${s.cls.name}</small>`));
  }
  if (ships.length > 4) box.appendChild(el('div', 'enc-ship', `<small>and ${ships.length - 4} more</small>`));
  const crew = ships.reduce((n, s) => n + s.crewTotal, 0);
  const guns = ships.reduce((n, s) => n + s.gunsPort + s.gunsStb, 0);
  box.appendChild(el('div', 'enc-tot', `<b>${crew}</b> hands · <b>${guns}</b> guns`));
  return box;
}

export function openEncounter(enc) {
  current = enc;
  const scr = $('encounter');
  scr.classList.remove('hidden');
  $('enc-outcome').classList.add('hidden');

  const lead = enc.lead;
  $('enc-kicker').textContent = enc.how === 'intercepted' ? 'RUN DOWN' : 'CONTACT';
  $('enc-title').textContent = enc.how === 'intercepted'
    ? `${lead.name} has run you down`
    : `${lead.name} is alongside`;
  $('enc-sub').textContent = `${enc.factionName} · ${enc.enemies.length > 1
    ? `${enc.enemies.length} sail` : lead.cls.name}`;

  const sides = $('enc-sides');
  clear(sides);
  sides.appendChild(sideBox('Your fleet', enc.allies, false));
  sides.appendChild(sideBox('Against', enc.enemies, true));

  /* The two things a captain reads before deciding: how the weight compares,
     and who has the wind. Both in plain words, neither as a hidden stat. */
  const gauge = enc.gauge === 'them'
    ? 'They hold the <span class="gauge">weather gauge</span> — they choose the range.'
    : 'You hold the <span class="gauge">weather gauge</span> — the wind is yours to use.';
  $('enc-note').innerHTML = `<b>${enc.verdict.word}.</b> ${gauge}`;

  renderOptions(enc);
}

function renderOptions(enc) {
  const box = $('enc-options');
  clear(box);
  const flee = fleeChance(G, enc);

  for (const o of enc.options) {
    const cls = o.id === 'fight' ? ' fight'
      : (o.id === 'parley' || o.id === 'demand' || o.id === 'colours') ? ' talk' : '';
    const b = el('button', 'enc-opt' + cls, `<b>${o.label}</b><small>${o.sub}</small>`);
    b.dataset.opt = o.id;

    // the odds go on the button they belong to, not in a table somewhere
    if (o.id === 'flee') b.appendChild(odds(flee.chance, 'clear away'));
    if (o.id === 'parley' || o.id === 'demand') {
      b.appendChild(odds(talkChance(G, enc, o.id === 'demand' ? 'demand' : 'parley'), 'they listen'));
    }

    onTap(b, () => choose(o.id, enc, flee), 520);
    box.appendChild(b);
  }
}

function odds(chance, what) {
  const wrap = el('div', 'enc-odds');
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = `${Math.round(chance * 100)}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);
  wrap.appendChild(el('span', '', `${Math.round(chance * 100)}% ${what}`));
  return wrap;
}

/* ---------------------------------------------------------------
   Answering
   --------------------------------------------------------------- */

function choose(id, enc, flee) {
  sfxClick(id === 'fight' ? 320 : 560);
  const r = G.chooseEncounter(id);
  if (!r) return;

  if (r.went === 'battle') {
    // a failed run is worth showing before the guns start
    if (id === 'flee') {
      showOutcome('They cut you off', 'She has the heels of you. The action begins with her already up.', flee.terms, r);
      setTimeout(() => closeEncounter(), 1500);
    } else if (id === 'parley' || id === 'demand') {
      showOutcome('They are not impressed', 'Whatever you are, it is not enough to make her sheer off.', null, r);
      setTimeout(() => closeEncounter(), 1500);
    } else {
      closeEncounter();
    }
    return;
  }

  if (r.went === 'refused') { toast('Not enough coin.', 'bad'); return; }

  // got clear one way or another
  const lines = {
    flee: ['You are clear', 'The gap opens. By the time she has worn round you are hull down.'],
    cargo: ['They take the hold', 'Boats come across, the hatches are opened, and she lets you go.'],
    bribe: [`◆${r.cost} lighter`, 'The coin goes across. She sheers off without a shot.'],
    dues: [`◆${r.cost} to the League`, 'A clerk writes you a receipt from the rail, and the Sound is open.'],
    chart: [`◆${r.cost} for the passage`, 'They call the marks across to you, and then they are gone.'],
    colours: ['They know your colours', 'The hail is answered, the guns run in, and she passes on.'],
    parley: ['They stand off', 'Whatever they have heard about you, it was enough.'],
    demand: ['She strikes', r.coin ? `Her cargo comes across — ◆${r.coin}.` : 'Her colours come down without a shot.'],
  }[id] || ['Clear', ''];
  showOutcome(lines[0], lines[1], id === 'flee' ? flee.terms : null, r);
  setTimeout(() => closeEncounter(), 1700);
}

function showOutcome(title, body, terms, r) {
  const box = $('enc-outcome');
  clear(box);
  box.classList.remove('hidden');
  box.appendChild(el('h5', '', title));
  box.appendChild(el('div', '', body));
  if (terms) {
    const t = el('div', 'terms');
    for (const term of terms) {
      const good = term.v >= 0;
      t.appendChild(el('i', good ? 'up' : 'dn',
        `<span>${term.label}</span><span>${good ? '+' : ''}${Math.round(term.v * 100)}%</span>`));
    }
    if (r && r.chance != null) {
      t.appendChild(el('i', '', `<span>Chance of getting clear</span><span>${Math.round(r.chance * 100)}%</span>`));
    }
    box.appendChild(t);
  }
  $('enc-options').classList.add('hidden');
}

export function closeEncounter() {
  $('encounter').classList.add('hidden');
  $('enc-options').classList.remove('hidden');
  $('enc-outcome').classList.add('hidden');
  current = null;
}

/* ---------------------------------------------------------------
   After the battle
   --------------------------------------------------------------- */

const OUTCOME = {
  won: ['THE WATER IS YOURS', 'They are beaten. What is left of them is under your guns or under the sea.'],
  routed: ['THEY BREAK OFF', 'What could still sail has run for it. You hold the water.'],
  fled: ['YOU ARE CLEAR', 'The action falls astern. She has other things to think about now.'],
  lost: ['STRUCK', 'It is over.'],
};

/** The reckoning, in the same card the encounter used. */
export function showBattleResult(res, onDone) {
  const [title, body] = OUTCOME[res.outcome] || ['ACTION ENDED', ''];
  const scr = $('encounter');
  scr.classList.remove('hidden');
  $('enc-kicker').textContent = res.kind ? res.kind.name.toUpperCase() : 'ACTION';
  $('enc-title').textContent = title;
  $('enc-sub').textContent = `${Math.floor(res.seconds / 60)}m ${res.seconds % 60}s`;
  clear($('enc-sides'));
  $('enc-note').innerHTML = body;

  const box = $('enc-options');
  clear(box);
  box.classList.remove('hidden');
  const tally = el('div', 'enc-side');
  tally.appendChild(el('h4', '', 'The butcher’s bill'));
  const rows = [
    ['Enemy sail engaged', res.fought],
    ['Sunk', res.sunk],
    ['Taken', res.taken],
    ['Hands lost', res.crewLost],
    ['Hull damage', res.hullLost],
  ];
  for (const [k, v] of rows) tally.appendChild(el('div', 'enc-tot', `${k} · <b>${v}</b>`));
  if (res.takenNames && res.takenNames.length) {
    tally.appendChild(el('div', 'enc-tot', `<b>${res.takenNames.join(', ')}</b> sails with you`));
  }
  box.appendChild(tally);

  const b = el('button', 'enc-opt', '<b>MAKE SAIL</b><small>Back to the sea</small>');
  b.dataset.opt = 'done';
  onTap(b, () => { sfxHorn(); closeEncounter(); onDone && onDone(); }, 520);
  box.appendChild(b);
}

export function currentEncounter() { return current; }
