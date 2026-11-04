import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

// Marching cubes over a scalar field F (F > 0 inside rock, F < 0 in air),
// sampled on a regular grid. Vertices are shared along grid edges (indexed
// output), so normals and per-vertex attributes interpolate smoothly.
// Corner / edge numbering follows Bourke (the tables three.js ships).

const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
// [lower corner, upper corner] per edge; the lower corner is the edge origin
const EDGE = [
  [0, 1], [1, 2], [3, 2], [0, 3],
  [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const EDGE_AXIS = [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];

/**
 * Polygonise a field stored as one vertical band of samples per column.
 * Below a column's band the field is solid (+V), above it air (-V).
 * @param {object} g { nx, ny, nz, start:Int32Array, len:Int32Array, off:Int32Array, vals:Float32Array, V }
 * @returns {{ pos: Float32Array, index: Uint32Array }} positions in grid units (i, j, k)
 */
export function polygonizeBands(g) {
  const { nx, ny, nz, start, len, off, vals, V } = g;
  const value = (i, j, k) => {
    const c = j * nx + i;
    const s = start[c];
    if (k < s) return V;
    const r = k - s;
    if (r >= len[c]) return -V;
    return vals[off[c] + r];
  };
  return polygonize(nx, ny, nz, value, (i, j) => {
    const c0 = j * nx + i, c1 = c0 + 1, c2 = c0 + nx, c3 = c2 + 1;
    const k0 = Math.min(start[c0], start[c1], start[c2], start[c3]) - 1;
    const k1 = Math.max(start[c0] + len[c0], start[c1] + len[c1], start[c2] + len[c2], start[c3] + len[c3]);
    return [Math.max(0, k0), Math.min(nz - 1, k1)];
  });
}

/** Dense grid: vals[(k * ny + j) * nx + i] */
export function polygonizeDense(vals, nx, ny, nz) {
  const value = (i, j, k) => vals[(k * ny + j) * nx + i];
  return polygonize(nx, ny, nz, value, () => [0, nz - 1]);
}

function polygonize(nx, ny, nz, value, kRange) {
  let pos = new Float32Array(3 * 65536);
  let nv = 0;
  let index = new Uint32Array(3 * 131072);
  let ni = 0;
  const cache = new Map();
  const v = new Float64Array(8);
  const ev = new Int32Array(12);
  const pushV = (x, y, z) => {
    if (nv * 3 + 3 > pos.length) { const p = new Float32Array(pos.length * 2); p.set(pos); pos = p; }
    pos[nv * 3] = x; pos[nv * 3 + 1] = y; pos[nv * 3 + 2] = z;
    return nv++;
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const [k0, k1] = kRange(i, j);
      for (let k = k0; k < k1; k++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNER[c];
          const f = value(i + o[0], j + o[1], k + o[2]);
          v[c] = f;
          if (f < 0) cube |= 1 << c;
        }
        const bits = edgeTable[cube];
        if (bits === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const [ca, cb] = EDGE[e];
          const o = CORNER[ca];
          const gi = i + o[0], gj = j + o[1], gk = k + o[2];
          const axis = EDGE_AXIS[e];
          const key = ((gk * ny + gj) * nx + gi) * 3 + axis;
          let id = cache.get(key);
          if (id === undefined) {
            const va = v[ca], vb = v[cb];
            let t = va / (va - vb);
            t = t < 0.0005 ? 0.0005 : t > 0.9995 ? 0.9995 : t;
            id = pushV(gi + (axis === 0 ? t : 0), gj + (axis === 1 ? t : 0), gk + (axis === 2 ? t : 0));
            cache.set(key, id);
          }
          ev[e] = id;
        }
        const b = cube << 4;
        for (let t = 0; triTable[b + t] !== -1; t += 3) {
          if (ni + 3 > index.length) { const x = new Uint32Array(index.length * 2); x.set(index); index = x; }
          index[ni++] = ev[triTable[b + t]];
          index[ni++] = ev[triTable[b + t + 1]];
          index[ni++] = ev[triTable[b + t + 2]];
        }
      }
    }
  }
  return { pos: pos.slice(0, nv * 3), index: index.slice(0, ni) };
}
