import * as THREE from 'three';
import { mulberry32, Simplex, smoothstep } from '../core/noise.js';
import { foliageAtlas } from '../materials/textures.js';
import { materials } from '../materials/library.js';
import { LEVEL } from '../core/world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  smooth, offset, pointInPoly, distToPoly, ellipse, resample, ccw,
  deckOutline, poolOutline, L1_PTS, ROOF_PTS, UPPER_PTS, POOL_PTS, ATRIUM, COURT, DRIVE_PTS, FIREPIT, FIRE_STAIR_PTS,
} from '../architecture/plan.js';
import { polyProject } from './terrain.js';
import { atmosphereUniforms } from '../render/atmosphere.js';
import { VIEWS } from '../core/anchors.js';

// Art-directed planting: no tree may stand in the sightline of an exterior
// camera between the lens and its subject (shrubs stay).
const SIGHTLINES = VIEWS.filter((v) => !v.interior).map((v) => ({ a: v.position, b: v.target }));
function blocksSightline(x, y, z, height = 8) {
  for (const { a, b } of SIGHTLINES) {
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

// ---------------------------------------------------------------------------
// Procedural trees: tapered branch tubes + alpha-tested leaf cards with
// crown-space normals (soft canopy shading), AO vertex colours and a
// translucency term for backlit leaves.  Many seeds per species so instances
// never read as copies; each instance also gets its own scale/rotation/tint.
// ---------------------------------------------------------------------------

const ATLAS = {
  broad: [0, 0.5, 0.5, 1.0],
  olive: [0.5, 0.5, 1.0, 1.0],
  needle: [0, 0, 0.5, 0.5],
  ivy: [0.5, 0, 1.0, 0.5],
};

function taperedTube(points, r0, r1, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const segs = Math.max(2, points.length * (radial > 5 ? 3 : 2));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const N = frames.normals[i], Bn = frames.binormals[i];
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = c * N.x + s * Bn.x, ny = c * N.y + s * Bn.y, nz = c * N.z + s * Bn.z;
      // bark lumps
      const lump = 1 + 0.08 * Math.sin(a * 3 + t * 9) * (r0 > 0.12 ? 1 : 0.3);
      pos.push(p.x + nx * r * lump, p.y + ny * r * lump, p.z + nz * r * lump);
      nrm.push(nx, ny, nz);
      uv.push(j / radial, t * curve.getLength() * 0.6);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// one leaf card (quad) at p, facing roughly `face`, size s, atlas cell
function pushCard(arr, p, face, s, cell, rng, crownC, crownR, aspect = 1) {
  const up = Math.abs(face.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tx = new THREE.Vector3().crossVectors(up, face).normalize();
  const ty = new THREE.Vector3().crossVectors(face, tx).normalize();
  const rot = rng() * Math.PI * 2;
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ax = tx.clone().multiplyScalar(c).addScaledVector(ty, sn).multiplyScalar(s * 0.5 * aspect);
  const ay = ty.clone().multiplyScalar(c).addScaledVector(tx, -sn).multiplyScalar(s * 0.5);
  const corners = [
    p.clone().sub(ax).sub(ay), p.clone().add(ax).sub(ay),
    p.clone().add(ax).add(ay), p.clone().sub(ax).add(ay),
  ];
  const [u0, v0, u1, v1] = cell;
  const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  // crown-space normal (outward) blended with card normal
  const out = p.clone().sub(crownC);
  const dist = out.length() / crownR;
  out.normalize();
  const n = out.multiplyScalar(0.75).addScaledVector(face, 0.25).normalize();
  // ambient occlusion: darker toward the crown core and underside
  const ao = THREE.MathUtils.clamp(0.35 + 0.65 * Math.min(1, dist) * (0.75 + 0.25 * Math.max(0, out.y + 0.3)), 0.25, 1);
  const base = arr.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    arr.pos.push(corners[k].x, corners[k].y, corners[k].z);
    arr.nrm.push(n.x, n.y, n.z);
    arr.uv.push(uvs[k][0], uvs[k][1]);
    arr.col.push(ao, ao, ao);
  }
  arr.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function leafGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr.col, 3));
  g.setIndex(arr.idx);
  g.computeBoundingSphere();
  return g;
}

const SPECIES = {
  pine: { height: [7, 11.5], trunkR: [0.18, 0.28], crown: 'umbrella', cell: ATLAS.needle, card: [1.0, 1.4], density: 46 },
  oak: { height: [4.2, 6.8], trunkR: [0.15, 0.24], crown: 'round', cell: ATLAS.broad, card: [0.85, 1.15], density: 62 },
  olive: { height: [3.4, 5.0], trunkR: [0.17, 0.26], crown: 'open', cell: ATLAS.olive, card: [0.8, 1.1], density: 85 },
  cypress: { height: [8, 11], trunkR: [0.12, 0.18], crown: 'column', cell: ATLAS.needle, card: [0.75, 1.0], density: 70 },
};

export function makeTree(species, seed, lod = 0) {
  const sp = SPECIES[species];
  const rng = mulberry32(seed * 7919 + 13);
  const cardK = lod ? 0.32 : 1;
  const sizeK = lod ? 1.6 : 1;
  const H = THREE.MathUtils.lerp(sp.height[0], sp.height[1], rng());
  const R0 = THREE.MathUtils.lerp(sp.trunkR[0], sp.trunkR[1], rng());
  const wood = [];
  const leaves = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const tips = [];

  // trunk path with lean and bends
  const lean = new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize();
  const trunkPts = [new THREE.Vector3(0, -0.4, 0)];
  const trunkH = species === 'pine' ? H * 0.72 : species === 'cypress' ? H * 0.9 : H * 0.42;
  const nT = 6;
  for (let i = 1; i <= nT; i++) {
    const t = i / nT;
    const p = lean.clone().multiplyScalar(trunkH * t);
    p.x += Math.sin(t * 5 + seed) * 0.35 * t * (species === 'olive' ? 2.0 : 1);
    p.z += Math.cos(t * 4 + seed * 2) * 0.35 * t * (species === 'olive' ? 2.0 : 1);
    trunkPts.push(p);
  }
  wood.push(taperedTube(trunkPts, R0, R0 * (species === 'pine' ? 0.45 : 0.6), lod ? 5 : species === 'olive' ? 9 : 7));
  const top = trunkPts[trunkPts.length - 1];

  // branches
  const crownC = new THREE.Vector3();
  let crownR = 2;
  if (species === 'pine') {
    // umbrella: 4-7 limbs splaying up/out from the top third
    const nb = 4 + Math.floor(rng() * 4);
    crownC.copy(top).add(new THREE.Vector3(0, H * 0.15, 0));
    crownR = H * 0.32;
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rng() * 0.8;
      const startT = 0.55 + rng() * 0.4;
      const start = trunkPts[Math.floor(startT * nT)].clone();
      const len = H * (0.17 + rng() * 0.13);
      const dir = new THREE.Vector3(Math.cos(a), 0.55 + rng() * 0.4, Math.sin(a)).normalize();
      const mid = start.clone().addScaledVector(dir, len * 0.55).add(new THREE.Vector3(0, len * 0.1, 0));
      const end = start.clone().addScaledVector(dir, len);
      end.y = Math.max(end.y, top.y + H * 0.05 + rng() * H * 0.12);
      wood.push(taperedTube([start, mid, end], R0 * 0.42, R0 * 0.12, lod ? 3 : 5));
      tips.push(end);
      // secondary twigs
      for (let k = 0; k < 3; k++) {
        const t2 = 0.45 + rng() * 0.5;
        const s2 = start.clone().lerp(end, t2);
        const d2 = new THREE.Vector3(Math.cos(a + (rng() - 0.5) * 2), 0.4 + rng() * 0.4, Math.sin(a + (rng() - 0.5) * 2)).normalize();
        const e2 = s2.clone().addScaledVector(d2, len * 0.35);
        if (!lod) wood.push(taperedTube([s2, e2], R0 * 0.12, R0 * 0.04, 3));
        tips.push(e2);
      }
    }
    // needle tufts: flattened clusters at tips (umbrella canopy)
    for (const tip of tips) {
      const n = Math.round(sp.density * cardK * (0.7 + rng() * 0.6));
      const rad = H * (0.075 + rng() * 0.04);
      for (let i = 0; i < n; i++) {
        const u = rng() * Math.PI * 2, r = Math.sqrt(rng()) * rad;
        const p = tip.clone().add(new THREE.Vector3(Math.cos(u) * r, (rng() - 0.35) * rad * 0.45, Math.sin(u) * r));
        const face = new THREE.Vector3((rng() - 0.5) * 0.8, 1, (rng() - 0.5) * 0.8).normalize();
        pushCard(leaves, p, face, sizeK * THREE.MathUtils.lerp(sp.card[0], sp.card[1], rng()), sp.cell, rng, crownC, crownR);
      }
    }
  } else if (species === 'cypress') {
    crownC.copy(top).multiplyScalar(0.55);
    crownR = H * 0.5;
    const n = Math.round(260 * cardK);
    for (let i = 0; i < n; i++) {
      const t = 0.12 + rng() * 0.9;
      const y = t * H;
      const rad = (0.15 + Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.85) * (H * 0.09) * Math.sqrt(rng());
      const u = rng() * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(u) * rad + lean.x * y, y, Math.sin(u) * rad + lean.z * y);
      const face = new THREE.Vector3(Math.cos(u), 0.2, Math.sin(u)).normalize();
      pushCard(leaves, p, face, sizeK * THREE.MathUtils.lerp(sp.card[0], sp.card[1], rng()), sp.cell, rng, new THREE.Vector3(lean.x * y, y, lean.z * y), H * 0.09);
    }
  } else {
    // oak / olive: forked limbs, clustered leaf masses
    const nb = species === 'olive' ? 4 + Math.floor(rng() * 3) : 5 + Math.floor(rng() * 4);
    crownC.copy(top).add(new THREE.Vector3(0, H * 0.25, 0));
    crownR = H * (species === 'olive' ? 0.42 : 0.4);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + rng();
      const start = trunkPts[Math.max(2, nT - 1 - Math.floor(rng() * 2))].clone();
      const len = H * (0.3 + rng() * 0.18);
      const dir = new THREE.Vector3(Math.cos(a), 0.75 + rng() * 0.5, Math.sin(a)).normalize();
      const mid = start.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6));
      const end = start.clone().addScaledVector(dir, len);
      wood.push(taperedTube([start, mid, end], R0 * 0.55, R0 * 0.14, lod ? 3 : 5));
      tips.push(end, mid.clone().lerp(end, 0.4));
      for (let k = 0; k < (lod ? 0 : 2); k++) {
        const s2 = start.clone().lerp(end, 0.4 + rng() * 0.4);
        const d2 = new THREE.Vector3(Math.cos(a + (rng() - 0.5) * 2.4), 0.5 + rng() * 0.5, Math.sin(a + (rng() - 0.5) * 2.4)).normalize();
        const e2 = s2.clone().addScaledVector(d2, len * 0.4);
        wood.push(taperedTube([s2, e2], R0 * 0.15, R0 * 0.05, 3));
        tips.push(e2);
      }
    }
    for (const tip of tips) {
      const n = Math.round(sp.density * cardK * (lod ? 1.6 : 1) * (0.6 + rng() * 0.7));
      const rad = H * (species === 'olive' ? 0.15 : 0.16) * (0.8 + rng() * 0.4);
      for (let i = 0; i < n; i++) {
        // points in a squashed sphere around the tip
        const u = rng() * Math.PI * 2, v = Math.acos(2 * rng() - 1), r = Math.cbrt(rng()) * rad;
        const off = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v) * 0.7, Math.sin(v) * Math.sin(u)).multiplyScalar(r);
        const p = tip.clone().add(off);
        const face = off.clone().normalize().add(new THREE.Vector3((rng() - 0.5) * 0.6, 0.3, (rng() - 0.5) * 0.6)).normalize();
        pushCard(leaves, p, face, sizeK * THREE.MathUtils.lerp(sp.card[0], sp.card[1], rng()), sp.cell, rng, crownC, crownR);
      }
    }
  }
  const woodGeo = mergeGeometries(wood.map((g) => g.index ? g : g), false);
  return { wood: woodGeo, leaves: leafGeometry(leaves), height: H };
}

export function makeShrub(seed, { cell = ATLAS.broad, size = 1.4, cards = 46, flat = 0.6 } = {}) {
  const rng = mulberry32(seed * 104729 + 7);
  const leaves = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const c = new THREE.Vector3(0, size * 0.35, 0);
  const lobes = 2 + Math.floor(rng() * 3);
  for (let l = 0; l < lobes; l++) {
    const lc = c.clone().add(new THREE.Vector3((rng() - 0.5) * size * 0.8, (rng() - 0.3) * size * 0.3, (rng() - 0.5) * size * 0.8));
    for (let i = 0; i < cards / lobes; i++) {
      const u = rng() * Math.PI * 2, v = Math.acos(2 * rng() - 1), r = Math.cbrt(rng()) * size * 0.55;
      const off = new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.abs(Math.cos(v)) * flat, Math.sin(v) * Math.sin(u)).multiplyScalar(r);
      const p = lc.clone().add(off);
      p.y = Math.max(p.y, 0.05);
      const face = off.clone().normalize().add(new THREE.Vector3(0, 0.4, 0)).normalize();
      pushCard(leaves, p, face, size * (0.45 + rng() * 0.3), cell, rng, c, size * 0.7);
    }
  }
  return leafGeometry(leaves);
}

// hanging cascade: a dense cushion at the slab lip that thins into a few
// tendrils (bougainvillea / jasmine habit), not a uniform curtain
function vineStrand(rng, len) {
  const leaves = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const c = new THREE.Vector3(0, -len * 0.3, 0.25);
  // cushion over the edge
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Vector3((rng() - 0.5) * 0.9, -rng() * 0.45 + 0.05, 0.05 + rng() * 0.3);
    const face = new THREE.Vector3((rng() - 0.5) * 0.8, 0.3 + rng() * 0.5, 1).normalize();
    pushCard(leaves, p, face, 0.75 + rng() * 0.35, i % 3 ? ATLAS.ivy : ATLAS.broad, rng, c, len * 0.5, 1.0);
  }
  // 1-3 tendrils
  const nT = 1 + Math.floor(rng() * 3);
  for (let t = 0; t < nT; t++) {
    let x = (rng() - 0.5) * 0.6, z = 0.12 + rng() * 0.15;
    const L = len * (0.5 + rng() * 0.5);
    const n = Math.max(2, Math.round(L / 0.3));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      x += (rng() - 0.5) * 0.08;
      const y = -0.3 - k * L;
      const face = new THREE.Vector3((rng() - 0.5) * 0.9, 0, 1).normalize();
      pushCard(leaves, new THREE.Vector3(x, y, z), face, (0.55 - 0.25 * k) * (0.85 + rng() * 0.3), ATLAS.ivy, rng, c, len * 0.6, 0.8);
    }
  }
  return leafGeometry(leaves);
}

// ---------------------------------------------------------------------------
function leafMaterial(atlas, msaa) {
  const m = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  m.alphaToCoverage = msaa > 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDirL = atmosphereUniforms.uSunDir;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vLW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vLW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <alphatest_fragment>', `
{
  // alpha coverage shrinks in lower mips; scale it back up with the mip level
  vec2 dx = dFdx(vMapUv * 1024.0), dy = dFdy(vMapUv * 1024.0);
  float mip = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
  diffuseColor.a *= 1.0 + 0.35 * clamp(mip, 0.0, 6.0);
}
#include <alphatest_fragment>`)
      .replace('#include <common>', '#include <common>\nvarying vec3 vLW;\nuniform vec3 uSunDirL;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // backlit translucency toward the low sun
  vec3 vdir = normalize(vLW - cameraPosition);
  float back = pow(max(dot(vdir, uSunDirL), 0.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.85, 0.55) * back * 0.9 * vColor.r;
}`);
  };
  m.customProgramCacheKey = () => 'leaf-v2';
  return m;
}

function barkMaterial() {
  return materials({ name: 'still' }).bark;
}

// ---------------------------------------------------------------------------
export function buildVegetation(ctx) {
  const { scene, field, quality, renderer } = ctx;
  const root = new THREE.Group();
  root.name = 'vegetation';
  scene.add(root);
  const atlas = foliageAtlas();
  atlas.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const leafMat = leafMaterial(atlas, quality.msaa);
  const bark = barkMaterial();
  const density = quality.vegetation ?? 1;
  const rng = mulberry32(4242);
  const nz = new Simplex(77);

  // exclusion zones (plan coords)
  const deck = deckOutline();
  const deckPad = offset(deck, 1.6);
  const pool = ccw(smooth(POOL_PTS, 120));
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

  // --- tree variants -----------------------------------------------------------
  const variants = { pine: [], oak: [], olive: [], cypress: [] };
  const variantsLow = { pine: [], oak: [], olive: [], cypress: [] };
  const nVar = { pine: 6, oak: 7, olive: 4, cypress: 3 };
  for (const sp of Object.keys(variants)) {
    for (let i = 0; i < nVar[sp]; i++) {
      variants[sp].push(makeTree(sp, i + 1 + sp.length * 31, 0));
      variantsLow[sp].push(makeTree(sp, i + 1 + sp.length * 31, 1));
    }
  }
  const shrubVariants = [];
  for (let i = 0; i < 8; i++) shrubVariants.push(makeShrub(i + 3, { cell: i % 4 === 3 ? ATLAS.ivy : ATLAS.broad, size: 1.0 + (i % 3) * 0.4 }));
  const groundCover = [];
  for (let i = 0; i < 4; i++) groundCover.push(makeShrub(i + 50, { cell: ATLAS.ivy, size: 0.7, cards: 22, flat: 0.35 }));

  // instance collections: key -> array of matrices + colours
  const inst = new Map();
  const push = (key0, geoWood, geoLeaf, m, tint) => {
    const px = m.elements[12], pz = m.elements[14];
    const key = key0 + (Math.hypot(px, pz) < 85 ? '' : '|far');
    if (!inst.has(key)) inst.set(key, { wood: geoWood, leaf: geoLeaf, mats: [], cols: [] });
    const e = inst.get(key);
    e.mats.push(m);
    e.cols.push(tint);
  };
  const mtx = (x, y, z, s, rotY, tilt = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (rng() - 0.5), rotY, tilt * (rng() - 0.5)));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, z, -y), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.2), s));
  };
  const tintColor = (h, s, l) => new THREE.Color().setHSL(h, s, l);

  const placeTree = (sp, x, y, z, s) => {
    const vi = Math.floor(rng() * variants[sp].length);
    const far = Math.hypot(x, y - 5) > 85;
    const v = (far ? variantsLow : variants)[sp][vi];
    const r = rng();
    const t = sp === 'olive' ? new THREE.Color(0.95 + r * 0.1, 0.95 + r * 0.08, 0.9 + r * 0.1) : new THREE.Color(0.8 + r * 0.3, 0.88 + r * 0.2, 0.7 + rng() * 0.3);
    push(`${sp}-${vi}`, v.wood, v.leaves, mtx(x, y, z - 0.05, s, rng() * Math.PI * 2, sp === 'pine' ? 0.25 : 0.12), t);
  };
  const placeShrub = (x, y, z, s, set = shrubVariants, prefix = 'shrub') => {
    const vi = Math.floor(rng() * set.length);
    const r = rng();
    const t = new THREE.Color(0.8 + r * 0.35, 0.85 + r * 0.25, 0.65 + rng() * 0.35);
    push(`${prefix}-${vi}`, null, set[vi], mtx(x, y, z - 0.05, s, rng() * Math.PI * 2, 0.2), t);
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
      // trees: pines on the coast/cliff tops, oaks inland
      const coastal = h < 40 || y < 0;
      const sp = coastal ? (rng() < 0.6 ? 'pine' : 'oak') : rng() < 0.22 ? 'pine' : rng() < 0.06 ? 'cypress' : 'oak';
      if (nearSea && sp !== 'pine') continue;
      placeTree(sp, x, y, h, 0.75 + rng() * 0.55);
    } else if (r < 0.92) {
      placeShrub(x, y, h, (0.7 + rng() * 1.0) * (slope > 0.45 ? 0.8 : 1.15) * (viewCorridor ? 0.8 : 1));
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
    const sp = h < 30 ? (rng() < 0.6 ? 'pine' : 'oak') : rng() < 0.25 ? 'pine' : 'oak';
    placeTree(sp, x, y, h, 0.85 + rng() * 0.5);
  }

  // --- curated planting near the house ---------------------------------------
  // entry: one mature sculptural olive in the ring planter
  push('olive-hero', variants.olive[0].wood, variants.olive[0].leaves,
    new THREE.Matrix4().compose(new THREE.Vector3(COURT.cx, 18.32, -COURT.cy), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8), new THREE.Vector3(1.45, 1.35, 1.45)),
    new THREE.Color(1, 1, 1));
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * (COURT.planterR - 0.5);
    placeShrub(COURT.cx + Math.cos(a) * r, COURT.cy + Math.sin(a) * r, 18.38, 0.55 + rng() * 0.3, groundCover, 'gc');
  }
  // court edge planting + boulders handled by rocks module; trees framing the court
  for (const [x, y, s] of [[-8.5, 25, 1.05], [14.5, 25, 0.95], [-8, 33, 1.1], [14, 34, 0.9], [-11.5, 20.5, 0.85]]) placeTree('olive', x, y, field.height(x, y), s);
  for (const [x, y] of [[-12.5, 16], [16.5, 17.5], [19.5, 14], [-15.5, 13.5]]) placeTree('cypress', x, y, field.height(x, y), 0.9);
  // around the court perimeter: low shrubs
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = COURT.r + 0.9 + rng() * 3.5;
    const x = COURT.cx + Math.cos(a) * r, y = COURT.cy + Math.sin(a) * r;
    if (y < 13 || (y > 28 && Math.abs(x - 3.5) < 4)) continue;
    placeShrub(x, y, field.height(x, y), 0.8 + rng() * 0.6);
  }
  // deck planters (olives in stone planters) on the terraces
  const planterGeo = [];
  const M = materials(quality);
  for (const [x, y, s] of [[-19.4, -5.6, 0.75], [18.6, -6.0, 0.8], [-14.6, 9.6, 0.7]]) {
    const pg = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0.85, 0.7), new THREE.Vector2(0.78, 0.72), new THREE.Vector2(0.7, 0.62), new THREE.Vector2(0, 0.62)], 48);
    pg.translate(x, LEVEL.main, -y);
    planterGeo.push(pg);
    placeTree('olive', x, y, LEVEL.main + 0.62, s);
  }
  const planters = new THREE.Mesh(mergeGeometries(planterGeo), M.planter);
  planters.castShadow = planters.receiveShadow = true;
  root.add(planters);

  // --- roof garden -------------------------------------------------------------
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
    // dense planting on the roof
    let placed = 0;
    for (let i = 0; i < 2600 * density && placed < 900 * density; i++) {
      const x = -20 + rng() * 40, y = -10.5 + rng() * 22.5;
      if (!pointInPoly(x, y, soil) || pointInPoly(x, y, atr)) continue;
      placed++;
      const edge = distToPoly(x, y, soil);
      if (rng() < 0.55) placeShrub(x, y, LEVEL.roof + 0.22, 0.45 + rng() * 0.45, groundCover, 'gc');
      else placeShrub(x, y, LEVEL.roof + 0.22, (0.5 + rng() * 0.6) * (edge < 1.2 ? 1.1 : 0.9));
    }
    for (const [x, y, s] of [[-12.5, 2.5, 0.85], [6.5, 4.5, 0.95], [12.0, -3.5, 0.8], [-15.5, -3.2, 0.7], [1.5, -6.5, 0.7]]) placeTree('olive', x, y, LEVEL.roof + 0.22, s);
    // lush band along the roof edge (spills over in the photos)
    for (const p of resample([...offset(roof, -0.95), offset(roof, -0.95)[0]], 0.55)) {
      if (p.y > 10) continue;
      placeShrub(p.x, p.y, LEVEL.roof + 0.22, 0.8 + rng() * 0.6);
    }
  }
  // L1 terrace edge planters (soil strip just inside the slab edge)
  {
    const strip = offset(l1, -0.6);
    for (const p of resample([...strip, strip[0]], 0.7)) {
      if (pointInPoly(p.x, p.y, offset(upper, 1.0))) continue;
      if (p.y > 9) continue;
      placeShrub(p.x, p.y, LEVEL.upper, 0.45 + rng() * 0.35, rng() < 0.5 ? groundCover : shrubVariants, rng() < 0.5 ? 'gc' : 'shrub');
    }
  }

  // --- hanging vines from slab edges (clustered cascades) ---------------------
  const vineVariants = [];
  for (let i = 0; i < 10; i++) vineVariants.push(vineStrand(mulberry32(900 + i), 0.8 + (i % 5) * 0.45));
  const vineShort = [];
  for (let i = 0; i < 6; i++) vineShort.push(vineStrand(mulberry32(950 + i), 0.35 + (i % 3) * 0.2));
  const vineAlong = (outline, z, inset, step, skip, set = vineVariants, keyPrefix = 'vine') => {
    const pts = resample([...outline, outline[0]], step);
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (skip && skip(p)) continue;
      const cluster = nz.fbm2(p.x / 5.5, p.y / 5.5, 2);
      if (cluster < 0.12) continue;
      const t = new THREE.Vector2().subVectors(q, p).normalize();
      const out = new THREE.Vector2(t.y, -t.x);
      const strands = 1 + Math.floor((cluster - 0.12) * 5 * rng());
      for (let k = 0; k < strands; k++) {
        const vi = Math.floor(rng() * set.length);
        const x = p.x + out.x * (inset + rng() * 0.12) + t.x * (rng() - 0.5) * step;
        const y = p.y + out.y * (inset + rng() * 0.12) + t.y * (rng() - 0.5) * step;
        const yaw = Math.atan2(out.x, out.y) + (rng() - 0.5) * 0.6;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, z, -y),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
          new THREE.Vector3(1, 0.8 + rng() * 0.5, 1),
        );
        push(`${keyPrefix}-${vi}`, null, set[vi], m, new THREE.Color(1.15 + rng() * 0.25, 1.3, 1.0 + rng() * 0.2));
      }
    }
  };
  vineAlong(l1, LEVEL.upper + 0.15, 0.06, 0.55, (p) => p.y > 3.5 && !(p.x > -3 && p.x < 9 && p.y > 11));
  vineAlong(roof, LEVEL.roof + 0.2, 0.06, 0.5, (p) => p.y > 3.5);
  // into the atrium (seen from the living room)
  const shaftRing = ccw(ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx - 0.04, ATRIUM.ry - 0.04, 64, ATRIUM.rot)).reverse();
  vineAlong(shaftRing, LEVEL.upper - 0.6, -0.05, 0.55, null, vineShort, 'vineS');
  for (const z of [LEVEL.roof + 0.25, 27.0, 25.7, 24.4]) vineAlong(shaftRing, z, -0.08, 0.45, null, vineVariants, 'vineA');
  // the roof lip around the opening spills greenery into the shaft
  vineAlong(ccw(ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.5, ATRIUM.ry + 0.5, 64, ATRIUM.rot)).reverse(), LEVEL.roof + 0.62, -0.1, 0.5, null, vineShort, 'vineS');

  // --- build instanced meshes -------------------------------------------------
  const tmpCol = new THREE.Color();
  for (const [key, e] of inst) {
    const count = e.mats.length;
    const near = !key.endsWith('|far');
    if (e.wood) {
      const im = new THREE.InstancedMesh(e.wood, bark, count);
      for (let i = 0; i < count; i++) im.setMatrixAt(i, e.mats[i]);
      im.castShadow = near;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      if (!near) im.layers.set(2);
      root.add(im);
    }
    const lm = new THREE.InstancedMesh(e.leaf, leafMat, count);
    for (let i = 0; i < count; i++) {
      lm.setMatrixAt(i, e.mats[i]);
      lm.setColorAt(i, tmpCol.copy(e.cols[i]));
    }
    lm.castShadow = near && !key.startsWith('gc');
    lm.receiveShadow = true;
    lm.computeBoundingSphere();
    lm.name = key;
    if (!near) lm.layers.set(2);
    root.add(lm);
  }

  // --- distant forest: lumpy canopy domes (3 km) ------------------------------
  buildFarForest(root, field, quality, nz);

  // --- indoor plants -----------------------------------------------------------
  buildIndoorPlants(root, quality);

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

function buildFarForest(root, field, quality, nz) {
  const rng = mulberry32(777);
  const base = new THREE.IcosahedronGeometry(1, 1);
  const pos = base.attributes.position;
  const s3 = new Simplex(5);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const d = 1 + 0.22 * s3.noise3(v.x * 2.1, v.y * 2.1, v.z * 2.1) + 0.1 * s3.noise3(v.x * 5, v.y * 5, v.z * 5);
    v.multiplyScalar(d);
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    v.y *= 0.8;
    pos.setXYZ(i, v.x, v.y + 0.35, v.z);
  }
  base.computeVertexNormals();
  // AO-ish vertex colour (darker underside)
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ao = THREE.MathUtils.clamp(0.45 + y * 0.45, 0.3, 1);
    col.set([ao, ao, ao], i * 3);
  }
  base.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, envMapIntensity: 0.4 });
  const count = Math.round(26000 * (quality.farForest ?? 1));
  const im = new THREE.InstancedMesh(base, mat, count);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 6 && n < count; i++) {
    const rr = 600 + Math.pow(rng(), 0.85) * 3200;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * rr + 400, y = Math.sin(a) * rr + 600;
    if (Math.hypot(x, y - 20) < 640) continue;
    const h = field.height(x, y);
    if (h < 3) continue;
    const slope = field.slope(x, y, 3);
    if (slope > 0.42) continue;
    const patch = nz.fbm2(x / 160, y / 160, 3);
    if (patch < -0.25) continue;
    const s = 3.8 + rng() * 5.0;
    m.compose(new THREE.Vector3(x, h - 0.6, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s * (0.75 + rng() * 0.5), s));
    im.setMatrixAt(n, m);
    c.setHSL(0.25 + rng() * 0.06, 0.32 + rng() * 0.18, 0.07 + rng() * 0.06);
    im.setColorAt(n, c);
    n++;
  }
  im.count = n;
  im.castShadow = false;
  im.receiveShadow = false;
  im.computeBoundingSphere();
  im.name = 'far-forest';
  im.layers.set(2); // main camera only (not the floor reflection, not shadows)
  root.add(im);
}

// large-leaf indoor plants (strelitzia-like) in stone pots
function buildIndoorPlants(root, quality) {
  const M = materials(quality);
  const leafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.10, 0.22, 0.07), roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  const stemMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.24, 0.1), roughness: 0.7 });
  const spots = [[-12.6, -2.6, 1.0], [-1.6, -7.2, 0.9], [11.6, -3.6, 1.0], [-15.9, 0.0, 0.9], [4.0, 4.4, 0.85], [16.9, 2.4, 0.95], [-7.6, 3.9, 0.8]];
  const leaves = [], stems = [], pots = [];
  const rng = mulberry32(31337);
  for (const [x, y, s] of spots) {
    const pot = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.42, 0.22), new THREE.Vector2(0.4, 0.62), new THREE.Vector2(0.36, 0.64), new THREE.Vector2(0, 0.6)], 40);
    pot.scale(s, s, s);
    pot.translate(x, LEVEL.main, -y);
    pots.push(pot);
    const n = 7 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const lean = 0.15 + rng() * 0.35;
      const len = (1.2 + rng() * 0.9) * s;
      const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      const start = new THREE.Vector3(x, LEVEL.main + 0.6 * s, -y);
      const end = start.clone().addScaledVector(dir, len);
      stems.push(new THREE.TubeGeometry(new THREE.LineCurve3(start, end), 4, 0.012, 5));
      // blade: elongated ellipse, curved, oriented along stem tip direction
      const L = (0.7 + rng() * 0.4) * s, W = (0.24 + rng() * 0.08) * s;
      const g = new THREE.PlaneGeometry(W, L, 4, 10);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const u = p.getX(k) / W, v = p.getY(k) / L + 0.5;
        const width = Math.sin(Math.min(1, Math.max(0, v)) * Math.PI) ** 0.7;
        p.setX(k, u * W * width);
        p.setZ(k, -Math.pow(v, 2) * 0.18 * s + Math.abs(u) * 0.06 * s);
        p.setY(k, v * L);
      }
      g.computeVertexNormals();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)).normalize());
      const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + rng());
      g.applyQuaternion(twist.premultiply(q));
      g.translate(end.x, end.y, end.z);
      leaves.push(g);
    }
  }
  const mk = (arr, mat) => {
    const mesh = new THREE.Mesh(mergeGeometries(arr.map((g) => g.index ? g.toNonIndexed() : g).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; })), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  mk(pots, M.planter);
  mk(stems, stemMat);
  mk(leaves, leafMat);
}

export { ATLAS, smoothstep };
