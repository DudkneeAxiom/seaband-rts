/* ===========================================================
   Take the Helm — the five questions, then a name.

   One question per screen so nothing important is ever below a
   thumb. Every option states what it does to you before you take
   it, and the statement is generated from the effect itself, so
   the promise and the mechanic cannot drift apart.
   =========================================================== */
import { $, el, clear, onTap } from './dom.js';
import {
  ORIGIN_STEPS, AMBITIONS, NEMESES, originChips, sumOrigin,
  rollOrigin, rollCaptainName, findOption,
} from '../data/origins.js';
import { RANKS } from '../data/gamedata.js';
import { sfxClick, sfxBell } from '../core/audio.js';

const SKILL_ROWS = [
  ['sail', 'Seamanship', 'speed and helm'],
  ['gun', 'Gunnery', 'reload and aim'],
  ['fight', 'Boarding', 'the rail'],
  ['trade', 'Haggling', 'what a harbour quotes you'],
];
const BASE = { coin: 240, provisions: 42, shot: 16, crew: { deckhand: 6, sailor: 5, gunner: 1, marine: 1 } };

let S = null;          // { picks, captain, step, done }
let bound = false;

export function isOriginOpen() { return !$('origin').classList.contains('hidden'); }

/** Ask the questions. `onDone({ picks, captain })` starts the voyage. */
export function openOrigin(onDone) {
  S = { picks: {}, captain: rollCaptainName(), step: 0, done: onDone };
  if (!bound) {
    bound = true;
    onTap($('og-back'), () => { if (S.step > 0) { S.step--; render(); } }, 460);
    onTap($('og-skip'), () => {
      // fills in what you have not answered; never overwrites what you have
      const rolled = rollOrigin();
      for (const k in rolled) if (!S.picks[k]) S.picks[k] = rolled[k];
      S.step = ORIGIN_STEPS.length;
      sfxClick(760);
      render();
    }, 760);
  }
  const box = $('origin');
  box.classList.remove('hidden', 'out');
  render();
}

function finish() {
  const box = $('origin');
  box.classList.add('out');
  setTimeout(() => { box.classList.add('hidden'); box.classList.remove('out'); }, 480);
  S.done && S.done({ picks: { ...S.picks }, captain: S.captain });
}

function render() {
  $('og-inner').scrollTop = 0;
  clear($('og-body'));
  renderDots();
  if (S.step < ORIGIN_STEPS.length) renderQuestion(ORIGIN_STEPS[S.step]);
  else renderSummary();
  $('og-back').classList.toggle('hidden', S.step === 0);
  $('og-skip').classList.toggle('hidden', S.step >= ORIGIN_STEPS.length);
}

function renderDots() {
  const d = $('og-dots');
  clear(d);
  for (let i = 0; i <= ORIGIN_STEPS.length; i++) {
    d.appendChild(el('i', i === S.step ? 'on' : (i < S.step ? 'past' : '')));
  }
}

function renderQuestion(s) {
  const b = $('og-body');
  b.appendChild(el('div', 'og-kicker', s.kicker));
  b.appendChild(el('h2', 'og-prompt', s.prompt));
  b.appendChild(el('p', 'og-lede', s.lede));
  const list = el('div', 'og-opts');
  for (const o of s.options) {
    const card = el('button', 'og-opt' + (S.picks[s.id] === o.id ? ' on' : ''));
    card.dataset.opt = o.id;
    card.appendChild(el('div', 'og-lbl', o.label));
    card.appendChild(el('div', 'og-txt', o.text));
    const chips = el('div', 'og-chips');
    for (const c of originChips(o.fx || {})) {
      chips.appendChild(el('span', 'og-chip' + (c.good ? '' : ' warn'), c.t));
    }
    card.appendChild(chips);
    onTap(card, () => { S.picks[s.id] = o.id; S.step++; render(); }, 700);
    list.appendChild(card);
  }
  b.appendChild(list);
}

function renderSummary() {
  const b = $('og-body');
  const fx = sumOrigin(S.picks);
  b.appendChild(el('div', 'og-kicker', 'YOUR CAPTAIN'));

  // ---- name, with a reroll that needs no keyboard ----
  const nameRow = el('div', 'og-name');
  const input = el('input', 'og-input');
  input.type = 'text';
  input.value = S.captain;
  input.maxLength = 26;
  input.setAttribute('aria-label', 'Your captain’s name');
  input.addEventListener('input', () => { S.captain = input.value.trim() || S.captain; });
  input.addEventListener('blur', () => { input.value = S.captain; });
  const dice = el('button', 'og-dice', '⟳');
  dice.setAttribute('aria-label', 'Another name');
  onTap(dice, () => { S.captain = rollCaptainName(); input.value = S.captain; }, 820);
  nameRow.appendChild(input);
  nameRow.appendChild(dice);
  b.appendChild(nameRow);

  // two columns where there is room for them; one where there is not
  const sum = el('div', 'og-sum');
  const left = el('div', 'og-col');
  const right = el('div', 'og-col');
  sum.appendChild(left); sum.appendChild(right);
  b.appendChild(sum);

  // ---- the answers as given; tap one to think again ----
  left.appendChild(el('div', 'og-sec', 'WHAT YOU SAID'));
  const hist = el('div', 'og-hist');
  for (const s of ORIGIN_STEPS) {
    const o = findOption(s.id, S.picks[s.id]);
    if (!o) continue;
    const row = el('button', 'og-hrow');
    row.appendChild(el('span', 'og-hk', s.kicker));
    row.appendChild(el('span', 'og-hv', o.label));
    onTap(row, () => { S.step = ORIGIN_STEPS.indexOf(s); render(); }, 640);
    hist.appendChild(row);
  }
  left.appendChild(hist);

  if (fx.traits.length) {
    left.appendChild(el('div', 'og-sec', 'WHAT IT LEFT YOU'));
    const tr = el('div', 'og-traits');
    for (const t of fx.traits) {
      tr.appendChild(el('div', 'og-trait', `<b>${t.name}</b><span>${t.tip}</span>`));
    }
    left.appendChild(tr);
  }

  right.appendChild(el('div', 'og-sec', 'YOU PUT TO SEA WITH'));
  right.appendChild(renderLedger(fx));

  const amb = AMBITIONS[fx.ambition];
  if (amb) {
    right.appendChild(el('p', 'og-amb', `You sail <em>${amb.line}</em>.<br><span>${amb.tip}</span>`));
  }

  /* TAKE CHARGE, because that is exactly what this button does: five questions
   answered, a captain assembled, and the next tap makes her yours. The class
   is what the suite clicks, so the words are free to say what the moment is. */
  const go = el('button', 'og-go', 'TAKE CHARGE');
  onTap(go, () => { sfxBell(); finish(); }, 520);
  right.appendChild(go);
}

/** Everything the answers add up to, in the units the game uses. */
function renderLedger(fx) {
  const g = el('div', 'og-ledger');
  const line = (k, v) => {
    const r = el('div', 'og-lrow');
    r.appendChild(el('span', 'og-lk', k));
    r.appendChild(el('span', 'og-lv', v));
    g.appendChild(r);
  };
  line('Strongbox', `◆ ${BASE.coin + fx.coin}`);
  const crew = { ...BASE.crew };
  for (const k in fx.crew) crew[k] = (crew[k] || 0) + fx.crew[k];
  let hands = 0;
  for (const k in crew) hands += crew[k];
  line(`${hands} hands`, Object.keys(crew).filter(k => crew[k])
    .map(k => `${crew[k]} ${RANKS[k].name.toLowerCase()}`).join(', '));
  for (const [k, name, what] of SKILL_ROWS) {
    if (fx.capt[k]) line(name, `+${Math.round(fx.capt[k] * 100)}% — ${what}`);
  }
  const st = Object.keys(fx.standing).filter(k => fx.standing[k]);
  if (st.length) {
    line('Standing', st.map(k => `${k} ${fx.standing[k] > 0 ? '+' : ''}${fx.standing[k]}`).join(' · '));
  }
  line('Stores', `${BASE.provisions + fx.provisions} provisions, ${BASE.shot + fx.shot} shot`);
  if (fx.nemesis) line('Owed an answer', NEMESES[fx.nemesis].name);
  return g;
}
