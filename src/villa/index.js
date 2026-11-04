import * as THREE from 'three';
import { PROFILES, detectWebGL2, autoProfile } from './core/quality.js';
import { VIEWS, VIEW_BY_ID } from './core/anchors.js';
import { toThree, sunDirection, SUN } from './core/world.js';
import {
  atmosphereUniforms,
  createSkyDome,
  buildEnvironment,
  installHaze,
  attachHazeToScene,
} from './render/atmosphere.js';
import { Pipeline } from './render/pipeline.js';
import { TerrainField, buildTerrainGeometry, buildHeightTexture, createTerrainMaterial } from './landscape/terrain.js';
import { createOcean, generateWaveTexture } from './landscape/ocean.js';
import { buildLandscapeDetail } from './landscape/detail.js';
import { buildVilla } from './architecture/building.js';
import { buildInterior } from './interior/furniture.js';
import { buildVegetation } from './landscape/vegetation.js';
import { ReflectionPlane } from './render/reflection.js';
import { CameraRig } from './explore/rig.js';

export { VIEWS, PROFILES };

/**
 * Mount the villa into a container element.
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {'auto'|'still'|'high'|'balanced'|'low'} [options.quality='auto']
 * @param {string} [options.view='aerial']
 * @param {boolean} [options.reducedMotion] defaults to the OS preference
 * @param {'backdrop'|'explore'} [options.mode='backdrop']
 * @param {string} [options.fallbackImage] still image used when WebGL is unsuitable
 * @param {(view:string)=>void} [options.onViewChange]
 * @param {boolean} [options.debug=false] dev-only anchor markers
 */
export async function createVilla(container, options = {}) {
  const gpu = detectWebGL2();
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const lowMemory = (navigator.deviceMemory ?? 8) < 4;
  let qName = options.quality ?? 'auto';
  if (qName === 'auto') qName = autoProfile(gpu, { mobile, lowMemory });
  if (!qName || !gpu) return createFallback(container, options);
  const q = { ...PROFILES[qName], ...(options.overrides ?? {}) };

  const reducedMotion =
    options.reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  installHaze();

  const canvas = document.createElement('canvas');
  canvas.className = 'villa-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Coastal villa');
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    reversedDepthBuffer: !!gpu.clipControl,
    preserveDrawingBuffer: !!options.preserveDrawingBuffer,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // the sun and all shadow casters are static: render the shadow map once
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 2); // flag only: enables the haze chunk
  const camera = new THREE.PerspectiveCamera(45, 1, 0.12, 70000);
  camera.layers.enable(2); // layer 2 = distant scenery (skipped by the reflection pass)

  // --- environment -------------------------------------------------------
  const envTex = buildEnvironment(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 1.0;
  const sky = createSkyDome();
  sky.material.depthTest = false;
  scene.add(sky);

  const sunDir = sunDirection(new THREE.Vector3());
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.87, 0.68), 2.7);
  sun.position.copy(sunDir).multiplyScalar(1400).add(new THREE.Vector3(0, 16, 6));
  sun.target.position.set(0, 16, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -62; sc.right = 62; sc.top = 46; sc.bottom = -46;
  sc.near = 900; sc.far = 4200;
  sun.shadow.bias = 0;
  sun.shadow.normalBias = 0.12; // grazing 9-degree sun: offset along normals, not depth
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.68, 0.9), new THREE.Color(0.16, 0.15, 0.11), 0.35);
  scene.add(hemi);

  // --- landscape -----------------------------------------------------------
  const field = new TerrainField(7);
  const terrain = new THREE.Mesh(buildTerrainGeometry(field, { res: q.terrainRes }), createTerrainMaterial());
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  const heightNear = buildHeightTexture(field, { size: 512, x0: -260, y0: -320, x1: 260, y1: 120 });
  const heightFar = buildHeightTexture(field, { size: 768, x0: -6000, y0: -6000, x1: 7000, y1: 600 });
  const waveRT = generateWaveTexture(renderer);
  const ocean = createOcean({ heightNear, heightFar, waveTexture: waveRT.texture });
  scene.add(ocean);

  const ctx = { THREE, scene, renderer, field, quality: q, camera, sunDir };
  const T0 = performance.now();
  const lap = (k) => { if (options.profile) console.log(`[villa] ${k} ${(performance.now() - T0).toFixed(0)} ms`); };
  lap('terrain+ocean');
  const detail = buildLandscapeDetail(ctx);
  ctx.rockMaterial = detail.material;
  lap('rocks');
  const villa = buildVilla(ctx);
  lap('villa');
  ctx.villa = villa;
  const interior = buildInterior(ctx);
  lap('interior');
  const vegetation = buildVegetation(ctx);
  lap('vegetation');

  attachHazeToScene(scene);

  // --- reflections & pipeline ---------------------------------------------
  let reflection = null;
  if (q.reflections) {
    reflection = new ReflectionPlane(renderer, scene, { height: 18.0, scale: q.reflectionScale });
    reflection.attach(villa.reflectiveMaterials);
    if (villa.poolWater) reflection.attachPoolWater(villa.poolWater);
  }
  const pipeline = new Pipeline(renderer, scene, camera, q);

  // --- loop state -----------------------------------------------------------
  let width = 1, height = 1;
  let needsRender = true;
  let running = true;
  let raf = 0;
  let mode = options.mode ?? 'backdrop';
  const clock = new THREE.Timer();
  let animateWater = !reducedMotion && options.animate !== false;

  // --- camera rig -----------------------------------------------------------
  const rig = new CameraRig({
    camera,
    canvas,
    field,
    villa,
    reducedMotion,
    onChange: () => invalidate(),
    onViewChange: (id) => options.onViewChange?.(id),
  });
  rig.setView(VIEW_BY_ID[options.view] ? options.view : 'aerial', { instant: true });
  if (options.camera) {
    // dev: free camera "x,y,z,tx,ty,tz,fov" in GLB coordinates
    const c = options.camera;
    rig._apply(toThree(c.slice(0, 3)), toThree(c.slice(3, 6)), c[6] ?? 45);
  }


  function resize() {
    const r = container.getBoundingClientRect();
    const w = Math.max(2, Math.round(options.width ?? r.width));
    const h = Math.max(2, Math.round(options.height ?? r.height));
    const pr = options.width ? 1 : Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    width = Math.round(w * pr);
    height = Math.round(h * pr);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    canvas.style.width = options.width ? `${w}px` : '100%';
    canvas.style.height = options.height ? `${h}px` : '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pipeline.setSize(width, height);
    reflection?.setSize(width, height);
    invalidate();
  }

  function invalidate() {
    needsRender = true;
    if (running && !raf) raf = requestAnimationFrame(frame);
  }

  const stats = { frames: 0, lastMs: 0 };
  function renderFrame(dt = 0) {
    if (animateWater) atmosphereUniforms.uTime.value += dt;
    villa.update?.(atmosphereUniforms.uTime.value, camera);
    vegetation.update?.(camera);
    const gl = renderer.getContext();
    const prof = options.profile;
    const t0 = performance.now();
    if (reflection) reflection.update(camera);
    if (prof) { gl.finish(); stats.reflMs = performance.now() - t0; }
    pipeline.profile = prof ? (k) => { gl.finish(); pipeline.times[k] = performance.now(); } : null;
    pipeline.times = {};
    pipeline.render(null);
    if (prof) gl.finish();
    stats.lastMs = performance.now() - t0;
    stats.stages = pipeline.times;
    stats.frames++;
  }

  function frame() {
    raf = 0;
    if (!running) return;
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.1);
    const moving = rig.update(dt);
    const live = moving || (animateWater && mode === 'explore');
    if (needsRender || live) {
      needsRender = false;
      renderFrame(dt);
    }
    if (live) raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  const api = {
    quality: q.name,
    gpu,
    views: VIEWS.map(({ id, label, key }) => ({ id, label, key })),
    get view() { return rig.currentView; },
    setView(id, opts) { rig.setView(id, opts); invalidate(); },
    setMode(m) {
      mode = m;
      rig.setExplore(m === 'explore');
      invalidate();
    },
    get mode() { return mode; },
    setAnimate(on) { animateWater = !!on && !reducedMotion; invalidate(); },
    setGrade(patch) { Object.assign(pipeline.grade, patch); invalidate(); },
    pipeline,
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; },
    resume() { running = true; clock.update(); invalidate(); },
    renderNow(dt = 0) { renderFrame(dt); },
    capture(type = 'image/png', quality) {
      renderFrame(0);
      return canvas.toDataURL(type, quality);
    },
    stats() {
      const info = renderer.info;
      let tris = 0, instances = 0;
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const g = o.geometry;
        const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const c = o.isInstancedMesh ? o.count : 1;
        tris += t * c;
        instances += c;
      });
      return {
        ms: stats.lastMs,
        reflMs: stats.reflMs,
        stages: stats.stages,
        sceneTriangles: Math.round(tris),
        sceneInstances: instances,
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
    debugMarkers(on) { ctx.debugGroup && (ctx.debugGroup.visible = on); invalidate(); },
    scene, camera, renderer, rig, field,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      rig.dispose();
      pipeline.dispose();
      reflection?.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          for (const k in m) if (m[k]?.isTexture) m[k].dispose();
          m.dispose();
        }
      });
      envTex.dispose();
      heightNear.dispose();
      heightFar.dispose();
      waveRT.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };

  if (options.debug) buildDebugMarkers(ctx);
  invalidate();
  return api;
}

function createFallback(container, options) {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;';
  const view = options.view ?? 'aerial';
  const base = options.fallbackBase ?? './renders/';
  img.src = options.fallbackImage ?? `${base}${view}.jpg`;
  container.appendChild(img);
  return {
    quality: 'fallback',
    views: VIEWS.map(({ id, label, key }) => ({ id, label, key })),
    view,
    setView(id) { img.src = `${base}${id}.jpg`; this.view = id; options.onViewChange?.(id); },
    setMode() {},
    setAnimate() {},
    setGrade() {},
    pause() {},
    resume() {},
    stats() { return { fallback: true }; },
    dispose() { img.remove(); },
  };
}

function buildDebugMarkers(ctx) {
  const g = new THREE.Group();
  g.name = 'debug-anchors';
  const m = new THREE.MeshBasicMaterial({ color: 0xff2266, depthTest: false });
  import('./core/anchors.js').then(({ ANCHORS }) => {
    for (const [, p] of Object.entries(ANCHORS)) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), m);
      s.position.copy(toThree(p));
      s.renderOrder = 999;
      g.add(s);
    }
  });
  ctx.scene.add(g);
  ctx.debugGroup = g;
}

export { SUN };
