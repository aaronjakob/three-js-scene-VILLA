import * as THREE from 'three';
import * as TX from './textures.js';
import { bakeable } from './bake.js';
import { travertine } from '../materials/textures.js';

// Interior material set. Textures are world-scaled (geometry UVs are metres):
// repeat = 1 / tile size. Materials are grouped so they share shader programs
// (same map set => same program), which keeps SwiftShader compile time down.

let lib = null;
export function resetInteriorMaterials() { lib = null; }

function rep(tex, s, sy = s) {
  const t = tex.clone();
  t.repeat.set(s, sy);
  t.needsUpdate = true;
  return t;
}
const col = (r, g, b) => new THREE.Color(r, g, b);
// sRGB hex-like triplet (0-255) -> linear colour
const srgb = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);

export function interiorMaterials() {
  if (lib) return lib;
  const wal = TX.walnutTextures();
  const nero = TX.marbleTextures('nero');
  const cal = TX.marbleTextures('calacatta');
  const bou = TX.boucleTextures();
  const lin = TX.linenTextures();
  const her = TX.herringboneTextures();
  const lea = TX.leatherTextures();
  const bark = TX.barkTextures();
  const speck = TX.speckleTexture();
  const trav = travertine('wall');

  const B = (m, wrap = 0) => { bakeable(m); m.userData.bakeWrap = wrap; return m; };

  // --- wood (Physical: map + normal + roughness + clearcoat) ---------------------
  const wood = (name, tint, s = 1 / 0.9, cc = 0.18) => B(new THREE.MeshPhysicalMaterial({
    name,
    color: tint,
    map: rep(wal.map, s),
    normalMap: rep(wal.normalMap, s),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: rep(wal.roughnessMap, s),
    roughness: 1.0,
    clearcoat: cc,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.55,
  }));

  // --- fabric (Physical: map + normal + sheen) -------------------------------------
  const fabric = (name, tex, color, s, o = {}) => B(new THREE.MeshPhysicalMaterial({
    name,
    color,
    map: rep(tex.map, s),
    normalMap: rep(tex.normalMap, s),
    normalScale: new THREE.Vector2(o.ns ?? 0.8, o.ns ?? 0.8),
    roughness: o.rough ?? 0.92,
    sheen: o.sheen ?? 0.7,
    sheenRoughness: o.sheenRough ?? 0.55,
    sheenColor: o.sheenColor ?? col(1, 1, 1).multiplyScalar(0.55),
    envMapIntensity: 0.45,
    side: o.side ?? THREE.FrontSide,
  }), 0.35);

  // --- stone (Physical: map + clearcoat) ----------------------------------------------
  const stone = (name, map, s, o = {}) => B(new THREE.MeshPhysicalMaterial({
    name,
    color: o.color ?? col(1, 1, 1),
    map: rep(map, s, o.sy ?? s),
    roughness: o.rough ?? 0.16,
    clearcoat: o.cc ?? 0.75,
    clearcoatRoughness: o.ccr ?? 0.07,
    envMapIntensity: o.env ?? 0.75,
  }));

  // --- ceramic glazes (Standard: speckle map) -----------------------------------------
  const glaze = (name, color, rough, s = 3) => B(new THREE.MeshStandardMaterial({ name, color, map: rep(speck, s), roughness: rough, envMapIntensity: 0.6 }));

  const metal = (name, color, rough, metalness = 1) => B(new THREE.MeshStandardMaterial({ name, color, roughness: rough, metalness, envMapIntensity: 0.9 }));

  lib = {
    walnut: wood('walnut-oiled', col(1, 1, 1)),
    walnutDeep: wood('walnut-deep', col(0.72, 0.68, 0.64)),
    walnutDesk: wood('walnut-desk', col(0.95, 0.93, 0.9), 1 / 1.4, 0.3),
    oakPale: wood('oak-limed', col(2.1, 2.0, 1.8), 1 / 1.1, 0.1),

    nero: stone('nero-marquina', nero.map, 1 / 2.4, 1 / 1.2),
    neroIsland: stone('nero-island', nero.map, 1 / 4.6, 1 / 2.3),
    calacatta: stone('calacatta-table', cal.map, 1 / 2.3, { rough: 0.12, cc: 0.6 }),
    travertine: B(new THREE.MeshStandardMaterial({
      name: 'travertine-honed', map: rep(trav.map, 1 / 1.4), roughnessMap: rep(trav.roughnessMap, 1 / 1.4), roughness: 0.82, envMapIntensity: 0.5, color: col(0.96, 0.94, 0.9),
    })),
    travertineDark: B(new THREE.MeshStandardMaterial({
      name: 'travertine-noce', map: rep(trav.map, 1 / 1.1), roughnessMap: rep(trav.roughnessMap, 1 / 1.1), roughness: 0.75, envMapIntensity: 0.5, color: col(0.55, 0.47, 0.39),
    })),

    boucle: fabric('boucle-ivory', bou, srgb(236, 229, 216), 1 / 0.25, { ns: 0.9, sheen: 0.6, sheenColor: col(0.5, 0.48, 0.45) }),
    boucleOat: fabric('boucle-oat', bou, srgb(214, 200, 180), 1 / 0.25, { ns: 0.9, sheen: 0.6, sheenColor: col(0.45, 0.42, 0.38) }),
    linenSand: fabric('linen-sand', lin, srgb(205, 190, 168), 1 / 0.1, { ns: 0.6 }),
    linenTaupe: fabric('linen-taupe', lin, srgb(160, 142, 124), 1 / 0.1, { ns: 0.6 }),
    linenCocoa: fabric('linen-cocoa', lin, srgb(112, 84, 64), 1 / 0.1, { ns: 0.6 }),
    linenCharcoal: fabric('linen-charcoal', lin, srgb(72, 68, 64), 1 / 0.1, { ns: 0.6 }),
    linenWhite: fabric('linen-white', lin, srgb(236, 232, 224), 1 / 0.1, { ns: 0.5 }),
    linenSage: fabric('linen-sage', lin, srgb(150, 156, 132), 1 / 0.1, { ns: 0.6 }),
    velvetRust: fabric('velvet-rust', lin, srgb(150, 78, 48), 1 / 0.1, { ns: 0.15, rough: 0.7, sheen: 1, sheenRough: 0.35, sheenColor: col(0.9, 0.55, 0.38) }),
    velvetOlive: fabric('velvet-olive', lin, srgb(98, 96, 62), 1 / 0.1, { ns: 0.15, rough: 0.7, sheen: 1, sheenRough: 0.35, sheenColor: col(0.6, 0.6, 0.4) }),
    herringbone: fabric('wool-herringbone', her, srgb(176, 128, 88), 1 / 0.24, { ns: 0.9, side: THREE.DoubleSide }),
    chairFabric: fabric('chair-greige', bou, srgb(196, 182, 164), 1 / 0.2, { ns: 0.5, sheen: 0.5 }),
    taskFabric: fabric('task-chair-knit', lin, srgb(92, 86, 80), 1 / 0.08, { ns: 0.7 }),
    bedLinen: fabric('bed-linen', lin, srgb(240, 236, 228), 1 / 0.12, { ns: 0.5, side: THREE.DoubleSide }),

    leatherCognac: wood('leather-cognac', srgb(150, 92, 56)),
    leatherEspresso: wood('leather-espresso', srgb(58, 42, 34)),

    bronze: metal('bronze-dark', srgb(92, 70, 50), 0.38),
    brass: metal('brass-brushed', srgb(206, 164, 104), 0.3),
    blackSteel: metal('steel-black', col(0.025, 0.024, 0.023), 0.42, 0.6),
    aluminium: metal('aluminium-polished', srgb(214, 214, 216), 0.22),

    glazeWhite: glaze('glaze-chalk', srgb(232, 226, 214), 0.62),
    glazeSand: glaze('glaze-sand', srgb(198, 176, 144), 0.78),
    glazeCharcoal: glaze('glaze-charcoal', srgb(52, 48, 45), 0.4),
    glazeCeladon: glaze('glaze-celadon', srgb(150, 166, 148), 0.25),
    glazeRust: glaze('glaze-terracotta', srgb(170, 96, 64), 0.85),
    glazeOchre: glaze('glaze-ochre', srgb(196, 146, 72), 0.35),
    glazeIndigo: glaze('glaze-ink-blue', srgb(52, 64, 82), 0.3),
    glazeBone: glaze('glaze-bone-crackle', srgb(222, 210, 188), 0.3),
    plaster: glaze('plaster-raw', srgb(214, 204, 190), 0.95, 1.5),
    stoneBlack: glaze('basalt', srgb(46, 44, 42), 0.7, 1.2),

    glassSmoke: new THREE.MeshPhysicalMaterial({
      name: 'glass-smoke', color: srgb(110, 100, 86), roughness: 0.05, metalness: 0, transparent: true, opacity: 0.42,
      envMapIntensity: 1.0, specularIntensity: 1, depthWrite: false,
    }),
    glassAmber: new THREE.MeshPhysicalMaterial({
      name: 'glass-amber', color: srgb(170, 110, 50), roughness: 0.05, transparent: true, opacity: 0.5,
      envMapIntensity: 1.0, depthWrite: false,
    }),

    pages: B(new THREE.MeshStandardMaterial({ name: 'book-pages', map: rep(TX.pagesTexture(), 6), roughness: 0.9 })),
    cover: B(new THREE.MeshStandardMaterial({ name: 'book-cover', vertexColors: true, roughness: 0.62, envMapIntensity: 0.5 })),
    paint: B(new THREE.MeshStandardMaterial({ name: 'painted', vertexColors: true, roughness: 0.55, envMapIntensity: 0.5 })),

    bark: B(new THREE.MeshStandardMaterial({
      name: 'olive-bark', map: rep(bark.map, 1 / 0.3), normalMap: rep(bark.normalMap, 1 / 0.3), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95, envMapIntensity: 0.4,
    })),
    leaf: B(new THREE.MeshStandardMaterial({ name: 'olive-leaf', vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.5 }), 0.4),
    moss: B(new THREE.MeshStandardMaterial({ name: 'soil-moss', color: srgb(70, 62, 50), map: rep(speck, 4), roughness: 1 })),

    // light sources (unlit / emissive)
    shade: new THREE.MeshStandardMaterial({
      name: 'linen-shade', color: srgb(236, 226, 206), roughness: 0.9, side: THREE.DoubleSide,
      emissive: col(1.0, 0.64, 0.36), emissiveIntensity: 0.75, emissiveMap: TX.shadeTexture(),
    }),
    opal: new THREE.MeshStandardMaterial({ name: 'opal-globe', color: 0xffffff, roughness: 0.35, emissive: col(1.0, 0.68, 0.4), emissiveIntensity: 1.1 }),
    ledStrip: new THREE.MeshBasicMaterial({ name: 'led-strip-2700k', color: col(1.0, 0.66, 0.36).multiplyScalar(2.2) }),
    bulb: new THREE.MeshBasicMaterial({ name: 'bulb', color: col(1.0, 0.74, 0.46).multiplyScalar(3.0) }),
    candle: new THREE.MeshBasicMaterial({ name: 'candle-flame', color: col(1.0, 0.62, 0.28).multiplyScalar(4.0) }),
    wax: B(new THREE.MeshStandardMaterial({ name: 'wax', color: srgb(238, 230, 214), roughness: 0.6, emissive: col(1.0, 0.6, 0.3), emissiveIntensity: 0.06 })),
    screen1: new THREE.MeshBasicMaterial({ name: 'screen-a', map: TX.screenTexture(1), color: col(1.15, 1.15, 1.2) }),
    screen2: new THREE.MeshBasicMaterial({ name: 'screen-b', map: TX.screenTexture(2), color: col(1.15, 1.15, 1.2) }),
    screen3: new THREE.MeshBasicMaterial({ name: 'screen-c', map: TX.screenTexture(3), color: col(1.15, 1.15, 1.2) }),
    screenOff: new THREE.MeshStandardMaterial({ name: 'screen-glass', color: col(0.01, 0.01, 0.012), roughness: 0.08, metalness: 0.0, envMapIntensity: 1.0 }),
    blackGlass: new THREE.MeshPhysicalMaterial({ name: 'black-glass', color: col(0.012, 0.012, 0.013), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0 }),
  };
  lib.shade.userData.noShadow = true;
  lib.opal.userData.noShadow = true;
  lib.ledStrip.userData.noShadow = true;
  lib.bulb.userData.noShadow = true;
  lib.candle.userData.noShadow = true;
  lib.glassSmoke.userData.noShadow = true;
  lib.glassAmber.userData.noShadow = true;

  // rugs (Standard: map + tiled pile normal)
  const pile = TX.pileNormal();
  const rugMat = (name, kind, w, h) => {
    const r = TX.rugTextures(kind);
    const m = B(new THREE.MeshStandardMaterial({
      name, map: r.map.clone(), normalMap: rep(pile, w / 0.04, h / 0.04), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, envMapIntensity: 0.3,
    }), 0.1);
    m.map.needsUpdate = true;
    return m;
  };
  lib.rugLiving = rugMat('rug-living', 'living', 5.6, 4.2);
  lib.rugBed = rugMat('rug-bedroom', 'living', 3.4, 2.6);
  lib.rugDining = rugMat('rug-dining', 'living', 4.2, 4.2);

  // paintings
  lib.art = {};
  for (const [k, style, seed] of [['field', 'field', 1], ['ink', 'ink', 2], ['relief', 'relief', 3], ['organic', 'organic', 4], ['horizon', 'horizon', 5], ['wide', 'wide', 6]]) {
    lib.art[k] = B(new THREE.MeshStandardMaterial({ name: 'art-' + k, map: TX.paintingTexture(style, seed), roughness: 0.78, envMapIntensity: 0.35 }));
  }

  // additive light pools (decals on architecture surfaces)
  lib.pool = new THREE.MeshBasicMaterial({
    name: 'light-pool', map: TX.poolTexture(), color: col(1.0, 0.62, 0.32), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  lib.wash = new THREE.MeshBasicMaterial({
    name: 'light-wash', map: TX.washTexture(), color: col(1.0, 0.62, 0.32), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  lib.pool.userData.noShadow = true;
  lib.wash.userData.noShadow = true;
  return lib;
}
