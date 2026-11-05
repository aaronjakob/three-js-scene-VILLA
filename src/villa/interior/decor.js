import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { softBox, rbox, box, lathe, latheCap, cyl, tube, pillow, at, tint, metreUV } from './geom.js';

// Styling objects. Every builder returns a list of [material, geometry] in
// local space (y up, base at y = 0); the caller places the list in the room.

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export function xform(parts, x = 0, y = 0, z = 0, ry = 0, s = 1) {
  for (const [, g] of parts) {
    if (s !== 1) g.scale(s, s, s);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
  }
  return parts;
}

// --- books -----------------------------------------------------------------------
const COVER = [
  [0.78, 0.74, 0.66], [0.62, 0.52, 0.40], [0.30, 0.24, 0.19], [0.12, 0.11, 0.10], [0.70, 0.62, 0.50],
  [0.46, 0.40, 0.33], [0.56, 0.30, 0.20], [0.24, 0.29, 0.30], [0.82, 0.80, 0.76], [0.40, 0.42, 0.34],
  [0.66, 0.56, 0.36], [0.18, 0.20, 0.24],
];
// one hardback: page block + boards + spine (+ title band)
export function book(w, t, d, color, M, { title = true } = {}) {
  const parts = [];
  const b = 0.0035; // board thickness
  parts.push([M.pages, at(box(w - 0.006, t - 2 * b, d - 0.004), 0.002, t / 2, 0)]);
  const lin = (c) => c.map((v) => v * v);
  const c = lin(color);
  for (const yy of [b / 2, t - b / 2]) parts.push([M.cover, tint(at(box(w, b, d), 0, yy, 0), c)]);
  parts.push([M.cover, tint(at(box(b * 1.4, t, d), -w / 2 + b * 0.7, t / 2, 0), c)]);
  if (title) {
    const tc = (color[0] + color[1] + color[2]) / 3 > 0.5 ? [0.05, 0.05, 0.05] : [0.85, 0.72, 0.45];
    parts.push([M.cover, tint(at(box(0.0012, Math.min(t * 0.5, 0.012), d * 0.5), -w / 2 - 0.0004, t / 2, -d * 0.12), lin(tc))]);
  }
  return parts;
}
// stack lying flat (coffee-table books), spine toward -x
export function bookStack(rng, M, n = 3, big = true) {
  const parts = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const w = big ? 0.26 + rng() * 0.12 : 0.16 + rng() * 0.06;
    const d = big ? 0.32 + rng() * 0.1 : 0.22 + rng() * 0.05;
    const t = big ? 0.025 + rng() * 0.02 : 0.018 + rng() * 0.012;
    const bp = book(w, t, d, pick(rng, COVER), M);
    xform(bp, (rng() - 0.5) * 0.03, y, (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.25);
    parts.push(...bp);
    y += t;
  }
  return { parts, h: y };
}
// standing hardback: thickness along x, height y, spine on the +z face
export function bookUpright(h, t, d, color, M, title = true) {
  const c = color.map((v) => v * v);
  const b = 0.003;
  const parts = [
    [M.pages, at(box(t - 2 * b, h - 0.006, d - 0.004), 0, h / 2, -0.002)],
    [M.cover, tint(at(box(b, h, d), -t / 2 + b / 2, h / 2, 0), c)],
    [M.cover, tint(at(box(b, h, d), t / 2 - b / 2, h / 2, 0), c)],
    [M.cover, tint(at(box(t, h, b * 1.4), 0, h / 2, d / 2 - b * 0.7), c)],
  ];
  if (title) {
    const tc = (color[0] + color[1] + color[2]) / 3 > 0.5 ? [0.04, 0.04, 0.04] : [0.75, 0.55, 0.25];
    parts.push([M.cover, tint(at(box(t * 0.62, 0.014, 0.0012), 0, h * 0.74, d / 2 + 0.0004), tc)]);
  }
  return parts;
}
// upright books along +x on a shelf; returns used width
export function bookRow(rng, M, maxW) {
  const parts = [];
  let x = 0;
  const n = 4 + Math.floor(rng() * 7);
  const hBase = 0.2 + rng() * 0.08;
  for (let i = 0; i < n && x < maxW - 0.03; i++) {
    const t = 0.018 + rng() * 0.03;
    const h = hBase + (rng() - 0.5) * 0.06;
    const d = 0.15 + rng() * 0.06;
    const bp = bookUpright(h, t, d, pick(rng, COVER), M, rng() < 0.7);
    xform(bp, x + t / 2, 0, 0);
    parts.push(...bp);
    x += t + 0.001;
  }
  // a leaning book at the end
  if (rng() < 0.5 && x < maxW - 0.1) {
    const t = 0.022, h = hBase;
    const bp = bookUpright(h, t, 0.17, pick(rng, COVER), M);
    for (const [, g] of bp) { g.translate(t / 2, 0, 0); g.rotateZ(-0.3); }
    xform(bp, x + 0.005, 0.0, 0);
    parts.push(...bp);
    x += 0.09;
  }
  return { parts, w: x };
}

// --- ceramics -----------------------------------------------------------------------
const PROFILES = {
  amphora: [[0, 0], [0.06, 0], [0.075, 0.01], [0.11, 0.09], [0.12, 0.16], [0.095, 0.25], [0.05, 0.31], [0.042, 0.36], [0.05, 0.38], [0.044, 0.385]],
  bottle: [[0, 0], [0.05, 0], [0.065, 0.012], [0.07, 0.12], [0.06, 0.17], [0.025, 0.22], [0.018, 0.33], [0.022, 0.34], [0.016, 0.345]],
  moon: [[0, 0], [0.05, 0], [0.09, 0.03], [0.125, 0.1], [0.13, 0.15], [0.115, 0.22], [0.07, 0.27], [0.055, 0.285], [0.058, 0.295], [0.05, 0.297]],
  cylinder: [[0, 0], [0.065, 0], [0.07, 0.005], [0.07, 0.3], [0.064, 0.302]],
  bud: [[0, 0], [0.035, 0], [0.05, 0.03], [0.05, 0.07], [0.025, 0.12], [0.012, 0.16], [0.016, 0.17], [0.011, 0.172]],
  tall: [[0, 0], [0.05, 0], [0.06, 0.03], [0.07, 0.3], [0.08, 0.52], [0.074, 0.53]],
  bowl: [[0, 0], [0.06, 0], [0.13, 0.04], [0.17, 0.09], [0.175, 0.1], [0.165, 0.1], [0.12, 0.05], [0.0, 0.03]],
  shallow: [[0, 0], [0.1, 0], [0.2, 0.025], [0.25, 0.055], [0.255, 0.06], [0.245, 0.06], [0.19, 0.035], [0, 0.02]],
  pebble: [[0, 0], [0.08, 0.0], [0.13, 0.03], [0.14, 0.06], [0.11, 0.1], [0.04, 0.12], [0.03, 0.115], [0.0, 0.11]],
  jar: [[0, 0], [0.07, 0], [0.09, 0.04], [0.1, 0.12], [0.085, 0.19], [0.06, 0.21], [0.06, 0.23], [0.05, 0.232]],
  urn: [[0, 0], [0.08, 0], [0.09, 0.02], [0.16, 0.18], [0.17, 0.3], [0.14, 0.44], [0.1, 0.5], [0.1, 0.54], [0.09, 0.545]],
  floorVase: [[0, 0], [0.12, 0], [0.16, 0.06], [0.2, 0.3], [0.19, 0.55], [0.12, 0.78], [0.1, 0.86], [0.11, 0.9], [0.1, 0.905]],
};
export function vessel(kind, M, mat, s = 1, o = {}) {
  const prof = PROFILES[kind].map(([r, y]) => [r * s, y * s]);
  // open vessels get an inner wall
  const g = lathe(prof, o.seg ?? 40, { wobble: o.wobble ?? 0.012, seed: o.seed ?? 1, flutes: o.flutes ?? 0, fluteDepth: o.fluteDepth ?? 0, squash: o.squash ?? 1 });
  return [[mat, g]];
}

// pillar candles on a stone tray (with lit flames)
export function candleGroup(rng, M, lit = true) {
  const parts = [];
  parts.push([M.travertineDark, at(rbox(0.36, 0.02, 0.18, 0.006, 2), 0, 0.01, 0)]);
  const hs = [0.16, 0.11, 0.2];
  for (let i = 0; i < 3; i++) {
    const h = hs[i] * (0.9 + rng() * 0.2), r = 0.035 + rng() * 0.012;
    const x = -0.11 + i * 0.11;
    parts.push([M.wax, at(cyl(r, r, h, 24), x, 0.02, 0)]);
    if (lit) {
      parts.push([M.blackSteel, at(cyl(0.0012, 0.0012, 0.012, 4), x, 0.02 + h, 0)]);
      const fl = lathe([[0, 0], [0.004, 0.004], [0.005, 0.01], [0.0025, 0.02], [0, 0.026]], 8, { wobble: 0 });
      parts.push([M.candle, at(fl, x, 0.03 + h, 0)]);
    }
  }
  return parts;
}

// --- sculptures -----------------------------------------------------------------------
export function sculpture(kind, M) {
  const parts = [];
  if (kind === 'ring') {
    const g = new THREE.TorusGeometry(0.2, 0.055, 24, 64);
    g.rotateY(0.3);
    parts.push([M.bronze, at(g, 0, 0.27, 0)]);
    parts.push([M.stoneBlack, at(rbox(0.16, 0.05, 0.12, 0.01, 2), 0, 0.025, 0)]);
  } else if (kind === 'stack') {
    let y = 0;
    const rs = [[0.15, 0.07, 0.12], [0.12, 0.06, 0.1], [0.09, 0.055, 0.08], [0.06, 0.045, 0.05]];
    rs.forEach(([rx, ry, rz], i) => {
      const g = new THREE.SphereGeometry(1, 32, 16);
      g.scale(rx, ry, rz);
      metreUV(g);
      g.rotateY(i * 0.7);
      parts.push([i % 2 ? M.stoneBlack : M.travertine, at(g, (i % 2 ? 0.01 : -0.01), y + ry * 0.92, 0)]);
      y += ry * 1.8;
    });
  } else if (kind === 'twist') {
    const prof = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push([0.05 + 0.06 * Math.sin(t * Math.PI) ** 0.8, t * 0.62]); }
    const g = lathe(prof, 48, { flutes: 6, fluteDepth: 0.35, wobble: 0.02, seed: 7 });
    // twist around y
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), a = y * 4.2, c = Math.cos(a), s = Math.sin(a);
      const x = p.getX(i), z = p.getZ(i);
      p.setXYZ(i, x * c - z * s, y, x * s + z * c);
    }
    g.computeVertexNormals();
    parts.push([M.glazeWhite, g]);
  } else if (kind === 'head') {
    // abstract ovoid form on a block
    const g = new THREE.SphereGeometry(1, 40, 24);
    g.scale(0.11, 0.2, 0.09);
    metreUV(g);
    parts.push([M.bronze, at(g, 0, 0.27, 0)]);
    parts.push([M.travertine, at(rbox(0.12, 0.07, 0.12, 0.008, 2), 0, 0.035, 0)]);
  }
  return parts;
}

// plinth (travertine / plaster) with a sculpture on top
export function plinth(M, w = 0.4, h = 1.0, mat = null) {
  return [[mat ?? M.travertine, at(rbox(w, h, w, 0.012, 2), 0, h / 2, 0)]];
}

// --- lamps -----------------------------------------------------------------------
export function tableLamp(M, { h = 0.62, shadeR = 0.19, base = 'ceramic', mat = null } = {}) {
  const parts = [];
  const bh = h * 0.55;
  if (base === 'ceramic') {
    parts.push([mat ?? M.glazeSand, lathe([[0, 0], [0.06, 0], [0.08, 0.02], [0.11, bh * 0.45], [0.09, bh * 0.85], [0.03, bh], [0.02, bh + 0.02], [0, bh + 0.02]], 40, { wobble: 0.01, seed: 3 })]);
  } else {
    parts.push([mat ?? M.travertine, at(cyl(0.09, 0.1, bh, 32), 0, 0, 0)]);
  }
  parts.push([M.brass, at(cyl(0.006, 0.006, h - bh, 8), 0, bh, 0)]);
  // drum shade (open, double sided), slightly tapered
  const sh = shadeR, sH = shadeR * 1.05;
  const shade = new THREE.CylinderGeometry(sh * 0.92, sh, sH, 40, 3, true);
  parts.push([M.shade, at(shade, 0, h - sH * 0.25, 0)]);
  parts.push([M.bulb, at(new THREE.SphereGeometry(0.03, 12, 8), 0, h - sH * 0.3, 0)]);
  return { parts, lampY: h - sH * 0.25 };
}
export function floorLamp(M, { h = 1.62, shadeR = 0.25 } = {}) {
  const parts = [];
  parts.push([M.bronze, at(cyl(0.16, 0.17, 0.025, 40), 0, 0, 0)]);
  parts.push([M.bronze, at(cyl(0.011, 0.013, h - 0.1, 10), 0, 0.025, 0)]);
  const sH = shadeR * 1.1;
  parts.push([M.shade, at(new THREE.CylinderGeometry(shadeR * 0.9, shadeR, sH, 48, 3, true), 0, h - sH * 0.3, 0)]);
  parts.push([M.bulb, at(new THREE.SphereGeometry(0.035, 12, 8), 0, h - sH * 0.35, 0)]);
  return { parts, lampY: h - sH * 0.3 };
}
export function globeLamp(M, r = 0.11) {
  return {
    parts: [
      [M.brass, at(cyl(0.05, 0.055, 0.03, 32), 0, 0, 0)],
      [M.opal, at(new THREE.SphereGeometry(r, 32, 20), 0, 0.03 + r * 0.95, 0)],
    ],
    lampY: 0.03 + r,
  };
}

// --- art -----------------------------------------------------------------------------
// framed canvas facing +z; frame: 'float' (walnut float frame) or 'black'
export function framedArt(mat, w, h, M, frame = 'float') {
  const parts = [];
  const d = 0.035;
  const cv = new THREE.PlaneGeometry(w, h, 8, 8);
  // plane uv 0..1 already maps the painting
  parts.push([mat, at(cv, 0, h / 2, d)]);
  // canvas edges
  parts.push([M.linenWhite, at(box(w, h, d * 0.9), 0, h / 2, d / 2 - 0.001)]);
  const fm = frame === 'black' ? M.blackSteel : M.walnutDeep;
  const gap = 0.012, t = 0.012, fd = d + 0.012;
  const W = w + 2 * gap + 2 * t, H = h + 2 * gap + 2 * t;
  parts.push([fm, at(rbox(W, t, fd, 0.002, 1), 0, H - t / 2 - gap - t, fd / 2)]);
  parts.push([fm, at(rbox(W, t, fd, 0.002, 1), 0, -gap - t / 2, fd / 2)]);
  parts.push([fm, at(rbox(t, H, fd, 0.002, 1), -W / 2 + t / 2, h / 2, fd / 2)]);
  parts.push([fm, at(rbox(t, H, fd, 0.002, 1), W / 2 - t / 2, h / 2, fd / 2)]);
  parts.push([M.blackSteel, at(box(W - 2 * t, H - 2 * t, 0.004), 0, h / 2, 0.002)]);
  return parts;
}
// brass picture light above a frame (bar + arm); emits from the bar underside
export function pictureLight(M, w) {
  return [
    [M.brass, at(cyl(0.018, 0.018, w, 24), 0, 0, 0).rotateZ(Math.PI / 2).translate(0, 0, 0.16)],
    [M.brass, at(cyl(0.006, 0.006, 0.17, 8), 0, 0, 0).rotateX(Math.PI / 2).translate(0, 0, 0.085)],
    [M.ledStrip, at(box(w * 0.92, 0.004, 0.012), 0, -0.016, 0.165)],
  ];
}

// --- textiles -----------------------------------------------------------------------
export function scatterCushion(rng, mat, size = 0.5, t = 0.16, lumbar = false) {
  const w = lumbar ? size * 1.3 : size, h = lumbar ? size * 0.6 : size;
  const g = pillow(w, h, t, { seed: Math.floor(rng() * 1000), chop: lumbar ? 0 : 0.035, bow: 0.08, wrinkle: 0.006 });
  return [[mat, g]];
}

// throw draped over a seat front: lies on the seat (depth sd at height sy),
// rolls over the front edge and hangs down with folds.  x = width, front = +z
export function drapedThrow(mat, { w = 1.0, onSeat = 0.45, hang = 0.32, seatY = 0.45, edgeR = 0.08, seed = 3 } = {}) {
  const nu = 40, nv = 36;
  const rng = mulberry32(seed);
  const ph = rng() * 6;
  const pos = [], uv = [], idx = [];
  const L = onSeat + (Math.PI / 2) * edgeR + hang;
  for (let j = 0; j <= nv; j++) {
    const s = (j / nv) * L;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      let x = (u - 0.5) * w;
      let y, z;
      let fold;
      if (s < onSeat) {
        y = seatY + 0.012; z = -onSeat + s;
        fold = 0.012 * Math.sin(x * 22 + ph) * Math.sin((s / onSeat) * Math.PI);
        y += Math.max(0, fold);
      } else if (s < onSeat + (Math.PI / 2) * edgeR) {
        const a = (s - onSeat) / edgeR;
        y = seatY - edgeR + Math.cos(a) * (edgeR + 0.012);
        z = Math.sin(a) * (edgeR + 0.012);
        fold = 0;
      } else {
        const hs = s - onSeat - (Math.PI / 2) * edgeR;
        const k = hs / hang;
        y = seatY - edgeR - hs;
        fold = (0.02 + 0.05 * k) * Math.sin(x * 14 + ph + k * 0.8) + 0.015 * Math.sin(x * 31 + ph * 2);
        z = edgeR + 0.012 + Math.max(0, fold) + 0.01 * k;
        x *= 1 - 0.06 * k * Math.cos(x * 14 + ph);
      }
      pos.push(x, y, z);
      uv.push(x, s);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return [[mat, g]];
}

// folded throw (rectangular stack of folds) for bed ends / ottomans
export function foldedThrow(mat, w = 0.6, d = 0.4, layers = 3) {
  return [[mat, softBox(w, 0.018 * layers, d, { r: 0.02, crown: 0.004, seam: null, wrinkle: 0.002, step: 0.05, k: 3 })]];
}

// --- fruit bowl / branches ------------------------------------------------------------
export function fruitBowl(rng, M, bowlMat, fruitColor = [0.85, 0.66, 0.12]) {
  const parts = vessel('shallow', M, bowlMat, 1.0, { seed: 5 });
  const fruits = [];
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.13;
    const s = 0.036 + rng() * 0.008;
    const g = new THREE.SphereGeometry(s, 16, 12);
    g.scale(1, 0.92, 1.12);
    g.rotateY(rng() * 3);
    const lift = i < 5 ? 0.045 : 0.1;
    fruits.push(tint(at(g, Math.cos(a) * r, lift + s * 0.6, Math.sin(a) * r), fruitColor.map((c) => c * (0.9 + rng() * 0.2))));
  }
  for (const g of fruits) parts.push([M.paint, g]);
  return parts;
}

// olive / eucalyptus branches in a vase (coffee table, dining centre)
export function branches(rng, M, h = 0.55, spread = 0.25) {
  const wood = [], leaves = [];
  for (let b = 0; b < 5; b++) {
    const a = rng() * Math.PI * 2;
    const pts = [V3(0, 0, 0)];
    let p = V3(0, 0, 0);
    const dir = V3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize();
    const L = h * (0.7 + rng() * 0.5);
    for (let i = 1; i <= 5; i++) {
      p = p.clone().addScaledVector(dir, L / 5).add(V3((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.03));
      dir.x += Math.cos(a) * 0.12; dir.z += Math.sin(a) * 0.12; dir.normalize();
      pts.push(p);
    }
    wood.push(tube(pts, 0.004, { radial: 5, segs: 10, taper: (t) => 1 - t * 0.6 }));
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let k = 0; k < 22; k++) {
      const t = 0.2 + rng() * 0.8;
      const q = curve.getPointAt(t);
      leaves.push(leafGeo(rng, q, spread * 0.25));
    }
  }
  const parts = [];
  for (const g of wood) parts.push([M.bark, g]);
  for (const g of leaves) parts.push([M.leaf, g]);
  return parts;
}

// single narrow olive leaf (two triangles folded), random orientation near p
const OLIVE_TOP = [0.2, 0.25, 0.14], OLIVE_UNDER = [0.48, 0.5, 0.4];
export function leafGeo(rng, p, jitter = 0.02, len = 0.07, wid = 0.012, up = null) {
  const g = new THREE.BufferGeometry();
  const l = len * (0.7 + rng() * 0.5), w = wid * (0.8 + rng() * 0.4);
  const pos = [0, 0, 0, w / 2, l * 0.45, 0.004, 0, l, 0, -w / 2, l * 0.45, 0.004];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0, 1, 0.45, 0.5, 1, 0, 0.45], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const under = rng() < 0.3;
  const base = under ? OLIVE_UNDER : OLIVE_TOP;
  const v = 0.8 + rng() * 0.4;
  const c = [base[0] * v, base[1] * v, base[2] * v];
  g.setAttribute('color', new THREE.Float32BufferAttribute([...c, ...c, ...c, ...c], 3));
  const e = new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
  if (up) {
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), up.clone().add(V3((rng() - 0.5) * 1.6, (rng() - 0.3) * 1.2, (rng() - 0.5) * 1.6)).normalize());
    g.applyQuaternion(q);
  } else g.rotateX(e.x).rotateY(e.y).rotateZ(e.z);
  g.translate(p.x + (rng() - 0.5) * jitter, p.y + (rng() - 0.5) * jitter, p.z + (rng() - 0.5) * jitter);
  g.computeVertexNormals();
  return g;
}

// small trailing plant in a pot (shelves)
export function shelfPlant(rng, M, potMat) {
  const parts = vessel('jar', M, potMat, 0.6, { seed: Math.floor(rng() * 99) });
  const leaves = [];
  for (let s = 0; s < 6; s++) {
    const a = rng() * Math.PI * 2;
    const pts = [V3(0, 0.13, 0)];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      pts.push(V3(Math.cos(a) * (0.05 + t * 0.12), 0.13 + Math.sin(t * 2.2) * 0.06 - t * t * 0.22 * (s % 2), Math.sin(a) * (0.05 + t * 0.12)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let k = 0; k < 9; k++) {
      const q = curve.getPointAt(k / 9);
      const g = leafGeo(rng, q, 0.01, 0.045, 0.03);
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, 0.1 + rng() * 0.04, 0.22 + rng() * 0.06, 0.07);
      leaves.push(g);
    }
  }
  for (const g of leaves) parts.push([M.leaf, g]);
  return parts;
}
