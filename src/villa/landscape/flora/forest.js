import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, Simplex, GLSL_NOISE } from '../../core/noise.js';

// Distant forest (> 600 m): a continuous canopy, not a field of domes.
//  - crowns are 3-5 merged, flattened, noise-displaced lobes (umbrella pines,
//    clumpy oaks), in 8 variants with a darker, sparser underside
//  - instances are placed in dense, overlapping stands that follow a
//    landscape-scale patch field, leaving scrub and rock between stands
//  - the shader adds clump-scale relief (noise bump + crevice darkening) and
//    per-stand colour drift so the canopy reads as many crowns
// Everything is on layer 2 (main camera only).

function crownVariant(rng, s3, umbrella) {
  const lobes = [];
  const n = umbrella ? 3 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    let g = new THREE.IcosahedronGeometry(1, 0);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g, 1e-4);
    const a = rng() * Math.PI * 2, r = i === 0 ? 0 : 0.35 + rng() * 0.4;
    const sc = i === 0 ? 0.8 : 0.45 + rng() * 0.35;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, oy = (umbrella ? 0.1 : 0.0) + (rng() - 0.3) * 0.35;
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, k);
      const d = 1 + 0.32 * s3.noise3(v.x * 2.3 + i * 7, v.y * 2.3, v.z * 2.3) + 0.14 * s3.noise3(v.x * 5 + i, v.y * 5, v.z * 5);
      v.multiplyScalar(d * sc);
      if (v.y < 0) v.y *= umbrella ? 0.25 : 0.45; // flat, sparse underside
      v.y *= umbrella ? 0.45 : 0.7;
      pos.setXYZ(k, v.x + ox, v.y + oy + 0.4, v.z + oz);
    }
    lobes.push(g);
  }
  const g = mergeGeometries(lobes, false);
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ao = THREE.MathUtils.clamp(0.35 + y * 0.55, 0.25, 1);
    col.set([ao, ao, ao], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function canopyMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'far-canopy', color: 0xffffff, vertexColors: true, roughness: 0.92, envMapIntensity: 0.45 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vFW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec3 vFW;\nfloat fcN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // clump-scale relief: sunlit crown tops, dark crevices between clumps
  fcN = vh_fbm3(vFW * 0.42, 3);
  float stand = vh_fbm3(vFW * 0.004 + 3.0, 2);
  diffuseColor.rgb *= (0.5 + 0.75 * smoothstep(-0.35, 0.35, fcN)) * (0.85 + 0.3 * stand);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.0, 0.75), smoothstep(0.1, 0.5, stand) * 0.5);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(fcN) * r1 + dFdy(fcN) * r2) * 2.2;
  normal = normalize(abs(det) * normal - grad);
}`);
  };
  m.customProgramCacheKey = () => 'flora-far-canopy-v1';
  return m;
}

export function buildFarForest(root, field, quality, nz) {
  const rng = mulberry32(777);
  const s3 = new Simplex(5);
  const variants = [];
  for (let i = 0; i < 8; i++) variants.push(crownVariant(rng, s3, i < 4));
  const mat = canopyMaterial();
  const count = Math.round(26000 * (quality.farForest ?? 1));
  const per = variants.map(() => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 8 && n < count; i++) {
    const rr = 600 + Math.pow(rng(), 0.85) * 3200;
    const a = rng() * Math.PI * 2;
    const x0 = Math.cos(a) * rr + 400, y0 = Math.sin(a) * rr + 600;
    if (Math.hypot(x0, y0 - 20) < 640) continue;
    const patch = nz.fbm2(x0 / 220, y0 / 220, 4) + 0.35 * nz.fbm2(x0 / 60, y0 / 60, 2);
    if (patch < -0.05) continue;
    // a stand: 2-5 overlapping crowns around the seed point
    const stand = 2 + Math.floor(rng() * 4);
    for (let k = 0; k < stand && n < count; k++) {
      const x = x0 + (rng() - 0.5) * 14, y = y0 + (rng() - 0.5) * 14;
      const h = field.height(x, y);
      if (h < 3) continue;
      if (field.slope(x, y, 3) > 0.45) continue;
      const vi = Math.floor(rng() * variants.length);
      const s = 3.6 + rng() * 4.2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      m.compose(new THREE.Vector3(x, h - 0.4 + (vi < 4 ? s * 0.18 : 0), -y), q, new THREE.Vector3(s, s * (0.7 + rng() * 0.45), s));
      c.setHSL(0.22 + rng() * 0.08, 0.28 + rng() * 0.16, 0.06 + rng() * 0.05);
      per[vi].push([m.clone(), c.clone()]);
      n++;
    }
  }
  per.forEach((list, vi) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(variants[vi], mat, list.length);
    list.forEach(([mm, cc], i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cc); });
    im.castShadow = false;
    im.receiveShadow = false;
    im.computeBoundingSphere();
    im.name = 'far-forest-' + vi;
    im.layers.set(2);
    root.add(im);
  });
  // umbrella-pine trunks under the pine variants are not visible at > 600 m
}
