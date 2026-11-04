// Procedural wave fields for the sea and the pool, generated on the CPU at
// start-up (no downloaded normal maps):
//   - a JONSWAP wind-sea + swell spectrum with Mitsuyasu directional spreading,
//   - Gaussian random amplitudes on an FFT grid (Tessendorf), split into
//     cascades of incommensurate tile sizes so no period is ever visible,
//   - per texel: mean slopes and squared slopes ("LEAN" moments) so that
//     mip-mapping turns waves that are smaller than a pixel into roughness.
// Everything is seeded and deterministic.

import { mulberry32 } from '../core/noise.js';

const G = 9.81;

// --- radix-2 complex FFT (inverse, unnormalised: f(x) = sum F(k) e^{ikx}) ---
function fft1(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const br = re[b] * cr - im[b] * ci;
        const bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi;
        re[a] += br; im[a] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export function ifft2(re, im, n) {
  const tr = new Float64Array(n), ti = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    const o = y * n;
    for (let x = 0; x < n; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; }
    fft1(tr, ti, n);
    for (let x = 0; x < n; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { tr[y] = re[y * n + x]; ti[y] = im[y * n + x]; }
    fft1(tr, ti, n);
    for (let y = 0; y < n; y++) { re[y * n + x] = tr[y]; im[y * n + x] = ti[y]; }
  }
}

// --- spectrum -----------------------------------------------------------------
function gammaFn(z) {
  // Lanczos approximation
  const p = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
function spreadNorm(s) {
  // normalisation of cos^{2s}(theta/2) over [-pi, pi]
  const lg = (v) => Math.log(gammaFn(v));
  return Math.exp((2 * s - 1) * Math.LN2 + 2 * lg(s + 1) - lg(2 * s + 1)) / Math.PI;
}

/**
 * One spectral component: JONSWAP in omega with Mitsuyasu spreading.
 * dir = travel direction (radians, in the field's x/z frame).
 */
function jonswap({ U = 5, fetch = 60000, gamma = 3.3, dir = 0, spread = 1, scale = 1, peakOmega }) {
  const alpha = 0.076 * Math.pow((U * U) / (fetch * G), 0.22);
  const wp = peakOmega ?? 22 * Math.pow((G * G) / (U * fetch), 1 / 3);
  const cache = new Map();
  const norm = (s) => {
    const key = Math.round(s * 20);
    if (!cache.has(key)) cache.set(key, spreadNorm(key / 20));
    return cache.get(key);
  };
  // returns the 2D wavenumber density psi(k, theta) [m^4]
  return (k, theta) => {
    if (k <= 1e-6) return 0;
    const w = Math.sqrt(G * k);
    const sig = w <= wp ? 0.07 : 0.09;
    const r = Math.exp(-((w - wp) ** 2) / (2 * sig * sig * wp * wp));
    const S = ((alpha * G * G) / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * Math.pow(gamma, r);
    // Mitsuyasu spreading exponent
    const sp = 11.5 * Math.pow((wp * U) / G, -2.5);
    let s = w <= wp ? sp * Math.pow(w / wp, 5) : sp * Math.pow(w / wp, -2.5);
    s = Math.max(1, Math.min(40, s * spread));
    let d = theta - dir;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const D = norm(s) * Math.pow(Math.abs(Math.cos(d / 2)), 2 * s);
    // S(w) dw -> S(k) dk with dw/dk = g / (2w); polar density -> /k
    return (scale * S * (G / (2 * w)) * D) / k;
  };
}

// short-wave saturation tail (capillary-gravity) so slopes keep growing below
// the peak like Cox-Munk observations; smooth onset above kOn
function tail({ beta = 0.006, dir = 0, kOn = 0.6, kCut = 600 }) {
  return (k, theta) => {
    if (k < kOn * 0.25 || k > kCut) return 0;
    const on = Math.min(1, Math.max(0, (k - kOn * 0.25) / (kOn * 0.75)));
    let d = theta - dir;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const D = (1 + 0.6 * Math.cos(2 * d) + 0.25 * Math.cos(d)) / (2 * Math.PI);
    return ((on * on * beta) / (k ** 4)) * D;
  };
}

export function seaSpectrum({ U = 4.6, windDir = -1.32, swellDir = -1.38 } = {}) {
  // wind sea (light onshore breeze), a long low swell from the south-south-west
  const wind = jonswap({ U, fetch: 80000, dir: windDir });
  const swell = jonswap({ U: 9, fetch: 400000, gamma: 6, dir: swellDir, spread: 5, scale: 0.035, peakOmega: 0.72 });
  const cap = tail({ beta: 0.0045, dir: windDir, kOn: 1.2 });
  return (k, th) => wind(k, th) + swell(k, th) + cap(k, th);
}

export function poolSpectrum() {
  // tiny fetch-limited ripples (a few metres of fetch, ~1.5 m/s breeze)
  const w = jonswap({ U: 1.6, fetch: 12, gamma: 2, dir: -1.1, spread: 0.6 });
  const cap = tail({ beta: 0.0016, dir: -1.1, kOn: 25, kCut: 900 });
  return (k, th) => w(k, th) + cap(k, th);
}

// slope variance (x, z) of the spectrum between k0 and k1 (numerical)
export function slopeVariance(psi, k0, k1, steps = 400, dirs = 72) {
  let vx = 0, vz = 0;
  const l0 = Math.log(k0), l1 = Math.log(k1);
  for (let i = 0; i < steps; i++) {
    const lk = l0 + ((i + 0.5) / steps) * (l1 - l0);
    const k = Math.exp(lk);
    const dk = k * ((l1 - l0) / steps);
    for (let j = 0; j < dirs; j++) {
      const th = ((j + 0.5) / dirs) * 2 * Math.PI - Math.PI;
      const v = psi(k, th) * k * dk * ((2 * Math.PI) / dirs);
      vx += v * (k * Math.cos(th)) ** 2;
      vz += v * (k * Math.sin(th)) ** 2;
    }
  }
  return [vx, vz];
}

/**
 * Build one periodic field from a spectrum restricted to k0 <= |k| < k1.
 * Returns Float32Arrays sx, sz (slopes), h (height) of n*n samples covering
 * L x L metres. Field axes: index x -> +x, index y -> +z (three.js frame).
 */
export function synthField(psi, { n = 256, L = 100, k0 = 0, k1 = Infinity, seed = 1, rotate = 0, wantHeight = false }) {
  const rng = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(1e-12, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const dk = (2 * Math.PI) / L;
  const N2 = n * n;
  // h0(k) amplitudes (complex) with E|h0|^2 = psi dk^2 / 2
  const h0r = new Float64Array(N2), h0i = new Float64Array(N2);
  for (let y = 0; y < n; y++) {
    const my = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const mx = x < n / 2 ? x : x - n;
      const kx = mx * dk, kz = my * dk;
      const k = Math.hypot(kx, kz);
      const i = y * n + x;
      const a = gauss(), b = gauss();
      if (k < k0 || k >= k1 || k === 0) continue;
      const th = Math.atan2(kz, kx) - rotate;
      const amp = Math.sqrt(Math.max(0, psi(k, th)) * dk * dk * 0.25);
      h0r[i] = a * amp;
      h0i[i] = b * amp;
    }
  }
  // h(k) = h0(k) + conj(h0(-k))  (t = 0)
  const hr = new Float64Array(N2), hi = new Float64Array(N2);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const j = ((n - y) % n) * n + ((n - x) % n);
      hr[i] = h0r[i] + h0r[j];
      hi[i] = h0i[i] - h0i[j];
    }
  }
  // slopes: s~x = i kx h~, s~z = i kz h~ ; pack F = sx~ + i sz~
  const fr = new Float64Array(N2), fi = new Float64Array(N2);
  for (let y = 0; y < n; y++) {
    const my = y < n / 2 ? y : y - n;
    for (let x = 0; x < n; x++) {
      const mx = x < n / 2 ? x : x - n;
      const kx = mx * dk, kz = my * dk;
      const i = y * n + x;
      // i*kx*(hr + i hi) = -kx hi + i kx hr
      const sxr = -kx * hi[i], sxi = kx * hr[i];
      const szr = -kz * hi[i], szi = kz * hr[i];
      // F = sx~ + i sz~
      fr[i] = sxr - szi;
      fi[i] = sxi + szr;
    }
  }
  ifft2(fr, fi, n);
  const sx = new Float32Array(N2), sz = new Float32Array(N2);
  for (let i = 0; i < N2; i++) { sx[i] = fr[i]; sz[i] = fi[i]; }
  let h = null;
  if (wantHeight) {
    const ar = Float64Array.from(hr), ai = Float64Array.from(hi);
    ifft2(ar, ai, n);
    h = new Float32Array(N2);
    for (let i = 0; i < N2; i++) h[i] = ar[i];
  }
  return { sx, sz, h, n, L };
}

/**
 * Sea cascades. Returns { layers: [{sx, sz}], sizes, rotations, tailVar, n }.
 * Each cascade holds one band of wavenumbers; the band edges are chosen so the
 * coarser cascade never holds waves its texel grid cannot resolve.
 */
export const SEA_CASCADES = [
  { L: 733.0, rot: 0.0, k1: 2 * Math.PI / 21.0 },
  { L: 131.0, rot: 0.71, k1: 2 * Math.PI / 3.9 },
  { L: 23.7, rot: -0.93, k1: 2 * Math.PI / 0.37 },
];

export function seaCascades({ n = 256, seed = 3, spectrum } = {}) {
  const psi = spectrum ?? seaSpectrum();
  const out = [];
  let k0 = 0;
  for (let c = 0; c < SEA_CASCADES.length; c++) {
    const { L, rot, k1 } = SEA_CASCADES[c];
    // the field is generated in a frame rotated by `rot`; the shader rotates
    // sample coordinates by the same angle, so wave directions stay global
    const f = synthField(psi, { n, L, k0, k1, seed: seed * 7919 + c * 104729, rotate: rot, wantHeight: true });
    out.push({ ...f, rot, k0, k1 });
    k0 = k1;
  }
  const tailVar = slopeVariance(psi, k0, 2 * Math.PI / 0.008);
  const totalVar = slopeVariance(psi, 2 * Math.PI / 3000, 2 * Math.PI / 0.008);
  return { layers: out, tailVar, totalVar };
}

/**
 * Caustic intensity pattern on a floor `depth` metres below a rippled surface
 * (tileable, mean 1). Light arrives along `dir` (unit, pointing down, x/z/y).
 */
export function causticPattern(sx, sz, n, L, { depth = 1.3, dirX = 0, dirZ = 0, out = 256, eta = 1 / 1.333 } = {}) {
  const acc = new Float32Array(out * out);
  const cell = L / n;
  // incident direction (pointing down): (dirX, -cy, dirZ)
  const iy = -Math.sqrt(Math.max(0, 1 - dirX * dirX - dirZ * dirZ));
  const ss = 2; // sub-samples per texel
  for (let y = 0; y < n * ss; y++) {
    for (let x = 0; x < n * ss; x++) {
      const fx = x / ss, fy = y / ss;
      const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const lerp2 = (a) => (a[y0 * n + x0] * (1 - tx) + a[y0 * n + x1] * tx) * (1 - ty) + (a[y1 * n + x0] * (1 - tx) + a[y1 * n + x1] * tx) * ty;
      const gx = lerp2(sx), gz = lerp2(sz);
      // surface normal (up)
      let nx = -gx, ny = 1, nz = -gz;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      // refract incident (dirX, iy, dirZ) through n (eta = n1/n2)
      const cosi = -(dirX * nx + iy * ny + dirZ * nz);
      const k = 1 - eta * eta * (1 - cosi * cosi);
      if (k < 0) continue;
      const a = eta * cosi - Math.sqrt(k);
      const rx = eta * dirX + a * nx, ry = eta * iy + a * ny, rz = eta * dirZ + a * nz;
      const t = depth / -ry;
      const px = (fx * cell + rx * t) / L, pz = (fy * cell + rz * t) / L;
      // bilinear splat
      const ux = (((px % 1) + 1) % 1) * out, uz = (((pz % 1) + 1) % 1) * out;
      const ax = Math.floor(ux), az = Math.floor(uz);
      const wx = ux - ax, wz = uz - az;
      const bx = (ax + 1) % out, bz = (az + 1) % out;
      acc[az * out + ax] += (1 - wx) * (1 - wz);
      acc[az * out + bx] += wx * (1 - wz);
      acc[bz * out + ax] += (1 - wx) * wz;
      acc[bz * out + bx] += wx * wz;
    }
  }
  // light blur (3x3) then normalise to mean 1
  const res = new Float32Array(out * out);
  let mean = 0;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          s += w * acc[((y + dy + out) % out) * out + ((x + dx + out) % out)];
        }
      }
      res[y * out + x] = s / 16;
      mean += s / 16;
    }
  }
  mean /= out * out;
  for (let i = 0; i < res.length; i++) res[i] /= mean || 1;
  return res;
}
