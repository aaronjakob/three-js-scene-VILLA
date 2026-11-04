import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

// Procedural textures for the interior (furniture, textiles, stone, art).
// Generated once at start-up from seeded noise; nothing is downloaded.
// Fast path: periodic value-noise tiles (typed arrays) sampled with bilinear
// lookups, so 1-2k textures build in tens of milliseconds.

const cache = new Map();
export function disposeInteriorTextures() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v) for (const t of Object.values(v)) t?.isTexture && t.dispose();
  }
  cache.clear();
}
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export function toTex(c, { srgb = true, wrap = true, aniso = 8, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// --- periodic value-noise fbm tile ------------------------------------------
// returns Float32Array(size*size) roughly in [-1, 1]
export function noiseTile(size, cells, seed, octaves = 4, gain = 0.5, sx = 1, sy = 1) {
  const out = new Float32Array(size * size);
  const rng = mulberry32(seed);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, Math.round(cells * sx * 2 ** o)), cy = Math.max(1, Math.round(cells * sy * 2 ** o));
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rng() * 2 - 1;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cy;
      const iy = Math.floor(fy);
      let ty = fy - iy; ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const y0 = (iy % cy) * cx, y1 = ((iy + 1) % cy) * cx;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cx;
        const ix = Math.floor(fx);
        let tx = fx - ix; tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const x0 = ix % cx, x1 = (ix + 1) % cx;
        const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
        out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// bilinear sample of a periodic tile at pixel coords (x, y)
export function samp(t, size, x, y) {
  x = ((x % size) + size) % size; y = ((y % size) + size) % size;
  const ix = x | 0, iy = y | 0, tx = x - ix, ty = y - iy;
  const x1 = (ix + 1) % size, y1 = (iy + 1) % size;
  const a = t[iy * size + ix], b = t[iy * size + x1], c = t[y1 * size + ix], d = t[y1 * size + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// normal map (tangent space, OpenGL convention) from a periodic height array
export function normalFromHeight(h, w, hh, strength = 2, wrap = true) {
  const c = canvas(w, hh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const xl = wrap ? (x - 1 + w) % w : Math.max(0, x - 1), xr = wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const yu = wrap ? (y - 1 + hh) % hh : Math.max(0, y - 1), yd = wrap ? (y + 1) % hh : Math.min(hh - 1, y + 1);
      const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
      const dy = (h[yd * w + x] - h[yu * w + x]) * strength;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      d[k] = clamp255((-dx / l * 0.5 + 0.5) * 255);
      d[k + 1] = clamp255((dy / l * 0.5 + 0.5) * 255);
      d[k + 2] = clamp255((1 / l * 0.5 + 0.5) * 255);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTex(c, { srgb: false, wrap });
}

function fillPixels(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      fn(x, y, d, k);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayTex(arr, w, h, f, opts = {}) {
  const c = fillPixels(w, h, (x, y, d, k) => { const v = clamp255(f(arr[y * w + x]) * 255); d[k] = d[k + 1] = d[k + 2] = v; });
  return toTex(c, { srgb: false, ...opts });
}

// --- WALNUT: rift-cut veneer, straight grain with streaks and pores -----------
// tile = 0.9 m; grain runs along texture v.
export function walnutTextures() {
  return cached('walnut', () => {
    const S = 1024;
    const warp = noiseTile(S, 3, 11, 4, 0.55, 1, 0.25);
    const streak = noiseTile(S, 6, 12, 4, 0.6, 1, 0.08);
    const fine = noiseTile(S, 48, 13, 2, 0.5, 1, 0.04);
    const fig = noiseTile(S, 4, 14, 3, 0.5, 1, 1);
    const pores = noiseTile(S, 220, 15, 1, 0.5, 1, 0.03);
    const height = new Float32Array(S * S);
    const rough = new Float32Array(S * S);
    const lines = 96; // growth lines per tile (~9 mm)
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const u = x / S;
      const w1 = warp[i];
      const ph = (u + w1 * 0.05 + fine[i] * 0.004) * lines;
      const p = ph - Math.floor(ph);
      const late = smooth(0.55, 0.9, p) * (1 - smooth(0.93, 1.0, p));
      const st = streak[i];
      const po = pores[i] > 0.55 ? (pores[i] - 0.55) * 2.2 : 0;
      let l = 0.92 + st * 0.32 + fig[i] * 0.1 - late * 0.2 - po * 0.25 + fine[i] * 0.05;
      // occasional pale sap streak
      const sap = smooth(0.42, 0.62, st) * 0.18;
      l += sap;
      const r = 98 * l + sap * 40, g = 64 * l + sap * 26, b = 42 * l + sap * 12;
      d[k] = clamp255(r); d[k + 1] = clamp255(g); d[k + 2] = clamp255(b);
      height[i] = -late * 0.35 - po * 0.9 + st * 0.15;
      rough[i] = 0.42 + po * 0.25 + late * 0.05 - st * 0.04;
    });
    return {
      map: toTex(col),
      normalMap: normalFromHeight(height, S, S, 1.6),
      roughnessMap: grayTex(rough, S, S, (v) => v),
    };
  });
}

// --- MARBLE ----------------------------------------------------------------
// Veins are level sets of a domain-warped periodic phase field
// phase = 2pi (a u + b v) + warp, with integer (a, b) so the tile repeats.
function veinField(W, H, sets, warpA, warpB, seedBase) {
  const out = new Float32Array(W * H);
  const S = 256, mask = S - 1;
  const bil = (t, x, y) => {
    const ix = x | 0, iy = y | 0, tx = x - ix, ty = y - iy;
    const x0 = ix & mask, x1 = (ix + 1) & mask, y0 = (iy & mask) * S, y1 = ((iy + 1) & mask) * S;
    const a = t[y0 + x0], b = t[y0 + x1], c = t[y1 + x0], d = t[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  for (let s = 0; s < sets.length; s++) {
    const { a, b, amp, width, D = 0.25, seed, fade = 0.5, ridge = 0 } = sets[s];
    const wa = noiseTile(S, 3, seedBase + seed, 5, 0.55);
    const wb = noiseTile(S, 2, seedBase + seed + 7, 4, 0.5);
    const fd = noiseTile(S, 3, seedBase + seed + 13, 3, 0.5);
    const freq = Math.hypot(a, b);
    const k2 = 2 * Math.PI * freq;
    const iw2 = 1 / (width * width), iw3 = 1 / (width * width * 12.25);
    const ka = 2 * Math.PI * freq * D * warpA * 2.2, kb = 2 * Math.PI * freq * D * warpB * 0.8;
    for (let y = 0; y < H; y++) {
      const v = y / H, sy = v * S;
      for (let x = 0; x < W; x++) {
        const u = x / W, sx = u * S;
        const ph = 2 * Math.PI * (a * u + b * v) + ka * bil(wa, sx, sy) + kb * bil(wb, sx * 2, sy * 2);
        const dist = Math.abs(Math.sin(ph)) / k2;
        const d2 = dist * dist;
        let vv = Math.exp(-d2 * iw2);
        if (ridge) vv = Math.max(vv, Math.exp(-d2 * iw3) * ridge);
        if (vv < 0.004) continue;
        const f = smooth(-fade, 0.6, bil(fd, sx, sy));
        const i = y * W + x;
        const val = vv * amp * f;
        if (val > out[i]) out[i] = val;
      }
    }
  }
  return out;
}

export function marbleTextures(kind) {
  return cached('marble-' + kind, () => {
    if (kind === 'nero') {
      const W = 1024, H = 512;
      const veins = veinField(W, H, [
        { a: 1, b: 2, amp: 1.0, width: 0.003, D: 0.32, seed: 1, fade: 0.25, ridge: 0.35 },
        { a: 2, b: -1, amp: 0.8, width: 0.0018, D: 0.3, seed: 2, fade: 0.05 },
        { a: 4, b: 3, amp: 0.45, width: 0.0011, D: 0.26, seed: 3, fade: -0.25 },
        { a: 6, b: -5, amp: 0.3, width: 0.0008, D: 0.22, seed: 4, fade: -0.4 },
      ], 1.0, 1.0, 400);
      const cloud = noiseTile(512, 4, 410, 5, 0.55);
      const cloud2 = noiseTile(512, 12, 411, 3, 0.5);
      const col = fillPixels(W, H, (x, y, d, k) => {
        const u = (x / W) * 512, v = (y / H) * 512;
        const c = samp(cloud, 512, u, v), c2 = samp(cloud2, 512, u, v);
        const ve = veins[y * W + x];
        const l = 0.85 + c * 0.35 + c2 * 0.12;
        // warm brown-black ground with grey clouds, white + faint gold veins
        let r = 21 * l + 10 * Math.max(0, c), g = 20 * l + 6 * Math.max(0, c), b = 21 * l;
        const gold = smooth(0.2, 0.6, c2 + 0.3) * 0.35;
        r += ve * (215 - gold * 20); g += ve * (206 - gold * 40); b += ve * (194 - gold * 80);
        d[k] = clamp255(r); d[k + 1] = clamp255(g); d[k + 2] = clamp255(b);
      });
      return { map: toTex(col) };
    }
    // calacatta: warm white, bold grey-taupe veins with soft halos
    const W = 1024, H = 1024;
    const veins = veinField(W, H, [
      { a: 1, b: 1, amp: 1.0, width: 0.0045, D: 0.34, seed: 1, fade: 0.2, ridge: 0.45 },
      { a: 2, b: -1, amp: 0.75, width: 0.0022, D: 0.3, seed: 2, fade: 0.0, ridge: 0.25 },
      { a: 4, b: 3, amp: 0.45, width: 0.0012, D: 0.24, seed: 3, fade: -0.25 },
    ], 1.0, 1.0, 500);
    const cloud = noiseTile(512, 3, 510, 5, 0.55);
    const col = fillPixels(W, H, (x, y, d, k) => {
      const u = (x / W) * 512, v = (y / H) * 512;
      const c = samp(cloud, 512, u, v);
      const ve = veins[y * W + x];
      const l = 0.965 + c * 0.03;
      const warm = sat(c * 2 + 0.3);
      let r = 240 * l, g = 236 * l, b = 228 * l;
      r -= ve * (120 - warm * 25); g -= ve * (122 - warm * 18); b -= ve * (126 - warm * 4);
      d[k] = clamp255(r); d[k + 1] = clamp255(g); d[k + 2] = clamp255(b);
    });
    return { map: toTex(col) };
  });
}

// --- TEXTILES -----------------------------------------------------------------
// Neutral (near-white) colour maps: hue comes from material.color.

// Boucle: dense looped yarn nubs + lumpy clusters. tile = 0.25 m
export function boucleTextures() {
  return cached('boucle', () => {
    const S = 512;
    const loops = noiseTile(S, 96, 61, 2, 0.45);
    const loops2 = noiseTile(S, 150, 64, 1, 0.5);
    const clus = noiseTile(S, 14, 65, 3, 0.5);
    const mott = noiseTile(S, 6, 62, 3, 0.5);
    const fleck = noiseTile(S, 90, 63, 1, 0.5);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) {
      const l1 = 1 - Math.abs(loops[i]) * 2.2, l2 = 1 - Math.abs(loops2[i]) * 2.4;
      h[i] = Math.max(0, l1) * 0.55 + Math.max(0, l2) * 0.35 + clus[i] * 0.35;
    }
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const hv = Math.min(1, Math.max(0, h[i]));
      const l = 0.8 + hv * 0.24 + mott[i] * 0.04;
      const f = fleck[i] > 0.62 ? 0.12 : 0;
      d[k] = clamp255(250 * l - f * 40); d[k + 1] = clamp255(248 * l - f * 46); d[k + 2] = clamp255(244 * l - f * 56);
    });
    return { map: toTex(col), normalMap: normalFromHeight(h, S, S, 2.6) };
  });
}

// Plain-weave linen with slub yarns. tile = 0.1 m (~40 threads)
export function linenTextures() {
  return cached('linen', () => {
    const S = 512;
    const slubU = noiseTile(S, 24, 71, 3, 0.6, 1, 0.05);
    const slubV = noiseTile(S, 24, 72, 3, 0.6, 0.05, 1);
    const mott = noiseTile(S, 5, 73, 3, 0.5);
    const h = new Float32Array(S * S);
    const threads = 64;
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const tu = (x / S) * threads, tv = (y / S) * threads;
      const iu = Math.floor(tu), iv = Math.floor(tv);
      const fu = tu - iu, fv = tv - iv;
      const warpThread = Math.sin(Math.PI * fu) ** 0.7 * (1 + slubU[i] * 0.6);
      const weftThread = Math.sin(Math.PI * fv) ** 0.7 * (1 + slubV[i] * 0.6);
      const over = (iu + iv) % 2 === 0;
      const hv = over ? Math.max(warpThread, weftThread * 0.7) : Math.max(weftThread, warpThread * 0.7);
      h[i] = hv * 0.6 + (slubU[i] + slubV[i]) * 0.2;
      const l = 0.84 + hv * 0.12 + (slubU[i] - slubV[i]) * 0.05 + mott[i] * 0.03;
      d[k] = clamp255(246 * l); d[k + 1] = clamp255(244 * l); d[k + 2] = clamp255(240 * l);
    });
    return { map: toTex(col), normalMap: normalFromHeight(h, S, S, 1.4) };
  });
}

// Herringbone twill wool (throw). tile = 0.24 m
export function herringboneTextures() {
  return cached('herringbone', () => {
    const S = 512;
    const n = noiseTile(S, 30, 81, 2, 0.5);
    const mott = noiseTile(S, 4, 82, 3, 0.5);
    const h = new Float32Array(S * S);
    const cols = 8; // zigzag columns per tile (3 cm)
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const cu = (x / S) * cols;
      const ci = Math.floor(cu), cf = cu - ci;
      const dir = ci % 2 ? 1 : -1;
      const diag = (y / S) * 48 + dir * cf * 6;
      const t = diag - Math.floor(diag);
      const rib = Math.sin(Math.PI * t) ** 0.8;
      const edge = smooth(0.0, 0.06, cf) * smooth(1.0, 0.94, cf);
      const hv = rib * edge + n[i] * 0.2;
      h[i] = hv;
      const tone = ci % 2 ? 0.95 : 1.0;
      const l = (0.74 + hv * 0.26 + mott[i] * 0.05) * tone;
      d[k] = clamp255(246 * l); d[k + 1] = clamp255(242 * l); d[k + 2] = clamp255(236 * l);
    });
    return { map: toTex(col), normalMap: normalFromHeight(h, S, S, 2.0) };
  });
}

// Pebble-grain leather (normal only). tile = 0.12 m
export function leatherTextures() {
  return cached('leather', () => {
    const S = 512;
    const a = noiseTile(S, 40, 91, 3, 0.55);
    const b = noiseTile(S, 7, 92, 3, 0.5);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) h[i] = -Math.abs(a[i]) * 0.9 + b[i] * 0.1;
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const l = 0.9 + b[i] * 0.12 + a[i] * 0.04;
      d[k] = clamp255(255 * l); d[k + 1] = clamp255(252 * l); d[k + 2] = clamp255(248 * l);
    });
    return { map: toTex(col), normalMap: normalFromHeight(h, S, S, 2.4) };
  });
}

// --- RUG: hand-knotted wool field with a fine irregular lattice + border -------
// single image over the whole rug (no repeat); pile normal tiles separately.
export function rugTextures(kind = 'living') {
  return cached('rug-' + kind, () => {
    const W = 1024, H = 768;
    const rng = mulberry32(kind === 'living' ? 101 : 102);
    const abrash = noiseTile(512, 3, 103, 4, 0.6, 1, 0.3);
    const mott = noiseTile(512, 24, 104, 3, 0.5);
    const wob = noiseTile(512, 6, 105, 3, 0.5);
    const base = kind === 'living' ? [178, 170, 156] : [196, 186, 170];
    const line = kind === 'living' ? [132, 122, 108] : [150, 138, 120];
    const border = kind === 'living' ? [112, 102, 90] : [160, 146, 128];
    const bw = 0.055, bi = 0.075;
    const cell = kind === 'living' ? 0.0625 : 0.09;
    const col = fillPixels(W, H, (x, y, d, k) => {
      const u = x / W, v = y / H;
      const su = u * 512, sv = v * 512;
      const ab = samp(abrash, 512, su, sv), mo = samp(mott, 512, su * 3, sv * 3), wb = samp(wob, 512, su, sv);
      const e = Math.min(u, 1 - u, (v) * (H / W) / (H / W), 1 - v);
      const ev = Math.min(u * W, (1 - u) * W, v * H, (1 - v) * H) / W;
      void e;
      let c = base;
      let l = 1 + ab * 0.05 + mo * 0.035;
      // lattice: rotated grid lines with hand-drawn wobble
      const gu = (u * W + v * H * 0.0) / W, gv = (v * H) / W;
      const p1 = (gu + gv) / cell + wb * 0.18, p2 = (gu - gv) / cell + wb * 0.18;
      const f1 = Math.abs(p1 - Math.round(p1)), f2 = Math.abs(p2 - Math.round(p2));
      const lw = 0.045;
      const lat = Math.max(smooth(lw, lw * 0.4, f1), smooth(lw, lw * 0.4, f2)) * 0.8;
      let r = c[0], g = c[1], b = c[2];
      if (ev > bi + 0.006) {
        r += (line[0] - r) * lat; g += (line[1] - g) * lat; b += (line[2] - b) * lat;
      } else if (ev > bw && ev < bi) {
        // plain band between border and field
      } else if (ev <= bw) {
        const t = ev < 0.008 ? 0.5 : 1;
        r = border[0] * t + base[0] * (1 - t); g = border[1] * t + base[1] * (1 - t); b = border[2] * t + base[2] * (1 - t);
        const fine = Math.abs(ev - bw * 0.5) < 0.0025 ? 0.85 : 1;
        l *= fine;
      }
      if (Math.abs(ev - bi) < 0.0018) l *= 0.82;
      d[k] = clamp255(r * l); d[k + 1] = clamp255(g * l); d[k + 2] = clamp255(b * l);
    });
    void rng;
    return { map: toTex(col, { wrap: false }) };
  });
}
// wool pile: tiny loops, tile = 0.04 m
export function pileNormal() {
  return cached('pile', () => {
    const S = 256;
    const a = noiseTile(S, 22, 111, 2, 0.5);
    const b = noiseTile(S, 64, 112, 1, 0.5);
    const h = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) h[i] = a[i] * 0.6 + b[i] * 0.4;
    return normalFromHeight(h, S, S, 2.5);
  });
}

// --- BARK (olive): fissured grey-brown, tile = 0.3 m (u around, v along) -------
export function barkTextures() {
  return cached('bark', () => {
    const S = 512;
    const f = noiseTile(S, 6, 121, 4, 0.55, 1, 0.3);
    const g = noiseTile(S, 20, 122, 3, 0.5);
    const lich = noiseTile(S, 5, 123, 3, 0.5);
    const h = new Float32Array(S * S);
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      const fiss = 1 - Math.abs(f[i]) * 3.2;
      const crack = smooth(0.55, 0.95, fiss);
      h[i] = -crack * 0.9 + g[i] * 0.25;
      const l = 0.95 - crack * 0.45 + g[i] * 0.12;
      const li = smooth(0.25, 0.6, lich[i]) * 0.5;
      const r = 118 * l + li * 28, gg = 108 * l + li * 32, b = 94 * l + li * 22;
      d[k] = clamp255(r); d[k + 1] = clamp255(gg); d[k + 2] = clamp255(b);
    });
    return { map: toTex(col), normalMap: normalFromHeight(h, S, S, 3.0) };
  });
}

// --- generic tonal speckle for ceramics / plaster / stone objects ----------------
export function speckleTexture() {
  return cached('speckle', () => {
    const S = 512;
    const m = noiseTile(S, 5, 131, 4, 0.55);
    const sp = noiseTile(S, 160, 132, 1, 0.5);
    const sp2 = noiseTile(S, 90, 133, 1, 0.5);
    const col = fillPixels(S, S, (x, y, d, k) => {
      const i = y * S + x;
      let l = 0.95 + m[i] * 0.06;
      if (sp[i] > 0.72) l -= (sp[i] - 0.72) * 2.2;
      if (sp2[i] > 0.8) l -= 0.12;
      d[k] = clamp255(255 * l); d[k + 1] = clamp255(252 * l); d[k + 2] = clamp255(247 * l);
    });
    return toTex(col);
  });
}

// --- radial pool of light (additive decal) -------------------------------------
export function poolTexture() {
  return cached('pool', () => {
    const S = 256;
    const c = fillPixels(S, S, (x, y, d, k) => {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(u, v);
      const f = Math.max(0, 1 - r) ** 2.2 * (1 / (1 + 6 * r * r));
      const val = clamp255(f * 255);
      d[k] = d[k + 1] = d[k + 2] = val;
    });
    return toTex(c, { srgb: false, wrap: false });
  });
}
// light wash on a wall below a picture light / sconce (cone fading downward)
export function washTexture() {
  return cached('wash', () => {
    const W = 256, H = 256;
    const c = fillPixels(W, H, (x, y, d, k) => {
      const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H;
      const spread = 0.25 + v * 0.75;
      const lat = Math.max(0, 1 - Math.abs(u) / spread) ** 1.6;
      const fall = Math.exp(-v * 2.4) * smooth(0.0, 0.06, v);
      const val = clamp255(lat * fall * 255);
      d[k] = d[k + 1] = d[k + 2] = val;
    });
    return toTex(c, { srgb: false, wrap: false });
  });
}

// --- lamp shade: linen weave with an inner glow gradient (emissive map) ---------
export function shadeTexture() {
  return cached('shade', () => {
    const W = 256, H = 256;
    const n = noiseTile(W, 32, 141, 2, 0.5);
    const c = fillPixels(W, H, (x, y, d, k) => {
      const v = y / H; // 0 top .. 1 bottom (canvas)
      const weave = 0.92 + 0.08 * Math.sin((x / W) * Math.PI * 2 * 64) * Math.sin((y / H) * Math.PI * 2 * 64) + n[y * W + x] * 0.05;
      const glow = 0.55 + 0.45 * Math.exp(-((v - 0.62) ** 2) / 0.08);
      const l = glow * weave;
      d[k] = clamp255(255 * l); d[k + 1] = clamp255(255 * l); d[k + 2] = clamp255(255 * l);
    });
    return toTex(c, { srgb: false });
  });
}

// --- book page edges (fine horizontal lines) ----------------------------------
export function pagesTexture() {
  return cached('pages', () => {
    const S = 128;
    const n = noiseTile(S, 64, 151, 1, 0.5, 0.05, 1);
    const c = fillPixels(S, S, (x, y, d, k) => {
      const l = 0.9 + n[y * S + x] * 0.08;
      d[k] = clamp255(238 * l); d[k + 1] = clamp255(230 * l); d[k + 2] = clamp255(212 * l);
    });
    return toTex(c);
  });
}

// --- monitors: dark analytics / trading dashboards --------------------------------
export function screenTexture(seed) {
  return cached('screen-' + seed, () => {
    const w = 1024, h = 576;
    const rng = mulberry32(700 + seed);
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d1219'); bg.addColorStop(1, '#090c11');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#141b25';
    ctx.fillRect(0, 0, w, 26);
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 26, 44, h - 26);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = i === 2 ? '#3d7bd9' : '#2a3442'; ctx.fillRect(12, 46 + i * 34, 20, 20); }
    const accent = ['#4fb0ff', '#62d39b', '#e6c26a', '#9aa8ff', '#ff8a6a'];
    const panel = (x, y, pw, ph, kind) => {
      ctx.fillStyle = '#111823';
      ctx.fillRect(x, y, pw, ph);
      ctx.strokeStyle = 'rgba(90,120,150,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
      ctx.fillStyle = 'rgba(180,200,220,0.55)';
      ctx.fillRect(x + 10, y + 10, 70 + rng() * 60, 6);
      if (kind === 'candles') {
        let p = y + ph * 0.5;
        const n = Math.floor(pw / 9);
        for (let i = 0; i < n; i++) {
          const o = p, cl = Math.max(y + 30, Math.min(y + ph - 12, o + (rng() - 0.5) * 22));
          const hi = Math.min(o, cl) - rng() * 10, lo = Math.max(o, cl) + rng() * 10;
          const up = cl < o;
          ctx.strokeStyle = up ? '#4cc38a' : '#e0645a';
          ctx.beginPath(); ctx.moveTo(x + 8 + i * 9 + 3, hi); ctx.lineTo(x + 8 + i * 9 + 3, lo); ctx.stroke();
          ctx.fillStyle = up ? '#4cc38a' : '#e0645a';
          ctx.fillRect(x + 8 + i * 9, Math.min(o, cl), 6, Math.max(1.5, Math.abs(cl - o)));
          p = cl;
        }
      } else if (kind === 'line') {
        const colr = accent[(rng() * accent.length) | 0];
        ctx.beginPath();
        let yy = y + ph * (0.4 + rng() * 0.3);
        ctx.moveTo(x + 6, yy);
        for (let xx = 6; xx < pw - 6; xx += 4) { yy += (rng() - 0.48) * 9; yy = Math.max(y + 26, Math.min(y + ph - 8, yy)); ctx.lineTo(x + xx, yy); }
        ctx.strokeStyle = colr; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.lineTo(x + pw - 6, y + ph - 4); ctx.lineTo(x + 6, y + ph - 4); ctx.closePath();
        ctx.fillStyle = colr.replace(')', '').replace('#', '') && 'rgba(80,140,220,0.10)';
        ctx.fill();
      } else if (kind === 'table') {
        for (let r = 0; r < Math.floor((ph - 30) / 15); r++) {
          const yy = y + 28 + r * 15;
          ctx.fillStyle = r % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0)';
          ctx.fillRect(x + 4, yy - 2, pw - 8, 14);
          for (let cI = 0; cI < 4; cI++) {
            ctx.fillStyle = cI === 3 ? (rng() < 0.5 ? '#4cc38a' : '#e0645a') : 'rgba(190,205,220,0.6)';
            ctx.fillRect(x + 10 + cI * (pw - 20) / 4, yy + 3, 18 + rng() * 26, 4);
          }
        }
      } else {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const bh = (0.15 + rng() * 0.7) * (ph - 40);
          ctx.fillStyle = i % 4 === 0 ? '#3d7bd9' : 'rgba(120,150,190,0.5)';
          ctx.fillRect(x + 12 + i * (pw - 24) / n, y + ph - 8 - bh, (pw - 24) / n - 4, bh);
        }
      }
    };
    const layouts = [
      [[52, 34, 600, 330, 'candles'], [660, 34, 356, 330, 'table'], [52, 372, 470, 196, 'line'], [530, 372, 486, 196, 'bars']],
      [[52, 34, 480, 260, 'line'], [540, 34, 476, 260, 'line'], [52, 302, 300, 266, 'table'], [360, 302, 656, 266, 'candles']],
      [[52, 34, 964, 300, 'line'], [52, 342, 320, 226, 'bars'], [380, 342, 320, 226, 'table'], [708, 342, 308, 226, 'line']],
    ];
    for (const L of layouts[(seed - 1) % 3]) panel(...L);
    const t = toTex(c, { wrap: false });
    return t;
  });
}

// --- abstract paintings ------------------------------------------------------------
// Painted with layered translucent brush dabs on a primed canvas ground; the top
// of each canvas carries a soft warm wash from its picture light.
export function paintingTexture(style, seed = 1) {
  return cached(`art-${style}-${seed}`, () => {
    const W = style === 'wide' || style === 'horizon' ? 1024 : 768;
    const H = style === 'wide' || style === 'horizon' ? 640 : 1024;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const rng = mulberry32(900 + seed * 17);
    const R = () => rng();
    const dab = (x, y, r, col, a) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.35 + R() * 0.5), R() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    };
    const stroke = (pts, w, col, a, jitter = 0.3) => {
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let pass = 0; pass < 4; pass++) {
        ctx.lineWidth = w * (0.5 + R() * 0.6);
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const jx = (R() - 0.5) * w * jitter, jy = (R() - 0.5) * w * jitter;
          if (i === 0) ctx.moveTo(x + jx, y + jy); else ctx.lineTo(x + jx, y + jy);
        });
        ctx.stroke();
      }
    };
    const field = (x0, y0, x1, y1, col, a, n = 900, size = 40) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0);
        dab(x, y, size * (0.4 + R()), col, a * (0.5 + R() * 0.5));
      }
    };
    // primed ground
    const grounds = { field: '#d9cfbf', ink: '#ece6da', relief: '#e9e4da', organic: '#e6dccb', horizon: '#cfd2cf', wide: '#d6cbb8' };
    ctx.fillStyle = grounds[style] ?? '#e2d9c8';
    ctx.fillRect(0, 0, W, H);
    field(0, 0, W, H, '#f2ece2', 0.08, 600, 60);
    if (style === 'field') {
      // stacked colour fields, soft brushy edges (ochre / rust / umber)
      const bands = [[0.06, 0.38, '#b0703f'], [0.42, 0.62, '#7a3e2a'], [0.66, 0.94, '#c99a5b']];
      for (const [a, b, colr] of bands) {
        const y0 = a * H, y1 = b * H;
        field(W * 0.08, y0, W * 0.92, y1, colr, 0.22, 1600, 34);
        field(W * 0.1, y0 + 8, W * 0.9, y1 - 8, colr, 0.3, 800, 26);
      }
      field(W * 0.08, H * 0.05, W * 0.92, H * 0.95, '#3a2418', 0.03, 300, 50);
    } else if (style === 'ink') {
      // gestural charcoal strokes on warm paper white
      for (let s = 0; s < 3; s++) {
        const pts = [];
        let x = W * (0.2 + R() * 0.3), y = H * (0.15 + s * 0.25);
        for (let i = 0; i < 9; i++) { pts.push([x, y]); x += (R() - 0.3) * W * 0.14; y += (R() - 0.2) * H * 0.08; }
        stroke(pts, 46 - s * 10, '#1d1b19', 0.55);
        stroke(pts, 20, '#2b2724', 0.35, 0.8);
      }
      field(W * 0.55, H * 0.55, W * 0.85, H * 0.8, '#9c5a36', 0.12, 200, 30);
    } else if (style === 'relief') {
      // near-white impasto with a single charcoal arc
      field(0, 0, W, H, '#f4f0e8', 0.18, 1800, 30);
      field(0, 0, W, H, '#d8d0c2', 0.06, 900, 40);
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#2a2826';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(W * 0.42, H * 0.62, W * 0.34, Math.PI * 1.05, Math.PI * 1.85);
      ctx.stroke();
    } else if (style === 'organic') {
      // cut-paper organic shapes: terracotta, sage, sand, ink
      const shapes = [['#b5653f', 0.3, 0.35, 0.22], ['#7f8b6e', 0.62, 0.55, 0.2], ['#d2b48a', 0.4, 0.75, 0.16], ['#2b2a28', 0.7, 0.25, 0.09]];
      for (const [colr, cx, cy, r] of shapes) {
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = colr;
        ctx.beginPath();
        const n = 9;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * W * (0.75 + R() * 0.5);
          const x = cx * W + Math.cos(a) * rr, y = cy * H + Math.sin(a) * rr * 1.1;
          if (i === 0) ctx.moveTo(x, y); else ctx.quadraticCurveTo(cx * W + Math.cos(a - 0.35) * rr * 1.25, cy * H + Math.sin(a - 0.35) * rr * 1.3, x, y);
        }
        ctx.fill();
        field((cx - r) * W, (cy - r) * H, (cx + r) * W, (cy + r) * H, '#ffffff', 0.03, 120, 20);
      }
    } else if (style === 'horizon') {
      // soft sea / sky bands with a bright horizon seam
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#a9b6bf'); grad.addColorStop(0.45, '#d9dcd6'); grad.addColorStop(0.5, '#f1ede2');
      grad.addColorStop(0.53, '#7f939c'); grad.addColorStop(1, '#4b5d66');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      field(0, 0, W, H * 0.48, '#c7cdcf', 0.08, 900, 40);
      field(0, H * 0.53, W, H, '#3d4f58', 0.08, 900, 40);
      for (let i = 0; i < 60; i++) { const y = H * (0.55 + R() * 0.42); stroke([[R() * W * 0.3, y], [W * (0.5 + R() * 0.5), y + (R() - 0.5) * 6]], 3, '#9fb2b8', 0.18); }
    } else {
      // wide: warm abstract landscape bands
      const bands = [[0, 0.3, '#d8c6a6'], [0.3, 0.55, '#a7835e'], [0.55, 0.62, '#5b4636'], [0.62, 1, '#c2ab88']];
      for (const [a, b, colr] of bands) field(0, a * H, W, b * H, colr, 0.3, 1500, 36);
      stroke([[W * 0.1, H * 0.58], [W * 0.45, H * 0.52], [W * 0.9, H * 0.6]], 10, '#2c2420', 0.5);
    }
    ctx.globalAlpha = 1;
    // canvas weave + picture-light wash (warm at the top, falling off)
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const wv = noiseTile(256, 128, 950 + seed, 1, 0.5);
    for (let y = 0; y < H; y++) {
      const wash = 0.86 + 0.26 * Math.exp(-((y / H) * 3.2));
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const lat = 1 - 0.1 * ((x / W - 0.5) * 2) ** 2;
        const weave = 1 + wv[(y & 255) * 256 + (x & 255)] * 0.035 + ((x + y) % 2 ? 0.01 : -0.01);
        const f = wash * lat * weave;
        d[k] = clamp255(d[k] * f * 1.02); d[k + 1] = clamp255(d[k + 1] * f); d[k + 2] = clamp255(d[k + 2] * f * 0.95);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c, { wrap: false });
  });
}
