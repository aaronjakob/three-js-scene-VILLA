import * as THREE from 'three';
import { mulberry32 } from '../../core/noise.js';
import { cardGeometry, bakeAO } from './trees.js';

// Maquis, perennials, grasses, ground cover, cascading vines and agaves.
// Every plant is built from atlas sprays that radiate from a rootstock, so
// cards follow stems instead of floating in a blob.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;

export const SHRUB_KINDS = {
  // cells, radius, height, card size, card count
  lentisk: { cells: ['lentisk', 'lentisk', 'myrtle'], r: [0.7, 1.3], h: [0.7, 1.4], s: [0.55, 0.75], n: [44, 64] },
  myrtle: { cells: ['myrtle', 'shrubBroad'], r: [0.6, 1.0], h: [0.7, 1.2], s: [0.5, 0.7], n: [36, 52] },
  broad: { cells: ['shrubBroad', 'shrubBroad', 'lentisk'], r: [0.8, 1.4], h: [1.0, 1.8], s: [0.6, 0.85], n: [48, 70] },
  rosemary: { cells: ['rosemary'], r: [0.45, 0.8], h: [0.5, 0.9], s: [0.5, 0.7], n: [22, 34], upright: true },
  lavender: { cells: ['lavender'], r: [0.35, 0.55], h: [0.45, 0.7], s: [0.5, 0.65], n: [14, 20], upright: true },
  grassA: { cells: ['grassA'], r: [0.2, 0.35], h: [0.8, 1.2], s: [0.8, 1.15], n: [6, 9], tuft: true },
  grassB: { cells: ['grassB'], r: [0.15, 0.3], h: [0.4, 0.6], s: [0.45, 0.65], n: [6, 8], tuft: true },
  flowersW: { cells: ['flowersW'], r: [0.3, 0.5], h: [0.5, 0.8], s: [0.5, 0.7], n: [8, 12], upright: true },
  flowersP: { cells: ['flowersP'], r: [0.3, 0.5], h: [0.45, 0.7], s: [0.45, 0.62], n: [8, 12], upright: true },
  ivy: { cells: ['ivy'], r: [0.4, 0.7], h: [0.1, 0.2], s: [0.55, 0.8], n: [7, 11], ground: true },
  cushion: { cells: ['bougCushion', 'ivy'], r: [0.4, 0.6], h: [0.2, 0.35], s: [0.6, 0.85], n: [6, 9], ground: true },
};

export function makeShrub(kind, seed) {
  const K = SHRUB_KINDS[kind];
  const rng = mulberry32(seed * 104729 + kind.length * 7919 + 3);
  const R = K.r[0] + (K.r[1] - K.r[0]) * rng();
  const Hh = K.h[0] + (K.h[1] - K.h[0]) * rng();
  const n = Math.round(K.n[0] + (K.n[1] - K.n[0]) * rng());
  const cards = [];
  const C = V(0, Hh * 0.4, 0);
  // 2-4 sub-mounds so the outline is lumpy, not a dome
  const lobes = [];
  const nl = K.tuft || K.ground ? 1 : 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nl; i++) {
    const a = rng() * TAU, r = i === 0 ? 0 : R * (0.3 + rng() * 0.35);
    lobes.push(V(Math.cos(a) * r, Hh * (0.35 + rng() * 0.25), Math.sin(a) * r));
  }
  for (let i = 0; i < n; i++) {
    const cell = K.cells[Math.floor(rng() * K.cells.length)];
    const s = K.s[0] + (K.s[1] - K.s[0]) * rng();
    const a = rng() * TAU;
    if (K.ground) {
      const r = Math.sqrt(rng()) * R;
      const p = V(Math.cos(a) * r, 0.04 + rng() * Hh, Math.sin(a) * r);
      cards.push({ p, axis: V(Math.cos(a + 1.3), 0, Math.sin(a + 1.3)).normalize(), face: V((rng() - 0.5) * 0.4, 1, (rng() - 0.5) * 0.4).normalize(), w: s, h: s, cell, clump: V(0, -0.3, 0), roll: 0, bend: (rng() - 0.5) * 0.8, rnd: rng() });
    } else if (K.tuft) {
      // crossed vertical cards around the crown of the tussock
      const p = V(Math.cos(a) * R * 0.3 * rng(), 0, Math.sin(a) * R * 0.3 * rng());
      const lean = 0.15 + rng() * 0.2;
      cards.push({ p, axis: V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize(), face: V(Math.cos(a + 1.57), 0, Math.sin(a + 1.57)), w: s * 1.1, h: s * (Hh / K.h[1]) * 1.05, cell, clump: V(0, Hh * 0.2, 0), roll: 0, bend: (rng() - 0.5) * 1.2, rnd: rng() });
    } else {
      // spray from inside a lobe, pointing outward / upward
      const L = lobes[Math.floor(rng() * lobes.length)];
      const dir = V(Math.cos(a), K.upright ? 1.6 + rng() : 0.4 + rng() * 0.9, Math.sin(a)).normalize();
      const p = L.clone().addScaledVector(dir, R * (0.15 + rng() * 0.35)).add(V(0, -Hh * 0.25, 0));
      p.y = Math.max(0.02, p.y);
      cards.push({ p, axis: dir.clone().lerp(UP, K.upright ? 0.3 : 0.15).normalize(), face: V(Math.cos(a), 0.6, Math.sin(a)).normalize(), w: s, h: s, cell, clump: L, roll: (rng() - 0.5) * 2.4, bend: (rng() - 0.5) * 1.4, rnd: rng() });
    }
  }
  bakeAO(cards, 0.35, 1.3);
  return cardGeometry(cards, C, V(1, 1.4, 1));
}

// Cascade over a slab lip. Local frame: +x along the edge, +y up, +z outward.
// A cushion of leaves rides over the lip, strands of tall vine cells hang
// 0.5-2.5 m, the longest ones made of two stacked cards.
export function makeCascade(seed, len, flavour = 'mix') {
  const rng = mulberry32(seed * 9973 + 11);
  const cards = [];
  const W = 0.9 + rng() * 0.8;
  const pick = () => {
    const r = rng();
    if (flavour === 'green') return r < 0.6 ? 'strand' : 'jasmine';
    if (flavour === 'boug') return r < 0.55 ? 'bougA' : r < 0.8 ? 'bougB' : 'strand';
    return r < 0.3 ? 'bougA' : r < 0.42 ? 'bougB' : r < 0.7 ? 'jasmine' : 'strand';
  };
  // cushion on the lip
  const nc = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < nc; i++) {
    const x = (rng() - 0.5) * W;
    const s = 0.55 + rng() * 0.4;
    cards.push({ p: V(x, 0.12 + rng() * 0.18, -0.1 + rng() * 0.3), axis: V(1, 0, (rng() - 0.5) * 0.6).normalize(), face: V((rng() - 0.5) * 0.4, 1, 0.5 + rng() * 0.5).normalize(), w: s, h: s, cell: flavour === 'green' ? 'ivy' : rng() < 0.6 ? 'bougCushion' : 'ivy', clump: V(x, -0.4, -0.2), roll: 0, bend: 0.5, rnd: rng() });
    // the cushion also rolls over the lip
    cards.push({ p: V(x + (rng() - 0.5) * 0.2, 0.15, 0.22 + rng() * 0.1), axis: V(0, -1, 0.25).normalize(), face: V(0, 0.2, 1), w: s * 0.9, h: s * 0.6, cell: 'ivy', clump: V(x, -0.2, -0.3), roll: (rng() - 0.5) * 0.4, bend: 0.4, rnd: rng() });
  }
  // hanging strands
  const ns = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < ns; i++) {
    const x = (rng() - 0.5) * W * 0.9;
    const L = len * (0.45 + rng() * 0.55);
    const w = 0.42 + rng() * 0.3;
    const z = 0.18 + rng() * 0.16;
    const yaw = (rng() - 0.5) * 0.7;
    const face = V(Math.sin(yaw), 0.05, Math.cos(yaw)).normalize();
    const first = Math.min(L, w * 2.1);
    cards.push({ p: V(x, 0.18, z), axis: V((rng() - 0.5) * 0.15, -1, 0.08).normalize(), face, w, h: first, cell: pick(), clump: V(x, -L * 0.5, -0.4), roll: 0, bend: (rng() - 0.3) * 0.6, rnd: rng() });
    if (L > first + 0.25) {
      const w2 = w * (0.75 + rng() * 0.2);
      cards.push({ p: V(x + (rng() - 0.5) * 0.15, 0.18 - first * 0.92, z + 0.04), axis: V((rng() - 0.5) * 0.2, -1, 0.05).normalize(), face, w: w2, h: Math.min(L - first * 0.92, w2 * 2.1), cell: pick(), clump: V(x, -L * 0.7, -0.4), roll: 0, bend: (rng() - 0.3) * 0.6, rnd: rng() });
    }
  }
  for (const c of cards) c.ao = 0.6 + 0.4 * Math.min(1, Math.max(0, 1 + c.p.y / (len + 0.5)));
  return cardGeometry(cards, V(0, -len * 0.4, -0.6), V(1, 0.4, 1));
}

// Agave / aloe rosette: thick channelled blue-green leaves with a dark spine
export function makeAgave(seed, size = 1) {
  const rng = mulberry32(seed * 3571 + 5);
  const pos = [], nrm = [], col = [], idx = [];
  const n = 16 + Math.floor(rng() * 8);
  for (let i = 0; i < n; i++) {
    const az = i * 2.39996 + rng() * 0.2;
    const rank = i / n; // outer leaves first
    const L = size * (0.55 + 0.5 * (1 - rank)) * (0.85 + rng() * 0.3);
    const elev = 0.25 + rank * 1.0 + rng() * 0.15;
    const Wd = size * (0.09 + 0.03 * (1 - rank));
    const dir = V(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const side = V(-Math.sin(az), 0, Math.cos(az));
    const segs = 6;
    const base = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const droop = -t * t * L * 0.25 * (1 - rank);
      const c = dir.clone().multiplyScalar(L * t).add(V(0, droop + 0.05, 0));
      const w = Wd * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * (1 - t * 0.6);
      const nUp = V().crossVectors(side, dir).normalize();
      for (let k = -1; k <= 1; k++) {
        const p = c.clone().addScaledVector(side, k * w).addScaledVector(nUp, k === 0 ? -w * 0.35 : w * 0.12);
        pos.push(p.x, p.y, p.z);
        const nn = nUp.clone().addScaledVector(side, -k * 0.45).normalize();
        nrm.push(nn.x, nn.y, nn.z);
        const edge = k === 0 ? 0 : 1;
        const g = 0.85 + 0.15 * t;
        col.push((0.30 + edge * 0.10) * g, (0.40 + edge * 0.06) * g, (0.36 - edge * 0.02) * g);
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < 2; k++) {
        const a = base + s * 3 + k, b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function agaveMaterial() {
  return new THREE.MeshPhysicalMaterial({ name: 'agave', vertexColors: true, roughness: 0.48, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0.7, 0.78, 0.8), side: THREE.DoubleSide, envMapIntensity: 0.6 });
}
