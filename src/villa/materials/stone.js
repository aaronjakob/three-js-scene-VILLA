// Natural-stone tiling for travertine floors and decks: every tile samples a
// different region of the slab texture, carries its own slight tone shift
// (real stone is never uniform), and is separated by a fine grout joint with a
// tiny chamfer shadow. Joints are anti-aliased with screen-space derivatives.
export function tileStone(material, { tileW = 1.2, tileH = 0.6, texMeters = 2.4, joint = 0.0022, depth = 0.3, key = 'stone' } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
#ifdef USE_MAP
{
  vec2 m = vMapUv * ${texMeters.toFixed(4)};
  float row = floor(m.y / ${tileH.toFixed(4)});
  float shift = mod(row, 2.0) * ${(tileW / 2).toFixed(4)};
  float col = floor((m.x + shift) / ${tileW.toFixed(4)});
  vec2 tid = vec2(col, row);
  float h1 = fract(sin(dot(tid, vec2(12.9898, 78.233))) * 43758.5453);
  float h2 = fract(sin(dot(tid, vec2(39.3468, 11.135))) * 24634.6345);
  float h3 = fract(sin(dot(tid, vec2(73.156, 52.235))) * 13758.937);
  vec2 off = vec2(h1, h2) * 7.31;
  vec4 sampledDiffuseColor = texture2D(map, vMapUv + off);
  sampledDiffuseColor.rgb *= 0.93 + 0.13 * h3;
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3(1.035, 1.0, 0.94), h2 * 0.8);
  vec2 local = vec2(mod(m.x + shift, ${tileW.toFixed(4)}), mod(m.y, ${tileH.toFixed(4)}));
  float d = min(min(local.x, ${tileW.toFixed(4)} - local.x), min(local.y, ${tileH.toFixed(4)} - local.y));
  float aa = max(fwidth(m.x), fwidth(m.y)) * 0.75 + 1e-5;
  float jointK = 1.0 - smoothstep(${joint.toFixed(4)} - aa, ${joint.toFixed(4)} + aa, d);
  float chamfer = 1.0 - smoothstep(${joint.toFixed(4)}, ${(joint * 4).toFixed(4)} + aa, d);
  sampledDiffuseColor.rgb *= 1.0 - ${depth.toFixed(3)} * jointK - 0.06 * chamfer;
  diffuseColor *= sampledDiffuseColor;
}
#endif`);
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|' + key;
  return material;
}
