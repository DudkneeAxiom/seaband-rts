/* Regional market. Each port has stock; price follows scarcity and
   drifts back toward its local baseline. Buying low and carrying the
   risk is the whole point. */
import { GOODS, PORTS } from '../data/gamedata.js';
import { clamp, lerp, makeRNG } from '../core/util.js';

/* A port's opening books depend on that port and nothing else.
   One shared stream would have been simpler, but then every harbour added to
   PORTS shifts the draw for everything after it in the list — which is how
   adding Greywake and Tideglass quietly turned Fort Escarra into a spice
   famine and put a ◆385/min run on the board that nobody had tuned. */
function seedFor(id) {
  let h = 20260811;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Market {
  constructor(saved) {
    this.ports = {};
    this.haggle = 0;          // the captain's own way with a harbourmaster
    for (const p of PORTS) {
      const rng = makeRNG(seedFor(p.id));
      const st = { stock: {}, demand: {} };
      for (const gid in GOODS) {
        const mod = p.prices[gid] ?? 1;
        // ports that sell cheap are the ones that produce it
        st.stock[gid] = Math.round(lerp(30, 150, clamp(1.6 - mod, 0, 1.2) / 1.2) * (0.75 + rng() * 0.5));
        st.demand[gid] = mod;
      }
      this.ports[p.id] = st;
    }
    if (saved) this.load(saved);
  }

  base(portId, goodId) {
    const p = PORTS.find(p => p.id === portId);
    return GOODS[goodId].base * (p.prices[goodId] ?? 1);
  }
  /** price rises as stock falls; +30% at empty, −25% at glut */
  price(portId, goodId, forSale = true) {
    const st = this.ports[portId];
    // a shelf whose count has gone wrong is priced as an empty one, not as NaN:
    // a price is a number the player is asked to trust with their coin
    const s = Number.isFinite(st.stock[goodId]) ? st.stock[goodId] : 0;
    const scar = clamp(1.45 - s / 110, 0.74, 1.42);
    let v = this.base(portId, goodId) * scar;
    v *= forSale ? 1.08 : 0.92;      // the harbour takes its cut both ways
    // a haggler buys cheaper and sells dearer, both by the same margin
    const h = clamp(this.haggle, 0, 0.6) * 0.35;
    v *= forSale ? 1 - h : 1 + h;
    return Math.max(2, Math.round(v));
  }
  buyPrice(portId, goodId) { return this.price(portId, goodId, true); }
  sellPrice(portId, goodId) { return this.price(portId, goodId, false); }
  stock(portId, goodId) { return this.ports[portId].stock[goodId]; }

  /* A quantity that is not a number never reaches the shelves. One bad `cnt`
     from a stale button turned Ilo Vantu's fish stock into NaN permanently —
     and a NaN stock prices at NaN, which enables the BUY button (`NaN <= 0` is
     false), which sets the captain's coin to NaN. The counter is the last
     place to catch that, so it catches it. */
  takeStock(portId, goodId, n) {
    if (!Number.isFinite(n)) return;
    const st = this.ports[portId].stock;
    st[goodId] = Math.max(0, (Number.isFinite(st[goodId]) ? st[goodId] : 0) - n);
  }
  addStock(portId, goodId, n) {
    if (!Number.isFinite(n)) return;
    const st = this.ports[portId].stock;
    st[goodId] = (Number.isFinite(st[goodId]) ? st[goodId] : 0) + n;
  }

  /** slow drift back to baseline + NPC merchant churn */
  tick(dt) {
    for (const p of PORTS) {
      const st = this.ports[p.id];
      for (const gid in GOODS) {
        const mod = p.prices[gid] ?? 1;
        const baseline = lerp(30, 150, clamp(1.6 - mod, 0, 1.2) / 1.2);
        st.stock[gid] = lerp(st.stock[gid], baseline, 1 - Math.exp(-dt * 0.012));
      }
    }
  }
  /** an NPC merchant completing a run nudges the books */
  merchantArrived(portId) {
    const st = this.ports[portId];
    const keys = Object.keys(GOODS);
    const g = keys[(Math.random() * keys.length) | 0];
    st.stock[g] += 6 + Math.random() * 14;
    const g2 = keys[(Math.random() * keys.length) | 0];
    st.stock[g2] = Math.max(0, st.stock[g2] - (4 + Math.random() * 10));
  }

  save() {
    const o = {};
    for (const id in this.ports) o[id] = { stock: { ...this.ports[id].stock } };
    return o;
  }
  load(s) {
    for (const id in s) if (this.ports[id]) Object.assign(this.ports[id].stock, s[id].stock);
  }
}

/* ---------------- service pricing ---------------- */
export function repairCost(ship) {
  const h = (ship.hullMax - ship.hull) * 1.35;
  const s = (ship.sailMax - ship.sails) * 1.9;
  const g = (ship.gunsMax * 2 - ship.gunsPort - ship.gunsStb) * 46;
  return Math.ceil(h + s + g);
}
export function recruitCost(rankId, portId) {
  const base = { deckhand: 22, sailor: 42, gunner: 78, marine: 82, rigger: 74 }[rankId] ?? 30;
  const p = PORTS.find(p => p.id === portId);
  const mult = p && p.size === 'major' ? 1 : 1.18;
  return Math.round(base * mult);
}
export const PROVISION_PRICE = 4;
export const SHOT_PRICE = 7;
