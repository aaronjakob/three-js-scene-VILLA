import * as THREE from 'three';
import { LEVEL } from '../core/world.js';
import { ellipse, smooth, resample, COURT, DRIVE_PTS } from './plan.js';
import { slabGeometry, capGeometry, stripGeometry, merge, box, tubeAlong } from './geo.js';
import { roundedSweep } from './pool.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

// Entry court + ring planter, driveway, garden stair, terrace furniture.
export function buildSite(ctx, root, M) {
  const { field } = ctx;
  const add = (geo, mat, { cast = true, receive = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    if (name) m.name = name;
    root.add(m);
    return m;
  };

  // --- entry court: cobble fan paving, flush with the floor -----------------
  const court = ellipse(COURT.cx, COURT.cy, COURT.r, COURT.r, 128);
  const planterOuter = ellipse(COURT.cx, COURT.cy, COURT.planterR, COURT.planterR, 96);
  const courtGeo = capGeometry(court, [planterOuter], 18.02, 1);
  // world-planar uvs in metres
  setPlanarUV(courtGeo);
  add(courtGeo, M.cobbles, { cast: false, name: 'entry-court' });
  // court edge curb with a recessed LED line
  add(roundedSweep(court, 17.9, 0.32, 0.22), M.travertineWall, { name: 'court-curb' });

  // ring planter: stone ring, LED under the lip, soil
  add(slabGeometry(planterOuter, [ellipse(COURT.cx, COURT.cy, COURT.planterR - 0.32, COURT.planterR - 0.32, 96)], 18.5, 0.5, { bevel: 0.1 }), M.travertineWall, { name: 'planter-ring' });
  root.add(new THREE.Mesh(tubeAlong(ellipse(COURT.cx, COURT.cy, COURT.planterR + 0.03, COURT.planterR + 0.03, 96), 18.06, 0.018, { closed: true, tubular: 200 }), M.led));
  add(capGeometry(ellipse(COURT.cx, COURT.cy, COURT.planterR - 0.3, COURT.planterR - 0.3, 64), [], 18.38, 1), M.soil, { cast: false, name: 'planter-soil' });

  // --- driveway ribbon following the graded terrain ------------------------
  {
    const path = smooth(DRIVE_PTS, 160, false);
    const pts = resample(path, 1.0);
    const W = 5.6;
    const pos = [], uv = [], idx = [];
    const start = 6; // begins at the court edge
    let row = 0;
    for (let i = start; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const t = new THREE.Vector2().subVectors(b, a).normalize();
      const nrm = new THREE.Vector2(-t.y, t.x);
      for (const s of [-1, -0.5, 0, 0.5, 1]) {
        const x = pts[i].x + nrm.x * (W / 2) * s, y = pts[i].y + nrm.y * (W / 2) * s;
        const h = field.height(x, y) + 0.06;
        pos.push(x, h, -y);
        uv.push(x, y);
      }
      if (row > 0) {
        const r0 = (row - 1) * 5, r1 = row * 5;
        for (let k = 0; k < 4; k++) idx.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // ensure facing up
    if (g.attributes.normal.getY(0) < 0) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i += 3) { const tmp = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = tmp; }
      g.computeVertexNormals();
    }
    add(g, M.cobbles, { cast: false, name: 'driveway' });
  }

  // --- terrace furniture -----------------------------------------------------
  const lounger = (x, y, ang) => {
    const geos = [];
    const frame = new RoundedBoxGeometry(0.78, 0.18, 2.0, 3, 0.04);
    frame.translate(0, 0.24, 0);
    geos.push(frame);
    for (const lx of [-0.32, 0.32]) for (const lz of [-0.85, 0.85]) {
      const leg = new THREE.BoxGeometry(0.06, 0.2, 0.06);
      leg.translate(lx, 0.1, lz);
      geos.push(leg);
    }
    const g = merge(geos);
    g.rotateY(ang);
    g.translate(x, LEVEL.main, -y);
    add(g, M.walnut, { name: 'lounger-frame' });
    const c1 = new RoundedBoxGeometry(0.72, 0.1, 1.35, 4, 0.045);
    c1.translate(0, 0.38, 0.28);
    const c2 = new RoundedBoxGeometry(0.72, 0.1, 0.68, 4, 0.045);
    c2.rotateX(-0.75);
    c2.translate(0, 0.56, -0.62);
    const pillow = new RoundedBoxGeometry(0.5, 0.12, 0.28, 4, 0.05);
    pillow.rotateX(-0.75);
    pillow.translate(0, 0.72, -0.72);
    const cg = merge([c1, c2, pillow]);
    cg.rotateY(ang);
    cg.translate(x, LEVEL.main, -y);
    add(cg, M.linen, { name: 'lounger-cushion' });
  };
  // east terrace loungers facing south-east (toward the sea / sun)
  const ang = Math.atan2(-0.55, 0.83);
  lounger(13.2, -10.2, ang + Math.PI);
  lounger(14.5, -11.2, ang + Math.PI);
  lounger(15.8, -12.2, ang + Math.PI);
  // low side tables
  const tables = [];
  for (const [x, y] of [[13.85, -10.8], [15.15, -11.8]]) {
    const t = new THREE.CylinderGeometry(0.22, 0.2, 0.42, 32);
    t.translate(x, LEVEL.main + 0.21, -y);
    tables.push(t);
  }
  add(merge(tables), M.travertineWall);

  // west terrace: low curved outdoor sofa looking south-west
  {
    const arc = [];
    for (let i = 0; i <= 40; i++) {
      const a = THREE.MathUtils.degToRad(40 + i * 2.6);
      arc.push(V2(-17.0 + Math.cos(a) * 2.6, -4.4 + Math.sin(a) * 2.6));
    }
    add(roundedSweep(arc, LEVEL.main, 0.92, 0.38, 0), M.travertineWall, { name: 'west-sofa-base' });
    add(roundedSweep(arc, LEVEL.main + 0.38, 0.86, 0.15), M.linen, { name: 'west-sofa-seat' });
    const back = arc.map((p) => V2(-17.0 + (p.x + 17.0) * 1.14, -4.4 + (p.y + 4.4) * 1.14));
    add(roundedSweep(back, LEVEL.main + 0.38, 0.24, 0.48), M.linen, { name: 'west-sofa-back' });
    const t = new THREE.CylinderGeometry(0.55, 0.55, 0.32, 48);
    t.translate(-17.6, LEVEL.main + 0.16, 5.6);
    add(t, M.darkStone);
  }

  // --- garden stair beside the entry (rock wall + LED steps), photo 09 ------
  {
    const steps = 12;
    const geos = [], leds = [];
    for (let i = 0; i < steps; i++) {
      const x = -7.5 - i * 0.05;
      const y = 15.0 + i * 0.38;
      const z = 18.0 + i * 0.16;
      const w = 2.4 - i * 0.04;
      geos.push(box(w, 0.42, 0.16 + 0.4, x, y, z - 0.4, 0.15));
      leds.push(box(w - 0.1, 0.02, 0.012, x, y - 0.2, z + 0.13, 0.15));
    }
    add(merge(geos), M.travertineWall, { name: 'garden-stair' });
    root.add(new THREE.Mesh(merge(leds), M.ledSoft));
  }

  const colliders = [];
  // planter ring
  colliders.push({ type: 'circle', c: [COURT.cx, COURT.cy], r: COURT.planterR, minY: 17, maxY: 20 });

  const walkHeight = (gx, gy) => {
    const d = Math.hypot(gx - COURT.cx, gy - COURT.cy);
    if (d < COURT.r) return 18.02;
    return null;
  };

  return {
    colliders,
    walkHeight,
    entryTree: [COURT.cx, COURT.cy, 18.38],
  };
}

function setPlanarUV(geo) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
  uv.needsUpdate = true;
}

export { stripGeometry };
