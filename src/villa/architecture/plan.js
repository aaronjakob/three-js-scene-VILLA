import * as THREE from 'three';

// Plan geometry in GLB plan coordinates (x east, y north, metres).
// Every outline is a smooth closed curve through control points; the same
// curves drive slabs, glazing, colliders and planting so nothing drifts.

export function smooth(points, samples = 200, closed = true, tension = 0.5) {
  const pts = points.map(([x, y]) => new THREE.Vector3(x, y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal', tension);
  return curve.getSpacedPoints(samples).slice(0, closed ? samples : samples + 1).map((p) => new THREE.Vector2(p.x, p.y));
}

export function ellipse(cx, cy, rx, ry, n = 64, rot = 0) {
  const out = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push(new THREE.Vector2(cx + x * c - y * s, cy + x * s + y * c));
  }
  return out;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ccw(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}
export function cw(pts) {
  return signedArea(pts) > 0 ? pts.slice().reverse() : pts;
}

export function shape(outline, holes = []) {
  const sh = new THREE.Shape(ccw(outline));
  for (const h of holes) sh.holes.push(new THREE.Path(cw(h)));
  return sh;
}

// Offset a closed polyline (positive = outward for CCW)
export function offset(pts, d) {
  const P = ccw(pts);
  const n = P.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const t = new THREE.Vector2().subVectors(c, a).normalize();
    const nrm = new THREE.Vector2(t.y, -t.x);
    out.push(new THREE.Vector2(b.x + nrm.x * d, b.y + nrm.y * d));
  }
  return out;
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPoly(x, y, pts, closed = true) {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const l2 = ex * ex + ey * ey || 1;
    let t = ((x - a.x) * ex + (y - a.y) * ey) / l2;
    t = Math.max(0, Math.min(1, t));
    const dx = x - (a.x + ex * t), dy = y - (a.y + ey * t);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

export function polylineLength(pts, closed = false) {
  let L = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) L += pts[i].distanceTo(pts[(i + 1) % pts.length]);
  return L;
}

// Resample an open polyline at fixed spacing
export function resample(pts, spacing) {
  const out = [pts[0].clone()];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = a.distanceTo(b);
    let t = spacing - carry;
    while (t <= seg) {
      out.push(a.clone().lerp(b, t / seg));
      t += spacing;
    }
    carry = seg - (t - spacing);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE PLAN (single source of truth for the building)
// ---------------------------------------------------------------------------

// Main floor enclosure (glass line + north walls), clockwise from the west.
export const ENCLOSURE_PTS = [
  [-18.4, -1.2], [-17.0, -4.9], [-13.2, -7.7], [-7.0, -9.15], [0, -9.5],
  [7.0, -9.15], [12.9, -7.7], [16.8, -5.1], [18.5, -1.4], [18.7, 2.6],
  [17.6, 6.4], [15.0, 9.0], [10.5, 10.4], [5.0, 10.9], [1.0, 10.9],
  [-4.0, 10.7], [-9.5, 10.1], [-14.2, 8.6], [-17.4, 5.7], [-18.7, 2.2],
];

// Crescent infinity pool; west tip carries the waterfall (manifest x=-9.1, y=-12.6)
export const POOL_PTS = [
  [-10.15, -12.6], [-8.0, -11.6], [-4.0, -11.05], [0, -10.9], [4.0, -11.05],
  [8.0, -11.6], [10.7, -12.75], [8.7, -14.0], [4.5, -14.75], [0, -15.0],
  [-4.5, -14.8], [-8.4, -13.85],
];

// Main deck/floor slab (interior + terraces). South edge hugs the pool's north edge.
export const DECK_PTS = [
  [-21.0, 2.6], [-21.3, -2.8], [-19.9, -7.4], [-16.4, -10.6], [-12.4, -11.85],
  [-10.6, -11.9], [-8.0, -11.15], [-4.0, -10.6], [0, -10.45], [4.0, -10.6],
  [8.0, -11.15], [10.6, -12.2], [11.8, -14.2], [14.6, -15.5], [17.6, -14.8],
  [19.9, -11.6], [20.6, -6.6], [20.4, -1.0], [20.0, 4.2], [18.4, 8.6],
  [15.6, 11.0], [10.8, 12.0], [6.0, 12.3], [3.0, 12.5], [0.0, 12.3],
  [-5.0, 11.9], [-10.0, 11.3], [-14.6, 9.9], [-18.6, 6.9],
];

// Upper floor slab: big curved canopy over the terraces + north entry canopy
export const L1_PTS = [
  [-22.6, 1.0], [-22.1, -4.6], [-19.2, -9.4], [-13.0, -12.4], [-5.5, -13.5],
  [2.0, -13.75], [9.0, -12.9], [15.0, -11.0], [19.6, -7.2], [21.6, -2.2],
  [21.4, 3.4], [19.4, 8.0], [15.2, 11.2], [9.8, 12.8], [6.0, 15.2],
  [3.0, 16.6], [-0.2, 15.0], [-4.0, 13.0], [-10.0, 12.2], [-15.6, 10.2],
  [-20.4, 6.0],
];

// Upper-floor glass line (set back)
export const UPPER_PTS = [
  [-17.2, 0.4], [-15.6, -3.9], [-10.4, -6.1], [-3.0, -6.8], [4.0, -6.6],
  [10.4, -5.6], [14.8, -3.0], [16.2, 1.2], [15.2, 5.4], [11.8, 8.4],
  [5.0, 9.8], [-3.0, 9.9], [-10.0, 9.2], [-15.0, 6.6], [-17.2, 3.4],
];

// Roof slab
export const ROOF_PTS = [
  [-20.0, 0.6], [-19.0, -4.4], [-14.6, -8.3], [-6.5, -9.9], [2.0, -10.1],
  [9.8, -9.2], [15.8, -6.6], [19.0, -2.4], [19.4, 2.6], [17.2, 7.0],
  [12.4, 10.2], [4.0, 11.6], [-4.0, 11.7], [-11.0, 10.9], [-16.8, 8.3],
  [-19.6, 4.2],
];

export const ATRIUM = { cx: -4.1, cy: -0.6, rx: 3.6, ry: 2.35, rot: 0.1 };
export const STAIR_HOLE = { cx: -3.6, cy: 6.65, rx: 3.9, ry: 0.95 };

// Interior partitions (open polylines) in plan coords
export const WALLS = {
  // workspace feature wall (walnut slats + shelving + stone), faces south
  feature: [[-17.2, 4.7], [-6.4, 4.7]],
  // stair wall / service core south face
  stair: [[-8.2, 7.45], [1.4, 7.45]],
  // kitchen tall-unit wall
  kitchen: [[4.6, 6.0], [15.6, 6.0]],
  // service core (powder room, storage): closed box
  core: [[-15.8, 7.45], [-8.2, 7.45], [-8.2, 10.0], [-15.0, 8.9]],
};

// Openings in the south glass where sliding panels stand open (walk out)
export const OPEN_SLIDERS = [
  { from: -2.4, to: 1.2 }, // living -> pool deck (x range on the south facade)
  { from: 4.3, to: 6.9 }, // dining -> deck
];

export const ENTRY_DOOR = { x0: 2.0, x1: 4.0, y: 10.9 };

export const COURT = { cx: 3.0, cy: 21.5, r: 9.5, planterR: 3.1 };

// Driveway centreline from the court up the inland hill (north / north-east)
export const DRIVE_PTS = [
  [3.0, 21.5], [3.6, 31], [7.5, 42], [16, 53], [28, 61], [42, 68], [58, 78], [70, 92], [78, 110],
];

// Stair from the east terrace down to the lower firepit terrace (z 18 -> 12.65)
export const FIRE_STAIR_PTS = [
  [18.9, -13.2], [20.1, -14.6], [20.6, -16.6], [20.0, -18.8], [18.6, -20.6], [16.9, -21.4],
];

export const FIREPIT = { cx: 13.25, cy: -18.65, r: 4.4, z: 12.65 };
