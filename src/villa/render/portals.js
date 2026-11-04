import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { smooth, ccw, offset, ENCLOSURE_PTS, UPPER_PTS } from '../architecture/plan.js';
import { LEVEL } from '../core/world.js';

// "Window portals": soft rectangular area lights just inside the glazing,
// facing into the rooms. They carry daylight with the right spatial falloff
// (bright near the glass, dim at the back) and give polished floors and
// lacquered surfaces the large soft window highlights of interior photographs.

let ltcReady = false;

export function addWindowPortals(scene, { intensity = 1.6, upper = true } = {}) {
  if (!ltcReady) { RectAreaLightUniformsLib.init(); ltcReady = true; }
  const group = new THREE.Group();
  group.name = 'window-portals';
  const sky = new THREE.Color(0.80, 0.87, 0.97);
  const warm = new THREE.Color(1.0, 0.90, 0.74);

  const place = (curve, z0, z1, stations, width, k) => {
    const pts = curve;
    for (const sx of stations) {
      // nearest glass point to the station, with its inward normal
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i].x - sx[0], pts[i].y - sx[1]);
        if (d < bd) { bd = d; bi = i; }
      }
      const a = pts[(bi - 2 + pts.length) % pts.length], b = pts[(bi + 2) % pts.length];
      const t = new THREE.Vector2().subVectors(b, a).normalize();
      const inward = new THREE.Vector2(-t.y, t.x); // CCW outline: left normal points inside
      const p = pts[bi];
      const h = z1 - z0;
      const light = new THREE.RectAreaLight(sky.clone().lerp(warm, sx[2] ?? 0), intensity * k, width, h * 0.92);
      const cx = p.x + inward.x * 0.3, cy = p.y + inward.y * 0.3;
      light.position.set(cx, (z0 + z1) / 2, -cy);
      light.lookAt(cx + inward.x * 5, (z0 + z1) / 2 - 0.6, -(cy + inward.y * 5));
      group.add(light);
    }
  };

  const enclosure = ccw(smooth(ENCLOSURE_PTS, 260));
  // main floor: south arc (sea), the west and east ends; warmer toward the south-east sun
  place(enclosure, LEVEL.main, LEVEL.upper - 0.85, [
    [-14.5, -6.6, 0.0], [-8.0, -8.9, 0.1], [-1.5, -9.5, 0.25], [5.0, -9.2, 0.45], [11.5, -7.9, 0.6],
    [-18.3, 1.5, 0.0], [18.4, 1.0, 0.5],
  ], 6.2, 1);
  if (upper) {
    const up = ccw(smooth(UPPER_PTS, 240));
    place(up, LEVEL.upper, LEVEL.roof - 0.8, [[-10.0, -6.1, 0.1], [0.0, -6.8, 0.3], [10.0, -5.7, 0.55]], 7.0, 0.8);
  }
  scene.add(group);
  return group;
}

export { offset };
