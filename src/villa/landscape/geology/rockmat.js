import * as THREE from 'three';
import { GLSL_NOISE } from '../../core/noise.js';
import { atmosphereUniforms } from '../../render/atmosphere.js';

// Weathered Mediterranean limestone, fully procedural (world-space 3D
// patterns, so no UVs or tiling): bedding bands and thin partings, joint
// cracks and hairline fractures (cellular noise), warm grey / ochre tone
// variation, dark runoff streaks under ledges, crustose lichen, moss and soil
// in crevices, wet dark rock + black cyanobacteria band + surf at the sea.
//
// kind 'cliff'   : marching-cubes cliff (vertex color = ao/soil/shelter, aGeo)
// kind 'boulder' : instanced stones (vertex color = ao, strata in stone space)
// kind 'plain'   : any mesh without attributes (e.g. plinth walls)

export const GLSL_ROCK = /* glsl */ `
vec3 gr_hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// cellular noise: x = F1, y = F2
vec2 gr_cells(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int l = -1; l <= 1; l++) {
    vec3 b = vec3(float(l), float(j), float(k));
    vec3 r = b - f + gr_hash3(i + b);
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}
vec3 gr_bump(vec3 surfPos, vec3 surfNorm, float height) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1);
  float dbx = dFdx(height);
  float dby = dFdy(height);
  vec3 grad = sign(det) * (dbx * r1 + dby * r2);
  return normalize(abs(det) * surfNorm - grad);
}

// Limestone albedo + micro height. p: world pos, n: world normal,
// zs: strata coordinate, hard: bed hardness, ao: cavity, sh: shelter,
// crackV: joint crack proximity, blk: block random, dist: camera distance.
struct GrSurf { vec3 col; float h; float rough; float wet; };

GrSurf gr_limestone(vec3 p, vec3 n, float zs, float hard, float ao, float sh, float crackV, float blk, float dist, float uTimeS) {
  GrSurf s;
  float near = 1.0 - smoothstep(18.0, 75.0, dist);
  float mid = 1.0 - smoothstep(60.0, 260.0, dist);
  float vert = 1.0 - abs(n.y);
  // large tone fields: warm grey <-> ochre <-> cool grey
  float t1 = vh_fbm3(p * 0.045 + vec3(3.1, 0.0, 1.7), 3);
  float t2 = vh_fbm3(p * 0.16 + vec3(0.0, 5.0, 2.0), 3);
  vec3 warm = vec3(0.232, 0.212, 0.185);
  vec3 ochre = vec3(0.245, 0.188, 0.128);
  vec3 cool = vec3(0.188, 0.186, 0.180);
  vec3 pale = vec3(0.300, 0.287, 0.258);
  vec3 c = mix(warm, cool, smoothstep(-0.25, 0.3, t1));
  c = mix(c, ochre, smoothstep(0.05, 0.45, t2 - t1 * 0.5) * 0.75);
  // bedding: tone per bed (1D noise along the strata coordinate)
  float bed = vh_noise3(vec3(p.x * 0.012, zs * 1.35, p.z * 0.012));
  c *= 0.86 + 0.26 * smoothstep(-0.45, 0.45, bed) ;
  c = mix(c, pale, smoothstep(0.55, 0.95, hard) * 0.35 * smoothstep(0.0, 0.5, vert));
  c *= 0.9 + 0.2 * blk;
  // thin partings: dark, recessed lines along the beds
  float pz = zs * 2.1 + 0.35 * vh_noise3(p * vec3(0.18, 0.0, 0.18));
  float part = abs(vh_noise3(vec3(p.x * 0.03, pz, p.z * 0.03)));
  float parting = (1.0 - smoothstep(0.0, 0.035 + 0.05 * (1.0 - near), part)) * smoothstep(0.15, 0.6, vert) * mid;
  // hairline fractures (mostly vertical): cellular edges in squashed space
  float hair = 0.0;
  if (near > 0.01) {
    vec2 cc = gr_cells(p * vec3(0.55, 0.2, 0.55));
    float patchy = smoothstep(-0.05, 0.3, vh_fbm3(p * 0.25 + 4.0, 2));
    hair = (1.0 - smoothstep(0.0, 0.035, cc.y - cc.x)) * near * patchy;
  }
  // pitting / karren micro relief
  float rough = vh_fbm3(p * 2.3, 3);
  float pits = near > 0.01 ? smoothstep(0.25, 0.55, vh_noise3(p * 7.0)) * near : 0.0;
  // dark runoff streaks on steep faces, strongest under ledges
  float st = vh_noise3(vec3(p.x * 1.15, p.y * 0.055 + zs * 0.01, p.z * 1.15));
  float st2 = vh_noise3(vec3(p.x * 3.1, p.y * 0.11, p.z * 3.1));
  float streak = smoothstep(0.05, 0.45, st + st2 * 0.35) * smoothstep(0.35, 0.8, vert);
  streak *= 0.35 + 0.65 * max(sh, smoothstep(0.2, 0.6, vh_fbm3(p * vec3(0.3, 0.05, 0.3), 2) + 0.2));
  c *= 1.0 - 0.45 * streak;
  c = mix(c, c * vec3(0.78, 0.8, 0.86), streak * 0.5);
  // crustose lichen: pale grey-white blotches + black dots on exposed rock
  float lic = vh_fbm3(p * 1.7 + 11.0, 3);
  float expo = (1.0 - sh) * smoothstep(-0.3, 0.6, n.y + 0.4);
  float lichW = smoothstep(0.26, 0.4, lic) * expo * mid;
  c = mix(c, vec3(0.33, 0.33, 0.315), lichW * 0.35);
  float lichB = smoothstep(0.42, 0.5, vh_noise3(p * 9.0 + 3.0)) * near * expo;
  c = mix(c, vec3(0.06, 0.06, 0.055), lichB * 0.6);
  // orange xanthoria near the sea spray line
  float xan = smoothstep(0.28, 0.4, vh_fbm3(p * 2.2 - 4.0, 2)) * (1.0 - smoothstep(4.5, 9.0, p.y)) * smoothstep(1.6, 2.6, p.y) * expo;
  c = mix(c, vec3(0.48, 0.24, 0.07), xan * 0.45);
  // joint cracks: dark, damp, with moss on their lips
  float jc = smoothstep(0.15, 0.85, crackV);
  c *= 1.0 - 0.55 * jc;
  // cavity: crevices and pockets darken; moss where damp and facing up
  float cav = 1.0 - ao;
  c *= mix(1.0, 0.42, smoothstep(0.05, 0.6, cav));
  float moss = smoothstep(0.15, 0.55, cav + jc * 0.4) * smoothstep(-0.2, 0.5, n.y) * smoothstep(2.5, 4.0, p.y);
  c = mix(c, vec3(0.085, 0.095, 0.045), moss * 0.55);
  c *= 1.0 - parting * 0.5;
  c *= 1.0 - hair * 0.45;
  c *= 0.92 + 0.16 * rough;
  c *= 1.0 - pits * 0.18;
  // sea: black cyanobacteria band, wet rock, surf
  float splash = vh_fbm3(vec3(p.x * 0.35, 0.0, p.z * 0.35), 2);
  float blackBand = smoothstep(0.6, 1.1, p.y) * (1.0 - smoothstep(1.9 + splash, 2.9 + splash, p.y));
  c = mix(c, c * vec3(0.42, 0.42, 0.44), blackBand * 0.75);
  float wet = 1.0 - smoothstep(0.55 + splash * 0.6, 1.35 + splash * 0.8, p.y);
  c = mix(c, c * vec3(0.38, 0.40, 0.42), wet);
  float foamN = vh_fbm3(vec3(p.x * 1.4, uTimeS * 0.6, p.z * 1.4), 3);
  float foam = (1.0 - smoothstep(0.08, 0.55, abs(p.y - 0.05 - 0.15 * foamN))) * smoothstep(-0.15, 0.25, foamN + 0.1);
  c = mix(c, vec3(0.78, 0.81, 0.82), clamp(foam, 0.0, 1.0) * 0.85);
  s.col = c;
  s.h = rough * 0.03 - pits * 0.012 - parting * 0.03 - hair * 0.025 - jc * 0.04 + lichW * 0.004;
  s.rough = mix(0.9, 0.3, wet) - lichW * 0.04;
  s.wet = wet;
  return s;
}

// soil, dry grass, pine litter and grit on ledges / pockets
vec3 gr_soil(vec3 p, float dist, inout float h) {
  float n1 = vh_fbm3(p * 0.9, 3);
  float n2 = vh_fbm3(p * 3.4 + 5.0, 2);
  vec3 dark = vec3(0.052, 0.047, 0.038);
  vec3 litter = vec3(0.098, 0.074, 0.050);
  vec3 grass = vec3(0.165, 0.155, 0.098);
  vec3 green = vec3(0.055, 0.075, 0.033);
  vec3 c = mix(dark, litter, smoothstep(-0.25, 0.25, n1));
  c = mix(c, grass, smoothstep(0.1, 0.45, n2 - n1 * 0.3) * 0.6);
  c = mix(c, green, 0.25 + smoothstep(0.0, 0.5, n1 + n2 * 0.4) * 0.45);
  float grit = smoothstep(0.55, 0.7, vh_noise3(p * 11.0)) * (1.0 - smoothstep(8.0, 30.0, dist));
  c = mix(c, vec3(0.30, 0.29, 0.27), grit * 0.5);
  h += n2 * 0.02 + grit * 0.01;
  return c;
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vRW;
varying vec3 vRN;
varying vec4 vRG;
#ifdef GR_CLIFF
attribute vec4 aGeo;
#endif
`;

const VERT_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
vRW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
// stone-space strata: tilted per instance, plus a per-instance random
float grSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
vRG = vec4(transformed.y * 1.6 + transformed.x * 0.35 + grSeed * 13.0, 0.55 + 0.4 * fract(grSeed * 7.3), 0.0, grSeed);
#else
vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * objectNormal);
  #ifdef GR_CLIFF
  vRG = aGeo;
  #else
  vRG = vec4(vRW.y, 0.6, 0.0, 0.5);
  #endif
#endif
`;

export function createRockMaterial(kind = 'cliff') {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.5,
    vertexColors: kind !== 'plain',
  });
  m.name = 'Rock-' + kind;
  if (kind === 'cliff') m.defines = { GR_CLIFF: '' };
  if (kind === 'boulder') m.defines = { GR_BOULDER: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = atmosphereUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${GLSL_NOISE}
${GLSL_ROCK}
uniform float uTime;
varying vec3 vRW;
varying vec3 vRN;
varying vec4 vRG;
float gr_h;
float gr_rough;`)
      .replace('#include <color_fragment>', `
{
  vec3 p = vRW;
  vec3 n = normalize(vRN);
  float dist = length(p - cameraPosition);
#if defined(GR_CLIFF)
  float ao = vColor.r, soil = vColor.g, shel = vColor.b;
#elif defined(GR_BOULDER)
  float ao = vColor.r, soil = 0.0, shel = 0.0;
#else
  float ao = 1.0, soil = 0.0, shel = 0.0;
#endif
  GrSurf s = gr_limestone(p, n, vRG.x, vRG.y, ao, shel, vRG.z, vRG.w, dist, uTime);
  vec3 col = s.col;
  gr_h = s.h;
  gr_rough = s.rough;
#if defined(GR_BOULDER)
  // stones: soil dust and moss settle on top faces
  float topF = smoothstep(0.45, 0.9, n.y) * smoothstep(1.8, 3.0, p.y);
  float mz = smoothstep(0.1, 0.45, vh_fbm3(p * 1.3 + 2.0, 3));
  col = mix(col, vec3(0.10, 0.11, 0.05), topF * mz * 0.5);
  col = mix(col, vec3(0.16, 0.12, 0.08), topF * (1.0 - mz) * 0.25);
#endif
#if defined(GR_CLIFF)
  if (soil > 0.01) {
    float hs = 0.0;
    vec3 sc = gr_soil(p, dist, hs);
    float edge = smoothstep(0.0, 1.0, soil + 0.25 * vh_noise3(p * 1.7));
    col = mix(col, sc * mix(0.6, 1.0, ao), edge);
    gr_h = mix(gr_h, hs, edge);
    gr_rough = mix(gr_rough, 0.96, edge);
  }
#endif
  diffuseColor.rgb = col;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = gr_rough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = gr_bump(-vViewPosition, normal, gr_h);`);
  };
  m.customProgramCacheKey = () => 'geo-rock-' + kind + '-v1';
  return m;
}
