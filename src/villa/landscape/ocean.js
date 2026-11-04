import * as THREE from 'three';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';
import { seaCascades, SEA_CASCADES } from '../water/spectrum.js';
import { buildShoreField } from '../water/shore.js';
import { GLSL_WATER_COMMON } from '../water/common.js';

// Open sea.
//  * Waves: three FFT cascades (733 m / 131 m / 23.7 m tiles, rotated against
//    each other, domain-warped, amplitude-modulated by wind slicks and gust
//    patches) built from a JONSWAP wind-sea + swell spectrum. Each texel stores
//    mean slope and mean squared slope, so mip-mapping turns unresolved waves
//    into roughness (LEAN mapping): sparkles near the camera, a smooth
//    sun-glitter path far away, no visible tiling.
//  * Shading: Cox-Munk sun glitter with Smith masking, Fresnel reflection of a
//    pre-rendered sky panorama filtered by the slope variance (with the
//    visible-facet tilt that darkens the far sea), terrain/island reflections
//    by a short height-field march, Beer-Lambert shallows over a mottled
//    bottom, and surf foam driven by a signed distance to the coastline.

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SKY}
${GLSL_HAZE}
${GLSL_WATER_COMMON}
precision highp sampler2DArray;
uniform sampler2DArray tWave;
uniform vec4 uCasc[3];
uniform vec2 uDrift[3];
uniform float uTailVar;
uniform sampler2D tSky;
uniform sampler2D tShoreNear;
uniform vec4 uShoreNearB;
uniform sampler2D tShoreFar;
uniform vec4 uShoreFarB;
uniform sampler2D tHeightNear;
uniform vec4 uNearBounds;
uniform sampler2D tHeightFar;
uniform vec4 uFarBounds;
uniform vec3 uSunColor;
uniform float uGlint;
uniform vec3 uDeep;
uniform vec3 uAbsorb;
uniform vec3 uAmbient;
uniform vec2 uWindDir;
uniform float uDebug;
varying vec3 vWorld;

// weight of the near texture inside its bounds (soft border)
float nearW(vec2 un) {
  vec2 a = smoothstep(vec2(0.0), vec2(0.05), un) * smoothstep(vec2(1.0), vec2(0.95), un);
  return a.x * a.y;
}

float terrainH(vec2 g) {
  vec2 un = (g - uNearBounds.xy) / (uNearBounds.zw - uNearBounds.xy);
  vec2 uf = (g - uFarBounds.xy) / (uFarBounds.zw - uFarBounds.xy);
  float far = (all(greaterThan(uf, vec2(0.0))) && all(lessThan(uf, vec2(1.0)))) ? texture2D(tHeightFar, uf).r : -40.0;
  float w = nearW(un);
  if (w <= 0.0) return far;
  return mix(far, texture2D(tHeightNear, clamp(un, 0.0, 1.0)).r, w);
}

vec4 shoreField(vec2 g) {
  vec2 un = (g - uShoreNearB.xy) / (uShoreNearB.zw - uShoreNearB.xy);
  vec2 uf = (g - uShoreFarB.xy) / (uShoreFarB.zw - uShoreFarB.xy);
  vec4 far = (all(greaterThan(uf, vec2(0.0))) && all(lessThan(uf, vec2(1.0)))) ? texture2D(tShoreFar, uf) : vec4(4000.0, 80.0, 1.0, 0.0);
  float w = nearW(un);
  if (w <= 0.0) return far;
  return mix(far, texture2D(tShoreNear, clamp(un, 0.0, 1.0)), w);
}

vec4 cascade(int i, vec2 p) {
  vec4 c = uCasc[i];
  vec2 q = mat2(c.y, c.z, -c.z, c.y) * p * c.x + uDrift[i] * uTime;
  vec4 t = texture(tWave, vec3(q, float(i)));
  // slopes back to the world frame (s_w = R^T s_f); |s|^2 and height are invariant
  return vec4(c.y * t.x + c.z * t.y, -c.z * t.x + c.y * t.y, t.z, t.w);
}

vec2 skyUV(vec3 d) {
  return vec2(atan(d.x, -d.z) * 0.15915494 + 0.5, sqrt(clamp(d.y, 0.0, 1.0)));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 P = vWorld;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 Vc = toCam / dist;
  Vc.y = max(Vc.y, 1e-3);
  vec2 g = vec2(P.x, -P.z); // plan coords

  // --- large-scale variation: wind slicks (smooth streaks) and gust patches
  vec2 wd = uWindDir;
  vec2 al = vec2(dot(P.xz, wd), dot(P.xz, vec2(-wd.y, wd.x)));
  float nSl = vh_fbm2(al * vec2(1.0 / 1500.0, 1.0 / 260.0) + vec2(17.0, 3.0), 4);
  float nGu = vh_fbm2(al * vec2(1.0 / 520.0, 1.0 / 380.0) - vec2(5.0, 9.0), 3);
  float slick = smoothstep(0.50, 0.60, nSl);
  float gust = smoothstep(0.30, 0.62, nGu);
  float a1 = (0.78 + 0.42 * gust) * (1.0 - 0.30 * slick);
  float a2 = (0.55 + 0.75 * gust) * (1.0 - 0.78 * slick);

  // --- waves: three cascades + unresolved tail (LEAN moments)
  vec2 warp = vec2(vh_fbm2(P.xz / 1900.0 + 3.1, 2), vh_fbm2(P.xz / 1900.0 - 8.7, 2)) - 0.44;
  vec2 p = P.xz + warp * 90.0;
  vec4 c0 = cascade(0, p);
  vec4 c1 = cascade(1, p);
  vec4 c2 = cascade(2, p);
  vec2 S = c0.xy + c1.xy * a1 + c2.xy * a2;
  float var = 0.5 * (max(c0.z - dot(c0.xy, c0.xy), 0.0)
            + a1 * a1 * max(c1.z - dot(c1.xy, c1.xy), 0.0)
            + a2 * a2 * max(c2.z - dot(c2.xy, c2.xy), 0.0))
            + uTailVar * (0.35 + 0.65 * a2 * a2);
  var = max(var, 2.5e-4);
  float sig = sqrt(var);
  float crest = c0.w + c1.w * a1 + c2.w * a2;

  // --- shore field: signed distance to the coastline, depth, swell exposure
  vec4 sh = shoreField(g);
  float sdf = sh.x;
  float depth = max(sh.y, 0.0);
  float expo = sh.z;
  // calmer water in the lee of the rocks right at the shore
  float nearShore = 1.0 - smoothstep(2.0, 40.0, sdf);

  // --- Fresnel reflection of the sky (visible-facet tilt toward the viewer)
  vec2 vh = normalize(Vc.xz + vec2(1e-5));
  float sa = Vc.y, ca = length(Vc.xz);
  float zeta = sa / max(ca * sig, 1e-4);
  float Phi = 1.0 / (1.0 + exp(-1.702 * zeta));
  float phi = 0.39894 * exp(-0.5 * zeta * zeta);
  float mv = sig * Phi / (zeta * Phi + phi);
  vec2 Se = S - vh * mv;
  vec3 Ne = normalize(vec3(-Se.x, 1.0, -Se.y));
  vec3 R = reflect(-Vc, Ne);
  float under = smoothstep(0.0, -0.12, R.y);
  R.y = max(R.y, 0.004);
  R = normalize(R);
  float F = vw_fresnel(max(dot(Vc, Ne), 0.0));
  float lod = clamp(log2(max(1.6 * sig, 1e-4) / 0.0062), 0.0, 7.5);
  vec3 refl = textureLod(tSky, skyUV(R), lod).rgb;
  // reflected rays that hit the land / islands (short height-field march)
  {
    float t = 1.2;
    float hit = 0.0;
    float th = 0.0;
    for (int i = 0; i < 18; i++) {
      vec3 q = P + R * t;
      if (q.y > 420.0) break;
      float hh = terrainH(vec2(q.x, -q.z));
      if (hh > q.y) { hit = 1.0; th = t; break; }
      t *= 1.48;
    }
    if (hit > 0.5) {
      vec3 hp = P + R * th;
      // dark limestone + maquis in the low evening light, lit side warmer
      vec3 land = mix(vec3(0.050, 0.058, 0.045), vec3(0.11, 0.10, 0.08), smoothstep(0.0, 25.0, hp.y - 2.0) * 0.4);
      land = vh_applyHaze(land * uSkyExposure, hp, P);
      refl = mix(refl, land, 0.92);
    }
  }
  refl = mix(refl, uDeep * 3.0 + textureLod(tSky, vec2(0.5, 0.05), 6.0).rgb * 0.25, under);

  // --- water body: deep blue, Beer-Lambert shallows over a mottled bottom
  float cosT = sqrt(1.0 - (1.0 - Vc.y * Vc.y) / 1.7769);
  float path = depth * (1.0 / cosT + 1.3);
  vec3 Tr = exp(-uAbsorb * path);
  float mott = vh_fbm2(g * 0.11 + 4.0, 4);
  float weed = smoothstep(0.42, 0.62, vh_fbm2(g * 0.045 - 7.0, 3));
  vec3 bottomAlb = mix(vec3(0.62, 0.60, 0.50), vec3(0.34, 0.36, 0.30), mott);
  bottomAlb = mix(bottomAlb, vec3(0.07, 0.09, 0.06), weed * 0.75);
  vec3 bottom = bottomAlb * uAmbient * 0.3183 * uSkyExposure;
  vec3 deep = uDeep * uSkyExposure;
  // slight view dependence: looking down shows the darker, more saturated body
  deep *= mix(1.15, 0.8, smoothstep(0.1, 0.8, Vc.y));
  vec3 body = deep * (1.0 - Tr) + bottom * Tr;
  // turbid, bubbly water right behind the surf
  float turb = (1.0 - smoothstep(0.5, 9.0, sdf)) * (0.35 + 0.65 * expo);
  body = mix(body, vec3(0.055, 0.17, 0.17) * uSkyExposure, turb * 0.45);
  // light through the thin crests of waves facing the low sun
  vec2 sunH = normalize(uSunDir.xz);
  float sss = clamp(crest * 1.6, 0.0, 1.0) * pow(max(dot(-vh, sunH), 0.0), 2.0) * max(dot(S, sunH) * 4.0, 0.0);
  body += vec3(0.010, 0.050, 0.045) * sss * uSkyExposure;

  // --- sun glitter (Cox-Munk, Gaussian slopes around the resolved slope)
  vec3 L = uSunDir;
  vec3 Hh = normalize(L + Vc);
  vec2 zh = -Hh.xz / max(Hh.y, 1e-3);
  vec2 dz = zh - S;
  float pdf = exp(-0.5 * dot(dz, dz) / var) / (6.2831853 * var);
  float Gm = vw_smithG1(Vc.y, sig) * vw_smithG1(L.y, sig);
  float FH = vw_fresnel(max(dot(Vc, Hh), 0.0));
  vec3 glint = uSunColor * uGlint * FH * pdf * Gm / (4.0 * Vc.y * pow(Hh.y, 4.0));
  // sub-pixel facets: few, very bright glints per pixel rather than a smooth
  // sheen (mean-preserving random field at the pixel-footprint scale)
  {
    float fpx = max(length(fwidth(P.xz)), 1e-3);
    float lv = log2(fpx * 1.7);
    float l0 = floor(lv);
    float fr = lv - l0;
    vec2 c0 = floor(P.xz / exp2(l0) + uTime * 0.7);
    vec2 c1 = floor(P.xz / exp2(l0 + 1.0) + uTime * 0.35);
    float dens = 0.22;
    float sp0 = step(1.0 - dens, vh_hash12(c0 * 0.731 + 13.1)) / dens;
    float sp1 = step(1.0 - dens, vh_hash12(c1 * 0.913 - 7.3)) / dens;
    float sp = mix(sp0, sp1, fr);
    float unres = clamp((var - 0.5 * dot(c2.xy, c2.xy)) / var, 0.0, 1.0);
    float k = unres * (1.0 - smoothstep(250.0, 1400.0, dist));
    glint *= mix(1.0, sp, k * 0.85);
  }
  glint = min(glint, vec3(60.0));

  vec3 col = mix(body, refl, F) + glint;

  // --- surf foam along the coastline: intermittent, lacy, strongest on
  // exposed headlands, travelling bands that break up offshore
  float fw = max(length(fwidth(P.xz)), 1e-3);
  float shoreFoam = 0.0;
  if (sdf < 70.0) {
    vec2 fp = g;
    float nA = vh_fbm2(fp * 0.021 + 7.7, 3);      // along-shore activity (tens of m)
    float nW = vh_fbm2(fp * 0.08 + 1.3, 3);
    float nW2 = vh_fbm2(fp * 0.31 - 4.1, 3);
    float act = smoothstep(0.22, 0.62, nA) * (0.3 + 0.7 * expo);
    float s = sdf + (nW - 0.45) * 3.0 + (nW2 - 0.45) * 1.2;
    // wash zone hugging the rocks: width and density vary along the shore
    float wW = 0.5 + 2.4 * act;
    float wash = (1.0 - smoothstep(0.0, wW, s)) * (0.35 + 0.65 * act) * smoothstep(-1.5, 0.2, s + 1.0);
    // surf lines travelling toward the shore, broken along their length
    float ph = s * 0.55 + uTime * 0.9 + nW * 6.0;
    float lines = pow(0.5 + 0.5 * cos(ph), 10.0);
    float broken = smoothstep(0.45, 0.8, vh_fbm2(vec2(fp.x + fp.y * 0.3, fp.y - fp.x * 0.3) * 0.11 + nW2 * 1.7, 3) + 0.2 * act);
    lines *= broken * act * (1.0 - smoothstep(3.0, 20.0, s)) * smoothstep(1.0, 2.5, s);
    // residual foam streaks drifting off the surf zone
    float resid = (1.0 - smoothstep(2.0, 14.0 + 22.0 * act, s)) * smoothstep(0.5, 0.75, nW2) * 0.45 * act;
    float cover = clamp(max(max(wash, lines * 0.9), resid), 0.0, 1.0);
    // lacy structure, faded to its mean where a pixel covers many cells
    float cell = 1.3;
    float lace = vw_lace(fp / cell + vec2(uTime * 0.05, 0.0), nW2);
    float detail = clamp(fw / cell, 0.0, 1.0);
    float pat = mix(lace, 0.45, smoothstep(0.2, 0.8, detail));
    shoreFoam = smoothstep(1.0 - cover, 1.0 - cover + 0.3, pat + cover * 0.2) * cover;
    shoreFoam *= 1.0 - smoothstep(1200.0, 5000.0, dist);
  }
  vec3 foamCol = vec3(0.86, 0.89, 0.90) * (uAmbient * 0.3183 + uSunColor * 0.12) * uSkyExposure;
  col = mix(col, foamCol, clamp(shoreFoam, 0.0, 0.95));

  col = vh_applyHaze(col, P, cameraPosition);
  if (uDebug > 0.5) {
    if (uDebug < 1.5) col = refl;
    else if (uDebug < 2.5) col = vec3(F);
    else if (uDebug < 3.5) col = body;
    else if (uDebug < 4.5) col = glint;
    else if (uDebug < 5.5) col = vec3(shoreFoam);
    else col = vec3(sig * 5.0);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// --- sky panorama for reflections (upper hemisphere, sqrt(elevation) rows) ---
const skyPanoFrag = /* glsl */ `
${GLSL_SKY}
varying vec2 vUv;
void main() {
  float sy = vUv.y * vUv.y;
  float r = sqrt(max(1.0 - sy * sy, 0.0));
  float az = (vUv.x - 0.5) * 6.2831853;
  vec3 d = normalize(vec3(r * sin(az), sy, -r * cos(az)));
  vec3 c = vh_sky(d, false);
  // half of the broad warm sun glow: spread by the slope blur it would grey
  // the whole sun-side sea; the glitter term carries the sun itself
  float muc = max(dot(d, uSunDir), 0.0);
  float hw = exp(-max(d.y, 0.0) * 7.0);
  c -= vec3(1.0, 0.86, 0.58) * (pow(muc, 7.0) * 0.30 * (0.30 + 0.70 * hw) * 0.55 + pow(muc, 64.0) * 0.35 * 0.5) * uSkyExposure;
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
}
`;

function renderSkyPanorama(renderer, cloudScale = 0.62) {
  const rt = new THREE.WebGLRenderTarget(1024, 256, {
    type: THREE.HalfFloatType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  // thinner clouds than the visible sky: blurred by the wave slopes, the low
  // sun-lit cloud band would otherwise turn the whole sea silver-grey
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphereUniforms, uCloudCover: { value: atmosphereUniforms.uCloudCover.value * cloudScale } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: skyPanoFrag,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene();
  sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(sc, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
  return rt;
}

/**
 * Wave cascades (CPU FFT) as a mip-mapped texture array, plus the reflected-sky
 * panorama. Returns { texture, dispose() } like a render target.
 */
export function generateWaveTexture(renderer, size = 256, seed = 3) {
  const { layers, tailVar } = seaCascades({ n: size, seed });
  const toH = THREE.DataUtils.toHalfFloat;
  const n2 = size * size;
  const data = new Uint16Array(n2 * 4 * layers.length);
  layers.forEach((f, l) => {
    const o = l * n2 * 4;
    for (let i = 0; i < n2; i++) {
      const sx = f.sx[i], sz = f.sz[i];
      data[o + i * 4] = toH(sx);
      data[o + i * 4 + 1] = toH(sz);
      data[o + i * 4 + 2] = toH(sx * sx + sz * sz);
      data[o + i * 4 + 3] = toH(f.h ? f.h[i] : 0);
    }
  });
  const tex = new THREE.DataArrayTexture(data, size, size, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.HalfFloatType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.tailVar = 0.5 * (tailVar[0] + tailVar[1]);
  const sky = renderSkyPanorama(renderer);
  tex.userData.sky = sky.texture;
  return {
    texture: tex,
    dispose() {
      tex.dispose();
      sky.dispose();
    },
  };
}

export function createOcean({ heightNear, heightFar, waveTexture }) {
  const shoreNear = buildShoreField(heightNear);
  const shoreFar = buildShoreField(heightFar);
  // wave travel direction (three.js x/z frame): from the south-south-west
  const windAng = -1.32;
  const wind = new THREE.Vector2(Math.cos(windAng), Math.sin(windAng));
  const casc = SEA_CASCADES.map(({ L, rot }) => new THREE.Vector4(1 / L, Math.cos(rot), Math.sin(rot), 0));
  // drift (animation only): each cascade glides with a typical phase speed of
  // its band, expressed in its own rotated texture frame
  const speeds = [4.2, 2.6, 1.1];
  const drift = SEA_CASCADES.map(({ L, rot }, i) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const d = new THREE.Vector2(c * wind.x - s * wind.y, s * wind.x + c * wind.y);
    return d.multiplyScalar(speeds[i] / L);
  });
  const uniforms = {
    ...atmosphereUniforms,
    ...hazeUniforms,
    tHeightNear: { value: heightNear },
    uNearBounds: { value: heightNear.userData.bounds },
    tHeightFar: { value: heightFar },
    uFarBounds: { value: heightFar.userData.bounds },
    tShoreNear: { value: shoreNear },
    uShoreNearB: { value: shoreNear.userData.bounds },
    tShoreFar: { value: shoreFar },
    uShoreFarB: { value: shoreFar.userData.bounds },
    tWave: { value: waveTexture },
    tSky: { value: waveTexture.userData.sky ?? null },
    uCasc: { value: casc },
    uDrift: { value: drift },
    uTailVar: { value: waveTexture.userData.tailVar ?? 0.004 },
    // sun irradiance in scene units (matches the key light: 3.8 x pale gold)
    uSunColor: { value: new THREE.Color(1.0, 0.87, 0.64).multiplyScalar(3.8) },
    uGlint: { value: 0.16 },
    uDeep: { value: new THREE.Vector3(0.0032, 0.022, 0.086) },
    uAbsorb: { value: new THREE.Vector3(0.5, 0.115, 0.07) },
    uAmbient: { value: new THREE.Vector3(1.55, 1.75, 2.15) },
    uWindDir: { value: wind },
    uDebug: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'Ocean',
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: false,
  });
  mat.extensions = { derivatives: true };
  const geo = new THREE.CircleGeometry(60000, 256, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.name = 'ocean';
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  // the wave texture may be regenerated (context restore): keep the sky in sync
  mesh.onBeforeRender = () => {
    const w = uniforms.tWave.value;
    if (w?.userData?.sky && uniforms.tSky.value !== w.userData.sky) {
      uniforms.tSky.value = w.userData.sky;
      uniforms.uTailVar.value = w.userData.tailVar ?? uniforms.uTailVar.value;
    }
  };
  mesh.userData.dispose = () => {
    shoreNear.dispose();
    shoreFar.dispose();
  };
  return mesh;
}
