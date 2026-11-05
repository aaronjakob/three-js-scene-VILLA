import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/noise.js';
import { LEVEL } from '../../core/world.js';
import { materials } from '../../materials/library.js';

// Indoor strelitzia (bird-of-paradise) in stone pots: long petioles, oblong
// blades folded along a pale midrib, torn into strips along the lateral veins,
// ribbed (normals modulated by the vein pattern) and glossy.

function blade(rng, L, W, out) {
  const nu = 26, nv = 8;
  const pos = [], nrm = [], col = [], idx = [];
  // tears: lateral splits from the margin toward the midrib
  const tears = [];
  // (grid-cell tears read as square holes at this mesh density: leaves stay whole)
  for (let i = 0; i < 0; i++) tears.push({ u: 0.18 + rng() * 0.75, side: rng() < 0.5 ? -1 : 1, depth: 0.45 + rng() * 0.5 });
  const curl = 0.12 + rng() * 0.12;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const wv = Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + u * 0.97)), 0.55);
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1; // -1..1 across
      const x = v * W * 0.5 * wv;
      const y = u * L;
      // V-fold along the midrib + drooping tip
      const z = Math.abs(v) * W * 0.14 * wv - u * u * L * curl + Math.sin(u * 40 + v * 3) * 0.002;
      pos.push(x, y, z);
      // ribbed normal: lateral veins slant from midrib toward the tip
      const rib = Math.sin((u * 34 - Math.abs(v) * 2.2) * Math.PI);
      const nx = -Math.sign(v) * 0.28 + rib * 0.06 * Math.sign(v);
      const ny = 0.25 * u + rib * 0.05;
      const n = new THREE.Vector3(nx, ny, 1).normalize();
      nrm.push(n.x, n.y, n.z);
      const mid = Math.abs(v) < 0.12 ? 1 : 0;
      const edge = Math.abs(v) > 0.9 ? 1 : 0;
      const g = 0.85 + 0.15 * rng();
      col.push(mid ? 0.32 : (0.07 + edge * 0.05) * g, mid ? 0.42 : (0.20 + edge * 0.04) * g, mid ? 0.16 : (0.06 + edge * 0.01) * g);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = (i + 0.5) / nu, v = ((j + 0.5) / nv) * 2 - 1;
      let torn = false;
      for (const t of tears) if (Math.abs(u - t.u + Math.abs(v) * 0.05) < 0.012 && Math.sign(v) === t.side && Math.abs(v) > 1 - t.depth) torn = true;
      if (torn) continue;
      const a = i * (nv + 1) + j, b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  out.push(g);
  return g;
}

function petiole(start, end, r0, r1, out) {
  const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.05, 0));
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  const g = new THREE.TubeGeometry(curve, 8, r0, 6, false);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.set([0.16, 0.22, 0.09], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  void r1;
  out.push(g);
}

export function buildIndoorPlants(root, quality) {
  const M = materials(quality);
  const leafMat = new THREE.MeshPhysicalMaterial({ name: 'strelitzia', vertexColors: true, roughness: 0.5, clearcoat: 0.1, clearcoatRoughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.45 });
  const spots = [[-12.6, -2.6, 1.0], [-1.6, -7.2, 0.9], [11.6, -3.6, 1.0], [-15.9, 0.0, 0.9], [4.0, 4.4, 0.85], [16.9, 2.4, 0.95], [-7.6, 3.9, 0.8]];
  const leaves = [], pots = [];
  const rng = mulberry32(31337);
  for (const [x, y, s] of spots) {
    const pot = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.42, 0.22), new THREE.Vector2(0.4, 0.62), new THREE.Vector2(0.36, 0.64), new THREE.Vector2(0, 0.6)], 40);
    pot.scale(s, s, s);
    pot.translate(x, LEVEL.main, -y);
    pots.push(pot);
    const n = 8 + Math.floor(rng() * 4);
    const base = new THREE.Vector3(x, LEVEL.main + 0.6 * s, -y);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rng() * 0.4;
      const lean = 0.12 + rng() * 0.4;
      const plen = (0.75 + rng() * 0.75) * s;
      const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      const start = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05));
      const end = start.clone().addScaledVector(dir, plen);
      petiole(start, end, 0.011 * s, 0.008 * s, leaves);
      const L = (0.62 + rng() * 0.38) * s, Wd = (0.24 + rng() * 0.1) * s;
      const g = blade(rng, L, Wd, []);
      // orient: blade axis continues the petiole, bending outward; face turned around the axis
      const axis = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a + Math.PI / 2 + (rng() - 0.5) * 1.2);
      g.applyQuaternion(twist.premultiply(q));
      g.translate(end.x, end.y, end.z);
      leaves.push(g);
    }
  }
  const potMesh = new THREE.Mesh(mergeGeometries(pots.map((g) => { g.deleteAttribute('uv'); return g; })), M.planter);
  potMesh.castShadow = potMesh.receiveShadow = true;
  root.add(potMesh);
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves.map((g) => (g.index ? g : g))), leafMat);
  leafMesh.castShadow = leafMesh.receiveShadow = true;
  leafMesh.name = 'indoor-strelitzia';
  root.add(leafMesh);
}
