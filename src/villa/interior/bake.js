import * as THREE from 'three';
import { mergeList } from './geom.js';

// Baked local lighting for interior furniture.
// Lamp pools, LED shelf washes and picture lights are far too many for real
// three.js lights (every light costs per pixel on every material), so their
// diffuse contribution is integrated per vertex at build time and added in the
// shader as emissive = albedo * E / PI (same units as a point light in cd).
// Real lights are kept for the few sources that must light the architecture.

export function bakeable(material) {
  if (material.userData.bakeable) return material;
  material.userData.bakeable = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (1.0 - metalnessFactor) * vBake;');
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|bake';
  return material;
}

// Virtual light: plan coords (x, y, z), colour (linear rgb), intensity (cd),
// range (m). Optional cone: dir (plan vector) + cos angles; optional wrap for
// soft fabrics; optional "half" plane to stop light leaking through a shelf.
export class BakeLights {
  constructor() { this.list = []; }
  add(x, y, z, color, intensity, range, o = {}) {
    const L = {
      p: new THREE.Vector3(x, z, -y),
      c: color,
      I: intensity,
      range,
      dir: o.dir ? new THREE.Vector3(o.dir[0], o.dir[2], -o.dir[1]).normalize() : null,
      cosIn: o.cosIn ?? 0.9,
      cosOut: o.cosOut ?? 0.5,
      minD: o.minD ?? 0.12,
      box: o.box ?? null, // three-space Box3: only vertices inside receive this light
    };
    this.list.push(L);
    return L;
  }
  // line light (LED strip) approximated by points along it
  addLine(x0, y0, x1, y1, z, color, intensityPerM, range, o = {}) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.ceil(len / (o.spacing ?? 0.25)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      this.add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z, color, (intensityPerM * len) / n, range, o);
    }
  }
}

const _v = new THREE.Vector3();

// Compute the bake attribute for a merged, world-space geometry.
export function bakeGeometry(g, lights, { wrap = 0.0, ambient = null } = {}) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  const active = lights.filter((L) => bb.distanceToPoint(L.p) < L.range);
  if (ambient) for (let i = 0; i < n; i++) { out[i * 3] = ambient[0]; out[i * 3 + 1] = ambient[1]; out[i * 3 + 2] = ambient[2]; }
  if (active.length) {
    const invPi = 1 / Math.PI;
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      let r = 0, gg = 0, b = 0;
      for (const L of active) {
        if (L.box && !L.box.containsPoint(_v.set(px, py, pz))) continue;
        let lx = L.p.x - px, ly = L.p.y - py, lz = L.p.z - pz;
        const d2 = lx * lx + ly * ly + lz * lz;
        const d = Math.sqrt(d2);
        if (d >= L.range) continue;
        lx /= d; ly /= d; lz /= d;
        let ndl = nx * lx + ny * ly + nz * lz;
        ndl = wrap ? (ndl + wrap) / (1 + wrap) : ndl;
        if (ndl <= 0) continue;
        let spot = 1;
        if (L.dir) {
          const cd = -(lx * L.dir.x + ly * L.dir.y + lz * L.dir.z);
          if (cd <= L.cosOut) continue;
          const t = Math.min(1, (cd - L.cosOut) / Math.max(1e-4, L.cosIn - L.cosOut));
          spot = t * t * (3 - 2 * t);
        }
        const win = Math.max(0, 1 - (d / L.range) ** 4) ** 2;
        const e = (L.I * ndl * spot * win * invPi) / Math.max(d2, L.minD * L.minD);
        r += e * L.c[0]; gg += e * L.c[1]; b += e * L.c[2];
      }
      out[i * 3] += r; out[i * 3 + 1] += gg; out[i * 3 + 2] += b;
    }
  }
  g.setAttribute('bake', new THREE.BufferAttribute(out, 3));
  return g;
}

// Geometry collector: per (zone, material) lists, merged on flush so each
// zone can be frustum-culled on its own.
export class Batch {
  constructor() { this.groups = new Map(); }
  push(mat, geo, zone = 'main') {
    if (!geo) return;
    const key = zone + '|' + mat.uuid;
    let e = this.groups.get(key);
    if (!e) { e = { mat, zone, geos: [] }; this.groups.set(key, e); }
    e.geos.push(geo);
  }
  flush(root, lights, { cast = true, receive = true } = {}) {
    const zones = new Map();
    for (const { mat, zone, geos } of this.groups.values()) {
      const color = !!mat.vertexColors;
      const g = mergeList(geos, { color });
      if (!g) continue;
      if (mat.userData.bakeable) bakeGeometry(g, lights.list, { wrap: mat.userData.bakeWrap ?? 0 });
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = mat.userData.noShadow ? false : cast;
      m.receiveShadow = receive;
      m.name = `interior-${zone}-${mat.name}`;
      let zg = zones.get(zone);
      if (!zg) { zg = new THREE.Group(); zg.name = 'interior-' + zone; zones.set(zone, zg); root.add(zg); }
      zg.add(m);
    }
    this.groups.clear();
  }
}
