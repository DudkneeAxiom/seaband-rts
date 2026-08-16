/* Thin DOM helpers + the modal / toast / hint plumbing. */
import { sfxClick } from '../core/audio.js';

export const $ = id => document.getElementById(id);
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Buttons everywhere get the same click sound + press feel. */
export function onTap(node, fn, freq = 620) {
  node.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (node.disabled) return;
    sfxClick(freq);
    fn(e);
  });
  return node;
}

/* ---------------- toasts ---------------- */
/**
 * Say something once.
 *
 * A thumb on a button that is refusing produces one refusal per tap, and
 * they used to stack four deep up the middle of the screen — which reads as
 * the game breaking rather than the game saying no. The same words twice in
 * a row are the same message arriving again: it keeps its place, restarts
 * its clock, and counts up instead of breeding.
 */
const MAX_TOASTS = 3;
export function toast(msg, kind = '', ms = 2600) {
  const box = $('toasts');
  const last = box.lastElementChild;
  if (last && last._msg === msg && !last.classList.contains('out')) {
    last._n = (last._n || 1) + 1;
    last.innerHTML = `${msg} <span class="t-again">×${last._n}</span>`;
    clearTimeout(last._timer);
    last._timer = setTimeout(() => {
      last.classList.add('out');
      setTimeout(() => last.remove(), 400);
    }, ms);
    return;
  }
  const t = el('div', 'toast ' + kind, msg);
  t._msg = msg;
  box.appendChild(t);
  while (box.children.length > MAX_TOASTS) box.removeChild(box.firstChild);
  t._timer = setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

/* ---------------- hint chip ---------------- */
let hintTimer = null;
export function hint(msg, ms = 5200) {
  const h = $('hint');
  h.classList.remove('out', 'hidden');
  h.innerHTML = msg;
  // the objective chip and a hint are both guidance — never show both
  $('objective').classList.add('muted');
  clearTimeout(hintTimer);
  if (ms > 0) hintTimer = setTimeout(hideHint, ms);
}
export function hideHint() {
  const h = $('hint');
  $('objective').classList.remove('muted');
  if (h.classList.contains('hidden')) return;
  h.classList.add('out');
  setTimeout(() => h.classList.add('hidden'), 400);
}
/** Drop the notice stack below the target card while one is on screen. */
/**
 * Keep the notice stack clear of the right-hand column.
 *
 * `.low` used to drop it to a fixed 276px, which was a guess at the height of
 * a target card — and then the column grew a pursuit panel above the card and
 * the guess was seventy pixels short, so a hint and the card sat on top of
 * each other on a phone held upright. Measured instead: whatever the column
 * happens to be right now, the notices start below it.
 */
export function setNoticesLow(low) {
  const n = $('notices');
  n.classList.toggle('low', !!low);
  const rs = $('rightstack');
  const bottom = rs ? rs.getBoundingClientRect().bottom : 0;
  n.style.setProperty('--clear', `${Math.round(bottom + 10)}px`);
}

/* ---------------- modal ---------------- */
/* Asked of the DOM, not of a flag beside it: anything that hides the card —
   including code that never heard of closeModal — leaves the game unblocked. */
export const isModalOpen = () => !$('modal').classList.contains('hidden');

export function modal({ title, text, actions = [], dismissable = false }) {
  const m = $('modal');
  $('modal-title').innerHTML = title || '';
  $('modal-text').innerHTML = text || '';
  const box = $('modal-actions');
  clear(box);
  for (const a of actions) {
    /* An action can carry a second line saying what it means. The dialogue
       manners need it — "Speak plainly" and "Pay your respects" are choices
       about tone, and a player deserves to know which is which before they
       find out from somebody's face. */
    const b = el('button', 'btn ' + (a.cls || ''), a.sub ? '' : a.label);
    if (a.sub) {
      b.classList.add('has-sub');
      b.appendChild(el('span', 'blbl', a.label));
      b.appendChild(el('span', 'sub', a.sub));
    }
    onTap(b, () => { closeModal(); a.fn && a.fn(); }, a.freq || 620);
    box.appendChild(b);
  }
  m.classList.remove('hidden');
  if (dismissable) {
    m.onclick = e => { if (e.target === m) closeModal(); };
  } else m.onclick = null;
}
export function closeModal() {
  $('modal').classList.add('hidden');
}

/* ---------------- objective chip ---------------- */
let objLast = null;
export function setObjective(text, kicker = '') {
  const o = $('objective');
  /* Called every frame from the story tick, and it used to rewrite the chip's
     innerHTML and clear `hidden` each time. Two costs: sixty DOM rewrites a
     second for a string that changes perhaps ten times a campaign, and a
     running fight with the HUD — which hides this chip during a battle on its
     own slow tick, only for the next frame to put it straight back. The card
     was therefore visible through most of every action it was meant to be
     absent from. Nothing changed, nothing to say: whoever owns the element's
     visibility keeps it. */
  /* …and that fix only held while the text stood still. Any change to it ran
     `remove('hidden')` again, so a chip the HUD had put away for a battle came
     straight back the moment the story tick had something new to say — a
     distance crossing a threshold, a rumour ageing another minute. Same fight
     as before, just rarer and so harder to see: it surfaced as a campaign
     check failing only when four suites ran at once and the HUD's slow tick
     was far enough apart to lose the race.

     So this no longer holds a view on whether the chip is visible. The HUD
     owns that, on one line, from the two facts that decide it — is there
     anything to say, and are the guns out. */
  const key = `${kicker}\u0000${text}`;
  if (key === objLast) return;
  objLast = key;
  if (!text) { $('obj-text').innerHTML = ''; o.classList.add('hidden'); return; }
  /* Kicker and objective are separate elements so the objective can be
     line-clamped on a narrow screen without the chapter heading eating the
     allowance. Wrapped together they left "Make Ilo Vantu and…" — the kicker
     took two of the three lines and the thing being asked for took the rest. */
  $('obj-text').innerHTML = kicker
    ? `<span class="obj-kicker">${kicker}</span><span class="obj-body">${text}</span>`
    : `<span class="obj-body">${text}</span>`;
}
