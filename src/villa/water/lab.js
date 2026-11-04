// Water lab: sky + terrain + sea (+ rocks, + villa/pool) through the real HDR
// pipeline, for fast iteration on the water shaders. Dev only.
//   lab.html?cam=x,y,z,tx,ty,tz,fov&w=640&h=360&rocks=1&villa=1&t=0
import * as THREE from 'three';
import { PROFILES } from '../core/quality.js';
import { VIEW_BY_ID } from '../core/anchors.js';
import { toThree, sunDirection } from '../core/world.js';
import { atmosphereUniforms, createSkyDome, buildEnvironment, installHaze, attachHazeToScene } from '../render/atmosphere.js';
import { Pipeline } from '../render/pipeline.js';
import { TerrainField, buildTerrainGeometry, buildHeightTexture, createTerrainMaterial } from '../landscape/terrain.js';
import { createOcean, generateWaveTexture } from '../landscape/ocean.js';
import { buildLandscapeDetail } from '../landscape/detail.js';
import { buildVilla } from '../architecture/building.js';
import { ReflectionPlane } from '../render/reflection.js';

const params = new URLSearchParams(location.search);
window.addEventListener('error', (e) => { window.__labError = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__labError = String(e.reason?.stack || e.reason); });

const W = Number(params.get('w') ?? 640), H = Number(params.get('h') ?? 360);
const q = { ...PROFILES.still, ao: params.has('ao'), msaa: 4, rocks: Number(params.get('rocks') ?? 0.6), terrainRes: Number(params.get('tres') ?? 480) };

installHaze();
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1, 2);
const camera = new THREE.PerspectiveCamera(45, W / H, 0.12, 70000);
camera.layers.enable(2);
scene.environment = buildEnvironment(renderer);
const sky = createSkyDome();
sky.material.depthTest = false;
scene.add(sky);
const sunDir = sunDirection(new THREE.Vector3());
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.6), 3.8);
sun.position.copy(sunDir).multiplyScalar(1400).add(new THREE.Vector3(0, 16, 6));
sun.target.position.set(0, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 46, bottom: -46, near: 900, far: 4200 });
sun.shadow.normalBias = 0.12;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.66, 0.68, 0.72), new THREE.Color(0.26, 0.21, 0.14), 0.5));

const T0 = performance.now();
const lap = (k) => console.log(`[lab] ${k} ${(performance.now() - T0).toFixed(0)} ms`);
const field = new TerrainField(7);
const terrain = new THREE.Mesh(buildTerrainGeometry(field, { res: q.terrainRes }), createTerrainMaterial());
terrain.name = 'terrain';
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);
lap('terrain');
const heightNear = buildHeightTexture(field, { size: 512, x0: -260, y0: -320, x1: 260, y1: 120 });
const heightFar = buildHeightTexture(field, { size: 768, x0: -6000, y0: -6000, x1: 7000, y1: 600 });
lap('heights');
const waveRT = generateWaveTexture(renderer);
lap('waves');
const ocean = createOcean({ heightNear, heightFar, waveTexture: waveRT.texture });
scene.add(ocean);
lap('ocean');
if (params.has('ocean0')) ocean.visible = false;
ocean.material.uniforms.uDebug.value = Number(params.get('dbg') ?? 0);
for (const k of ['uGlint']) if (params.get(k)) ocean.material.uniforms[k].value = Number(params.get(k));
const ctx = { THREE, scene, renderer, field, quality: q, camera, sunDir };
if (params.get('rocks') !== '0') {
  const d = buildLandscapeDetail(ctx);
  ctx.rockMaterial = d.material;
  lap('rocks');
}
let villa = null;
if (params.has('villa')) {
  villa = buildVilla(ctx);
  lap('villa');
}
attachHazeToScene(scene);
let refl = null;
if (villa) {
  refl = new ReflectionPlane(renderer, scene, { height: 18, scale: 0.6 });
  refl.attach(villa.reflectiveMaterials);
  if (villa.poolWater) refl.attachPoolWater(villa.poolWater);
  refl.setSize(W, H);
}
const pipeline = new Pipeline(renderer, scene, camera, q);
pipeline.setSize(W, H);

let ev = 0;
if (params.get('cam')) {
  const c = params.get('cam').split(',').map(Number);
  camera.position.copy(toThree(c.slice(0, 3)));
  camera.lookAt(toThree(c.slice(3, 6)));
  camera.fov = c[6] ?? 45;
} else {
  const v = VIEW_BY_ID[params.get('view') ?? 'seaward'];
  camera.position.copy(toThree(v.position));
  camera.lookAt(toThree(v.target));
  camera.fov = v.fov;
  ev = v.ev ?? 0;
}
if (params.get('ev')) ev = Number(params.get('ev'));
camera.updateProjectionMatrix();
camera.updateMatrixWorld();
atmosphereUniforms.uTime.value = Number(params.get('t') ?? 0);
pipeline.evOffset = ev;

renderer.compile(scene, camera);
lap('compile');
villa?.update?.(atmosphereUniforms.uTime.value, camera);
refl?.update(camera);
pipeline.render(null);
renderer.getContext().finish();
lap('frame');
window.__labReady = true;
