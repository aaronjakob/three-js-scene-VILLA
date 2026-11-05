// Interior lab: villa shell + interior only (no terrain mesh, ocean, vegetation)
// for fast look-dev renders. Dev only; not imported by the product.
import * as THREE from 'three';
import { PROFILES } from '../../core/quality.js';
import { VIEW_BY_ID } from '../../core/anchors.js';
import { toThree, sunDirection } from '../../core/world.js';
import { createSkyDome, buildEnvironment, installHaze, attachHazeToScene } from '../../render/atmosphere.js';
import { Pipeline } from '../../render/pipeline.js';
import { TerrainField } from '../../landscape/terrain.js';
import { buildVilla } from '../../architecture/building.js';
import { buildInterior } from '../furniture.js';
import { ReflectionPlane } from '../../render/reflection.js';

const params = new URLSearchParams(location.search);
window.addEventListener('error', (e) => { window.__labError = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__labError = String(e.reason?.stack || e.reason); });

const W = Number(params.get('w') ?? 640), H = Number(params.get('h') ?? 360);
const q = { ...PROFILES.still };
if (params.get('ao') === '0') q.ao = false;
if (params.get('refl') === '0') q.reflections = false;
if (params.get('msaa')) q.msaa = Number(params.get('msaa'));
if (params.get('lights') === '0') q.interiorLights = false;

installHaze();
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1, 2);
const camera = new THREE.PerspectiveCamera(45, W / H, 0.12, 70000);
camera.layers.enable(2);
scene.environment = buildEnvironment(renderer);
const sky = createSkyDome();
sky.material.depthTest = false;
scene.add(sky);
const sunDir = sunDirection(new THREE.Vector3());
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.60), 3.8);
sun.position.copy(sunDir).multiplyScalar(1400).add(new THREE.Vector3(0, 16, 6));
sun.target.position.set(0, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -62; sc.right = 62; sc.top = 46; sc.bottom = -46;
sc.near = 900; sc.far = 4200;
sun.shadow.bias = 0;
sun.shadow.normalBias = 0.12;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.66, 0.68, 0.72), new THREE.Color(0.26, 0.21, 0.14), 0.5));
// stand-in ground so the glass does not look onto the void
{
  const g = new THREE.PlaneGeometry(4000, 4000);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.24, 0.16), roughness: 1 }));
  m.position.y = 12;
  scene.add(m);
}

const field = new TerrainField(7);
const ctx = { THREE, scene, renderer, field, quality: q, camera, sunDir };
const t0 = performance.now();
const villa = buildVilla(ctx);
ctx.villa = villa;
const t1 = performance.now();
let interior = null;
if (params.get('nointerior') !== '1') interior = buildInterior(ctx);
const t2 = performance.now();
attachHazeToScene(scene);

let reflection = null;
if (q.reflections) {
  reflection = new ReflectionPlane(renderer, scene, { height: 18.0, scale: q.reflectionScale });
  reflection.attach(villa.reflectiveMaterials);
  reflection.setSize(W, H);
}
const pipeline = new Pipeline(renderer, scene, camera, q);
pipeline.setSize(W, H);

let ev = 0;
if (params.get('cam')) {
  const c = params.get('cam').split(',').map(Number);
  camera.position.copy(toThree(c.slice(0, 3)));
  camera.lookAt(toThree(c.slice(3, 6)));
  camera.fov = c[6] ?? 50;
} else {
  const v = VIEW_BY_ID[params.get('view') ?? 'lounge'];
  camera.position.copy(toThree(v.position));
  camera.lookAt(toThree(v.target));
  camera.fov = v.fov;
  ev = v.ev ?? 0;
}
if (params.get('ev')) ev = Number(params.get('ev'));
camera.aspect = W / H;
camera.updateProjectionMatrix();
camera.updateMatrixWorld();
villa.update?.(0, camera);
pipeline.evOffset = ev;

const t3 = performance.now();
renderer.compile(scene, camera);
const t4 = performance.now();
if (reflection) reflection.update(camera);
pipeline.render(null);
const t5 = performance.now();

const countTris = (root) => {
  let n = 0;
  root?.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
};
let texBytes = 0;
const seen = new Set();
interior?.root?.traverse((o) => {
  if (!o.material) return;
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    for (const k in m) {
      const t = m[k];
      if (t?.isTexture && !seen.has(t.source)) {
        seen.add(t.source);
        const img = t.image;
        if (img?.width) texBytes += img.width * img.height * 4 * (t.generateMipmaps !== false ? 1.333 : 1);
      }
    }
  }
});
let lights = 0;
scene.traverse((o) => { if (o.isLight) lights++; });
window.__labStats = {
  villaMs: Math.round(t1 - t0), interiorMs: Math.round(t2 - t1), compileMs: Math.round(t4 - t3), frameMs: Math.round(t5 - t4),
  interiorTris: countTris(interior?.root), interiorTexMB: +(texBytes / 1048576).toFixed(1), textures: seen.size,
  programs: renderer.info.programs?.length ?? 0, lights, timings: interior?.root?.userData?.timings,
};
window.__labReady = true;
