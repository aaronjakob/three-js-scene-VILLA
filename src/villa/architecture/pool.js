import * as THREE from 'three';
import { LEVEL } from '../core/world.js';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';
import { offset, ellipse, resample, pointInPoly, FIREPIT, FIRE_STAIR_PTS, smooth } from './plan.js';
import { slabGeometry, capGeometry, stripGeometry, sweepRect, merge, box, tubeAlong } from './geo.js';
import { polyProject } from '../landscape/terrain.js';

const WATER_Z = 17.962;
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------------------
// Pool water: ripple normals, planar reflection (if available) or analytic
// sky, Fresnel, turquoise body; alpha lets the lit pool floor show through.
// ---------------------------------------------------------------------------
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
uniform sampler2D tRefl;
uniform float uHasRefl;
varying vec3 vWorld;
varying vec4 vReflCoord;
void main() {
  vec3 P = vWorld;
  vec3 V = normalize(P - cameraPosition);
  vec2 q = P.xz;
  float t = uTime;
  float h1 = vh_noise3(vec3(q * 1.7, t * 0.35));
  float h2 = vh_noise3(vec3(q * 4.3 + 7.0, t * 0.6));
  vec2 sl = vec2(
    vh_noise3(vec3(q * 1.3 + 3.1, t * 0.3)),
    vh_noise3(vec3(q * 1.3 - 5.7, t * 0.3))) * 0.045 +
    vec2(vh_noise3(vec3(q * 3.7, t * 0.55)), vh_noise3(vec3(q * 3.7 + 11.0, t * 0.55))) * 0.02;
  vec3 N = normalize(vec3(sl.x, 1.0, sl.y));
  float cosT = clamp(dot(-V, N), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  vec3 R = reflect(V, N);
  R.y = max(R.y, 0.01);
  vec3 refl = vh_sky(normalize(R), true) * 0.95;
  if (uHasRefl > 0.5) {
    vec2 uv = vReflCoord.xy / vReflCoord.w + sl * 0.35;
    vec4 rc = texture2D(tRefl, uv);
    refl = mix(refl, rc.rgb, rc.a);
  }
  float sun = pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0;
  vec3 body = vec3(0.10, 0.42, 0.44);
  float alpha = mix(0.22, 1.0, F);
  vec3 col = body * (1.0 - F) * 0.35 + refl * F + vec3(1.0, 0.9, 0.7) * sun;
  col = vh_applyHaze(col, P, cameraPosition);
  gl_FragColor = vec4(col / max(alpha, 0.001), alpha);
  gl_FragColor.rgb *= 1.0;
  void(h1); void(h2);
}
`.replace('void(h1); void(h2);', '');

export function createPoolWaterMaterial() {
  return new THREE.ShaderMaterial({
    name: 'PoolWater',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      tRefl: { value: null },
      uHasRefl: { value: 0 },
      uReflMatrix: { value: new THREE.Matrix4() },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

// pool floor / inner walls: pale tile with animated caustics, lit from within
function poolFloorMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.55, 0.80, 0.80),
    roughness: 0.4,
    emissive: new THREE.Color(0.10, 0.42, 0.44),
    emissiveIntensity: 0.55,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = atmosphereUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vPW;
uniform float uTime;
vec2 ch(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float caustic(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = ch(i + g);
    o = 0.5 + 0.45 * sin(uTime * 0.7 + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return smoothstep(0.0, 0.12, d2 - d1);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec2 cp = vPW.xz * 1.15;
  float c = 1.0 - caustic(cp) * caustic(cp * 1.7 + 3.3);
  // tile grid
  vec2 g = abs(fract(vPW.xz / 0.1) - 0.5);
  float grout = smoothstep(0.46, 0.5, max(g.x, g.y));
  diffuseColor.rgb *= 1.0 - grout * 0.12;
  totalEmissiveRadiance += vec3(0.55, 0.85, 0.85) * pow(c, 3.0) * 0.55;
}`);
  };
  m.customProgramCacheKey = () => 'pool-floor';
  return m;
}

// thin water sheet: infinity overflow and waterfall
function sheetMaterial({ speed = 1.4, density = 6.0, opacity = 0.75, tint = [0.82, 0.93, 0.95] } = {}) {
  return new THREE.ShaderMaterial({
    name: 'WaterSheet',
    uniforms: { ...atmosphereUniforms, uSpeed: { value: speed }, uDensity: { value: density }, uOpacity: { value: opacity }, uTint: { value: new THREE.Color(...tint) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      uniform float uSpeed; uniform float uDensity; uniform float uOpacity; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        float t = uTime * uSpeed;
        float s1 = vh_noise3(vec3(vUv.x * uDensity * 6.0, vUv.y * 1.2 + t, 0.3));
        float s2 = vh_noise3(vec3(vUv.x * uDensity * 15.0, vUv.y * 3.0 + t * 1.6, 1.7));
        float streak = smoothstep(-0.25, 0.55, s1 * 0.7 + s2 * 0.5);
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float foamBottom = smoothstep(0.75, 1.0, vUv.y);
        vec3 V = normalize(vW - cameraPosition);
        vec3 sky = vh_sky(reflect(V, vec3(0.0, 0.0, 1.0)) * vec3(1.0, 1.0, 1.0), false);
        vec3 c = mix(uTint * 0.55, uTint * 1.25, streak) + sky * 0.12;
        c += vec3(1.0) * foamBottom * 0.4;
        float a = uOpacity * (0.35 + 0.65 * streak) * edge;
        a = max(a, foamBottom * 0.6 * edge);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// ---------------------------------------------------------------------------
export function buildPool(ctx, root, M, plan) {
  const { field } = ctx;
  const pool = plan.pool;
  const add = (geo, mat, { cast = true, receive = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    if (name) m.name = name;
    root.add(m);
    return m;
  };

  // outward normals per sample (pool is CCW after smooth? enforce)
  const inner = pool;
  const outer = offset(inner, 0.34);
  const n = inner.length;
  const isInfinity = [];
  for (let i = 0; i < n; i++) {
    const a = inner[(i - 1 + n) % n], b = inner[(i + 1) % n];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    // outward normal for CCW = (t.y, -t.x)
    const no = new THREE.Vector2(t.y, -t.x);
    isInfinity.push(no.y < -0.35 && inner[i].x > -9.2 && inner[i].x < 10.0);
  }
  const TIP = V2(-10.15, -12.6);
  const isSpill = inner.map((p) => p.distanceTo(TIP) < 0.75);

  // --- tub: ring wall with per-sample rim height --------------------------
  {
    const zb = 16.35;
    const pos = [];
    const idx = [];
    const uv = [];
    const rimTop = (i) => (isInfinity[i] || isSpill[i] ? WATER_Z - 0.006 : LEVEL.main + 0.025);
    // rings: 0 inner-top, 1 outer-top, 2 outer-bottom, 3 inner-floor
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const pi = inner[k], po = outer[k];
      const zt = rimTop(k);
      pos.push(pi.x, zt, -pi.y, po.x, zt, -po.y, po.x, zb, -po.y, pi.x, 16.75, -pi.y);
      const s = i * 0.25;
      uv.push(s, 0, s, 0.34, s, 1.7, s, 1.2);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 4, b = (i + 1) * 4;
      // top
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      // outer face
      idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      // inner face (handled by tile strip, keep a backing face)
      idx.push(a + 3, b + 3, a, a, b + 3, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    const tub = add(ng, M.slab, { name: 'pool-tub' });
    tub.material = M.slab.clone();
    tub.material.side = THREE.DoubleSide;
    // sculpted soffit under the cantilever
    add(slabGeometry(offset(inner, 0.3), [], 16.4, 0.9, { bevel: 0.4, segments: 7 }), M.slab, { name: 'pool-soffit' });
  }

  // --- interior: tile floor + walls with caustics ------------------------
  const floorMat = poolFloorMaterial();
  add(capGeometry(offset(inner, -0.005), [], 16.752, 1), floorMat, { cast: false, name: 'pool-floor' });
  const wallStrip = stripGeometry(inner, 16.75, WATER_Z, { closed: true });
  const wallMesh = add(wallStrip, floorMat, { cast: false, name: 'pool-walls' });
  wallMesh.material = floorMat.clone();
  wallMesh.material.side = THREE.DoubleSide;
  wallMesh.material.onBeforeCompile = floorMat.onBeforeCompile;
  wallMesh.material.customProgramCacheKey = floorMat.customProgramCacheKey;
  // underwater lights (warm-white niches on the north wall)
  {
    const g = [];
    for (const p of resample(inner.filter((_, i) => !isInfinity[i] && !isSpill[i]), 2.6)) {
      const disc = new THREE.SphereGeometry(0.07, 12, 8);
      disc.scale(1, 1, 0.4);
      disc.translate(p.x, 17.45, -p.y);
      g.push(disc);
    }
    if (g.length) root.add(new THREE.Mesh(merge(g), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.8).multiplyScalar(6) })));
  }

  // --- water surface ------------------------------------------------------
  const waterMat = createPoolWaterMaterial();
  const water = add(capGeometry(inner, [], WATER_Z, 1), waterMat, { cast: false, receive: false, name: 'pool-water' });
  water.renderOrder = 3;

  // --- infinity overflow film on the outer south face ---------------------
  {
    const outS = [];
    for (let i = 0; i < n; i++) if (isInfinity[i]) outS.push(V2(outer[i].x, outer[i].y));
    // order along x
    outS.sort((a, b) => a.x - b.x);
    const film = offsetOpenOut(outS, 0.012);
    const g = stripGeometry(film, 17.25, WATER_Z - 0.004);
    // uv.y should run top->bottom for the shader
    const uvA = g.attributes.uv;
    let L = 0;
    for (let i = 0; i < uvA.count; i++) L = Math.max(L, uvA.getX(i));
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / L, 1 - uvA.getY(i) / (WATER_Z - 17.25));
    const m = add(g, sheetMaterial({ speed: 0.9, density: 20, opacity: 0.55 }), { cast: false, receive: false, name: 'infinity-film' });
    m.renderOrder = 4;
    // catch trough lip
    add(sweepRect(offsetOpenOut(outS, 0.2), 17.1, 0.36, 0.15), M.slab, { name: 'catch-trough' });
  }

  // --- waterfall at the west tip ------------------------------------------
  const dir = new THREE.Vector2(-0.42, -0.91).normalize(); // plan: SSW
  const start = TIP.clone().addScaledVector(dir, 0.36);
  {
    const segs = 40;
    const width0 = 1.8, width1 = 2.7;
    const pos = [], uv = [], idx = [];
    const v0 = 1.2; // m/s horizontal
    const topY = WATER_Z, botY = 8.72;
    const T = Math.sqrt((2 * (topY - botY)) / 9.81);
    const side = new THREE.Vector2(-dir.y, dir.x);
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * T;
      const along = v0 * t;
      const y = topY - 0.5 * 9.81 * t * t;
      const w = THREE.MathUtils.lerp(width0, width1, i / segs);
      const px = start.x + dir.x * along, py = start.y + dir.y * along;
      const wob = Math.sin(i * 0.7) * 0.05;
      for (const sgn of [-1, 1]) {
        const sx = px + side.x * (w / 2) * sgn + dir.x * wob;
        const sy = py + side.y * (w / 2) * sgn + dir.y * wob;
        pos.push(sx, y, -sy);
        uv.push(sgn < 0 ? 0 : 1, i / segs);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const fallMat = sheetMaterial({ speed: 1.6, density: 3.0, opacity: 0.85, tint: [0.85, 0.94, 0.95] });
    const fall = add(g, fallMat, { cast: false, receive: false, name: 'waterfall' });
    fall.renderOrder = 4;
    // second, slightly offset layer for thickness
    const g2 = g.clone();
    g2.translate(dir.x * 0.08, 0, -dir.y * 0.08);
    const fall2 = add(g2, sheetMaterial({ speed: 2.1, density: 4.5, opacity: 0.55, tint: [0.9, 0.97, 0.98] }), { cast: false, receive: false, name: 'waterfall-2' });
    fall2.renderOrder = 4;
    // the notch in the rim where water leaves
    // basin at the foot (z ~ 8.7) with foam ring
    const bx = start.x + dir.x * v0 * T, by = start.y + dir.y * v0 * T;
    const basin = ellipse(bx + dir.x * 0.6, by + dir.y * 0.6, 2.6, 2.0, 48, Math.atan2(dir.y, dir.x));
    const bw = add(capGeometry(basin, [], 8.7, 1), createPoolWaterMaterial(), { cast: false, receive: false, name: 'basin-water' });
    bw.material.uniforms = { ...bw.material.uniforms };
    bw.renderOrder = 3;
    const foam = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2).translate(bx, 8.74, -by),
      sheetMaterial({ speed: 0.5, density: 8, opacity: 0.6, tint: [0.95, 0.98, 1.0] }),
    );
    foam.renderOrder = 5;
    root.add(foam);
    // uplight in the basin (photo reference: lit cascade)
    const up = new THREE.PointLight(new THREE.Color(1.0, 0.82, 0.6), 18, 14, 2);
    up.position.set(bx + dir.x * 1.2, 9.4, -(by + dir.y * 1.2));
    root.add(up);
  }

  // --- firepit terrace (lower, east) --------------------------------------
  const fp = FIREPIT;
  const terrace = ellipse(fp.cx, fp.cy, fp.r, fp.r, 96);
  add(slabGeometry(terrace, [], fp.z, 0.7, { bevel: 0.18 }), M.deckLow, { name: 'firepit-terrace' });
  // stone base merging into the rock
  add(slabGeometry(ellipse(fp.cx, fp.cy, fp.r - 0.2, fp.r - 0.2, 64), [], fp.z - 0.65, 1.4, { bevel: 0.3 }), M.stoneWall, { name: 'firepit-base' });
  // built-in curved sofa around the north-west 220 degrees, open to the sea
  {
    const arc = [];
    const a0 = THREE.MathUtils.degToRad(20), a1 = THREE.MathUtils.degToRad(200);
    for (let i = 0; i <= 64; i++) {
      const a = a0 + (a1 - a0) * (i / 64);
      arc.push(V2(fp.cx + Math.cos(a) * 2.75, fp.cy + Math.sin(a) * 2.75));
    }
    const ring = (r, z, w, h, mat, name) => {
      const pts = arc.map((p) => V2(fp.cx + (p.x - fp.cx) * (r / 2.75), fp.cy + (p.y - fp.cy) * (r / 2.75)));
      return add(roundedSweep(pts, z, w, h), mat, { name });
    };
    ring(2.75, fp.z, 0.95, 0.36, M.travertineWall, 'sofa-plinth');
    ring(2.78, fp.z + 0.36, 0.9, 0.16, M.linen, 'sofa-seat');
    ring(3.18, fp.z + 0.36, 0.26, 0.56, M.linen, 'sofa-back');
    // scatter cushions
    const cush = [];
    for (let i = 0; i < 9; i++) {
      const a = a0 + (a1 - a0) * ((i + 0.5) / 9);
      const g = new THREE.SphereGeometry(0.24, 18, 12);
      g.scale(1.0, 0.85, 0.42);
      g.rotateY(-a + Math.PI / 2);
      g.translate(fp.cx + Math.cos(a) * 3.0, fp.z + 0.78, -(fp.cy + Math.sin(a) * 3.0));
      cush.push(g);
    }
    add(merge(cush), M.boucle, { name: 'cushions' });
    // fire bowl
    const bowl = new THREE.LatheGeometry(
      [V2(0, 0), V2(0.62, 0), V2(0.68, 0.06), V2(0.7, 0.38), V2(0.66, 0.42), V2(0.55, 0.42), V2(0.5, 0.36), V2(0, 0.36)],
      64,
    );
    bowl.translate(fp.cx, fp.z, -fp.cy);
    add(bowl, M.darkStone, { name: 'fire-bowl' });
    // flames: twisted noise cones (procedural shader)
    const flameMat = flameMaterial();
    const fg = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const c = new THREE.ConeGeometry(0.11 + (i % 3) * 0.03, 0.45 + (i % 2) * 0.2, 10, 6, true);
      c.translate(Math.cos(a) * 0.26, fp.z + 0.36 + 0.24, -Math.sin(a) * 0.26);
      c.translate(fp.cx, 0, -fp.cy);
      fg.push(c);
    }
    const flames = new THREE.Mesh(merge(fg), flameMat);
    flames.renderOrder = 6;
    root.add(flames);
    const fireLight = new THREE.PointLight(new THREE.Color(1.0, 0.6, 0.28), 14, 9, 2);
    fireLight.position.set(fp.cx, fp.z + 0.9, -fp.cy);
    root.add(fireLight);
  }

  // --- stair: deck -> firepit terrace --------------------------------------
  const stairWalk = [];
  {
    const path = smooth(FIRE_STAIR_PTS, 60, false);
    let total = 0;
    for (let i = 1; i < path.length; i++) total += path[i].distanceTo(path[i - 1]);
    const steps = 30;
    const rise = (LEVEL.main - fp.z) / steps;
    const geos = [], leds = [], curb = [];
    const pts = resample(path, total / steps);
    for (let i = 0; i < Math.min(steps, pts.length - 1); i++) {
      const a = pts[i], b = pts[i + 1];
      const mid = a.clone().lerp(b, 0.5);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const z = LEVEL.main - (i + 1) * rise;
      geos.push(box(a.distanceTo(b) + 0.06, 1.5, 0.1, mid.x, mid.y, z - 0.1, ang));
      geos.push(box(a.distanceTo(b) * 0.98, 1.4, rise + 0.25, mid.x, mid.y, z - rise - 0.25, ang));
      leds.push(box(0.02, 1.36, 0.012, a.x + Math.cos(ang) * 0.04, a.y + Math.sin(ang) * 0.04, z - 0.115, ang));
      stairWalk.push({ x: mid.x, y: mid.y, z });
    }
    add(merge(geos), M.deckLow, { name: 'fire-stair' });
    root.add(new THREE.Mesh(merge(leds), M.ledSoft));
    // seaward side low wall
    const side = offsetOpenOut(path, -0.82);
    const sideZ = side.map((_, i) => LEVEL.main - (i / (side.length - 1)) * (LEVEL.main - fp.z));
    for (let i = 0; i < side.length - 1; i += 1) {
      const a = side[i], b = side[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      curb.push(box(a.distanceTo(b) + 0.05, 0.22, 0.55, (a.x + b.x) / 2, (a.y + b.y) / 2, (sideZ[i] + sideZ[i + 1]) / 2 - 0.2, ang));
    }
    add(merge(curb), M.travertineWall, { name: 'stair-curb' });
  }

  // colliders: firepit terrace edge (open where the stair arrives and to the sofa)
  const colliders = [];
  {
    const edge = ellipse(fp.cx, fp.cy, fp.r - 0.25, fp.r - 0.25, 64);
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i], b = edge[(i + 1) % edge.length];
      const nearStair = Math.hypot(a.x - 16.9, a.y + 21.4) < 1.4;
      if (!nearStair) colliders.push({ type: 'seg', a: [a.x, a.y], b: [b.x, b.y], minY: 11.5, maxY: 14.5 });
    }
    colliders.push({ type: 'circle', c: [fp.cx, fp.cy], r: 0.75, minY: 11.5, maxY: 14.5 });
  }

  const stairPath = FIRE_STAIR_PTS;
  const walkHeight = (gx, gy, feet) => {
    if (Math.hypot(gx - fp.cx, gy - fp.cy) < fp.r - 0.2 && feet < 15.5) return fp.z;
    const pr = polyProject(stairPath, gx, gy);
    if (pr.d < 0.75) return LEVEL.main - (pr.s / pr.total) * (LEVEL.main - fp.z);
    return null;
  };

  const update = (t) => {
    void t;
  };

  return { water: waterMat, update, colliders, walkHeight, isInside: (x, y) => pointInPoly(x, y, pool) };
}

function flameMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Flame',
    uniforms: { uTime: atmosphereUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vL; varying float vH;
      uniform float uTime;
      void main(){
        vec3 p = position;
        vH = clamp((p.y - 12.65 - 0.36) / 0.7, 0.0, 1.0);
        p.x += sin(uTime * 6.0 + p.y * 9.0) * 0.03 * vH;
        p.z += cos(uTime * 5.0 + p.y * 7.0) * 0.03 * vH;
        vL = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vL; varying float vH;
      uniform float uTime;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        float n = h(floor(vL * 30.0 + vec3(0.0, -uTime * 9.0, 0.0)));
        float core = 1.0 - vH;
        vec3 c = mix(vec3(1.0, 0.42, 0.10), vec3(1.0, 0.86, 0.55), core * core);
        float a = core * (0.55 + 0.45 * n);
        gl_FragColor = vec4(c * (3.0 + 4.0 * core), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// rounded (pillowy) sweep for upholstery along an arc
function roundedSweep(pts, z, w, h) {
  const ring = [];
  const segs = 14;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    // superellipse cross-section -> soft cushion edges
    const c = Math.cos(a), s = Math.sin(a);
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 0.45) * (w / 2);
    const ey = Math.sign(s) * Math.pow(Math.abs(s), 0.45) * (h / 2) + h / 2;
    ring.push([ex, ey]);
  }
  const pos = [], idx = [], uv = [];
  const n = pts.length;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) dist += pts[i].distanceTo(pts[i - 1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const nrm = new THREE.Vector2(-t.y, t.x);
    for (let k = 0; k <= segs; k++) {
      const [ox, oz] = ring[k];
      pos.push(pts[i].x + nrm.x * ox, z + oz, -(pts[i].y + nrm.y * ox));
      uv.push(dist, k / segs);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * (segs + 1) + k, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function offsetOpenOut(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    return new THREE.Vector2(p.x + t.y * d, p.y - t.x * d);
  });
}

export { roundedSweep, tubeAlong };
