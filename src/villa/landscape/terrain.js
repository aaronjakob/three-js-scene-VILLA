import * as THREE from 'three';
import { Simplex, smoothstep, clamp, lerp } from '../core/noise.js';
import { createGeoTerrainMaterial } from './geology/terrainmat.js';
import { FIRE_STAIR_PTS, DRIVE_PTS, COURT } from '../architecture/plan.js';

// stair from the east terrace (z 18) down to the firepit terrace (z 12.65)
const STAIR = (() => {
  const pts = FIRE_STAIR_PTS;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, total: cum[cum.length - 1] };
})();

// distance to an open polyline + param along it
function polyProject(pts, x, y) {
  let best = Infinity, bt = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const ex = bx - ax, ey = by - ay;
    const L = Math.hypot(ex, ey);
    let t = ((x - ax) * ex + (y - ay) * ey) / (L * L);
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + ex * t), y - (ay + ey * t));
    if (d < best) { best = d; bt = acc + t * L; }
    acc += L;
  }
  return { d: best, s: bt, total: acc };
}
export { polyProject, STAIR };

// ---------------------------------------------------------------------------
// Coastline + cliff + inland hills as one deterministic height function h(x, y)
// in GLB plan coordinates (x east, y north, metres; h = elevation above sea).
// The sea lies south.  The east coast bends south-east into a long bay that ends
// at a distant city; the villa sits on a rocky promontory with an 18 m cliff.
// ---------------------------------------------------------------------------

const ISLANDS = [
  // x, y, radius, height
  [380, -720, 55, 17],
  [430, -770, 22, 8],
  [1350, -1650, 120, 34],
  [-420, -1250, 40, 11],
  [140, -260, 9, 3.5],
  [190, -300, 6, 2.2],
  [-160, -200, 7, 2.6],
  [2600, -2300, 160, 45],
];

// keyframes: [metres south of plateau edge, elevation]
const PROFILE_GENERAL = [
  [0, 17.55], [3, 17.0], [6, 15.4], [9, 12.4], [12, 10.0], [16, 7.4],
  [21, 4.6], [27, 2.2], [33, 0.6], [39, -0.8], [48, -3.6], [70, -9],
];
const PROFILE_WEST = [
  [0, 17.55], [0.5, 17.2], [1.0, 13.6], [1.5, 9.7], [2.0, 8.75], [6.5, 8.55],
  [8.0, 7.6], [12, 5.2], [18, 2.8], [25, 0.8], [33, -1.0], [45, -4], [70, -9],
];
const PROFILE_EAST = [
  [0, 17.55], [2, 16.4], [4.2, 13.4], [5.4, 12.45], [9.5, 12.35], [11.5, 10.6],
  [15, 7.8], [20, 4.6], [26, 2.2], [32, 0.4], [40, -1.6], [50, -4.2], [70, -9],
];

function sampleProfile(p, u) {
  if (u <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (u <= p[i][0]) {
      const [u0, h0] = p[i - 1];
      const [u1, h1] = p[i];
      const t = (u - u0) / (u1 - u0);
      const s = t * t * (3 - 2 * t);
      return lerp(h0, h1, lerp(t, s, 0.6));
    }
  }
  return p[p.length - 1][1];
}

export class TerrainField {
  constructor(seed = 7) {
    this.n = new Simplex(seed);
    this.m = new Simplex(seed + 101);
  }

  shoreY(x) {
    const n = this.n;
    const ax = Math.abs(x);
    let s = -47;
    if (x > 0) s -= 0.6 * x * smoothstep(80, 2400, x);
    else s -= 0.2 * ax * smoothstep(150, 3200, ax);
    const near = smoothstep(40, 160, ax);
    s += (52 * n.fbm2(x / 420, 3.7, 4) + 20 * n.fbm2(x / 110, 9.1, 3) + 7 * n.fbm2(x / 28, 2.3, 2)) * (0.15 + 0.85 * near);
    s -= 6 * Math.exp(-(x * x) / (2 * 50 * 50));
    s += 15 * Math.exp(-((x + 92) ** 2) / (2 * 26 * 26));
    s += 13 * Math.exp(-((x - 102) ** 2) / (2 * 30 * 30));
    return s;
  }

  // Plateau (south) edge of the villa site, by x
  siteEdge(x) {
    // west waterfall cliff, main cantilever zone, east terrace
    const west = -11.4;
    const mid = -8.6;
    const east = -11.6;
    let e;
    if (x < -6) e = lerp(mid, west, smoothstep(-4.5, -9.5, x));
    else e = lerp(mid, east, smoothstep(8.5, 12.5, x));
    e = x < -6 ? lerp(e, -7.5, smoothstep(-16, -24, x)) : lerp(e, -8, smoothstep(18, 26, x));
    return e + 0.3 * this.m.fbm2(x / 6, 1.5, 2);
  }

  siteHeight(x, y) {
    const e = this.siteEdge(x);
    const u = e - y; // metres south of the edge
    let h;
    if (u <= 0) {
      // plateau: house pad, then the entry court and hill rising to the north
      h = 17.55;
      if (y > 11.5) h = lerp(17.55, 17.98, smoothstep(11.5, 13.5, y));
      if (y > 29) h += (y - 29) * 0.11 + 0.012 * (y - 29) ** 2;
    } else {
      const wW = 1 - smoothstep(-8.5, -5.0, x);
      const wW2 = smoothstep(-15.5, -12.5, x);
      const wWest = wW * wW2;
      const wEast = smoothstep(9.5, 12.0, x) * (1 - smoothstep(18.5, 22, x));
      let hg = sampleProfile(PROFILE_GENERAL, u);
      const hw = sampleProfile(PROFILE_WEST, u);
      const he = sampleProfile(PROFILE_EAST, u);
      h = lerp(hg, hw, wWest);
      h = lerp(h, he, wEast);
      // rugged limestone face
      const face = smoothstep(0.5, 3, u) * (1 - smoothstep(30, 44, u));
      const n = this.n;
      h += face * (1.5 * n.fbm2(x / 6.5, y / 6.5, 3) + 0.6 * n.fbm2(x / 2.2, y / 2.2, 2));
    }
    // seat the lower firepit terrace (no ground poking through its floor)
    const fd = Math.hypot(x - 13.25, y + 18.65);
    if (fd < 5.6) h = Math.min(h, lerp(11.9, h, smoothstep(4.7, 5.6, fd)));
    // carve below the firepit stair
    const st = polyProject(STAIR.pts, x, y);
    if (st.d < 2.2) {
      const zs = 18 - (st.s / STAIR.total) * (18 - 12.65);
      const k = 1 - smoothstep(1.0, 2.2, st.d);
      h = Math.min(h, lerp(h, zs - 0.35, k));
    }
    return h;
  }

  // Generic coast (away from the villa)
  baseHeight(x, y) {
    const n = this.n;
    const s = this.shoreY(x);
    const d = y - s;
    const top = 16 + 10 * n.fbm2(x / 260, 1.3, 3) + 6 * n.fbm2(x / 70, 5.5, 2);
    const W = 26 + 14 * n.fbm2(x / 140, 4.4, 2);
    let h;
    if (d < 0) {
      h = -0.6 + d * 0.32 + 2.2 * n.fbm2(x / 25, y / 25, 3);
      h = Math.max(h, -45 + 4 * n.fbm2(x / 200, y / 200, 2));
    } else {
      const t = clamp(d / W, 0, 1);
      let prof = Math.pow(Math.sin(t * Math.PI * 0.5), 0.75);
      // ledges / terraces in the limestone
      const steps = 4.0;
      const q = (prof * top) / steps;
      const stepped = (Math.floor(q) + smoothstep(0.3, 0.7, q - Math.floor(q))) * steps;
      let cliff = lerp(prof * top, stepped, 0.45);
      cliff = Math.min(cliff, top);
      const inland = Math.max(0, d - W);
      // first hills behind the coast, then layered ridges
      // valleys run inland (stretched along y), ridges between them
      const valley = 0.5 + 0.5 * n.ridge2(x / 620, y / 1000 + 7.7, 3);
      const hill =
        inland * 0.07 +
        75 * smoothstep(0, 420, inland) * (0.45 + 0.55 * n.fbm2(x / 380, y / 380, 3) * 0.5 + 0.3 * valley) +
        260 * smoothstep(220, 2600, inland) * (0.35 + 0.65 * (0.5 + 0.5 * n.fbm2(x / 1300, y / 1300, 4)) * (0.7 + 0.3 * n.ridge2(x / 900, y / 900, 3))) * (0.7 + 0.3 * valley) +
        380 * smoothstep(1800, 7000, inland) * (0.4 + 0.6 * (0.5 + 0.5 * n.fbm2(x / 2600 + 3, y / 2600, 4)));
      const rough = 3.2 * n.fbm2(x / 60, y / 60, 4) * smoothstep(5, 60, inland);
      h = cliff + hill + rough;
      // rugged cliff face
      const face = smoothstep(0.02, 0.15, t) * (1 - smoothstep(0.7, 1.0, t));
      h += face * (2.4 * n.fbm2(x / 11, y / 11, 3) + 0.9 * n.fbm2(x / 3.3, y / 3.3, 2));
      // surf rocks at the foot
      if (d < 6) h += (1 - d / 6) * 1.2 * Math.max(0, n.fbm2(x / 5, y / 5, 2));
    }
    // islands
    for (const [ix, iy, r, ih] of ISLANDS) {
      const dx = x - ix, dy = y - iy;
      const dd = Math.sqrt(dx * dx + dy * dy) / r;
      if (dd < 1.8) {
        const k = Math.exp(-dd * dd * 2.2) * (0.75 + 0.35 * n.fbm2(x / (r * 0.4), y / (r * 0.4), 3));
        h = Math.max(h, -6 + (ih + 6) * k + 1.5 * n.fbm2(x / 8, y / 8, 2) * k);
      }
    }
    return h;
  }

  // weight of the hand-shaped villa site
  siteWeight(x, y) {
    const dx = Math.max(0, Math.abs(x - 1) - 26);
    const dyN = Math.max(0, y - 60);
    const dyS = Math.max(0, -60 - y);
    const d = Math.sqrt(dx * dx + dyN * dyN + dyS * dyS);
    return 1 - smoothstep(0, 38, d);
  }

  height(x, y) {
    const w = this.siteWeight(x, y);
    const base = w < 1 ? this.baseHeight(x, y) : 0;
    if (w <= 0) return this._drive(x, y, base);
    const site = this.siteHeight(x, y);
    return this._drive(x, y, lerp(base, site, w));
  }

  _drive(x, y, h) {
    if (y > COURT.cy - 2 && y < 140 && x > -20 && x < 100) {
      const dr = polyProject(DRIVE_PTS, x, y);
      if (dr.d < 10) {
        const zd = 17.98 + Math.max(0, dr.s - 7) * 0.1;
        const k = 1 - smoothstep(3.4, 10, dr.d);
        return lerp(h, zd, k);
      }
    }
    return h;
  }

  normal(x, y, eps = 0.5) {
    const hx = this.height(x + eps, y) - this.height(x - eps, y);
    const hy = this.height(x, y + eps) - this.height(x, y - eps);
    // GLB normal (x, y, z-up) -> three (x, z, -y)
    const v = new THREE.Vector3(-hx, 2 * eps, hy);
    return v.normalize();
  }

  // slope as 1 - n.up
  slope(x, y, eps = 0.6) {
    const hx = (this.height(x + eps, y) - this.height(x - eps, y)) / (2 * eps);
    const hy = (this.height(x, y + eps) - this.height(x, y - eps)) / (2 * eps);
    return 1 - 1 / Math.sqrt(1 + hx * hx + hy * hy);
  }
}

// Non-uniform grid: ~1 m spacing at the villa, ~80 m at the 18 km edge.
function warp(u, S, a) {
  return S * u * (a + (1 - a) * u * u);
}

export function buildTerrainGeometry(field, { res = 640, half = 12000, a = 0.03 } = {}) {
  const n = res;
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    const Y = warp((j / (n - 1)) * 2 - 1, half, a);
    for (let i = 0; i < n; i++) {
      const X = warp((i / (n - 1)) * 2 - 1, half, a);
      const h = field.height(X, Y);
      const k = (j * n + i) * 3;
      positions[k] = X;
      positions[k + 1] = h;
      positions[k + 2] = -Y;
      uvs[(j * n + i) * 2] = i / (n - 1);
      uvs[(j * n + i) * 2 + 1] = j / (n - 1);
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a0 = j * n + i;
      const b0 = a0 + 1;
      const c0 = a0 + n;
      const d0 = c0 + 1;
      // winding so that normals face +Y in three space (z = -Y flips handedness)
      idx[p++] = a0; idx[p++] = b0; idx[p++] = c0;
      idx[p++] = b0; idx[p++] = d0; idx[p++] = c0;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // ensure up-facing
  const nrm = geo.attributes.normal;
  let up = 0;
  for (let i = 0; i < nrm.count; i += 997) up += nrm.getY(i);
  if (up < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t;
    }
    geo.index.needsUpdate = true;
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

// Heightmap textures for shoreline foam / shallow water tint in the ocean shader.
export function buildHeightTexture(field, { size = 512, x0, y0, x1, y1, linear = true }) {
  const data = new Float32Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const gy = lerp(y0, y1, j / (size - 1));
    for (let i = 0; i < size; i++) {
      const gx = lerp(x0, x1, i / (size - 1));
      const h = field.height(gx, gy);
      const k = (j * size + i) * 4;
      data[k] = h;
      data[k + 1] = h;
      data[k + 2] = h;
      data[k + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  // float textures are only filterable with OES_texture_float_linear
  tex.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  // world-space mapping: three.x = gx, three.z = -gy
  tex.userData.bounds = new THREE.Vector4(x0, y0, x1, y1);
  return tex;
}

// Terrain material: limestone shared with the cliff mesh and the stones,
// soil / dry grass / litter near the villa, forest colour on the far hills;
// sinks under the high-resolution cliff mesh (see ./geology/terrainmat.js).
export function createTerrainMaterial() {
  return createGeoTerrainMaterial();
}
