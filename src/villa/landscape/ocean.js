import * as THREE from 'three';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';

// Analytic open-sea shader: multi-scale wave normals (distance-filtered),
// Fresnel reflection of the same analytic sky, sun glitter path, depth- and
// shore-aware body colour, and surf foam where the terrain meets the water.

const vertex = /* glsl */ `
varying vec3 vWorld;
varying vec4 vClip;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  vClip = gl_Position;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SKY}
${GLSL_HAZE}
uniform sampler2D tHeightNear;
uniform vec4 uNearBounds;
uniform sampler2D tHeightFar;
uniform vec4 uFarBounds;
uniform vec3 uSunColor;
varying vec3 vWorld;
varying vec4 vClip;

float terrainH(vec2 g) {
  vec2 un = (g - uNearBounds.xy) / (uNearBounds.zw - uNearBounds.xy);
  if (all(greaterThan(un, vec2(0.0))) && all(lessThan(un, vec2(1.0)))) {
    return texture2D(tHeightNear, un).r;
  }
  vec2 uf = (g - uFarBounds.xy) / (uFarBounds.zw - uFarBounds.xy);
  if (all(greaterThan(uf, vec2(0.0))) && all(lessThan(uf, vec2(1.0)))) {
    return texture2D(tHeightFar, uf).r;
  }
  return -40.0;
}

uniform sampler2D tWave;
vec2 waveLayer(vec2 p, float scale, float ang, vec2 drift) {
  float c = cos(ang), sn = sin(ang);
  vec2 q = mat2(c, -sn, sn, c) * p / scale + drift * uTime;
  return texture2D(tWave, q).rg;
}
vec2 waveSlope(vec2 p) {
  vec2 s = vec2(0.0);
  s += waveLayer(p, 97.0, 0.2, vec2(0.0019, 0.0011)) * 0.105;
  s += waveLayer(p, 31.0, 1.9, vec2(-0.0047, 0.0029)) * 0.075;
  s += waveLayer(p, 10.3, 3.7, vec2(0.0105, -0.0078)) * 0.05;
  s += waveLayer(p, 3.3, 5.1, vec2(-0.0250, -0.0160)) * 0.032;
  // long, slow swell from the south-south-west
  vec2 d1 = normalize(vec2(0.25, 1.0));
  vec2 d2 = normalize(vec2(-0.45, 1.0));
  s += d1 * 0.035 * cos(dot(d1, p) * 0.075 - uTime * 0.86);
  s += d2 * 0.025 * cos(dot(d2, p) * 0.112 - uTime * 1.05 + 1.3);
  return s;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 P = vWorld;
  vec3 V = P - cameraPosition;
  float dist = length(V);
  vec3 vd = V / dist;
  float footprint = dist * 0.0022 / max(abs(vd.y), 0.06);
  vec2 g = vec2(P.x, -P.z); // GLB plan coords
  vec2 sl = waveSlope(P.xz);
  // calm the micro-slopes with distance (sub-pixel waves average out)
  float flatK = 1.0 + smoothstep(120.0, 2500.0, dist) * 1.6;
  vec3 N = normalize(vec3(-sl.x, flatK, -sl.y));

  vec3 R = reflect(vd, N);
  float downR = smoothstep(0.01, -0.18, R.y);
  R.y = max(R.y, 0.004);
  R = normalize(R);
  float cosT = clamp(dot(-vd, N), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 refl = vh_sky(R, false) * 0.9;
  // reflected rays that dip below the horizon see the next wave, not the sky
  refl = mix(refl, vh_sky(normalize(vec3(R.x, 0.05, R.z)), false) * 0.55, downR);

  // sun glitter: sharp near, broad far
  float rough = mix(0.0016, 0.012, smoothstep(30.0, 6000.0, dist));
  float mu = max(dot(R, uSunDir), 0.0);
  float spec = pow(mu, 1.0 / rough) * (1.0 / rough) * 0.0045;
  vec3 sunCol = uSunColor;

  // water body: depth from terrain heightfield
  float th = terrainH(g);
  float depth = max(-th, 0.0);
  float shallow = 1.0 - smoothstep(0.5, 9.0, depth);
  vec3 deep = vec3(0.006, 0.030, 0.075);
  vec3 mid = vec3(0.012, 0.060, 0.115);
  vec3 lagoon = vec3(0.030, 0.150, 0.160);
  vec3 body = mix(deep, mid, pow(1.0 - abs(vd.y), 2.0) * 0.5);
  body = mix(body, lagoon, shallow * shallow * 0.75);
  // subsurface brightening on wave faces lit by the low sun
  float sss = pow(max(dot(normalize(vec3(vd.x, 0.0, vd.z)), uSunDir), 0.0), 3.0) * max(sl.x * uSunDir.x + sl.y * uSunDir.z, 0.0);
  body += vec3(0.02, 0.10, 0.10) * sss * 2.0;
  body *= 0.9 + 0.2 * uSkyExposure;

  vec3 col = mix(body, refl, F) + sunCol * spec;

  // surf: foam where water meets rock
  float shoreLine = 1.0 - smoothstep(0.0, 2.2, depth);
  float fn = vh_fbm3(vec3(P.xz * 0.35, uTime * 0.25), 4);
  float fn2 = vh_noise3(vec3(P.xz * 1.6, uTime * 0.6));
  float band = smoothstep(0.15, 0.85, shoreLine + fn * 0.55 + fn2 * 0.12);
  float foam = band * smoothstep(-0.05, 0.25, fn + 0.12) * (1.0 - smoothstep(150.0, 1500.0, dist));
  vec3 foamCol = vec3(0.82, 0.86, 0.88) * (0.55 + 0.45 * uSkyExposure);
  col = mix(col, foamCol, clamp(foam * 0.85, 0.0, 0.9));

  col = vh_applyHaze(col, P, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Tileable wave-slope texture generated on the GPU once (sum of periodic
// directional waves with a wind-shaped spectrum). No downloaded normal maps.
const genFrag = /* glsl */ `
uniform vec4 uWaves[160];
varying vec2 vUv;
void main() {
  vec2 p = vUv * 6.28318530718;
  vec2 s = vec2(0.0);
  for (int i = 0; i < 160; i++) {
    vec4 w = uWaves[i];
    float ph = dot(w.xy, p) + w.w;
    s += w.xy * w.z * cos(ph);
  }
  gl_FragColor = vec4(s, 0.0, 1.0);
}
`;

export function generateWaveTexture(renderer, size = 512, seed = 3) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const waves = [];
  const wind = 0.35;
  let sumSq = 0;
  while (waves.length < 160) {
    const kx = Math.round((rnd() * 2 - 1) * 22);
    const ky = Math.round((rnd() * 2 - 1) * 22);
    const k = Math.hypot(kx, ky);
    if (k < 2) continue;
    const ang = Math.atan2(ky, kx);
    const align = Math.cos(ang - wind);
    const spread = Math.pow(Math.abs(align), 1.6) * (align > 0 ? 1 : 0.35) + 0.08;
    const amp = (spread / Math.pow(k, 1.9)) * (0.7 + 0.6 * rnd());
    sumSq += (amp * k) ** 2 * 0.5;
    waves.push(new THREE.Vector4(kx, ky, amp, rnd() * Math.PI * 2));
  }
  const norm = 1 / Math.sqrt(sumSq);
  for (const w of waves) w.z *= norm;
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  rt.texture.anisotropy = 8;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uWaves: { value: waves } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: genFrag,
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

export function createOcean({ heightNear, heightFar, waveTexture }) {
  const uniforms = {
    ...atmosphereUniforms,
    ...hazeUniforms,
    tHeightNear: { value: heightNear },
    uNearBounds: { value: heightNear.userData.bounds },
    tHeightFar: { value: heightFar },
    uFarBounds: { value: heightFar.userData.bounds },
    uSunColor: { value: new THREE.Color(1.0, 0.88, 0.66).multiplyScalar(14) },
    tWave: { value: waveTexture },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'Ocean',
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    fog: false,
  });
  // radial grid: dense near the coast, sparse to the horizon
  const geo = new THREE.CircleGeometry(60000, 256, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0;
  mesh.name = 'ocean';
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;
  return mesh;
}
