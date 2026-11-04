import * as THREE from 'three';
import { PROFILES, detectWebGL2, autoProfile } from './core/quality.js';
import { VIEWS, VIEW_BY_ID } from './core/anchors.js';
import { toThree, sunDirection, SUN } from './core/world.js';
import {
  atmosphereUniforms,
  createSkyDome,
  buildEnvironment,
  installHaze,
  uninstallHaze,
  attachHazeToScene,
} from './render/atmosphere.js';
import { clearTextureCache } from './materials/textures.js';
import { resetMaterials } from './materials/library.js';
import { Pipeline } from './render/pipeline.js';
import { TerrainField, buildTerrainGeometry, buildHeightTexture, createTerrainMaterial } from './landscape/terrain.js';
import { createOcean, generateWaveTexture } from './landscape/ocean.js';
import { buildLandscapeDetail } from './landscape/detail.js';
import { buildVilla } from './architecture/building.js';
import { buildInterior } from './interior/furniture.js';
import { buildVegetation } from './landscape/vegetation.js';
import { ReflectionPlane } from './render/reflection.js';
import { CameraRig } from './explore/rig.js';
import { bakeProbes } from './render/probes.js';
import { addWindowPortals } from './render/portals.js';
import { materials } from './materials/library.js';

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
  if (!qName || !gpu || !PROFILES[qName]) return createFallback(container, options);
  const q = { ...PROFILES[qName], ...(options.overrides ?? {}) };
  const cleanup = [];
  try {
    return await buildLive(container, options, gpu, q, cleanup);
  } catch (err) {
    // never leave a half-built canvas behind: fall back to the still
    console.warn('[villa] live scene unavailable, using still', err);
    for (const fn of cleanup.reverse()) { try { fn(); } catch { /* ignore */ } }
    return createFallback(container, options);
  }
}

const yieldToHost = () => new Promise((r) => setTimeout(r, 0));

async function buildLive(container, options, gpu, q, cleanup) {
  const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reducedMotion = options.reducedMotion ?? mql?.matches ?? false;

  installHaze();
  cleanup.push(() => uninstallHaze());

  const canvas = document.createElement('canvas');
  canvas.className = 'villa-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  // backdrop: not focusable, hidden from assistive tech; explore mode switches
  // it to a focusable role="application" (see CameraRig.setExplore)
  canvas.tabIndex = -1;
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  cleanup.push(() => canvas.remove());

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
  cleanup.push(() => { renderer.dispose(); renderer.forceContextLoss(); });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 1, 2); // flag only: enables the haze chunk
  const camera = new THREE.PerspectiveCamera(45, 1, 0.12, 70000);
  camera.layers.enable(2); // layer 2 = distant scenery (skipped by the reflection pass)

  // --- environment -------------------------------------------------------
  let envTex = buildEnvironment(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 1.0;
  const sky = createSkyDome();
  sky.material.depthTest = false;
  scene.add(sky);

  const sunDir = sunDirection(new THREE.Vector3());
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.85, 0.60), 4.4);
  sun.position.copy(sunDir).multiplyScalar(1400).add(new THREE.Vector3(0, 16, 6));
  sun.target.position.set(0, 16, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -62; sc.right = 62; sc.top = 46; sc.bottom = -46;
  sc.near = 900; sc.far = 4200;
  sun.shadow.bias = 0;
  sun.shadow.normalBias = 0.12; // grazing 9-degree sun: offset along normals, not depth
  sun.shadow.radius = q.shadowSize >= 8192 ? 4.5 : 2.5;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(new THREE.Color(0.66, 0.68, 0.72), new THREE.Color(0.26, 0.21, 0.14), 0.4);
  scene.add(hemi);

  // --- landscape -----------------------------------------------------------
  const field = new TerrainField(7);
  const terrain = new THREE.Mesh(buildTerrainGeometry(field, { res: q.terrainRes }), createTerrainMaterial());
  terrain.name = 'terrain';
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);

  const linear = gpu.floatLinear !== false;
  const heightNear = buildHeightTexture(field, { size: 512, x0: -260, y0: -320, x1: 260, y1: 120, linear });
  const heightFar = buildHeightTexture(field, { size: 768, x0: -6000, y0: -6000, x1: 7000, y1: 600, linear });
  let waveRT = generateWaveTexture(renderer);
  const ocean = createOcean({ heightNear, heightFar, waveTexture: waveRT.texture });
  scene.add(ocean);

  const ctx = { THREE, scene, renderer, field, quality: q, camera, sunDir };
  const T0 = performance.now();
  const lap = (k) => { if (options.profile) console.log(`[villa] ${k} ${(performance.now() - T0).toFixed(0)} ms`); };
  lap('terrain+ocean');
  await yieldToHost();
  const detail = buildLandscapeDetail(ctx);
  ctx.rockMaterial = detail.material;
  lap('rocks');
  await yieldToHost();
  const villa = buildVilla(ctx);
  lap('villa');
  ctx.villa = villa;
  await yieldToHost();
  buildInterior(ctx);
  lap('interior');
  await yieldToHost();
  const vegetation = buildVegetation(ctx);
  lap('vegetation');
  await yieldToHost();

  if (q.portals) addWindowPortals(scene, { intensity: q.portalIntensity ?? 1.6 });
  attachHazeToScene(scene);

  // --- reflections & pipeline ---------------------------------------------
  let reflection = null;
  if (q.reflections) {
    reflection = new ReflectionPlane(renderer, scene, { height: 18.0, scale: q.reflectionScale });
    reflection.attach(villa.reflectiveMaterials);
    if (villa.poolWater) reflection.attachPoolWater(villa.poolWater);
  }
  const pipeline = new Pipeline(renderer, scene, camera, q);

  // captured light probes: local reflections + bounce light (one-off at start-up)
  let probes = null;
  if (q.probes) {
    probes = bakeProbes({
      renderer, scene, reflection,
      poolWater: villa.poolWater,
      uniforms: atmosphereUniforms,
      glass: materials(q).glass,
      exterior: toThree([0, -21, 24.5]),
      interior: toThree([0.0, -2.2, 19.8]),
      bounces: q.probeBounces ?? 1,
      size: 256,
    });
    lap('probes');
  }

  // --- loop state -----------------------------------------------------------
  let width = 1, height = 1;
  let needsRender = true;
  // offline stills drive frames explicitly (renderNow); no RAF loop at all
  let running = !options.manualRender;
  let raf = 0;
  let mode = 'backdrop';
  let lost = false; // WebGL context lost
  let evCur = 0;
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
    onExit: () => api.setMode('backdrop'),
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
    const nw = Math.round(w * pr), nh = Math.round(h * pr);
    if (nw === width && nh === height) return;
    width = nw;
    height = nh;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    canvas.style.width = options.width ? `${w}px` : '100%';
    canvas.style.height = options.height ? `${h}px` : '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pipeline.setSize(width, height);
    reflection?.setSize(width, height);
    // resizing clears the canvas: redraw even while paused
    if (!running && !lost && !options.manualRender) renderFrame(0);
    invalidate();
  }

  function invalidate() {
    needsRender = true;
    if (running && !lost && !raf) {
      clock.update(); // wake: no stale delta after idling
      raf = requestAnimationFrame(frame);
    }
  }

  const stats = { frames: 0, lastMs: 0 };
  function renderFrame(dt = 0) {
    if (animateWater) atmosphereUniforms.uTime.value += dt;
    villa.update?.(atmosphereUniforms.uTime.value, camera);
    vegetation.update?.(camera);
    const gl = renderer.getContext();
    const prof = options.profile;
    const t0 = performance.now();
    // ease exposure between views (snap for single stills / reduced motion)
    evCur = dt > 0 && !reducedMotion ? evCur + (rig.ev - evCur) * Math.min(1, dt * 2.5) : rig.ev;
    pipeline.evOffset = evCur;
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
    if (!running || lost) return;
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.1);
    const moving = rig.update(dt);
    const live = moving || (animateWater && mode === 'explore') || Math.abs(evCur - rig.ev) > 0.01;
    if (needsRender || live) {
      needsRender = false;
      renderFrame(dt);
    }
    if (live) raf = requestAnimationFrame(frame);
  }

  let resizeQueued = false;
  const ro = new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  });
  ro.observe(container);
  let dprQuery = null;
  const onDpr = () => { watchDpr(); resize(); };
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery?.addEventListener('change', onDpr);
  }
  watchDpr();
  const onMotion = () => {
    if (options.reducedMotion !== undefined) return;
    reducedMotion = !!mql.matches;
    rig.reducedMotion = reducedMotion;
    animateWater = !reducedMotion && options.animate !== false;
    invalidate();
  };
  mql?.addEventListener('change', onMotion);

  // GPU context loss (sleep, driver reset): regenerate what lived only on the GPU
  const onLost = (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => {
    lost = false;
    envTex.dispose();
    envTex = buildEnvironment(renderer);
    scene.environment = envTex;
    waveRT.dispose();
    waveRT = generateWaveTexture(renderer);
    ocean.material.uniforms.tWave.value = waveRT.texture;
    renderer.shadowMap.needsUpdate = true;
    width = height = 0;
    resize();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  resize();
  // compile every program off the critical path before the first frame
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);

  const api = {
    quality: q.name,
    gpu,
    views: VIEWS.map(({ id, label, key }) => ({ id, label, key })),
    get view() { return rig.currentView; },
    setView(id, opts) {
      if (mode === 'explore') { mode = 'backdrop'; rig.setExplore(false); }
      rig.setView(id, opts);
      invalidate();
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      rig.setExplore(m === 'explore');
      if (m === 'backdrop' && rig.currentView) rig.setView(rig.currentView, { instant: reducedMotion });
      options.onModeChange?.(m);
      invalidate();
    },
    get mode() { return mode; },
    setAnimate(on) { animateWater = !!on && !reducedMotion; invalidate(); },
    setGrade(patch) { Object.assign(pipeline.grade, patch); invalidate(); },
    pipeline,
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; },
    resume() { running = true; clock.update(); invalidate(); },
    renderNow(dt = 0) { renderFrame(dt); },
    setFreeCamera(c) {
      // dev / offline: [x,y,z, tx,ty,tz, fov] in GLB coordinates
      rig._apply(toThree(c.slice(0, 3)), toThree(c.slice(3, 6)), c[6] ?? 45);
      rig.currentView = null;
    },
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
      dprQuery?.removeEventListener('change', onDpr);
      mql?.removeEventListener('change', onMotion);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      rig.dispose();
      pipeline.dispose();
      reflection?.dispose();
      scene.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        o.geometry?.dispose?.();
        if (o.isLight && o.shadow) o.shadow.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          for (const k in m) if (m[k]?.isTexture) m[k].dispose();
          m.dispose();
        }
      });
      envTex.dispose();
      probes?.dispose();
      heightNear.dispose();
      heightFar.dispose();
      waveRT.dispose();
      clearTextureCache();
      resetMaterials();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      uninstallHaze();
    },
  };

  if (options.debug) buildDebugMarkers(ctx);
  if (mode === 'explore') { mode = 'backdrop'; api.setMode('explore'); }
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
  img.onerror = () => { img.style.visibility = 'hidden'; };
  img.onload = () => { img.style.visibility = ''; };
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
