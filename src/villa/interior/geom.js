import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex, mulberry32 } from '../core/noise.js';

// Geometry toolkit for the interior. Local object space: x = width (right),
// y = up, z = depth with the FRONT facing +z. place() puts it in the world:
// plan (x east, y north), elevation z, rot = CCW plan rotation. With rot = 0
// the front faces south; facing(dx, dy) gives the rot that faces a plan vector.
// All UVs are in metres so materials scale textures with texture.repeat.

const noise = new Simplex(4242);

export function place(g, x, y, z, rot = 0) {
  if (rot) g.rotateY(rot);
  g.translate(x, z, -y);
  return g;
}
export const facing = (dx, dy) => Math.atan2(dx, -dy);
export function at(g, x, y, z) { g.translate(x, y, z); return g; }

// --- normals ---------------------------------------------------------------
// Average normals across coincident vertices (keeps UV seams, hides shading seams)
export function weldNormals(g, eps = 1e-4) {
  g.computeVertexNormals();
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  const n = P.length / 3;
  const map = new Map();
  const inv = 1 / eps;
  const slot = new Int32Array(n);
  const acc = [];
  for (let i = 0; i < n; i++) {
    // exact integer key (local coordinates stay well inside +-6 m)
    const k = (Math.round(P[i * 3] * inv) + 65536) * 17179869184 + (Math.round(P[i * 3 + 1] * inv) + 65536) * 131072 + (Math.round(P[i * 3 + 2] * inv) + 65536);
    let s = map.get(k);
    if (s === undefined) { s = acc.length / 3; acc.push(0, 0, 0); map.set(k, s); }
    slot[i] = s;
    acc[s * 3] += N[i * 3]; acc[s * 3 + 1] += N[i * 3 + 1]; acc[s * 3 + 2] += N[i * 3 + 2];
  }
  for (let i = 0; i < n; i++) {
    const s = slot[i] * 3;
    const l = Math.hypot(acc[s], acc[s + 1], acc[s + 2]) || 1;
    N[i * 3] = acc[s] / l; N[i * 3 + 1] = acc[s + 1] / l; N[i * 3 + 2] = acc[s + 2] / l;
  }
  g.attributes.normal.needsUpdate = true;
  return g;
}

// --- 1D sample list for a rounded extent: dense in the rounding zones -------
function roundedSamples(a, r, step, k) {
  const out = [];
  const inner = Math.max(0, a - r);
  const n = Math.max(1, Math.ceil((2 * inner) / step));
  for (let i = k; i >= 1; i--) out.push(-inner - r * Math.tan((Math.PI / 4) * (i / k)));
  for (let i = 0; i <= n; i++) out.push(-inner + (2 * inner * i) / n);
  for (let i = 1; i <= k; i++) out.push(inner + r * Math.tan((Math.PI / 4) * (i / k)));
  // dedupe when inner = 0
  return out.filter((v, i) => i === 0 || Math.abs(v - out[i - 1]) > 1e-6);
}

// --- soft upholstered block ---------------------------------------------------
// Rounded box whose surface is pushed around like a stuffed cushion:
//   crown  : dome of the top face (m)
//   belly  : outward bulge of the side faces (m)
//   sag    : soft depression in the top [depth, x, z, radius] (local m)
//   seam   : 'crease' | 'welt' | null — sewn seam on the top (and bottom) edge
//   wrinkle: amplitude of fabric irregularity (m)
//   taper  : top face shrink factor (0 = straight sides)
export function softBox(w, h, d, o = {}) {
  const {
    r = Math.min(0.06, w / 2, h / 2, d / 2), crown = 0, belly = 0, sag = null,
    seam = 'crease', seamDepth = 0.005, seamBottom = true, wrinkle = 0.0015, wrinkleScale = 9,
    step = 0.045, k = 5, seed = 1, taper = 0, bottomFlat = true, frontDrop = 0,
  } = o;
  const ax = w / 2, ay = h / 2, az = d / 2;
  const rr = Math.min(r, ax - 1e-3, ay - 1e-3, az - 1e-3);
  const sx = roundedSamples(ax, rr, step, k);
  const sy = roundedSamples(ay, rr, step, k);
  const sz = roundedSamples(az, rr, step, k);
  const pos = [], uv = [], idx = [];
  const ox = seed * 0.37, oz = seed * 0.91;
  // six faces: [axis normal, u axis, v axis, sign]
  const faces = [
    ['y', 'x', 'z', 1], ['y', 'x', 'z', -1],
    ['x', 'z', 'y', 1], ['x', 'z', 'y', -1],
    ['z', 'x', 'y', 1], ['z', 'x', 'y', -1],
  ];
  const S = { x: sx, y: sy, z: sz }, A = { x: ax, y: ay, z: az };
  const tmp = { x: 0, y: 0, z: 0 };
  const nrm = [];
  const deformed = !!(crown || belly || sag || seam || wrinkle || taper || frontDrop);
  for (const [nAx, uAx, vAx, sgn] of faces) {
    const us = S[uAx], vs = S[vAx];
    const base = pos.length / 3;
    for (let j = 0; j < vs.length; j++) {
      for (let i = 0; i < us.length; i++) {
        tmp[nAx] = A[nAx] * sgn; tmp[uAx] = us[i]; tmp[vAx] = vs[j];
        let px = tmp.x, py = tmp.y, pz = tmp.z;
        // round: clamp to the inner box, push out by r
        const qx = Math.max(-ax + rr, Math.min(ax - rr, px));
        const qy = Math.max(-ay + rr, Math.min(ay - rr, py));
        const qz = Math.max(-az + rr, Math.min(az - rr, pz));
        let nx = px - qx, ny = py - qy, nz = pz - qz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        px = qx + nx * rr; py = qy + ny * rr; pz = qz + nz * rr;
        // stuffing: crown on top, belly on sides
        const fx = 1 - Math.min(1, (qx / Math.max(1e-3, ax - rr)) ** 2);
        const fz = 1 - Math.min(1, (qz / Math.max(1e-3, az - rr)) ** 2);
        const fy = 1 - Math.min(1, (qy / Math.max(1e-3, ay - rr)) ** 2);
        const top = Math.max(0, ny);
        let disp = 0;
        if (crown) disp += crown * fx * fz * top * (0.6 + 0.4 * top);
        if (belly) disp += belly * fy * (Math.abs(nx) * fz + Math.abs(nz) * fx) * (1 - Math.abs(ny));
        if (sag) {
          const [sd, sxp, szp, srad] = sag;
          const dd = ((qx - sxp) ** 2 + (qz - szp) ** 2) / (srad * srad);
          disp -= sd * Math.exp(-dd) * top;
        }
        if (seam) {
          // seam runs where the top/bottom panel meets the boxing strip (n.y ~ +-0.7)
          const ty = Math.abs(ny);
          if ((ny > 0 || seamBottom) && ty > 0.25 && ty < 0.98) {
            const wgt = Math.exp(-(((ty - 0.72) / 0.11) ** 2));
            disp += (seam === 'welt' ? 1 : -1) * seamDepth * wgt;
          }
        }
        if (wrinkle) {
          const wx = (qx + nx * rr) * wrinkleScale + ox, wy = (qy + ny * rr) * wrinkleScale, wz = (qz + nz * rr) * wrinkleScale + oz;
          disp += wrinkle * (noise.noise3(wx, wy, wz) + 0.5 * noise.noise3(wx * 2.3, wy * 2.3, wz * 2.3));
        }
        if (bottomFlat && ny < -0.2) disp *= 0.3;
        px += nx * disp; py += ny * disp; pz += nz * disp;
        if (taper) { const t = (py + ay) / h; px *= 1 - taper * t; pz *= 1 - taper * t; }
        if (frontDrop && pz > 0 && py > 0) py -= frontDrop * (pz / az) ** 2;
        pos.push(px, py, pz);
        nrm.push(nx, ny, nz);
        // metre UVs on the undeformed face plane
        uv.push(tmp[uAx] + (nAx === 'y' ? 0 : sgn * 0.37), tmp[vAx] + (nAx === 'x' ? 0.21 : 0));
      }
    }
    const nu = us.length;
    // (a, b, c) has normal U x V: -y for the y faces, -x for x faces, +z for z faces
    const abc = (nAx === 'z' ? sgn : -sgn) > 0;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, b = a + 1, c = a + nu, e = c + 1;
        if (abc) idx.push(a, b, c, b, e, c);
        else idx.push(a, c, b, b, c, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (deformed) weldNormals(g);
  else g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// make triangles face away from the centroid (robust for convex-ish solids)
function fixWinding(g) {
  const pos = g.attributes.position, idx = g.index.array;
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  let wrong = 0, total = 0;
  for (let i = 0; i < idx.length; i += 3 * 7) {
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); d.fromBufferAttribute(pos, idx[i + 2]);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
    if (n.lengthSq() < 1e-14) continue;
    total++;
    if (n.dot(a.sub(c)) < 0) wrong++;
  }
  if (wrong > total / 2) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
}

// --- scatter cushion (pillow): pinched corners, plump middle --------------------
export function pillow(w, h, t, o = {}) {
  const { seg = 18, bow = 0.07, chop = 0.0, seed = 1, wrinkle = 0.004, welt = 0 } = o;
  const pos = [], uv = [], idx = [];
  const rng = mulberry32(seed);
  const ph = rng() * 10;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const u = (i / seg) * 2 - 1, v = (j / seg) * 2 - 1;
        const fu = 1 - u * u, fv = 1 - v * v;
        let x = u * (w / 2) * (1 - bow * fv);
        let y = v * (h / 2) * (1 - bow * fu);
        let z = side * (t / 2) * Math.pow(Math.max(0, fu * fv), 0.42);
        // karate chop: V dent in the top edge middle
        if (chop) y -= chop * Math.exp(-(u * u) / 0.04) * Math.max(0, v) ** 3;
        const n = noise.noise3(u * 2.2 + ph, v * 2.2, side * 3.1) * wrinkle * Math.sqrt(fu * fv);
        z += side * n;
        if (welt) { const e = Math.max(Math.abs(u), Math.abs(v)); if (e > 0.985) z *= 0.2; }
        pos.push(x, y, z);
        uv.push(x + (side > 0 ? 0 : 0.5), y);
      }
    }
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- crisp rounded box with metre UVs (joinery, stone, metal) ------------------
export function rbox(w, h, d, r = 0.004, seg = 2) {
  const g = softBox(w, h, d, { r: Math.max(5e-4, r), seam: null, wrinkle: 0, step: Math.max(w, h, d) + 1, k: Math.max(1, seg) });
  return g;
}

// plain box (no rounding) with metre UVs — cheapest
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  metreUV(g);
  return g;
}
export function metreUV(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, px, pz);
    else if (ax >= az) uv.setXY(i, pz, py);
    else uv.setXY(i, px, py);
  }
  return g;
}

// subdivided box for surfaces that receive baked light (big panels)
export function panel(w, h, d, step = 0.12) {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w / step)), Math.max(1, Math.ceil(h / step)), Math.max(1, Math.ceil(d / step)));
  return metreUV(g);
}

// --- lathe with metre UVs + optional organic / fluted deformation --------------
// profile: [[r, y], ...] bottom to top. u = arc around (m at the widest), v = profile length (m)
export function lathe(profile, seg = 48, o = {}) {
  const { wobble = 0, wobbleFreq = 3, flutes = 0, fluteDepth = 0, seed = 1, tilt = 0, squash = 1 } = o;
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, seg);
  const pos = g.attributes.position, uv = g.attributes.uv;
  let rmax = 0;
  for (const p of pts) rmax = Math.max(rmax, p.x);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const rng = mulberry32(seed);
  const ph1 = rng() * 6.28, ph2 = rng() * 6.28;
  const ymin = pts[0].y, ymax = pts[pts.length - 1].y, yr = Math.max(1e-3, ymax - ymin);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    let a = Math.atan2(x, z);
    const t = (y - ymin) / yr;
    let s = 1;
    if (wobble) s += wobble * (Math.sin(a * wobbleFreq + ph1 + t * 2.0) * 0.6 + Math.sin(a * (wobbleFreq + 2) + ph2 - t * 3.0) * 0.4) * Math.sin(Math.PI * Math.min(1, t * 1.2));
    if (flutes) s += fluteDepth * (Math.abs(Math.cos(a * flutes * 0.5)) - 0.64);
    const nx = Math.sin(a) * r * s, nz = Math.cos(a) * r * s * squash;
    let ny = y;
    if (tilt) ny += tilt * nx;
    pos.setXYZ(i, nx, ny, nz);
    const u0 = uv.getX(i), v0 = uv.getY(i);
    const pi = Math.round(v0 * (pts.length - 1));
    uv.setXY(i, u0 * Math.PI * 2 * rmax, cum[Math.min(cum.length - 1, pi)]);
    void a;
  }
  g.computeVertexNormals();
  return weldNormals(g);
}

// --- sweep a closed 2D profile along a 3D path (frames, chair shells, rails) ----
// profile: [[px, py], ...] in the path's normal plane (px along "side", py along "up")
export function sweep(path, profile, o = {}) {
  const { closedPath = false, caps = true, up = new THREE.Vector3(0, 1, 0), scale = null } = o;
  const n = path.length, m = profile.length;
  const pos = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const a = path[closedPath ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = path[closedPath ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    B.crossVectors(T, up);
    if (B.lengthSq() < 1e-8) B.set(1, 0, 0);
    B.normalize();
    N.crossVectors(B, T).normalize();
    if (i > 0) dist += path[i].distanceTo(path[i - 1]);
    const sc = scale ? scale(i / (n - 1)) : 1;
    let pd = 0;
    for (let j = 0; j < m; j++) {
      const [px, py] = profile[j];
      if (j > 0) pd += Math.hypot(px - profile[j - 1][0], py - profile[j - 1][1]);
      pos.push(path[i].x + B.x * px * sc + N.x * py * sc, path[i].y + B.y * px * sc + N.y * py * sc, path[i].z + B.z * px * sc + N.z * py * sc);
      uv.push(dist, pd);
    }
  }
  const rings = closedPath ? n : n - 1;
  for (let i = 0; i < rings; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = i * m + j, b = i * m + j2, c = i2 * m + j, d = i2 * m + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps && !closedPath) {
    for (const [ring, flip] of [[0, true], [n - 1, false]]) {
      const c = new THREE.Vector3();
      for (let j = 0; j < m; j++) c.add(new THREE.Vector3(pos[(ring * m + j) * 3], pos[(ring * m + j) * 3 + 1], pos[(ring * m + j) * 3 + 2]));
      c.divideScalar(m);
      const ci = pos.length / 3;
      pos.push(c.x, c.y, c.z); uv.push(0, 0);
      for (let j = 0; j < m; j++) {
        const a = ring * m + j, b = ring * m + ((j + 1) % m);
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// loft through closed cross-sections (arrays of [x, y, z] with equal counts); caps both ends
export function swapUV(g) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setXY(i, uv.getY(i), u); }
  return g;
}
export function flipFaces(g) {
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}
export function loft(sections, { caps = true } = {}) {
  const n = sections.length, m = sections[0].length;
  const pos = [], uv = [], idx = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const a = sections[i][0], b = sections[i - 1][0];
      dist += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    let pd = 0;
    for (let j = 0; j < m; j++) {
      const p = sections[i][j];
      if (j > 0) { const q = sections[i][j - 1]; pd += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      pos.push(p[0], p[1], p[2]);
      uv.push(dist, pd);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = i * m + j, b = i * m + j2, c = (i + 1) * m + j, d = (i + 1) * m + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [ring, flip] of [[0, true], [n - 1, false]]) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of sections[ring]) { cx += p[0]; cy += p[1]; cz += p[2]; }
      const ci = pos.length / 3;
      pos.push(cx / m, cy / m, cz / m); uv.push(0, 0);
      for (let j = 0; j < m; j++) {
        const a = ring * m + j, b = ring * m + ((j + 1) % m);
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// rounded-rectangle profile (for sweep), centred, w x h, corner radius r
export function roundRectProfile(w, h, r, k = 3) {
  const out = [];
  const rr = Math.min(r, w / 2, h / 2);
  const cs = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI], [w / 2 - rr, -h / 2 + rr, Math.PI * 1.5]];
  for (const [cx, cy, a0] of cs) {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (i / k) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return out;
}
export function circleProfile(r, k = 10) {
  const out = [];
  for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return out;
}

// tube along a smooth curve with per-point radius (branches, frames, cords)
export function tube(points, radius, o = {}) {
  const { radial = 8, segs = null, closed = false, taper = null, gnarl = 0, seed = 1 } = o;
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const n = segs ?? Math.max(4, Math.ceil(curve.getLength() / 0.03));
  const frames = curve.computeFrenetFrames(n, closed);
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3();
  const L = curve.getLength();
  const rng = mulberry32(seed);
  const ph = rng() * 100;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    curve.getPointAt(t, P);
    const Nn = frames.normals[i], Bn = frames.binormals[i];
    const r0 = typeof radius === 'function' ? radius(t) : radius * (taper ? taper(t) : 1);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      let r = r0;
      if (gnarl) r *= 1 + gnarl * (noise.noise2(t * L * 6 + ph, j * 0.9) * 0.6 + noise.noise2(t * L * 17 + ph, Math.cos(a) * 2) * 0.4);
      const cx = Math.cos(a), sy = Math.sin(a);
      pos.push(P.x + (Nn.x * cx + Bn.x * sy) * r, P.y + (Nn.y * cx + Bn.y * sy) * r, P.z + (Nn.z * cx + Bn.z * sy) * r);
      uv.push((j / radial) * Math.PI * 2 * Math.max(r0, 0.02), t * L);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return weldNormals(g);
}

// cylinder with metre UVs (u around, v up) and optional bevelled top edge
export function cyl(rTop, rBot, h, seg = 32, o = {}) {
  const { bevel = 0, open = false } = o;
  if (!bevel) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(nrm.getY(i)) > 0.9) uv.setXY(i, pos.getX(i), pos.getZ(i));
      else uv.setXY(i, uv.getX(i) * Math.PI * 2 * Math.max(rTop, rBot), pos.getY(i));
    }
    g.translate(0, h / 2, 0);
    return g;
  }
  const b = bevel;
  const prof = [[0, 0], [rBot - b, 0], [rBot, b], [rTop, h - b], [rTop - b * 0.3, h - b * 0.1], [rTop - b, h], [0, h]];
  return latheCap(prof, seg);
}

// lathe whose flat caps get planar UVs (tables, drums, plinths)
export function latheCap(profile, seg = 48) {
  const g = lathe(profile, seg);
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.85) uv.setXY(i, pos.getX(i) + 0.31, pos.getZ(i) + 0.17);
  }
  return g;
}

// thin flat disc/ellipse in XZ (rugs, decals)
export function disc(rx, rz, seg = 48, rings = 4) {
  const pos = [0, 0, 0], uv = [0, 0], idx = [];
  for (let k = 1; k <= rings; k++) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, t = k / rings;
      pos.push(Math.cos(a) * rx * t, 0, Math.sin(a) * rz * t);
      uv.push(Math.cos(a) * t * 0.5 + 0.5, Math.sin(a) * t * 0.5 + 0.5);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let k = 1; k < rings; k++) {
    const o0 = 1 + (k - 1) * seg, o1 = 1 + k * seg;
    for (let i = 0; i < seg; i++) {
      const a = o0 + i, b = o0 + ((i + 1) % seg), c = o1 + i, d = o1 + ((i + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// grid plane in XY (paintings, panels), facing +z, centred
export function plane(w, h, sx = 1, sy = 1) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  return g;
}

// --- merge helpers -------------------------------------------------------------
const KEEP = ['position', 'normal', 'uv', 'color'];
export function mergeList(geos, { color = false } = {}) {
  const list = [];
  for (const g0 of geos) {
    if (!g0) continue;
    let g = g0;
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k) || (k === 'color' && !color)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (color && !g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (g.attributes.color && g.attributes.color.itemSize === 4) {
      const src = g.attributes.color, c = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { c[i * 3] = src.getX(i); c[i * 3 + 1] = src.getY(i); c[i * 3 + 2] = src.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (!g.index) {
      const n = g.attributes.position.count;
      const ia = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) ia[i] = i;
      g.setIndex(new THREE.BufferAttribute(ia, 1));
    }
    for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
    list.push(g);
  }
  if (!list.length) return null;
  const out = mergeGeometries(list, false);
  return out;
}

// paint a constant vertex colour onto a geometry (for colour-varied batches)
export function tint(g, c) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
