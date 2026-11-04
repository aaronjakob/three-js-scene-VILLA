import * as THREE from 'three';
import * as T from './textures.js';
import { createGlassMaterial } from './glass.js';
import { tileStone } from './stone.js';

// Shared PBR materials (physically plausible roughness / albedo).
// Textures are world-scaled through repeat; ExtrudeGeometry produces UVs in
// metres, so repeat = 1 / tileSize.

let lib = null;

function rep(tex, s) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(s, s);
  return t;
}

export function materials(quality) {
  if (lib) return lib;
  const trav = T.travertine('floor');
  const travW = T.travertine('wall');
  const slab = T.slabStone();
  const wal = T.walnut('panel');
  const darkM = T.marble('dark');
  const lightM = T.marble('light');
  const boucle = T.fabric('boucle');
  const linen = T.fabric('linen');
  const stone = T.stoneWall();
  const cob = T.cobbles();
  const bk = T.bark();

  const warmLED = new THREE.Color(1.0, 0.62, 0.30); // ~2700 K

  lib = {
    floorPolished: new THREE.MeshPhysicalMaterial({
      name: 'travertine-polished',
      map: rep(trav.map, 1 / 2.4),
      roughnessMap: rep(trav.roughnessMap, 1 / 2.4),
      roughness: 0.44,
      metalness: 0,
      specularIntensity: 0.55,
      clearcoat: 0.05,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.45,
    }),
    deck: new THREE.MeshStandardMaterial({
      name: 'travertine-honed',
      map: rep(trav.map, 1 / 2.4),
      roughnessMap: rep(trav.roughnessMap, 1 / 2.4),
      roughness: 0.62,
      envMapIntensity: 0.8,
    }),
    travertineWall: new THREE.MeshStandardMaterial({
      name: 'travertine-wall',
      map: rep(travW.map, 1 / 1.8),
      roughness: 0.7,
      envMapIntensity: 0.5,
    }),
    slab: new THREE.MeshStandardMaterial({
      name: 'slab-white',
      map: rep(slab.map, 1 / 6),
      color: new THREE.Color(0.88, 0.85, 0.80),
      roughness: 0.58,
      envMapIntensity: 0.9,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      name: 'plaster-ceiling',
      color: new THREE.Color(0.80, 0.70, 0.58),
      roughness: 0.92,
      envMapIntensity: 0.25,
    }),
    walnut: new THREE.MeshPhysicalMaterial({
      name: 'walnut',
      map: rep(wal.map, 1 / 1.6),
      roughness: 0.48,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.45,
    }),
    walnutDark: new THREE.MeshStandardMaterial({
      name: 'walnut-dark',
      map: rep(wal.map, 1 / 1.2),
      color: new THREE.Color(0.7, 0.66, 0.62),
      roughness: 0.52,
      envMapIntensity: 0.4,
    }),
    metalDark: new THREE.MeshStandardMaterial({
      name: 'bronze-charcoal',
      color: new THREE.Color(0.10, 0.095, 0.09),
      metalness: 0.85,
      roughness: 0.38,
      envMapIntensity: 0.9,
    }),
    brass: new THREE.MeshStandardMaterial({
      name: 'brushed-brass',
      color: new THREE.Color(0.78, 0.62, 0.40),
      metalness: 1,
      roughness: 0.32,
    }),
    glass: createGlassMaterial(),
    stoneWall: new THREE.MeshStandardMaterial({
      name: 'limestone-ashlar',
      map: rep(stone.map, 1 / 4),
      bumpMap: rep(stone.bumpMap, 1 / 4),
      bumpScale: 2.2,
      roughness: 0.9,
      envMapIntensity: 0.5,
    }),
    darkStone: new THREE.MeshPhysicalMaterial({
      name: 'nero-marble',
      map: rep(darkM.map, 1 / 1.6),
      roughness: 0.22,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      envMapIntensity: 0.6,
    }),
    lightMarble: new THREE.MeshPhysicalMaterial({
      name: 'calacatta',
      map: rep(lightM.map, 1 / 1.8),
      roughness: 0.2,
      clearcoat: 0.5,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.6,
    }),
    boucle: new THREE.MeshPhysicalMaterial({
      name: 'boucle',
      map: rep(boucle.map, 1 / 0.35),
      bumpMap: rep(boucle.bumpMap, 1 / 0.35),
      bumpScale: 1.2,
      roughness: 0.95,
      sheen: 1,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0.95, 0.92, 0.86),
      envMapIntensity: 0.4,
    }),
    linen: new THREE.MeshPhysicalMaterial({
      name: 'linen',
      map: rep(linen.map, 1 / 0.25),
      bumpMap: rep(linen.bumpMap, 1 / 0.25),
      bumpScale: 0.6,
      roughness: 0.9,
      sheen: 0.6,
      sheenColor: new THREE.Color(0.9, 0.86, 0.8),
      envMapIntensity: 0.4,
    }),
    leather: new THREE.MeshPhysicalMaterial({
      name: 'leather-espresso',
      color: new THREE.Color(0.12, 0.085, 0.065),
      roughness: 0.55,
      clearcoat: 0.2,
      envMapIntensity: 0.5,
    }),
    rug: new THREE.MeshStandardMaterial({
      name: 'rug',
      map: T.rug().map,
      roughness: 1,
      envMapIntensity: 0.3,
    }),
    curtain: new THREE.MeshStandardMaterial({
      name: 'sheer-curtain',
      color: new THREE.Color(0.62, 0.57, 0.50),
      emissive: new THREE.Color(1.0, 0.70, 0.42),
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.62,
      roughness: 0.9,
      side: THREE.DoubleSide,
      envMapIntensity: 0.3,
    }),
    cobbles: new THREE.MeshStandardMaterial({
      name: 'cobbles',
      map: rep(cob.map, 1 / 6),
      roughness: 0.85,
      envMapIntensity: 0.6,
    }),
    bark: new THREE.MeshStandardMaterial({
      name: 'bark',
      map: bk.map,
      bumpMap: bk.bumpMap,
      bumpScale: 3,
      roughness: 0.95,
      envMapIntensity: 0.4,
    }),
    soil: new THREE.MeshStandardMaterial({
      name: 'soil',
      color: new THREE.Color(0.11, 0.09, 0.065),
      roughness: 1,
    }),
    planter: new THREE.MeshStandardMaterial({
      name: 'stone-planter',
      color: new THREE.Color(0.62, 0.6, 0.56),
      roughness: 0.85,
    }),
    led: new THREE.MeshBasicMaterial({ name: 'led-2700k', color: warmLED.clone().multiplyScalar(3.2) }),
    ledSoft: new THREE.MeshBasicMaterial({ name: 'led-soft', color: warmLED.clone().multiplyScalar(1.6) }),
    lampShade: new THREE.MeshStandardMaterial({
      name: 'opal-glass',
      color: 0xffffff,
      emissive: new THREE.Color(1.0, 0.64, 0.34),
      emissiveIntensity: 2.0,
      roughness: 0.4,
    }),
    screen: new THREE.MeshBasicMaterial({ name: 'screen', map: T.screenTexture(1), color: new THREE.Color(2.2, 2.2, 2.4) }),
    screen2: new THREE.MeshBasicMaterial({ name: 'screen2', map: T.screenTexture(2), color: new THREE.Color(2.2, 2.2, 2.4) }),
    screen3: new THREE.MeshBasicMaterial({ name: 'screen3', map: T.screenTexture(3), color: new THREE.Color(2.2, 2.2, 2.4) }),
    monitorBody: new THREE.MeshStandardMaterial({ name: 'monitor', color: new THREE.Color(0.03, 0.03, 0.035), roughness: 0.4, metalness: 0.3 }),
    books: new THREE.MeshStandardMaterial({ name: 'books', map: T.bookSpines(), roughness: 0.8 }),
    ceramic: new THREE.MeshStandardMaterial({ name: 'ceramic', color: new THREE.Color(0.78, 0.74, 0.68), roughness: 0.5 }),
    ceramicDark: new THREE.MeshStandardMaterial({ name: 'ceramic-dark', color: new THREE.Color(0.18, 0.16, 0.14), roughness: 0.55 }),
    flame: new THREE.MeshBasicMaterial({ name: 'flame', color: new THREE.Color(1.0, 0.55, 0.18).multiplyScalar(6), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    poolTile: new THREE.MeshStandardMaterial({ name: 'pool-tile', color: new THREE.Color(0.62, 0.78, 0.78), roughness: 0.35 }),
  };
  // non-reflective twins for surfaces that are not on the y = 18 m mirror plane
  lib.deckLow = lib.deck.clone();
  lib.deckLow.name = 'travertine-honed-low';
  lib.floorPlain = lib.floorPolished.clone();
  lib.floorPlain.name = 'travertine-polished-plain';
  // natural stone tiling (per-tile variation + crisp joints)
  tileStone(lib.floorPolished, { key: 'floorTiles' });
  tileStone(lib.floorPlain, { key: 'floorTiles' });
  tileStone(lib.deck, { tileW: 1.2, tileH: 0.6, joint: 0.003, depth: 0.35, key: 'deckTiles' });
  tileStone(lib.deckLow, { tileW: 0.9, tileH: 0.45, joint: 0.003, depth: 0.35, key: 'deckTilesLow' });
  lib.stoneWall.side = THREE.DoubleSide;
  return lib;
}

export function resetMaterials() { lib = null; }
