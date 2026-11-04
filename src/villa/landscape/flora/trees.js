import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';
import { cellRect, CELLS } from './atlas.js';

// ---------------------------------------------------------------------------
// Skeleton-based Mediterranean trees.
//   stone pine  : leaning clear bole, 4-6 upturned limbs forking into an
//                 umbrella of needle tufts at the ends of partly bare limbs
//   aleppo pine : irregular, open, leaning; sparse tufts
//   holm oak    : short trunk, many limbs, dense clumpy dark-glossy crown
//   olive       : gnarled, fluted multi-stem trunk; airy silver-green crown
//   cypress     : dense narrow flame-shaped column
// Each variant yields LOD0 (twigs + leaf sprays following the twigs), LOD1
// (limbs + clump cards from voxel-clustering LOD0) and LOD2 (trunk + a few
// big clump cards) from the SAME skeleton, so silhouettes agree across LODs.
// ---------------------------------------------------------------------------

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;

function anyPerp(d) {
  const a = Math.abs(d.y) < 0.9 ? UP : V(1, 0, 0);
  return V().crossVectors(d, a).normalize();
}
function branchDir(parent, div, roll) {
  const p = anyPerp(parent).applyAxisAngle(parent, roll);
  return parent.clone().multiplyScalar(Math.cos(div)).addScaledVector(p, Math.sin(div)).normalize();
}

function grow(rng, p0, dir, len, r0, r1, n, o = {}) {
  const up = o.up ?? 0, wob = o.wobble ?? 0.1;
  const pts = [p0.clone()], rads = [r0];
  const d = dir.clone().normalize();
  let p = p0.clone();
  const seg = len / n;
  for (let i = 1; i <= n; i++) {
    d.x += (rng() - 0.5) * wob;
    d.y += (rng() - 0.5) * wob + up;
    d.z += (rng() - 0.5) * wob;
    if (o.out) d.addScaledVector(o.out, o.outK ?? 0);
    d.normalize();
    p = p.clone().addScaledVector(d, seg);
    pts.push(p);
    rads.push(r0 + (r1 - r0) * Math.pow(i / n, o.taperP ?? 1));
  }
  return { pts, rads, len, level: o.level ?? 0 };
}

function at(br, t) {
  const n = br.pts.length;
  const f = Math.min(0.9999, Math.max(0, t)) * (n - 1);
  const i = Math.floor(f), k = f - i;
  const p = br.pts[i].clone().lerp(br.pts[i + 1], k);
  const d = br.pts[i + 1].clone().sub(br.pts[i]).normalize();
  const r = br.rads[i] + (br.rads[i + 1] - br.rads[i]) * k;
  return { p, d, r };
}

// --- geometry buffers -------------------------------------------------------
function woodBuf() { return { pos: [], nrm: [], uv: [], col: [], idx: [] }; }

// tapered tube with parallel-transport frames, bark UVs in metres, AO colour
function tube(out, br, radial, o = {}) {
  const pts = br.pts, rads = br.rads;
  const n = pts.length;
  const T = pts.map((p, i) => pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize());
  const N = anyPerp(T[0]);
  const base = out.pos.length / 3;
  const circ = TAU * rads[0];
  const uRep = Math.max(1, Math.round(circ / 0.36));
  let s = 0;
  const flute = o.flute ?? 0, fluteN = o.fluteN ?? 5, phase = o.phase ?? 0;
  const ao0 = o.ao0 ?? 1, ao1 = o.ao1 ?? 1;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const b = V().crossVectors(T[i - 1], T[i]);
      const bl = b.length();
      if (bl > 1e-6) N.applyAxisAngle(b.divideScalar(bl), Math.acos(Math.min(1, Math.max(-1, T[i - 1].dot(T[i])))));
      s += pts[i].distanceTo(pts[i - 1]);
    }
    const B = V().crossVectors(T[i], N).normalize();
    const t = i / (n - 1);
    const ao = ao0 + (ao1 - ao0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = N.x * c + B.x * sn, ny = N.y * c + B.y * sn, nz = N.z * c + B.z * sn;
      const bump = 1 + flute * (Math.sin(a * fluteN + phase + s * 1.7) * 0.6 + Math.sin(a * 2 + s * 0.9 + phase * 2) * 0.4) * (1 - t * 0.6);
      const r = rads[i] * bump;
      out.pos.push(pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
      out.nrm.push(nx, ny, nz);
      out.uv.push((j / radial) * uRep, s / 0.72);
      const k = ao * (0.9 + 0.1 * bump);
      out.col.push(k, k, k);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = base + i * (radial + 1) + j, b = a + radial + 1;
      out.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

function toGeometry(buf, extra) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  if (buf.col) g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  if (extra) for (const [k, v] of Object.entries(extra)) g.setAttribute(k, v);
  g.setIndex(buf.idx);
  g.computeBoundingSphere();
  return g;
}

// --- leaf cards -------------------------------------------------------------
// card: { p (anchor), axis (base->tip), face, w, h, cell, clump, roll }
export function cardGeometry(cards, crownC, crownScale = V(1, 1, 1)) {
  const pos = [], nrm = [], uv = [], crown = [], ao = [], idx = [];
  const tmpN = V(), tmpS = V(), cN = V();
  for (const c of cards) {
    const axis = c.axis;
    // face orthogonal to axis
    tmpN.copy(c.face).addScaledVector(axis, -c.face.dot(axis));
    if (tmpN.lengthSq() < 1e-6) tmpN.copy(anyPerp(axis));
    tmpN.normalize();
    if (c.roll) tmpN.applyAxisAngle(axis, c.roll);
    tmpS.crossVectors(axis, tmpN).normalize();
    const [u0, v0, u1, v1] = cellRect(c.cell);
    const anchor = CELLS[c.cell].anchor;
    const hw = c.w / 2;
    let b0;
    if (anchor === 'base') b0 = c.p.clone().addScaledVector(axis, -0.03 * c.h);
    else if (anchor === 'centre') b0 = c.p.clone().addScaledVector(axis, -c.h / 2);
    else b0 = c.p.clone().addScaledVector(axis, -0.02 * c.h);
    const b1 = b0.clone().addScaledVector(axis, c.h);
    // slight bend: tip half of the card droops / lifts (breaks the flat plane)
    const bend = c.bend ?? 0;
    const mid0 = b0.clone().addScaledVector(axis, c.h * 0.5).addScaledVector(tmpN, bend * c.h * 0.08);
    const tip = b1.clone().addScaledVector(tmpN, bend * c.h * 0.28);
    const rowsP = [b0, mid0, tip];
    const rowsV = anchor === 'top' ? [v0, (v0 + v1) / 2, v1] : [v1, (v0 + v1) / 2, v0];
    const base = pos.length / 3;
    // crown / clump normal
    cN.copy(c.p).sub(crownC).multiply(crownScale);
    if (cN.lengthSq() < 1e-6) cN.set(0, 1, 0);
    cN.normalize();
    if (c.clump) {
      const k = V().copy(c.p).sub(c.clump);
      if (k.lengthSq() > 1e-6) cN.multiplyScalar(0.55).addScaledVector(k.normalize(), 0.45);
    }
    cN.y += 0.12;
    cN.normalize();
    for (let r = 0; r < 3; r++) {
      const P = rowsP[r];
      for (let s = 0; s < 2; s++) {
        const sx = s ? hw : -hw;
        pos.push(P.x + tmpS.x * sx, P.y + tmpS.y * sx, P.z + tmpS.z * sx);
        nrm.push(tmpN.x, tmpN.y, tmpN.z);
        uv.push(s ? u1 : u0, rowsV[r]);
        crown.push(cN.x, cN.y, cN.z);
        ao.push(c.ao ?? 1, c.rnd ?? 0.5);
      }
    }
    for (let r = 0; r < 2; r++) {
      const a = base + r * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCrown', new THREE.Float32BufferAttribute(crown, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// voxel density AO: rays toward the sky hemisphere through the card cloud
const AO_DIRS = (() => {
  const d = [];
  for (let i = 0; i < 9; i++) {
    const el = i === 0 ? Math.PI / 2 : i < 5 ? 0.85 : 0.25;
    const az = i * 2.4;
    d.push(V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)));
  }
  return d;
})();
export function bakeAO(cards, cell = 0.5, sigma = 1.1) {
  if (!cards.length) return;
  const min = V(Infinity, Infinity, Infinity), max = V(-Infinity, -Infinity, -Infinity);
  for (const c of cards) { min.min(c.p); max.max(c.p); }
  min.subScalar(cell); max.addScalar(cell);
  const nx = Math.ceil((max.x - min.x) / cell) + 1, ny = Math.ceil((max.y - min.y) / cell) + 1, nz = Math.ceil((max.z - min.z) / cell) + 1;
  const grid = new Float32Array(nx * ny * nz);
  const vol = cell * cell * cell;
  for (const c of cards) {
    const i = Math.floor((c.p.x - min.x) / cell), j = Math.floor((c.p.y - min.y) / cell), k = Math.floor((c.p.z - min.z) / cell);
    grid[(j * nz + k) * nx + i] += (c.w * c.h * 0.45) / vol;
  }
  const step = cell * 0.9;
  for (const c of cards) {
    let acc = 0;
    for (const d of AO_DIRS) {
      let sum = 0;
      let x = c.p.x + d.x * cell * 0.6, y = c.p.y + d.y * cell * 0.6, z = c.p.z + d.z * cell * 0.6;
      for (let s = 0; s < 14; s++) {
        const i = Math.floor((x - min.x) / cell), j = Math.floor((y - min.y) / cell), k = Math.floor((z - min.z) / cell);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
        sum += grid[(j * nz + k) * nx + i];
        x += d.x * step; y += d.y * step; z += d.z * step;
      }
      acc += Math.exp(-sigma * sum * step);
    }
    c.ao = Math.min(1, 0.18 + 0.95 * (acc / AO_DIRS.length));
  }
}

// cluster cards into clump cards (for LODs)
function clusterCards(cards, cell, sizeK, cellName, rng, o = {}) {
  const map = new Map();
  for (const c of cards) {
    const key = `${Math.floor(c.p.x / cell)},${Math.floor(c.p.y / cell)},${Math.floor(c.p.z / cell)}`;
    let e = map.get(key);
    if (!e) { e = { p: V(), n: 0, ao: 0, clump: V(), axis: V() }; map.set(key, e); }
    e.p.add(c.p); e.n++; e.ao += c.ao ?? 1; e.axis.add(c.axis);
    if (c.clump) e.clump.add(c.clump); else e.clump.add(c.p);
  }
  const out = [];
  for (const e of map.values()) {
    if (e.n < (o.minN ?? 1)) continue;
    e.p.divideScalar(e.n); e.clump.divideScalar(e.n);
    const s = cell * sizeK * (0.85 + rng() * 0.3) * Math.min(1.2, 0.75 + e.n * 0.04);
    const ax = o.axisUp ? UP.clone().applyAxisAngle(V(1, 0, 0), (rng() - 0.5) * 0.6).applyAxisAngle(UP, rng() * TAU) : e.axis.normalize();
    const face = o.faceUp ? UP.clone() : e.p.clone().sub(o.centre ?? V()).setY(0.3).normalize();
    const cells = Array.isArray(cellName) ? cellName : [cellName];
    out.push({ p: e.p, axis: o.faceUp ? anyPerp(UP).applyAxisAngle(UP, rng() * TAU) : ax, face, w: s, h: s, cell: cells[0], clump: e.clump, ao: e.ao / e.n, rnd: rng(), roll: (rng() - 0.5) * 0.5, bend: (rng() - 0.5) * 1.2 });
    if (o.cross) {
      // second, crossing card so a clump reads from any side
      const axis2 = ax.clone();
      out.push({ p: e.p.clone().add(V(0, s * 0.05, 0)), axis: axis2, face: V().crossVectors(face, axis2).normalize(), w: s * 0.9, h: s * 0.9, cell: cells[cells.length > 1 ? 1 : 0], clump: e.clump, ao: e.ao / e.n, rnd: rng(), roll: 0, bend: (rng() - 0.5) * 1.2 });
    }
  }
  return out;
}

// --- species skeletons --------------------------------------------------------
function stonePine(rng, H, aleppo) {
  const br = [];
  const leanK = aleppo ? 0.55 : 0.32;
  const lean = V((rng() - 0.5) * leanK, 1, (rng() - 0.5) * leanK).normalize();
  const R0 = (aleppo ? 0.16 : 0.2) + H * 0.012;
  const trunkLen = H * (aleppo ? 0.42 + rng() * 0.12 : 0.55 + rng() * 0.1);
  const trunk = grow(rng, V(0, -0.35, 0), lean, trunkLen + 0.35, R0 * 1.15, R0 * 0.6, 8, { up: 0.012, wobble: aleppo ? 0.14 : 0.07, level: 0 });
  br.push(trunk);
  // a few dead stubs on the bole
  for (let i = 0; i < 3 + Math.floor(rng() * 4); i++) {
    const s = at(trunk, 0.35 + rng() * 0.5);
    br.push(grow(rng, s.p, branchDir(s.d, 1.2 + rng() * 0.4, rng() * TAU), 0.25 + rng() * 0.6, s.r * 0.22, s.r * 0.08, 2, { up: -0.05, level: 2, dead: true }));
  }
  const crownR = H * (aleppo ? 0.34 + rng() * 0.1 : 0.5 + rng() * 0.12);
  const nL = aleppo ? 4 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 3);
  const az0 = rng() * TAU;
  const twigs = [];
  for (let i = 0; i < nL; i++) {
    const az = az0 + (i / nL) * TAU + (rng() - 0.5) * 0.7;
    const t = aleppo ? 0.55 + rng() * 0.45 : 0.78 + rng() * 0.22;
    const s = at(trunk, t);
    const elev = aleppo ? 0.35 + rng() * 0.7 : 0.5 + rng() * 0.38;
    const dir = V(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const len = crownR * (aleppo ? 0.72 + rng() * 0.4 : 0.85 + rng() * 0.35);
    const limb = grow(rng, s.p, dir, len, s.r * 0.66, s.r * 0.2, 6, { up: aleppo ? 0.0 : -0.03, wobble: aleppo ? 0.22 : 0.12, level: 1 });
    br.push(limb);
    const n2 = aleppo ? 4 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 3);
    for (let k = 0; k < n2; k++) {
      const t2 = 0.3 + (k / n2) * 0.66 + rng() * 0.06;
      const s2 = at(limb, Math.min(0.98, t2));
      const outw = V(s2.p.x, 0, s2.p.z).normalize();
      const side = V(-outw.z, 0, outw.x).multiplyScalar((rng() - 0.5) * 1.6);
      const d2 = s2.d.clone().lerp(outw.clone().add(side).add(V(0, aleppo ? 0.3 + rng() * 0.5 : 0.12 + rng() * 0.3, 0)).normalize(), aleppo ? 0.45 : 0.65).normalize();
      const len2 = len * (aleppo ? 0.42 + rng() * 0.3 : 0.5 + rng() * 0.3) * (1.12 - t2 * 0.4);
      const b2 = grow(rng, s2.p, d2, len2, s2.r * 0.72, 0.03, 4, { up: 0.07, wobble: 0.2, level: 2 });
      br.push(b2);
      const end2 = b2.pts[b2.pts.length - 1];
      const n3 = aleppo ? 8 + Math.floor(rng() * 4) : 10 + Math.floor(rng() * 5);
      for (let m = 0; m < n3; m++) {
        const t3 = 0.22 + (m / n3) * 0.78;
        const s3 = at(b2, Math.min(0.99, t3));
        const d3 = branchDir(s3.d, 0.5 + rng() * 0.6, rng() * TAU).lerp(UP, 0.35 + rng() * 0.2).normalize();
        const b3 = grow(rng, s3.p, d3, 0.45 + rng() * 0.55, 0.024, 0.012, 2, { up: 0.12, wobble: 0.22, level: 3 });
        b3.clump = end2;
        br.push(b3);
        twigs.push(b3);
      }
      // the branch tip itself carries a tuft
      b2.clump = end2;
      twigs.push(b2);
    }
  }
  // umbrella: squash anything above the crown top
  const top = H * (0.98 + rng() * 0.04);
  for (const b of br) for (const p of b.pts) if (p.y > top) p.y = top + (p.y - top) * 0.25;
  const top0 = trunk.pts[trunk.pts.length - 1];
  return { br, twigs, crownC: V(top0.x, H * (aleppo ? 0.68 : 0.8), top0.z), crownScale: aleppo ? V(1, 1.3, 1) : V(1, 2.0, 1) };
}

function holmOak(rng, H) {
  const br = [];
  const lean = V((rng() - 0.5) * 0.2, 1, (rng() - 0.5) * 0.2).normalize();
  const R0 = 0.15 + H * 0.016;
  const trunk = grow(rng, V(0, -0.3, 0), lean, H * (0.26 + rng() * 0.1) + 0.3, R0 * 1.2, R0 * 0.75, 5, { up: 0, wobble: 0.12, level: 0 });
  br.push(trunk);
  const C = V(0, H * 0.6, 0);
  const R = V(H * (0.46 + rng() * 0.1), H * 0.38, H * (0.46 + rng() * 0.1));
  const nL = 4 + Math.floor(rng() * 3);
  const twigs = [];
  const az0 = rng() * TAU;
  for (let i = 0; i < nL; i++) {
    const s = at(trunk, 0.7 + rng() * 0.3);
    const az = az0 + (i / nL) * TAU + (rng() - 0.5) * 0.8;
    const elev = 0.65 + rng() * 0.55;
    const dir = V(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const limb = grow(rng, s.p, dir, H * (0.36 + rng() * 0.14), s.r * 0.68, s.r * 0.2, 5, { up: 0.01, wobble: 0.16, level: 1 });
    br.push(limb);
    const n2 = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < n2; k++) {
      const s2 = at(limb, 0.25 + (k / n2) * 0.73);
      const b2 = grow(rng, s2.p, branchDir(s2.d, 0.5 + rng() * 0.45, rng() * TAU), H * (0.18 + rng() * 0.12), s2.r * 0.7, 0.025, 4, { up: 0.02, wobble: 0.22, level: 2 });
      br.push(b2);
      const end2 = b2.pts[b2.pts.length - 1];
      const n3 = 8 + Math.floor(rng() * 4);
      for (let m = 0; m < n3; m++) {
        const s3 = at(b2, 0.25 + (m / n3) * 0.75);
        const outw = s3.p.clone().sub(C).normalize();
        const d3 = branchDir(s3.d, 0.6 + rng() * 0.5, rng() * TAU).lerp(outw, 0.4).normalize();
        const b3 = grow(rng, s3.p, d3, 0.45 + rng() * 0.45, 0.02, 0.01, 2, { up: 0.0, wobble: 0.25, level: 3 });
        b3.clump = end2;
        br.push(b3);
        twigs.push(b3);
      }
    }
  }
  // keep tips inside a slightly lumpy ellipsoid
  for (const b of br) {
    if (b.level === 0) continue;
    for (const p of b.pts) {
      const q = p.clone().sub(C).divide(R);
      const l = q.length();
      const lim = 1 + 0.12 * Math.sin(Math.atan2(q.z, q.x) * 3 + q.y * 2);
      if (l > lim) p.copy(C).add(q.multiplyScalar(lim / l).multiply(R));
    }
  }
  return { br, twigs, crownC: C, crownScale: V(1 / R.x, 1 / R.y, 1 / R.z).multiplyScalar(H) };
}

function olive(rng, H) {
  const br = [];
  const twigs = [];
  const nS = 2 + Math.floor(rng() * 2);
  const az0 = rng() * TAU;
  const C = V(0, H * 0.62, 0);
  for (let i = 0; i < nS; i++) {
    const az = az0 + (i / nS) * TAU + (rng() - 0.5) * 0.6;
    const tilt = 0.18 + rng() * 0.3;
    const dir = V(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
    const r0 = 0.13 + rng() * 0.07;
    const stem = grow(rng, V(Math.cos(az) * 0.08, -0.3, Math.sin(az) * 0.08), dir, H * (0.32 + rng() * 0.12) + 0.3, r0 * 1.5, r0 * 0.8, 6, { up: 0.02, wobble: 0.3, level: 0 });
    stem.gnarl = true;
    br.push(stem);
    const nL = 2 + Math.floor(rng() * 2);
    for (let l = 0; l < nL; l++) {
      const s = at(stem, 0.75 + rng() * 0.25);
      const limb = grow(rng, s.p, branchDir(s.d, 0.4 + rng() * 0.5, rng() * TAU), H * (0.28 + rng() * 0.12), s.r * 0.7, s.r * 0.25, 5, { up: 0.0, wobble: 0.3, level: 1 });
      br.push(limb);
      const n2 = 4 + Math.floor(rng() * 3);
      for (let k = 0; k < n2; k++) {
        const s2 = at(limb, 0.25 + (k / n2) * 0.75);
        const b2 = grow(rng, s2.p, branchDir(s2.d, 0.5 + rng() * 0.5, rng() * TAU), 0.9 + rng() * 0.8, s2.r * 0.7, 0.02, 4, { up: -0.03, wobble: 0.25, level: 2 });
        br.push(b2);
        const end2 = b2.pts[b2.pts.length - 1];
        const n3 = 7 + Math.floor(rng() * 4);
        for (let m = 0; m < n3; m++) {
          const s3 = at(b2, 0.25 + (m / n3) * 0.75);
          const outw = s3.p.clone().sub(C).normalize();
          const b3 = grow(rng, s3.p, branchDir(s3.d, 0.55 + rng() * 0.5, rng() * TAU).lerp(outw, 0.3).normalize(), 0.35 + rng() * 0.3, 0.014, 0.008, 2, { up: -0.07, wobble: 0.25, level: 3 });
          b3.clump = end2;
          br.push(b3);
          twigs.push(b3);
        }
      }
    }
  }
  return { br, twigs, crownC: C, crownScale: V(1, 1.2, 1) };
}

function cypress(rng, H) {
  const br = [];
  const R0 = 0.12 + H * 0.008;
  const trunk = grow(rng, V(0, -0.3, 0), V((rng() - 0.5) * 0.04, 1, (rng() - 0.5) * 0.04), H * 0.97, R0, 0.02, 9, { wobble: 0.02, level: 0 });
  br.push(trunk);
  const Rm = H * (0.065 + rng() * 0.02);
  const prof = (h) => (h < 0.1 ? 0.55 + h * 4.5 : 1) * Math.pow(Math.max(0, 1 - h), 0.62) * (1 + 0.1 * Math.sin(h * 19 + rng() * 0.0));
  const n = 70 + Math.floor(rng() * 20);
  const twigs = [];
  let az = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const h = 0.05 + (i / n) * 0.9;
    az += 2.39996;
    const s = at(trunk, h);
    const elev = 1.12 + rng() * 0.25;
    const dir = V(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const len = Math.max(0.25, Rm * prof(h) * (1.5 + rng() * 0.6) / Math.cos(elev) * 0.6);
    const b = grow(rng, s.p, dir, len, Math.max(0.015, s.r * 0.35), 0.01, 3, { up: 0.03, wobble: 0.1, level: 2 });
    b.clump = s.p.clone().add(V(Math.cos(az) * Rm * prof(h) * 0.5, 0, Math.sin(az) * Rm * prof(h) * 0.5));
    br.push(b);
    twigs.push(b);
  }
  return { br, twigs, crownC: V(0, H * 0.45, 0), crownScale: V(1, 0.12, 1), prof, Rm };
}

// --- species table -----------------------------------------------------------
export const SPECIES = {
  pine: { height: [8.5, 13], bark: 'pine' },
  aleppo: { height: [7, 11], bark: 'pine' },
  oak: { height: [5, 8.5], bark: 'oak' },
  olive: { height: [3.8, 5.8], bark: 'olive' },
  cypress: { height: [9, 13.5], bark: 'oak' },
};

function foliageCards(sp, sk, rng, H) {
  const cards = [];
  const add = (c) => { c.rnd = rng(); cards.push(c); };
  if (sp === 'pine' || sp === 'aleppo') {
    const al = sp === 'aleppo';
    for (const tw of sk.twigs) {
      const e = at(tw, 1);
      const s = (al ? 0.75 : 0.95) * (0.8 + rng() * 0.4);
      // star tuft facing up + two crossing brushes along the twig
      add({ p: e.p.clone().add(V(0, 0.05, 0)), axis: anyPerp(UP).applyAxisAngle(UP, rng() * TAU), face: V((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize(), w: s * 1.1, h: s * 1.1, cell: al ? 'aleppo' : 'pineTop', clump: tw.clump, roll: 0, bend: 0 });
      const st = at(tw, 0.45);
      for (let k = 0; k < 2; k++) {
        add({ p: st.p, axis: st.d.clone().lerp(UP, 0.3).normalize(), face: anyPerp(st.d).applyAxisAngle(st.d, rng() * TAU), w: s * 1.15, h: s * 1.25, cell: al ? 'aleppo' : 'pineSide', clump: tw.clump, roll: k * 1.5708, bend: (rng() - 0.5) * 1.5 });
      }
    }
  } else if (sp === 'cypress') {
    for (const tw of sk.twigs) {
      const n = 4;
      for (let k = 0; k < n; k++) {
        const s = at(tw, 0.15 + (k / n) * 0.85);
        const outw = V(s.p.x, 0, s.p.z).normalize();
        add({ p: s.p, axis: s.d.clone().lerp(UP, 0.4).normalize(), face: outw, w: 0.5 + rng() * 0.2, h: 0.55 + rng() * 0.25, cell: 'cypress', clump: tw.clump, roll: (rng() - 0.5) * 1.2, bend: (rng() - 0.5) });
      }
    }
    // outer skin so the column reads dense from every side
    for (let i = 0; i < 260; i++) {
      const h = 0.06 + rng() * 0.92;
      const a = rng() * TAU;
      const r = sk.Rm * sk.prof(h) * (0.75 + rng() * 0.35);
      const p = V(Math.cos(a) * r, h * H, Math.sin(a) * r);
      add({ p, axis: V(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize(), face: V(Math.cos(a), 0.1, Math.sin(a)), w: 0.55 + rng() * 0.2, h: 0.6 + rng() * 0.3, cell: 'cypress', clump: V(0, h * H, 0), roll: (rng() - 0.5) * 0.8, bend: (rng() - 0.5) });
    }
  } else {
    const isOak = sp === 'oak';
    for (const tw of sk.twigs) {
      const n = isOak ? 5 : 4;
      for (let k = 0; k < n; k++) {
        const s = at(tw, 0.2 + (k / n) * 0.8);
        const outw = s.p.clone().sub(sk.crownC).normalize();
        const axis = s.d.clone().lerp(outw, 0.35).add(V(0, isOak ? 0.15 : -0.1, 0)).normalize();
        add({ p: s.p, axis, face: outw.clone().lerp(UP, 0.4).normalize(), w: (isOak ? 0.62 : 0.56) * (0.8 + rng() * 0.4), h: (isOak ? 0.64 : 0.6) * (0.8 + rng() * 0.4), cell: isOak ? (rng() < 0.5 ? 'oakA' : 'oakB') : (rng() < 0.5 ? 'oliveA' : 'oliveB'), clump: tw.clump, roll: (rng() - 0.5) * 2.2, bend: (rng() - 0.5) * 1.6 });
      }
    }
  }
  return cards;
}

const RADIAL = [[12, 8, 5, 3], [7, 5, 3, 0], [5, 3, 0, 0]];

export function makeTreeVariant(sp, seed) {
  const rng = mulberry32(seed * 7919 + sp.length * 131 + 17);
  const S = SPECIES[sp];
  const H = S.height[0] + (S.height[1] - S.height[0]) * rng();
  const sk = sp === 'pine' ? stonePine(rng, H, false) : sp === 'aleppo' ? stonePine(rng, H, true) : sp === 'oak' ? holmOak(rng, H) : sp === 'olive' ? olive(rng, H) : cypress(rng, H);
  const cards = foliageCards(sp, sk, rng, H);
  bakeAO(cards, 0.5, sp === 'cypress' ? 1.6 : 1.1);
  const lods = [];
  for (let L = 0; L < 3; L++) {
    const w = woodBuf();
    for (const b of sk.br) {
      const rad = RADIAL[L][Math.min(3, b.level)];
      if (!rad) continue;
      if (L > 0 && b.dead) continue;
      const lvl = b.level;
      tube(w, b, rad, {
        flute: b.gnarl ? 0.28 : lvl === 0 ? 0.08 : 0.03,
        fluteN: b.gnarl ? 4 : 6,
        phase: rng() * 6,
        ao0: lvl === 0 ? 0.55 : lvl === 1 ? 0.62 : 0.5,
        ao1: lvl === 0 ? 0.8 : lvl >= 2 ? 0.45 : 0.6,
      });
    }
    let leafCards;
    if (L === 0) leafCards = cards;
    else if (sp === 'pine' || sp === 'aleppo') leafCards = clusterCards(cards, L === 1 ? 1.1 : 2.0, 1.55, sp === 'aleppo' ? ['pineCl', 'aleppo'] : ['pineCl', 'pineClSide'], rng, { faceUp: true, cross: true, minN: L === 1 ? 1 : 2 });
    else if (sp === 'cypress') leafCards = clusterCards(cards, L === 1 ? 0.9 : 1.6, 1.55, 'cypressCl', rng, { centre: sk.crownC, cross: L === 1 });
    else leafCards = clusterCards(cards, L === 1 ? 0.95 : 1.8, 1.6, sp === 'oak' ? 'oakCl' : 'oliveCl', rng, { centre: sk.crownC, cross: L === 1 });
    lods.push({ wood: toGeometry(w), leaves: cardGeometry(leafCards, sk.crownC, sk.crownScale), cards: leafCards.length });
  }
  return { lods, height: H, bark: S.bark };
}
