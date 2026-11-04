import * as THREE from 'three';
import { Simplex, mulberry32 } from '../../core/noise.js';
import { paintAtlas, ATLAS_W, ATLAS_H, CELL } from './atlas.js';

// GPU textures for the flora: the foliage atlas (albedo + leaf data) with a
// hand-built mip chain, and tileable bark sets (albedo + normal).
//
// Mip chain: colour and leaf data are averaged with alpha weights (no dark
// fringes) and alpha is rescaled per cell so that the fraction of texels that
// pass the alpha test stays the same at every level ("coverage-preserving
// mipmaps"): distant crowns keep their density instead of thinning to sticks.

export const ALPHA_TEST = 0.5;
let cached = null;

export function floraAtlas() {
  if (cached) return cached;
  const P = paintAtlas();
  const W = ATLAS_W, H = ATLAS_H;
  const col = P.col, dat = P.dat;
  // fill transparent texels with the cell's mean leaf colour / flat normal
  const cellsX = W / CELL, cellsY = H / CELL;
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let r = 0, g = 0, b = 0, gl = 0, tr = 0, n = 0;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const k = (y * W + x) * 4;
          const a = col[k + 3];
          if (a > 128) { r += col[k]; g += col[k + 1]; b += col[k + 2]; gl += dat[k + 2]; tr += dat[k + 3]; n++; }
        }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n; gl /= n; tr /= n;
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          const k = (y * W + x) * 4;
          if (col[k + 3] === 0) {
            col[k] = r; col[k + 1] = g; col[k + 2] = b;
            dat[k] = 128; dat[k + 1] = 128; dat[k + 2] = gl; dat[k + 3] = tr;
          }
        }
      }
    }
  }
  const mipsC = [{ data: col, width: W, height: H }];
  const mipsD = [{ data: dat, width: W, height: H }];
  // reference coverage per cell at level 0
  const cov0 = cellCoverage(col, W, H, CELL);
  let w = W, h = H, cell = CELL;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const pc = mipsC[mipsC.length - 1].data, pd = mipsD[mipsD.length - 1].data;
    const oc = new Uint8ClampedArray(nw * nh * 4), od = new Uint8ClampedArray(nw * nh * 4);
    const sx = w > 1 ? 2 : 1, sy = h > 1 ? 2 : 1;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let aw = 0, r = 0, g = 0, b = 0, nx = 0, ny = 0, gl = 0, tr = 0, at = 0;
        let r0 = 0, g0 = 0, b0 = 0, d0 = 0, d1 = 0, d2 = 0, d3 = 0;
        for (let j = 0; j < sy; j++) {
          for (let i = 0; i < sx; i++) {
            const k = ((y * sy + j) * w + (x * sx + i)) * 4;
            const a = pc[k + 3] + 1;
            aw += a; at += pc[k + 3];
            r += pc[k] * a; g += pc[k + 1] * a; b += pc[k + 2] * a;
            nx += pd[k] * a; ny += pd[k + 1] * a; gl += pd[k + 2] * a; tr += pd[k + 3] * a;
            r0 += pc[k]; g0 += pc[k + 1]; b0 += pc[k + 2];
            d0 += pd[k]; d1 += pd[k + 1]; d2 += pd[k + 2]; d3 += pd[k + 3];
          }
        }
        const q = (y * nw + x) * 4;
        const inv = 1 / aw;
        oc[q] = r * inv; oc[q + 1] = g * inv; oc[q + 2] = b * inv;
        oc[q + 3] = at / (sx * sy);
        od[q] = nx * inv; od[q + 1] = ny * inv; od[q + 2] = gl * inv; od[q + 3] = tr * inv;
        void r0; void g0; void b0; void d0; void d1; void d2; void d3;
      }
    }
    w = nw; h = nh; cell = Math.max(1, cell >> 1);
    // coverage-preserving alpha rescale, per cell
    if (cell >= 2) preserveCoverage(oc, w, h, cell, cov0);
    mipsC.push({ data: oc, width: w, height: h });
    mipsD.push({ data: od, width: w, height: h });
  }
  const mk = (mips, srgb) => {
    const t = new THREE.DataTexture(mips[0].data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = mips;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  cached = { map: mk(mipsC, true), data: mk(mipsD, false) };
  return cached;
}

function cellCoverage(col, W, H, cell) {
  const cx = W / cell, cy = H / cell;
  const out = new Float32Array(cx * cy);
  const thr = ALPHA_TEST * 255;
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / cell) * cx;
    for (let x = 0; x < W; x++) {
      if (col[(y * W + x) * 4 + 3] >= thr) out[row + Math.floor(x / cell)]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= cell * cell;
  return out;
}

function preserveCoverage(c, W, H, cell, cov0) {
  const cx = Math.max(1, W / cell), cy = Math.max(1, H / cell);
  const thr = ALPHA_TEST * 255;
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < cy; gy++) {
    for (let gx = 0; gx < cx; gx++) {
      const target = cov0[gy * cx + gx];
      if (!(target > 0)) continue;
      hist.fill(0);
      for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) hist[c[(y * W + x) * 4 + 3]]++;
      const n = cell * cell;
      const coverage = (s) => {
        let k = 0;
        const a0 = Math.ceil(thr / s);
        for (let a = Math.min(255, Math.max(0, a0)); a < 256; a++) k += hist[a];
        return k / n;
      };
      let lo = 0.5, hi = 8;
      for (let it = 0; it < 16; it++) {
        const m = (lo + hi) / 2;
        if (coverage(m) < target) lo = m; else hi = m;
      }
      const s = (lo + hi) / 2;
      if (Math.abs(s - 1) < 0.01) continue;
      for (let y = gy * cell; y < (gy + 1) * cell; y++) {
        for (let x = gx * cell; x < (gx + 1) * cell; x++) {
          const k = (y * W + x) * 4 + 3;
          c[k] = Math.min(255, c[k] * s);
        }
      }
    }
  }
}

// --- bark --------------------------------------------------------------------
// Tileable 256 x 512 bark: plated pine (red-brown plates, dark fissures),
// fissured grey olive, finely checkered dark holm oak.
const barkCache = new Map();
export function barkSet(kind) {
  if (barkCache.has(kind)) return barkCache.get(kind);
  const w = 256, h = 512;
  const height = new Float32Array(w * h);
  const albedo = new Uint8ClampedArray(w * h * 4);
  const s = new Simplex(kind === 'pine' ? 501 : kind === 'olive' ? 502 : 503);
  const rng = mulberry32(kind.length * 977);
  // periodic noise: sample on a torus
  const pn = (u, v, fu, fv, o = 0) => {
    const a = u * Math.PI * 2, b = v * Math.PI * 2;
    return s.noise3(Math.cos(a) * fu / 6.283 + o, Math.sin(a) * fu / 6.283, Math.cos(b) * fv / 6.283 + Math.sin(b) * 0.37 * fv / 6.283 + o * 2);
  };
  // jittered cell sites for plates (wrapped Voronoi)
  const sites = [];
  const gx = kind === 'pine' ? 5 : kind === 'olive' ? 9 : 12;
  const gy = kind === 'pine' ? 6 : kind === 'olive' ? 9 : 22;
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) sites.push([(i + 0.15 + rng() * 0.7) / gx, (j + 0.15 + rng() * 0.7) / gy, rng()]);
  const ay = kind === 'pine' ? 0.8 : 1;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let wu = u + pn(u, v, 3, 5, 1) * 0.04, wv = v + pn(u, v, 2, 7, 3) * 0.03;
      wu -= Math.floor(wu); wv -= Math.floor(wv);
      let d1 = 9, d2 = 9, id = 0;
      const ci = Math.floor(wu * gx), cj = Math.floor(wv * gy);
      for (let oj = -2; oj <= 2; oj++) {
        for (let oi = -2; oi <= 2; oi++) {
          const si = ((ci + oi) % gx + gx) % gx, sj = ((cj + oj) % gy + gy) % gy;
          const [sx, sy, sid] = sites[sj * gx + si];
          let dx = Math.abs(wu - sx); dx = Math.min(dx, 1 - dx);
          let dy = Math.abs(wv - sy); dy = Math.min(dy, 1 - dy);
          const d = Math.hypot(dx * gx, dy * gy * ay);
          if (d < d1) { d2 = d1; d1 = d; id = sid; } else if (d < d2) d2 = d;
        }
      }
      const edge = d2 - d1; // 0 at the fissure
      const fine = pn(u, v, 24, 40, 5) * 0.5 + pn(u, v, 60, 90, 7) * 0.25;
      let ht, r, g, b;
      if (kind === 'pine') {
        const fiss = Math.min(1, edge / 0.22);
        ht = Math.pow(fiss, 0.6) * (0.75 + 0.25 * id) + fine * 0.12;
        const plate = [118 + id * 32, 84 + id * 18, 66 + id * 10];
        const deep = [36, 28, 24];
        const k = Math.pow(fiss, 0.7);
        r = deep[0] + (plate[0] - deep[0]) * k; g = deep[1] + (plate[1] - deep[1]) * k; b = deep[2] + (plate[2] - deep[2]) * k;
        // grey weathered flakes on plate tops
        const flake = Math.min(1, Math.max(0, pn(u, v, 10, 14, 9) + 0.25) * 1.3);
        r = r * (1 - flake * 0.55) + 118 * flake * 0.55; g = g * (1 - flake * 0.55) + 112 * flake * 0.55; b = b * (1 - flake * 0.55) + 104 * flake * 0.55;
      } else if (kind === 'olive') {
        // twisted longitudinal fibres + cracks
        const fib = Math.abs(Math.sin((u * 18 + pn(u, v, 4, 3, 2) * 2.2 + v * 1.5) * Math.PI));
        const fiss = Math.min(1, edge / 0.3);
        ht = 0.55 * Math.pow(fiss, 0.8) + 0.3 * fib + fine * 0.15;
        const l = 0.55 + 0.45 * ht;
        r = (118 + id * 22) * l; g = (112 + id * 20) * l; b = (98 + id * 16) * l;
        const lichen = Math.max(0, pn(u, v, 6, 8, 11) - 0.25);
        r += lichen * 50; g += lichen * 56; b += lichen * 30;
      } else {
        const fiss = Math.min(1, edge / 0.25);
        ht = Math.pow(fiss, 0.7) + fine * 0.15;
        const l = 0.45 + 0.55 * ht;
        r = (86 + id * 18) * l; g = (78 + id * 14) * l; b = (70 + id * 10) * l;
      }
      height[y * w + x] = ht;
      const k = (y * w + x) * 4;
      const n = (1 + fine * 0.12) * 0.72;
      albedo[k] = r * n; albedo[k + 1] = g * n; albedo[k + 2] = b * n; albedo[k + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(w * h * 4);
  const str = kind === 'pine' ? 3.2 : 2.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hx = height[y * w + ((x + 1) % w)] - height[y * w + ((x - 1 + w) % w)];
      const hy = height[((y + 1) % h) * w + x] - height[((y - 1 + h) % h) * w + x];
      let nx = -hx * str, ny = -hy * str, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const k = (y * w + x) * 4;
      normal[k] = (nx * inv * 0.5 + 0.5) * 255; normal[k + 1] = (ny * inv * 0.5 + 0.5) * 255; normal[k + 2] = (nz * inv * 0.5 + 0.5) * 255; normal[k + 3] = 255;
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const out = { map: mk(albedo, true), normalMap: mk(normal, false) };
  barkCache.set(kind, out);
  return out;
}

export function clearFloraTextures() {
  if (cached) { cached.map.dispose(); cached.data.dispose(); cached = null; }
  for (const v of barkCache.values()) { v.map.dispose(); v.normalMap.dispose(); }
  barkCache.clear();
}
