// dev probe (node): terrain profile under the waterfall spill
import * as THREE from 'three';
import { TerrainField } from '../landscape/terrain.js';
import { poolOutline, WATERFALL_SPILL } from '../architecture/plan.js';

const field = new TerrainField(7);
const inner = poolOutline();
const n = inner.length;
const SP = new THREE.Vector2(...WATERFALL_SPILL);
let si = 0;
for (let i = 0; i < n; i++) if (inner[i].distanceTo(SP) < inner[si].distanceTo(SP)) si = i;
const a = inner[(si - 1 + n) % n], b = inner[(si + 1) % n];
const t = new THREE.Vector2().subVectors(b, a).normalize();
const dir = new THREE.Vector2(t.y, -t.x);
console.log('TIP', inner[si].toArray().map((v) => v.toFixed(2)), 'dir', dir.toArray().map((v) => v.toFixed(3)));
for (let s = -1; s <= 9; s += 0.5) {
  const p = inner[si].clone().addScaledVector(dir, s);
  const row = [];
  for (let l = -3; l <= 3; l += 1.5) {
    const q = p.clone().addScaledVector(new THREE.Vector2(-dir.y, dir.x), l);
    row.push(field.height(q.x, q.y).toFixed(2));
  }
  console.log('s', s.toFixed(1), 'at', p.toArray().map((v) => v.toFixed(2)), 'h(-3..3)', row.join(' '));
}
