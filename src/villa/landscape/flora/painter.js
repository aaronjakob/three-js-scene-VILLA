// Software rasteriser for procedural foliage atlases.
//
// Leaves, needles, stems and petals are rasterised analytically into two
// RGBA8 buffers that share one layout:
//   col: sRGB albedo + coverage (alpha)
//   dat: tangent-space normal x/y (z is reconstructed), gloss, translucency
// Every leaf carries its own 3D orientation (roll / pitch / fold / curl), so
// the normal map breaks a card into individually lit leaves instead of one
// flat plane. Painter's algorithm with a soft contact-shadow halo under each
// new element gives the in-spray occlusion that photographs show.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// cheap integer hash -> [0, 1)
function hash2i(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Painter {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.col = new Uint8ClampedArray(w * h * 4);
    this.dat = new Uint8ClampedArray(w * h * 4);
    this.clip = [0, 0, w, h];
    // global shading controls for the element being drawn
    this.halo = 0.0; // contact-shadow strength under each new element
    this.haloR = 4; // halo radius (px)
    this.dim = 1.0; // multiplies albedo (inner layers darker)
  }

  setClip(x0, y0, x1, y1) {
    this.clip = [Math.max(0, x0 | 0), Math.max(0, y0 | 0), Math.min(this.w, Math.ceil(x1)), Math.min(this.h, Math.ceil(y1))];
  }

  // composite a fragment over what is there
  put(i, cov, r, g, b, nx, ny, gl, tr) {
    const C = this.col, D = this.dat;
    const k = i << 2;
    const a0 = C[k + 3] * (1 / 255);
    const dim = this.dim;
    r *= dim; g *= dim; b *= dim;
    if (a0 <= 0.002) {
      C[k] = r; C[k + 1] = g; C[k + 2] = b; C[k + 3] = cov * 255 + 0.5;
      D[k] = (nx * 0.5 + 0.5) * 255 + 0.5;
      D[k + 1] = (ny * 0.5 + 0.5) * 255 + 0.5;
      D[k + 2] = gl * 255 + 0.5;
      D[k + 3] = tr * 255 + 0.5;
      return;
    }
    const a = cov + a0 * (1 - cov);
    const wn = cov / a, wo = 1 - wn;
    C[k] = r * wn + C[k] * wo;
    C[k + 1] = g * wn + C[k + 1] * wo;
    C[k + 2] = b * wn + C[k + 2] * wo;
    C[k + 3] = a * 255 + 0.5;
    D[k] = (nx * 0.5 + 0.5) * 255 * wn + D[k] * wo;
    D[k + 1] = (ny * 0.5 + 0.5) * 255 * wn + D[k + 1] * wo;
    D[k + 2] = gl * 255 * wn + D[k + 2] * wo;
    D[k + 3] = tr * 255 * wn + D[k + 3] * wo;
  }

  shade(i, s) {
    const C = this.col;
    const k = i << 2;
    if (C[k + 3] === 0) return;
    const m = 1 - s;
    C[k] *= m; C[k + 1] *= m; C[k + 2] *= m;
  }

  // ------------------------------------------------------------------------
  // Leaf blade. o = {
  //   x, y        petiole base (px)
  //   ang         direction base->tip (radians, raster space, y down)
  //   len, wid    length and max half-width (px)
  //   p, q        outline: hw(t) = wid * sin(pi * t^p)^q
  //   teeth, toothD  serrated margin (count, depth 0..1)
  //   col, col2   base colour and tip/margin colour (sRGB 0..255)
  //   mid         midrib lightening (0..1), veins: lateral vein contrast
  //   gloss, tr   0..1
  //   fold        V-fold along the midrib, conv: convex doming
  //   roll, pitch per-leaf tilt of the blade plane
  //   curl        bend along the length (tip up/down)
  // }
  leaf(o) {
    const { x, y, len } = o;
    const wid = Math.max(0.6, o.wid);
    const ca = Math.cos(o.ang), sa = Math.sin(o.ang);
    const p = o.p ?? 1, q = o.q ?? 0.7;
    const N = 64;
    const lut = new Float32Array(N + 2);
    const teeth = o.teeth ?? 0, toothD = o.toothD ?? 0.12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let w = t <= 0 || t >= 1 ? 0 : Math.pow(Math.sin(Math.PI * Math.pow(t, p)), q);
      if (teeth > 0) w *= 1 - toothD * Math.pow(Math.abs(Math.sin(t * Math.PI * teeth)), 3) * Math.sin(Math.PI * t);
      lut[i] = w * wid;
    }
    lut[N + 1] = 0;
    const col = o.col, col2 = o.col2 ?? col;
    const mid = o.mid ?? 0.15, veins = o.veins ?? 0.06;
    const gl = o.gloss ?? 0.4, tr = o.tr ?? 0.6;
    const fold = o.fold ?? 0.25, conv = o.conv ?? 0.2;
    const roll = o.roll ?? 0, pitch = o.pitch ?? 0, curl = o.curl ?? 0;
    const halo = this.halo, R = this.haloR;
    const pad = (halo > 0 ? R : 0) + 2;
    // bbox
    const px = -sa, py = ca; // across direction
    const xs = [x + px * wid, x - px * wid, x + ca * len + px * wid, x + ca * len - px * wid];
    const ys = [y + py * wid, y - py * wid, y + sa * len + py * wid, y + sa * len - py * wid];
    const [cx0, cy0, cx1, cy1] = this.clip;
    const bx0 = Math.max(cx0, Math.floor(Math.min(...xs) - pad));
    const bx1 = Math.min(cx1 - 1, Math.ceil(Math.max(...xs) + pad));
    const by0 = Math.max(cy0, Math.floor(Math.min(...ys) - pad));
    const by1 = Math.min(cy1 - 1, Math.ceil(Math.max(...ys) + pad));
    if (bx1 < bx0 || by1 < by0) return;
    const W = this.w;
    const veinSp = Math.max(3, len / (o.veinN ?? 9));
    const speck = o.speck ?? 0.05;
    for (let j = by0; j <= by1; j++) {
      const dy = j + 0.5 - y;
      for (let i = bx0; i <= bx1; i++) {
        const dx = i + 0.5 - x;
        const u = dx * ca + dy * sa; // along
        const v = -dx * sa + dy * ca; // across
        const t = u / len;
        if (t < -0.05 || t > 1.05) continue;
        const ft = clamp01(t) * N;
        const i0 = ft | 0;
        const hw = lut[i0] + (lut[i0 + 1] - lut[i0]) * (ft - i0);
        const av = v < 0 ? -v : v;
        // edge distance (approx, in px), negative outside; tips handled by t range
        let d = hw - av;
        if (t < 0) d = Math.min(d, u);
        if (t > 1) d = Math.min(d, len - u);
        const idx = j * W + i;
        if (d < 0.5) {
          if (halo > 0 && d > -R) {
            const k = 1 + d / R;
            this.shade(idx, halo * k * k);
          }
          if (d <= -0.5) continue;
        }
        const cov = d >= 0.5 ? 1 : d + 0.5;
        const s = hw > 0.5 ? v / hw : 0; // -1..1 across
        const as = s < 0 ? -s : s;
        // blade orientation
        let nA = pitch + curl * (t - 0.5); // along
        let nC = roll - fold * (s < 0 ? -1 : 1) * Math.min(1, as * 4) + conv * s; // across
        // midrib
        const midW = Math.max(0.7, wid * 0.07);
        const onMid = av < midW ? 1 - av / midW : 0;
        nC += (s < 0 ? -1 : 1) * onMid * 0.25;
        // lateral veins: forward-slanted lines
        const ph = (u - av * 1.6) / veinSp;
        const vf = ph - Math.floor(ph);
        const vein = vf < 0.12 ? 1 - vf / 0.12 : 0;
        nA += vein * 0.12 * veins * 8;
        // tangent-space normal in raster axes
        const nz = 1;
        let nx = nA * ca - nC * sa;
        let ny = nA * sa + nC * ca;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv;
        // colour
        const tt = clamp01(t);
        const edge = as * as;
        const kTip = clamp01(tt * tt * 0.8 + edge * 0.35);
        let r = col[0] + (col2[0] - col[0]) * kTip;
        let g = col[1] + (col2[1] - col[1]) * kTip;
        let b = col[2] + (col2[2] - col[2]) * kTip;
        const lum = 1 + onMid * mid + vein * veins - edge * 0.08 + (hash2i(i, j) - 0.5) * speck;
        r *= lum; g *= lum; b *= lum;
        this.put(idx, cov, r, g, b, nx, ny, onMid > 0.5 ? gl * 0.6 : gl, onMid > 0.3 ? tr * 0.6 : tr);
      }
    }
  }

  // ------------------------------------------------------------------------
  // Round stroke (twig, needle, stalk) from (x0,y0) to (x1,y1), half-widths
  // w0..w1, cylindrical normal. col / col1 at both ends.
  stroke(x0, y0, x1, y1, w0, w1, col, o = {}) {
    const col1 = o.col1 ?? col;
    const gl = o.gloss ?? 0.25, tr = o.tr ?? 0.0;
    const flat = o.flat ?? 0; // 0 = round, 1 = flat blade
    const twist = o.twist ?? 0; // tilt of a flat blade
    const dx = x1 - x0, dy = y1 - y0;
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-6) return;
    const L = Math.sqrt(L2);
    const tx = dx / L, ty = dy / L;
    const wm = Math.max(w0, w1);
    const halo = this.halo, R = this.haloR * Math.min(1, wm / 2 + 0.3);
    const pad = (halo > 0 ? R : 0) + 2 + wm;
    const [cx0, cy0, cx1, cy1] = this.clip;
    const bx0 = Math.max(cx0, Math.floor(Math.min(x0, x1) - pad));
    const bx1 = Math.min(cx1 - 1, Math.ceil(Math.max(x0, x1) + pad));
    const by0 = Math.max(cy0, Math.floor(Math.min(y0, y1) - pad));
    const by1 = Math.min(cy1 - 1, Math.ceil(Math.max(y0, y1) + pad));
    if (bx1 < bx0 || by1 < by0) return;
    const W = this.w;
    for (let j = by0; j <= by1; j++) {
      const qy = j + 0.5 - y0;
      for (let i = bx0; i <= bx1; i++) {
        const qx = i + 0.5 - x0;
        let t = (qx * dx + qy * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = qx - dx * t, oy = qy - dy * t;
        const dist = Math.sqrt(ox * ox + oy * oy);
        const hw = w0 + (w1 - w0) * t;
        const d = hw - dist;
        const idx = j * W + i;
        if (d < 0.5) {
          if (halo > 0 && d > -R) {
            const k = 1 + d / R;
            this.shade(idx, halo * k * k * 0.7);
          }
          if (d <= -0.5) continue;
        }
        const cov = Math.min(1, d + 0.5) * Math.min(1, hw * 1.6 + 0.2);
        const s = clamp01(dist / Math.max(hw, 0.3)) * (ox * -ty + oy * tx < 0 ? -1 : 1);
        const nC = s * 0.9 * (1 - flat) + twist * flat;
        let nx = -ty * nC, ny = tx * nC;
        const nz = Math.sqrt(Math.max(0.05, 1 - nC * nC));
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= inv; ny *= inv;
        const sh = 0.78 + 0.22 * nz * inv;
        const r = (col[0] + (col1[0] - col[0]) * t) * sh;
        const g = (col[1] + (col1[1] - col[1]) * t) * sh;
        const b = (col[2] + (col1[2] - col[2]) * t) * sh;
        this.put(idx, cov, r, g, b, nx, ny, gl, tr);
      }
    }
  }

  // polyline stroke with tapering width
  polyline(pts, w0, w1, col, o = {}) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let acc = 0;
    const col1 = o.col1 ?? col;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const ta = acc / total, tb = (acc + seg) / total;
      const ca = mixc(col, col1, ta), cb = mixc(col, col1, tb);
      this.stroke(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], w0 + (w1 - w0) * ta, w0 + (w1 - w0) * tb, ca, { ...o, col1: cb });
      acc += seg;
    }
  }

  // soft round blob (berries, flower centres, buds)
  dot(x, y, r, col, o = {}) {
    this.leaf({ x: x - r, y, ang: 0, len: 2 * r, wid: r, p: 1, q: 0.5, col, col2: o.col2 ?? col, mid: 0, veins: 0, gloss: o.gloss ?? 0.3, tr: o.tr ?? 0.3, fold: 0, conv: o.conv ?? 0.8, speck: 0.03 });
  }
}

export function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// jitter an sRGB colour: lightness l (multiplier) and a warm/cool shift w
export function jit(c, rng, l = 0.12, w = 0.06) {
  const k = 1 + (rng() - 0.5) * 2 * l;
  const s = (rng() - 0.5) * 2 * w;
  return [c[0] * k * (1 + s), c[1] * k * (1 + s * 0.3), c[2] * k * (1 - s)];
}
