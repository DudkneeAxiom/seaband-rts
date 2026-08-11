/* The heads-up display. Contextual: buttons exist only while they mean
   something, so the ocean keeps the screen. */
import { $, el, clear, onTap, toast, setNoticesLow } from './dom.js';
import { AMMO, FACTIONS } from '../data/gamedata.js';
import { clamp, clamp01, fmtCoin, normAng, TAU } from '../core/util.js';
import { worldToScreen } from '../core/input.js';

const VERDICT_CLASS = ['easy', 'fair', 'even', 'hard', 'grim'];

const SHORT = { round: 'ROUND', chain: 'CHAIN', grape: 'GRAPE' };
const COMPASS_PTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class HUD {
  constructor(game) {
    this.g = game;
    this.actionKeys = '';
    this.buttons = {};
    this.slowT = 0;
    this.fleetKey = '';
    this.lastTargetId = null;
    this.bindSpeed();
    onTap($('tc-close'), () => this.g.clearTarget(), 380);
  }

  /** Pause / 1× / 2×. Sailing a long leg should not mean waiting a long time. */
  bindSpeed() {
    const g = this.g;
    for (const b of document.querySelectorAll('.spd')) {
      onTap(b, () => {
        g.speed = +b.dataset.s;
        for (const o of document.querySelectorAll('.spd')) o.classList.toggle('on', o === b);
        $('paused-badge').classList.toggle('hidden', g.speed !== 0);
      }, b.dataset.s === '0' ? 320 : 700);
    }
  }
  setSpeed(n) {
    this.g.speed = n;
    for (const o of document.querySelectorAll('.spd')) o.classList.toggle('on', +o.dataset.s === n);
    $('paused-badge').classList.toggle('hidden', n !== 0);
  }

  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  update(dt) {
    const g = this.g;
    const p = g.player;
    this.slowT -= dt;
    const slow = this.slowT <= 0;
    if (slow) this.slowT = 0.14;

    if (slow) {
      $('val-coin').textContent = fmtCoin(g.coin);
      $('val-prestige').textContent = Math.round(g.prestige);
      const inf = $('chip-infamy');
      inf.classList.toggle('hidden', g.infamy < 1);
      $('val-infamy').textContent = Math.round(g.infamy);

      // wind rose: arrow points the way the wind blows
      const deg = (normAng(g.windAng) * 180 / Math.PI);
      $('wind-arrow').style.transform = `rotate(${180 - deg}deg)`;
      const from = COMPASS_PTS[Math.round(normAng(g.windAng + Math.PI) / (TAU / 8)) % 8];
      const wl = $('wind-label');
      if (p && p.alive) {
        const f = p.windFactor(g.windAng);
        wl.textContent = `${from} · ${Math.round(f * 100)}%`;
        wl.className = f > 0.82 ? 'good' : f < 0.55 ? 'bad' : '';
      } else { wl.textContent = from; wl.className = ''; }

      if (p) {
        $('flag-name').textContent = p.name;
        setBar('bar-hull', 'txt-hull', p.hullFrac, Math.round(p.hull));
        setBar('bar-sail', 'txt-sail', p.sailFrac, Math.round(p.sails));
        setBar('bar-crew', 'txt-crew', p.crewFrac, p.crewTotal);
        const prov = $('mini-prov'), ammo = $('mini-ammo'), cargo = $('mini-cargo');
        // barrels are only meaningful as time left at sea, so say so once it
        // is close enough to matter — a number alone told nobody anything
        const mins = p.crewTotal > 0 ? (p.provisions * 380) / (p.crewTotal * 60) : 99;
        prov.querySelector('b').textContent = mins < 16
          ? `${Math.floor(p.provisions)} · ${Math.max(0, Math.round(mins))}m`
          : Math.floor(p.provisions);
        ammo.querySelector('b').textContent = p.shot;
        cargo.querySelector('b').textContent = `${p.cargoUsed}/${p.cls.cargo}`;
        prov.classList.toggle('warn', mins < 8);
        ammo.classList.toggle('warn', p.shot < 6);
      }
    }

    // a hint and the objective chip are both guidance and share the top band
    if (slow) {
      const hintUp = !$('hint').classList.contains('hidden') && !$('hint').classList.contains('out');
      $('objective').classList.toggle('muted', hintUp);
    }

    this.updateActions();
    this.updateTargetCard(slow);
    this.updateFleetBar();
    this.updateObjectivePointer();
  }

  /* ---------------- objective pointer ----------------
     Off-screen objectives get a chevron pinned to the edge with the range,
     so a long passage is a heading and a countdown rather than a guess. */
  updateObjectivePointer() {
    const g = this.g;
    const ptr = $('objptr');
    const p = g.player;
    const m = (p && p.alive) ? g.objectiveMarker() : null;
    if (!m) { if (!ptr.classList.contains('hidden')) ptr.classList.add('hidden'); return; }

    const rect = g.rig.cam.__rect || (g.rig.cam.__rect = {});
    const W = window.innerWidth, H = window.innerHeight;
    rect.width = W; rect.height = H;
    const s = worldToScreen(g.rig.cam, m.x, 8, m.z, rect);

    // A safe rect that clears the top bar and the bottom controls, so the
    // chevron never lands on the ship's condition panel or the fleet bar.
    const short = H < 460;
    const L = 62, R = W - 62;
    const T = (short ? 78 : 104), B = H - (short ? 176 : 150);
    const onScreen = !s.behind && s.x > L && s.x < R && s.y > T && s.y < B;
    const d = Math.round(Math.hypot(m.x - p.x, m.z - p.z));

    if (onScreen) { if (!ptr.classList.contains('hidden')) ptr.classList.add('hidden'); return; }

    const cx = (L + R) / 2, cy = (T + B) / 2;
    let dx = s.x - cx, dy = s.y - cy;
    if (s.behind) { dx = -dx; dy = -dy; }
    if (!dx && !dy) dy = 1;
    const kx = dx ? (dx > 0 ? R - cx : cx - L) / Math.abs(dx) : Infinity;
    const ky = dy ? (dy > 0 ? B - cy : cy - T) / Math.abs(dy) : Infinity;
    const k = Math.min(kx, ky);
    const px = cx + dx * k, py = cy + dy * k;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;

    ptr.classList.remove('hidden');
    ptr.style.transform = `translate(${(px - ptr.offsetWidth / 2).toFixed(0)}px,${(py - ptr.offsetHeight / 2).toFixed(0)}px)`;
    ptr.querySelector('.op-arrow').style.transform = `rotate(${ang.toFixed(0)}deg)`;
    void short;
    if (this._ptrKey !== m.label + d) {
      this._ptrKey = m.label + d;
      ptr.querySelector('.op-txt').innerHTML = `<b>${m.label}</b> ${d}m`;
    }
  }

  /* ---------------- contextual actions ---------------- */
  updateActions() {
    const g = this.g, p = g.player;
    const acts = [];
    if (!p || !p.alive) { this.renderActions([]); return; }

    if (g.dockablePort && !p.boarding) acts.push('dock');
    if (g.boardable) acts.push('board');
    const fireSide = g.fireSide;
    if (g.target && g.target.alive && !g.target.captured) { acts.push('ammo'); acts.push('fire'); }

    const key = acts.join(',') + '|' + (fireSide || '') + '|' + (g.dockablePort ? g.dockablePort.id : '');
    if (key !== this.actionKeys) { this.actionKeys = key; this.renderActions(acts); }

    // live reload ring
    if (this.buttons.fire) {
      const b = this.buttons.fire;
      const ready = !!fireSide && p.reload[fireSide] <= 0;
      b.classList.toggle('reloading', !ready);
      const side = fireSide || (p.reload.stb <= p.reload.port ? 'stb' : 'port');
      const frac = clamp01(1 - p.reload[side] / Math.max(0.1, p.reloadTime));
      b.querySelector('.reload-ring').style.setProperty('--p', `${(frac * 100).toFixed(0)}%`);
      const sub = b.querySelector('.sub');
      sub.textContent = !fireSide ? 'NO ARC' : (ready ? (fireSide === 'stb' ? 'STARBOARD' : 'PORT') : 'RELOADING');
    }
  }

  renderActions(acts) {
    const box = $('actions');
    clear(box);
    this.buttons = {};
    const g = this.g;

    if (acts.includes('ammo')) {
      const strip = el('div', '', '');
      strip.id = 'ammo-strip';
      for (const id in AMMO) {
        const a = AMMO[id];
        const b = el('button', 'ammo-btn' + (g.player.ammo === id ? ' on' : ''),
          `<span class="ic">${a.icon}</span>${SHORT[id]}`);
        onTap(b, () => {
          g.player.ammo = id;
          toast(`${a.name} — ${a.tip}`, '', 1800);
          this.actionKeys = '';
        }, 520);
        strip.appendChild(b);
      }
      box.appendChild(strip);
    }

    if (acts.includes('board')) {
      const b = el('button', 'act-btn board', `BOARD<span class="sub">${Math.round(g.boardOdds * 100)}% ODDS</span>`);
      onTap(b, () => g.playerBoard(), 300);
      box.appendChild(b);
      this.buttons.board = b;
    }
    if (acts.includes('fire')) {
      const wrap = el('div', 'act-wrap');
      const b = el('button', 'act-btn fire', `FIRE<span class="sub">—</span><span class="reload-ring"></span>`);
      onTap(b, () => g.playerFire(), 220);
      wrap.appendChild(b);
      box.appendChild(wrap);
      this.buttons.fire = b;
    }
    if (acts.includes('dock')) {
      const port = g.dockablePort;
      const b = el('button', 'act-btn dock', `DOCK<span class="sub">${port.name.toUpperCase()}</span>`);
      onTap(b, () => g.enterPort(port), 760);
      box.appendChild(b);
      this.buttons.dock = b;
    }
  }

  /* ---------------- target card ---------------- */
  updateTargetCard(slow) {
    const g = this.g;
    const card = $('targetcard');
    const t = g.target;
    const show = !!(t && t.alive && !t.captured);
    card.classList.toggle('hidden', !show);
    // drive this from the card's actual state every tick, not from a
    // transition — a missed edge would leave the two panels overlapping
    setNoticesLow(show);
    if (!show) return;
    if (!slow) return;
    $('tc-name').textContent = t.name;
    const fac = FACTIONS[t.faction];
    $('tc-hull').style.width = (t.hullFrac * 100) + '%';
    $('tc-sail').style.width = (t.sailFrac * 100) + '%';
    $('tc-crew').style.width = (t.crewFrac * 100) + '%';
    const d = Math.hypot(t.x - g.player.x, t.z - g.player.z);
    $('tc-who').textContent = `${fac ? fac.short + ' · ' : ''}${t.cls.name}`;
    $('tc-range').textContent = `${Math.round(d)}m · ${t.gunsPort + t.gunsStb} guns`;

    // how she measures against everything under your flag
    const w = g.weighUp(t);
    const v = $('pw-verdict');
    v.textContent = w.verdict;
    v.className = VERDICT_CLASS[w.tier];
    const total = w.mine + w.theirs || 1;
    const youPct = clamp((w.mine / total) * 100, 4, 96);
    $('pw-you').style.width = youPct + '%';
    $('pw-them').style.width = (100 - youPct) + '%';
    $('pw-yn').textContent = w.mine;
    $('pw-tn').textContent = w.theirs;
  }

  /* ---------------- fleet bar ---------------- */
  updateFleetBar() {
    const g = this.g;
    const bar = $('fleetbar');
    const consorts = g.fleet.filter(s => !s.isPlayer && s.alive);
    if (consorts.length === 0) { bar.classList.add('hidden'); this.fleetKey = ''; return; }
    bar.classList.remove('hidden');
    const key = consorts.length + '|' + g.fleetOrder;
    if (key === this.fleetKey) return;
    this.fleetKey = key;
    clear(bar);
    const orders = [
      { id: 'follow', ic: '⚑', label: 'FOLLOW' },
      { id: 'engage', ic: '✕', label: 'ENGAGE' },
      { id: 'hold', ic: '⚓', label: 'HOLD' },
    ];
    for (const o of orders) {
      const b = el('button', 'fleet-btn' + (g.fleetOrder === o.id ? ' on' : ''),
        `<span class="fi">${o.ic}</span>${o.label}`);
      onTap(b, () => { g.setFleetOrder(o.id); this.fleetKey = ''; }, 560);
      bar.appendChild(b);
    }
  }
}

function setBar(barId, txtId, frac, val) {
  const b = $(barId);
  b.style.width = (clamp01(frac) * 100) + '%';
  b.classList.toggle('low', frac < 0.3);
  $(txtId).textContent = val;
}
