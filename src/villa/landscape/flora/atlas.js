import { mulberry32 } from '../../core/noise.js';
import { Painter, jit, mixc } from './painter.js';

// ---------------------------------------------------------------------------
// Procedural foliage atlas (2048 x 4096, 4 x 8 cells of 512 px).
// Real leaf / needle / flower shapes for the Mediterranean palette:
//   near-tree sprays (olive, holm oak, stone & Aleppo pine, cypress),
//   cluster cells for tree LODs, maquis and ground-layer plants, and tall
//   cascading vine strands (bougainvillea, jasmine).
// Output: albedo+coverage and normal.xy+gloss+translucency, same layout.
// ---------------------------------------------------------------------------

export const CELL = 512;
export const COLS = 4;
export const ROWS = 8;
export const ATLAS_W = CELL * COLS;
export const ATLAS_H = CELL * ROWS;

// cell grid: c = column, r = row, h = rows spanned; anchor = card origin in
// cell space (0..1, y down): 'base' sprays grow up from bottom-centre,
// 'centre' clumps are centred, 'top' strands hang down from top-centre.
export const CELLS = {
  oliveA: { c: 0, r: 0, anchor: 'base' },
  oliveB: { c: 1, r: 0, anchor: 'base' },
  oakA: { c: 2, r: 0, anchor: 'base' },
  oakB: { c: 3, r: 0, anchor: 'base' },
  pineSide: { c: 0, r: 1, anchor: 'base' },
  pineTop: { c: 1, r: 1, anchor: 'centre' },
  aleppo: { c: 2, r: 1, anchor: 'base' },
  cypress: { c: 3, r: 1, anchor: 'base' },
  oliveCl: { c: 0, r: 2, anchor: 'centre' },
  oakCl: { c: 1, r: 2, anchor: 'centre' },
  pineCl: { c: 2, r: 2, anchor: 'centre' },
  cypressCl: { c: 3, r: 2, anchor: 'centre' },
  lentisk: { c: 0, r: 3, anchor: 'base' },
  myrtle: { c: 1, r: 3, anchor: 'base' },
  rosemary: { c: 2, r: 3, anchor: 'base' },
  lavender: { c: 3, r: 3, anchor: 'base' },
  grassA: { c: 0, r: 4, anchor: 'base' },
  grassB: { c: 1, r: 4, anchor: 'base' },
  flowersW: { c: 2, r: 4, anchor: 'base' },
  flowersP: { c: 3, r: 4, anchor: 'base' },
  shrubBroad: { c: 0, r: 5, anchor: 'base' },
  ivy: { c: 1, r: 5, anchor: 'centre' },
  bougCushion: { c: 2, r: 5, anchor: 'centre' },
  pineClSide: { c: 3, r: 5, anchor: 'base' },
  bougA: { c: 0, r: 6, h: 2, anchor: 'top' },
  bougB: { c: 1, r: 6, h: 2, anchor: 'top' },
  jasmine: { c: 2, r: 6, h: 2, anchor: 'top' },
  strand: { c: 3, r: 6, h: 2, anchor: 'top' },
};

// UV rect [u0, v0, u1, v1] (v0 = top row; textures are not flipped)
export function cellRect(name, inset = 1.5) {
  const c = CELLS[name];
  const h = c.h ?? 1;
  return [
    (c.c * CELL + inset) / ATLAS_W,
    (c.r * CELL + inset) / ATLAS_H,
    ((c.c + 1) * CELL - inset) / ATLAS_W,
    ((c.r + h) * CELL - inset) / ATLAS_H,
  ];
}

// --- palette (sRGB 0..255) ---------------------------------------------------
const OLIVE_TOP = [74, 86, 56];
const OLIVE_TOP2 = [96, 104, 66];
const OLIVE_UNDER = [150, 158, 136];
const OLIVE_UNDER2 = [168, 172, 150];
const OLIVE_BARK = [92, 84, 70];
const OAK_TOP = [42, 58, 30];
const OAK_TOP2 = [58, 74, 36];
const OAK_NEW = [104, 122, 58];
const OAK_UNDER = [122, 126, 102];
const OAK_BARK = [70, 60, 50];
const PINE_N = [58, 78, 40];
const PINE_N2 = [96, 112, 56];
const PINE_TWIG = [120, 86, 58];
const ALEPPO_N = [84, 104, 54];
const ALEPPO_N2 = [120, 130, 70];
const CYP = [38, 56, 32];
const CYP2 = [66, 86, 44];

const TAU = Math.PI * 2;

function cellOrigin(name) {
  const c = CELLS[name];
  return [c.c * CELL, c.r * CELL, CELL, (c.h ?? 1) * CELL];
}

// sample a point + direction along a polyline at t (0..1)
function along(pts, t) {
  let total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0;
      const a = pts[i], b = pts[i + 1];
      return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    d -= seg[i];
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return { x: b[0], y: b[1], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function wobblyLine(rng, x, y, ang, len, n, bend = 0.1, drift = 0) {
  const pts = [[x, y]];
  let a = ang;
  for (let i = 0; i < n; i++) {
    a += (rng() - 0.5) * bend + drift;
    x += Math.cos(a) * len / n;
    y += Math.sin(a) * len / n;
    pts.push([x, y]);
  }
  return pts;
}

// --- sprays ------------------------------------------------------------------

// Olive: opposite, narrow lanceolate leaves, dark grey-green above, silver below
function oliveSpray(P, rng, x, y, ang, len, sc, o = {}) {
  const pts = wobblyLine(rng, x, y, ang, len, 7, 0.16, o.droop ?? 0);
  P.polyline(pts, 2.4 * sc, 0.8 * sc, OLIVE_BARK, { col1: [110, 112, 84], gloss: 0.15 });
  const pairs = o.pairs ?? 9;
  for (let k = 0; k < pairs; k++) {
    const t = 0.1 + (k / (pairs - 1)) * 0.9;
    const a = along(pts, Math.min(0.995, t));
    const edgeOn = k % 2 === 1; // decussate: every other pair foreshortened
    for (const side of [-1, 1]) {
      if (rng() < 0.08) continue;
      const tipK = t > 0.86 ? 0.55 : 1;
      const L = (62 + rng() * 26) * sc * tipK * (edgeOn ? 0.62 : 1);
      const spread = edgeOn ? 0.25 + rng() * 0.3 : 0.5 + rng() * 0.45;
      const under = rng() < (o.under ?? 0.32);
      P.leaf({
        x: a.x, y: a.y, ang: a.ang + side * spread, len: L, wid: L * (0.1 + rng() * 0.025) * (edgeOn ? 1.15 : 1),
        p: 0.95, q: 0.8,
        col: jit(under ? OLIVE_UNDER : OLIVE_TOP, rng, 0.1, 0.05), col2: jit(under ? OLIVE_UNDER2 : OLIVE_TOP2, rng, 0.1, 0.05),
        mid: under ? 0.08 : 0.22, veins: 0, gloss: under ? 0.08 : 0.42, tr: under ? 0.32 : 0.6,
        fold: 0.35, conv: 0.1, roll: (rng() - 0.5) * 0.9 + (edgeOn ? side * 0.6 : 0), pitch: (rng() - 0.5) * 0.5, curl: (rng() - 0.5) * 0.4,
        speck: 0.06,
      });
    }
  }
  // a couple of tiny tip leaves
  const tip = along(pts, 1);
  for (let i = 0; i < 2; i++) {
    P.leaf({ x: tip.x, y: tip.y, ang: tip.ang + (i ? 0.25 : -0.25), len: 26 * sc, wid: 3 * sc, p: 1, q: 0.8, col: OLIVE_TOP2, col2: [120, 128, 84], mid: 0.1, veins: 0, gloss: 0.3, tr: 0.7, fold: 0.2 });
  }
}

// Holm oak: alternate ovate leaves, glossy dark above, grey felt below
function oakSpray(P, rng, x, y, ang, len, sc, o = {}) {
  const pts = wobblyLine(rng, x, y, ang, len, 6, 0.2, o.droop ?? 0);
  P.polyline(pts, 2.8 * sc, 1.0 * sc, OAK_BARK, { col1: [96, 86, 64], gloss: 0.1 });
  const n = o.leaves ?? 12;
  let phi = rng() * TAU;
  for (let k = 0; k < n; k++) {
    phi += 2.4;
    const t = 0.12 + (k / (n - 1)) * 0.88;
    const a = along(pts, Math.min(0.995, t));
    const side = Math.sin(phi) < 0 ? -1 : 1;
    const fs = 0.5 + 0.5 * Math.abs(Math.sin(phi)); // foreshortening
    const young = t > 0.8 && rng() < 0.6;
    const under = !young && rng() < (o.under ?? 0.18);
    const L = (64 + rng() * 22) * sc * (young ? 0.6 : 1) * fs;
    const col = young ? OAK_NEW : under ? OAK_UNDER : OAK_TOP;
    const col2 = young ? [130, 140, 70] : under ? [140, 140, 116] : OAK_TOP2;
    // petiole
    const pa = a.ang + side * (0.6 + rng() * 0.5);
    const px = a.x + Math.cos(pa) * 5 * sc, py = a.y + Math.sin(pa) * 5 * sc;
    P.stroke(a.x, a.y, px, py, 1 * sc, 0.8 * sc, [86, 90, 56]);
    P.leaf({
      x: px, y: py, ang: pa - side * 0.15, len: L, wid: L * (0.27 + rng() * 0.07) / Math.max(0.65, fs),
      p: 0.85, q: 0.62, teeth: rng() < 0.2 ? 5 + Math.floor(rng() * 3) : 0, toothD: 0.07,
      col: jit(col, rng, 0.12, 0.05), col2: jit(col2, rng, 0.1, 0.05),
      mid: under ? 0.1 : 0.28, veins: under ? 0.02 : 0.05, veinN: 8,
      gloss: under ? 0.05 : young ? 0.5 : 0.78, tr: under ? 0.22 : young ? 0.75 : 0.42,
      fold: 0.18, conv: 0.35, roll: Math.cos(phi) * 0.8 + (rng() - 0.5) * 0.4, pitch: (rng() - 0.5) * 0.5, curl: -0.2 + rng() * 0.3,
      speck: 0.05,
    });
  }
}

// Pine needle fascicles: side view brush or top view star
function pineTuft(P, rng, x, y, ang, sc, o = {}) {
  const top = !!o.top;
  const N = o.n ?? 150;
  const nl = o.len ?? 170;
  const cA = o.col ?? PINE_N, cB = o.col2 ?? PINE_N2;
  const hw = o.hw ?? 1.05;
  if (!top) {
    // twig carrying the fascicles
    const tl = (o.twig ?? 150) * sc;
    const pts = wobblyLine(rng, x, y, ang, tl, 4, 0.1);
    P.polyline(pts, 4.2 * sc, 2.8 * sc, PINE_TWIG, { col1: [150, 110, 70], gloss: 0.2 });
    // needles all along the twig, sweeping forward (bottlebrush tip)
    for (let i = 0; i < N; i++) {
      const t = 0.12 + Math.pow(rng(), 0.7) * 0.88;
      const a = along(pts, t);
      const side = rng() < 0.5 ? -1 : 1;
      const spread = (0.2 + Math.pow(rng(), 0.9) * 0.85) * side * (1.15 - t * 0.6);
      const L = nl * sc * (0.7 + rng() * 0.45) * (1 - 0.2 * (1 - t));
      const da = a.ang + spread;
      const bend = (rng() - 0.5) * 0.25 - side * 0.12;
      const mx = a.x + Math.cos(da) * L * 0.5, my = a.y + Math.sin(da) * L * 0.5;
      const ex = mx + Math.cos(da + bend) * L * 0.5, ey = my + Math.sin(da + bend) * L * 0.5;
      const k = rng();
      const c = mixc(cA, cB, k * k);
      const dead = rng() < 0.04 && t < 0.5;
      const col = dead ? [150, 120, 70] : jit(c, rng, 0.12, 0.05);
      P.stroke(a.x, a.y, mx, my, hw * sc, hw * 0.95 * sc, col, { gloss: 0.45, tr: 0.5, col1: col });
      P.stroke(mx, my, ex, ey, hw * 0.95 * sc, 0.35 * sc, col, { gloss: 0.45, tr: 0.55, col1: mixc(col, cB, 0.4) });
    }
    const tip = along(pts, 1);
    P.dot(tip.x, tip.y, 5 * sc, [150, 120, 84], { col2: [175, 150, 110] });
  } else {
    for (let i = 0; i < N; i++) {
      const a = rng() * TAU;
      const r0 = rng() * 14 * sc;
      const L = nl * sc * (0.55 + rng() * 0.5);
      const sx = x + Math.cos(a) * r0, sy = y + Math.sin(a) * r0;
      const bend = (rng() - 0.5) * 0.3;
      const mx = sx + Math.cos(a) * L * 0.5, my = sy + Math.sin(a) * L * 0.5;
      const ex = mx + Math.cos(a + bend) * L * 0.5, ey = my + Math.sin(a + bend) * L * 0.5;
      const k = rng();
      const col = jit(mixc(cA, cB, k * k), rng, 0.14, 0.05);
      P.stroke(sx, sy, mx, my, hw * sc, hw * 0.95 * sc, col, { gloss: 0.45, tr: 0.5 });
      P.stroke(mx, my, ex, ey, hw * 0.95 * sc, 0.35 * sc, col, { gloss: 0.45, tr: 0.55, col1: mixc(col, cB, 0.4) });
    }
    P.dot(x, y, 8 * sc, [150, 118, 80], { col2: [178, 150, 108] });
  }
}

// Cypress: flattened fronds clothed in tiny overlapping scale leaves
function cypressFrond(P, rng, x, y, ang, len, sc, depth = 0) {
  const pts = wobblyLine(rng, x, y, ang, len, 6, 0.14);
  const n = Math.max(3, Math.round(len / (7 * sc)));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const a = along(pts, Math.min(0.999, t));
    const tipK = 1 - t * 0.45;
    const c = jit(mixc(CYP, CYP2, Math.pow(t, 2) * (depth >= 2 ? 1 : 0.6)), rng, 0.14, 0.04);
    // scale pair: two short plump ellipses along the axis
    for (const s of [-1, 1]) {
      const L = (11 + rng() * 4) * sc * tipK * (depth ? 1 : 1.25);
      P.leaf({ x: a.x, y: a.y, ang: a.ang + s * 0.42, len: L, wid: L * 0.42, p: 0.9, q: 0.55, col: c, col2: mixc(c, CYP2, 0.5),
        mid: 0, veins: 0, gloss: 0.3, tr: 0.35, fold: 0, conv: 0.7, roll: s * 0.3 + (rng() - 0.5) * 0.4, pitch: 0.2, speck: 0.1 });
    }
  }
  if (depth >= 3) return;
  const nb = depth === 0 ? 10 : depth === 1 ? 7 : 4;
  for (let k = 0; k < nb; k++) {
    const t = 0.12 + (k / nb) * 0.8;
    const a = along(pts, t);
    const side = k % 2 ? 1 : -1;
    const L = len * (depth === 0 ? 0.45 : 0.5) * (1 - t * 0.55) * (0.8 + rng() * 0.4);
    if (L < 10 * sc) continue;
    cypressFrond(P, rng, a.x, a.y, a.ang + side * (0.55 + rng() * 0.35), L, sc * 0.9, depth + 1);
  }
}

// --- shrubs / ground layer --------------------------------------------------

function lentiskLeaf(P, rng, x, y, ang, len, sc) {
  // pinnate: reddish rachis + 3-5 pairs of elliptic glossy leaflets
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  P.stroke(x, y, ex, ey, 1.3 * sc, 0.8 * sc, [118, 70, 52], { gloss: 0.3 });
  const pairs = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < pairs; k++) {
    const t = 0.25 + (k / pairs) * 0.75;
    const px = x + (ex - x) * t, py = y + (ey - y) * t;
    for (const s of [-1, 1]) {
      const L = (17 + rng() * 6) * sc;
      P.leaf({ x: px, y: py, ang: ang + s * (0.9 + rng() * 0.3), len: L, wid: L * 0.3, p: 0.95, q: 0.6,
        col: jit([40, 62, 32], rng, 0.14, 0.05), col2: jit([56, 76, 38], rng, 0.1, 0.05), mid: 0.2, veins: 0.02, gloss: 0.7, tr: 0.45, fold: 0.2, conv: 0.3, roll: (rng() - 0.5) * 0.8, pitch: (rng() - 0.5) * 0.5 });
    }
  }
}

function myrtleTwig(P, rng, x, y, ang, len, sc) {
  const pts = wobblyLine(rng, x, y, ang, len, 5, 0.18);
  P.polyline(pts, 1.8 * sc, 0.7 * sc, [96, 74, 56], { gloss: 0.15 });
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = along(pts, 0.1 + (k / n) * 0.9);
    for (const s of [-1, 1]) {
      const L = (30 + rng() * 12) * sc * (k > n - 3 ? 0.7 : 1);
      P.leaf({ x: a.x, y: a.y, ang: a.ang + s * (0.55 + rng() * 0.4), len: L, wid: L * 0.24, p: 0.85, q: 0.7,
        col: jit([44, 66, 36], rng, 0.14, 0.05), col2: jit([62, 82, 42], rng, 0.1, 0.05), mid: 0.18, veins: 0, gloss: 0.72, tr: 0.5, fold: 0.15, conv: 0.3, roll: (rng() - 0.5) * 1.0, pitch: (rng() - 0.5) * 0.5 });
    }
  }
}

function flower5(P, rng, x, y, r, col, centre, o = {}) {
  const n = o.petals ?? 5;
  const a0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + (rng() - 0.5) * 0.2;
    P.leaf({ x, y, ang: a, len: r, wid: r * (o.pw ?? 0.42), p: o.pp ?? 0.7, q: 0.55, col: jit(col, rng, 0.06, 0.02), col2: o.col2 ?? col, mid: 0.04, veins: 0.03, gloss: 0.15, tr: 0.8, fold: 0, conv: 0.4, roll: (rng() - 0.5) * 0.5, pitch: 0.2 });
  }
  if (centre) P.dot(x, y, r * 0.22, centre, { tr: 0.3 });
}

function spike(P, rng, x, y, ang, len, sc, cA, cB, o = {}) {
  // tapering inflorescence: whorls of small florets along the axis
  const n = o.n ?? 14;
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const px = x + Math.cos(ang) * len * t, py = y + Math.sin(ang) * len * t;
    const r = (o.r ?? 5.5) * sc * (1 - t * 0.55);
    for (let j = 0; j < 3; j++) {
      const a = ang + (rng() - 0.5) * 2.6;
      const c = mixc(cA, cB, rng());
      P.leaf({ x: px, y: py, ang: a, len: r * 1.4, wid: r * 0.55, p: 0.8, q: 0.6, col: c, col2: mixc(c, cB, 0.5), mid: 0, veins: 0, gloss: 0.1, tr: 0.55, fold: 0, conv: 0.6, roll: (rng() - 0.5), speck: 0.08 });
    }
  }
}

function grassBlade(P, rng, x, y, ang, len, w, cA, cB, o = {}) {
  const pts = [];
  let a = ang, px = x, py = y;
  const n = 7;
  const droop = o.droop ?? 0.09;
  const dir = Math.cos(ang) < 0 ? -1 : 1;
  for (let i = 0; i <= n; i++) {
    pts.push([px, py]);
    a += droop * dir * (0.5 + i / n);
    px += Math.cos(a) * len / n;
    py += Math.sin(a) * len / n;
  }
  P.polyline(pts, w, w * 0.25, cA, { col1: cB, gloss: o.gloss ?? 0.35, tr: 0.65, flat: 1, twist: (rng() - 0.5) * 1.2 });
  return pts;
}

// --- vines -----------------------------------------------------------------

const BOUG_LEAF = [52, 86, 36];
const BOUG_LEAF2 = [74, 106, 44];
const BOUG_BRACT = [184, 40, 118];
const BOUG_BRACT2 = [214, 78, 150];

function bractCluster(P, rng, x, y, sc, o = {}) {
  const n = 2 + Math.floor(rng() * 3);
  const base = o.col ?? BOUG_BRACT, hi = o.col2 ?? BOUG_BRACT2;
  for (let f = 0; f < n; f++) {
    const fx = x + (rng() - 0.5) * 26 * sc, fy = y + (rng() - 0.5) * 26 * sc;
    const a0 = rng() * TAU;
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i / 3) * TAU + (rng() - 0.5) * 0.4;
      const L = (17 + rng() * 7) * sc;
      P.leaf({ x: fx, y: fy, ang: a, len: L, wid: L * 0.5, p: 0.75, q: 0.5, col: jit(base, rng, 0.1, 0.03), col2: jit(hi, rng, 0.08, 0.03), mid: 0.06, veins: 0.08, veinN: 6, gloss: 0.12, tr: 0.85, fold: 0.1, conv: 0.5, roll: (rng() - 0.5) * 0.8, pitch: (rng() - 0.5) * 0.6, speck: 0.05 });
    }
    P.dot(fx, fy, 2.2 * sc, [236, 228, 200], { tr: 0.5 });
  }
}

function bougStrand(P, rng, x, y, len, sc, flowerK) {
  // hanging stem that wanders down, leaves alternate, bract clusters at nodes
  const pts = [];
  let a = Math.PI / 2 + (rng() - 0.5) * 0.3, px = x, py = y;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    pts.push([px, py]);
    a += (rng() - 0.5) * 0.35;
    a += (Math.PI / 2 - a) * 0.25; // gravity
    px += Math.cos(a) * len / n;
    py += Math.sin(a) * len / n;
  }
  P.polyline(pts, 2.2 * sc, 1.0 * sc, [92, 82, 54], { col1: [92, 110, 60], gloss: 0.2 });
  const nl = Math.round(len / (13 * sc));
  for (let k = 0; k < nl; k++) {
    const t = 0.03 + (k / nl) * 0.97;
    const p = along(pts, t);
    const side = k % 2 ? 1 : -1;
    const L = (34 + rng() * 16) * sc * (1 - t * 0.35);
    P.leaf({ x: p.x, y: p.y, ang: p.ang + side * (0.7 + rng() * 0.7), len: L, wid: L * 0.36, p: 0.82, q: 0.6,
      col: jit(BOUG_LEAF, rng, 0.14, 0.05), col2: jit(BOUG_LEAF2, rng, 0.1, 0.05), mid: 0.2, veins: 0.04, gloss: 0.45, tr: 0.6, fold: 0.15, conv: 0.3, roll: (rng() - 0.5) * 1.1, pitch: (rng() - 0.5) * 0.6, curl: 0.2 });
    if (rng() < flowerK * (1.15 - t * 0.6)) bractCluster(P, rng, p.x + side * 14 * sc, p.y + 6 * sc, sc * (0.9 + rng() * 0.3));
  }
}

function jasmineStrand(P, rng, x, y, len, sc) {
  const pts = [];
  let a = Math.PI / 2 + (rng() - 0.5) * 0.3, px = x, py = y;
  const n = 14;
  for (let i = 0; i <= n; i++) {
    pts.push([px, py]);
    a += (rng() - 0.5) * 0.4;
    a += (Math.PI / 2 - a) * 0.22;
    px += Math.cos(a) * len / n;
    py += Math.sin(a) * len / n;
  }
  P.polyline(pts, 1.8 * sc, 0.9 * sc, [70, 80, 44], { gloss: 0.2 });
  const nl = Math.round(len / (16 * sc));
  for (let k = 0; k < nl; k++) {
    const t = 0.03 + (k / nl) * 0.97;
    const p = along(pts, t);
    for (const side of [-1, 1]) {
      // trifoliate-ish: 3 small leaflets
      const b = p.ang + side * (0.8 + rng() * 0.5);
      for (let l = 0; l < 3; l++) {
        const L = (22 + rng() * 10) * sc * (l === 1 ? 1.2 : 0.85);
        P.leaf({ x: p.x + Math.cos(b) * 6 * sc, y: p.y + Math.sin(b) * 6 * sc, ang: b + (l - 1) * 0.6, len: L, wid: L * 0.3, p: 0.9, q: 0.65,
          col: jit([34, 58, 30], rng, 0.14, 0.05), col2: jit([52, 76, 38], rng, 0.1, 0.05), mid: 0.2, veins: 0, gloss: 0.62, tr: 0.5, fold: 0.15, conv: 0.3, roll: (rng() - 0.5), pitch: (rng() - 0.5) * 0.5 });
      }
    }
    if (rng() < 0.45) {
      const fx = p.x + (rng() - 0.5) * 30 * sc, fy = p.y + (rng() - 0.5) * 20 * sc;
      for (let f = 0; f < 2 + Math.floor(rng() * 3); f++) {
        const bx = fx + (rng() - 0.5) * 22 * sc, by = fy + (rng() - 0.5) * 22 * sc;
        if (rng() < 0.3) P.dot(bx, by, 3 * sc, [226, 190, 196], { col2: [240, 220, 220], tr: 0.6 });
        else flower5(P, rng, bx, by, 9 * sc, [242, 240, 232], [236, 220, 150], { pw: 0.36, pp: 0.8, col2: [252, 250, 244] });
      }
    }
  }
}

// --- cells -----------------------------------------------------------------

const painters = {
  oliveA(P, rng, ox, oy, S) {
    P.halo = 0.22; P.haloR = 5;
    const bx = ox + S / 2, by = oy + S - 14;
    const fan = [-0.62, -0.38, 0.4, 0.66, -0.15, 0.14, 0.0];
    fan.forEach((f, i) => {
      P.dim = 0.82 + 0.18 * (i / fan.length);
      oliveSpray(P, rng, bx + f * 50, by - Math.abs(f) * 30, -Math.PI / 2 + f, S * (0.88 - Math.abs(f) * 0.42), 0.95, { pairs: 10 - Math.round(Math.abs(f) * 4) });
    });
    P.dim = 1;
  },
  oliveB(P, rng, ox, oy, S) {
    P.halo = 0.22; P.haloR = 5;
    const bx = ox + S / 2, by = oy + S - 14;
    const fan = [-0.75, 0.55, -0.3, 0.25, 0.85, -0.05];
    fan.forEach((f, i) => {
      P.dim = 0.82 + 0.18 * (i / fan.length);
      oliveSpray(P, rng, bx + f * 40, by - Math.abs(f) * 20, -Math.PI / 2 + f, S * (0.86 - Math.abs(f) * 0.36), 0.95, { pairs: 9, droop: f * 0.03, under: 0.42 });
    });
    P.dim = 1;
  },
  oakA(P, rng, ox, oy, S) {
    P.halo = 0.25; P.haloR = 6;
    const bx = ox + S / 2, by = oy + S - 14;
    const fan = [-0.7, 0.62, -0.32, 0.3, 0.02];
    fan.forEach((f, i) => {
      P.dim = 0.8 + 0.2 * (i / fan.length);
      oakSpray(P, rng, bx + f * 50, by - Math.abs(f) * 30, -Math.PI / 2 + f, S * (0.84 - Math.abs(f) * 0.35), 0.95, { leaves: 13 });
    });
    P.dim = 1;
  },
  oakB(P, rng, ox, oy, S) {
    P.halo = 0.25; P.haloR = 6;
    const bx = ox + S / 2, by = oy + S - 14;
    const fan = [0.75, -0.55, 0.28, -0.2, 0.08];
    fan.forEach((f, i) => {
      P.dim = 0.8 + 0.2 * (i / fan.length);
      oakSpray(P, rng, bx + f * 40, by - Math.abs(f) * 25, -Math.PI / 2 + f, S * (0.84 - Math.abs(f) * 0.32), 0.95, { leaves: 13, under: 0.24, droop: -f * 0.03 });
    });
    P.dim = 1;
  },
  pineSide(P, rng, ox, oy, S) {
    P.halo = 0.1; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 10;
    P.dim = 0.85;
    pineTuft(P, rng, bx - 20, by, -Math.PI / 2 - 0.42, 0.8, { n: 130, len: 190, twig: 250 });
    pineTuft(P, rng, bx + 20, by, -Math.PI / 2 + 0.4, 0.8, { n: 130, len: 190, twig: 240 });
    P.dim = 1;
    pineTuft(P, rng, bx, by, -Math.PI / 2, 0.95, { n: 200, len: 200, twig: 300 });
  },
  pineTop(P, rng, ox, oy, S) {
    P.halo = 0.1; P.haloR = 3;
    pineTuft(P, rng, ox + S / 2, oy + S / 2, 0, 1.0, { top: true, n: 260, len: 230 });
  },
  aleppo(P, rng, ox, oy, S) {
    P.halo = 0.08; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 10;
    pineTuft(P, rng, bx - 40, by, -Math.PI / 2 - 0.3, 0.8, { n: 90, len: 170, twig: 220, col: ALEPPO_N, col2: ALEPPO_N2, hw: 0.85 });
    pineTuft(P, rng, bx + 30, by - 30, -Math.PI / 2 + 0.25, 0.85, { n: 90, len: 170, twig: 240, col: ALEPPO_N, col2: ALEPPO_N2, hw: 0.85 });
  },
  cypress(P, rng, ox, oy, S) {
    P.halo = 0.18; P.haloR = 4;
    const bx = ox + S / 2, by = oy + S - 10;
    cypressFrond(P, rng, bx - 30, by, -Math.PI / 2 - 0.3, S * 0.7, 1.0);
    cypressFrond(P, rng, bx + 30, by, -Math.PI / 2 + 0.3, S * 0.7, 1.0);
    cypressFrond(P, rng, bx, by, -Math.PI / 2, S * 0.9, 1.1);
  },
  // --- clusters for LODs (one card = a clump of ~1.2-2 m) ---------------------
  oliveCl(P, rng, ox, oy, S) {
    P.halo = 0.25; P.haloR = 4;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.28;
      P.dim = 0.7 + 0.3 * (i / 26);
      oliveSpray(P, rng, cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5 + 40, a - 0.2 + (rng() - 0.5) * 0.6 - (Math.sin(a) > 0 ? 0 : 0), S * 0.28, 0.42, { pairs: 7 });
    }
    P.dim = 1;
  },
  oakCl(P, rng, ox, oy, S) {
    P.halo = 0.28; P.haloR = 4;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 30; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.25;
      P.dim = 0.62 + 0.38 * (i / 30);
      oakSpray(P, rng, cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4 + 30, a + (rng() - 0.5) * 0.5, S * 0.26, 0.4, { leaves: 9 });
    }
    P.dim = 1;
  },
  pineCl(P, rng, ox, oy, S) {
    // umbrella canopy patch from above / at an angle: many star tufts
    P.halo = 0.16; P.haloR = 3;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 24; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.3;
      P.dim = 0.62 + 0.38 * (i / 24);
      pineTuft(P, rng, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 0, 0.42, { top: true, n: 110, len: 210 });
    }
    P.dim = 1;
  },
  cypressCl(P, rng, ox, oy, S) {
    P.halo = 0.25; P.haloR = 4;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.24;
      P.dim = 0.65 + 0.35 * (i / 26);
      cypressFrond(P, rng, cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5 + 60, -Math.PI / 2 + (rng() - 0.5) * 1.6, S * 0.34, 0.5);
    }
    P.dim = 1;
  },
  pineClSide(P, rng, ox, oy, S) {
    // side view of a clump of upturned tufts (silhouette of an umbrella pine edge)
    P.halo = 0.14; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 30;
    for (let i = 0; i < 16; i++) {
      const x = bx + (rng() - 0.5) * S * 0.62;
      const y = by - rng() * S * 0.28;
      P.dim = 0.65 + 0.35 * (i / 16);
      pineTuft(P, rng, x, y, -Math.PI / 2 + (x - bx) / S * 1.4 + (rng() - 0.5) * 0.4, 0.5, { n: 120, len: 230, twig: 120 });
    }
    P.dim = 1;
  },
  // --- maquis & ground layer -------------------------------------------------
  lentisk(P, rng, ox, oy, S) {
    P.halo = 0.25; P.haloR = 4;
    const bx = ox + S / 2, by = oy + S - 12;
    for (let s = 0; s < 6; s++) {
      P.dim = 0.8 + 0.2 * (s / 6);
      const pts = wobblyLine(rng, bx + (s - 2.5) * 30, by, -Math.PI / 2 + (s - 2.5) * 0.3, S * (0.65 + rng() * 0.25), 6, 0.2);
      P.polyline(pts, 2.2, 1.0, [104, 72, 54], { gloss: 0.15 });
      for (let k = 0; k < 13; k++) {
        const a = along(pts, 0.12 + k / 13 * 0.88);
        lentiskLeaf(P, rng, a.x, a.y, a.ang + (k % 2 ? 1 : -1) * (0.45 + rng() * 0.5), 50 + rng() * 16, 1.0);
      }
    }
    P.dim = 1;
    for (let i = 0; i < 10; i++) P.dot(ox + 80 + rng() * (S - 160), oy + 80 + rng() * (S - 200), 4.5, [120, 40, 36], { col2: [160, 60, 50], gloss: 0.7 });
  },
  myrtle(P, rng, ox, oy, S) {
    P.halo = 0.22; P.haloR = 4;
    const bx = ox + S / 2, by = oy + S - 12;
    for (let s = 0; s < 6; s++) myrtleTwig(P, rng, bx + (rng() - 0.5) * 120, by - rng() * 40, -Math.PI / 2 + (rng() - 0.5) * 1.1, S * (0.5 + rng() * 0.35), 1.0);
    for (let i = 0; i < 9; i++) {
      const x = ox + 90 + rng() * (S - 180), y = oy + 70 + rng() * (S * 0.6);
      flower5(P, rng, x, y, 11, [244, 242, 236], [240, 236, 200], { pw: 0.55 });
      for (let k = 0; k < 14; k++) { const a = rng() * TAU; P.stroke(x, y, x + Math.cos(a) * 9, y + Math.sin(a) * 9, 0.5, 0.4, [246, 240, 214]); }
    }
  },
  rosemary(P, rng, ox, oy, S) {
    P.halo = 0.16; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 10;
    for (let s = 0; s < 9; s++) {
      const pts = wobblyLine(rng, bx + (rng() - 0.5) * 140, by, -Math.PI / 2 + (rng() - 0.5) * 0.9, S * (0.55 + rng() * 0.38), 6, 0.15);
      P.polyline(pts, 2.4, 1.0, [104, 92, 76], { gloss: 0.1 });
      for (let k = 0; k < 34; k++) {
        const a = along(pts, 0.12 + (k / 34) * 0.88);
        const side = k % 2 ? 1 : -1;
        const L = 38 + rng() * 16;
        const under = rng() < 0.3;
        P.leaf({ x: a.x, y: a.y, ang: a.ang + side * (0.35 + rng() * 0.5), len: L, wid: 2.6, p: 1, q: 0.35,
          col: jit(under ? [150, 158, 146] : [62, 82, 60], rng, 0.1, 0.04), col2: jit(under ? [170, 176, 160] : [80, 98, 70], rng, 0.08, 0.04), mid: 0.1, veins: 0, gloss: under ? 0.1 : 0.4, tr: 0.4, fold: 0.4, conv: 0, roll: (rng() - 0.5) * 0.8 });
        if (k > 20 && rng() < 0.12) flower5(P, rng, a.x + side * 10, a.y, 6, [168, 182, 226], null, { petals: 4, pw: 0.5 });
      }
    }
  },
  lavender(P, rng, ox, oy, S) {
    P.halo = 0.15; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 10;
    // grey-green leafy base mound
    for (let i = 0; i < 160; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.4;
      const L = 40 + rng() * 40;
      P.leaf({ x: bx + (rng() - 0.5) * 220, y: by - rng() * 70, ang: a, len: L, wid: 2.4, p: 1, q: 0.4,
        col: jit([104, 120, 98], rng, 0.12, 0.04), col2: jit([132, 144, 120], rng, 0.1, 0.04), mid: 0.05, veins: 0, gloss: 0.12, tr: 0.35, fold: 0.3, roll: (rng() - 0.5) });
    }
    // flower stalks with purple spikes
    for (let s = 0; s < 34; s++) {
      const x0 = bx + (rng() - 0.5) * 200, y0 = by - 40 - rng() * 30;
      const a = -Math.PI / 2 + (x0 - bx) / 260 + (rng() - 0.5) * 0.25;
      const L = S * (0.55 + rng() * 0.28);
      const ex = x0 + Math.cos(a) * L, ey = y0 + Math.sin(a) * L;
      P.stroke(x0, y0, ex, ey, 1.3, 0.9, [112, 128, 92], { gloss: 0.1, tr: 0.3 });
      const sl = L * (0.24 + rng() * 0.1);
      spike(P, rng, ex, ey, a + Math.PI, sl, 1.0, [96, 72, 150], [150, 120, 196], { n: 13, r: 6.5 });
    }
  },
  grassA(P, rng, ox, oy, S) {
    // fine arching grass with feathery plumes (Pennisetum / Stipa)
    P.halo = 0.08; P.haloR = 2;
    const bx = ox + S / 2, by = oy + S - 6;
    for (let i = 0; i < 120; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.9;
      const L = S * (0.45 + rng() * 0.5);
      const c = jit([84, 104, 54], rng, 0.15, 0.05);
      grassBlade(P, rng, bx + (rng() - 0.5) * 40, by, a, L, 2.2 + rng() * 1.2, c, mixc(c, [176, 160, 100], 0.6 + rng() * 0.4), { droop: 0.06 + rng() * 0.06 });
    }
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.3;
      const L = S * (0.6 + rng() * 0.34);
      const pts = grassBlade(P, rng, bx + (rng() - 0.5) * 30, by, a, L, 1.0, [150, 140, 96], [176, 164, 120], { droop: 0.05 });
      // plume: soft fibres along the last 30%
      for (let k = 0; k < 40; k++) {
        const p = along(pts, 0.7 + rng() * 0.3);
        const fa = p.ang + (rng() - 0.5) * 1.6;
        const fl = 10 + rng() * 14;
        P.stroke(p.x, p.y, p.x + Math.cos(fa) * fl, p.y + Math.sin(fa) * fl, 0.7, 0.3, jit([214, 198, 160], rng, 0.08, 0.04), { gloss: 0.05, tr: 0.8 });
      }
    }
  },
  grassB(P, rng, ox, oy, S) {
    // dense blue-green tussock (Festuca / Carex)
    P.halo = 0.1; P.haloR = 2;
    const bx = ox + S / 2, by = oy + S - 6;
    for (let i = 0; i < 220; i++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * 2.3;
      const L = S * (0.3 + rng() * 0.45);
      const c = jit([78, 100, 82], rng, 0.18, 0.06);
      grassBlade(P, rng, bx + (rng() - 0.5) * 60, by, a, L, 2.0 + rng() * 1.0, c, mixc(c, [128, 140, 110], 0.5), { droop: 0.1 + rng() * 0.08 });
    }
  },
  flowersW(P, rng, ox, oy, S) {
    // airy white perennial (Gaura / Erigeron) on wiry stems over a leafy base
    P.halo = 0.12; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 8;
    for (let i = 0; i < 70; i++) {
      const L = 30 + rng() * 26;
      P.leaf({ x: bx + (rng() - 0.5) * 240, y: by - rng() * 110, ang: -Math.PI / 2 + (rng() - 0.5) * 2.6, len: L, wid: L * 0.22, p: 0.9, q: 0.6,
        col: jit([62, 90, 46], rng, 0.14, 0.05), col2: jit([84, 108, 56], rng, 0.1, 0.05), mid: 0.15, veins: 0.03, gloss: 0.3, tr: 0.6, fold: 0.2, roll: (rng() - 0.5) });
    }
    for (let s = 0; s < 30; s++) {
      const x0 = bx + (rng() - 0.5) * 160, y0 = by - 60;
      const a = -Math.PI / 2 + (x0 - bx) / 200 + (rng() - 0.5) * 0.5;
      const L = S * (0.45 + rng() * 0.4);
      const pts = wobblyLine(rng, x0, y0, a, L, 4, 0.25);
      P.polyline(pts, 1.1, 0.6, [96, 104, 70], { gloss: 0.1 });
      for (let f = 0; f < 3; f++) {
        const p = along(pts, 0.6 + f * 0.18);
        const pink = rng() < 0.25;
        flower5(P, rng, p.x + (rng() - 0.5) * 16, p.y + (rng() - 0.5) * 10, 10 + rng() * 4, pink ? [236, 200, 214] : [246, 244, 238], [220, 200, 120], { petals: rng() < 0.5 ? 4 : 8, pw: 0.34 });
      }
    }
  },
  flowersP(P, rng, ox, oy, S) {
    // violet-blue spikes (Salvia / Nepeta) over grey-green foliage
    P.halo = 0.14; P.haloR = 3;
    const bx = ox + S / 2, by = oy + S - 8;
    for (let i = 0; i < 90; i++) {
      const L = 28 + rng() * 22;
      P.leaf({ x: bx + (rng() - 0.5) * 240, y: by - rng() * 120, ang: -Math.PI / 2 + (rng() - 0.5) * 2.6, len: L, wid: L * 0.3, p: 0.8, q: 0.55, teeth: 6, toothD: 0.1,
        col: jit([76, 98, 70], rng, 0.14, 0.05), col2: jit([100, 118, 86], rng, 0.1, 0.05), mid: 0.12, veins: 0.06, gloss: 0.15, tr: 0.5, fold: 0.15, roll: (rng() - 0.5) });
    }
    for (let s = 0; s < 26; s++) {
      const x0 = bx + (rng() - 0.5) * 200, y0 = by - 70 - rng() * 30;
      const a = -Math.PI / 2 + (x0 - bx) / 260 + (rng() - 0.5) * 0.3;
      const L = S * (0.4 + rng() * 0.3);
      const ex = x0 + Math.cos(a) * L, ey = y0 + Math.sin(a) * L;
      P.stroke(x0, y0, ex, ey, 1.4, 1.0, [86, 92, 90], { gloss: 0.1 });
      spike(P, rng, ex, ey, a + Math.PI, L * 0.5, 1.0, [74, 64, 150], [120, 104, 196], { n: 12, r: 6 });
    }
  },
  shrubBroad(P, rng, ox, oy, S) {
    // dense evergreen (pittosporum / viburnum): whorled obovate glossy leaves
    P.halo = 0.25; P.haloR = 5;
    const bx = ox + S / 2, by = oy + S - 12;
    for (let w = 0; w < 7; w++) {
      P.dim = 0.75 + 0.25 * (w / 7);
      const f = (rng() - 0.5) * 1.6;
      const pts = wobblyLine(rng, bx + f * 60, by, -Math.PI / 2 + f, S * (0.6 + rng() * 0.3), 5, 0.2);
      P.polyline(pts, 2.4, 1.1, [92, 80, 62], { gloss: 0.1 });
      for (let k = 0; k < 4; k++) {
        const p = along(pts, 0.35 + k * 0.2);
        const n = 5 + Math.floor(rng() * 3);
        const a0 = rng() * TAU;
        for (let j = 0; j < n; j++) {
          const a = p.ang + Math.sin(a0 + (j / n) * TAU) * 1.3;
          const L = (50 + rng() * 22) * (0.75 + k * 0.1);
          P.leaf({ x: p.x, y: p.y, ang: a, len: L, wid: L * 0.27, p: 1.25, q: 0.6, col: jit([44, 68, 34], rng, 0.14, 0.05), col2: jit([64, 88, 42], rng, 0.1, 0.05), mid: 0.25, veins: 0.04, gloss: 0.7, tr: 0.45, fold: 0.15, conv: 0.35, roll: Math.cos(a0 + (j / n) * TAU) * 0.8, pitch: 0.2 + (rng() - 0.5) * 0.4 });
        }
      }
    }
    P.dim = 1;
  },
  ivy(P, rng, ox, oy, S) {
    // low trailing groundcover: small rounded / lobed leaves on runners
    P.halo = 0.2; P.haloR = 4;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let r = 0; r < 16; r++) {
      const a = rng() * TAU;
      P.dim = 0.75 + 0.25 * (r / 16);
      const pts = wobblyLine(rng, cx + Math.cos(a) * S * 0.12 * rng(), cy + Math.sin(a) * S * 0.12 * rng(), a, S * (0.18 + rng() * 0.18), 6, 0.6);
      P.polyline(pts, 1.4, 0.8, [84, 74, 52]);
      for (let k = 0; k < 14; k++) {
        const p = along(pts, k / 14);
        const L = 26 + rng() * 14;
        const side = k % 2 ? 1 : -1;
        P.leaf({ x: p.x, y: p.y, ang: p.ang + side * (1.0 + rng() * 0.6), len: L, wid: L * 0.5, p: 0.8, q: 0.45, col: jit([40, 64, 34], rng, 0.16, 0.05), col2: jit([60, 84, 42], rng, 0.1, 0.05), mid: 0.25, veins: 0.06, veinN: 5, gloss: 0.6, tr: 0.45, fold: 0.1, conv: 0.4, roll: (rng() - 0.5) * 0.8, pitch: (rng() - 0.5) * 0.6 });
      }
    }
    P.dim = 1;
  },
  bougCushion(P, rng, ox, oy, S) {
    // top of a bougainvillea mound: leaves + scattered bracts
    P.halo = 0.22; P.haloR = 4;
    const cx = ox + S / 2, cy = oy + S / 2;
    for (let i = 0; i < 110; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.38;
      const L = 36 + rng() * 16;
      P.dim = 0.75 + 0.25 * (i / 110);
      P.leaf({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, ang: rng() * TAU, len: L, wid: L * 0.36, p: 0.82, q: 0.6, col: jit(BOUG_LEAF, rng, 0.15, 0.05), col2: jit(BOUG_LEAF2, rng, 0.1, 0.05), mid: 0.2, veins: 0.04, gloss: 0.45, tr: 0.6, fold: 0.15, conv: 0.3, roll: (rng() - 0.5), pitch: (rng() - 0.5) * 0.6 });
    }
    P.dim = 1;
    for (let i = 0; i < 12; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * S * 0.33;
      bractCluster(P, rng, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.0);
    }
  },
  bougA(P, rng, ox, oy, S, H) {
    P.halo = 0.22; P.haloR = 4;
    for (let s = 0; s < 5; s++) bougStrand(P, rng, ox + S * (0.25 + rng() * 0.5), oy + 8, H * (0.55 + rng() * 0.42), 1.0, 0.16);
  },
  bougB(P, rng, ox, oy, S, H) {
    P.halo = 0.22; P.haloR = 4;
    for (let s = 0; s < 5; s++) bougStrand(P, rng, ox + S * (0.25 + rng() * 0.5), oy + 8, H * (0.45 + rng() * 0.5), 1.0, 0.4);
  },
  jasmine(P, rng, ox, oy, S, H) {
    P.halo = 0.2; P.haloR = 4;
    for (let s = 0; s < 6; s++) jasmineStrand(P, rng, ox + S * (0.3 + rng() * 0.4), oy + 8, H * (0.5 + rng() * 0.46), 1.0);
  },
  strand(P, rng, ox, oy, S, H) {
    // plain green trailing creeper (Ficus pumila / Muehlenbeckia-like)
    P.halo = 0.2; P.haloR = 4;
    for (let s = 0; s < 6; s++) {
      const pts = [];
      let a = Math.PI / 2, px = ox + S * (0.3 + rng() * 0.4), py = oy + 8;
      const len = H * (0.5 + rng() * 0.48);
      for (let i = 0; i <= 16; i++) { pts.push([px, py]); a += (rng() - 0.5) * 0.4; a += (Math.PI / 2 - a) * 0.3; px += Math.cos(a) * len / 16; py += Math.sin(a) * len / 16; }
      P.polyline(pts, 1.4, 0.7, [76, 74, 50]);
      const nl = Math.round(len / 11);
      for (let k = 0; k < nl; k++) {
        const p = along(pts, k / nl);
        const L = (24 + rng() * 12) * (1 - (k / nl) * 0.3);
        P.leaf({ x: p.x, y: p.y, ang: p.ang + (k % 2 ? 1 : -1) * (0.9 + rng() * 0.6), len: L, wid: L * 0.45, p: 0.85, q: 0.5, col: jit([44, 72, 36], rng, 0.16, 0.05), col2: jit([70, 98, 46], rng, 0.1, 0.05), mid: 0.2, veins: 0.04, gloss: 0.55, tr: 0.55, fold: 0.1, conv: 0.35, roll: (rng() - 0.5), pitch: (rng() - 0.5) * 0.5 });
      }
    }
  },
};

// Build the raw atlas buffers (pure JS; usable from node for inspection)
export function paintAtlas() {
  const P = new Painter(ATLAS_W, ATLAS_H);
  let seed = 1;
  for (const name of Object.keys(CELLS)) {
    const [ox, oy, S, H] = cellOrigin(name);
    P.setClip(ox + 2, oy + 2, ox + S - 2, oy + H - 2);
    P.halo = 0; P.dim = 1;
    const rng = mulberry32(9100 + seed++ * 131);
    painters[name](P, rng, ox, oy, S, H);
  }
  return P;
}
