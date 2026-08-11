/* Tiny geometry helpers: merge, flat-shade, vertex-colour painting.
   Keeps draw-calls low — every ship and island ends up as one or two meshes. */
import * as THREE from 'three';

/** Merge a list of non-indexed BufferGeometries that share attributes. */
export function mergeGeos(geos) {
  const list = geos.filter(g => g && g.attributes.position);
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal ? g.attributes.normal.array : null;
    const c = g.attributes.color ? g.attributes.color.array : null;
    pos.set(p, o * 3);
    if (n) nor.set(n, o * 3);
    if (c) col.set(c, o * 3); else col.fill(1, o * 3, o * 3 + p.length);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const g of list) g.dispose();
  return out;
}

/** Convert to non-indexed, compute flat normals, and paint a solid colour. */
export function prep(geo, color, jitter = 0) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i += 3) {
    let r = c.r, gg = c.g, b = c.b;
    if (jitter) {
      const j = 1 + (Math.random() - 0.5) * jitter;
      r *= j; gg *= j; b *= j;
    }
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = r; col[(i + k) * 3 + 1] = gg; col[(i + k) * 3 + 2] = b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Apply a transform to a geometry in place (position + rotation + scale). */
export function xf(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz)
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Box with independent corner insets — used for tapered hull segments & roofs. */
export function taperedBox(w, h, d, topScaleX = 1, topScaleZ = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * topScaleX); p.setZ(i, p.getZ(i) * topScaleZ); }
  }
  p.needsUpdate = true;
  return g;
}

/** Standard low-poly material used by nearly everything solid. */
export function litMaterial(opts = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
}
