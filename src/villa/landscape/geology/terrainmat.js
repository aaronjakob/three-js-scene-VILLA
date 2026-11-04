import * as THREE from 'three';
import { GLSL_NOISE } from '../../core/noise.js';
import { atmosphereUniforms } from '../../render/atmosphere.js';
import { GLSL_ROCK } from './rockmat.js';
import { CLIFF_ZONE, waterfallFrame } from './cliff.js';

// Terrain material: the same limestone as the cliff mesh and stones on
// coastal rock, a ground of soil / dry grass / pine litter / grit with small
// outcrops near the villa, and the dark maquis / forest colour on the far
// hills. In the vertex stage the terrain sinks under the cliff mesh (inside
// CLIFF_ZONE) and under the plunge basin, so it never shows through either.

const f = (v) => v.toFixed(4);

// set by the geology module once the cliff mesh exists: where the terrain
// must sink under it (R channel, 0..1) over the cliff zone bounds
export const cliffCover = { value: null, bounds: { value: new THREE.Vector4(0, 0, 1, 1) } };
export function setCliffCover(tex) {
  cliffCover.value = tex;
  const b = tex.userData.bounds;
  cliffCover.bounds.value.set(b[0], b[1], b[2], b[3]);
}

export function createGeoTerrainMaterial() {
  const Z = CLIFF_ZONE;
  const wf = waterfallFrame();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  mat.name = 'Terrain';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = atmosphereUniforms.uTime;
    shader.uniforms.uCliffCover = cliffCover;
    shader.uniforms.uCliffBounds = cliffCover.bounds;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uCliffCover;
uniform vec4 uCliffBounds;
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec2 gp = vec2(transformed.x, -transformed.z);
  vec2 muv = (gp - uCliffBounds.xy) / (uCliffBounds.zw - uCliffBounds.xy);
  float m = 0.0;
  if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) m = texture2D(uCliffCover, muv).r;
  // sink only where the cliff mesh already lies on top (it rises first)
  float push = 0.6 * smoothstep(0.3, 1.0, m);
  vec2 bd = gp - vec2(${f(wf.basinC.x)}, ${f(wf.basinC.y)});
  float ca = ${f(Math.cos(-wf.ang))}, sa = ${f(Math.sin(-wf.ang))};
  vec2 bl = vec2(bd.x * ca - bd.y * sa, bd.x * sa + bd.y * ca);
  float be = length(bl / vec2(${f(wf.rx)}, ${f(wf.ry)}));
  push = max(push, (transformed.y - 8.3) * (1.0 - smoothstep(1.0, 1.15, be)));
  transformed.y -= push;
}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vTWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${GLSL_NOISE}
${GLSL_ROCK}
uniform float uTime;
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;
float vt_rock;
float vt_h;
float vt_rough;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 wp = vTWorldPos;
  vec3 wn = normalize(vTWorldNormal);
  float slope = 1.0 - wn.y;
  float h = wp.y;
  float dist = length(wp - cameraPosition);
  vec2 gp = vec2(wp.x, -wp.z);
  float n1 = vh_fbm3(wp * 0.035, 4);
  float n2 = vh_fbm3(wp * 0.21 + 3.0, 3);
  float fineFade = 1.0 - smoothstep(40.0, 220.0, dist);
  float n3 = (fineFade > 0.0 ? vh_noise3(wp * 1.3) : 0.0) * fineFade;
  float rockMask = smoothstep(0.26, 0.48, slope + n1 * 0.26 + n2 * 0.1);
  rockMask *= 1.0 - smoothstep(30.0, 120.0, h) * 0.85;
  // inland of the house (graded drive cuts, hill): scrub, not bare rock
  rockMask *= mix(1.0, 0.12, smoothstep(-12.0, -30.0, wp.z) * (1.0 - smoothstep(60.0, 140.0, h)));
  // under the cantilevered house/pool: shaded rock and soil, nothing grows
  float underHouse = 1.0 - smoothstep(0.85, 1.05, length((gp - vec2(0.0, 2.0)) / vec2(23.5, 16.5)));
  rockMask = max(rockMask, underHouse * step(h, 17.45));
  float shore = 1.0 - smoothstep(0.4, 3.2 + n1 * 2.0, h);
  rockMask = max(rockMask, shore);
  float underwater = 1.0 - smoothstep(-1.2, 0.2, h);
  vt_h = 0.0;
  // far hills: forest canopy / maquis colour
  float clump = vh_fbm3(wp * 0.16 + 4.0, 2);
  vec3 vegA = vec3(0.030, 0.055, 0.022);
  vec3 vegB = vec3(0.070, 0.100, 0.040);
  vec3 vegC = vec3(0.120, 0.128, 0.065);
  vec3 veg = mix(vegA, vegB, smoothstep(-0.25, 0.35, clump));
  veg = mix(veg, vegC, smoothstep(0.15, 0.55, n2) * 0.45);
  float dry = smoothstep(0.25, 0.55, n1 + 0.15) * (1.0 - smoothstep(0.0, 0.25, slope));
  veg = mix(veg, vec3(0.16, 0.14, 0.09), dry * 0.35);
  // near the villa: soil, dry grass, pine-needle litter, grit, small outcrops
  float nearV = (1.0 - smoothstep(60.0, 150.0, length(gp - vec2(0.0, 5.0)))) * (1.0 - smoothstep(26.0, 34.0, h));
  if (nearV > 0.001) {
    float hs = 0.0;
    vec3 soil = gr_soil(wp, dist, hs);
    float meadow = smoothstep(-0.15, 0.3, vh_fbm3(wp * 0.09 + 9.0, 3));
    float tuft = vh_noise3(wp * vec3(5.0, 1.0, 5.0));
    vec3 grassC = mix(vec3(0.20, 0.180, 0.105), vec3(0.115, 0.125, 0.060), smoothstep(-0.3, 0.4, n2 + tuft * 0.3));
    vec3 ground = mix(soil, grassC, meadow * 0.65);
    ground = mix(ground, veg * 1.3, 0.35 + 0.3 * smoothstep(-0.1, 0.5, clump));
    float flatK = 1.0 - smoothstep(0.32, 0.6, slope);
    veg = mix(veg, ground, nearV * flatK);
    // limestone poking through the soil
    float outc = smoothstep(0.3, 0.46, vh_fbm3(wp * 0.3 + 2.0, 3) + slope * 0.45 - meadow * 0.15) * nearV;
    rockMask = max(rockMask, outc * 0.9);
    vt_h += (hs + tuft * 0.015 * (1.0 - smoothstep(10.0, 40.0, dist))) * nearV * flatK;
  }
  GrSurf rs = gr_limestone(wp, wn, wp.y + n1 * 1.2, 0.6, 1.0 - 0.25 * smoothstep(0.1, 0.5, n2), 0.0, 0.0, 0.5 + 0.5 * n2, dist, uTime);
  // dark weathering on the big sunlit coastal faces
  rs.col *= mix(1.0, 0.72 + 0.28 * smoothstep(-0.3, 0.4, n1), smoothstep(0.35, 0.75, slope));
  vec3 col = mix(veg, rs.col, rockMask);
  // vegetation clinging to ledges on coastal cliffs
  float ledgeVeg = smoothstep(0.1, 0.5, n2 + 0.2) * (1.0 - smoothstep(0.35, 0.7, slope)) * (1.0 - shore);
  col = mix(col, veg * 1.1, ledgeVeg * rockMask * 0.5);
  col = mix(col, vec3(0.05, 0.12, 0.12), underwater * 0.6);
  vt_rock = rockMask;
  vt_rough = mix(0.96, rs.rough, rockMask);
  vt_h = mix(vt_h, rs.h, rockMask);
  diffuseColor.rgb = col;
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = vt_rough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 wp = vTWorldPos;
  float dist = length(wp - cameraPosition);
  float f1 = 1.0 - smoothstep(60.0, 500.0, dist);
  float f2 = 1.0 - smoothstep(15.0, 90.0, dist);
  float canopy = vh_fbm3(wp * 0.22, 2);
  float rockB = vh_fbm3(wp * 0.6, 2) * 0.3 + (f2 > 0.0 ? vh_noise3(wp * 2.7) * 0.06 * f2 : 0.0);
  float hgt = mix(canopy * 1.1 * (0.4 + 0.6 * f1), rockB, vt_rock) + vt_h;
  normal = gr_bump(-vViewPosition, normal, hgt);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-geo-v1';
  return mat;
}
