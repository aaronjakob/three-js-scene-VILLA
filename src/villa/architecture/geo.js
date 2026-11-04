import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { shape, ccw } from './plan.js';

// Geometry builders working in plan space (x east, y north, z up) and
// returning world-space (three) geometry.

export function toWorldGeo(g) {
  // (x, y, z) plan -> (x, z, -y) three
  g.rotateX(-Math.PI / 2);
  return g;
}

// Thick slab with rounded (beveled) edges. zTop = top surface elevation.
export function slabGeometry(outline, holes, zTop, thickness, { bevel = 0.14, segments = 5, curveSegments = 6 } = {}) {
  const sh = shape(outline, holes);
  const b = Math.min(bevel, thickness * 0.45);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.001, thickness - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: segments,
    curveSegments,
    steps: 1,
  });
  g.translate(0, 0, zTop - thickness + b);
  toWorldGeo(g);
  g.computeVertexNormals();
  return g;
}

// Flat cap (single face) at elevation z, facing up (dir=1) or down (dir=-1)
export function capGeometry(outline, holes, z, dir = 1) {
  const sh = shape(outline, holes);
  const g = new THREE.ShapeGeometry(sh, 8);
  if (dir < 0) {
    // flip winding
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
  }
  g.translate(0, 0, z);
  toWorldGeo(g);
  g.computeVertexNormals();
  return g;
}

// Vertical strip along an open polyline (plan pts), from z0 to z1.
// UV: u = distance along (m), v = height (m).
export function stripGeometry(pts, z0, z1, { closed = false } = {}) {
  const P = closed ? [...pts, pts[0]] : pts;
  const n = P.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  let dist = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) dist += P[i].distanceTo(P[i - 1]);
    const p = P[i];
    pos.set([p.x, z0, -p.y, p.x, z1, -p.y], i * 6);
    uv.set([dist, 0, dist, z1 - z0], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Thick wall along an open polyline: extrude a rectangle offset either side.
export function wallGeometry(pts, z0, z1, thickness, { capEnds = true } = {}) {
  const left = [], right = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const nrm = new THREE.Vector2(-t.y, t.x).multiplyScalar(thickness / 2);
    left.push(pts[i].clone().add(nrm));
    right.push(pts[i].clone().sub(nrm));
  }
  const outline = [...left, ...right.reverse()];
  const sh = new THREE.Shape(ccw(outline));
  const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, z0);
  toWorldGeo(g);
  g.computeVertexNormals();
  void capEnds;
  return g;
}

// Tube along a plan polyline at constant or per-point elevation
export function tubeAlong(pts, z, radius, { closed = false, radial = 6, tubular } = {}) {
  const v3 = pts.map((p, i) => new THREE.Vector3(p.x, Array.isArray(z) ? z[i] : z, -p.y));
  const curve = new THREE.CatmullRomCurve3(v3, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular ?? Math.max(8, pts.length * 2), radius, radial, closed);
}

// Rectangular profile swept along a polyline (frames, channels, curbs)
export function sweepRect(pts, z, w, h, { closed = false } = {}) {
  const P = closed ? [...pts, pts[0]] : pts;
  const n = P.length;
  const ring = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  const pos = [];
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const nrm = new THREE.Vector2(-t.y, t.x);
    for (const [ox, oz] of ring) {
      const x = P[i].x + nrm.x * ox, y = P[i].y + nrm.y * ox;
      pos.push(x, z + oz, -y);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = a + 4, d = b + 4;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

export function merge(geos) {
  const valid = geos.filter(Boolean).map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(k)) ng.deleteAttribute(k);
    if (!ng.attributes.uv) {
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    }
    if (!ng.attributes.normal) ng.computeVertexNormals();
    return ng;
  });
  if (!valid.length) return new THREE.BufferGeometry();
  return mergeGeometries(valid, false);
}

export { mergeVertices };

// Box with world-metre UVs, positioned in plan coords
export function box(w, d, h, x, y, z, rotZ = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  // world-scale UVs
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (ay > 0.5) uv.setXY(i, px, pz);
    else if (ax > 0.5) uv.setXY(i, pz, py);
    else uv.setXY(i, px, py);
  }
  g.rotateY(rotZ);
  g.translate(x, z + h / 2, -y);
  return g;
}
