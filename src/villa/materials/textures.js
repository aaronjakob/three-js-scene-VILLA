import * as THREE from 'three';
import { Simplex, mulberry32 } from '../core/noise.js';

// All surface detail is generated here at start-up (canvas / typed arrays).
// No texture, HDRI or photo is downloaded.

const cache = new Map();
let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = [1, 1], wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// tileable fbm by sampling a torus in 4D -> approximate with 3D domain wrap
function tileNoise(simplex, x, y, period, oct = 4) {
  // periodic via blending four samples (cheap seamless trick)
  const fx = x / period, fy = y / period;
  const a = simplex.fbm2(x, y, oct);
  const b = simplex.fbm2(x - period, y, oct);
  const c = simplex.fbm2(x, y - period, oct);
  const d = simplex.fbm2(x - period, y - period, oct);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function pixelTexture(size, fn, opts = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      const [r, g, b, a = 255] = fn(x, y);
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, tex: toTexture(c, opts) };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// --- Travertine: warm beige, horizontal vein bands, pores ------------------
export function travertine(kind = 'floor') {
  const key = 'trav-' + kind;
  if (cache.has(key)) return cache.get(key);
  const size = 1024;
  const s = new Simplex(kind === 'floor' ? 11 : 12);
  const rng = mulberry32(5);
  const base = kind === 'floor' ? [222, 208, 184] : [214, 202, 182];
  const rough = new Uint8ClampedArray(size * size);
  const { canvas, tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const band = tileNoise(s, u * 3, v * 22, 3, 4); // horizontal banding
    const cloud = tileNoise(s, u * 5 + 40, v * 5 + 9, 5, 5);
    const fine = s.noise2(x * 0.35, y * 1.4) * 0.5 + s.noise2(x * 1.1, y * 3.2) * 0.25;
    let l = 1 + band * 0.06 + cloud * 0.05 + fine * 0.025;
    // pores: short horizontal dark dashes
    const pore = s.noise2(x * 0.08, y * 0.9);
    const isPore = pore > 0.72 ? (pore - 0.72) * 2.4 : 0;
    l -= isPore * 0.35;
    const warm = band * 8;
    rough[y * size + x] = clamp255(110 + isPore * 200 + cloud * 30);
    return [clamp255(base[0] * l + warm), clamp255(base[1] * l + warm * 0.6), clamp255(base[2] * l - warm * 0.3)];
  });
  // tile joints (large format 1.2 x 0.6 m when repeat is ~1 per 2.4 m)
  if (kind === 'floor') {
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(120,105,85,0.35)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * size / 2); ctx.lineTo(size, i * size / 2); ctx.stroke();
    }
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i <= 2; i++) {
        const off = j % 2 ? size / 4 : 0;
        ctx.beginPath(); ctx.moveTo((i * size / 2 + off) % size, j * size / 2); ctx.lineTo((i * size / 2 + off) % size, (j + 1) * size / 2); ctx.stroke();
      }
    }
    tex.needsUpdate = true;
  }
  const rc = makeCanvas(size);
  const rctx = rc.getContext('2d');
  const rimg = rctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rough[i];
    rimg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);
  const roughTex = toTexture(rc, { srgb: false });
  void rng;
  const out = { map: tex, roughnessMap: roughTex };
  cache.set(key, out);
  return out;
}

// --- Light architectural concrete / limestone render for slabs -------------
export function slabStone() {
  if (cache.has('slab')) return cache.get('slab');
  const size = 512;
  const s = new Simplex(21);
  const { tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const n = tileNoise(s, u * 4, v * 4, 4, 5) * 0.05 + tileNoise(s, u * 16, v * 16, 16, 3) * 0.025;
    const streak = tileNoise(s, u * 2, v * 30, 2, 3) * 0.02;
    const l = 1 + n + streak;
    return [clamp255(236 * l), clamp255(231 * l), clamp255(222 * l)];
  });
  const out = { map: tex };
  cache.set('slab', out);
  return out;
}

// --- Walnut: straight grain with cathedral figure --------------------------
export function walnut(variant = 'panel') {
  const key = 'walnut-' + variant;
  if (cache.has(key)) return cache.get(key);
  const size = 1024;
  const s = new Simplex(variant === 'panel' ? 31 : 32);
  const { tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const warp = tileNoise(s, u * 3, v * 1.2, 3, 3) * 0.06;
    const g = Math.sin((u + warp) * Math.PI * 2 * 38 + tileNoise(s, u * 6, v * 2, 6, 2) * 3);
    const grain = Math.pow(Math.abs(g), 0.6);
    const fine = s.noise2(x * 1.6, y * 0.05) * 0.5 + 0.5;
    const fig = tileNoise(s, u * 2 + 9, v * 2, 2, 4);
    let l = 0.78 + grain * 0.16 + fine * 0.1 + fig * 0.12;
    const r = 92 * l, gg = 60 * l, b = 40 * l;
    return [clamp255(r), clamp255(gg), clamp255(b)];
  });
  const out = { map: tex };
  cache.set(key, out);
  return out;
}

// --- Marble (dark nero / light calacatta) ----------------------------------
export function marble(kind = 'dark') {
  const key = 'marble-' + kind;
  if (cache.has(key)) return cache.get(key);
  const size = 1024;
  const s = new Simplex(kind === 'dark' ? 41 : 42);
  const { tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const w1 = tileNoise(s, u * 3, v * 3, 3, 5);
    const w2 = tileNoise(s, u * 7 + 3, v * 7, 7, 4);
    const vein = Math.abs(Math.sin((u * 2.0 + v * 1.3 + w1 * 1.8) * Math.PI * 3));
    const thin = Math.pow(1 - vein, 18);
    const vein2 = Math.pow(1 - Math.abs(Math.sin((u * 3.1 - v * 2.2 + w2 * 2.4) * Math.PI * 5)), 30);
    if (kind === 'dark') {
      const l = 0.75 + w2 * 0.15;
      const veinC = thin * 0.9 + vein2 * 0.5;
      return [clamp255(26 * l + 190 * veinC), clamp255(26 * l + 176 * veinC), clamp255(28 * l + 150 * veinC)];
    }
    const l = 0.96 + w2 * 0.03;
    const veinC = thin * 0.55 + vein2 * 0.3;
    return [clamp255(238 * l - 110 * veinC), clamp255(235 * l - 105 * veinC), clamp255(229 * l - 92 * veinC)];
  });
  const out = { map: tex };
  cache.set(key, out);
  return out;
}

// --- Boucle / linen fabric (map + bump) ------------------------------------
export function fabric(kind = 'boucle') {
  const key = 'fabric-' + kind;
  if (cache.has(key)) return cache.get(key);
  const size = 512;
  const s = new Simplex(kind === 'boucle' ? 51 : 52);
  const bump = new Uint8ClampedArray(size * size);
  const base = kind === 'boucle' ? [232, 224, 208] : kind === 'linen' ? [214, 204, 186] : [196, 184, 164];
  const { tex } = pixelTexture(size, (x, y) => {
    let h;
    if (kind === 'boucle') {
      const loops = s.noise2(x * 0.32, y * 0.32) * 0.6 + s.noise2(x * 0.9, y * 0.9) * 0.4;
      h = 0.5 + 0.5 * loops;
    } else {
      const weave = (Math.sin(x * 1.6) * 0.5 + 0.5) * (Math.sin(y * 1.6 + 1.5) * 0.5 + 0.5);
      h = weave * 0.6 + (s.noise2(x * 0.2, y * 1.5) * 0.5 + 0.5) * 0.4;
    }
    bump[y * size + x] = clamp255(h * 255);
    const l = 0.9 + h * 0.14;
    return [clamp255(base[0] * l), clamp255(base[1] * l), clamp255(base[2] * l)];
  });
  const bc = makeCanvas(size);
  const bctx = bc.getContext('2d');
  const bimg = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = bump[i];
    bimg.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);
  const out = { map: tex, bumpMap: toTexture(bc, { srgb: false }) };
  cache.set(key, out);
  return out;
}

// --- Rug: hand-loomed wool, subtle border ----------------------------------
export function rug() {
  if (cache.has('rug')) return cache.get('rug');
  const size = 1024;
  const s = new Simplex(61);
  const { tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const border = Math.min(u, v, 1 - u, 1 - v);
    const inBorder = border < 0.045 && border > 0.03 ? 1 : 0;
    const n = s.noise2(x * 0.25, y * 0.25) * 0.5 + s.noise2(x * 0.9, y * 0.9) * 0.3 + s.noise2(x * 0.03, y * 0.03) * 0.4;
    const l = 0.92 + n * 0.07 - inBorder * 0.12;
    return [clamp255(178 * l), clamp255(168 * l), clamp255(152 * l)];
  }, { wrap: false });
  const out = { map: tex };
  cache.set('rug', out);
  return out;
}

// --- Rough limestone ashlar for retaining walls ---------------------------
export function stoneWall() {
  if (cache.has('stonewall')) return cache.get('stonewall');
  const size = 1024;
  const s = new Simplex(71);
  const rng = mulberry32(71);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c564e';
  ctx.fillRect(0, 0, size, size);
  // irregular coursed stones
  let y = 0;
  while (y < size) {
    const h = 40 + rng() * 70;
    let x = -rng() * 80;
    while (x < size) {
      const w = 70 + rng() * 170;
      const l = 150 + rng() * 55;
      const tint = rng() * 14;
      ctx.fillStyle = `rgb(${l + tint},${l - 6 + tint * 0.6},${l - 18})`;
      const r = 8 + rng() * 10;
      roundRect(ctx, x + 3, y + 3, w - 6, h - 6, r);
      ctx.fill();
      for (const dx of [-size, size]) { roundRect(ctx, x + 3 + dx, y + 3, w - 6, h - 6, r); ctx.fill(); }
      x += w;
    }
    y += h;
  }
  // weathering noise
  const img = ctx.getImageData(0, 0, size, size);
  const bump = new Uint8ClampedArray(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      const n = s.noise2(i * 0.05, j * 0.05) * 0.08 + s.noise2(i * 0.3, j * 0.3) * 0.05;
      const lum = img.data[k] / 255;
      bump[j * size + i] = clamp255((lum > 0.45 ? 0.75 : 0.15) * 255 + n * 300);
      img.data[k] = clamp255(img.data[k] * (1 + n));
      img.data[k + 1] = clamp255(img.data[k + 1] * (1 + n));
      img.data[k + 2] = clamp255(img.data[k + 2] * (1 + n));
    }
  }
  ctx.putImageData(img, 0, 0);
  const bc = makeCanvas(size);
  const bctx = bc.getContext('2d');
  const bimg = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = bump[i];
    bimg.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);
  const out = { map: toTexture(c), bumpMap: toTexture(bc, { srgb: false }) };
  cache.set('stonewall', out);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Cobble fan (entry court / drive): world-UV planar, ~0.1 m setts ------
export function cobbles() {
  if (cache.has('cobbles')) return cache.get('cobbles');
  const size = 1024;
  const rng = mulberry32(81);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6f675d';
  ctx.fillRect(0, 0, size, size);
  // segmental arcs ("fan" / Bogenpflaster)
  const arcR = size / 2;
  const sett = size / 24;
  for (let row = -2; row < 26; row++) {
    for (let col = -1; col < 3; col++) {
      const cx = col * arcR + (row % 2 ? arcR / 2 : 0);
      const cy = row * sett * 1.0 + arcR;
      for (let rr = arcR; rr > arcR - sett * 1.05; rr -= sett) {
        const n = Math.floor((Math.PI * rr * 0.5) / sett);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI * 0.75 + (i + 0.5) * (Math.PI * 0.5) / n + (rng() - 0.5) * 0.01;
          const x = cx + Math.cos(a) * (rr - sett / 2);
          const y = cy + Math.sin(a) * (rr - sett / 2);
          const l = 150 + rng() * 60;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a + Math.PI / 2);
          ctx.fillStyle = `rgb(${l},${l - 8},${l - 20})`;
          roundRect(ctx, -sett * 0.44, -sett * 0.44, sett * 0.88, sett * 0.88, sett * 0.2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
  const out = { map: toTexture(c) };
  cache.set('cobbles', out);
  return out;
}

// --- Bark ----------------------------------------------------------------
export function bark() {
  if (cache.has('bark')) return cache.get('bark');
  const size = 512;
  const s = new Simplex(91);
  const bump = new Uint8ClampedArray(size * size);
  const { tex } = pixelTexture(size, (x, y) => {
    const u = x / size, v = y / size;
    const fiss = Math.abs(tileNoise(s, u * 10, v * 2.5, 10, 4));
    const ridge = 1 - Math.pow(fiss, 0.5);
    const n = tileNoise(s, u * 30, v * 30, 30, 2);
    bump[y * size + x] = clamp255((1 - ridge) * 230 + n * 30);
    const l = 0.55 + (1 - ridge) * 0.55 + n * 0.1;
    return [clamp255(98 * l), clamp255(88 * l), clamp255(76 * l)];
  });
  const bc = makeCanvas(size);
  const bctx = bc.getContext('2d');
  const bimg = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = bump[i];
    bimg.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(bimg, 0, 0);
  const out = { map: tex, bumpMap: toTexture(bc, { srgb: false }) };
  cache.set('bark', out);
  return out;
}

// --- Foliage atlas: 4 cells (broadleaf, olive, pine needles, small ivy) ----
// Leaves are drawn as real shapes with veins; alpha-tested on cards.
export function foliageAtlas() {
  if (cache.has('foliage')) return cache.get('foliage');
  const size = 1024;
  const half = size / 2;
  const rng = mulberry32(101);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const leaf = (x, y, len, wid, ang, col, vein = true) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid, len * 0.25, wid * 0.9, len * 0.75, 0, len);
    ctx.bezierCurveTo(-wid * 0.9, len * 0.75, -wid, len * 0.25, 0, 0);
    ctx.fillStyle = col;
    ctx.fill();
    if (vein) {
      ctx.strokeStyle = 'rgba(210,225,160,0.35)';
      ctx.lineWidth = Math.max(0.6, wid * 0.08);
      ctx.beginPath(); ctx.moveTo(0, len * 0.04); ctx.lineTo(0, len * 0.92); ctx.stroke();
    }
    ctx.restore();
  };
  const green = (l, sat = 1, warm = 0) => {
    const r = (62 + warm * 34) * l, g = (104 + warm * 12) * l * sat + 50 * (1 - sat), b = 40 * l;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  };
  // cell 0: broadleaf cluster (holm oak / laurel) top-left
  const cluster = (ox, oy, n, lenR, widR, warmR, twig = true) => {
    const cx = ox + half / 2, cy = oy + half / 2;
    if (twig) {
      ctx.strokeStyle = 'rgb(70,58,44)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, oy + half * 0.97); ctx.quadraticCurveTo(cx + 10, cy, cx - 6, oy + half * 0.12); ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const t = rng();
      const px = cx + (rng() - 0.5) * half * 0.62;
      const py = cy + (rng() - 0.5) * half * 0.72;
      const len = lenR[0] + rng() * (lenR[1] - lenR[0]);
      const wid = widR[0] + rng() * (widR[1] - widR[0]);
      const ang = Math.atan2(py - cy, px - cx) - Math.PI / 2 + (rng() - 0.5) * 1.2;
      const l = 0.62 + rng() * 0.6;
      leaf(px, py, len, wid, ang, green(l, 0.9 + t * 0.2, warmR * rng()));
    }
  };
  cluster(0, 0, 120, [34, 58], [10, 18], 0.4);
  // cell 1: olive (narrow silvery leaves) top-right
  {
    const ox = half, oy = 0;
    const cx = ox + half / 2, cy = oy + half / 2;
    ctx.strokeStyle = 'rgb(84,76,62)';
    ctx.lineWidth = 2.5;
    for (let b = 0; b < 5; b++) {
      ctx.beginPath(); ctx.moveTo(cx, oy + half * 0.95);
      ctx.quadraticCurveTo(cx + (rng() - 0.5) * 120, cy, cx + (rng() - 0.5) * 300, oy + half * 0.08 + rng() * 80);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const px = cx + (rng() - 0.5) * half * 0.8;
      const py = cy + (rng() - 0.5) * half * 0.8;
      const l = 0.75 + rng() * 0.5;
      const col = `rgb(${(96 * l) | 0},${(116 * l) | 0},${(80 * l) | 0})`;
      leaf(px, py, 26 + rng() * 18, 4 + rng() * 3, rng() * Math.PI * 2, col, false);
    }
  }
  // cell 2: pine needle tufts bottom-left
  {
    const ox = 0, oy = half;
    for (let t = 0; t < 26; t++) {
      const cx = ox + 40 + rng() * (half - 80);
      const cy = oy + 40 + rng() * (half - 80);
      const n = 40;
      const baseAng = rng() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = baseAng + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.3;
        const len = 30 + rng() * 34;
        const l = 0.5 + rng() * 0.6;
        ctx.strokeStyle = `rgb(${(52 * l) | 0},${(88 * l) | 0},${(44 * l) | 0})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.8);
        ctx.stroke();
      }
    }
  }
  // cell 3: small round ivy / jasmine leaves + a few pale flowers (bottom-right)
  {
    const ox = half, oy = half;
    const cx = ox + half / 2, cy = oy + half / 2;
    ctx.strokeStyle = 'rgb(60,72,40)';
    ctx.lineWidth = 2;
    for (let b = 0; b < 6; b++) {
      ctx.beginPath(); ctx.moveTo(cx + (rng() - 0.5) * 60, oy + 10);
      ctx.bezierCurveTo(cx + (rng() - 0.5) * 200, cy, cx + (rng() - 0.5) * 200, cy + 80, cx + (rng() - 0.5) * 240, oy + half - 10);
      ctx.stroke();
    }
    for (let i = 0; i < 230; i++) {
      const px = cx + (rng() - 0.5) * half * 0.85;
      const py = oy + 14 + rng() * (half - 28);
      const l = 0.6 + rng() * 0.7;
      leaf(px, py, 18 + rng() * 14, 9 + rng() * 6, rng() * Math.PI * 2, green(l, 1.05), true);
    }
    for (let i = 0; i < 26; i++) {
      const px = cx + (rng() - 0.5) * half * 0.8;
      const py = oy + 20 + rng() * (half - 40);
      ctx.fillStyle = rng() < 0.5 ? 'rgb(236,232,226)' : 'rgb(176,150,206)';
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(px + Math.cos(a) * 4, py + Math.sin(a) * 4, 4, 2.4, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = toTexture(c, { wrap: false });
  tex.premultiplyAlpha = false;
  cache.set('foliage', tex);
  return tex;
}

// Monitor UI: dark trading/analytics dashboards (purely decorative pixels)
export function screenTexture(seed = 1) {
  const key = 'screen-' + seed;
  if (cache.has(key)) return cache.get(key);
  const w = 512, h = 288;
  const rng = mulberry32(200 + seed);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#121a22';
  ctx.fillRect(0, 0, w, 16);
  for (let p = 0; p < 4; p++) {
    const px = (p % 2) * w / 2 + 8, py = Math.floor(p / 2) * (h - 20) / 2 + 22;
    const pw = w / 2 - 16, ph = (h - 20) / 2 - 10;
    ctx.strokeStyle = 'rgba(80,110,140,0.35)';
    ctx.strokeRect(px, py, pw, ph);
    ctx.beginPath();
    let y = py + ph * (0.3 + rng() * 0.4);
    ctx.moveTo(px, y);
    for (let x = 0; x < pw; x += 3) {
      y += (rng() - 0.5) * 8;
      y = Math.max(py + 4, Math.min(py + ph - 4, y));
      ctx.lineTo(px + x, y);
    }
    ctx.strokeStyle = ['#4fb0ff', '#62d39b', '#e6c26a', '#9aa8ff'][p];
    ctx.lineWidth = 1.4;
    ctx.stroke();
    for (let b = 0; b < 18; b++) {
      const bh = rng() * ph * 0.25;
      ctx.fillStyle = 'rgba(120,150,180,0.25)';
      ctx.fillRect(px + b * (pw / 18), py + ph - bh, pw / 22, bh);
    }
  }
  const t = toTexture(c, { wrap: false });
  cache.set(key, t);
  return t;
}

export function bookSpines() {
  if (cache.has('books')) return cache.get('books');
  const w = 512, h = 128;
  const rng = mulberry32(300);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const palette = ['#e8e0d2', '#cbbfa8', '#9c8a70', '#5c4a3a', '#2f2a26', '#d9d2c4', '#7d7366', '#b9a88c'];
  let x = 0;
  while (x < w) {
    const bw = 6 + rng() * 14;
    const bh = h * (0.62 + rng() * 0.36);
    ctx.fillStyle = palette[(rng() * palette.length) | 0];
    ctx.fillRect(x, h - bh, bw - 1, bh);
    if (rng() < 0.4) {
      ctx.fillStyle = 'rgba(200,170,110,0.6)';
      ctx.fillRect(x + 2, h - bh + 8, bw - 5, 2);
    }
    x += bw;
    if (rng() < 0.12) x += 18 + rng() * 30;
  }
  const t = toTexture(c, { wrap: false });
  cache.set('books', t);
  return t;
}
