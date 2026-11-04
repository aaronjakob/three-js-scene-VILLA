import * as THREE from 'three';
import { GLSL_NOISE } from '../core/noise.js';
import { sunDirection } from '../core/world.js';

// One shared description of the evening sky, used by:
//   - the visible sky dome
//   - the PMREM environment (reflections / IBL)
//   - the ocean's analytic reflection
//   - aerial perspective on every material (patched fog chunk)
// so that sky, sea, glass and haze always agree.

export const atmosphereUniforms = {
  uSunDir: { value: sunDirection(new THREE.Vector3()) },
  uTime: { value: 0 },
  uSkyExposure: { value: 1.0 },
  uHazeDensity: { value: 0.000115 },
  uHazeHeight: { value: 320.0 },
  uHazeColor: { value: new THREE.Color(0.56, 0.68, 0.84) },
  uSunHazeColor: { value: new THREE.Color(0.95, 0.86, 0.70) },
  uCloudCover: { value: 0.46 },
};

export const GLSL_SKY = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uSunDir;
uniform float uTime;
uniform float uSkyExposure;
uniform float uCloudCover;

vec3 vh_skyBase(vec3 d) {
  float h = d.y;
  float hp = max(h, 0.0);
  float t = pow(hp, 0.5);
  // clean early-evening blue: deep zenith -> soft cyan-blue -> pale haze at horizon
  vec3 zenith  = vec3(0.060, 0.155, 0.420);
  vec3 upper   = vec3(0.150, 0.330, 0.700);
  vec3 mid     = vec3(0.360, 0.560, 0.860);
  vec3 horizon = vec3(0.780, 0.840, 0.900);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, t));
  col = mix(col, upper, smoothstep(0.22, 0.6, t));
  col = mix(col, zenith, smoothstep(0.6, 1.0, t));

  float mu = dot(d, uSunDir);
  float muc = max(mu, 0.0);
  // broad champagne glow toward the sun, strongest at the horizon
  vec3 sunTint = vec3(1.0, 0.86, 0.58);
  float horizonW = exp(-hp * 7.0);
  col += sunTint * (pow(muc, 7.0) * 0.30 * (0.30 + 0.70 * horizonW));
  col += sunTint * pow(muc, 64.0) * 0.35;
  col += vec3(1.0, 0.93, 0.80) * pow(muc, 900.0) * 1.0;
  col += vec3(1.0, 0.90, 0.62) * smoothstep(0.99994, 0.99997, mu) * 12.0;
  // very subtle warm band hugging the horizon all around the sun side
  col = mix(col, vec3(0.95, 0.90, 0.80), exp(-hp * 45.0) * (0.15 + 0.35 * pow(mu * 0.5 + 0.5, 4.0)));
  // anti-solar side slightly cooler/pinker-free blue
  col *= mix(vec3(0.93, 0.97, 1.04), vec3(1.0), mu * 0.5 + 0.5);
  return col;
}

// High altocumulus / cirrus layer, lit pale gold toward the sun.
vec4 vh_clouds(vec3 d) {
  if (d.y <= 0.004) return vec4(0.0);
  float H = 2600.0;
  vec2 p = d.xz / d.y * H;
  vec2 wind = vec2(uTime * 1.2, uTime * 0.4);
  vec2 q = p * 0.00028 + wind * 0.0001;
  // domain warp for streaky shapes
  vec2 w = vec2(vh_fbm2(q * 0.7 + 3.1, 4), vh_fbm2(q * 0.7 - 7.3, 4));
  vec2 s = q + (w - 0.5) * 1.6;
  s.x *= 0.55; // elongate along x (streaks)
  float n = vh_fbm2(s * 1.4, 6);
  float detail = vh_fbm2(s * 7.0 + 13.0, 4);
  float cov = uCloudCover;
  float dens = smoothstep(1.0 - cov, 1.0 - cov + 0.22, n * 0.85 + detail * 0.25);
  // thin out overhead, thicken toward mid-horizon, fade at horizon
  float elev = d.y;
  dens *= smoothstep(0.004, 0.08, elev) * mix(1.0, 0.55, smoothstep(0.25, 0.8, elev));
  float mu = dot(d, uSunDir);
  float forward = pow(max(mu, 0.0), 5.0);
  vec3 shade = vec3(0.50, 0.57, 0.70);
  vec3 lit = vec3(1.05, 1.0, 0.96);
  vec3 gold = vec3(1.25, 1.02, 0.72);
  float edge = smoothstep(0.0, 0.6, dens) * (1.0 - smoothstep(0.6, 1.0, dens));
  vec3 c = mix(shade, lit, 0.45 + 0.35 * detail);
  c = mix(c, gold, clamp(forward * 0.9 + edge * forward * 1.2, 0.0, 1.0));
  c += gold * edge * forward * 1.5;
  float a = clamp(dens * 0.92, 0.0, 0.92);
  return vec4(c, a);
}

vec3 vh_sky(vec3 d, bool withSun) {
  vec3 dir = d;
  float below = 0.0;
  if (dir.y < 0.0) { below = -dir.y; dir.y = 0.0; dir = normalize(dir + vec3(0.0, 1e-4, 0.0)); }
  vec3 col = vh_skyBase(dir);
  if (!withSun) {
    float mu = dot(dir, uSunDir);
    col -= vec3(1.0, 0.93, 0.80) * pow(max(mu, 0.0), 900.0) * 1.0;
    col -= vec3(1.0, 0.90, 0.62) * smoothstep(0.99994, 0.99997, mu) * 12.0;
  }
  vec4 cl = vh_clouds(dir);
  col = mix(col, cl.rgb * (0.6 + 0.4 * vh_skyBase(normalize(dir + vec3(0.0, 0.4, 0.0))).b / 0.7), cl.a);
  // below horizon (used by env map): dark marine blue-grey
  col = mix(col, vec3(0.055, 0.105, 0.16), smoothstep(0.0, 0.08, below));
  return col * uSkyExposure;
}
`;

// Aerial perspective, shared by all built-in materials via the fog chunk.
export const GLSL_HAZE = /* glsl */ `
uniform vec3 uHazeColor;
uniform vec3 uSunHazeColor;
uniform float uHazeDensity;
uniform float uHazeHeight;
uniform vec3 uSunDirHaze;

// 1 outside, falling to ~0.3 deep inside the main / upper floor envelopes
float vh_interiorK(vec3 w) {
  vec2 g = vec2(w.x, -w.z);
  float k = 1.0;
  if (w.y > 17.9 && w.y < 22.3) {
    float e = length((g - vec2(0.0, 0.7)) / vec2(18.4, 10.0));
    k = mix(0.3, 1.0, smoothstep(0.62, 1.0, e));
  } else if (w.y >= 22.3 && w.y < 27.6) {
    float e = length((g - vec2(-0.5, 1.6)) / vec2(16.5, 8.2));
    k = mix(0.35, 1.0, smoothstep(0.6, 1.0, e));
  }
  return k;
}

vec3 vh_applyHaze(vec3 col, vec3 worldPos, vec3 camPos) {
  vec3 ray = worldPos - camPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  // exponential height fog integrated along the ray
  float h0 = max(camPos.y, 0.0);
  float k = 1.0 / uHazeHeight;
  float dy = rd.y;
  float fogInt;
  if (abs(dy) > 1e-4) {
    fogInt = uHazeDensity * exp(-h0 * k) * (1.0 - exp(-dist * dy * k)) / (dy * k);
  } else {
    fogInt = uHazeDensity * exp(-h0 * k) * dist;
  }
  float f = 1.0 - exp(-max(fogInt, 0.0));
  float mu = max(dot(rd, uSunDirHaze), 0.0);
  vec3 hc = mix(uHazeColor, uSunHazeColor, pow(mu, 8.0) * 0.75);
  return mix(col, hc, f);
}
`;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFragment = /* glsl */ `
${GLSL_SKY}
varying vec3 vDir;
uniform float uWithSun;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = vh_sky(d, uWithSun > 0.5);
  gl_FragColor = vec4(c, 1.0);
}
`;

export function createSkyDome({ withSun = true } = {}) {
  const mat = new THREE.ShaderMaterial({
    name: 'VillaSky',
    uniforms: {
      ...atmosphereUniforms,
      uWithSun: { value: withSun ? 1 : 0 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const geo = new THREE.SphereGeometry(1, 96, 48);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(40000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}

// Build a PMREM environment from the analytic sky (no HDRI downloads).
export function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const dome = createSkyDome({ withSun: false });
  // IBL from a cloud-free sky: glossy floors must not mirror cloud shapes
  dome.material.uniforms = { ...dome.material.uniforms, uCloudCover: { value: 0.0 } };
  dome.scale.setScalar(100);
  dome.material.depthTest = false;
  scene.add(dome);
  // a broad soft "sun" lobe so glossy surfaces get a believable highlight
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(6, 16, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.62).multiplyScalar(14) }),
  );
  sunGlow.position.copy(atmosphereUniforms.uSunDir.value).multiplyScalar(80);
  scene.add(sunGlow);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 1000, { size: 256 });
  pmrem.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  sunGlow.geometry.dispose();
  sunGlow.material.dispose();
  return rt.texture;
}

// Replace three's fog with height-aware aerial perspective for every built-in
// material. Must be installed before materials compile.
// Ref-counted: the chunks are restored when the last villa instance is disposed,
// so other three.js scenes in the host keep stock fog/IBL behaviour.
let hazeRefs = 0;
let savedChunks = null;
export function uninstallHaze() {
  hazeRefs = Math.max(0, hazeRefs - 1);
  if (hazeRefs === 0 && savedChunks) {
    Object.assign(THREE.ShaderChunk, savedChunks);
    savedChunks = null;
  }
}
export function installHaze() {
  hazeRefs++;
  if (savedChunks) return;
  savedChunks = {};
  for (const k of ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment', 'lights_fragment_maps']) savedChunks[k] = THREE.ShaderChunk[k];
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vHazeWorldPos;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  #ifdef USE_INSTANCING
    vHazeWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vHazeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vHazeWorldPos;
  ${GLSL_HAZE}
#endif
`;
  // Interior light falloff: sky IBL is not occluded by walls in a forward
  // renderer, so inside the glazed envelopes we attenuate it with distance
  // from the glass and add a faint warm bounce from the 2700 K lights.
  THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps + /* glsl */ `
#ifdef USE_FOG
{
  float ik = vh_interiorK(vHazeWorldPos);
  #if defined( RE_IndirectDiffuse )
    iblIrradiance *= ik;
    irradiance *= mix(1.0, ik, 0.7);
    iblIrradiance += vec3(1.0, 0.78, 0.58) * (1.0 - ik) * 0.10;
  #endif
  #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
    radiance *= ik * ik;
  #endif
}
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = vh_applyHaze(gl_FragColor.rgb, vHazeWorldPos, cameraPosition);
#endif
`;
}

// Materials need the haze uniforms; attach them through onBeforeCompile.
export const hazeUniforms = {
  uHazeColor: atmosphereUniforms.uHazeColor,
  uSunHazeColor: atmosphereUniforms.uSunHazeColor,
  uHazeDensity: atmosphereUniforms.uHazeDensity,
  uHazeHeight: atmosphereUniforms.uHazeHeight,
  uSunDirHaze: atmosphereUniforms.uSunDir,
};

export function attachHaze(material) {
  if (material.userData.hazeAttached) return material;
  material.userData.hazeAttached = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, hazeUniforms);
    if (prev) prev(shader, renderer);
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|haze';
  return material;
}

export function attachHazeToScene(root) {
  root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.isShaderMaterial) continue;
      if (m.fog === false) continue;
      attachHaze(m);
    }
  });
}
