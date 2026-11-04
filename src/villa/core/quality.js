// Quality profiles. "still" is the offline approval profile; "high" targets a
// desktop discrete GPU; "balanced" targets integrated GPUs (e.g. Radeon 780M,
// Iris Xe); "low" is the last interactive tier before the 2D fallback.

export const PROFILES = {
  still: {
    name: 'still',
    pixelRatio: 1,
    msaa: 4,
    shadowSize: 8192,
    probes: true,
    probeBounces: 2,
    portals: true,
    ao: true,
    aoScale: 1,
    aoSamples: 24,
    bloom: true,
    reflections: true,
    reflectionScale: 0.6,
    terrainRes: 720,
    vegetation: 1.0,
    farForest: 1.0,
    rocks: 1.0,
    interiorLights: true,
  },
  high: {
    name: 'high',
    probes: true,
    probeBounces: 1,
    portals: true,
    pixelRatio: 1.5,
    msaa: 4,
    shadowSize: 4096,
    ao: true,
    aoScale: 0.75,
    aoSamples: 16,
    bloom: true,
    reflections: true,
    reflectionScale: 0.5,
    terrainRes: 640,
    vegetation: 1.0,
    farForest: 1.0,
    rocks: 1.0,
    interiorLights: true,
  },
  balanced: {
    name: 'balanced',
    probes: true,
    probeBounces: 1,
    pixelRatio: 1,
    msaa: 2,
    shadowSize: 2048,
    ao: true,
    aoScale: 0.5,
    aoSamples: 12,
    bloom: true,
    reflections: true,
    reflectionScale: 0.35,
    terrainRes: 480,
    vegetation: 0.6,
    farForest: 0.6,
    rocks: 0.6,
    interiorLights: true,
  },
  low: {
    name: 'low',
    pixelRatio: 0.85,
    msaa: 0,
    shadowSize: 1024,
    ao: false,
    bloom: false,
    reflections: false,
    terrainRes: 320,
    vegetation: 0.32,
    farForest: 0.35,
    rocks: 0.35,
    interiorLights: false,
  },
};

export function detectWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const info = {
      renderer: String(renderer || ''),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      floatRT: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
      clipControl: !!gl.getExtension('EXT_clip_control'),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch {
    return null;
  }
}

// Pick a profile from the GPU string + device hints. Returns null when the
// device should get the 2D still instead of live WebGL.
export function autoProfile(gpu, { mobile = false, lowMemory = false } = {}) {
  if (!gpu || !gpu.floatRT) return null;
  if (mobile || lowMemory) return null;
  const r = gpu.renderer.toLowerCase();
  // software rasterisers cannot run this scene interactively: use the still
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r)) return null;
  if (/rtx|radeon rx|radeon pro|geforce gtx 1[06-9]|geforce gtx 2|arc(\(tm\))? a[57]|arc(\(tm\))? b|apple m[1-9] (pro|max|ultra)|quadro|rx [5-9][0-9]{3}/.test(r)) return 'high';
  if (/radeon\(tm\) [0-9]{3}m|radeon 7[0-9]0m|radeon 8[0-9]0m|780m|880m|890m|iris\(r\)? ?xe|iris xe|arc\(tm\) graphics|arc graphics|apple m[1-9]|apple gpu/.test(r)) return 'balanced';
  if (/intel|uhd|hd graphics|mali|adreno|powervr/.test(r)) return 'low';
  return 'balanced';
}
