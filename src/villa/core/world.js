import * as THREE from 'three';

// ---------------------------------------------------------------------------
// LOCKED WORLD FRAME
// Source of truth (SPATIAL_MANIFEST.json / GLB): +X east, +Y north (inland),
// -Y south (sea), +Z up, metres.  Three.js is Y-up, so we convert ONCE here:
//   three.x =  glb.x   (east)
//   three.y =  glb.z   (up)
//   three.z = -glb.y   (south, toward the sea)
// Every module authors positions in GLB/plan coordinates and calls P()/toThree.
// ---------------------------------------------------------------------------

export function P(x, y, z = 0) {
  return new THREE.Vector3(x, z, -y);
}

export function toThree(arr) {
  return P(arr[0], arr[1], arr[2]);
}

export function toGlb(v) {
  return { x: v.x, y: -v.z, z: v.y };
}

// Plan-space (x east, y north) geometry -> world. ExtrudeGeometry extrudes along +Z,
// rotateX(-PI/2) maps (x, y, z) -> (x, z, -y) which is exactly the GLB->three map.
export function planToWorld(geometry, baseElevation = 0) {
  geometry.rotateX(-Math.PI / 2);
  if (baseElevation) geometry.translate(0, baseElevation, 0);
  return geometry;
}

// Fixed elevations (metres above sea level)
export const LEVEL = {
  sea: 0,
  main: 18.0, // main floor top (manifest)
  mainSlab: 0.45,
  upper: 23.0, // upper floor top
  roof: 28.3, // roof structural slab top
  roofSoil: 28.75,
  firepit: 12.65, // manifest
  eye: 1.62,
};

// Sun: low pale-yellow sun over the sea toward the south-east (manifest "light").
// Azimuth measured clockwise from north (GLB +Y).
export const SUN = {
  azimuthDeg: 146,
  elevationDeg: 6.5,
};

export function sunDirection(target = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(SUN.azimuthDeg);
  const el = THREE.MathUtils.degToRad(SUN.elevationDeg);
  // GLB horizontal: east = sin(az), north = cos(az)
  const gx = Math.cos(el) * Math.sin(az);
  const gy = Math.cos(el) * Math.cos(az);
  const gz = Math.sin(el);
  return target.set(gx, gz, -gy).normalize();
}
