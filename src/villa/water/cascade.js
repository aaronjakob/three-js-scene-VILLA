import * as THREE from 'three';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';
import { GLSL_WATER_COMMON } from './common.js';
import { Simplex, mulberry32 } from '../core/noise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// The west cascade: the pool spills over a 2.7 m knife-edge weir, free-falls
// onto a limestone ledge, breaks over a second, lower ledge and plunges into a
// rock-rimmed basin. Layered ribbons (core curtain, back sheet, loose strands)
// go from glassy to white aerated water with the fall distance; foam sheets
// run over the ledge tops; spray and mist rise from every impact; warm
// uplights in the basin light the water from below (refs 01 / 03).

const G = 9.81;
const SKYUV = /* glsl */ `vec2 skyUV(vec3 d) { return vec2(atan(d.x, -d.z) * 0.15915494 + 0.5, sqrt(clamp(d.y, 0.0, 1.0))); }`;

function fallMaterial(sky, up) {
  return new THREE.ShaderMaterial({
    name: 'CascadeWater',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      tSky: { value: sky },
      uHasSky: { value: sky ? 1 : 0 },
      uUpPos: { value: up.pos },
      uUpColor: { value: up.color },
      uAmbient: { value: new THREE.Vector3(1.45, 1.65, 2.0) },
      uSunColor: { value: new THREE.Color(1.0, 0.87, 0.64).multiplyScalar(3.8) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aFlow; // drop from the pool lip (m), layer, seed, width (m)
      varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec4 vFlow;
      void main(){
        vUv = uv; vFlow = aFlow;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      ${GLSL_HAZE}
      ${GLSL_WATER_COMMON}
      ${SKYUV}
      uniform sampler2D tSky; uniform float uHasSky;
      uniform vec3 uUpPos; uniform vec3 uUpColor; uniform vec3 uAmbient; uniform vec3 uSunColor;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec4 vFlow;
      void main(){
        float drop = vFlow.x;
        float layer = vFlow.y;
        float seed = vFlow.z;
        float width = vFlow.w;
        float local = max(vUv.y, 0.0);
        float across = vUv.x;
        // time of flight: streaks are carried down and stretched as the water accelerates
        float tf = sqrt(2.0 * local / 9.81 + 0.004);
        float ax = across * width;
        float n1 = vh_noise3(vec3(ax * 3.2, tf * 2.6 - uTime * 1.7, seed));
        float n2 = vh_noise3(vec3(ax * 9.5, tf * 6.0 - uTime * 3.6, seed + 7.0));
        float n3 = vh_noise3(vec3(ax * 1.1, tf * 1.3 - uTime * 0.9, seed + 13.0));
        float n4 = vh_noise3(vec3(ax * 22.0, tf * 11.0 - uTime * 6.0, seed + 19.0));
        float strands = clamp(0.5 + n1 * 0.85 + n2 * 0.55 + n4 * 0.25, 0.0, 1.0);
        // glassy right after a lip, white aerated water after ~1 m of fall
        float aer = smoothstep(0.15, 1.35, drop + n3 * 0.5);
        float e0 = 0.05 + 0.12 * (0.5 + 0.5 * n3);
        float edge = smoothstep(0.0, e0, across) * smoothstep(1.0, 1.0 - e0, across);
        float alpha;
        if (layer < 0.5) {
          // core curtain: continuous near the lip, torn into strands lower down
          alpha = mix(0.62, 0.95, aer) * mix(1.0, smoothstep(0.18, 0.62, strands), 0.25 + 0.6 * aer);
        } else if (layer < 1.5) {
          // loose strands in front
          alpha = smoothstep(0.42, 0.78, strands) * mix(0.35, 0.95, aer);
        } else if (layer < 2.5) {
          // back sheet: darker, mostly hidden
          alpha = mix(0.5, 0.85, aer) * smoothstep(0.1, 0.5, strands);
        } else {
          // foam sheet running over a ledge top
          alpha = smoothstep(0.08, 0.5, strands) * 0.92;
          aer = 1.0;
        }
        alpha *= edge;
        if (alpha < 0.01) discard;
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = faceforward(vN, -V, vN);
        float F = vw_fresnel(abs(dot(V, N)));
        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.01);
        vec3 skyR = uHasSky > 0.5 ? textureLod(tSky, skyUV(normalize(R)), 2.5).rgb : vh_sky(normalize(R), false);
        // warm uplight from the basin: strongest low down, on the side facing it
        vec3 dl = uUpPos - vW;
        float dd = dot(dl, dl);
        vec3 up = uUpColor / (dd * 0.22 + 1.0);
        float sunK = 0.35 + 0.65 * max(dot(N, uSunDir), 0.0);
        vec3 white = vec3(0.86, 0.92, 0.95) * (uAmbient * 0.3183 * 1.3 + uSunColor * 0.1 * sunK) + vec3(1.0, 0.84, 0.62) * up * 1.4;
        vec3 glassy = skyR * F + vec3(0.025, 0.07, 0.075) * (1.0 - F) + vec3(1.0, 0.85, 0.6) * up * 0.25;
        vec3 col = mix(glassy, white, aer * (0.55 + 0.45 * strands));
        col *= 0.8 + 0.35 * strands;
        if (layer > 1.5 && layer < 2.5) col *= 0.6;
        col = vh_applyHaze(col, vW, cameraPosition);
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

function basinMaterial(sky, impacts, up) {
  return new THREE.ShaderMaterial({
    name: 'PlungeBasin',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      tSky: { value: sky },
      uHasSky: { value: sky ? 1 : 0 },
      uImpact: { value: impacts }, // xz world, radius, strength
      uUpColor: { value: up.color },
      uCenter: { value: up.center },
      uAmbient: { value: new THREE.Vector3(1.45, 1.65, 2.0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      ${GLSL_HAZE}
      ${GLSL_WATER_COMMON}
      ${SKYUV}
      uniform sampler2D tSky; uniform float uHasSky;
      uniform vec4 uImpact; uniform vec3 uUpColor; uniform vec3 uCenter; uniform vec3 uAmbient;
      varying vec3 vW;
      void main(){
        vec2 p = vW.xz;
        vec2 d = p - uImpact.xy;
        float r = length(d);
        float ang = atan(d.y, d.x);
        float t = uTime;
        // turbulent surface: radial rings + noise
        float n = vh_noise3(vec3(p * 2.2, t * 0.8));
        float n2 = vh_noise3(vec3(p * 6.0 + 3.0, t * 1.6));
        float ring = sin(r * 9.0 - t * 5.0 + n * 3.0);
        vec2 S = normalize(d + 1e-4) * ring * 0.05 * exp(-r * 0.6) + vec2(n, n2) * 0.06;
        vec3 N = normalize(vec3(-S.x, 1.0, -S.y));
        vec3 V = normalize(cameraPosition - vW);
        float F = vw_fresnel(max(dot(V, N), 0.0));
        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.01);
        vec3 refl = uHasSky > 0.5 ? textureLod(tSky, skyUV(normalize(R)), 2.0).rgb : vh_sky(normalize(R), false);
        // rock walls around the basin darken the reflection
        refl *= 0.55;
        // lit turquoise body: underwater uplights + sky
        float rc = length(p - uCenter.xz);
        vec3 body = vec3(0.012, 0.075, 0.08) * uAmbient.g + vec3(0.05, 0.42, 0.42) * exp(-rc * rc * 0.18) * 0.55;
        body += vec3(1.0, 0.8, 0.55) * uUpColor * 0.05 * exp(-rc * rc * 0.3);
        // aerated water and foam ring around the plunge point
        float aerate = exp(-r * r / (uImpact.z * uImpact.z * 1.4));
        float lace = vw_lace(p * 1.9 + vec2(t * 0.15, -t * 0.1), n2);
        float streak = 0.5 + 0.5 * sin(ang * 7.0 + n * 4.0 + r * 3.0 - t * 1.2);
        float foamCov = clamp(aerate * 1.25 + exp(-pow((r - uImpact.z * 1.35) / (uImpact.z * 0.55), 2.0)) * 0.75 * (0.5 + 0.5 * streak), 0.0, 1.0);
        foamCov *= uImpact.w;
        float foam = smoothstep(1.0 - foamCov, 1.0 - foamCov + 0.3, lace + foamCov * 0.25) * foamCov;
        body = mix(body, vec3(0.20, 0.42, 0.44) * uAmbient.g * 0.6, aerate * 0.6);
        vec3 col = mix(body, refl, F);
        vec3 foamCol = vec3(0.85, 0.91, 0.93) * (uAmbient * 0.3183) + vec3(1.0, 0.85, 0.62) * uUpColor * 0.035;
        col = mix(col, foamCol, clamp(foam, 0.0, 0.95));
        col = vh_applyHaze(col, vW, cameraPosition);
        gl_FragColor = vec4(col, 1.0);
      }`,
    fog: false,
  });
}

function sprayMaterial(up) {
  return new THREE.ShaderMaterial({
    name: 'CascadeSpray',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      uScale: { value: 400 },
      uUpPos: { value: up.pos },
      uUpColor: { value: up.color },
      uAmbient: { value: new THREE.Vector3(1.45, 1.65, 2.0) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aP; // size (m), rise speed, drift, seed
      uniform float uScale; uniform float uTime;
      varying float vSeed; varying float vFade; varying vec3 vW; varying float vSize;
      void main(){
        vSize = aP.x;
        float ph = fract(aP.w * 7.31 + uTime * aP.y * 0.12);
        vec3 p = position;
        p.y += ph * aP.y * 1.6;
        p.x += sin(aP.w * 12.0 + uTime * 0.3) * aP.z * ph;
        p.z += cos(aP.w * 9.0 + uTime * 0.25) * aP.z * ph;
        vFade = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.55, 1.0, ph));
        vSeed = aP.w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vW = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aP.x * (1.0 + ph * 0.8) * uScale / max(-mv.z, 0.1);
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      ${GLSL_HAZE}
      uniform vec3 uUpPos; uniform vec3 uUpColor; uniform vec3 uAmbient;
      varying float vSeed; varying float vFade; varying vec3 vW; varying float vSize;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0) discard;
        float n = vh_noise3(vec3(c * 1.8, vSeed * 10.0));
        float a = (1.0 - r) * (1.0 - r) * (0.5 + 0.5 * n) * vFade * mix(0.16, 0.07, smoothstep(0.8, 2.0, vSize));
        vec3 dl = uUpPos - vW;
        vec3 col = vec3(0.86, 0.91, 0.94) * uAmbient * 0.3183 + vec3(1.0, 0.85, 0.62) * uUpColor / (dot(dl, dl) * 0.3 + 1.0) * 0.35;
        col = vh_applyHaze(col, vW, cameraPosition);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

// layered limestone block: a subdivided box, rounded, strata in the faces
function rockBlock(w, d, h, seed, { flatTop = true } = {}) {
  let g = new THREE.BoxGeometry(w, h, d, Math.max(4, Math.round(w * 4)), Math.max(4, Math.round(h * 4)), Math.max(4, Math.round(d * 4)));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const s = new Simplex(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // round the box toward a superellipsoid
    const nx = v.x / (w / 2), ny = v.y / (h / 2), nz = v.z / (d / 2);
    const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    const k = 0.18 * (1 - (Math.abs(nx) * Math.abs(ny) + Math.abs(ny) * Math.abs(nz) + Math.abs(nx) * Math.abs(nz)) / 3);
    void m;
    const top = ny > 0.98 && flatTop;
    // strata: horizontal grooves on the side faces
    const strata = 0.07 * Math.sin(v.y * 9.0 + 2.0 * s.noise2(v.x * 0.7, v.z * 0.7)) + 0.05 * s.fbm2(v.y * 3.1, v.x * 0.8 + v.z * 0.8, 2);
    const n = s.fbm3(v.x * 0.9, v.y * 0.9, v.z * 0.9, 3) * 0.22 + s.fbm3(v.x * 3, v.y * 3, v.z * 3, 2) * 0.06;
    const side = Math.max(Math.abs(nx), Math.abs(nz));
    const push = (n + (side > 0.9 ? strata : 0)) * Math.min(w, d, 3) * 0.35;
    const len = Math.hypot(nx, ny * 0.6, nz) || 1;
    v.x += (nx / len) * (push - k * w * 0.25);
    v.z += (nz / len) * (push - k * d * 0.25);
    if (!top) v.y += (ny / len) * (push * 0.5 - k * h * 0.15);
    else v.y += 0.03 * s.noise2(v.x * 2, v.z * 2);
    pos.setXYZ(i, v.x, v.y, v.z);
    ao[i] = push / (Math.min(w, d, 3) * 0.35 + 1e-6);
  }
  g.computeVertexNormals();
  setCavity(g, ao, 0.25);
  return g;
}

// per-vertex cavity tint (the shared rock material uses vertex colours)
function setCavity(g, ao, k) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = Math.min(1, Math.max(0.38, 0.72 + ao[i] * k * 2.0));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function boulder(r, seed, detail = 3) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const s = new Simplex(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.28 * s.fbm3(v.x * 1.3, v.y * 1.3, v.z * 1.3, 3) + 0.06 * s.fbm3(v.x * 4, v.y * 4, v.z * 4, 2);
    v.multiplyScalar(n * r);
    v.y *= 0.62;
    if (v.y > r * 0.35) v.y = r * 0.35 + (v.y - r * 0.35) * 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
    ao[i] = n - 1;
  }
  g.computeVertexNormals();
  setCavity(g, ao, 0.6);
  return g;
}

function wetVariant(mat) {
  if (!mat) return null;
  try {
    const w = mat.clone();
    w.onBeforeCompile = mat.onBeforeCompile;
    const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
    w.customProgramCacheKey = () => key + '|wet';
    if (w.color) w.color.multiplyScalar(0.62);
    if ('roughness' in w) w.roughness = Math.min(w.roughness ?? 1, 0.45);
    w.userData = { ...mat.userData };
    return w;
  } catch {
    return mat;
  }
}

/**
 * @param ctx scene context (field, renderer, quality)
 * @param root group to add to
 * @param o { tip (plan V2 on the pool outline), dir (plan unit outward), lipOffset, topZ, width, sky, M }
 */
export function buildCascade(ctx, root, o) {
  const { field } = ctx;
  const rng = mulberry32(4242);
  const dir = o.dir.clone().normalize();
  const side = new THREE.Vector2(-dir.y, dir.x);
  const tip = o.tip;
  const plan = (s, l) => new THREE.Vector2(tip.x + dir.x * s + side.x * l, tip.y + dir.y * s + side.y * l);
  const W = (s, l, z) => { const p = plan(s, l); return new THREE.Vector3(p.x, z, -p.y); };
  const groundAt = (s, l) => { const p = plan(s, l); return field.height(p.x, p.y); };

  // --- stages (s along dir from the pool outline, z elevation) -------------
  const zLip = o.topZ;
  const sLip = o.lipOffset;
  const L1 = { top: 12.6, front: 1.6, back: -0.5, w: 4.0 };
  const L2 = { top: 10.45, front: 3.15, back: 1.2, w: 5.6 };
  const basinZ = 9.0;
  const stages = [
    { s0: sLip, z0: zLip, v0: 0.95, z1: L1.top + 0.03, w0: o.width, w1: o.width + 0.35, l0: 0 },
    { s0: L1.front, z0: L1.top + 0.02, v0: 1.35, z1: L2.top + 0.03, w0: o.width + 0.5, w1: o.width + 1.0, l0: 0.15 },
    { s0: L2.front, z0: L2.top + 0.02, v0: 1.55, z1: basinZ, w0: o.width + 1.1, w1: o.width + 1.6, l0: 0.05 },
  ];
  let cum = 0;
  for (const st of stages) {
    st.T = Math.sqrt((2 * (st.z0 - st.z1)) / G);
    st.sImpact = st.s0 + st.v0 * st.T;
    st.cum0 = cum;
    cum += st.z0 - st.z1;
  }

  // uplight in the basin, in front of the last fall
  const upPos = W(stages[2].sImpact - 0.9, 0.4, basinZ + 0.35);
  const up = { pos: upPos, color: new THREE.Color(1.0, 0.78, 0.5).multiplyScalar(2.2), center: W(stages[2].sImpact + 0.5, 0.1, basinZ) };
  const fallMat = fallMaterial(o.sky, up);

  // --- ribbons ---------------------------------------------------------------
  const ribbons = [];
  const ribbon = (st, { layer, l, width0, width1, ds = 0, seed, rows = 30, cols = 14, z1 }) => {
    const pos = [], uv = [], flow = [], idx = [];
    const zEnd = z1 ?? st.z1;
    const T = Math.sqrt((2 * (st.z0 - zEnd)) / G);
    const sN = new Simplex(seed);
    for (let i = 0; i <= rows; i++) {
      const f = Math.pow(i / rows, 0.8);
      const tau = f * T;
      const s = st.s0 + st.v0 * tau + ds;
      const z = st.z0 - 0.5 * G * tau * tau;
      const w = THREE.MathUtils.lerp(width0, width1, f) * (1 + 0.12 * sN.noise2(f * 2.5, 0.3));
      const meander = 0.12 * sN.noise2(f * 1.7, 5.1) * f;
      for (let j = 0; j <= cols; j++) {
        const u = j / cols;
        const lat = l + meander + (u - 0.5) * w;
        const bulge = 0.08 * Math.sin(Math.PI * u) * f + 0.04 * sN.noise2(u * 3, f * 3) * f;
        const p = W(s + bulge, lat, z);
        pos.push(p.x, p.y, p.z);
        uv.push(u, st.z0 - z);
        flow.push(st.cum0 + (st.z0 - z), layer, seed % 97, w);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, fallMat);
    m.renderOrder = 5 + layer;
    m.frustumCulled = true;
    m.name = 'cascade-ribbon';
    root.add(m);
    ribbons.push(m);
    return m;
  };
  stages.forEach((st, k) => {
    const wv = 1 + 0.08 * k;
    ribbon(st, { layer: 2, l: st.l0, width0: st.w0 * 0.96, width1: st.w1 * 0.98, ds: -0.07, seed: 11 + k * 7 });
    ribbon(st, { layer: 0, l: st.l0, width0: st.w0, width1: st.w1, seed: 3 + k * 5 });
    // loose strands of varying width, slightly in front
    const n = 3 + k;
    for (let i = 0; i < n; i++) {
      const lw = (0.35 + rng() * 0.6) * wv;
      const ll = st.l0 + (rng() - 0.5) * (st.w0 - lw * 0.6);
      ribbon(st, { layer: 1, l: ll, width0: lw, width1: lw * (1.2 + rng() * 0.6), ds: 0.05 + rng() * 0.09, seed: 31 + k * 13 + i * 3, cols: 6, rows: 24 });
    }
  });
  // foam sheets over the ledge tops (impact -> lip)
  const ledgeSheet = (sA, sB, z, wA, wB, l0, seed) => {
    const pos = [], uv = [], flow = [], idx = [];
    const rows = 8, cols = 12;
    for (let i = 0; i <= rows; i++) {
      const f = i / rows;
      const s = THREE.MathUtils.lerp(sA, sB, f);
      const w = THREE.MathUtils.lerp(wA, wB, f);
      for (let j = 0; j <= cols; j++) {
        const u = j / cols;
        const p = W(s, l0 + (u - 0.5) * w, z + 0.02 * Math.sin(u * 9 + f * 5));
        pos.push(p.x, p.y, p.z);
        uv.push(u, f * 0.6);
        flow.push(5.0, 3, seed, w);
      }
    }
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, fallMat);
    m.renderOrder = 6;
    root.add(m);
  };
  ledgeSheet(stages[0].sImpact - 0.35, L1.front + 0.02, L1.top + 0.035, stages[0].w1 * 0.95, stages[1].w0, stages[1].l0 * 0.5, 41);
  ledgeSheet(stages[1].sImpact - 0.3, L2.front + 0.02, L2.top + 0.035, stages[1].w1 * 0.95, stages[2].w0, stages[2].l0 * 0.6, 43);

  // --- rock ledges and the basin rim ----------------------------------------
  const rockMat = wetVariant(ctx.rockMaterial) ?? o.M.stoneWall;
  const dryMat = ctx.rockMaterial ?? o.M.stoneWall;
  const yaw = Math.atan2(-dir.y, dir.x); // rotate local +x (dir) in three space
  const placeBlock = (geo, s, l, zTop, h, mat) => {
    const p = W(s, l, zTop - h / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'cascade-rock';
    root.add(m);
    return m;
  };
  const ledge = (L, seed) => {
    const depth = L.front - L.back;
    const base = Math.min(groundAt((L.front + L.back) / 2, 0), groundAt(L.front, 0)) - 0.6;
    const h = L.top - base;
    placeBlock(rockBlock(depth, L.w, h, seed), (L.front + L.back) / 2, 0.05, L.top, h, rockMat);
    // flanking blocks so the ledge reads as part of a broken rock face
    for (const sg of [-1, 1]) {
      const w2 = 1.2 + rng() * 0.8;
      const h2 = h * (0.75 + rng() * 0.35);
      const m = placeBlock(rockBlock(depth * (0.8 + rng() * 0.3), w2, h2, seed + (sg > 0 ? 5 : 9), { flatTop: false }), (L.front + L.back) / 2 - 0.35 - 0.3 * rng(), sg * (L.w / 2 + w2 * 0.3), L.top + 0.35 + rng() * 0.7, h2, dryMat);
      m.rotation.y += (rng() - 0.5) * 0.6;
      m.rotation.z = (rng() - 0.5) * 0.12;
    }
  };
  ledge(L1, 71);
  ledge(L2, 83);

  // basin outline (plan) and rim boulders
  const bc = { s: stages[2].sImpact + 0.45, l: 0.15, rs: 1.75, rl: 2.75 };
  const basinPts = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const wob = 1 + 0.07 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 5 + 0.4);
    basinPts.push(plan(bc.s + Math.cos(a) * bc.rs * wob, bc.l + Math.sin(a) * bc.rl * wob));
  }
  {
    const sh = new THREE.Shape(basinPts);
    const g = new THREE.ShapeGeometry(sh, 4);
    g.rotateX(-Math.PI / 2);
    g.translate(0, basinZ, 0);
    const impact = W(stages[2].sImpact, stages[2].l0, basinZ);
    const mat = basinMaterial(o.sky, new THREE.Vector4(impact.x, impact.z, 0.95, 1.0), up);
    const m = new THREE.Mesh(g, mat);
    m.name = 'basin-water';
    m.renderOrder = 2;
    root.add(m);
  }
  // rim: boulders around the open (downhill) sides, sunk into the ground
  {
    const geos = [];
    let k = 0;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.1;
      const s = bc.s + Math.cos(a) * (bc.rs + 0.35);
      const l = bc.l + Math.sin(a) * (bc.rl + 0.35);
      // skip the cliff side where the falls come in
      if (Math.cos(a) < -0.55 && Math.abs(Math.sin(a)) < 0.75) continue;
      const gnd = groundAt(s, l);
      const r = 0.45 + rng() * 0.55;
      const top = Math.max(basinZ + 0.18 + rng() * 0.45, gnd + 0.25);
      const g = boulder(r, 900 + k++);
      const p = W(s, l, top - r * 0.35);
      g.rotateY(rng() * Math.PI * 2);
      g.scale(1, 1 + rng() * 0.3, 1);
      g.translate(p.x, p.y, p.z);
      geos.push(g);
      // a lower skirt stone down to the ground on the low side
      if (gnd < basinZ - 0.4) {
        const g2 = boulder(r * 1.25, 950 + k++);
        const p2 = W(s + Math.cos(a) * 0.45, l + Math.sin(a) * 0.45, (gnd + basinZ) / 2);
        g2.translate(p2.x, p2.y, p2.z);
        geos.push(g2);
      }
    }
    for (const g of geos) {
      const m = new THREE.Mesh(g, dryMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'basin-rim';
      root.add(m);
    }
  }
  // light fixtures glowing at the basin edge (two warm spots aimed at the falls)
  {
    const fx = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.58).multiplyScalar(8) });
    for (const l of [-1.1, 1.3]) {
      const s = stages[2].sImpact - 0.75;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 6), fx);
      m.position.copy(W(s, l, basinZ + 0.04));
      m.scale.set(1, 0.35, 1);
      root.add(m);
    }
  }

  // --- spray (impacts) and mist ---------------------------------------------
  const sprayMat = sprayMaterial(up);
  {
    const pts = [], attr = [];
    const add = (s, l, z, size, rise, drift) => {
      const p = W(s, l, z);
      pts.push(p.x, p.y, p.z);
      attr.push(size, rise, drift, rng());
    };
    stages.forEach((st, k) => {
      const nS = [36, 30, 60][k];
      for (let i = 0; i < nS; i++) {
        const l = st.l0 + (rng() - 0.5) * st.w1 * 1.1;
        add(st.sImpact + (rng() - 0.3) * 0.7, l, st.z1 + rng() * 0.3, 0.25 + rng() * 0.45, 0.6 + rng() * 1.4, 0.4 + rng() * 0.6);
      }
    });
    // broad mist over the basin drifting seaward
    for (let i = 0; i < 36; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
      add(bc.s + Math.cos(a) * bc.rs * r * 1.2, bc.l + Math.sin(a) * bc.rl * r, basinZ + 0.2 + rng() * 1.2, 1.2 + rng() * 1.8, 1.2 + rng() * 2.2, 0.8 + rng() * 1.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('aP', new THREE.Float32BufferAttribute(attr, 4));
    const spray = new THREE.Points(g, sprayMat);
    spray.renderOrder = 9;
    spray.frustumCulled = false;
    spray.name = 'waterfall-mist';
    root.add(spray);
  }

  // --- uplight (real light for the rocks / cliff) ---------------------------
  const light = new THREE.PointLight(new THREE.Color(1.0, 0.8, 0.56), 26, 15, 2);
  light.position.copy(upPos);
  root.add(light);

  const tmp = new THREE.Vector2();
  return {
    stages,
    update(t, camera, renderer) {
      void t;
      if (renderer && camera) {
        renderer.getDrawingBufferSize(tmp);
        sprayMat.uniforms.uScale.value = (tmp.y * camera.projectionMatrix.elements[5]) / 2;
      }
    },
  };
}
