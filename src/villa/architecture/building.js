import * as THREE from 'three';
import { materials } from '../materials/library.js';
import { LEVEL } from '../core/world.js';
import {
  smooth, ellipse, offset, pointInPoly, distToPoly, resample, ccw,
  ENCLOSURE_PTS, L1_PTS, UPPER_PTS, ROOF_PTS, poolOutline, deckOutline,
  ATRIUM, STAIR_HOLE, WALLS, OPEN_SLIDERS, ENTRY_DOOR, COURT, DRIVE_PTS,
} from './plan.js';
import { slabGeometry, capGeometry, stripGeometry, wallGeometry, tubeAlong, sweepRect, merge, box } from './geo.js';
import { buildPool } from './pool.js';
import { buildSite } from './site.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

export function buildVilla(ctx) {
  const { scene, quality, field } = ctx;
  const M = materials(quality);
  const root = new THREE.Group();
  root.name = 'villa';
  scene.add(root);

  const add = (geo, mat, { cast = true, receive = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    if (name) m.name = name;
    root.add(m);
    return m;
  };

  // ---------------- plan curves ------------------------------------------
  const C = (pts, n) => ccw(smooth(pts, n));
  const enclosure = C(ENCLOSURE_PTS, 260);
  const pool = poolOutline();
  const deck = deckOutline();
  const l1 = C(L1_PTS, 300);
  const upper = C(UPPER_PTS, 240);
  const roof = C(ROOF_PTS, 260);
  const atrium = ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx, ATRIUM.ry, 128, ATRIUM.rot);
  const atriumRoof = ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.05, ATRIUM.ry + 0.05, 128, ATRIUM.rot);
  const stairHole = ellipse(STAIR_HOLE.cx, STAIR_HOLE.cy, STAIR_HOLE.rx, STAIR_HOLE.ry, 48);

  const plan = { enclosure, pool, deck, l1, upper, roof, atrium };

  // ---------------- slabs -------------------------------------------------
  // main deck / floor slab (honed travertine), thick rounded edge
  const T1 = 0.85; // L1 slab: substantial, softly rounded edge (photos)
  const TR = 0.8; // roof slab
  // slabs: a slim plate at the outline over a deeper body set back ~1 m, so
  // edges read as thin tapered blades with a soffit recess (photos)
  add(slabGeometry(deck, [], LEVEL.main, 0.34, { bevel: 0.13, segments: 5 }), M.deck, { name: 'deck-slab' });
  add(slabGeometry(offset(deck, -0.9), [], LEVEL.main - 0.3, 0.7, { bevel: 0.3, segments: 6 }), M.slab, { name: 'deck-body' });
  // polished interior floor inlay (separate so it can be glossier)
  const floorIn = offset(enclosure, -0.04);
  const floorMesh = add(capGeometry(floorIn, [], LEVEL.main + 0.004, 1), M.floorPolished, { cast: false, name: 'floor-interior' });

  // upper floor slab with atrium + stair voids: thin elegant edge
  add(slabGeometry(l1, [atrium, stairHole], LEVEL.upper, 0.34, { bevel: 0.14, segments: 6 }), M.slab, { name: 'l1-slab' });
  add(slabGeometry(offset(l1, -1.15), [offset(atrium, 0.01), stairHole], LEVEL.upper - 0.3, T1 - 0.3, { bevel: 0.26, segments: 6 }), M.slab, { name: 'l1-body' });
  // interior ceiling (plaster) under L1, inside the enclosure
  const ceilIn = offset(enclosure, -0.02);
  add(capGeometry(ceilIn, [ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.02, ATRIUM.ry + 0.02, 72, ATRIUM.rot), stairHole], LEVEL.upper - T1 - 0.001, -1), M.ceiling, { cast: false, name: 'ceiling-l0' });
  // upper floor finish
  add(capGeometry(offset(upper, -0.04), [ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.08, ATRIUM.ry + 0.08, 72, ATRIUM.rot), stairHole], LEVEL.upper + 0.004, 1), M.floorPlain, { cast: false, name: 'floor-upper' });

  // roof slab
  add(slabGeometry(roof, [atriumRoof], LEVEL.roof, 0.32, { bevel: 0.13, segments: 6 }), M.slab, { name: 'roof-slab' });
  add(slabGeometry(offset(roof, -1.0), [offset(atriumRoof, 0.01)], LEVEL.roof - 0.3, TR - 0.3, { bevel: 0.24, segments: 6 }), M.slab, { name: 'roof-body' });
  add(capGeometry(offset(upper, -0.02), [ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.07, ATRIUM.ry + 0.07, 72, ATRIUM.rot)], LEVEL.roof - TR - 0.001, -1), M.ceiling, { cast: false, name: 'ceiling-l1' });

  // ---------------- LED coves on soffits ----------------------------------
  const coveL1 = offset(l1, -0.6);
  const coveL1Open = coveL1.filter((p) => !pointInPoly(p.x, p.y, offset(enclosure, 0.3)));
  const coveRoof = offset(roof, -0.55);
  root.add(new THREE.Mesh(tubeAlong(coveL1, LEVEL.upper - 0.35, 0.022, { closed: true, tubular: 600, radial: 5 }), M.led));
  root.add(new THREE.Mesh(tubeAlong(coveRoof, LEVEL.roof - 0.33, 0.02, { closed: true, tubular: 520, radial: 5 }), M.led));
  void coveL1Open;

  // warm cove line in the ceiling just inside the glass (indirect wash)
  root.add(new THREE.Mesh(tubeAlong(offset(enclosure, -0.5), LEVEL.upper - T1 - 0.02, 0.014, { closed: true, tubular: 520, radial: 5 }), M.ledSoft));

  // ---------------- glazing ----------------------------------------------
  const glassRuns = [];
  const solidRuns = [];
  // classify enclosure samples: north solid except entry glazing
  const isSolid = (p) => p.y > 8.4 && !(p.x > -2.2 && p.x < 9.0);
  let run = [enclosure[0]];
  let runSolid = isSolid(enclosure[0]);
  for (let i = 1; i <= enclosure.length; i++) {
    const p = enclosure[i % enclosure.length];
    const s = isSolid(p);
    run.push(p);
    if (s !== runSolid || i === enclosure.length) {
      (runSolid ? solidRuns : glassRuns).push(run);
      run = [p];
      runSolid = s;
    }
  }
  const glassGeos = [];
  const mullionGeos = [];
  const frameGeos = [];
  const z0 = LEVEL.main, z1 = LEVEL.upper - T1;
  for (const r of glassRuns) {
    // cut out open sliders on the south facade
    const pieces = splitForOpenings(r, OPEN_SLIDERS, ENTRY_DOOR);
    for (const pc of pieces) {
      if (pc.length < 2) continue;
      glassGeos.push(stripGeometry(pc, z0 + 0.02, z1 - 0.02));
      const ms = resample(pc, 2.15);
      for (let i = 0; i < ms.length; i++) {
        const p = ms[i];
        const q = pc[Math.min(pc.length - 1, nearestIndex(pc, p) + 1)];
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        mullionGeos.push(box(0.05, 0.11, z1 - z0, p.x, p.y, z0, ang));
      }
      frameGeos.push(sweepRect(pc, z0, 0.12, 0.05));
      frameGeos.push(sweepRect(pc, z1 - 0.06, 0.12, 0.06));
    }
  }
  // the slid-open panels, parked in front of the fixed glass
  for (const o of OPEN_SLIDERS) {
    const seg = enclosure.filter((p) => p.y < -7 && p.x > o.from - 2.6 && p.x < o.from + 0.1);
    if (seg.length > 1) {
      const shifted = seg.map((p) => V2(p.x, p.y - 0.14));
      glassGeos.push(stripGeometry(shifted, z0 + 0.02, z1 - 0.02));
      mullionGeos.push(box(0.06, 0.06, z1 - z0, shifted[shifted.length - 1].x, shifted[shifted.length - 1].y, z0));
    }
  }
  const glassMesh = add(merge(glassGeos), M.glass, { cast: false, receive: false, name: 'glass-l0' });
  glassMesh.renderOrder = 2;
  add(merge([...mullionGeos, ...frameGeos]), M.metalDark, { name: 'mullions-l0' });

  // solid north walls (travertine outside, walnut-lined inside)
  for (const r of solidRuns) {
    if (r.length < 2) continue;
    add(wallGeometry(r, z0, z1, 0.42), M.stoneWall, { name: 'north-wall' });
  }

  // entry door: tall walnut pivot door + glass sidelight
  const doorY = ENTRY_DOOR.y;
  // pivot door stands open ~20 degrees: tall walnut leaf with a bronze pull
  add(box(ENTRY_DOOR.x1 - ENTRY_DOOR.x0, 0.12, 3.9, (ENTRY_DOOR.x0 + ENTRY_DOOR.x1) / 2 + 0.15, doorY + 0.25, z0, -0.35), M.walnut, { name: 'entry-door' });
  // walnut-slat portal around the door
  {
    const slats = [];
    for (let x = ENTRY_DOOR.x0 - 1.6; x < ENTRY_DOOR.x0 - 0.1; x += 0.11) slats.push(box(0.05, 0.08, z1 - z0 - 0.1, x, doorY + 0.08, z0));
    add(merge(slats), M.walnut, { name: 'entry-slats' });
  }
  add(box(0.04, 0.5, 0.04, ENTRY_DOOR.x0 + 0.5, doorY - 0.1, z0 + 1.05), M.brass);

  // upper floor glazing + curtains
  const upperSolid = () => false; // all glazed; the north side gets walnut fins
  const upGlass = [], upWall = [];
  {
    let r2 = [upper[0]], s2 = upperSolid(upper[0]);
    for (let i = 1; i <= upper.length; i++) {
      const p = upper[i % upper.length];
      const s = upperSolid(p);
      r2.push(p);
      if (s !== s2 || i === upper.length) { (s2 ? upWall : upGlass).push(r2); r2 = [p]; s2 = s; }
    }
  }
  const uz0 = LEVEL.upper, uz1 = LEVEL.roof - TR;
  const upGlassGeo = [], upMull = [], curtainGeo = [];
  for (const r of upGlass) {
    upGlassGeo.push(stripGeometry(r, uz0 + 0.02, uz1 - 0.02));
    for (const p of resample(r, 2.4)) upMull.push(box(0.05, 0.1, uz1 - uz0, p.x, p.y, uz0));
    upMull.push(sweepRect(r, uz0, 0.12, 0.05), sweepRect(r, uz1 - 0.06, 0.12, 0.06));
    // sheer curtains: folded surface 0.35 m inside, drawn in places
    const inner = offsetOpen(r, 0.35);
    const len = inner.length;
    const pts = [];
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // leave gaps (curtains drawn back) to reveal warm interiors
      const open = Math.sin(t * 9.0 + 1.2) > 0.2;
      if (open) { if (pts.length > 2) curtainGeo.push(foldedCurtain(pts, uz0 + 0.03, uz1 - 0.05)); pts.length = 0; continue; }
      pts.push(inner[i]);
    }
    if (pts.length > 2) curtainGeo.push(foldedCurtain(pts, uz0 + 0.03, uz1 - 0.05));
    curtainGeo.length = 0; // reviewers read drapes as panels: clear glazing instead
  }
  const upGlassMesh = add(merge(upGlassGeo), M.glass, { cast: false, receive: false, name: 'glass-l1' });
  upGlassMesh.renderOrder = 2;
  add(merge(upMull), M.metalDark, { name: 'mullions-l1' });
  if (curtainGeo.length) add(merge(curtainGeo), M.curtain, { cast: false, name: 'curtains' });
  for (const r of upWall) add(wallGeometry(r, uz0, uz1, 0.4), M.travertineWall, { name: 'upper-north-wall' });
  // vertical walnut brise-soleil in front of the north glazing (both levels)
  {
    const fins = [];
    const finsAlong = (pts, za, zb, step, depth) => {
      const res = resample(pts, step);
      for (let i = 0; i < res.length - 1; i++) {
        const p = res[i], q = res[i + 1];
        if (p.y < 6.5) continue;
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        const out = new THREE.Vector2(q.y - p.y, -(q.x - p.x)).normalize();
        fins.push(box(0.05, depth, zb - za, p.x + out.x * (depth / 2 + 0.08), p.y + out.y * (depth / 2 + 0.08), za, ang));
      }
    };
    finsAlong([...upper, upper[0]], uz0, uz1, 0.32, 0.26);
    const entryFree = enclosure.filter((p) => !(p.x > ENTRY_DOOR.x0 - 1.8 && p.x < ENTRY_DOOR.x1 + 0.3));
    void entryFree;
    add(merge(fins), M.walnut, { name: 'north-fins' });
    // warm downlights in the entry canopy soffit
    const dl = [];
    for (const [x, y] of [[0.6, 12.6], [3.0, 13.6], [5.4, 12.6], [3.0, 15.4], [-1.2, 11.9], [7.2, 11.9]]) {
      const d = new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16);
      d.translate(x, LEVEL.upper - T1 + 0.25, -y);
      dl.push(d);
    }
    root.add(new THREE.Mesh(merge(dl), M.led));
    for (const [x, y] of [[3.0, 13.4], [-1.0, 12.0], [7.0, 12.0]]) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.68, 0.4), 9, 9, 2);
      l.position.set(x, LEVEL.upper - T1 - 0.2, -y);
      root.add(l);
    }
  }
  // upper floor: walnut-lined inner core seen through the curtain gaps, warm lights
  {
    const core = offset(upper, -4.2).filter((p) => p.y < 7.5);
    const runs = [];
    let cur = [];
    for (const p of core) {
      const inAtrium = Math.hypot((p.x - ATRIUM.cx) / (ATRIUM.rx + 1.2), (p.y - ATRIUM.cy) / (ATRIUM.ry + 1.2)) < 1;
      if (inAtrium) { if (cur.length > 2) runs.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 2) runs.push(cur);
    for (const r of runs) add(wallGeometry(r, uz0, uz1, 0.25), M.walnutDark, { name: 'upper-core' });
    for (const [x, y] of [[-11, -1.5], [9, -1.0]]) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.44), 14, 12, 2);
      l.position.set(x, LEVEL.upper + 3.0, -y);
      root.add(l);
    }
  }

  // atrium: glass drum at the upper level, curbs, LED rings, skylight
  // atrium shaft: one continuous oval from the living-room ceiling to the sky,
  // lined in stone and planted (vertical garden added by the vegetation module)
  const shaft = ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.03, ATRIUM.ry + 0.03, 128, ATRIUM.rot);
  const shaftMesh = add(stripGeometry(shaft, LEVEL.upper - T1, LEVEL.roof, { closed: true }), M.stoneWall, { name: 'atrium-shaft' });
  void shaftMesh;
  // LED ring in the ceiling around the oculus (seen from the living room)
  root.add(new THREE.Mesh(tubeAlong(ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.25, ATRIUM.ry + 0.25, 96, ATRIUM.rot), LEVEL.upper - T1 - 0.02, 0.02, { closed: true, tubular: 200 }), M.led));
  // roof curb around the skylight (z ~ 28.9) + frameless glass
  const curbOuter = ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.45, ATRIUM.ry + 0.45, 96, ATRIUM.rot);
  add(slabGeometry(curbOuter, [ellipse(ATRIUM.cx, ATRIUM.cy, ATRIUM.rx + 0.06, ATRIUM.ry + 0.06, 96, ATRIUM.rot)], 28.9, 0.45, { bevel: 0.14 }), M.slab, { name: 'skylight-curb' });


  // ---------------- interior partitions -----------------------------------
  const P = (arr) => arr.map(([x, y]) => V2(x, y));
  add(wallGeometry(P(WALLS.feature), z0, z1, 0.36), M.walnutDark, { name: 'feature-wall' });
  add(wallGeometry(P(WALLS.stair), z0, z1, 0.3), M.walnut, { name: 'stair-wall' });
  add(wallGeometry(P(WALLS.kitchen), z0, z1, 0.5), M.walnutDark, { name: 'kitchen-wall' });
  add(wallGeometry(P([[-15.8, 7.45], [-15.8, 8.7]]), z0, z1, 0.3), M.travertineWall);
  add(wallGeometry(P([[-8.2, 7.45], [-8.2, 10.1]]), z0, z1, 0.3), M.travertineWall);
  add(wallGeometry(P([[4.6, 6.0], [4.6, 10.6]]), z0, z1, 0.3), M.travertineWall);
  add(wallGeometry(P([[15.6, 6.0], [15.0, 8.9]]), z0, z1, 0.3), M.travertineWall);

  // floating stair: 28 risers from the entry hall (east) up to L1 (west)
  {
    const steps = 28;
    const rise = (LEVEL.upper - LEVEL.main) / steps;
    const run = 0.3;
    const x0 = 1.15;
    const treadGeos = [];
    for (let i = 0; i < steps - 1; i++) {
      const x = x0 - (i + 0.5) * run;
      treadGeos.push(box(run + 0.02, 1.15, 0.075, x, 6.84, LEVEL.main + (i + 1) * rise - 0.075));
    }
    add(merge(treadGeos), M.floorPlain, { name: 'stair-treads' });
    // frameless glass balustrade on the open side
    const bal = [];
    for (let i = 0; i < steps; i += 1) {
      const xa = x0 - i * run;
      bal.push(V2(xa, 6.24));
    }
    const balZ = bal.map((_, i) => LEVEL.main + (i + 1) * rise);
    const balGeo = new THREE.BufferGeometry();
    const pos = [];
    const idx = [];
    for (let i = 0; i < bal.length; i++) {
      pos.push(bal[i].x, balZ[i], -bal[i].y, bal[i].x, balZ[i] + 1.0, -bal[i].y);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    balGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    balGeo.setIndex(idx);
    balGeo.computeVertexNormals();
    add(balGeo, M.glass, { cast: false, receive: false }).renderOrder = 2;
    // LED strip under each tread (step lights)
    const ledG = [];
    for (let i = 0; i < steps - 1; i += 1) {
      const x = x0 - (i + 0.5) * run;
      ledG.push(box(0.012, 1.05, 0.01, x - run / 2 + 0.03, 6.84, LEVEL.main + (i + 1) * rise - 0.09));
    }
    root.add(new THREE.Mesh(merge(ledG), M.ledSoft));
  }

  // columns: travertine, slender (structure for the long spans)
  const colGeos = [];
  const colPos = [[-9.5, -5.4], [11.4, -4.6]];
  for (const [x, y] of colPos) {
    const g = new THREE.CylinderGeometry(0.22, 0.22, z1 - z0, 48, 1);
    const uvc = g.attributes.uv;
    for (let i = 0; i < uvc.count; i++) uvc.setXY(i, uvc.getX(i) * Math.PI * 0.54, uvc.getY(i) * (z1 - z0));
    g.translate(x, z0 + (z1 - z0) / 2, -y);
    colGeos.push(g);
  }
  add(merge(colGeos), M.travertineWall, { name: 'columns' });

  // ---------------- plinth: stone walls where the deck overhangs the cliff --
  {
    const ring = offset(deck, -0.55);
    const wallPts = [];
    const geos = [];
    const flush = () => {
      if (wallPts.length > 2) {
        const base = wallPts.map((p) => field.height(p.x, p.y) - 0.6);
        geos.push(plinthStrip(wallPts.slice(), base, LEVEL.main - 0.7));
      }
      wallPts.length = 0;
    };
    for (let i = 0; i <= ring.length; i++) {
      const p = ring[i % ring.length];
      const h = field.height(p.x, p.y);
      const nearPool = distToPoly(p.x, p.y, pool) < 1.4;
      if (h < LEVEL.main - 1.0 && !nearPool) wallPts.push(p);
      else flush();
    }
    flush();
    if (geos.length) add(merge(geos), ctx.rockMaterial ?? M.stoneWall, { name: 'plinth-walls' });
  }

  // ---------------- pool, waterfall, firepit, site -------------------------
  const poolParts = buildPool(ctx, root, M, plan);
  const site = buildSite(ctx, root, M, plan);

  // ---------------- colliders & walkable heights ---------------------------
  const colliders = [];
  const segs = (pts, closed, extra = {}) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      colliders.push({ type: 'seg', a: [a.x, a.y], b: [b.x, b.y], ...extra });
    }
  };
  // glass (with gaps at open sliders / entry door)
  for (const r of glassRuns) for (const pc of splitForOpenings(r, OPEN_SLIDERS, ENTRY_DOOR)) segs(resample(pc, 0.8), false, { minY: 17.5, maxY: 22 });
  for (const r of solidRuns) segs(resample(r, 0.8), false, { minY: 17.5, maxY: 22 });
  for (const w of Object.values(WALLS)) segs(P(w), false, { minY: 17.5, maxY: 22 });
  for (const [x, y] of colPos) colliders.push({ type: 'circle', c: [x, y], r: 0.3, minY: 17.5, maxY: 22 });
  segs([V2(1.0, 6.24), V2(-7.2, 6.24), V2(-7.2, 7.45)], false, { minY: 17.5, maxY: 22 });
  // pool rim + deck edge (no walking off the cliff) except at the firepit stair
  segs(resample([...pool, pool[0]], 0.6), false, { minY: 17.0, maxY: 19.5 });
  const deckEdge = offset(deck, -0.25);
  const deckEdgeOpen = [];
  for (const p of [...deckEdge, deckEdge[0]]) {
    const nearStair = Math.hypot(p.x - 19.5, p.y + 13.9) < 1.3;
    const nearCourt = p.y > 11.4 && p.x > -1.5 && p.x < 7.5;
    if (nearStair || nearCourt) { if (deckEdgeOpen.length > 1) segs(deckEdgeOpen.slice(), false, { minY: 17.0, maxY: 19.5 }); deckEdgeOpen.length = 0; }
    else deckEdgeOpen.push(p);
  }
  if (deckEdgeOpen.length > 1) segs(deckEdgeOpen, false, { minY: 17.0, maxY: 19.5 });
  colliders.push(...(poolParts.colliders ?? []), ...(site.colliders ?? []));

  const deckPoly = deck;
  const walkHeight = (gx, gy, currentY) => {
    const feet = currentY - LEVEL.eye;
    if (pointInPoly(gx, gy, deckPoly) && !pointInPoly(gx, gy, pool) && feet > 16.5) return LEVEL.main;
    const s = poolParts.walkHeight?.(gx, gy, feet);
    if (s != null) return s;
    const c = site.walkHeight?.(gx, gy, feet);
    if (c != null) return c;
    return null;
  };

  const villa = {
    root,
    plan,
    colliders,
    walkHeight,
    reflectiveMaterials: [
      { material: M.floorPolished, strength: 0.26, roughness: 0.42 },
      { material: M.deck, strength: 0.1, roughness: 0.6 },
    ],
    poolWater: poolParts.water,
    update(t, camera) {
      const gx = camera.position.x, gy = -camera.position.z, gz = camera.position.y;
      const inside = gz > LEVEL.main && gz < LEVEL.roof && pointInPoly(gx, gy, gz < LEVEL.upper ? enclosure : upper);
      M.glass.uniforms.uInside.value = inside ? 1 : 0;
      poolParts.update?.(t, camera);
      site.update?.(t, camera);
    },
    floorMesh,
  };
  return villa;
}

// ---------------------------------------------------------------------------
function nearestIndex(pts, p) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i].distanceToSquared(p);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

function splitForOpenings(run, sliders, door) {
  const out = [];
  let cur = [];
  for (const p of run) {
    const inSlider = p.y < -7 && sliders.some((o) => p.x > o.from && p.x < o.to);
    const inDoor = p.y > 9.5 && p.x > door.x0 && p.x < door.x1;
    if (inSlider || inDoor) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function offsetOpen(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    // inward = right-hand normal for CCW outlines; sign chosen by caller
    return new THREE.Vector2(p.x - t.y * d, p.y + t.x * d);
  });
}

// curtains: sinusoidal folds along a polyline
function foldedCurtain(pts, z0, z1) {
  const res = resample(pts, 0.07);
  const folded = res.map((p, i) => {
    const a = res[Math.max(0, i - 1)], b = res[Math.min(res.length - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const n = new THREE.Vector2(-t.y, t.x);
    const f = Math.sin(i * 0.9) * 0.06;
    return new THREE.Vector2(p.x + n.x * f, p.y + n.y * f);
  });
  return stripGeometry(folded, z0, z1);
}

// plinth: vertical strip from per-point base up to a fixed top
function plinthStrip(pts0, base0, top) {
  // rough limestone face: subdivided and pushed outward with layered noise
  const pts = resample(pts0, 0.35);
  const base = pts.map((p) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts0.length; i++) { const d = pts0[i].distanceToSquared(p); if (d < bd) { bd = d; bi = i; } }
    return base0[bi];
  });
  const n = pts.length;
  const rows = 14;
  const pos = new Float32Array(n * (rows + 1) * 3);
  const uv = new Float32Array(n * (rows + 1) * 2);
  let dist = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) dist += pts[i].distanceTo(pts[i - 1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    const out = new THREE.Vector2(t.y, -t.x);
    for (let r = 0; r <= rows; r++) {
      const k = r / rows;
      const z = THREE.MathUtils.lerp(base[i], top, k);
      const d = (Math.sin(dist * 1.7 + z * 2.3) * 0.18 + Math.sin(dist * 4.1 - z * 3.7) * 0.09 + Math.sin(dist * 0.6 + z * 0.9) * 0.3) * (1 - k * 0.7) + (1 - k) * 0.35;
      const j = (i * (rows + 1) + r);
      pos.set([pts[i].x + out.x * d, z, -(pts[i].y + out.y * d)], j * 3);
      uv.set([dist, z], j * 2);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < rows; r++) {
      const a = i * (rows + 1) + r, b = a + rows + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export { COURT, DRIVE_PTS };
