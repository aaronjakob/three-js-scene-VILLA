import * as THREE from 'three';
import { floraAtlas, barkSet, ALPHA_TEST } from './textures.js';

// Foliage shading for alpha-tested leaf cards.
//  - leaf normal map (per-leaf orientation) blended with a crown/clump normal
//    so a crown is lit as clumps of leaves, not as flat cards
//  - shadowed thin-leaf translucency: sunlight that hits the far side of a
//    leaf glows through it (strongest when looking toward the low sun)
//  - gloss from the atlas: specular sheen on holm oak / myrtle / ivy,
//    matte felted undersides on olive
//  - crown-depth AO (baked per card): darker interior and underside
//  - per-card hue / value jitter so no two clumps share a colour
// Vertex attributes: aCrown (vec3 clump normal), aAO (x = AO, y = random).

const PARS_V = /* glsl */ `
attribute vec3 aCrown;
attribute vec2 aAO;
varying vec3 vCrownN;
varying vec2 vAO;
`;

const PARS_F = /* glsl */ `
uniform sampler2D tLeafData;
uniform float uCrownMix;
uniform float uTrans;
uniform float uDirectAO;
uniform float uNormalK;
varying vec3 vCrownN;
varying vec2 vAO;
mat3 leafTBN(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
  vec3 q0 = dFdx(eye_pos.xyz);
  vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(uv.st);
  vec2 st1 = dFdy(uv.st);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}
`;

export function foliageMaterial({ msaa = 4, crownMix = 0.55, trans = 1.0, directAO = 0.35, normalK = 1.0, envMapIntensity = 0.7, name = 'foliage' } = {}) {
  const { map, data } = floraAtlas();
  const m = new THREE.MeshStandardMaterial({
    name,
    map,
    alphaTest: ALPHA_TEST,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity,
  });
  m.alphaToCoverage = msaa > 0;
  const uniforms = {
    tLeafData: { value: data },
    uCrownMix: { value: crownMix },
    uTrans: { value: trans },
    uDirectAO: { value: directAO },
    uNormalK: { value: normalK },
  };
  m.userData.flora = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS_V}`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
{
  vec3 cN = aCrown;
#ifdef USE_INSTANCING
  cN = mat3(instanceMatrix) * cN;
#endif
  vCrownN = normalize(normalMatrix * cN);
  vAO = aAO;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS_F}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec4 leafD = texture2D(tLeafData, vMapUv);
{
  // per-card colour jitter (value + slight hue), inner leaves a touch darker
  float rj = vAO.y;
  diffuseColor.rgb *= mix(vec3(0.84, 0.88, 0.80), vec3(1.12, 1.08, 0.96), rj);
}`)
      .replace('#include <normal_fragment_maps>', `
vec3 nCardF = normal;
{
  vec3 mapN = vec3((leafD.xy * 2.0 - 1.0) * uNormalK, 0.0);
  mapN.z = sqrt(saturate(1.0 - dot(mapN.xy, mapN.xy)));
  mat3 tbnL = leafTBN(-vViewPosition, normal, vMapUv);
  vec3 nLeaf = normalize(tbnL * mapN);
  vec3 nCrown = normalize(vCrownN);
  normal = normalize(mix(nLeaf, nCrown, uCrownMix));
  vec3 Vv = normalize(vViewPosition);
  float nv = dot(normal, Vv);
  if (nv < 0.08) normal = normalize(normal + Vv * (0.08 - nv));
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.92, 0.36, leafD.b);`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
#if NUM_DIR_LIGHTS > 0
{
  // thin-leaf transmission of the (shadowed) sun
  vec3 Ls = directLight.direction;
  vec3 Vv = normalize(vViewPosition);
  float back = saturate(dot(-nCardF, Ls));
  float fwd = pow(saturate(dot(-Vv, Ls)), 4.0);
  float tr = leafD.a * uTrans * mix(0.35, 1.0, vAO.x);
  vec3 tcol = diffuseColor.rgb * vec3(1.0, 1.12, 0.62) + vec3(0.010, 0.014, 0.0);
  reflectedLight.directDiffuse += directLight.color * tcol * tr * (0.45 * back + 1.6 * fwd * (0.4 + 0.6 * back));
}
#endif`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  float cao = vAO.x;
  reflectedLight.indirectDiffuse *= cao;
  reflectedLight.indirectSpecular *= cao * cao;
  reflectedLight.directDiffuse *= mix(1.0, cao, uDirectAO);
  reflectedLight.directSpecular *= cao;
}`);
  };
  m.customProgramCacheKey = () => 'flora-leaf-v1';
  return m;
}

const barkMats = new Map();
export function barkMaterial(kind) {
  if (barkMats.has(kind)) return barkMats.get(kind);
  const b = barkSet(kind);
  const m = new THREE.MeshStandardMaterial({
    name: 'bark-' + kind,
    map: b.map,
    normalMap: b.normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: 0.45,
    vertexColors: true,
  });
  barkMats.set(kind, m);
  return m;
}

export function resetFloraMaterials() {
  barkMats.clear();
}
