/* ===========================================================
   Keyboard and mouse, for the half of the browser that has them.

   Touch remains the design centre — every one of these is a
   shortcut to something a thumb can already reach — but a game
   played at a desk should not make you drag a mouse to turn a
   ship, and a keyboard is a much better tiller than a tap.
   =========================================================== */

/** The one list. The helm page renders straight from it, so the
    documentation cannot drift away from the bindings. */
export const KEYMAP = [
  { keys: ['←', '→'], also: 'A / D', what: 'Put the helm over', group: 'Sailing' },
  { keys: ['↑', '↓'], also: 'W / S', what: 'Make or take in sail', group: 'Sailing' },
  { keys: ['H'], what: 'Heave to — take the way off her', group: 'Sailing' },
  { keys: ['Q', 'E'], what: 'Swing the view', group: 'View' },
  { keys: ['Z', 'X'], also: 'wheel', what: 'Zoom out / in', group: 'View' },
  { keys: ['C'], what: 'Square the view on your heading', group: 'View' },
  { keys: ['Space'], what: 'Fire the battery that bears', group: 'Fighting' },
  { keys: ['1', '2', '3'], what: 'Round · chain · grape', group: 'Fighting' },
  { keys: ['Tab'], what: 'Mark the next sail', group: 'Fighting' },
  { keys: ['Esc'], what: 'Let her go — or close a screen', group: 'Fighting' },
  { keys: ['B'], what: 'Board', group: 'Fighting' },
  { keys: ['F'], what: 'Dock', group: 'Harbour' },
  { keys: ['M'], what: 'Ship’s log', group: 'Harbour' },
  { keys: ['P'], what: 'Pause', group: 'Time' },
  { keys: ['[', ']'], what: 'Slower · faster (1× · 2× · 4×)', group: 'Time' },
];

/** The notches on the clock. Not consecutive, so stepping walks the list. */
export const SPEEDS = [0, 1, 2, 4];
const clampIdx = i => Math.max(0, Math.min(SPEEDS.length - 1, i));

/**
 * @param {object} api  everything the bindings are allowed to touch:
 *   game, rig, hud, isBusy(), openMenu(), closeSheet(), isSheetOpen()
 */
export function bindKeys(api) {
  const held = new Set();
  const isTyping = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };

  window.addEventListener('keydown', e => {
    if (isTyping()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Escape and the menu key work even with a screen up; the rest do not
    if (k === 'Escape') {
      e.preventDefault();
      if (api.isSheetOpen()) api.closeSheet();
      else if (api.game && api.game.target) api.game.clearTarget();
      return;
    }
    if (api.isBusy()) return;
    if (!api.game || !api.game.player || !api.game.player.alive) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) held.add(k);
    if (tap(k, api, e)) e.preventDefault();
  }, { passive: false });

  window.addEventListener('keyup', e => {
    held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  });
  window.addEventListener('blur', () => held.clear());

  return { held, isTyping };
}

/** Discrete presses. Returns true if the key was ours. */
function tap(k, api, e) {
  const g = api.game, p = g.player;
  switch (k) {
    case ' ':
      if (g.fireSide && p.reload[g.fireSide] <= 0) g.playerFire();
      return true;
    case '1': p.ammo = 'round'; api.hud.refreshAmmo(); return true;
    case '2': p.ammo = 'chain'; api.hud.refreshAmmo(); return true;
    case '3': p.ammo = 'grape'; api.hud.refreshAmmo(); return true;
    case 'Tab': cycleTarget(g, e.shiftKey ? -1 : 1); return true;
    case 'b': if (g.boardable && g.target) g.playerBoard(); return true;
    case 'f': if (g.dockablePort) g.enterPort(g.dockablePort); return true;
    case 'm': api.openMenu(); return true;
    case 'h': p.dest = null; p.headingCmd = p.yaw; p.throttle = 0; return true;
    case 'c': api.rig.azimuth = Math.PI + p.yaw; return true;
    case 'p': api.hud.setSpeed(g.speed === 0 ? 1 : 0); return true;
    // the clock has four notches, not four consecutive integers: 0,1,2,4
    case '[': api.hud.setSpeed(SPEEDS[clampIdx(SPEEDS.indexOf(g.speed) - 1)]); return true;
    case ']': api.hud.setSpeed(SPEEDS[clampIdx(SPEEDS.indexOf(g.speed) + 1)]); return true;
    default: return false;
  }
}

/** Held keys, applied every frame: the tiller, the sail and the view. */
export function applyHeld(held, api, dt) {
  const g = api.game;
  if (!g || !g.player || !g.player.alive || api.isBusy()) return;
  const p = g.player;

  const left = held.has('ArrowLeft') || held.has('a');
  const right = held.has('ArrowRight') || held.has('d');
  if (left || right) {
    // taking the helm cancels the tapped course — you are steering now
    const base = p.headingCmd != null ? p.headingCmd : p.yaw;
    p.dest = null;
    p.headingCmd = base + (right ? 1 : -1) * p.turnSpeed * dt * 1.25;
    if (p.throttle < 0.2) p.throttle = 1;
  }
  if (held.has('ArrowUp') || held.has('w')) p.throttle = Math.min(1, p.throttle + dt * 1.4);
  if (held.has('ArrowDown') || held.has('s')) p.throttle = Math.max(0, p.throttle - dt * 1.4);
  if (held.has('q')) api.rig.azimuth += dt * 1.5;
  if (held.has('e')) api.rig.azimuth -= dt * 1.5;
  if (held.has('z')) api.rig.zoom(1 + dt * 1.1);
  if (held.has('x')) api.rig.zoom(1 - dt * 0.9);
}

/** Mark the next hostile sail round, nearest first. */
function cycleTarget(g, dir) {
  const p = g.player;
  const list = g.ships
    .filter(s => s.alive && !s.captured && !s.isPlayer && !g.fleet.includes(s))
    .map(s => ({ s, d: Math.hypot(s.x - p.x, s.z - p.z) }))
    .filter(o => o.d < 900)
    .sort((a, b) => a.d - b.d)
    .map(o => o.s);
  if (!list.length) return;
  const i = g.target ? list.indexOf(g.target) : -1;
  const next = list[((i + dir) % list.length + list.length) % list.length];
  if (next && next !== g.target) g.selectTarget(next);
  else if (next === g.target && list.length === 1) g.clearTarget();
}
