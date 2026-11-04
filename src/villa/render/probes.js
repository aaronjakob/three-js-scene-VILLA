import * as THREE from 'three';

// Captured light probes ("local IBL"): the finished scene is rendered into cube
// maps at a point outside the house (sea, cliff, terraces, sky) and inside the
// living room (warm walls, ceiling, floor, windows). Prefiltered with PMREM they
// replace the analytic-sky environment, so reflections and ambient light carry
// the real surroundings: green/ochre bounce from the cliff, blue from the sea,
// warm bounce indoors, bright window shapes in polished stone.

export function captureCube(renderer, scene, position, { size = 256, near = 0.12, far = 40000, layers = [0] } = {}) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(near, far, rt);
  cam.position.copy(position);
  for (const c of cam.children) {
    c.layers.set(layers[0]);
    for (const l of layers.slice(1)) c.layers.enable(l);
  }
  cam.updateMatrixWorld(true);
  const prev = renderer.getRenderTarget();
  cam.update(renderer, scene);
  renderer.setRenderTarget(prev);
  return rt;
}

export function prefilter(renderer, cubeRT) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const out = pmrem.fromCubemap(cubeRT.texture);
  pmrem.dispose();
  return out;
}

/**
 * Capture exterior + interior probes and install them.
 * @returns {{ dispose(): void, exteriorCube: THREE.CubeTexture }}
 */
export function bakeProbes({ renderer, scene, reflection, poolWater, uniforms, glass, exterior, interior, bounces = 1, size = 256 }) {
  // planar reflections are only valid for the main camera: switch them off while capturing
  const reflOn = reflection?.uniforms.uReflOn;
  const poolRefl = poolWater?.uniforms?.uHasRefl;
  const prevRefl = reflOn?.value, prevPool = poolRefl?.value;
  if (reflOn) reflOn.value = 0;
  if (poolRefl) poolRefl.value = 0;

  const owned = [];
  // 1) exterior probe, lit by the analytic sky
  const extCube = captureCube(renderer, scene, exterior, { size, layers: [0, 2] });
  const extEnv = prefilter(renderer, extCube);
  owned.push(extCube, extEnv);
  const skyEnv = scene.environment;
  scene.environment = extEnv.texture;
  uniforms.uEnvInterior.value = extEnv.texture;
  uniforms.uHasEnvInterior.value = 0;

  // 2) interior probe (+ optional extra bounce through the room itself)
  let intEnv = null;
  for (let b = 0; b < Math.max(1, bounces); b++) {
    const cube = captureCube(renderer, scene, interior, { size, layers: [0] });
    const env = prefilter(renderer, cube);
    cube.dispose();
    if (intEnv) intEnv.dispose();
    intEnv = env;
    uniforms.uEnvInterior.value = intEnv.texture;
    uniforms.uHasEnvInterior.value = 1;
  }
  owned.push(intEnv);

  if (glass) {
    glass.uniforms.uEnvCube.value = extCube.texture;
    glass.uniforms.uHasEnvCube.value = 1;
  }
  if (reflOn) reflOn.value = prevRefl;
  if (poolRefl) poolRefl.value = prevPool;
  return {
    exteriorCube: extCube.texture,
    skyEnv,
    dispose() { for (const o of owned) o.dispose(); },
  };
}
