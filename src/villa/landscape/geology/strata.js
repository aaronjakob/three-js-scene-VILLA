import { mulberry32, Simplex } from '../../core/noise.js';

// Deterministic geology shared by the cliff mesh, the boulders and the
// shaders: a stack of limestone units (cliff-forming hard beds alternating
// with soft, vegetated marly beds), thin bedding partings inside them, and two
// sets of vertical joints that split the beds into blocks.

export function hash3i(a, b, c) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Strata coordinate: elevation with a gentle dip and slow undulation, so the
// beds are not perfectly level (same function on CPU for every consumer).
export class StrataWarp {
  constructor(seed = 19) {
    this.n = new Simplex(seed);
  }
  at(x, y) {
    return 0.012 * x - 0.006 * y + 0.55 * this.n.fbm2(x / 34, y / 34, 2) + 0.12 * this.n.noise2(x / 7.5, y / 7.5);
  }
}

/**
 * Units from below sea level to the hill tops. Each unit:
 *  b, t   bottom / top (strata coordinate, m)
 *  cliff  true: hard, cliff-forming; false: soft, weathers back to a soil slope
 *  C      face level: the face of the unit stands on the base-height contour h = C
 *  dC     per-block spread of the face level (m of base height)
 *  lean   face level drop per metre up the unit (> 0: the face overhangs)
 *  P      max protrusion of a block above the base slope (m)
 *  erode  per-block lowering of the unit top (m)
 */
export function makeStrata(seed = 41) {
  const rng = mulberry32(seed);
  const units = [];
  let z = -3.2;
  let prevCliff = false;
  while (z < 30) {
    // rock prevalence by elevation: massive near the sea, banded mid-cliff,
    // soil-mantled near the plateau rim
    const pc = z < 1.5 ? 0.95 : z < 6 ? 0.78 : z < 13.5 ? 0.66 : 0.5;
    const cliff = prevCliff ? rng() < pc * 0.55 : rng() < pc;
    let thick;
    if (cliff) thick = z < 1.5 ? 1.4 + rng() * 1.6 : 1.3 + rng() * 2.9;
    else thick = 0.45 + rng() * 1.3;
    const u = { b: z, t: z + thick, cliff };
    if (cliff) {
      const o = -0.1 + rng() * 0.6;
      u.C = Math.max(-0.75, z - o);
      u.dC = 0.35 + rng() * 0.7;
      u.lean = rng() < 0.45 ? 0.05 + rng() * 0.22 : rng() * 0.05;
      u.P = 1.4 + rng() * 2.2;
      u.erode = 0.15 + rng() * 0.6;
      u.hard = 0.55 + rng() * 0.45;
    } else {
      u.C = 1e9;
      u.hard = rng() * 0.25;
    }
    units.push(u);
    prevCliff = cliff;
    z += thick;
  }
  // thin beds (partings) inside every unit
  const beds = [];
  const bedHard = [];
  for (const u of units) {
    let zb = u.b;
    while (zb < u.t - 0.12) {
      beds.push(zb);
      bedHard.push(u.cliff ? u.hard * (0.75 + 0.25 * rng()) : u.hard);
      zb += u.cliff ? 0.3 + rng() * rng() * 1.3 : 0.12 + rng() * 0.3;
    }
  }
  beds.push(units[units.length - 1].t);
  bedHard.push(0.5);
  return { units, beds, bedHard };
}

export function findUnit(units, z) {
  let lo = 0, hi = units.length - 1;
  if (z <= units[0].b) return 0;
  if (z >= units[hi].b) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (units[m].b <= z) lo = m;
    else hi = m;
  }
  return lo;
}

export function findBed(beds, z) {
  let lo = 0, hi = beds.length - 1;
  if (z <= beds[0]) return 0;
  if (z >= beds[hi]) return hi - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (beds[m] <= z) lo = m;
    else hi = m;
  }
  return lo;
}

// Two vertical joint sets: set A (spacing 2-7 m, striking roughly N-S, the
// cracks seen on the seaward faces) and set B (staggered per A-strip).
export class Joints {
  constructor(seed = 23) {
    const rng = mulberry32(seed);
    const ang = 0.24;
    this.ca = Math.cos(ang);
    this.sa = Math.sin(ang);
    this.A = [];
    let a = -160;
    while (a < 160) {
      this.A.push(a);
      a += 1.9 + rng() * 4.8;
    }
    this.n = new Simplex(seed + 3);
  }
  // out: { k, m, dA, dB }
  at(x, y, out) {
    const n = this.n;
    let a = x * this.ca + y * this.sa;
    let b = -x * this.sa + y * this.ca;
    a += 0.6 * n.noise2(x / 9.5, y / 9.5) + 0.18 * n.noise2(x / 2.9, y / 2.9);
    b += 0.7 * n.noise2(x / 10 + 40, y / 10 - 13) + 0.15 * n.noise2(x / 3.3 - 7, y / 3.3);
    const A = this.A;
    let lo = 0, hi = A.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (A[m] <= a) lo = m;
      else hi = m;
    }
    const k = lo;
    const dA = Math.max(0, Math.min(a - A[k], A[k + 1] - a));
    const S = 2.4 + 5.2 * hash3i(k, 7, 1);
    const offs = hash3i(k, 3, 2) * S;
    const q = (b - offs) / S;
    const m = Math.floor(q);
    const lb = (q - m) * S;
    out.k = k;
    out.m = m;
    out.dA = dA;
    out.dB = Math.min(lb, S - lb);
    out.wA = hash3i(k, 11, 5);
    return out;
  }
}
