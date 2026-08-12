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
export function setNoticesLow(low) {
  $('notices').classList.toggle('low', !!low);
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
    const b = el('button', 'btn ' + (a.cls || ''), a.label);
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
export function setObjective(text, kicker = '') {
  const o = $('objective');
  if (!text) { o.classList.add('hidden'); return; }
  o.classList.remove('hidden');
  /* Kicker and objective are separate elements so the objective can be
     line-clamped on a narrow screen without the chapter heading eating the
     allowance. Wrapped together they left "Make Ilo Vantu and…" — the kicker
     took two of the three lines and the thing being asked for took the rest. */
  $('obj-text').innerHTML = kicker
    ? `<span class="obj-kicker">${kicker}</span><span class="obj-body">${text}</span>`
    : `<span class="obj-body">${text}</span>`;
}
