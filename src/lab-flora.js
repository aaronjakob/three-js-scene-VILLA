// Flora lab: single trees / shrubs under the scene's sky, sun and grade.
// ?shot=front|back|lod|shrubs  &w=640&h=360
import * as THREE from 'three';
import { PROFILES } from './villa/core/quality.js';
import { createSkyDome, buildEnvironment, installHaze, attachHazeToScene } from './villa/render/atmosphere.js';
import { sunDirection } from './villa/core/world.js';
import { Pipeline } from './villa/render/pipeline.js';
import { makeTreeVariant } from './villa/landscape/flora/trees.js';
import { foliageMaterial, barkMaterial } from './villa/landscape/flora/material.js';

const params = new URLSearchParams(location.search);
const W = +(params.get('w') ?? 640), H = +(params.get('h') ?? 360);
const shot = params.get('shot') ?? 'front';
window.addEventListener('error', (e) => { window.__labError = String(e.message || e); });
window.addEventListener('unhandledrejection', (e) => { window.__labError = String(e.reason?.stack || e.reason); });

installHaze();
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(W, H, false);
renderer.autoClear = false;
const q = { ...PROFILES.still, aoSamples: 12 };
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1, 2);
scene.environment = buildEnvironment(renderer);
const sky = createSkyDome();
sky.material.depthTest = false;
scene.add(sky);
const sunDir = sunDirection(new THREE.Vector3());
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.60), 3.8);
sun.position.copy(sunDir).multiplyScalar(400);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, near: 100, far: 800 });
sun.shadow.normalBias = 0.08;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.66, 0.68, 0.72), new THREE.Color(0.26, 0.21, 0.14), 0.5));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.075, 0.05), roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

const leaf = foliageMaterial({ msaa: 4 });
const t0 = performance.now();
const species = ['pine', 'aleppo', 'oak', 'olive', 'cypress'];
let tris = 0;
const place = (sp, seed, L, x, z) => {
  const v = makeTreeVariant(sp, seed);
  const lod = v.lods[L];
  const w = new THREE.Mesh(lod.wood, barkMaterial(v.bark));
  const l = new THREE.Mesh(lod.leaves, leaf);
  for (const m of [w, l]) { m.position.set(x, 0, z); m.castShadow = m.receiveShadow = true; scene.add(m); }
  tris += lod.wood.index.count / 3 + lod.leaves.index.count / 3;
  console.log(sp, 'L' + L, 'tris', lod.wood.index.count / 3, lod.leaves.index.count / 3, 'cards', lod.cards, 'H', v.height.toFixed(1));
};
if (shot === 'lod') {
  species.forEach((sp, i) => { for (let L = 0; L < 3; L++) place(sp, 3, L, (L - 1) * 12, i * 14); });
} else {
  species.forEach((sp, i) => place(sp, 1 + i, 0, (i - 2) * 9, (i % 2) * 3));
}
console.log('build ms', (performance.now() - t0).toFixed(0), 'tris', tris);
attachHazeToScene(scene);

const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 50000);
camera.layers.enable(2);
// sun is toward +x / +z (south-east, three z = -north)
if (shot === 'back') { camera.position.set(-20, 4, -24); camera.lookAt(0, 5, 0); }
else if (shot === 'lod') { camera.position.set(0, 9, -32); camera.lookAt(0, 5, 20); }
else { camera.position.set(8, 4.5, 30); camera.lookAt(0, 5, 0); }
camera.updateProjectionMatrix();
const pipe = new Pipeline(renderer, scene, camera, q);
pipe.setSize(W, H);
renderer.shadowMap.needsUpdate = true;
renderer.compile(scene, camera);
pipe.render(null);
window.__labReady = true;
