import * as THREE from 'three';
import { Simplex, mulberry32 } from '../core/noise.js';
import { pointInPoly, offset, deckOutline, poolOutline, COURT, FIREPIT, FIRE_STAIR_PTS } from '../architecture/plan.js';
import { polyProject } from './terrain.js';
import { buildGeology } from './geology/index.js';
import { createRockMaterial } from './geology/rockmat.js';

// Landscape detail: the geology of the site (high-resolution limestone sea
// cliff under the villa, fractured stones at several scales along the whole
// coast; see ./geology/) and the distant settlements.

// Stand-alone limestone material for meshes without baked attributes
// (e.g. the plinth walls under the deck overhang).
export function rockMaterial() {
  return createRockMaterial('plain');
}

export function buildLandscapeDetail(ctx) {
  const { field, quality } = ctx;
  const geology = buildGeology(ctx);
  // true ground height including cliff rock (for anything seated on the cliff)
  ctx.geology = { surfaceHeight: geology.surfaceHeight, cliff: geology.cliff, stats: geology.stats };
  const rng = mulberry32(99);
  const nz = new Simplex(13);
  advanceLegacyRng(field, quality.rocks ?? 1, rng, nz);
  buildSettlements(geology.root, field, rng, nz);
  return { root: geology.root, material: geology.material, geology };
}

// The settlements continue the random sequence the previous boulder scatter
// consumed; replay that consumption so the distant city keeps its layout.
function advanceLegacyRng(field, k, rng, nz) {
  const deck = offset(deckOutline(), 1.0);
  const poolPad = offset(poolOutline(), 1.2);
  const blocked = (x, y) =>
    pointInPoly(x, y, deck) ||
    (pointInPoly(x, y, poolPad) && field.height(x, y) > 14.8) ||
    Math.hypot(x - COURT.cx, y - COURT.cy) < COURT.r + 0.5 ||
    Math.hypot(x - FIREPIT.cx, y - FIREPIT.cy) < FIREPIT.r + 0.4 ||
    polyProject(FIRE_STAIR_PTS, x, y).d < 1.4 ||
    Math.hypot(x + 10.6, y + 14.6) < 2.6;
  const put = () => { for (let i = 0; i < 6; i++) rng(); };
  const N1 = Math.round(5200 * k);
  for (let i = 0; i < N1; i++) {
    const x = (rng() * 2 - 1) * (rng() < 0.6 ? 260 : 900);
    const sy = field.shoreY(x);
    const y = sy + (rng() - 0.65) * 26;
    const h = field.height(x, y);
    if (h < -3.5 || h > 7) continue;
    if (blocked(x, y)) continue;
    rng(); // big?
    rng(); rng(); // size, flattening
    put();
  }
  const N2 = Math.round(3600 * k);
  for (let i = 0; i < N2; i++) {
    const x = (rng() * 2 - 1) * 140;
    const y = -8 - rng() * 50;
    const h = field.height(x, y);
    if (h < 0.5) continue;
    if (blocked(x, y)) continue;
    const slope = field.slope(x, y, 0.8);
    if (slope < 0.18) continue;
    if (nz.fbm2(x / 9, y / 9, 2) < -0.25 && slope < 0.5) continue;
    rng(); rng();
    put();
  }
  for (let i = 0; i < 70 * k; i++) {
    const a = rng() * Math.PI * 2;
    const r = COURT.r + 1.4 + rng() * 9;
    const x = COURT.cx + Math.cos(a) * r, y = COURT.cy + Math.sin(a) * r;
    if (y < 12.5) continue;
    if (blocked(x, y)) continue;
    rng();
    put();
  }
  for (let i = 0; i < 9; i++) { rng(); rng(); put(); }
  for (let i = 0; i < 14; i++) { rng(); rng(); rng(); put(); }
  for (let i = 0; i < 6; i++) put();
}

// Distant city on the far side of the bay (south-east, ~6-7 km) and scattered
// white houses on the coastal hills. Simple masses: at this distance the haze
// reduces them to soft silhouettes, which is what the references show.
function buildSettlements(root, field, rng, nz) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, envMapIntensity: 0.6 });
  winMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvBN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float side = 1.0 - abs(vBN.y);
  vec2 g = vec2(abs(vBN.x) > 0.5 ? vBW.z : vBW.x, vBW.y);
  vec2 cell = floor(g / vec2(3.2, 3.4));
  float lit = step(0.72, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
  vec2 f = fract(g / vec2(3.2, 3.4));
  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
  diffuseColor.rgb *= mix(1.0, 0.55, win * side);
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * win * lit * side * 0.6;
}`);
  };
  winMat.customProgramCacheKey = () => 'bldg-v1';
  const mats = [];
  const cols = [];
  const c = new THREE.Color();
  // city
  const cx = 5700;
  for (let i = 0; i < 420; i++) {
    const x = cx + (rng() - 0.5) * 2200;
    const sy = field.shoreY(x);
    const y = sy + 40 + Math.pow(rng(), 1.5) * 900;
    const h0 = field.height(x, y);
    if (h0 < 1 || h0 > 120) continue;
    const core = Math.exp(-((x - cx) ** 2) / (2 * 520 * 520));
    const H = 12 + rng() * 40 + core * rng() * 170;
    const W = 14 + rng() * 26, D = 14 + rng() * 26;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h0 - 2, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6 + (rng() - 0.5) * 0.3), new THREE.Vector3(W, H, D)));
    c.setHSL(0.09, 0.1, 0.62 + rng() * 0.2);
    cols.push(c.clone());
  }
  // hillside houses within 300 m .. 3 km
  for (let i = 0; i < 2600 && mats.length < 1100; i++) {
    const rr = 320 + Math.pow(rng(), 0.7) * 2800;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * rr + 300, y = Math.sin(a) * rr + 200;
    if (Math.hypot(x, y) < 650) continue;
    const h0 = field.height(x, y);
    if (h0 < 6 || h0 > 260) continue;
    if (y - field.shoreY(x) > 1800) continue;
    if (field.slope(x, y, 4) > 0.3) continue;
    if (nz.fbm2(x / 300, y / 300, 2) < 0.05) continue;
    const W = 8 + rng() * 10, D = 7 + rng() * 9, H = 5 + rng() * 5;
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h0 - 1, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 3.14), new THREE.Vector3(W, H, D)));
    c.setHSL(0.1, 0.15, 0.78 + rng() * 0.12);
    cols.push(c.clone());
  }
  const im = new THREE.InstancedMesh(box, winMat, mats.length);
  mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); });
  im.computeBoundingSphere();
  im.layers.set(2);
  im.name = 'settlements';
  root.add(im);
}
