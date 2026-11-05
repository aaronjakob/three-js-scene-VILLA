import * as THREE from 'three';
import { Simplex, smoothstep, clamp, lerp } from '../../core/noise.js';
import { polygonizeBands } from './mc.js';
import { makeStrata, findUnit, findBed, Joints, StrataWarp, hash3i } from './strata.js';
import {
  poolOutline, deckOutline, offset, pointInPoly, distToPoly,
  FIRE_STAIR_PTS, FIREPIT, WATERFALL_SPILL,
} from '../../architecture/plan.js';
import { VIEWS } from '../../core/anchors.js';

// ---------------------------------------------------------------------------
// The sea cliff under the villa as a true 3D rock body.
//
// Density F(p) (> 0 inside rock) = smooth union of
//   - the base solid: everything below the terrain surface (never lower than
//     the terrain mesh, so the coarse terrain never pokes through), and
//   - limestone units: hard beds stand as vertical / overhanging faces on
//     base-height contours, split into blocks by two joint sets, with cracks,
//     partings, a wave-cut notch, weathering noise and a rock lip around the
//     waterfall's plunge basin.
// Rock only ever ADDS to the terrain, so anything seated on field.height
// (plants, paths) is never left floating. The surface is extracted with
// marching cubes on a narrow band (0.25 m voxels) and gets baked attributes
// (cavity AO, soil, shelter, strata coordinate, hardness, cracks).
// ---------------------------------------------------------------------------

export const CLIFF_ZONE = { x0: -50, x1: 50, y0: -66, y1: -3.5, z0: -2.5, z1: 24 };
const V = 2.5; // field clamp (m)

const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};

// Waterfall geometry, exactly as pool.js derives it from the plan
export function waterfallFrame() {
  const inner = poolOutline();
  const SP = new THREE.Vector2(...WATERFALL_SPILL);
  let si = 0;
  for (let i = 0; i < inner.length; i++) if (inner[i].distanceTo(SP) < inner[si].distanceTo(SP)) si = i;
  const n = inner.length;
  const a = inner[(si - 1 + n) % n], b = inner[(si + 1) % n];
  const t = new THREE.Vector2().subVectors(b, a).normalize();
  const dir = new THREE.Vector2(t.y, -t.x).normalize();
  const start = inner[si].clone().addScaledVector(dir, 0.36);
  const T = Math.sqrt((2 * (17.962 - 8.72)) / 9.81);
  const plunge = start.clone().addScaledVector(dir, 1.2 * T);
  const basinC = plunge.clone().addScaledVector(dir, 0.6);
  return { start, dir, plunge, basinC, rx: 3.4, ry: 2.6, ang: Math.atan2(dir.y, dir.x), z: 8.9 };
}

function terrainMeshSampler(mesh) {
  if (!mesh?.geometry?.attributes?.position) return null;
  const pos = mesh.geometry.attributes.position.array;
  const n = Math.round(Math.sqrt(pos.length / 3));
  if (n * n * 3 !== pos.length) return null;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) X[i] = pos[i * 3];
  for (let j = 0; j < n; j++) Y[j] = -pos[j * n * 3 + 2];
  const find = (A, v) => {
    let lo = 0, hi = A.length - 1;
    if (v <= A[0]) return 0;
    if (v >= A[hi]) return hi - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (A[m] <= v) lo = m;
      else hi = m;
    }
    return lo;
  };
  return (x, y) => {
    const i = find(X, x), j = find(Y, y);
    const fx = clamp((x - X[i]) / (X[i + 1] - X[i]), 0, 1), fy = clamp((y - Y[j]) / (Y[j + 1] - Y[j]), 0, 1);
    const ha = pos[(j * n + i) * 3 + 1], hb = pos[(j * n + i + 1) * 3 + 1];
    const hc = pos[((j + 1) * n + i) * 3 + 1], hd = pos[((j + 1) * n + i + 1) * 3 + 1];
    if (fx + fy <= 1) return ha + fx * (hb - ha) + fy * (hc - ha);
    return hd + (1 - fx) * (hc - hd) + (1 - fy) * (hb - hd);
  };
}

// box blur (separable, two passes ~ gaussian) of a 2D float grid
function blur2D(src, nx, ny, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < ny; j++) {
      let acc = 0;
      const row = j * nx;
      for (let i = -r; i <= r; i++) acc += out[row + clamp(i, 0, nx - 1)];
      for (let i = 0; i < nx; i++) {
        tmp[row + i] = acc / (2 * r + 1);
        acc += out[row + Math.min(nx - 1, i + r + 1)] - out[row + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += tmp[clamp(j, 0, ny - 1) * nx + i];
      for (let j = 0; j < ny; j++) {
        out[j * nx + i] = acc / (2 * r + 1);
        acc += tmp[Math.min(ny - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
      }
    }
  }
  return out;
}

export function buildCliff({ field, terrainMesh, quality = {} }) {
  const t0 = performance.now();
  const Z = CLIFF_ZONE;
  const q = quality.name;
  const vs = quality.cliffVoxel ?? (q === 'low' ? 0.5 : q === 'balanced' ? 0.34 : 0.25);
  const nx = Math.round((Z.x1 - Z.x0) / vs) + 1;
  const ny = Math.round((Z.y1 - Z.y0) / vs) + 1;
  const nz = Math.round((Z.z1 - Z.z0) / vs) + 1;
  const X = (i) => Z.x0 + i * vs, Y = (j) => Z.y0 + j * vs, Zc = (k) => Z.z0 + k * vs;
  const NC = nx * ny;

  const strata = makeStrata(41);
  const { units, beds, bedHard } = strata;
  const warp = new StrataWarp(19);
  const joints = new Joints(23);
  const nz3 = new Simplex(29);
  const nzB = new Simplex(31);
  const meshH = terrainMeshSampler(terrainMesh);

  // --- exclusions (plan geometry) ----------------------------------------------
  const pool = offset(poolOutline(), 1.35);
  const deck = offset(deckOutline(), 0.9);
  const wf = waterfallFrame();
  const fallPoly = (() => {
    // plan footprint of the falling sheet + margin
    const side = new THREE.Vector2(-wf.dir.y, wf.dir.x);
    const a = wf.start.clone().addScaledVector(wf.dir, -0.25), b = wf.plunge.clone().addScaledVector(wf.dir, 0.4);
    const w0 = 1.3 + 0.75, w1 = 1.8 + 0.85;
    return [
      a.clone().addScaledVector(side, -w0), b.clone().addScaledVector(side, -w1),
      b.clone().addScaledVector(side, w1), a.clone().addScaledVector(side, w0),
    ];
  })();
  const ce = Math.cos(-wf.ang), se = Math.sin(-wf.ang);
  const basinE = (x, y) => {
    const dx = x - wf.basinC.x, dy = y - wf.basinC.y;
    const u = dx * ce - dy * se, v = dx * se + dy * ce;
    return Math.hypot(u / wf.rx, v / wf.ry);
  };
  const stair = FIRE_STAIR_PTS;
  const stairLen = (() => { let L = 0; for (let i = 1; i < stair.length; i++) L += Math.hypot(stair[i][0] - stair[i - 1][0], stair[i][1] - stair[i - 1][1]); return L; })();
  const stairProj = (x, y) => {
    let best = Infinity, bt = 0, acc = 0;
    for (let i = 0; i < stair.length - 1; i++) {
      const [ax, ay] = stair[i], [bx, by] = stair[i + 1];
      const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey);
      let t = ((x - ax) * ex + (y - ay) * ey) / (L * L);
      t = clamp(t, 0, 1);
      const d = Math.hypot(x - (ax + ex * t), y - (ay + ey * t));
      if (d < best) { best = d; bt = acc + t * L; }
      acc += L;
    }
    return { d: best, z: 18 - (bt / stairLen) * (18 - 12.65) };
  };
  const cams = VIEWS.filter((v) => !v.interior).map((v) => v.position);

  // --- 2D column pass ------------------------------------------------------------
  const hf = new Float32Array(NC);
  const hbase = new Float32Array(NC);
  // ceiling for the soil/base layer under the deck and the pool (it must never
  // break through the slab, the coping or the basin)
  const baseCap = new Float32Array(NC).fill(99);
  const hmax = new Float32Array(NC);
  const wDom = new Float32Array(NC);
  const cap = new Float32Array(NC);
  const amp = new Float32Array(NC);
  const wz = new Float32Array(NC);
  const crack = new Float32Array(NC);
  const jk = new Int32Array(NC), jm = new Int32Array(NC);
  const rim = new Float32Array(NC); // basin rim solid (distance-like, >0 inside the ring)
  const J = { k: 0, m: 0, dA: 0, dB: 0, wA: 0 };
  for (let j = 0; j < ny; j++) {
    const y = Y(j);
    for (let i = 0; i < nx; i++) {
      const x = X(i);
      const c = j * nx + i;
      const h = field.height(x, y);
      hf[c] = h;
      const hm = meshH ? meshH(x, y) : h;
      // domain weight: 1 inside, 0 at the zone border and on the high hills
      const ex = Math.min(x - Z.x0, Z.x1 - x), ey = Math.min(y - Z.y0, Z.y1 - y);
      const wD = smoothstep(0.6, 3.2, Math.min(ex, ey)) * (1 - smoothstep(19.5, 22.0, h));
      // temporarily: [below, above] the terrain; blended by 'cover' later
      hbase[c] = Math.min(h, hm) - 0.18;
      hmax[c] = Math.max(h, hm + 0.05);
      wDom[c] = wD;
      wz[c] = warp.at(x, y);
      joints.at(x, y, J);
      jk[c] = J.k;
      jm[c] = J.m;
      const wA = 0.22 + 0.3 * J.wA;
      crack[c] = Math.max((1 - smoothstep(0, wA, J.dA)) * (0.55 + 0.6 * J.wA), (1 - smoothstep(0, 0.2, J.dB)) * 0.35);
      // rock amplitude: fades before the zone border
      let a = smoothstep(3.0, 9.0, Math.min(ex, ey)) * (1 - smoothstep(18.5, 21.5, h));
      amp[c] = a;
      // caps (max rock elevation)
      let cz = Math.abs(x) < 32 ? 17.45 - 0.7 * Math.abs(nzB.noise2(x / 4.5, y / 4.5)) : 40;
      if (pointInPoly(x, y, deck)) cz = Math.min(cz, 17.3);
      if (pointInPoly(x, y, pool)) cz = Math.min(cz, 15.35);
      baseCap[c] = cz;
      const st = stairProj(x, y);
      if (st.d < 3.6) cz = Math.min(cz, st.z - 0.6 + 6 * smoothstep(1.8, 3.6, st.d));
      const fd = Math.hypot(x - FIREPIT.cx, y - FIREPIT.cy);
      if (fd < 4.9) cz = Math.min(cz, 11.7);
      else if (fd < 6.8) cz = Math.min(cz, 12.15 + 4 * smoothstep(6.2, 6.8, fd));
      const e = basinE(x, y);
      if (e < 0.97) cz = Math.min(cz, 8.7);
      if (pointInPoly(x, y, fallPoly)) cz = -10;
      for (const [cx, cy, cz0] of cams) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 14) cz = Math.min(cz, cz0 - 2.6 - 0.45 * d + 20 * smoothstep(12, 14, d));
      }
      cap[c] = cz;
      // natural rock lip around the plunge basin (hides the water edge)
      if (e > 0.85 && e < 1.7) {
        const ring = Math.min((e - 0.97) * 2.6, (1.62 - e) * 2.4);
        rim[c] = ring;
      } else rim[c] = -5;
    }
  }
  // smoothed base for the face contours, and its slope
  const hs = blur2D(hf, nx, ny, Math.max(2, Math.round(1.6 / vs)));
  const gmag = new Float32Array(NC);
  const cosT = new Float32Array(NC);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const gx = (hs[j * nx + Math.min(nx - 1, i + 1)] - hs[j * nx + Math.max(0, i - 1)]) / (2 * vs);
      const gy = (hs[Math.min(ny - 1, j + 1) * nx + i] - hs[Math.max(0, j - 1) * nx + i]) / (2 * vs);
      const g = Math.hypot(gx, gy);
      gmag[c] = Math.max(g, 0.22);
      // base cosine from the fine field
      const fx = (hf[j * nx + Math.min(nx - 1, i + 1)] - hf[j * nx + Math.max(0, i - 1)]) / (2 * vs);
      const fy = (hf[Math.min(ny - 1, j + 1) * nx + i] - hf[Math.max(0, j - 1) * nx + i]) / (2 * vs);
      cosT[c] = 1 / Math.sqrt(1 + fx * fx + fy * fy);
      // rock needs a slope to stand on (no faces on the plateau or flat beaches)
      amp[c] *= smoothstep(0.2, 0.45, g);
    }
  }
  // cover: where the cliff mesh lies on top of the terrain (rock areas plus a
  // margin); elsewhere it tucks under the terrain so the terrain shading shows
  const coverRaw = new Float32Array(NC);
  for (let c = 0; c < NC; c++) coverRaw[c] = amp[c] > 0.02 || rim[c] > -4 ? 1 : 0;
  const dil = Math.max(1, Math.round(0.9 / vs));
  const tmpC = new Float32Array(NC);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let m = 0;
    for (let d = -dil; d <= dil && !m; d++) m = Math.max(m, coverRaw[j * nx + clamp(i + d, 0, nx - 1)]);
    tmpC[j * nx + i] = m;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let m = 0;
    for (let d = -dil; d <= dil && !m; d++) m = Math.max(m, tmpC[clamp(j + d, 0, ny - 1) * nx + i]);
    coverRaw[j * nx + i] = m;
  }
  const cover = blur2D(coverRaw, nx, ny, Math.max(1, Math.round(1.1 / vs)));
  for (let c = 0; c < NC; c++) {
    cover[c] *= wDom[c];
    hbase[c] = lerp(hbase[c], hmax[c], smoothstep(0.0, 0.3, cover[c]));
    hbase[c] = Math.min(hbase[c], baseCap[c]);
  }
  // terrain push-down mask (0.5 m texels) for the terrain vertex stage
  const mStep = Math.max(1, Math.round(0.5 / vs));
  const mw = Math.floor((nx - 1) / mStep) + 1, mh = Math.floor((ny - 1) / mStep) + 1;
  const maskData = new Uint8Array(mw * mh * 4);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const v = cover[(j * mStep) * nx + i * mStep];
    const o = (j * mw + i) * 4;
    maskData[o] = maskData[o + 1] = maskData[o + 2] = Math.round(clamp(v, 0, 1) * 255);
    maskData[o + 3] = 255;
  }
  const coverTexture = new THREE.DataTexture(maskData, mw, mh, THREE.RGBAFormat, THREE.UnsignedByteType);
  coverTexture.minFilter = coverTexture.magFilter = THREE.LinearFilter;
  coverTexture.wrapS = coverTexture.wrapT = THREE.ClampToEdgeWrapping;
  coverTexture.needsUpdate = true;
  coverTexture.userData.bounds = [Z.x0, Z.y0, Z.x0 + (mw - 1) * mStep * vs, Z.y0 + (mh - 1) * mStep * vs];
  const tCols = performance.now();

  // --- density -------------------------------------------------------------------
  const kr = 0.32; // rounding of block edges
  const density = (c, x, y, z) => {
    const hb = hbase[c];
    const Fb = (hb - z) * cosT[c];
    const a = amp[c];
    let Fr = -V;
    if (a > 0.01 && cap[c] > z - 1.5) {
      const zp = z + wz[c];
      const h = hs[c], g = gmag[c];
      const ui = findUnit(units, zp);
      const k = jk[c], m = jm[c];
      for (let u = Math.max(0, ui - 1); u <= Math.min(units.length - 1, ui + 1); u++) {
        const U = units[u];
        if (!U.cliff) continue;
        const r1 = hash3i(k, m, u * 4 + 1), r2 = hash3i(k, m, u * 4 + 2), r3 = hash3i(k, m, u * 4 + 3);
        let C = U.C + (r1 - 0.5) * U.dC - U.lean * Math.max(0, zp - U.b);
        const top = Math.min(U.t - r2 * U.erode, h + U.P * (0.55 + 0.9 * r3));
        // thin beds: small per-bed steps in the face
        const bi = findBed(beds, zp);
        const db = (hash3i(bi, k, 77) - 0.6) * 0.32;
        const face = (h - C) / g + db;
        const Fu = smin(smin(zp - U.b + 0.3, top + 0.3 - zp, kr), face, kr);
        Fr = smax(Fr, Fu, 0.25);
      }
      // joints: vertical cracks cut into the blocks
      Fr -= crack[c] * 0.9;
      // weathering: rounded lumps + finer roughness
      Fr += 0.13 * nz3.noise3(x / 1.9, y / 1.9, z / 1.6) + 0.05 * nz3.noise3(x / 0.62 + 11, y / 0.62, z / 0.62);
      // sharp creases (ridged noise) so faces read fractured, not modelled
      Fr += 0.08 * (0.3 - Math.abs(nzB.noise3(x / 1.1 + 5, y / 1.1, z / 0.8)));
      // solution pockets (tafoni)
      const pk = nzB.noise3(x / 1.3, y / 1.3, z / 1.1);
      if (pk > 0.45) Fr -= (pk - 0.45) * 2.2;
      // wave-cut notch just above the sea
      Fr -= 0.55 * Math.exp(-(((z - 0.55) / 0.55) ** 2));
      Fr -= (1 - a) * 3.0;
      Fr = smin(Fr, cap[c] - z, 0.35);
    }
    // plunge basin lip
    if (rim[c] > -4) {
      const lipTop = 9.28 + 0.3 * nzB.noise2(x / 1.4, y / 1.4);
      const Fl = smin(rim[c], lipTop - z, 0.3) + 0.12 * nz3.noise3(x / 0.8, y / 0.8, z / 0.8);
      Fr = smax(Fr, Math.min(Fl, cap[c] > 8.8 ? 99 : 8.7 - z), 0.2);
    }
    const F = smax(Fb, Fr, 0.28);
    return F > V ? V : F < -V ? -V : F;
  };

  // --- narrow band per column ------------------------------------------------------
  const lo = new Float32Array(NC), hi = new Float32Array(NC);
  for (let c = 0; c < NC; c++) {
    const hb = hbase[c];
    let top = hb;
    if (amp[c] > 0.01) {
      // highest unit top this column can carry
      const h = hs[c];
      for (let u = 0; u < units.length; u++) {
        const U = units[u];
        if (!U.cliff) continue;
        const Cmin = U.C - 0.5 * U.dC - U.lean * (U.t - U.b);
        if (h >= Cmin) top = Math.max(top, Math.min(U.t + 0.4, h + U.P * 1.45 + 0.4));
      }
      top = Math.min(top, Math.max(hb, cap[c]));
    }
    if (rim[c] > -4) top = Math.max(top, 9.9);
    lo[c] = hb - 0.9;
    hi[c] = top + 0.7;
  }
  const start = new Int32Array(NC), len = new Int32Array(NC), off = new Int32Array(NC);
  let total = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      let l = lo[c], h = hi[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const cc = jj * nx + ii;
        l = Math.min(l, lo[cc]);
        h = Math.max(h, hi[cc]);
      }
      const k0 = clamp(Math.floor((l - Z.z0) / vs), 0, nz - 1);
      const k1 = clamp(Math.ceil((h - Z.z0) / vs), 0, nz - 1);
      start[c] = k0;
      len[c] = Math.max(0, k1 - k0 + 1);
      off[c] = total;
      total += len[c];
    }
  }
  const vals = new Float32Array(total);
  for (let j = 0; j < ny; j++) {
    const y = Y(j);
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const x = X(i);
      const o = off[c], s = start[c];
      for (let r = 0; r < len[c]; r++) vals[o + r] = density(c, x, y, Zc(s + r));
    }
  }
  const tField = performance.now();

  // --- extract ---------------------------------------------------------------------
  const grid = { nx, ny, nz, start, len, off, vals, V };
  const { pos, index } = polygonizeBands(grid);
  const tMC = performance.now();

  // field sampling (trilinear) in plan metres
  const valueAt = (i, j, k) => {
    if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
    if (j < 0) j = 0; else if (j >= ny) j = ny - 1;
    const c = j * nx + i;
    if (k < start[c]) return V;
    const r = k - start[c];
    if (r >= len[c]) return -V;
    return vals[off[c] + r];
  };
  const sample = (x, y, z) => {
    const gx = (x - Z.x0) / vs, gy = (y - Z.y0) / vs, gz = (z - Z.z0) / vs;
    const i = Math.floor(gx), j = Math.floor(gy), k = Math.floor(gz);
    const fx = gx - i, fy = gy - j, fz = gz - k;
    const v000 = valueAt(i, j, k), v100 = valueAt(i + 1, j, k), v010 = valueAt(i, j + 1, k), v110 = valueAt(i + 1, j + 1, k);
    const v001 = valueAt(i, j, k + 1), v101 = valueAt(i + 1, j, k + 1), v011 = valueAt(i, j + 1, k + 1), v111 = valueAt(i + 1, j + 1, k + 1);
    const a = v000 + (v100 - v000) * fx, b = v010 + (v110 - v010) * fx;
    const cc = v001 + (v101 - v001) * fx, d = v011 + (v111 - v011) * fx;
    const e = a + (b - a) * fy, f = cc + (d - cc) * fy;
    return e + (f - e) * fz;
  };

  // --- attributes ----------------------------------------------------------------
  const nv = pos.length / 3;
  const P = new Float32Array(nv * 3);
  const N = new Float32Array(nv * 3);
  const COL = new Float32Array(nv * 3); // ao, soil, shelter
  const GEO = new Float32Array(nv * 4); // strata z, hardness, crack, block random
  const pn = new Simplex(37);
  const e = 0.5 * vs;
  for (let v = 0; v < nv; v++) {
    const x = Z.x0 + pos[v * 3] * vs, y = Z.y0 + pos[v * 3 + 1] * vs, z = Z.z0 + pos[v * 3 + 2] * vs;
    // outward normal = -grad F
    let gx = sample(x + e, y, z) - sample(x - e, y, z);
    let gy = sample(x, y + e, z) - sample(x, y - e, z);
    let gz = sample(x, y, z + e) - sample(x, y, z - e);
    let L = Math.hypot(gx, gy, gz) || 1;
    const nxp = -gx / L, nyp = -gy / L, nzp = -gz / L;
    // three.js frame (x, z, -y)
    P[v * 3] = x; P[v * 3 + 1] = z; P[v * 3 + 2] = -y;
    N[v * 3] = nxp; N[v * 3 + 1] = nzp; N[v * 3 + 2] = -nyp;
    // SDF ambient occlusion along the normal
    let occ = 0, w = 1;
    for (const d of [0.22, 0.5, 0.95, 1.6]) {
      const f = sample(x + nxp * d, y + nyp * d, z + nzp * d);
      occ += Math.max(0, d + f) * w / d;
      w *= 0.62;
    }
    const ao = clamp(1 - occ * 0.42, 0.18, 1);
    // shelter: rock overhead
    let sh = 0;
    for (const d of [0.7, 1.6, 3.0]) sh = Math.max(sh, smoothstep(-0.25, 0.25, sample(x + nxp * 0.15, y + nyp * 0.15, z + d)));
    // column data at the vertex
    const ci = clamp(Math.round((x - Z.x0) / vs), 0, nx - 1), cj = clamp(Math.round((y - Z.y0) / vs), 0, ny - 1);
    const c = cj * nx + ci;
    const prot = z - hbase[c];
    // soil on the base slope and in patches on ledges; never in the splash zone
    const up = nzp;
    const patch = pn.fbm2(x / 3.2, y / 3.2, 3);
    let soil = smoothstep(0.5, 0.82, up) * (1 - smoothstep(0.12, 0.55, prot));
    soil = Math.max(soil, smoothstep(0.78, 0.95, up) * smoothstep(0.05, 0.35, patch) * 0.85);
    soil *= smoothstep(1.4, 2.6, z);
    COL[v * 3] = ao;
    COL[v * 3 + 1] = soil;
    COL[v * 3 + 2] = sh;
    const zp = z + wz[c];
    const ui = findUnit(units, zp);
    const bi = findBed(beds, zp);
    GEO[v * 4] = zp;
    GEO[v * 4 + 1] = units[ui].cliff ? bedHard[bi] : units[ui].hard;
    GEO[v * 4 + 2] = crack[c];
    GEO[v * 4 + 3] = hash3i(jk[c], jm[c], ui);
  }
  // winding: make triangles face along the field normal
  let agree = 0;
  for (let t = 0; t < Math.min(index.length, 30000); t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz2 = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * wz2 - uz * wy, cy = uz * wx - ux * wz2, cz = ux * wy - uy * wx;
    agree += Math.sign(cx * N[a * 3] + cy * N[a * 3 + 1] + cz * N[a * 3 + 2]);
  }
  if (agree < 0) {
    for (let t = 0; t < index.length; t += 3) { const s = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = s; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(COL, 3));
  geo.setAttribute('aGeo', new THREE.BufferAttribute(GEO, 4));
  geo.setIndex(new THREE.BufferAttribute(nv > 65535 ? index : new Uint16Array(index), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const tAttr = performance.now();

  // --- surface query (for rocks / plants placed on the cliff) ---------------------
  const surfaceHeight = (x, y) => {
    if (x <= Z.x0 + 0.5 || x >= Z.x1 - 0.5 || y <= Z.y0 + 0.5 || y >= Z.y1 - 0.5) return null;
    const gx = (x - Z.x0) / vs, gy = (y - Z.y0) / vs;
    const i = Math.round(gx), j = Math.round(gy);
    const c = j * nx + i;
    // scan the band from the top down for the first air->rock crossing
    let prev = -V;
    for (let k = start[c] + len[c]; k >= start[c] - 1; k--) {
      const f = sample(x, y, Zc(k));
      if (f > 0) {
        const t = prev / (prev - f);
        return Zc(k + 1) - t * vs;
      }
      prev = f;
    }
    return hbase[c];
  };
  const info = (x, y) => {
    const i = clamp(Math.round((x - Z.x0) / vs), 0, nx - 1), j = clamp(Math.round((y - Z.y0) / vs), 0, ny - 1);
    const c = j * nx + i;
    return { base: hbase[c], field: hf[c], amp: amp[c], cap: cap[c], basinE: basinE(x, y) };
  };
  const stats = {
    voxel: vs,
    columns: NC,
    samples: total,
    vertices: nv,
    triangles: index.length / 3,
    ms: {
      columns: Math.round(tCols - t0),
      field: Math.round(tField - tCols),
      mc: Math.round(tMC - tField),
      attributes: Math.round(tAttr - tMC),
    },
  };
  return { geometry: geo, coverTexture, strata, surfaceHeight, sample, info, inZone: (x, y) => x > Z.x0 + 3 && x < Z.x1 - 3 && y > Z.y0 + 3 && y < Z.y1 - 1, stats, waterfall: wf };
}
