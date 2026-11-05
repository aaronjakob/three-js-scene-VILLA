import * as THREE from 'three';
import { mulberry32, Simplex, smoothstep } from '../core/noise.js';
import { materials } from '../materials/library.js';
import { LEVEL } from '../core/world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  smooth, offset, pointInPoly, distToPoly, ellipse, resample, ccw,
  deckOutline, poolOutline, L1_PTS, ROOF_PTS, UPPER_PTS, ATRIUM, COURT, DRIVE_PTS, FIREPIT, FIRE_STAIR_PTS,
} from '../architecture/plan.js';
import { polyProject } from './terrain.js';
import { VIEWS } from '../core/anchors.js';
import { makeTreeVariant } from './flora/trees.js';
import { makeShrub, makeCascade, makeAgave, agaveMaterial } from './flora/shrubs.js';
import { foliageMaterial, barkMaterial } from './flora/material.js';
import { buildFarForest } from './flora/forest.js';
import { buildIndoorPlants } from './flora/indoor.js';

// Art-directed planting: no tree may stand in the sightline of an exterior
// camera between the lens and its subject (shrubs stay).
const SIGHTLINES = VIEWS.filter((v) => !v.interior).map((v) => ({ a: v.position, b: v.target }));
const EXT_CAMS = VIEWS.filter((v) => !v.interior).map((v) => v.position);
function blocksSightline(x, y, z, height = 8, near = 26) {
  for (const { a, b } of SIGHTLINES) {
    // anything tall within `near` metres in front of the lens fills the frame
    const fx = b[0] - a[0], fy = b[1] - a[1];
    const dx = x - a[0], dy = y - a[1];
    const dd = Math.hypot(dx, dy);
    if (dd < near && (dx * fx + dy * fy) > 0 && z + height > a[2] - 9) return true;
    // elevated lenses look steeply down: clear the canopy right below/in front too
    const lift = a[2] - z;
    if (height > 3 && lift > 14 && dd < 18 + lift * 0.9 && (dx * fx + dy * fy) > -0.2 * dd * Math.hypot(fx, fy)) return true;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L2 = ex * ex + ey * ey;
    let t = ((x - a[0]) * ex + (y - a[1]) * ey) / L2;
    if (t < 0.04 || t > 1.05) continue;
    const px = a[0] + ex * t, py = a[1] + ey * t;
    const d = Math.hypot(x - px, y - py);
    const lineZ = a[2] + (b[2] - a[2]) * t;
    if (z + height < lineZ - 2) continue;
    const r = 3.5 + Math.sqrt(L2) * t * 0.12;
    if (d < r) return true;
  }
  return false;
}

// Detail tier of a tree from its distance to the villa and to the exterior
// cameras (static, so every still and every camera sees the same world):
// 0 = full skeleton + twig sprays, 1 = limbs + clump cards, 2 = trunk + clumps.
function treeLod(x, y) {
  const dv = Math.hypot(x, y - 3);
  let dc = Infinity;
  for (const c of EXT_CAMS) dc = Math.min(dc, Math.hypot(x - c[0], y - c[1]));
  if (dv < 30 || dc < 24) return 0;
  if (dv < 110 || dc < 60) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
export function buildVegetation(ctx) {
  const { scene, field, quality } = ctx;
  const root = new THREE.Group();
  root.name = 'vegetation';
  scene.add(root);
  const leafMat = foliageMaterial({ msaa: quality.msaa });
  const density = quality.vegetation ?? 1;
  const rng = mulberry32(4242);
  const nz = new Simplex(77);

  // exclusion zones (plan coords)
  const deck = deckOutline();
  const deckPad = offset(deck, 1.6);
  const roof = ccw(smooth(ROOF_PTS, 200));
  const l1 = ccw(smooth(L1_PTS, 220));
  const upper = ccw(smooth(UPPER_PTS, 200));
  const poolPad = offset(poolOutline(), 1.4);
  const canopy = offset(l1, 0.6);
  const blocked = (x, y) => {
    if (pointInPoly(x, y, deckPad)) return true;
    if (pointInPoly(x, y, poolPad) || pointInPoly(x, y, canopy)) return true; // nothing grows in the pool or under slabs
    if (Math.hypot(x - COURT.cx, y - COURT.cy) < COURT.r + 0.6) return true;
    if (Math.hypot(x - FIREPIT.cx, y - FIREPIT.cy) < FIREPIT.r + 0.8) return true;
    if (polyProject(FIRE_STAIR_PTS, x, y).d < 1.6) return true;
    if (y > 20 && polyProject(DRIVE_PTS, x, y).d < 4.2) return true;
    // waterfall corridor
    if (Math.hypot(x + 10.6, y + 14.2) < 3.0) return true;
    return false;
  };

  // --- variants ----------------------------------------------------------------
  const nVar = { pine: 7, aleppo: 5, oak: 8, olive: 7, cypress: 4 };
  const trees = {};
  for (const sp of Object.keys(nVar)) {
    trees[sp] = [];
    for (let i = 0; i < nVar[sp]; i++) trees[sp].push(makeTreeVariant(sp, i + 1 + sp.length * 31));
  }
  const shrubKinds = { lentisk: 4, myrtle: 3, broad: 3, rosemary: 3, lavender: 3, grassA: 3, grassB: 3, flowersW: 3, flowersP: 3, ivy: 3, cushion: 2 };
  const shrubs = {};
  for (const [k, n] of Object.entries(shrubKinds)) {
    shrubs[k] = [];
    for (let i = 0; i < n; i++) shrubs[k].push(makeShrub(k, i + 3));
  }
  const agaves = [0, 1, 2, 3].map((i) => makeAgave(i + 1, 0.8 + i * 0.15));
  const agaveMat = agaveMaterial();

  // instance collections: key -> geometry + material + matrices + tints
  const inst = new Map();
  const push = (key, geo, mat, m, tint, far, shadow = true) => {
    const k = key + (far ? '|far' : '');
    if (!inst.has(k)) inst.set(k, { geo, mat, mats: [], cols: [], far, shadow });
    const e = inst.get(k);
    e.mats.push(m);
    e.cols.push(tint);
  };
  const mtx = (x, y, z, s, rotY, tilt = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (rng() - 0.5), rotY, tilt * (rng() - 0.5)));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, z, -y), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.2), s));
  };

  const placeTree = (sp, x, y, z, s, lodOverride) => {
    const vi = Math.floor(rng() * trees[sp].length);
    const v = trees[sp][vi];
    const lod = lodOverride ?? treeLod(x, y);
    const far = Math.hypot(x, y - 5) > 85;
    const r = rng(), r2 = rng();
    const tint = sp === 'olive'
      ? new THREE.Color(0.94 + r * 0.12, 0.95 + r * 0.1, 0.9 + r2 * 0.14)
      : new THREE.Color(0.82 + r * 0.26, 0.86 + r * 0.2, 0.74 + r2 * 0.3);
    const m = mtx(x, y, z - 0.05, s, rng() * Math.PI * 2, sp === 'pine' || sp === 'aleppo' ? 0.2 : 0.1);
    const L = v.lods[lod];
    push(`${sp}-${vi}-w${lod}`, L.wood, barkMaterial(v.bark), m, new THREE.Color(0.9 + r2 * 0.2, 0.9 + r2 * 0.15, 0.9 + r2 * 0.1), far, !far);
    push(`${sp}-${vi}-l${lod}`, L.leaves, leafMat, m, tint, far, !far);
  };
  const MAQUIS = ['lentisk', 'lentisk', 'lentisk', 'myrtle', 'myrtle', 'broad', 'rosemary', 'rosemary', 'grassB', 'grassB', 'grassA', 'lavender', 'flowersW', 'ivy'];
  const placeShrub = (kind, x, y, z, s, shadow = true) => {
    const set = shrubs[kind];
    const vi = Math.floor(rng() * set.length);
    const r = rng();
    const t = new THREE.Color(0.86 + r * 0.24, 0.86 + r * 0.18, 0.76 + rng() * 0.26);
    const far = Math.hypot(x, y - 5) > 85;
    push(`${kind}-${vi}`, set[vi], leafMat, mtx(x, y, z - 0.04, s, rng() * Math.PI * 2, 0.16), t, far, shadow && !far);
  };
  const placeAgave = (x, y, z, s) => {
    const vi = Math.floor(rng() * agaves.length);
    const g = 0.9 + rng() * 0.2;
    push(`agave-${vi}`, agaves[vi], agaveMat, mtx(x, y, z - 0.02, s, rng() * Math.PI * 2, 0.08), new THREE.Color(g, g, g), false, true);
  };

  // --- natural scatter around the site (0..320 m) ----------------------------
  const R = 320;
  const attempts = Math.round(26000 * density);
  for (let i = 0; i < attempts; i++) {
    // denser sampling near the villa
    const rr = Math.pow(rng(), 1.6) * R;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr + 20;
    if (blocked(x, y)) continue;
    const h = field.height(x, y);
    if (h < 1.2) continue;
    const slope = field.slope(x, y, 0.8);
    const patch = nz.fbm2(x / 40, y / 40, 3);
    const nearSea = h < 6;
    if (slope > 0.72) continue;
    const r = rng();
    // keep the cliff below the pool, waterfall and firepit open to view (photos)
    const viewCorridor = y < -11 && y > -70 && x > -18 && x < 26;
    if (slope < 0.5 && patch > -0.1 && r < 0.28 && !viewCorridor && !blocksSightline(x, y, h)) {
      // stone and Aleppo pines on the coast / cliff tops, holm oaks inland
      const coastal = h < 40 || y < 0;
      const q = rng();
      const sp = coastal ? (q < 0.45 ? 'pine' : q < 0.72 ? 'aleppo' : 'oak') : q < 0.2 ? 'pine' : q < 0.3 ? 'aleppo' : q < 0.36 ? 'cypress' : q < 0.42 ? 'olive' : 'oak';
      if (nearSea && sp !== 'pine' && sp !== 'aleppo') continue;
      placeTree(sp, x, y, h, 0.75 + rng() * 0.5);
    } else if (r < 0.92) {
      if (blocksSightline(x, y, h, 2.2, 13)) {
        // close to a lens: low, soft foreground planting instead of bare ground
        if (rng() < 0.85) placeShrub(['grassA', 'grassB', 'lavender', 'rosemary', 'flowersW', 'flowersP'][Math.floor(rng() * 6)], x, y, h, 0.45 + rng() * 0.3);
        continue;
      }
      // steep ground: low rosemary / grasses; flats: lentisk & myrtle masses
      const kind = slope > 0.45 ? (rng() < 0.5 ? 'rosemary' : 'grassB') : MAQUIS[Math.floor(rng() * MAQUIS.length)];
      placeShrub(kind, x, y, h, (0.75 + rng() * 0.75) * (slope > 0.45 ? 0.85 : 1.1) * (viewCorridor ? 0.8 : 1));
    }
  }

  // --- outer ring 320..650 m: low-detail trees so ridges read as real canopy ---
  for (let i = 0; i < 7000 * density; i++) {
    const rr = Math.sqrt(320 * 320 + rng() * (650 * 650 - 320 * 320));
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr + 20;
    const h = field.height(x, y);
    if (h < 2) continue;
    if (field.slope(x, y, 1.5) > 0.45) continue;
    if (nz.fbm2(x / 60, y / 60, 3) < -0.2) continue;
    if (blocksSightline(x, y, h)) continue;
    const q = rng();
    const sp = h < 30 ? (q < 0.45 ? 'pine' : q < 0.65 ? 'aleppo' : 'oak') : q < 0.25 ? 'pine' : 'oak';
    placeTree(sp, x, y, h, 0.85 + rng() * 0.5, 2);
  }

  // --- foreground planting for eye-level exterior lenses -----------------------
  // (architectural photographers frame with low planting, never bare ground)
  for (const v of VIEWS) {
    if (v.interior) continue;
    const [cx, cy, cz] = v.position;
    const g0 = field.height(cx, cy);
    if (cz - g0 > 6) continue;
    const dx = v.target[0] - cx, dy = v.target[1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    for (let i = 0; i < 260; i++) {
      const d = 2.2 + rng() * 11;
      const lat = (rng() * 2 - 1) * d * 0.8;
      const x = cx + ux * d - uy * lat, y = cy + uy * d + ux * lat;
      if (blocked(x, y)) continue;
      const h = field.height(x, y);
      if (h < 1 || Math.abs(h - g0) > 3) continue;
      const kind = ['grassA', 'grassB', 'lavender', 'lavender', 'rosemary', 'flowersW', 'flowersP', 'myrtle'][Math.floor(rng() * 8)];
      placeShrub(kind, x, y, h, (0.38 + rng() * 0.32) * (d < 5 ? 0.8 : 1));
    }
  }

  // --- curated planting near the house ---------------------------------------
  // entry: one mature sculptural olive in the ring planter
  {
    const v = trees.olive[0];
    const m = new THREE.Matrix4().compose(new THREE.Vector3(COURT.cx, 18.32, -COURT.cy), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8), new THREE.Vector3(1.45, 1.35, 1.45));
    push('olive-hero-w', v.lods[0].wood, barkMaterial('olive'), m, new THREE.Color(1, 1, 1), false);
    push('olive-hero-l', v.lods[0].leaves, leafMat, m, new THREE.Color(1, 1, 1), false);
  }
  // ring planter: groundcover, lavender, grasses, white perennials
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (COURT.planterR - 0.45);
    const k = r < 0.9 ? 'ivy' : ['ivy', 'lavender', 'grassB', 'flowersW', 'ivy'][Math.floor(rng() * 5)];
    placeShrub(k, COURT.cx + Math.cos(a) * r, COURT.cy + Math.sin(a) * r, 18.38, 0.6 + rng() * 0.35, k !== 'ivy');
  }
  // trees framing the court
  for (const [x, y, s] of [[-8.5, 25, 1.05], [14.5, 25, 0.95], [-8, 33, 1.1], [14, 34, 0.9], [-11.5, 20.5, 0.85]]) placeTree('olive', x, y, field.height(x, y), s, 0);
  for (const [x, y] of [[-12.5, 16], [16.5, 17.5], [19.5, 14], [-15.5, 13.5]]) placeTree('cypress', x, y, field.height(x, y), 0.9, 0);
  // around the court perimeter: Mediterranean border (lavender, rosemary, grasses, agaves)
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const r = COURT.r + 0.9 + rng() * 3.5;
    const x = COURT.cx + Math.cos(a) * r, y = COURT.cy + Math.sin(a) * r;
    if (y < 13 || (y > 28 && Math.abs(x - 3.5) < 4)) continue;
    if (blocksSightline(x, y, field.height(x, y), 2.0, 13)) continue;
    const q = rng();
    const h = field.height(x, y);
    if (q < 0.08 && r < COURT.r + 2.5) placeAgave(x, y, h, 0.9 + rng() * 0.5);
    else placeShrub(q < 0.3 ? 'lavender' : q < 0.45 ? 'rosemary' : q < 0.6 ? 'grassA' : q < 0.72 ? 'flowersP' : q < 0.85 ? 'myrtle' : 'lentisk', x, y, h, 0.8 + rng() * 0.6);
  }
  // deck planters (olives in stone planters) on the terraces
  const planterGeo = [];
  const M = materials(quality);
  for (const [x, y, s] of [[-19.4, -5.6, 0.75], [18.6, -6.0, 0.8], [-14.6, 9.6, 0.7]]) {
    const pg = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0.85, 0.7), new THREE.Vector2(0.78, 0.72), new THREE.Vector2(0.7, 0.62), new THREE.Vector2(0, 0.62)], 48);
    pg.translate(x, LEVEL.main, -y);
    planterGeo.push(pg);
    placeTree('olive', x, y, LEVEL.main + 0.62, s, 0);
    for (let k = 0; k < 4; k++) {
      const a = rng() * Math.PI * 2, r = 0.25 + rng() * 0.4;
      placeShrub(k % 2 ? 'ivy' : 'grassB', x + Math.cos(a) * r, y + Math.sin(a) * r, LEVEL.main + 0.62, 0.5, false);
    }
  }
  const planters = new THREE.Mesh(mergeGeometries(planterGeo), M.planter);
  planters.castShadow = planters.receiveShadow = true;
  root.add(planters);
  // agave / aloe accents at the terrace ends and the firepit stair head
  for (const [x, y] of [[21.4, -14.6], [22.0, -12.4], [-22.6, 3.8], [-22.2, 6.2], [17.2, -21.6], [9.2, -22.4]]) {
    if (blocked(x, y)) continue;
    placeAgave(x, y, field.height(x, y), 0.9 + rng() * 0.4);
  }

  // --- roof garden (ref 10: perennials, grasses, flowering patches, small trees) ---
  {
    const soil = offset(roof, -0.55);
    const atr = ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 1.0, ATRIUM.ry + 1.0, 64, ATRIUM.rot);
    const soilShape = new THREE.Shape(soil);
    soilShape.holes.push(new THREE.Path(atr.slice().reverse()));
    const sg = new THREE.ShapeGeometry(soilShape, 6);
    sg.rotateX(-Math.PI / 2);
    sg.translate(0, LEVEL.roof + 0.22, 0);
    const soilMesh = new THREE.Mesh(sg, groundMaterial());
    soilMesh.receiveShadow = true;
    root.add(soilMesh);
    const zr = LEVEL.roof + 0.22;
    // drifts: a low-frequency field decides which planting dominates where
    const drift = new Simplex(4711);
    let placed = 0;
    for (let i = 0; i < 3000 * density && placed < 1000 * density; i++) {
      const x = -20 + rng() * 40, y = -10.5 + rng() * 22.5;
      if (!pointInPoly(x, y, soil) || pointInPoly(x, y, atr)) continue;
      placed++;
      const d = drift.fbm2(x / 7, y / 7, 2), d2 = drift.fbm2(x / 4 + 9, y / 4, 2);
      let k;
      if (d > 0.28) k = rng() < 0.75 ? 'lavender' : 'rosemary';
      else if (d < -0.3) k = rng() < 0.6 ? 'grassA' : 'grassB';
      else if (d2 > 0.25) k = rng() < 0.6 ? 'flowersW' : 'flowersP';
      else k = ['ivy', 'grassB', 'myrtle', 'flowersP', 'ivy', 'lentisk'][Math.floor(rng() * 6)];
      placeShrub(k, x, y, zr, 0.55 + rng() * 0.45, k !== 'ivy');
    }
    // small multi-stem olives and a few larger ones
    for (const [x, y, s] of [[-12.5, 2.5, 0.85], [6.5, 4.5, 0.95], [12.0, -3.5, 0.8], [-15.5, -3.2, 0.7], [1.5, -6.5, 0.7], [-8.5, 7.5, 0.6], [14.5, 3.0, 0.62], [-2.0, 8.6, 0.58]]) placeTree('olive', x, y, zr, s, 0);
    // lush band along the roof edge (spills over in the photos)
    for (const p of resample([...offset(roof, -0.95), offset(roof, -0.95)[0]], 0.55)) {
      if (p.y > 10) continue;
      const q = rng();
      placeShrub(q < 0.3 ? 'cushion' : q < 0.55 ? 'myrtle' : q < 0.75 ? 'broad' : q < 0.88 ? 'grassA' : 'lavender', p.x, p.y, zr, 0.95 + rng() * 0.55);
    }
    // taller evergreen masses and multi-stem trees a little further in, so the
    // garden reads over the slab edge from the terraces and the entry court
    for (const p of resample([...offset(roof, -2.2), offset(roof, -2.2)[0]], 1.7)) {
      if (pointInPoly(p.x, p.y, atr)) continue;
      const q = rng();
      if (q < 0.18) placeTree('olive', p.x, p.y, zr, 0.5 + rng() * 0.25, 0);
      else placeShrub(q < 0.55 ? 'broad' : q < 0.8 ? 'lentisk' : 'grassA', p.x, p.y, zr, 1.1 + rng() * 0.5);
    }
  }
  // planted entry canopy: the L1 bulge over the door is a green roof too
  for (let i = 0; i < 260 * density; i++) {
    const x = -1.5 + rng() * 10, y = 11.0 + rng() * 5.4;
    if (!pointInPoly(x, y, offset(l1, -0.4)) || pointInPoly(x, y, offset(upper, 0.6))) continue;
    const k = ['ivy', 'grassB', 'lavender', 'flowersW', 'myrtle', 'broad', 'grassA'][Math.floor(rng() * 7)];
    placeShrub(k, x, y, LEVEL.upper, (k === 'broad' || k === 'myrtle' ? 0.8 : 0.55) + rng() * 0.4);
  }
  // L1 terrace edge planters (soil strip just inside the slab edge)
  {
    const strip = offset(l1, -0.6);
    for (const p of resample([...strip, strip[0]], 0.7)) {
      if (pointInPoly(p.x, p.y, offset(upper, 1.0))) continue;
      if (p.y > 9) continue;
      const k = ['cushion', 'myrtle', 'grassA', 'myrtle', 'lavender', 'broad', 'cushion'][Math.floor(rng() * 7)];
      placeShrub(k, p.x, p.y, LEVEL.upper, (k === 'cushion' ? 1.0 : 0.7) + rng() * 0.4);
    }
  }

  // --- cascades from slab edges: bougainvillea / jasmine, 0.5-2.5 m ----------
  const cascades = [];
  for (let i = 0; i < 12; i++) cascades.push(makeCascade(900 + i, 0.6 + (i % 6) * 0.38, i % 3 === 0 ? 'boug' : i % 3 === 1 ? 'mix' : 'green'));
  const cascShort = [];
  for (let i = 0; i < 6; i++) cascShort.push(makeCascade(950 + i, 0.4 + (i % 3) * 0.25, i % 2 ? 'green' : 'mix'));
  const vineAlong = (outline, z, inset, step, skip, set, keyPrefix, thresh = 0.12) => {
    const pts = resample([...outline, outline[0]], step);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (skip && skip(p)) continue;
      const cluster = nz.fbm2(p.x / 5.5, p.y / 5.5, 2);
      if (cluster < thresh) continue;
      const t = new THREE.Vector2().subVectors(q, p).normalize();
      const out = new THREE.Vector2(t.y, -t.x);
      // clustered: 1-3 overlapping cascades per edge point where the field is high
      const nC = 1 + Math.floor(Math.max(0, cluster - thresh) * 6 * rng() + rng() * 1.2);
      for (let c = 0; c < nC; c++) {
        const vi = Math.floor(rng() * set.length);
        const along = (rng() - 0.5) * step;
        const x = p.x + out.x * (inset + rng() * 0.1) + t.x * along;
        const y = p.y + out.y * (inset + rng() * 0.1) + t.y * along;
        // local +z (outward) -> plan outward normal (three: x, -y)
        const yaw = Math.atan2(out.x, -out.y) + (rng() - 0.5) * 0.3;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, z, -y),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
          new THREE.Vector3(1.0 + rng() * 0.4, (0.85 + rng() * 0.55 + Math.max(0, cluster - 0.2)) * lenK, 1),
        );
        const g = 0.92 + rng() * 0.16;
        push(`${keyPrefix}-${vi}`, set[vi], leafMat, m, new THREE.Color(g, g * (0.98 + rng() * 0.06), g * (0.9 + rng() * 0.1)), false, true);
      }
    }
  };
  let lenK = 1.15;
  vineAlong(l1, LEVEL.upper + 0.12, 0.05, 0.55, (p) => p.y > 3.5 && !(p.x > -3 && p.x < 9 && p.y > 11), cascades, 'casc', -0.08);
  vineAlong(roof, LEVEL.roof + 0.2, 0.05, 0.5, (p) => p.y > 3.5, cascades, 'casc', -0.08);
  lenK = 1;
  // into the atrium (seen from the living room)
  const shaftRing = ccw(ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx - 0.04, ATRIUM.ry - 0.04, 64, ATRIUM.rot)).reverse();
  vineAlong(shaftRing, LEVEL.upper - 0.6, -0.05, 0.55, null, cascShort, 'cascS', 0.0);
  for (const z of [LEVEL.roof + 0.25, 27.0, 25.7, 24.4]) vineAlong(shaftRing, z, -0.08, 0.5, null, cascades, 'cascA', 0.05);
  // the roof lip around the opening spills greenery into the shaft
  vineAlong(ccw(ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.5, ATRIUM.ry + 0.5, 64, ATRIUM.rot)).reverse(), LEVEL.roof + 0.62, -0.1, 0.5, null, cascShort, 'cascS', -0.05);

  // --- build instanced meshes -------------------------------------------------
  const tmpCol = new THREE.Color();
  let tris = 0;
  for (const [key, e] of inst) {
    const count = e.mats.length;
    const im = new THREE.InstancedMesh(e.geo, e.mat, count);
    for (let i = 0; i < count; i++) {
      im.setMatrixAt(i, e.mats[i]);
      im.setColorAt(i, tmpCol.copy(e.cols[i]));
    }
    im.castShadow = e.shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = key;
    if (e.far) im.layers.set(2);
    root.add(im);
    tris += (e.geo.index ? e.geo.index.count : e.geo.attributes.position.count) / 3 * count;
  }

  // --- distant forest: clustered canopy stands (> 600 m) ---------------------
  buildFarForest(root, field, quality, nz);

  // --- indoor plants -----------------------------------------------------------
  buildIndoorPlants(root, quality);

  root.userData.instancedTriangles = Math.round(tris);
  return { root, update() {} };
}

// planted-roof ground: mossy low groundcover with clumps and a few gravel paths
function groundMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nfloat gh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vGW.xz;
  float a = gn(p * 0.7) * 0.5 + gn(p * 2.3) * 0.3 + gn(p * 9.0) * 0.2;
  vec3 g1 = vec3(0.045, 0.085, 0.025), g2 = vec3(0.11, 0.15, 0.05), g3 = vec3(0.16, 0.16, 0.09);
  vec3 c = mix(g1, g2, smoothstep(0.3, 0.7, a));
  c = mix(c, g3, smoothstep(0.75, 0.9, gn(p * 0.35 + 7.0)) * 0.6);
  diffuseColor.rgb = c;
}`);
  };
  m.customProgramCacheKey = () => 'roof-ground';
  return m;
}

export { smoothstep, distToPoly };
