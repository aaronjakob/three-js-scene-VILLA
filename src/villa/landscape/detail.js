import * as THREE from 'three';
import { Simplex, mulberry32 } from '../core/noise.js';
import { GLSL_NOISE } from '../core/noise.js';
import { pointInPoly, offset, smooth, ccw, deckOutline, poolOutline, COURT, FIREPIT, FIRE_STAIR_PTS } from '../architecture/plan.js';
import { polyProject } from './terrain.js';

// Limestone boulders and sea stacks: displaced icosahedra (several seeds),
// stratified, with a triplanar-ish procedural rock shader. Placed along the
// waterline, on the cliff under the villa, and as garden boulders.

function rockGeometry(seed, detail = 4) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const s = new Simplex(seed);
  const pos = g.attributes.position;
  const ao = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  const flat = 0.55 + (seed % 5) * 0.08;
  const tilt = (seed % 7) * 0.3;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let d = 1 + 0.32 * s.fbm3(v.x * 1.2, v.y * 1.2, v.z * 1.2, 4);
    // facets / fractures
    d += 0.12 * Math.abs(s.noise3(v.x * 3.1 + 7, v.y * 3.1, v.z * 3.1));
    // strata
    d += 0.03 * Math.sin((v.y * Math.cos(tilt) + v.x * Math.sin(tilt)) * 14);
    v.multiplyScalar(d);
    v.y *= flat;
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
    ao[i] = d;
  }
  g.computeVertexNormals();
  // cavity AO: vertices pushed in (low d) are darker
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = Math.min(1, Math.max(0.35, 0.62 + (ao[i] - 1) * 1.4));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function rockMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.45, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;\nvarying vec3 vRN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vRW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vRW;\nvarying vec3 vRN;\nfloat vr_wet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vRW;
  float n1 = vh_fbm3(p * 0.35, 4);
  float n2 = vh_fbm3(p * 2.2, 3);
  float strata = 0.5 + 0.5 * sin(p.y * 3.3 + n1 * 5.0);
  vec3 a = vec3(0.36, 0.345, 0.315);
  vec3 b = vec3(0.17, 0.165, 0.15);
  vec3 c = mix(b, a, smoothstep(-0.3, 0.4, n1 + n2 * 0.4));
  c *= 0.86 + 0.14 * strata;
  // lichen / moss in crevices facing up
  float moss = smoothstep(0.55, 0.9, vRN.y) * smoothstep(0.1, 0.5, n2 + 0.2);
  c = mix(c, vec3(0.16, 0.18, 0.10), moss * 0.55);
  // dark wet foot near the sea
  vr_wet = 1.0 - smoothstep(-0.3, 1.6, p.y + n2 * 0.4);
  c *= mix(1.0, 0.45, vr_wet);
  diffuseColor.rgb *= c;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, vr_wet);');
  };
  m.customProgramCacheKey = () => 'rock-v1';
  return m;
}

export function buildLandscapeDetail(ctx) {
  const { scene, field, quality } = ctx;
  const root = new THREE.Group();
  root.name = 'rocks';
  scene.add(root);
  const mat = rockMaterial();
  const k = quality.rocks ?? 1;
  const rng = mulberry32(99);
  const nz = new Simplex(13);
  const deck = offset(deckOutline(), 1.0);
  const variants = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry(i * 17 + 3, i < 3 ? 4 : 3));
  const variantsLow = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry(i * 17 + 3, 2));
  const buckets = variants.map(() => []);
  const bucketsLow = variants.map(() => []);
  const poolPad = offset(poolOutline(), 1.2);
  const blocked = (x, y) =>
    pointInPoly(x, y, deck) ||
    (pointInPoly(x, y, poolPad) && field.height(x, y) > 14.8) ||
    Math.hypot(x - COURT.cx, y - COURT.cy) < COURT.r + 0.5 ||
    Math.hypot(x - FIREPIT.cx, y - FIREPIT.cy) < FIREPIT.r + 0.4 ||
    polyProject(FIRE_STAIR_PTS, x, y).d < 1.4 ||
    Math.hypot(x + 10.6, y + 14.6) < 2.6;

  const put = (x, y, z, s, sy = 1) => {
    const vi = Math.floor(rng() * variants.length);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5));
    (Math.hypot(x, y) > 120 ? bucketsLow : buckets)[vi].push(new THREE.Matrix4().compose(new THREE.Vector3(x, z, -y), q, new THREE.Vector3(s * (0.8 + rng() * 0.5), s * sy, s * (0.8 + rng() * 0.5))));
  };

  // 1) waterline boulders and sea stacks within 900 m
  const N1 = Math.round(5200 * k);
  for (let i = 0; i < N1; i++) {
    const x = (rng() * 2 - 1) * (rng() < 0.6 ? 260 : 900);
    const sy = field.shoreY(x);
    const y = sy + (rng() - 0.65) * 26;
    const h = field.height(x, y);
    if (h < -3.5 || h > 7) continue;
    if (blocked(x, y)) continue;
    const big = rng() < 0.12;
    const s = big ? 2.4 + rng() * 3.5 : 0.5 + rng() * 1.8;
    put(x, y, h - s * 0.25, s, big ? 0.9 + rng() * 0.8 : 0.7 + rng() * 0.4);
  }
  // 2) cliff outcrops on steep faces near the villa (0..140 m)
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
    const s = 0.8 + rng() * (slope > 0.45 ? 3.0 : 1.6);
    put(x, y, h - s * 0.5, s, 0.55 + rng() * 0.45);
  }
  // 3) garden boulders around the entry court and along the drive
  for (let i = 0; i < 70 * k; i++) {
    const a = rng() * Math.PI * 2;
    const r = COURT.r + 1.4 + rng() * 9;
    const x = COURT.cx + Math.cos(a) * r, y = COURT.cy + Math.sin(a) * r;
    if (y < 12.5) continue;
    if (blocked(x, y)) continue;
    const s = 0.5 + rng() * 1.3;
    put(x, y, field.height(x, y) - s * 0.3, s, 0.7);
  }
  // rock outcrop beside the garden stair (entry reference)
  for (let i = 0; i < 9; i++) put(-10.2 - rng() * 2.5, 15 + i * 0.7, 17.6 + i * 0.15, 1.4 + rng() * 1.2, 1.1);
  // waterfall grotto walls framing the cascade
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.65 + rng() * 0.9);
    put(-10.9 + Math.cos(a) * 3.4, -14.4 + Math.sin(a) * 2.4, 8.4 + rng() * 2.5, 1.2 + rng() * 1.4, 1.1);
  }
  // near-shore stacks offshore
  for (const [x, y, s] of [[60, -78, 6], [74, -86, 3.5], [-48, -70, 4.5], [140, -260, 8], [190, -300, 5], [-160, -200, 6.5]]) {
    put(x, y, field.height(x, y) - 1.5, s, 1.4);
  }

  for (let i = 0; i < variants.length * 2; i++) {
    const low = i >= variants.length;
    const list = (low ? bucketsLow : buckets)[i % variants.length];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh((low ? variantsLow : variants)[i % variants.length], mat, list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'rocks-' + i;
    root.add(im);
  }
  buildSettlements(root, field, rng, nz);
  return { root, material: mat };
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
