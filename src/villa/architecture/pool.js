import * as THREE from 'three';
import { LEVEL } from '../core/world.js';
import { atmosphereUniforms } from '../render/atmosphere.js';
import { offset, ellipse, resample, pointInPoly, FIREPIT, FIRE_STAIR_PTS, smooth, WATERFALL_SPILL } from './plan.js';
import { slabGeometry, capGeometry, sweepRect, merge, box, tubeAlong } from './geo.js';
import { polyProject } from '../landscape/terrain.js';
import { createPoolWaterMaterial as createRayTracedWater, overflowFilmMaterial } from '../water/poolWater.js';
import { buildCascade } from '../water/cascade.js';

const WATER_Z = 17.962;
const FLOOR_Z = 16.75;
const GUTTER_Z = 17.3; // water level in the catch channel below the infinity edge
const V2 = (x, y) => new THREE.Vector2(x, y);

// Pool water material (ray-traced interior; see water/poolWater.js). Keeps the
// planar-reflection contract: uniforms tRefl / uHasRefl / uReflMatrix.
export function createPoolWaterMaterial(opts = {}) {
  return createRayTracedWater(opts);
}

// one strip between two profile rings, smooth along the outline, crisp across
function ringStrip(rings, a, b, n, closed = true) {
  const pos = [], uv = [], idx = [];
  const m = closed ? n + 1 : n;
  let acc = 0;
  for (let i = 0; i < m; i++) {
    const k = i % n;
    if (i > 0) {
      const p = rings[a][k], q = rings[a][(i - 1) % n];
      acc += Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
    const A = rings[a][k], B = rings[b][k];
    const vd = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    pos.push(A[0], A[2], -A[1], B[0], B[2], -B[1]);
    uv.push(acc, 0, acc, vd);
  }
  for (let i = 0; i < m - 1; i++) {
    const p = i * 2;
    idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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

  // outward normals per sample (pool outline is CCW)
  const inner = pool;
  const n = inner.length;
  // spill point: pool sample nearest the waterfall anchor; outward normal there
  const SP = V2(...WATERFALL_SPILL);
  let si = 0;
  for (let i = 0; i < n; i++) if (inner[i].distanceTo(SP) < inner[si].distanceTo(SP)) si = i;
  const TIP = inner[si].clone();
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = inner[(i - 1 + n) % n], b = inner[(i + 1) % n];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    normals.push(new THREE.Vector2(t.y, -t.x)); // outward for CCW
  }
  const isSpill = inner.map((p) => p.distanceTo(TIP) < 1.35);
  const isInfinity = inner.map((p, i) => normals[i].y < -0.3 && !isSpill[i] && Math.abs(p.x) < 13.6);
  // knife-edge weight, eased along the outline so coping and weir meet softly
  const raw = inner.map((_, i) => (isInfinity[i] || isSpill[i] ? 1 : 0));
  const knife = raw.map((_, i) => {
    let s = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const wk = 4 - Math.abs(k); s += raw[(i + k + n) % n] * wk; w += wk; }
    const v = s / w;
    return v * v * (3 - 2 * v);
  });
  const sky = ctx.scene?.getObjectByName?.('ocean')?.material?.uniforms?.tSky?.value ?? null;

  // --- tub: slim crisp coping on the deck side, knife edge on the sea side --
  {
    const L = THREE.MathUtils.lerp;
    const zc = LEVEL.main + 0.012;
    const rings = [[], [], [], [], [], [], []];
    for (let i = 0; i < n; i++) {
      const b = knife[i];
      const p = inner[i], nr = normals[i];
      const at = (o, z) => [p.x + nr.x * o, p.y + nr.y * o, z];
      const wTop = L(0.2, 0.045, b);
      rings[0].push(at(0, L(zc - 0.012, WATER_Z - 0.016, b)));
      rings[1].push(at(L(0.012, 0.004, b), L(zc, WATER_Z - 0.004, b)));
      rings[2].push(at(wTop - L(0.01, 0.012, b), L(zc, WATER_Z - 0.006, b)));
      rings[3].push(at(wTop, L(zc - 0.01, WATER_Z - 0.02, b)));
      rings[4].push(at(wTop, L(17.75, GUTTER_Z, b)));
      rings[5].push(at(wTop, 16.35));
      rings[6].push(at(0, FLOOR_Z));
    }
    const coping = merge([ringStrip(rings, 0, 1, n), ringStrip(rings, 1, 2, n), ringStrip(rings, 2, 3, n)]);
    add(coping, M.deck, { name: 'pool-coping' });
    // outer face: dark wet stone under the overflow film, plain slab elsewhere
    const face = ringStrip(rings, 3, 4, n);
    const idx = face.index.array;
    const wet = [], dry = [];
    for (let q = 0; q < idx.length; q += 6) {
      const i = q / 6;
      (knife[i % n] > 0.5 && knife[(i + 1) % n] > 0.5 ? wet : dry).push(...idx.slice(q, q + 6));
    }
    face.setIndex([...dry, ...wet]);
    face.clearGroups();
    face.addGroup(0, dry.length, 0);
    face.addGroup(dry.length, wet.length, 1);
    const wetStone = new THREE.MeshPhysicalMaterial({
      name: 'overflow-stone',
      color: new THREE.Color(0.075, 0.09, 0.09),
      roughness: 0.32,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.9,
    });
    add(face, [M.slab, wetStone], { name: 'pool-overflow-face' });
    const lower = merge([ringStrip(rings, 4, 5, n), ringStrip(rings, 5, 6, n), ringStrip(rings, 6, 0, n)]);
    add(lower, M.slab, { name: 'pool-tub' });
    // sculpted soffit under the cantilever
    add(slabGeometry(offset(inner, 0.46), [], 16.4, 0.5, { bevel: 0.18, segments: 5 }), M.slab, { name: 'pool-soffit' });
  }

  // --- underwater lights (in the deck-side walls) ---------------------------
  const lights = [];
  {
    const run = [];
    for (let i = 0; i < n; i++) if (!isInfinity[i] && !isSpill[i] && knife[i] < 0.2) run.push(i);
    let last = -1e9, acc = 0;
    for (let j = 0; j < run.length; j++) {
      const i = run[j];
      if (j > 0) acc += inner[i].distanceTo(inner[run[j - 1]]);
      if (acc - last < 3.2) continue;
      last = acc;
      const p = inner[i].clone().addScaledVector(normals[i], -0.03);
      lights.push(new THREE.Vector4(p.x, WATER_Z - 0.42, -p.y, 1.0));
      if (lights.length >= 12) break;
    }
  }

  // --- water surface ------------------------------------------------------
  const waterMat = createPoolWaterMaterial({ outline: inner, floorY: FLOOR_Z, waterY: WATER_Z, lights });
  const water = add(capGeometry(inner, [], WATER_Z, 1), waterMat, { cast: false, receive: false, name: 'pool-water' });
  water.renderOrder = 1;

  // --- infinity overflow: film on the outer face + catch gutter -------------
  {
    const runIdx = [];
    for (let i = 0; i < n; i++) if (isInfinity[i]) runIdx.push(i);
    runIdx.sort((a, b) => inner[a].x - inner[b].x);
    // film profile: rolls over the knife edge, then hugs the face
    const prof = [[-0.004, WATER_Z + 0.0008], [0.018, WATER_Z - 0.0005], [0.036, WATER_Z - 0.007], [0.047, WATER_Z - 0.024], [0.049, WATER_Z - 0.06], [0.049, GUTTER_Z + 0.004]];
    const pos = [], uv = [], flow = [], idx = [];
    let acc = 0;
    runIdx.forEach((i, j) => {
      if (j > 0) acc += inner[i].distanceTo(inner[runIdx[j - 1]]);
      const p = inner[i], nr = normals[i];
      for (const [o, z] of prof) {
        pos.push(p.x + nr.x * o, z, -(p.y + nr.y * o));
        uv.push(acc, WATER_Z - z);
        flow.push(Math.max(0, WATER_Z - z), nr.x, -nr.y);
      }
    });
    const R = prof.length;
    for (let j = 0; j < runIdx.length - 1; j++) {
      for (let k = 0; k < R - 1; k++) {
        const a = j * R + k, b = a + 1, c = a + R, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const film = add(g, overflowFilmMaterial({ sky }), { cast: false, receive: false, name: 'infinity-film' });
    film.renderOrder = 4;
    // catch gutter: dark water channel and a slim outer lip
    const path = runIdx.map((i) => inner[i]);
    const nrm = runIdx.map((i) => normals[i]);
    const off = (o) => path.map((p, k) => V2(p.x + nrm[k].x * o, p.y + nrm[k].y * o));
    const strip = (o0, o1, z) => {
      const A = off(o0), B = off(o1);
      const ps = [], ix = [];
      for (let k = 0; k < A.length; k++) ps.push(A[k].x, z, -A[k].y, B[k].x, z, -B[k].y);
      for (let k = 0; k < A.length - 1; k++) { const q = k * 2; ix.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
      sg.setIndex(ix);
      sg.computeVertexNormals();
      if (sg.attributes.normal.getY(0) < 0) { for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } sg.setIndex(ix); sg.computeVertexNormals(); }
      return sg;
    };
    const gutterWater = new THREE.MeshPhysicalMaterial({ name: 'gutter-water', color: new THREE.Color(0.012, 0.04, 0.05), roughness: 0.06, envMapIntensity: 1.0, clearcoat: 1, clearcoatRoughness: 0.04 });
    add(strip(0.05, 0.43, GUTTER_Z), gutterWater, { cast: false, name: 'gutter-water' });
    const foamLine = new THREE.MeshStandardMaterial({ name: 'gutter-foam', color: new THREE.Color(0.85, 0.9, 0.92), roughness: 0.9 });
    add(strip(0.049, 0.085, GUTTER_Z + 0.003), foamLine, { cast: false, name: 'gutter-foam' });
    add(sweepRect(off(0.45), 16.38, 0.06, GUTTER_Z + 0.1 - 16.38), M.slab, { name: 'gutter-lip' });
  }

  // --- cascade at the west tip ----------------------------------------------
  const cascade = buildCascade(ctx, root, {
    tip: TIP,
    dir: normals[si].clone(),
    lipOffset: 0.045,
    topZ: WATER_Z - 0.01,
    width: 2.7,
    sky,
    M,
  });

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
      geos.push(box(a.distanceTo(b) + 0.04, 1.4, 0.07, mid.x, mid.y, z - 0.07, ang));
      leds.push(box(0.02, 1.36, 0.012, a.x + Math.cos(ang) * 0.04, a.y + Math.sin(ang) * 0.04, z - 0.115, ang));
      stairWalk.push({ x: mid.x, y: mid.y, z });
    }
    add(merge(geos), M.deckLow, { name: 'fire-stair' });
    // central steel stringer following the flight, cut into the rock below
    const strPts = resample(path, 0.4);
    const strZ = strPts.map((_, i) => LEVEL.main - 0.25 - (i / (strPts.length - 1)) * (LEVEL.main - fp.z));
    root.add(Object.assign(new THREE.Mesh(tubeAlong(strPts, strZ, 0.09, { radial: 6, tubular: 120 }), M.metalDark), { castShadow: true }));
    root.add(new THREE.Mesh(merge(leds), M.ledSoft));
    // seaward side low wall
    const side = offsetOpenOut(path, -0.68);
    const sideZ = side.map((_, i) => LEVEL.main - (i / (side.length - 1)) * (LEVEL.main - fp.z));
    for (let i = 0; i < side.length - 1; i += 5) {
      const a = side[i], b = side[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      curb.push(box(0.03, 0.03, 0.95, a.x, a.y, sideZ[i] - 0.1, ang));
    }
    add(merge(curb), M.metalDark, { name: 'stair-posts' });
    root.add(Object.assign(new THREE.Mesh(tubeAlong(side, sideZ.map((z) => z + 0.85), 0.022, { radial: 6, tubular: 120 }), M.metalDark), { castShadow: true }));
  }

  // colliders: firepit terrace edge (open where the stair arrives and to the sofa)
  const colliders = [];
  {
    const edge = ellipse(fp.cx, fp.cy, fp.r - 0.25, fp.r - 0.25, 64);
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i], b = edge[(i + 1) % edge.length];
      const nearStair = Math.hypot(a.x - 17.0, a.y + 20.6) < 1.5;
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

  const update = (t, camera) => {
    cascade.update(t, camera, ctx.renderer);
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
