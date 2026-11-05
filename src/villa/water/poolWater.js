import * as THREE from 'three';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';
import { synthField, poolSpectrum, causticPattern } from './spectrum.js';
import { GLSL_WATER_COMMON } from './common.js';

// Pool water, shaded as an opaque surface that ray-traces what lies below it:
// the refracted view ray is marched through a signed-distance field of the
// pool outline to the tiled floor or walls, which are lit by the sky, the
// refracted sun (with caustics and wall shadows) and the underwater lights,
// and attenuated by Beer-Lambert absorption along the in-water path. The
// surface itself adds Fresnel reflection (planar reflection of the house when
// available, analytic sky otherwise) and a small sun glint. No alpha blending,
// so the pool never reads as a milky glass tank.

const H2 = (v) => THREE.DataUtils.toHalfFloat(v);

// --- signed distance (m, + inside) and arc length of the nearest outline point
export function poolSDFTexture(outline, { W = 512, H = 128, margin = 0.35 } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of outline) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const n = outline.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), ex = new Float64Array(n), ey = new Float64Array(n), l2 = new Float64Array(n), s0 = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    ax[i] = a.x; ay[i] = a.y; ex[i] = b.x - a.x; ey[i] = b.y - a.y;
    l2[i] = ex[i] * ex[i] + ey[i] * ey[i] || 1e-9;
    s0[i] = acc;
    acc += Math.sqrt(l2[i]);
  }
  const data = new Uint16Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const y = y0 + ((j + 0.5) / H) * (y1 - y0);
    // inside test by crossings along this row
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * (x1 - x0);
      let best = Infinity, bs = 0, inside = false;
      for (let k = 0; k < n; k++) {
        let t = ((x - ax[k]) * ex[k] + (y - ay[k]) * ey[k]) / l2[k];
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax[k] + ex[k] * t), dy = y - (ay[k] + ey[k] * t);
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bs = s0[k] + t * Math.sqrt(l2[k]); }
        const yi = ay[k], yj = ay[k] + ey[k];
        if ((yi > y) !== (yj > y) && x < (ex[k] * (y - yi)) / ey[k] + ax[k]) inside = !inside;
      }
      const o = (j * W + i) * 4;
      data[o] = H2((inside ? 1 : -1) * Math.sqrt(best));
      data[o + 1] = H2(bs);
      data[o + 2] = 0;
      data[o + 3] = H2(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.userData.bounds = new THREE.Vector4(x0, y0, x1, y1);
  tex.userData.perimeter = acc;
  return tex;
}

// --- ripple field (slopes, |s|^2, height) and its caustic pattern ------------
let rippleCache = null;
export function poolRippleTextures({ n = 128, L = 4, rms = 0.055 } = {}) {
  if (rippleCache) return rippleCache;
  const f = synthField(poolSpectrum(), { n, L, seed: 77, wantHeight: true });
  let s2 = 0;
  for (let i = 0; i < n * n; i++) s2 += f.sx[i] ** 2 + f.sz[i] ** 2;
  const k = rms / Math.sqrt(s2 / (n * n) || 1);
  const data = new Uint16Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const sx = f.sx[i] * k, sz = f.sz[i] * k;
    f.sx[i] = sx; f.sz[i] = sz;
    data[i * 4] = H2(sx);
    data[i * 4 + 1] = H2(sz);
    data[i * 4 + 2] = H2(sx * sx + sz * sz);
    data[i * 4 + 3] = H2(f.h[i] * k);
  }
  const ripple = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
  ripple.minFilter = THREE.LinearMipmapLinearFilter;
  ripple.magFilter = THREE.LinearFilter;
  ripple.generateMipmaps = true;
  ripple.anisotropy = 4;
  ripple.needsUpdate = true;
  // refracted direction of the low sun inside the water
  const sun = atmosphereUniforms.uSunDir.value;
  const eta = 1 / 1.333;
  const cosi = sun.y;
  const sint2 = eta * eta * (1 - cosi * cosi);
  const ry = -Math.sqrt(1 - sint2);
  const hx = -sun.x * eta, hz = -sun.z * eta;
  const out = 256;
  const c = causticPattern(f.sx, f.sz, n, L, { depth: 1.15, dirX: -sun.x, dirZ: -sun.z, out });
  void ry; void hx; void hz;
  const cd = new Uint16Array(out * out * 4);
  for (let i = 0; i < out * out; i++) {
    const v = H2(Math.min(c[i], 12));
    cd[i * 4] = v; cd[i * 4 + 1] = v; cd[i * 4 + 2] = v; cd[i * 4 + 3] = H2(1);
  }
  const caustic = new THREE.DataTexture(cd, out, out, THREE.RGBAFormat, THREE.HalfFloatType);
  caustic.wrapS = caustic.wrapT = THREE.RepeatWrapping;
  caustic.minFilter = THREE.LinearMipmapLinearFilter;
  caustic.magFilter = THREE.LinearFilter;
  caustic.generateMipmaps = true;
  caustic.needsUpdate = true;
  rippleCache = { ripple, caustic, L };
  return rippleCache;
}

const waterVert = /* glsl */ `
varying vec3 vWorld;
varying vec4 vReflCoord;
uniform mat4 uReflMatrix;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vReflCoord = uReflMatrix * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const waterFrag = /* glsl */ `
${GLSL_SKY}
${GLSL_HAZE}
${GLSL_WATER_COMMON}
uniform sampler2D tRefl;
uniform float uHasRefl;
uniform sampler2D tSDF;
uniform vec4 uSDFB;
uniform sampler2D tRipple;
uniform sampler2D tCaustic;
uniform float uRippleL;
uniform float uFloorY;
uniform float uWaterY;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uAbsorb;
uniform vec3 uTile;
uniform vec4 uLights[12];
uniform vec3 uLightColor;
uniform float uCanopy;
varying vec3 vWorld;
varying vec4 vReflCoord;

vec2 sdfUV(vec2 g) { return (g - uSDFB.xy) / (uSDFB.zw - uSDFB.xy); }
float sdfAt(vec2 g) { return texture2D(tSDF, sdfUV(g)).r; }

void main() {
  vec3 P = vWorld;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 Vc = toCam / dist;
  vec2 g = vec2(P.x, -P.z);
  float t = uTime;

  // --- ripples: the FFT tile at two scales/orientations, gentle swell
  vec2 q = P.xz;
  vec4 ra = texture2D(tRipple, q / uRippleL + vec2(0.021, 0.013) * t);
  vec2 qb = mat2(0.8, 0.6, -0.6, 0.8) * q;
  vec4 rb = texture2D(tRipple, qb / (uRippleL * 0.57) + vec2(-0.017, 0.026) * t);
  vec2 sb = vec2(0.8 * rb.x + 0.6 * rb.y, -0.6 * rb.x + 0.8 * rb.y);
  vec2 S = ra.xy + sb * 0.55;
  S += 0.006 * vec2(sin(dot(q, vec2(0.9, 0.4)) + t * 0.8), cos(dot(q, vec2(-0.3, 1.1)) - t * 0.7));
  float var = 0.5 * (max(ra.z - dot(ra.xy, ra.xy), 0.0) + 0.3 * max(rb.z - dot(rb.xy, rb.xy), 0.0)) + 3e-4;
  float sig = sqrt(var);
  vec3 N = normalize(vec3(-S.x, 1.0, -S.y));
  float cosV = max(dot(Vc, N), 0.0);
  float F = vw_fresnel(cosV);

  // --- reflection: planar reflection of the house/sky, sky otherwise
  vec3 R = reflect(-Vc, N);
  vec3 refl;
  if (uHasRefl > 0.5) {
    vec2 uv = vReflCoord.xy / vReflCoord.w + S * 0.16;
    refl = min(textureLod(tRefl, uv, 0.6).rgb, vec3(5.0));
  } else {
    vec3 Rs = R;
    Rs.y = max(Rs.y, 0.01);
    refl = vh_sky(normalize(Rs), false);
  }

  // --- refraction: march the refracted ray to the floor or a wall
  vec3 T = refract(-Vc, N, 0.7502);
  T.y = min(T.y, -0.05);
  T = normalize(T);
  float tFloor = (P.y - uFloorY) / -T.y;
  vec2 dg = vec2(T.x, -T.z);
  float hs = max(length(dg), 1e-4);
  float tt = 0.0;
  bool wall = false;
  for (int i = 0; i < 12; i++) {
    float d = sdfAt(g + dg * tt);
    if (d < 0.003) { wall = true; break; }
    tt += max(d, 0.004) / hs;
    if (tt >= tFloor) break;
  }
  if (tt >= tFloor) { tt = tFloor; wall = false; }
  vec3 Ph = P + T * tt;
  vec2 gh = vec2(Ph.x, -Ph.z);
  float depthH = uWaterY - Ph.y;
  vec3 Nh = vec3(0.0, 1.0, 0.0);
  vec2 tc;
  if (wall) {
    vec2 e = vec2(0.03, 0.0);
    vec2 gr = vec2(sdfAt(gh + e.xy) - sdfAt(gh - e.xy), sdfAt(gh + e.yx) - sdfAt(gh - e.yx));
    vec2 n2 = normalize(gr + vec2(1e-5));
    Nh = vec3(n2.x, 0.0, -n2.y);
    tc = vec2(texture2D(tSDF, sdfUV(gh)).g, Ph.y);
  } else {
    tc = gh;
  }

  // --- tile mosaic (pale aqua glass tiles, light grout), anti-aliased
  float tsz = 0.16;
  vec2 tq = tc / tsz;
  vec2 ti = floor(tq);
  vec2 tf = fract(tq);
  vec2 fwq = max(fwidth(tq), vec2(1e-3));
  vec2 gl = smoothstep(vec2(0.5) - fwq * 0.5 - 0.035, vec2(0.5) - 0.035 + fwq * 0.5, abs(tf - 0.5));
  float grout = max(gl.x, gl.y) * (1.0 - smoothstep(0.25, 0.6, max(fwq.x, fwq.y)));
  float th = vh_hash12(ti + (wall ? 37.0 : 0.0));
  vec3 alb = uTile * (0.9 + 0.16 * th);
  alb = mix(alb, uTile * vec3(0.72, 0.86, 0.95), step(0.93, th));
  alb = mix(alb, vec3(0.78, 0.80, 0.78), grout * 0.8);
  // waterline band: slightly darker deeper blue tiles along the top of the walls
  if (wall) alb *= mix(1.0, 0.72, smoothstep(0.32, 0.12, depthH));

  // --- lighting at the hit point
  float canopy = uCanopy * smoothstep(-14.9, -12.7, gh.y);
  vec3 Esky = uAmbient * (1.0 - canopy) * exp(-uAbsorb * depthH * 1.2) * (wall ? 0.55 : 0.92);
  // refracted sun, shadowed by the pool walls, focused into caustics
  vec3 Ls = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 0.7502);
  float tS = depthH / max(-Ls.y, 0.05);
  vec2 dS = vec2(-Ls.x, Ls.z);
  float lit = 1.0;
  for (int i = 1; i <= 4; i++) {
    float f = float(i) / 4.0;
    lit *= smoothstep(-0.01, 0.03, sdfAt(gh + dS * tS * f));
  }
  float cosI = max(dot(Nh, -Ls), 0.0);
  float caus = texture2D(tCaustic, (gh * vec2(1.0, -1.0)) / uRippleL + vec2(0.021, 0.013) * t).r;
  caus = mix(1.0, caus, 0.9);
  float transS = 1.0 - vw_fresnel(uSunDir.y);
  vec3 Esun = uSunColor * transS * cosI * lit * exp(-uAbsorb * tS) * caus * 2.2;
  // underwater lights (soft warm-white niches in the walls)
  vec3 Elt = vec3(0.0);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    vec4 Lp = uLights[i];
    if (Lp.w <= 0.0) continue;
    vec3 dl = Lp.xyz - Ph;
    float dd = dot(dl, dl);
    float dlen = sqrt(dd);
    float cl = max(dot(Nh, dl / max(dlen, 1e-4)), 0.0);
    Elt += uLightColor * Lp.w * cl * exp(-uAbsorb * dlen) / (dd + 0.35);
    // fixture lens
    glow += uLightColor * 9.0 * (1.0 - smoothstep(0.07, 0.11, dlen)) * Lp.w;
  }
  vec3 Lsurf = alb * (Esky + Esun + Elt) * 0.3183 + glow;
  // view path inside the water: absorption + a faint turquoise in-scatter
  float tv = tt;
  vec3 Tv = exp(-uAbsorb * tv);
  vec3 insc = vec3(0.010, 0.055, 0.060) * (uAmbient.g * 0.6 + 0.4) * (1.0 - Tv.g);
  vec3 under = (Lsurf * Tv + insc) * 0.82;

  // --- sun glint on the ripples (Cox-Munk)
  vec3 Hh = normalize(uSunDir + Vc);
  vec2 zh = -Hh.xz / max(Hh.y, 1e-3);
  vec2 dz = zh - S;
  float pdf = exp(-0.5 * dot(dz, dz) / var) / (6.2831853 * var);
  vec3 glint = uSunColor * 0.12 * vw_fresnel(max(dot(Vc, Hh), 0.0)) * pdf * vw_smithG1(Vc.y, sig) / (4.0 * max(Vc.y, 0.05) * pow(Hh.y, 4.0));
  glint = min(glint, vec3(30.0));

  vec3 col = mix(under, refl, F) + glint;
  col = vh_applyHaze(col, P, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createPoolWaterMaterial({ outline, floorY = 16.75, waterY = 17.962, lights = [] } = {}) {
  const sdf = outline ? poolSDFTexture(outline) : null;
  const { ripple, caustic, L } = poolRippleTextures();
  const lv = [];
  for (let i = 0; i < 12; i++) {
    const l = lights[i];
    lv.push(l ? new THREE.Vector4(l.x, l.y, l.z, l.w ?? 1) : new THREE.Vector4(0, 0, 0, 0));
  }
  const mat = new THREE.ShaderMaterial({
    name: 'PoolWater',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      tRefl: { value: null },
      uHasRefl: { value: 0 },
      uReflMatrix: { value: new THREE.Matrix4() },
      tSDF: { value: sdf },
      uSDFB: { value: sdf ? sdf.userData.bounds : new THREE.Vector4(-1, -1, 1, 1) },
      tRipple: { value: ripple },
      tCaustic: { value: caustic },
      uRippleL: { value: L },
      uFloorY: { value: floorY },
      uWaterY: { value: waterY },
      uSunColor: { value: new THREE.Color(1.0, 0.87, 0.64).multiplyScalar(3.8) },
      uAmbient: { value: new THREE.Vector3(1.45, 1.65, 2.0) },
      uAbsorb: { value: new THREE.Vector3(0.42, 0.075, 0.05) },
      uTile: { value: new THREE.Color(0.42, 0.66, 0.72) },
      uLights: { value: lv },
      uLightColor: { value: new THREE.Color(1.0, 0.9, 0.74).multiplyScalar(0.55) },
      uCanopy: { value: 0.45 },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    fog: false,
  });
  mat.userData.dispose = () => sdf?.dispose();
  return mat;
}

// --- thin overflow film on the infinity edge's outer face ------------------
// premultiplied: reflections add, the wet wall underneath darkens
export function overflowFilmMaterial({ sky = null } = {}) {
  return new THREE.ShaderMaterial({
    name: 'OverflowFilm',
    uniforms: { ...atmosphereUniforms, ...hazeUniforms, tSky: { value: sky }, uHasSky: { value: sky ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 aFlow; // (drop from the lip in m, outward x, outward z)
      varying vec2 vUv; varying vec3 vW; varying vec3 vFlow; varying vec3 vN;
      void main(){ vUv = uv; vFlow = aFlow; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      ${GLSL_HAZE}
      ${GLSL_WATER_COMMON}
      uniform sampler2D tSky; uniform float uHasSky;
      varying vec2 vUv; varying vec3 vW; varying vec3 vFlow; varying vec3 vN;
      vec2 skyUV(vec3 d) { return vec2(atan(d.x, -d.z) * 0.15915494 + 0.5, sqrt(clamp(d.y, 0.0, 1.0))); }
      void main(){
        float drop = vFlow.x;
        vec2 outw = normalize(vFlow.yz + vec2(1e-5));
        // accelerating sheet: streak phase follows the time of flight
        float tf = sqrt(2.0 * max(drop, 0.0) / 9.81) + drop * 0.6;
        float n1 = vh_noise3(vec3(vUv.x * 7.0, tf * 3.0 - uTime * 2.2, 0.5));
        float n2 = vh_noise3(vec3(vUv.x * 23.0, tf * 7.0 - uTime * 4.0, 3.1));
        float streak = n1 * 0.6 + n2 * 0.4;
        // surface normal: outward-facing sheet, rippled by the streaks
        vec3 V = normalize(cameraPosition - vW);
        // the sheet faces outward (away from the wall), toward the viewer
        vec3 N = normalize(vN);
        if (dot(N, vec3(outw.x, 0.0, outw.y)) < 0.0 && drop > 0.03) N = -N;
        if (dot(N, V) < 0.0) N = -N;
        vec3 tang = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-5);
        N = normalize(N + tang * streak * 0.08 + vec3(0.0, 1.0, 0.0) * n2 * 0.03);
        float F = vw_fresnel(max(dot(V, N), 0.0));
        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.004);
        vec3 sky = uHasSky > 0.5 ? textureLod(tSky, skyUV(normalize(R)), 1.5).rgb : vh_sky(normalize(R), false);
        // below the horizon the sheet mirrors the darker sea
        sky = mix(sky, vec3(0.03, 0.07, 0.11), smoothstep(0.02, -0.08, reflect(-V, N).y));
        vec3 rgb = sky * F;
        // the bend over the knife edge catches a fine bright line
        float lip = 1.0 - smoothstep(0.0, 0.02, drop);
        rgb += vec3(0.9, 0.95, 0.97) * lip * 0.35 * (0.6 + 0.4 * F);
        // faint aerated streaks lower down
        float aer = smoothstep(0.25, 0.6, drop) * smoothstep(0.15, 0.6, streak);
        rgb += vec3(0.75, 0.82, 0.84) * aer * 0.12;
        float a = clamp(0.42 + 0.18 * streak, 0.25, 0.7);
        rgb = vh_applyHaze(rgb, vW, cameraPosition) * 1.0;
        gl_FragColor = vec4(rgb, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
  });
}
