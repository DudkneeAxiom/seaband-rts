/* The heads-up display. Contextual: buttons exist only while they mean
   something, so the ocean keeps the screen. */
import { $, el, clear, onTap, toast, setNoticesLow } from './dom.js';
import { AMMO, FACTIONS } from '../data/gamedata.js';
import { clamp01, fmtCoin, normAng, TAU } from '../core/util.js';

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
        prov.querySelector('b').textContent = Math.floor(p.provisions);
        ammo.querySelector('b').textContent = p.shot;
        cargo.querySelector('b').textContent = `${p.cargoUsed}/${p.cls.cargo}`;
        prov.classList.toggle('warn', p.provisions < p.crewTotal * 0.6);
        ammo.classList.toggle('warn', p.shot < 6);
      }
    }

    this.updateActions();
    this.updateTargetCard(slow);
    this.updateFleetBar();
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
    if (!t || !t.alive || t.captured) {
      if (!card.classList.contains('hidden')) { card.classList.add('hidden'); setNoticesLow(false); }
      return;
    }
    if (card.classList.contains('hidden')) setNoticesLow(true);
    card.classList.remove('hidden');
    if (!slow) return;
    $('tc-name').textContent = t.name;
    const fac = FACTIONS[t.faction];
    $('tc-fac').textContent = fac ? fac.short : '';
    $('tc-hull').style.width = (t.hullFrac * 100) + '%';
    $('tc-sail').style.width = (t.sailFrac * 100) + '%';
    $('tc-crew').style.width = (t.crewFrac * 100) + '%';
    const d = Math.hypot(t.x - g.player.x, t.z - g.player.z);
    $('tc-dist').textContent = `${t.cls.name} · ${Math.round(d)}m · ${t.gunsPort + t.gunsStb} guns`;
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
