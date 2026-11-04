import * as THREE from 'three';
import { Simplex, mulberry32, smoothstep } from '../../core/noise.js';
import { pointInPoly, offset, deckOutline, poolOutline, COURT, FIREPIT, FIRE_STAIR_PTS } from '../../architecture/plan.js';
import { VIEWS } from '../../core/anchors.js';
import { polyProject } from '../terrain.js';
import { buildCliff, CLIFF_ZONE } from './cliff.js';
import { boulderGeometry } from './boulders.js';
import { createRockMaterial } from './rockmat.js';
import { setCliffCover } from './terrainmat.js';

export { CLIFF_ZONE };

// Geology of the site: the high-resolution sea cliff under the villa plus
// fractured stones at three scales (blocks / boulders / rubble), clustered at
// the cliff foot, on ledges and along the waterline of the whole coast.
export function buildGeology(ctx) {
  const { scene, field, quality } = ctx;
  const T0 = performance.now();
  const root = new THREE.Group();
  root.name = 'geology';
  scene.add(root);
  const k = quality.rocks ?? 1;

  // --- cliff ---------------------------------------------------------------------
  const terrainMesh = scene.getObjectByName('terrain');
  const cliff = buildCliff({ field, terrainMesh, quality });
  setCliffCover(cliff.coverTexture);
  const cliffMat = createRockMaterial('cliff');
  const cliffMesh = new THREE.Mesh(cliff.geometry, cliffMat);
  cliffMesh.name = 'sea-cliff';
  cliffMesh.castShadow = true;
  cliffMesh.receiveShadow = true;
  root.add(cliffMesh);

  // --- stones ------------------------------------------------------------------------
  const NV = 10;
  // LOD sets chosen by apparent size (stone size / distance to the villa)
  const tiers = [
    { res: quality.name === 'low' ? 14 : quality.name === 'balanced' ? 17 : 22, k: 0.022 },
    { res: 12, k: 0.0055 },
    { res: 7, k: 0 },
  ];
  const geos = tiers.map((t) => Array.from({ length: NV }, (_, i) => boulderGeometry(i * 31 + 7, t.res)));
  const buckets = tiers.map(() => Array.from({ length: NV }, () => []));
  const stoneMat = createRockMaterial('boulder');
  const rng = mulberry32(99);
  const nz = new Simplex(13);
  const deck = offset(deckOutline(), 1.0);
  const poolPad = offset(poolOutline(), 1.4);
  const wf = cliff.waterfall;
  const cams = VIEWS.filter((v) => !v.interior).map((v) => v.position);
  const blocked = (x, y, z = 0, s = 1) => {
    if (pointInPoly(x, y, deck)) return true;
    if (pointInPoly(x, y, poolPad) && z + s > 14.8) return true;
    if (Math.hypot(x - COURT.cx, y - COURT.cy) < COURT.r + 0.5) return true;
    if (Math.hypot(x - FIREPIT.cx, y - FIREPIT.cy) < FIREPIT.r + 0.8 + s * 0.5 && z + s * 0.6 > 11.4) return true;
    if (polyProject(FIRE_STAIR_PTS, x, y).d < 1.6 + s * 0.6) return true;
    // waterfall sheet + plunge basin
    if (Math.hypot(x - wf.basinC.x, y - wf.basinC.y) < 3.9 + s * 0.4) return true;
    if (Math.hypot(x - wf.start.x, y - wf.start.y) < 2.8 + s * 0.4) return true;
    for (const [cx, cy, cz] of cams) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < 12 + s && z + s > cz - 3.5 - 0.35 * d) return true;
    }
    return false;
  };
  let count = 0;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), tp = new THREE.Vector3();
  // s = size (m, longest half-axis), bury = fraction of height sunk into the ground
  const put = (x, y, z, s, bury = 0.3, tilt = 0.35) => {
    const vi = Math.floor(rng() * NV);
    const app = s / Math.max(12, Math.hypot(x, y + 12));
    const tier = app > tiers[0].k ? 0 : app > tiers[1].k ? 1 : 2;
    e.set((rng() - 0.5) * tilt, rng() * Math.PI * 2, (rng() - 0.5) * tilt);
    q.setFromEuler(e);
    const ext = geos[0][vi].userData.ext;
    const sy = s * (0.85 + rng() * 0.35);
    sc.set(s * (0.85 + rng() * 0.3), sy, s * (0.85 + rng() * 0.3));
    tp.set(x, z + ext[1] * sy * (1 - 2 * bury), -y);
    buckets[tier][vi].push(new THREE.Matrix4().compose(tp, q, sc));
    count++;
  };
  // ground under a point: cliff surface where it exists, else the terrain
  const ground = (x, y) => (cliff.inZone(x, y) ? cliff.surfaceHeight(x, y) ?? field.height(x, y) : field.height(x, y));
  const slopeAt = (x, y) => {
    const e2 = 0.6;
    const hx = ground(x + e2, y) - ground(x - e2, y), hy = ground(x, y + e2) - ground(x, y - e2);
    return Math.hypot(hx, hy) / (2 * e2);
  };

  // 1) cliff zone: shore blocks, ledge blocks and scree, in clusters
  const clusters = [];
  for (let i = 0; i < 70; i++) {
    const x = CLIFF_ZONE.x0 + 5 + rng() * (CLIFF_ZONE.x1 - CLIFF_ZONE.x0 - 10);
    const y = -12 - rng() * 48;
    clusters.push([x, y, 1.5 + rng() * 4.5]);
  }
  for (const [cx, cy, R] of clusters) {
    const n = Math.round((10 + rng() * 22) * k);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!cliff.inZone(x, y)) continue;
      const z = ground(x, y);
      if (z === null || z < -1.2) continue;
      const sl = slopeAt(x, y);
      if (sl > 1.4) continue; // no stones stuck on walls
      const shore = z < 2.4;
      let s;
      if (shore) s = rng() < 0.25 ? 1.1 + rng() * 1.6 : 0.35 + rng() * 0.8;
      else if (sl < 0.5) s = rng() < 0.15 ? 0.6 + rng() * 0.9 : 0.12 + rng() * 0.35;
      else s = 0.12 + rng() * 0.3;
      if (blocked(x, y, z, s)) continue;
      put(x, y, z, s, shore ? 0.25 + rng() * 0.2 : 0.35 + rng() * 0.25, shore ? 0.6 : 0.4);
    }
  }
  // scattered scree over the cliff zone (small, half buried)
  for (let i = 0; i < 900 * k; i++) {
    const x = CLIFF_ZONE.x0 + 4 + rng() * (CLIFF_ZONE.x1 - CLIFF_ZONE.x0 - 8);
    const y = -10 - rng() * 50;
    if (!cliff.inZone(x, y)) continue;
    const z = ground(x, y);
    if (z === null || z < 0.2) continue;
    if (slopeAt(x, y) > 0.9) continue;
    const s = 0.08 + rng() * rng() * 0.35;
    if (blocked(x, y, z, s)) continue;
    put(x, y, z, s, 0.4 + rng() * 0.2, 0.8);
  }

  // 2) waterline boulders along the rest of the coast (clustered)
  const N1 = Math.round(1700 * k);
  for (let i = 0; i < N1; i++) {
    const far = rng() < 0.42;
    const cxr = (rng() * 2 - 1) * (far ? 900 : 240);
    if (Math.abs(cxr) < CLIFF_ZONE.x1 - 2 && !far) continue;
    const sy = field.shoreY(cxr);
    const cy = sy + (rng() - 0.6) * 18;
    const n = 1 + Math.floor(rng() * (far ? 4 : 7));
    for (let j = 0; j < n; j++) {
      const x = cxr + (rng() - 0.5) * 9, y = cy + (rng() - 0.5) * 7;
      if (cliff.inZone(x, y)) continue;
      const h = field.height(x, y);
      if (h < -2.6 || h > 6.5) continue;
      const big = rng() < 0.18;
      const s = big ? 1.6 + rng() * 2.6 : 0.4 + rng() * 1.3;
      if (blocked(x, y, h, s)) continue;
      put(x, y, h, s, 0.25 + rng() * 0.2, 0.7);
    }
  }
  // 3) outcrops on steep coastal faces outside the cliff zone
  const N2 = Math.round(1500 * k);
  for (let i = 0; i < N2; i++) {
    const x = (rng() * 2 - 1) * 200;
    const y = -6 - rng() * 70;
    if (cliff.inZone(x, y)) continue;
    const h = field.height(x, y);
    if (h < 0.5) continue;
    const slope = field.slope(x, y, 0.8);
    if (slope < 0.2) continue;
    if (nz.fbm2(x / 9, y / 9, 2) < -0.2 && slope < 0.5) continue;
    const s = 0.7 + rng() * (slope > 0.45 ? 2.4 : 1.3);
    if (blocked(x, y, h, s)) continue;
    put(x, y, h, s, 0.45 + rng() * 0.15, 0.5);
  }
  // 4) garden boulders and grit around the entry court and the drive
  for (let i = 0; i < 90 * k; i++) {
    const a = rng() * Math.PI * 2;
    const r = COURT.r + 1.2 + rng() * 10;
    const x = COURT.cx + Math.cos(a) * r, y = COURT.cy + Math.sin(a) * r;
    if (y < 12.5) continue;
    const h = field.height(x, y);
    const s = rng() < 0.4 ? 0.5 + rng() * 1.1 : 0.12 + rng() * 0.3;
    if (blocked(x, y, h, s)) continue;
    put(x, y, h, s, 0.4, 0.4);
  }
  // rock outcrop beside the garden stair (entry reference)
  for (let i = 0; i < 9; i++) put(-10.2 - rng() * 2.5, 15 + i * 0.7, 17.6 + i * 0.15, 1.1 + rng() * 1.0, 0.45, 0.4);
  // near-shore stacks and islets' boulders
  for (const [x, y, s] of [[60, -78, 5], [74, -86, 3.0], [-48, -72, 3.8], [140, -260, 7], [190, -300, 4.5], [-160, -200, 5.5]]) {
    put(x, y, field.height(x, y), s, 0.35, 0.5);
  }

  let tris = 0;
  for (let t = 0; t < tiers.length; t++) {
    for (let v = 0; v < NV; v++) {
      const list = buckets[t][v];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[t][v], stoneMat, list.length);
      list.forEach((m, j) => im.setMatrixAt(j, m));
      im.castShadow = t < 2;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `stones-${t}-${v}`;
      root.add(im);
      tris += (geos[t][v].index.count / 3) * list.length;
    }
  }
  const plain = createRockMaterial('plain');
  const stats = {
    cliff: cliff.stats,
    stones: count,
    stoneTriangles: Math.round(tris),
    cliffTriangles: cliff.stats.triangles,
    ms: Math.round(performance.now() - T0),
  };
  if (typeof window !== 'undefined') window.__geologyStats = stats;
  return {
    root,
    material: plain,
    cliff,
    stats,
    // for other modules (vegetation, walk mode): true ground incl. cliff rock
    surfaceHeight: (x, y) => (cliff.inZone(x, y) ? cliff.surfaceHeight(x, y) ?? field.height(x, y) : field.height(x, y)),
  };
}
