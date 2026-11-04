import * as THREE from 'three';

// Shore field for the sea shader, derived on the CPU from a terrain height
// texture (see buildHeightTexture in landscape/terrain.js):
//   R: signed distance to the coastline in metres (+ water, - land), smooth
//      at sub-texel precision near the waterline
//   G: water depth (m), lightly blurred
//   B: exposure of the shore to the open-sea swell (0 sheltered .. 1 open)
//   A: distance to the coastline measured only toward the open sea side
//      (used to fade surf bands in narrow channels)

function dt1(f, n, out, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k] && k > 0) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    if (s <= z[k]) {
      v[0] = q;
      z[0] = -1e30;
      z[1] = 1e30;
      k = 0;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// squared euclidean distance (in metres^2) to the nearest seed texel
function edt(seed, W, H, sx, sy) {
  const INF = 1e20;
  const d = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = seed[i] ? 0 : INF;
  const n = Math.max(W, H);
  const f = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  // rows (x)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = d[y * W + x] / (sx * sx);
    dt1(f, W, out, v, z);
    for (let x = 0; x < W; x++) d[y * W + x] = out[x] * sx * sx;
  }
  // columns (y)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = d[y * W + x] / (sy * sy);
    dt1(f, H, out, v, z);
    for (let y = 0; y < H; y++) d[y * W + x] = out[y] * sy * sy;
  }
  return d;
}

export function buildShoreField(heightTex, { swellFrom = [-0.2, -1] } = {}) {
  const W = heightTex.image.width, H = heightTex.image.height;
  const src = heightTex.image.data; // RGBA float, R = height (m)
  const b = heightTex.userData.bounds; // (x0, y0, x1, y1) plan metres
  const sx = (b.z - b.x) / (W - 1), sy = (b.w - b.y) / (H - 1);
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = src[i * 4];
  const land = new Uint8Array(W * H), water = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    land[i] = h[i] > 0 ? 1 : 0;
    water[i] = 1 - land[i];
  }
  const dLand = edt(land, W, H, sx, sy);
  const dWater = edt(water, W, H, sx, sy);
  const half = 0.5 * Math.min(sx, sy);
  const sdf = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let s = land[i] ? -(Math.sqrt(dWater[i]) - half) : Math.sqrt(dLand[i]) - half;
      // sub-texel refinement from the height gradient near the waterline
      if (Math.abs(s) < 2.5 * Math.max(sx, sy) && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        const gx = (h[i + 1] - h[i - 1]) / (2 * sx);
        const gy = (h[i + W] - h[i - W]) / (2 * sy);
        const g = Math.hypot(gx, gy);
        if (g > 0.04) {
          const e = -h[i] / g;
          const lim = 2.5 * Math.max(sx, sy);
          s = Math.max(-lim, Math.min(lim, e));
        }
      }
      sdf[i] = s;
    }
  }
  // blurred depth (separable box, radius ~3 texels)
  const depth = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) depth[i] = Math.max(0, -h[i]);
  const tmp = new Float32Array(W * H);
  const R = 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) {
        const xx = Math.min(W - 1, Math.max(0, x + k));
        s += depth[y * W + xx]; c++;
      }
      tmp[y * W + x] = s / c;
    }
  }
  const depthB = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let k = -R; k <= R; k++) {
        const yy = Math.min(H - 1, Math.max(0, y + k));
        s += tmp[yy * W + x]; c++;
      }
      depthB[y * W + x] = s / c;
    }
  }
  // exposure: march toward the incoming swell (seaward) and see how much open
  // water there is; also record that seaward distance to land
  const sw = Math.hypot(swellFrom[0], swellFrom[1]);
  const dirs = [-0.55, -0.25, 0, 0.25, 0.55].map((a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const ux = swellFrom[0] / sw, uy = swellFrom[1] / sw;
    return [ux * c - uy * s, ux * s + uy * c];
  });
  const exposure = new Float32Array(W * H);
  const reach = 160; // metres
  const step = Math.max(sx, sy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (sdf[i] > 90 || sdf[i] < -12) { exposure[i] = sdf[i] > 0 ? 1 : 0; continue; }
      let open = 0;
      for (const [dx, dy] of dirs) {
        let free = reach;
        for (let t = step * 1.5 + Math.max(0, sdf[i]) * 0; t < reach; t += step) {
          const px = x + (dx * t) / sx, py = y + (dy * t) / sy;
          const ix = Math.round(px), iy = Math.round(py);
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) break;
          if (h[iy * W + ix] > 0.4 && t > 2 * step) { free = t; break; }
        }
        open += free / reach;
      }
      exposure[i] = open / dirs.length;
    }
  }
  const data = new Uint16Array(W * H * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = toH(Math.max(-500, Math.min(2000, sdf[i])));
    data[i * 4 + 1] = toH(Math.min(200, depthB[i]));
    data[i * 4 + 2] = toH(exposure[i]);
    data[i * 4 + 3] = toH(0);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.userData.bounds = b.clone();
  return tex;
}
