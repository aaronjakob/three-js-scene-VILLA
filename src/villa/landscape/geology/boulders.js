import * as THREE from 'three';
import { Simplex, mulberry32, clamp } from '../../core/noise.js';
import { polygonizeDense } from './mc.js';

// Fractured limestone stones: an ellipsoid cut by random fracture planes
// (Voronoi-chunk look), edges rounded by weathering, a few chipped corners
// and a crack, plus surface noise. Extracted with marching cubes so facets
// stay flat and edges crisp; cavity AO is baked into vertex colours.

const smaxk = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

function stoneSDF(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const s = new Simplex(seed + 101);
  const ax = 1.0, ay = 0.5 + rng() * 0.38, az = 0.62 + rng() * 0.33;
  const kRound = 0.05 + rng() * 0.09;
  const planes = [];
  const nP = 7 + Math.floor(rng() * 6);
  for (let i = 0; i < nP; i++) {
    // random direction, flattened top/bottom planes are common (bedding)
    let nx = rng() * 2 - 1, ny = (rng() * 2 - 1) * (i < 2 ? 3 : 1), nz = rng() * 2 - 1;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const supp = Math.hypot(nx * ax, ny * ay, nz * az);
    planes.push([nx, ny, nz, supp * (0.52 + rng() * 0.36), kRound * (0.5 + rng())]);
  }
  // chips: small planes cutting near the extreme corners
  const chips = [];
  for (let i = 0; i < 4 + Math.floor(rng() * 4); i++) {
    let nx = rng() * 2 - 1, ny = rng() * 2 - 1, nz = rng() * 2 - 1;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const supp = Math.hypot(nx * ax, ny * ay, nz * az);
    chips.push([nx, ny, nz, supp * (0.62 + rng() * 0.18)]);
  }
  // one partial crack
  let cx = rng() * 2 - 1, cy = rng() * 0.6 - 0.3, cz = rng() * 2 - 1;
  const cl = Math.hypot(cx, cy, cz) || 1;
  cx /= cl; cy /= cl; cz /= cl;
  const cd = (rng() - 0.5) * 0.5;
  const crackW = 0.012 + rng() * 0.02;
  const f = (x, y, z) => {
    let d = (Math.hypot(x / ax, y / ay, z / az) - 1) * Math.min(ay, az);
    for (const [nx, ny, nz, o, k] of planes) d = smaxk(d, nx * x + ny * y + nz * z - o, k);
    for (const [nx, ny, nz, o] of chips) d = Math.max(d, nx * x + ny * y + nz * z - o);
    d += 0.03 * s.noise3(x * 2.4, y * 2.4, z * 2.4) + 0.012 * s.noise3(x * 7 + 3, y * 7, z * 7);
    // crack: thin slot reaching ~1/3 into the stone from one side
    const cp = cx * x + cy * y + cz * z - cd;
    const reach = (x * cz - z * cx) * 0.8 + 0.35;
    if (reach > 0) d = Math.max(d, -(Math.abs(cp) - crackW * Math.min(1, reach * 3)) + (1 - Math.min(1, reach * 2.5)) * 0.08);
    return d;
  };
  return { f, ext: [ax, ay, az] };
}

export function boulderGeometry(seed, res = 28) {
  const { f, ext } = stoneSDF(seed);
  const B = 1.12;
  const n = res + 1;
  const h = (2 * B) / res;
  const vals = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -B + i * h, y = -B + j * h, z = -B + k * h;
    // grid axes: i -> x, j -> z, k -> y  (so the polygoniser's "up" is y)
    let v = -f(x, z, y);
    if (i === 0 || j === 0 || k === 0 || i === n - 1 || j === n - 1 || k === n - 1) v = Math.min(v, -0.01);
    vals[(k * n + j) * n + i] = v;
  }
  const { pos, index } = polygonizeDense(vals, n, n, n);
  const nv = pos.length / 3;
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
  const e = h * 0.5;
  for (let v = 0; v < nv; v++) {
    const x = -B + pos[v * 3] * h, z = -B + pos[v * 3 + 1] * h, y = -B + pos[v * 3 + 2] * h;
    const gx = f(x + e, y, z) - f(x - e, y, z);
    const gy = f(x, y + e, z) - f(x, y - e, z);
    const gz = f(x, y, z + e) - f(x, y, z - e);
    const L = Math.hypot(gx, gy, gz) || 1;
    const nx = gx / L, ny = gy / L, nz = gz / L;
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
    let occ = 0, w = 1;
    for (const d of [0.04, 0.09, 0.18, 0.32]) {
      occ += Math.max(0, d - f(x + nx * d, y + ny * d, z + nz * d)) * w / d;
      w *= 0.6;
    }
    const ao = clamp(1 - occ * 0.55, 0.25, 1) * (0.82 + 0.18 * clamp(y / ext[1] + 0.6, 0, 1));
    C[v * 3] = ao; C[v * 3 + 1] = 0; C[v * 3 + 2] = 0;
  }
  // winding vs normals
  let agree = 0;
  for (let t = 0; t < Math.min(index.length, 3000); t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    agree += Math.sign((uy * wz - uz * wy) * N[a * 3] + (uz * wx - ux * wz) * N[a * 3 + 1] + (ux * wy - uy * wx) * N[a * 3 + 2]);
  }
  if (agree < 0) for (let t = 0; t < index.length; t += 3) { const s = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = s; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(nv > 65535 ? index : new Uint16Array(index), 1));
  g.computeBoundingSphere();
  g.userData.ext = ext;
  return g;
}
