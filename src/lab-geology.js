// Dev lab for the geology module: terrain + sea + cliff + stones under the real
// sky, sun, haze and HDR pipeline, without the house or plants (fast stills).
// ?cam=x,y,z,tx,ty,tz,fov (GLB coords) or ?view=<id>; &w=&h=; &quality=
import * as THREE from 'three';
import { PROFILES } from './villa/core/quality.js';
import { VIEW_BY_ID } from './villa/core/anchors.js';
import { toThree, sunDirection } from './villa/core/world.js';
import { createSkyDome, buildEnvironment, installHaze, attachHazeToScene } from './villa/render/atmosphere.js';
import { Pipeline } from './villa/render/pipeline.js';
import { TerrainField, buildTerrainGeometry, buildHeightTexture, createTerrainMaterial } from './villa/landscape/terrain.js';
import { createOcean, generateWaveTexture } from './villa/landscape/ocean.js';
import { buildGeology } from './villa/landscape/geology/index.js';

const params = new URLSearchParams(location.search);
window.addEventListener('error', (e) => { window.__labError = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__labError = String(e.reason?.stack || e.reason); });
const W = Number(params.get('w') ?? 640), H = Number(params.get('h') ?? 360);
const q = { ...PROFILES[params.get('quality') ?? 'still'], aoScale: 0.5 };

installHaze();
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 46, bottom: -46, near: 900, far: 4200 });
sun.shadow.bias = 0;
sun.shadow.normalBias = 0.12;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.66, 0.68, 0.72), new THREE.Color(0.26, 0.21, 0.14), 0.5));

const t0 = performance.now();
const field = new TerrainField(7);
const tmat = createTerrainMaterial();
const terrain = new THREE.Mesh(buildTerrainGeometry(field, { res: q.terrainRes }), tmat);
terrain.name = 'terrain';
terrain.receiveShadow = terrain.castShadow = true;
scene.add(terrain);
const heightNear = buildHeightTexture(field, { size: 512, x0: -260, y0: -320, x1: 260, y1: 120 });
const heightFar = buildHeightTexture(field, { size: 768, x0: -6000, y0: -6000, x1: 7000, y1: 600 });
const waveRT = generateWaveTexture(renderer);
scene.add(createOcean({ heightNear, heightFar, waveTexture: waveRT.texture }));
const ctx = { THREE, scene, renderer, field, quality: q, camera, sunDir };
const geo = buildGeology(ctx);
if (params.has('nocliff')) geo.cliff && (scene.getObjectByName('sea-cliff').visible = false);
// stand-ins for the pool soffit and firepit terrace, for scale
const proxy = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.6 });
const slab = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.7, 48), proxy);
slab.position.set(13.25, 12.3, 18.65);
scene.add(slab);
attachHazeToScene(scene);
const buildMs = performance.now() - t0;

const pipeline = new Pipeline(renderer, scene, camera, q);
pipeline.setSize(W, H);
let pos, tgt, fov;
if (params.get('cam')) {
  const c = params.get('cam').split(',').map(Number);
  pos = c.slice(0, 3); tgt = c.slice(3, 6); fov = c[6] ?? 45;
} else {
  const v = VIEW_BY_ID[params.get('view') ?? 'seaward'];
  pos = v.position; tgt = v.target; fov = v.fov;
  pipeline.evOffset = v.ev ?? 0;
}
camera.position.copy(toThree(pos));
camera.lookAt(toThree(tgt));
camera.fov = fov;
camera.updateProjectionMatrix();
renderer.compile(scene, camera);
pipeline.render(null);
window.__labStats = { buildMs: Math.round(buildMs), geology: geo.stats };
window.__labReady = true;
