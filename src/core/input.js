/* Unified pointer input: tap, drag-orbit, pinch-zoom.
   Designed for thumbs first; mouse mirrors it for desk testing. */
import * as THREE from 'three';

const TAP_MOVE = 14;      // px of slop still counted as a tap
const TAP_TIME = 420;     // ms

export class Input {
  constructor(el, { onTap, onDrag, onPinch, onHold } = {}) {
    this.el = el;
    this.onTap = onTap; this.onDrag = onDrag; this.onPinch = onPinch; this.onHold = onHold;
    this.pointers = new Map();
    this.moved = 0;
    this.startT = 0;
    this.pinchDist = 0;
    this.dragging = false;
    this._bind();
  }
  _bind() {
    const el = this.el;
    const opts = { passive: false };
    el.addEventListener('pointerdown', e => this._down(e), opts);
    el.addEventListener('pointermove', e => this._move(e), opts);
    el.addEventListener('pointerup', e => this._up(e), opts);
    el.addEventListener('pointercancel', e => this._up(e), opts);
    el.addEventListener('pointerleave', e => this._up(e), opts);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.onPinch && this.onPinch(e.deltaY > 0 ? 1.12 : 0.89);
    }, opts);
    el.addEventListener('contextmenu', e => e.preventDefault());
    // hard block of browser gestures on the canvas
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(n =>
      el.addEventListener(n, e => e.preventDefault(), opts));
  }
  _down(e) {
    // a right button is always an orbit, never an order — desk players expect
    // to be able to swing the view without their ship taking it as a course
    this.rightDrag = e.button === 2;
    this.el.setPointerCapture && this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.pointers.size === 1) { this.moved = 0; this.startT = performance.now(); this.dragging = false; }
    if (this.pointers.size === 2) this.pinchDist = this._pdist();
    e.preventDefault();
  }
  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.rightDrag || this.moved > TAP_MOVE) {
        this.dragging = true;
        this.onDrag && this.onDrag(dx, dy);
      }
    } else if (this.pointers.size === 2) {
      const d = this._pdist();
      if (this.pinchDist > 0 && d > 0) {
        const f = this.pinchDist / d;
        if (Math.abs(f - 1) > 0.004) this.onPinch && this.onPinch(f);
      }
      this.pinchDist = d;
      this.dragging = true;
    }
    e.preventDefault();
  }
  _up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const dt = performance.now() - this.startT;
    if (this.rightDrag) this.rightDrag = false;
    else if (!this.dragging && this.pointers.size === 0 && this.moved <= TAP_MOVE && dt < TAP_TIME) {
      this.onTap && this.onTap(p.x, p.y);
    }
    if (this.pointers.size < 2) this.pinchDist = 0;
    e.preventDefault();
  }
  _pdist() {
    const a = [...this.pointers.values()];
    return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }
}

/* ---------- picking helpers ---------- */
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
const _v = new THREE.Vector3();

export function screenToSea(cam, sx, sy, rect) {
  _ndc.x = ((sx - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((sy - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, cam);
  const p = _ray.ray.intersectPlane(_plane, _hit);
  return p ? { x: p.x, z: p.z } : null;
}

/** Screen-space proximity pick — much kinder to fingers than mesh raycasting. */
export function pickShip(cam, ships, sx, sy, rect, radius = 62) {
  let best = null, bestD = radius * radius;
  const cx = sx - rect.left, cy = sy - rect.top;
  for (const s of ships) {
    if (!s.alive && s.sinking > 2) continue;
    _v.set(s.x, 6, s.z).project(cam);
    if (_v.z > 1) continue;
    const px = (_v.x * 0.5 + 0.5) * rect.width;
    const py = (-_v.y * 0.5 + 0.5) * rect.height;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function worldToScreen(cam, x, y, z, rect) {
  _v.set(x, y, z).project(cam);
  return {
    x: (_v.x * 0.5 + 0.5) * rect.width,
    y: (-_v.y * 0.5 + 0.5) * rect.height,
    behind: _v.z > 1,
  };
}
