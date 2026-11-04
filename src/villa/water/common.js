// GLSL helpers shared by the sea, pool and cascade shaders (expects GLSL_NOISE
// from core/noise.js to be included first, e.g. through GLSL_SKY).
export const GLSL_WATER_COMMON = /* glsl */ `
// Schlick Fresnel for an air/water interface (F0 = 0.02)
float vw_fresnel(float c) {
  float m = 1.0 - clamp(c, 0.0, 1.0);
  float m2 = m * m;
  return 0.02 + 0.98 * m2 * m2 * m;
}

// Smith masking for a Gaussian (Beckmann) slope distribution, Walter et al.
float vw_smithG1(float cosT, float sigma) {
  float c = clamp(cosT, 1e-4, 1.0);
  float tanT = sqrt(max(1.0 - c * c, 0.0)) / c;
  float a = 1.0 / max(sigma * tanT, 1e-4);
  if (a >= 1.6) return 1.0;
  float lambda = (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a);
  return 1.0 / (1.0 + lambda);
}

vec2 vw_hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// cellular edge distance (F2 - F1)
float vw_cellEdge(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vw_hash22(i + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

// foam lace in [0,1]: thin bright filaments around dark bubbles, two scales
float vw_lace(vec2 p, float seed) {
  vec2 w = vec2(vh_vnoise2(p * 0.7 + seed * 3.0), vh_vnoise2(p * 0.7 - 5.0 + seed)) - 0.5;
  float e1 = vw_cellEdge(p + w * 0.9);
  float e2 = vw_cellEdge(p * 2.7 + w * 1.7 + 11.0);
  float l1 = 1.0 - smoothstep(0.0, 0.32, e1);
  float l2 = 1.0 - smoothstep(0.0, 0.28, e2);
  return clamp(l1 * 0.75 + l2 * 0.45 + 0.15 * vh_vnoise2(p * 4.0), 0.0, 1.0);
}
`;
