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
    this.northOnScreen = 0;
    this.spin = 1;                 // which way round the card runs; measured
    this.buildCompassTicks();
    this.bindSpeed();
    onTap($('tc-close'), () => this.g.clearTarget(), 380);
  }

  /** Engraved ticks on the card: long at the cardinals, short every 15°. */
  buildCompassTicks() {
    const box = document.querySelector('#cmp-rose .cmp-ticks');
    if (!box) return;
    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const major = i % 6 === 0, mid = i % 3 === 0;
      const r1 = 39.5, r2 = r1 - (major ? 7 : mid ? 5 : 3);
      const ln = document.createElementNS(ns, 'line');
      ln.setAttribute('x1', (50 + Math.sin(a) * r1).toFixed(2));
      ln.setAttribute('y1', (50 - Math.cos(a) * r1).toFixed(2));
      ln.setAttribute('x2', (50 + Math.sin(a) * r2).toFixed(2));
      ln.setAttribute('y2', (50 - Math.cos(a) * r2).toFixed(2));
      ln.setAttribute('class', major ? 'tk major' : mid ? 'tk mid' : 'tk');
      box.appendChild(ln);
    }
  }

  /** Pause / 1× / fast. Sailing a long leg should not mean waiting a long time. */
  bindSpeed() {
    const g = this.g;
    for (const b of document.querySelectorAll('.spd')) {
      onTap(b, () => {
        /* The fast button is a cycle, not a setting: off it starts at 2×, and
           each further tap flips 2×↔4×. Coming back from pause or 1× starts
           at 2× again rather than dropping the player straight into 4×. */
        this.setSpeed(b.classList.contains('fast') ? (g.speed === 2 ? 4 : 2) : +b.dataset.s);
      }, b.dataset.s === '0' ? 320 : 700);
    }
  }
  setSpeed(n) {
    this.g.speed = n;
    this.syncSpeed();
  }
  /** Paint the strip from `g.speed`, wherever that was set — a battle forcing
      1× has to move the buttons too, or they lie about the clock. */
  syncSpeed() {
    const n = this.g.speed;
    const fast = document.querySelector('.spd.fast');
    if (fast) {
      // shows the speed it is at when lit, and the speed it will select when not
      fast.dataset.s = n >= 2 ? String(n) : '2';
      fast.textContent = `${fast.dataset.s}×`;
    }
    for (const o of document.querySelectorAll('.spd')) o.classList.toggle('on', +o.dataset.s === n);
    $('paused-badge').classList.toggle('hidden', n !== 0);
  }

  /** The ammo strip after a key has changed the shot type. */
  refreshAmmo() {
    const g = this.g;
    for (const b of document.querySelectorAll('.ammo-btn')) {
      b.classList.toggle('on', b.dataset.ammo === g.player.ammo);
    }
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

      this.updateCompass(p);
      this.syncSpeed();

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
      /* Where to sail next is campaign guidance and has nothing to say while
         the guns are out. Hiding it keeps the two layers visually distinct. */
      $('objective').classList.toggle('hidden', g.mode === 'battle' || !$('obj-text').innerHTML);
    }

    this.updateActions();
    this.updateTargetCard(slow);
    this.updateFleetBar();
    this.updateObjectivePointer();
    this.updatePursuit();
    this.updateBattleBar();
  }

  /* ---------------- being hunted ----------------
     The one thing a pursuit panel has to answer is "can I get away", and the
     only fact that bears on it is whether the gap is opening or closing. So
     that is the biggest word on it. */
  updatePursuit() {
    const g = this.g, box = $('pursuit');
    const p = g.pursuit;
    if (!p || g.mode !== 'campaign') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('pur-name').textContent = p.ship.name;
    $('pur-verdict').textContent = p.verdict;
    const st = $('pur-state');
    st.textContent = p.gaining ? (p.eta ? `gaining · ${p.eta}s` : 'gaining')
      : p.losing ? 'falling astern' : 'holding';
    st.className = p.gaining ? 'gaining' : p.losing ? 'losing' : '';
    $('pur-dist').textContent = p.dist;
    // the bar fills as she closes: full means she is aboard you
    const frac = clamp01(1 - (p.dist - 78) / 820);
    $('pur-fill').style.width = `${(frac * 100).toFixed(0)}%`;
  }

  /* ---------------- a fleet action ---------------- */
  updateBattleBar() {
    const g = this.g, box = $('battlebar');
    const b = g.battle;
    if (!b || g.mode !== 'battle') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('bb-kind').textContent = b.kind.name;
    $('bb-state').textContent = b.enemies.length === 1
      ? '1 sail against you' : `${b.enemies.length} sail against you`;
    const run = $('bb-run');
    // tell the player the way out exists, and what it costs to use it
    if (b.escapeArmed) { run.textContent = `run clear in ${Math.round(b.escapeDist)}m`; run.className = 'bb-run armed'; }
    else { run.textContent = 'too close to break off'; run.className = 'bb-run'; }
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
    /* Keep the whole chip on the glass. It is positioned by its centre, so a
       target off the port bow put its left half — the chevron and the first
       letters of the name — past the edge of a narrow screen, sliced off
       square. Clamp after centring: the chevron still points the right way,
       and the label is still readable, which is the entire job. */
    const pw = ptr.offsetWidth, ph = ptr.offsetHeight;
    const tx = clamp(px - pw / 2, 8, Math.max(8, W - pw - 8));
    const ty = clamp(py - ph / 2, 8, Math.max(8, H - ph - 8));
    ptr.style.transform = `translate(${tx.toFixed(0)}px,${ty.toFixed(0)}px)`;
    ptr.querySelector('.op-arrow').style.transform = `rotate(${ang.toFixed(0)}deg)`;
    void short;
    if (this._ptrKey !== m.label + d) {
      this._ptrKey = m.label + d;
      ptr.querySelector('.op-txt').innerHTML = `<b>${m.label}</b> ${d}m`;
    }
  }

  /* ---------------- compass ----------------
     The card is worked out from the camera, not assumed: north is wherever
     north actually projects on screen, so swinging the view turns the rose
     with it. On top of that sit three needles you can read at a glance —
     where the wind blows, where your bow points, and where you have set
     your course. A rose with N welded to the top of the screen tells a
     player nothing once they have dragged the view round. */
  screenBearing(bearing) {
    // measured rather than derived, so a change in the rig cannot silently
    // put the whole card a quadrant out
    return normAng(this.northOnScreen + this.spin * bearing) * 180 / Math.PI;
  }
  /** Where north lies on screen, and which way round bearings run from it.
      Both are read off the projection: whether the plane comes out mirrored
      depends on the camera, and guessing it puts east where west is. */
  measureNorth() {
    const g = this.g, rect = { width: window.innerWidth, height: window.innerHeight };
    const f = g.rig.focus, cam = g.rig.cam;
    // a short baseline: the card is a rigid rose, so it should match the
    // projection where the eye is looking, not average over the whole scene
    const R = 24;
    const o = worldToScreen(cam, f.x, 0, f.z, rect);
    const n = worldToScreen(cam, f.x, 0, f.z + R, rect);
    const e = worldToScreen(cam, f.x + R, 0, f.z, rect);
    if (!o || !n || !e) return;
    if (Math.hypot(n.x - o.x, n.y - o.y) < 0.5) return;   // straight down the axis
    const nAng = Math.atan2(n.x - o.x, -(n.y - o.y));     // clockwise from screen up
    const eAng = Math.atan2(e.x - o.x, -(e.y - o.y));
    // east should sit a quarter turn clockwise of north; if it comes out the
    // other side the projection is mirrored and the whole card runs backwards
    this.spin = normAng(eAng - nAng) < Math.PI ? 1 : -1;
    // A camera tilted toward the horizon squashes the ground plane, so north
    // and east do not come out a right angle apart on screen and no rigid
    // rose can match both. Split the difference — the best rigid fit — rather
    // than pinning the card to one axis and letting the other drift twice as far.
    const eAsNorth = eAng - this.spin * Math.PI / 2;
    const d = normAng(eAsNorth - nAng);
    this.northOnScreen = nAng + (d > Math.PI ? d - Math.PI * 2 : d) / 2;
  }
  updateCompass(p) {
    const g = this.g;
    this.measureNorth();
    const rot = (id, bearing) => {
      const el = $(id);
      if (el) el.setAttribute('transform', `rotate(${this.screenBearing(bearing).toFixed(1)} 50 50)`);
    };
    rot('cmp-rose', 0);
    // the cardinals travel round the card but never turn over: a compass you
    // have to tilt your head to read is an ornament, not an instrument
    for (const t of document.querySelectorAll('#cmp-letters text')) {
      const b = (+t.dataset.b) * Math.PI / 180;
      const a = normAng(this.northOnScreen + this.spin * b);
      t.setAttribute('x', (50 + Math.sin(a) * 30.5).toFixed(2));
      t.setAttribute('y', (50 - Math.cos(a) * 30.5).toFixed(2));
    }
    // the wind arrow flies with the wind, so it points where it is going
    rot('cmp-wind', g.windAng);
    if (p && p.alive) rot('cmp-bow', p.yaw);
    $('cmp-bow').classList.toggle('hidden', !(p && p.alive));

    // the course marker: your destination if you set one, else the objective
    let course = null;
    if (p && p.alive) {
      const t = p.dest || g.objectiveMarker();
      if (t) {
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d > 6) course = Math.atan2(t.x - p.x, t.z - p.z);
      }
    }
    $('cmp-course').classList.toggle('hidden', course === null);
    if (course !== null) rot('cmp-course', course);

    const from = COMPASS_PTS[Math.round(normAng(g.windAng + Math.PI) / (TAU / 8)) % 8];
    const wl = $('wind-label');
    if (p && p.alive) {
      const f = p.windFactor(g.windAng);
      const hdg = Math.round(normAng(p.yaw) * 180 / Math.PI);
      wl.innerHTML = `<b>${String(hdg).padStart(3, '0')}°</b> · ${from} ${Math.round(f * 100)}%`;
      wl.className = f > 0.82 ? 'good' : f < 0.55 ? 'bad' : '';
    } else { wl.textContent = from; wl.className = ''; }
  }

  /* ---------------- contextual actions ---------------- */
  updateActions() {
    const g = this.g, p = g.player;
    const acts = [];
    if (!p || !p.alive) { this.renderActions([]); return; }

    if (g.dockablePort && !p.boarding) acts.push('dock');
    if (g.boardable) acts.push('board');
    const fireSide = g.fireSide;
    /* Guns belong to the action. On the campaign layer a marked ship is
       something you are looking at, not something you are shooting at — so
       offering FIRE out there, greyed and reading NO ARC, tells the player
       there is a shot to line up when there is no shot to be had at all. It
       is the same button that had a tester hunting for a way to attack. */
    if (g.ctx.combatLive && g.target && g.target.alive && !g.target.captured) {
      acts.push('ammo'); acts.push('fire');
    }

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
        b.dataset.ammo = id;
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
