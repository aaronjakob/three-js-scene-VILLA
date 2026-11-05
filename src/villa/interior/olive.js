import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { tube, lathe, disc, at } from './geom.js';
import { leafGeo } from './decor.js';

// Mature multi-stem olive in a honed stone planter (indoor specimen tree).
// Local space, base of the planter at y = 0. Returns [material, geometry] parts.
export function oliveTree(M, { seed = 21, height = 2.9, planterR = 0.58, planterH = 0.62 } = {}) {
  const rng = mulberry32(seed);
  const parts = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // planter: wide honed stone bowl with a soft rolled rim
  const pr = planterR, ph = planterH;
  parts.push([M.travertine, lathe([
    [0, 0], [pr * 0.78, 0], [pr * 0.84, 0.03], [pr * 0.97, ph * 0.55], [pr, ph * 0.9], [pr * 0.99, ph], [pr * 0.93, ph + 0.01],
    [pr * 0.88, ph - 0.02], [pr * 0.86, ph * 0.85], [0, ph * 0.85],
  ], 64, { wobble: 0.006, seed })]);
  // soil + moss + pebbles
  parts.push([M.moss, at(disc(pr * 0.87, pr * 0.87, 40, 3), 0, ph - 0.06, 0)]);
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, r = 0.15 + rng() * (pr * 0.7);
    const g = new THREE.SphereGeometry(0.025 + rng() * 0.02, 10, 6);
    g.scale(1, 0.55, 1.1);
    parts.push([rng() < 0.5 ? M.travertine : M.stoneBlack, at(g, Math.cos(a) * r, ph - 0.055, Math.sin(a) * r)]);
  }
  const wood = [], leaves = [];
  const base = ph - 0.06;
  const stems = 3;
  const tips = [];
  for (let s = 0; s < stems; s++) {
    const a0 = (s / stems) * Math.PI * 2 + rng() * 0.6;
    const lean = 0.12 + rng() * 0.1;
    const top = height * (0.5 + rng() * 0.12);
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const r = 0.03 + lean * t + Math.sin(t * 5 + s) * 0.04;
      const a = a0 + Math.sin(t * 3.1 + s * 2) * 0.5;
      pts.push(V(Math.cos(a) * r, base + t * (top - base), Math.sin(a) * r));
    }
    wood.push(tube(pts, (t) => 0.075 * (1 - t * 0.55), { radial: 12, gnarl: 0.28, seed: seed + s }));
    const stemCurve = new THREE.CatmullRomCurve3(pts);
    // scaffold branches from the upper half of each stem
    const nb = 3 + Math.floor(rng() * 2);
    for (let b = 0; b < nb; b++) {
      const t0 = 0.55 + (b / nb) * 0.45;
      const p0 = stemCurve.getPointAt(t0);
      const out = V(p0.x, 0, p0.z).normalize();
      const ab = Math.atan2(out.z, out.x) + (rng() - 0.5) * 1.6;
      const dir = V(Math.cos(ab) * 0.75, 0.6 + rng() * 0.4, Math.sin(ab) * 0.75).normalize();
      const len = 0.45 + rng() * 0.45;
      const bp = [p0.clone()];
      let p = p0.clone();
      for (let i = 1; i <= 5; i++) {
        dir.y -= 0.05; dir.x += (rng() - 0.5) * 0.25; dir.z += (rng() - 0.5) * 0.25; dir.normalize();
        p = p.clone().addScaledVector(dir, len / 5);
        bp.push(p);
      }
      wood.push(tube(bp, (t) => 0.032 * (1 - t * 0.7), { radial: 7, gnarl: 0.15, seed: seed * 7 + b + s * 11 }));
      const bc = new THREE.CatmullRomCurve3(bp);
      // twigs
      const nt = 5 + Math.floor(rng() * 3);
      for (let k = 0; k < nt; k++) {
        const tt = 0.35 + (k / nt) * 0.65;
        const q0 = bc.getPointAt(tt);
        const d2 = dir.clone().add(V((rng() - 0.5) * 1.2, rng() * 0.6 - 0.1, (rng() - 0.5) * 1.2)).normalize();
        const tl = 0.22 + rng() * 0.25;
        const tp = [q0.clone(), q0.clone().addScaledVector(d2, tl * 0.5).add(V(0, 0.02, 0)), q0.clone().addScaledVector(d2, tl).add(V(0, -0.03, 0))];
        wood.push(tube(tp, 0.007, { radial: 4, segs: 4, taper: (t) => 1 - t * 0.7 }));
        tips.push({ curve: new THREE.CatmullRomCurve3(tp), dir: d2 });
      }
      tips.push({ curve: bc, dir, branch: true });
    }
  }
  // leaves: clustered along twigs and branch ends, pointing out/up
  for (const { curve, dir, branch } of tips) {
    const n = branch ? 40 : 85;
    for (let i = 0; i < n; i++) {
      const t = branch ? 0.6 + rng() * 0.4 : 0.15 + rng() * 0.85;
      const p = curve.getPointAt(t);
      leaves.push(leafGeo(rng, p, 0.09, 0.095, 0.017, dir));
    }
  }
  for (const g of wood) parts.push([M.bark, g]);
  for (const g of leaves) parts.push([M.leaf, g]);
  return parts;
}
