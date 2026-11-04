import * as THREE from 'three';
import { LEVEL } from '../core/world.js';
import { ANCHORS } from '../core/anchors.js';
import { mulberry32 } from '../core/noise.js';
import { interiorMaterials } from './materials.js';
import { Batch, BakeLights } from './bake.js';
import { place, facing, at, softBox, rbox, box, panel, lathe, latheCap, cyl, loft, flipFaces, swapUV, tint } from './geom.js';
import * as D from './decor.js';
import { oliveTree } from './olive.js';

// Interior furnishing: living (L-sofa, marble drums), workspace (walnut desk,
// three monitors, styled shelving), dining (calacatta table, 8 tub chairs),
// kitchen (walnut tall units, nero island), entry, and the upper floor rooms
// seen through the glazing. Warm 2700 K layered light: a few real point lights
// for the architecture, plus baked lamp pools / LED washes on the furniture
// (see bake.js) and additive light pools on the floor.

const Z = LEVEL.main;
const U = LEVEL.upper;
const WARM = [1.0, 0.66, 0.38]; // 2700 K in linear rgb (normalised)
const LED = [1.0, 0.62, 0.32];

export function buildInterior(ctx) {
  const { scene, quality } = ctx;
  const T0 = performance.now();
  const tm = {};
  const lap = (k) => { tm[k] = Math.round(performance.now() - T0); };
  const M = interiorMaterials();
  lap('materials');
  const root = new THREE.Group();
  root.name = 'interior';
  scene.add(root);
  const B = new Batch();
  const bake = new BakeLights();
  const real = [];
  const pools = [];
  let zone = 'living';
  const put = (mat, g, x, y, z, rot = 0) => B.push(mat, place(g, x, y, z, rot), zone);
  const putParts = (parts, x, y, z, rot = 0) => { for (const [m, g] of parts) put(m, g, x, y, z, rot); };
  // local (lx, lz) offset rotated into plan coordinates
  const rel = (x, y, rot, lx, lz) => [x + Math.cos(rot) * lx + Math.sin(rot) * lz, y + Math.sin(rot) * lx - Math.cos(rot) * lz];
  const pool = (x, y, z, r, intensity, surface = 'floor') => pools.push({ x, y, z, r, intensity, surface });

  // =========================== LIVING (south-west) =============================
  {
    zone = 'living';
    const rng = mulberry32(101);
    const [ax, ay] = ANCHORS.living; // -6, -3
    // rug with border, under the sofa front legs and both drums
    put(M.rugLiving, rugGeo(5.6, 4.2), ax - 0.55, ay - 0.6, Z + 0.007, 0);

    // ---- L-sofa: long run (back to the glass, faces north) + return (back west, faces east)
    const sofaParts = (len, depth, o) => sofaRun(len, depth, o, M, rng);
    const longX = ax - 1.65, longY = ay - 2.15; // centre (-7.65, -5.15)
    putParts(sofaParts(4.6, 1.1, { armL: true, n: 4, seatFrom: -2.3, seatTo: 2.1, backTo: 2.3, backCushTo: 2.1 }), longX, longY, Z, Math.PI);
    const retX = ax - 3.4, retY = ay - 0.25; // centre (-9.4, -3.25)
    putParts(sofaParts(2.7, 1.1, { armR: true, n: 2, seatFrom: -1.35, seatTo: 1.35, backFrom: -2.45, backCushFrom: -2.23 }), retX, retY, Z, Math.PI / 2);
    // scatter cushions leaning on the backs
    const cushions = [
      [M.linenCocoa, -9.15, -5.0, 0.55, Math.PI + 0.55, false],
      [M.velvetRust, -8.5, -5.03, 0.5, Math.PI + 0.12, false],
      [M.linenSand, -6.45, -5.02, 0.5, Math.PI - 0.05, true],
      [M.linenCharcoal, -5.75, -5.0, 0.48, Math.PI - 0.15, false],
      [M.linenCocoa, -9.3, -4.25, 0.5, Math.PI / 2 + 0.1, false],
      [M.velvetOlive, -9.32, -2.85, 0.48, Math.PI / 2 - 0.12, false],
    ];
    for (const [mat, x, y, s, rot, lumbar] of cushions) {
      const parts = D.scatterCushion(rng, mat, s, 0.17, lumbar);
      for (const [, g] of parts) { g.rotateX(-0.38); }
      putParts(parts, x, y, Z + 0.49 + (lumbar ? s * 0.18 : s * 0.42), rot);
    }
    // throw over the return seat front
    {
      const parts = D.drapedThrow(M.herringbone, { w: 0.95, onSeat: 0.5, hang: 0.3, seatY: 0.475, edgeR: 0.07, seed: 4 });
      putParts(parts, -9.08, -3.75, Z, Math.PI / 2 + 0.06);
    }

    // ---- two dark marble drums (veined), large low + small high
    put(M.nero, latheCap([[0, 0], [0.585, 0], [0.6, 0.012], [0.6, 0.322], [0.594, 0.334], [0.58, 0.34], [0, 0.34]], 96), ax - 0.45, ay - 0.05, Z, 0.4);
    put(M.nero, latheCap([[0, 0], [0.4, 0], [0.415, 0.012], [0.415, 0.432], [0.41, 0.442], [0.398, 0.448], [0, 0.448]], 80), ax + 0.62, ay - 0.62, Z, 2.1);
    // dressing: books + opal globe lamp, olive branch vase, bowl, candles
    {
      const st = D.bookStack(rng, M, 3, true);
      putParts(st.parts, ax - 0.68, ay + 0.12, Z + 0.34, 0.35);
      const gl = D.globeLamp(M, 0.1);
      putParts(gl.parts, ax - 0.7, ay + 0.1, Z + 0.34 + st.h, 0);
      bake.add(ax - 0.7, ay + 0.1, Z + 0.34 + st.h + gl.lampY, WARM, 0.35, 2.2, { minD: 0.25 });
      pool(ax - 0.7, ay + 0.1, Z + 0.34, 0.9, 0.5, 'none');
      putParts(D.vessel('moon', M, M.glazeCharcoal, 0.85, { seed: 11 }), ax - 0.2, ay - 0.3, Z + 0.34);
      putParts(D.branches(rng, M, 0.5, 0.3), ax - 0.2, ay - 0.3, Z + 0.34 + 0.24);
      putParts(D.vessel('shallow', M, M.glazeBone, 0.85, { seed: 12 }), ax + 0.62, ay - 0.62, Z + 0.448);
      putParts(D.candleGroup(rng, M, true), ax - 0.2, ay + 0.33, Z + 0.34, 0.6);
      bake.add(ax - 0.2, ay + 0.33, Z + 0.34 + 0.2, [1.0, 0.6, 0.3], 0.12, 0.9, { minD: 0.08 });
      const st2 = D.bookStack(rng, M, 2, false);
      putParts(st2.parts, ax + 0.5, ay - 0.35, Z + 0.448, -0.5);
    }

    // ---- poufs (boucle, square, plump) and a lounge armchair
    put(M.boucleOat, at(softBox(0.86, 0.42, 0.86, { r: 0.1, crown: 0.025, belly: 0.015, seam: 'crease', seamDepth: 0.006, wrinkle: 0.0025, seed: 31 }), 0, 0.21, 0), ax + 1.75, ay + 0.75, Z, 0.25);
    put(M.boucle, at(softBox(0.7, 0.38, 0.7, { r: 0.09, crown: 0.02, belly: 0.012, seam: 'crease', seamDepth: 0.005, seed: 32 }), 0, 0.19, 0), ax - 1.9, ay + 1.45, Z, -0.18);
    putParts(D.foldedThrow(M.linenTaupe, 0.5, 0.36, 3), ax + 1.75, ay + 0.75, Z + 0.44, 0.6);
    {
      const rot = facing(-1, -0.15);
      putParts(tubChair(M, { R: 0.46, A: 2.15, seatH: 0.42, backH: 0.74, armH: 0.6, thick: 0.13, legH: 0.06, mat: M.boucleOat, legMat: M.walnutDeep, plinth: true }), ax + 2.25, ay - 0.55, Z, rot);
      putParts(D.scatterCushion(rng, M.linenCocoa, 0.42, 0.14, true).map(([m, g]) => [m, g.rotateX(-0.35).translate(0, 0.62, -0.2)]), ax + 2.25, ay - 0.55, Z, rot);
    }
    // side table + table lamp at the long run's east end
    {
      const sx = -5.0, sy = -5.25;
      put(M.travertineDark, latheCap([[0, 0], [0.2, 0], [0.16, 0.08], [0.13, 0.42], [0.25, 0.5], [0.25, 0.53], [0, 0.53]], 48), sx, sy, Z);
      const lamp = D.tableLamp(M, { h: 0.6, shadeR: 0.18, mat: M.glazeRust });
      putParts(lamp.parts, sx, sy, Z + 0.53);
      bake.add(sx, sy, Z + 0.53 + lamp.lampY - 0.05, WARM, 0.8, 3.2, { minD: 0.25 });
      bake.add(sx, sy, Z + 0.53 + lamp.lampY + 0.1, WARM, 0.3, 2.5, { minD: 0.25 });
      pool(sx, sy, Z, 1.25, 0.32);
      real.push([sx, sy, Z + 1.25, 2.2, 5.5]);
      const st = D.bookStack(rng, M, 2, false);
      putParts(st.parts, sx + 0.08, sy - 0.12, Z + 0.53, 1.1);
    }
    // floor lamp behind the return's north end (linen drum shade)
    {
      const fx = -10.25, fy = -1.75;
      const fl = D.floorLamp(M, { h: 1.6, shadeR: 0.24 });
      putParts(fl.parts, fx, fy, Z);
      bake.add(fx, fy, Z + fl.lampY - 0.08, WARM, 1.0, 3.6, { minD: 0.25, dir: [0, 0, -1], cosIn: 0.2, cosOut: -0.4 });
      pool(fx, fy, Z, 1.5, 0.35);
      real.push([fx, fy, Z + fl.lampY, 3.0, 6.5]);
    }
    // indoor olive tree in a stone planter by the south-west glass
    putParts(oliveTree(M, { seed: 23, height: 3.1 }), -8.25, -7.25, Z, 0.4);
    // sculpture on a plinth between living and the open slider
    putParts(D.plinth(M, 0.38, 0.95, M.plaster), -1.25, -4.0, Z, 0.3);
    putParts(D.sculpture('ring', M), -1.25, -4.0, Z + 0.95, 0.3);
    bake.add(-1.25, -4.0, Z + 2.6, WARM, 0.5, 2.2, { dir: [0, 0, -1], cosIn: 0.92, cosOut: 0.8 });
    // general living fill (real light) - soft, high
    real.push([ax - 0.8, ay - 0.6, Z + 3.1, 16, 13]);
  }

  lap('living');
  // =========================== WORKSPACE (north-west) ============================
  {
    zone = 'work';
    const rng = mulberry32(202);
    const [wx, wy] = ANCHORS.workspace; // -11.7, 2.4
    const deskL = 4.2, deskD = 0.86, deskH = 0.74, topT = 0.036;
    // slim walnut top, grain along the length
    put(M.walnutDesk, swapUV(rbox(deskL, topT, deskD, 0.005, 2)), wx, wy, Z + deskH - topT / 2);
    // drawer pedestal (east end): carcass + three fronts with reveals + bronze pulls
    {
      const pw = 0.56, ph = deskH - topT, px = wx + deskL / 2 - pw / 2 - 0.04;
      put(M.walnutDeep, at(rbox(pw, ph - 0.01, deskD - 0.08, 0.004, 1), 0, (ph - 0.01) / 2, 0), px, wy, Z);
      const fronts = [0.17, 0.2, 0.31];
      let zz = 0.02;
      for (const fh of fronts) {
        put(M.walnutDesk, swapUV(at(rbox(pw - 0.006, fh - 0.004, 0.02, 0.003, 1), 0, fh / 2, 0)), px, wy + deskD / 2 - 0.05, Z + zz, Math.PI);
        put(M.bronze, at(rbox(0.16, 0.012, 0.012, 0.003, 1), 0, 0, 0), px, wy + deskD / 2 - 0.035, Z + zz + fh - 0.03, 0);
        zz += fh;
      }
    }
    // black steel sled leg (west end)
    {
      const lx = wx - deskL / 2 + 0.12;
      for (const dy of [-deskD / 2 + 0.06, deskD / 2 - 0.06]) put(M.blackSteel, at(box(0.04, deskH - topT, 0.02), 0, (deskH - topT) / 2, 0), lx, wy + dy, Z);
      put(M.blackSteel, at(box(0.04, 0.02, deskD - 0.1), 0, 0.01, 0), lx, wy, Z);
      put(M.blackSteel, at(box(0.04, 0.02, deskD - 0.1), 0, deskH - topT - 0.03, 0), lx, wy, Z);
    }
    // three 27" monitors on the south edge, screens facing north (to the chair)
    const scr = [M.screen2, M.screen1, M.screen3];
    [-0.66, 0, 0.66].forEach((dx, i) => {
      const rot = Math.PI + [-0.3, 0, 0.3][i];
      const [px, py] = [wx + dx, wy - 0.24 + Math.abs(dx) * 0.12];
      const parts = monitor(M, scr[i]);
      putParts(parts, px, py, Z + deskH, rot);
    });
    // desk dressing
    put(M.aluminium, at(rbox(0.42, 0.012, 0.13, 0.004, 1), 0, 0.006, 0), wx, wy + 0.16, Z + deskH);
    put(M.blackSteel, at(rbox(0.4, 0.004, 0.11, 0.002, 1), 0, 0.013, 0), wx, wy + 0.16, Z + deskH);
    put(M.aluminium, at(softBox(0.06, 0.025, 0.11, { r: 0.012, seam: null, wrinkle: 0, step: 0.02, k: 3 }), 0, 0.012, 0), wx + 0.36, wy + 0.17, Z + deskH);
    put(M.leatherEspresso, at(rbox(0.8, 0.003, 0.36, 0.002, 1), 0, 0.0015, 0), wx + 0.05, wy + 0.12, Z + deskH);
    putParts(D.book(0.15, 0.012, 0.21, [0.18, 0.17, 0.16], M, { title: false }), wx - 0.5, wy + 0.18, Z + deskH, 0.25);
    put(M.brass, at(cyl(0.004, 0.004, 0.14, 8), 0, 0, 0).rotateZ(Math.PI / 2).translate(0, 0.016, 0), wx - 0.47, wy + 0.1, Z + deskH + 0.004, 0.4);
    putParts(D.vessel('cylinder', M, M.glazeWhite, 0.38, { seed: 41 }), wx + 0.62, wy + 0.22, Z + deskH);
    putParts(D.vessel('pebble', M, M.glazeCeladon, 0.6, { seed: 42 }), wx - 1.35, wy - 0.1, Z + deskH);
    {
      const st = D.bookStack(rng, M, 3, false);
      putParts(st.parts, wx + 1.3, wy - 0.15, Z + deskH, -0.2);
    }
    {
      const gl = D.globeLamp(M, 0.11);
      putParts(gl.parts, wx - 1.78, wy - 0.18, Z + deskH);
      bake.add(wx - 1.78, wy - 0.18, Z + deskH + gl.lampY, WARM, 0.4, 2.4, { minD: 0.25 });
      pool(wx - 1.78, wy - 0.18, Z + deskH, 0.8, 0.0, 'none');
    }
    // refined task chair facing the screens
    putParts(taskChair(M), wx + 0.05, wy + 0.85, Z, 0.08);

    // ---- feature wall dressing (south face of the wall at y = 4.7 - 0.18)
    const fy = 4.7 - 0.19;
    // walnut slats x -17.0 .. -12.4
    for (let x = -17.0; x < -12.4; x += 0.095) put(M.walnut, swapUV(rbox(0.045, 4.1, 0.06, 0.006, 1)), x, fy - 0.03, Z + 2.05);
    // backlit shelving niche x -12.2 .. -8.6
    {
      const x0 = -12.2, x1 = -8.6, xm = (x0 + x1) / 2;
      put(M.walnutDeep, swapUV(panel(x1 - x0, 4.1, 0.04, 0.1)), xm, fy + 0.02, Z + 2.05);
      for (let k = 0; k < 6; k++) {
        const zz = Z + 0.45 + k * 0.62;
        put(M.walnut, rbox(x1 - x0, 0.035, 0.36, 0.004, 1), xm, fy - 0.18, zz);
        put(M.ledStrip, box(x1 - x0 - 0.1, 0.006, 0.01), xm, fy - 0.33, zz - 0.02);
        if (k > 0) bake.addLine(x0 + 0.1, fy - 0.3, x1 - 0.1, fy - 0.3, zz - 0.03, LED, 0.45, 0.9, { dir: [0, 0, -1], cosIn: 0.3, cosOut: -0.05, spacing: 0.3 });
        if (k === 5) continue;
        styleShelf(rng, M, x0 + 0.06, xm - 0.04, fy - 0.2, zz + 0.0175, k, putParts);
        styleShelf(rng, M, xm + 0.04, x1 - 0.06, fy - 0.2, zz + 0.0175, k + 7, putParts);
      }
      for (const x of [x0, xm, x1]) put(M.walnut, rbox(0.035, 3.7, 0.36, 0.004, 1), x, fy - 0.18, Z + 0.2 + 1.85);
    }
    // rough stone panel x -8.4 .. -6.6
    {
      const g = new THREE.PlaneGeometry(1.8, 4.4, 40, 90);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const d = Math.sin(x * 9.1 + Math.sin(y * 3.1) * 2) * 0.02 + Math.sin(y * 13.3 + x * 4.7) * 0.015 + Math.sin(x * 23 + y * 19) * 0.006;
        pos.setZ(i, d + 0.03);
      }
      g.computeVertexNormals();
      g.translate(0, 2.2, 0);
      put(M.travertineDark, g, -7.5, fy - 0.02, Z, 0);
    }
    real.push([wx + 0.4, wy + 0.1, Z + 2.9, 9, 9]);
  }

  lap('work');
  // =========================== DINING (south-east) ==============================
  {
    zone = 'dining';
    const rng = mulberry32(303);
    const [dx, dy] = ANCHORS.dining; // 6.55, -2.55
    // calacatta top with an eased edge on a fluted travertine pedestal
    put(M.calacatta, latheCap([[0, 0], [1.1, 0], [1.118, 0.008], [1.12, 0.03], [1.114, 0.042], [1.1, 0.046], [0, 0.046]], 128), dx, dy, Z + 0.715, 0.7);
    put(M.travertineDark, lathe([[0, 0], [0.5, 0], [0.52, 0.02], [0.5, 0.05], [0.3, 0.16], [0.24, 0.38], [0.26, 0.6], [0.4, 0.7], [0.42, 0.715], [0, 0.715]], 96, { flutes: 18, fluteDepth: 0.06 }), dx, dy, Z);
    // eight upholstered tub chairs on slim bronze legs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 1.38 + (i % 2) * 0.03;
      const cx = dx + Math.cos(a) * r, cy = dy + Math.sin(a) * r;
      const rot = facing(dx - cx, dy - cy) + (rng() - 0.5) * 0.12;
      putParts(tubChair(M, { R: 0.285, A: 2.0, seatH: 0.47, backH: 0.8, armH: 0.66, thick: 0.05, legH: 0.38, mat: M.chairFabric, legMat: M.bronze }), cx, cy, Z, rot);
    }
    // centrepiece: fruit bowl, bud vases, candles
    putParts(D.fruitBowl(rng, M, M.glazeCharcoal, [0.86, 0.62, 0.1]), dx - 0.12, dy + 0.05, Z + 0.761);
    putParts(D.vessel('bud', M, M.glazeBone, 1.1, { seed: 51 }), dx + 0.32, dy - 0.18, Z + 0.761);
    putParts(D.vessel('bottle', M, M.glazeOchre, 0.9, { seed: 52 }), dx + 0.42, dy + 0.12, Z + 0.761);
    putParts(D.candleGroup(rng, M, true), dx - 0.1, dy - 0.38, Z + 0.761, 0.3);
    // ring pendant: slim bronze ring with an LED diffuser underneath
    {
      const ring = new THREE.TorusGeometry(0.85, 0.028, 12, 160);
      ring.rotateX(Math.PI / 2);
      put(M.bronze, ring, dx, dy, Z + 2.5);
      const dif = new THREE.TorusGeometry(0.85, 0.016, 8, 160);
      dif.rotateX(Math.PI / 2);
      put(M.ledStrip, dif, dx, dy, Z + 2.478);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        put(M.blackSteel, cyl(0.0025, 0.0025, 1.85, 4), dx + Math.cos(a) * 0.85, dy + Math.sin(a) * 0.85, Z + 2.52);
      }
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        bake.add(dx + Math.cos(a) * 0.85, dy + Math.sin(a) * 0.85, Z + 2.46, WARM, 0.25, 3.5, { dir: [0, 0, -1], cosIn: 0.5, cosOut: -0.1 });
      }
      pool(dx, dy, Z, 2.4, 0.3);
      real.push([dx, dy, Z + 2.25, 12, 9]);
    }
    // sculpture on a plinth by the east column
    putParts(D.plinth(M, 0.36, 1.05, M.travertine), 10.3, -5.75, Z, 0.4);
    putParts(D.sculpture('twist', M), 10.3, -5.75, Z + 1.05, 0.4);
  }

  lap('dining');
  // =========================== KITCHEN (north-east) =============================
  {
    zone = 'kitchen';
    const rng = mulberry32(404);
    const [kx] = ANCHORS.kitchen; // 8.7
    const iy = 2.65;
    const iL = 4.4, iD = 1.3, iH = 0.92, tT = 0.06;
    // island: nero top with mitred waterfall ends (bookmatched veins)
    put(M.neroIsland, rbox(iL, tT, iD, 0.004, 2), kx, iy, Z + iH - tT / 2);
    for (const s of [-1, 1]) {
      const g = rbox(tT, iH - tT, iD, 0.004, 2);
      put(M.neroIsland, g, kx + s * (iL / 2 - tT / 2), iy, Z + (iH - tT) / 2);
    }
    // walnut body: door fronts with 3 mm reveals on the cook side, panel on the stool side
    {
      const bodyL = iL - 2 * tT - 0.004;
      put(M.walnutDeep, at(box(bodyL - 0.02, iH - tT - 0.1, iD - 0.12), 0, (iH - tT - 0.1) / 2 + 0.1, 0), kx, iy, Z);
      put(M.blackSteel, at(box(bodyL - 0.06, 0.1, iD - 0.2), 0, 0.05, 0), kx, iy, Z);
      const n = 7, fw = bodyL / n;
      for (let i = 0; i < n; i++) {
        const fx = kx - bodyL / 2 + fw * (i + 0.5);
        put(M.walnut, swapUV(at(rbox(fw - 0.004, iH - tT - 0.11, 0.019, 0.002, 1), 0, (iH - tT - 0.11) / 2 + 0.1, 0)), fx, iy + iD / 2 - 0.05, Z, 0);
        put(M.walnut, swapUV(at(rbox(fw - 0.004, iH - tT - 0.11, 0.019, 0.002, 1), 0, (iH - tT - 0.11) / 2 + 0.1, 0)), fx, iy - iD / 2 + 0.05, Z, Math.PI);
      }
    }
    // sink + bronze tap, chopping board, fruit bowl
    put(M.blackGlass, rbox(0.72, 0.006, 0.44, 0.03, 3), kx + 0.9, iy + 0.22, Z + iH + 0.002);
    {
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.38, 0.1), new THREE.Vector3(0, 0.3, 0.2)];
      const tap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 10);
      put(M.brass, tap, kx + 0.9, iy + 0.5, Z + iH, Math.PI);
    }
    put(M.walnut, swapUV(rbox(0.5, 0.025, 0.32, 0.01, 2)), kx - 0.8, iy + 0.1, Z + iH + 0.0125, 0.15);
    putParts(D.fruitBowl(rng, M, M.glazeWhite, [0.9, 0.72, 0.1]), kx - 1.55, iy - 0.15, Z + iH);
    putParts(D.vessel('tall', M, M.glazeCharcoal, 0.75, { seed: 61 }), kx + 1.7, iy - 0.25, Z + iH);
    putParts(D.branches(rng, M, 0.6, 0.3), kx + 1.7, iy - 0.25, Z + iH + 0.36);
    // island pendants: three opal globes on bronze rods
    for (let i = -1; i <= 1; i++) {
      putParts(D.globeLamp(M, 0.17).parts.slice(1), kx + i * 1.35, iy, Z + 1.92);
      put(M.bronze, cyl(0.004, 0.004, 1.95, 6), kx + i * 1.35, iy, Z + 2.25);
      put(M.bronze, cyl(0.045, 0.03, 0.04, 20), kx + i * 1.35, iy, Z + 2.24);
      bake.add(kx + i * 1.35, iy, Z + 2.1, WARM, 0.7, 3.5, { minD: 0.25 });
    }
    pool(kx, iy, Z, 3.0, 0.25);
    real.push([kx, iy, Z + 2.2, 11, 9]);
    // four bar stools on the south side (leather seats, black frames)
    for (let i = 0; i < 4; i++) {
      putParts(barStool(M), kx - 1.5 + i, iy - 0.95, Z, Math.PI + (rng() - 0.5) * 0.2);
    }

    // ---- tall-unit wall (y 6.0): door fronts with reveals, integrated appliances
    const wyF = 6.0 - 0.25 - 0.66; // front plane of the units
    const x0 = 4.9, x1 = 15.3;
    const doorRow = (xa, xb, z0, h, n, mat = M.walnut) => {
      const w = (xb - xa) / n;
      for (let i = 0; i < n; i++) {
        put(mat, swapUV(at(rbox(w - 0.004, h - 0.004, 0.02, 0.002, 1), 0, h / 2, 0)), xa + w * (i + 0.5), wyF + 0.01, z0, Math.PI);
      }
    };
    // carcasses (dark recess behind the reveals)
    put(M.walnutDeep, at(box(3.0, 3.0, 0.62), 0, 1.5, 0), x0 + 1.5, wyF + 0.33, Z);
    put(M.walnutDeep, at(box(1.6, 3.0, 0.62), 0, 1.5, 0), x1 - 2.4, wyF + 0.33, Z);
    put(M.walnutDeep, at(box(1.6, 1.0, 0.62), 0, 0.5, 0), x1 - 0.8, wyF + 0.33, Z);
    put(M.walnutDeep, at(box(1.6, 1.05, 0.62), 0, 0.525, 0), x1 - 0.8, wyF + 0.33, Z + 1.95);
    for (const sx of [x1 - 1.59, x1 - 0.01]) put(M.walnut, at(box(0.02, 0.95, 0.62), 0, 0.475, 0), sx, wyF + 0.33, Z + 1.0);
    put(M.blackSteel, at(box(x1 - x0, 0.08, 0.6), 0, 0.04, 0), (x0 + x1) / 2, wyF + 0.33, Z);
    // left tall unit: fridge column (2 doors) + oven tower (2 ovens + drawers)
    doorRow(x0, x0 + 1.5, Z + 0.08, 2.92, 2);
    put(M.bronze, at(box(0.016, 1.2, 0.02), 0, 0.6, 0), x0 + 0.73, wyF - 0.02, Z + 0.9);
    put(M.bronze, at(box(0.016, 1.2, 0.02), 0, 0.6, 0), x0 + 0.77, wyF - 0.02, Z + 0.9);
    {
      const ox = x0 + 2.25;
      doorRow(x0 + 1.5, x0 + 3.0, Z + 0.08, 0.7, 1);
      for (const [oz, oh] of [[Z + 0.8, 0.6], [Z + 1.42, 0.46]]) {
        put(M.blackGlass, at(rbox(0.6, oh - 0.01, 0.02, 0.004, 1), 0, oh / 2, 0), ox, wyF - 0.005, oz);
        put(M.brass, at(rbox(0.5, 0.014, 0.022, 0.006, 1), 0, 0, 0), ox, wyF - 0.03, oz + oh - 0.06);
        put(M.walnut, swapUV(at(rbox(0.44, oh, 0.02, 0.002, 1), 0, oh / 2, 0)), ox - 0.52, wyF + 0.01, oz, Math.PI);
        put(M.walnut, swapUV(at(rbox(0.44, oh, 0.02, 0.002, 1), 0, oh / 2, 0)), ox + 0.52, wyF + 0.01, oz, Math.PI);
      }
      doorRow(x0 + 1.5, x0 + 3.0, Z + 1.88, 1.12, 2);
    }
    // right tall unit: pantry doors + coffee niche (lit)
    doorRow(x1 - 3.2, x1 - 1.6, Z + 0.08, 2.92, 2);
    doorRow(x1 - 1.6, x1, Z + 0.08, 0.92, 2);
    doorRow(x1 - 1.6, x1, Z + 1.95, 1.05, 2);
    {
      const nx = x1 - 0.8;
      put(M.walnutDeep, panel(1.5, 0.95, 0.02, 0.1), nx, wyF + 0.45, Z + 1.475);
      put(M.walnut, rbox(1.5, 0.025, 0.5, 0.003, 1), nx, wyF + 0.26, Z + 1.02);
      put(M.blackGlass, at(rbox(0.32, 0.38, 0.36, 0.03, 3), 0, 0.19, 0), nx - 0.4, wyF + 0.25, Z + 1.032);
      put(M.aluminium, at(cyl(0.03, 0.03, 0.06, 16), 0, 0, 0), nx - 0.4, wyF + 0.1, Z + 1.12);
      putParts(D.vessel('jar', M, M.glazeSand, 0.7, { seed: 62 }), nx + 0.15, wyF + 0.25, Z + 1.032);
      putParts(D.vessel('cylinder', M, M.glazeWhite, 0.5, { seed: 63 }), nx + 0.4, wyF + 0.3, Z + 1.032);
      put(M.ledStrip, box(1.4, 0.006, 0.01), nx, wyF + 0.05, Z + 1.93);
      bake.addLine(nx - 0.65, wyF + 0.08, nx + 0.65, wyF + 0.08, Z + 1.92, LED, 0.6, 1.2, { dir: [0, 0, -1], cosIn: 0.3, cosOut: -0.1 });
    }
    // centre run: base units, nero counter + splash, open shelves with LED
    const cx0 = x0 + 3.0, cx1 = x1 - 3.2, cmid = (cx0 + cx1) / 2, cw = cx1 - cx0;
    const wy = wyF + 0.33;
    put(M.walnutDeep, at(box(cw, 0.78, 0.6), 0, 0.39 + 0.08, 0), cmid, wy, Z);
    doorRow(cx0, cx1, Z + 0.08, 0.8, 7);
    put(M.neroIsland, rbox(cw, 0.04, 0.68, 0.003, 1), cmid, wy - 0.02, Z + 0.9);
    put(M.neroIsland, panel(cw, 0.9, 0.025, 0.12), cmid, wy + 0.3, Z + 1.37);
    // induction hob (flush black glass) + bronze hood
    put(M.blackGlass, rbox(0.86, 0.006, 0.52, 0.01, 2), cmid - 0.9, wy - 0.04, Z + 0.923);
    put(M.bronze, rbox(0.95, 0.22, 0.48, 0.01, 2), cmid - 0.9, wy + 0.02, Z + 1.78);
    put(M.ledStrip, box(0.8, 0.004, 0.3), cmid - 0.9, wy + 0.02, Z + 1.668);
    bake.add(cmid - 0.9, wy - 0.05, Z + 1.62, WARM, 0.4, 1.6, { dir: [0, 0, -1], cosIn: 0.6, cosOut: 0.0 });
    // open shelves to the right of the hood
    for (let k = 0; k < 2; k++) {
      const zz = Z + 1.92 + k * 0.5;
      const sx0 = cmid - 0.3, sx1 = cx1;
      put(M.walnut, rbox(sx1 - sx0, 0.035, 0.3, 0.004, 1), (sx0 + sx1) / 2, wy + 0.15, zz);
      put(M.ledStrip, box(sx1 - sx0 - 0.1, 0.005, 0.01), (sx0 + sx1) / 2, wy + 0.02, zz - 0.02);
      bake.addLine(sx0 + 0.05, wy + 0.04, sx1 - 0.05, wy + 0.04, zz - 0.03, LED, 0.6, 1.1, { dir: [0, 0, -1], cosIn: 0.3, cosOut: -0.1, spacing: 0.3 });
      styleShelf(rng, M, sx0 + 0.06, sx1 - 0.06, wy + 0.13, zz + 0.0175, 20 + k, putParts, true);
    }
    bake.addLine(cx0 + 0.1, wy - 0.25, cx1 - 0.1, wy - 0.25, Z + 1.85, LED, 0.5, 1.4, { dir: [0, 0, -1], cosIn: 0.4, cosOut: -0.1, spacing: 0.35 });
    // counter dressing
    putParts(D.vessel('urn', M, M.glazeBone, 0.55, { seed: 64 }), cx1 - 0.35, wy - 0.05, Z + 0.92);
    put(M.walnut, swapUV(rbox(0.42, 0.022, 0.3, 0.012, 2)), cmid + 0.3, wy + 0.15, Z + 0.931, 0.08);
    put(M.walnut, swapUV(rbox(0.36, 0.022, 0.26, 0.012, 2)).rotateX(-1.35), cmid + 0.32, wy + 0.24, Z + 1.06, 0.05);
    putParts(D.vessel('bottle', M, M.glassSmoke, 0.8, { seed: 65 }), cmid + 0.75, wy + 0.1, Z + 0.92);
    // upper cabinets to the ceiling
    put(M.walnutDeep, at(box(x1 - x0, 0.95, 0.6), 0, 0.475, 0), (x0 + x1) / 2, wy, Z + 3.0);
    doorRow(x0, x1, Z + 3.02, 0.95, 16);
  }

  lap('kitchen');
  // =========================== ENTRY HALL ======================================
  {
    zone = 'entry';
    const rng = mulberry32(505);
    put(M.walnut, swapUV(rbox(2.0, 0.06, 0.44, 0.006, 2)), 3.0, 8.9, Z + 0.79);
    put(M.travertine, at(rbox(0.36, 0.76, 0.38, 0.01, 2), 0, 0.38, 0), 2.3, 8.9, Z);
    put(M.travertine, at(rbox(0.36, 0.76, 0.38, 0.01, 2), 0, 0.38, 0), 3.7, 8.9, Z);
    putParts(D.vessel('urn', M, M.glazeRust, 0.9, { seed: 71 }), 2.45, 8.92, Z + 0.82);
    putParts(D.branches(rng, M, 0.8, 0.4), 2.45, 8.92, Z + 0.82 + 0.45);
    const lamp = D.tableLamp(M, { h: 0.66, shadeR: 0.2, mat: M.glazeCharcoal });
    putParts(lamp.parts, 3.6, 8.92, Z + 0.82);
    bake.add(3.6, 8.92, Z + 0.82 + lamp.lampY, WARM, 0.7, 3.0, { minD: 0.25 });
    putParts(D.bookStack(rng, M, 3, true).parts, 3.05, 8.88, Z + 0.82, 0.2);
    putParts(D.vessel('floorVase', M, M.glazeSand, 1.0, { seed: 72 }), -0.4, 8.9, Z);
    real.push([3.0, 8.4, Z + 3.2, 14, 11]);
    real.push([-0.8, 9.2, Z + 3.1, 6, 8]);
  }

  lap('entry');
  // =========================== UPPER FLOOR (through the glazing) ===============
  {
    zone = 'upper';
    const rng = mulberry32(606);
    // beds: headboard against the walnut core wall, foot toward the glass
    const bed = (x, y, rot, art) => {
      putParts(bedParts(M, rng), x, y, U, rot);
      const [rx, ry] = rel(x, y, rot, 0, -0.2);
      put(M.rugBed, rugGeo(3.4, 2.6), rx, ry, U + 0.006, rot);
      for (const s of [-1, 1]) {
        const [nx, ny] = rel(x, y, rot, s * 1.32, -0.9);
        put(M.walnutDeep, at(rbox(0.5, 0.5, 0.42, 0.01, 2), 0, 0.25, 0), nx, ny, U, rot);
        const lamp = D.tableLamp(M, { h: 0.55, shadeR: 0.16, mat: M.glazeBone });
        putParts(lamp.parts, nx, ny, U + 0.5, rot);
        bake.add(nx, ny, U + 0.5 + lamp.lampY, WARM, 0.6, 3.0, { minD: 0.25 });
      }
      // bench at the foot
      const [bx, by] = rel(x, y, rot, 0, 1.45);
      put(M.boucleOat, at(softBox(1.5, 0.12, 0.45, { r: 0.05, crown: 0.01, seam: 'crease', seed: 81 }), 0, 0.4, 0), bx, by, U, rot);
      put(M.walnutDeep, at(rbox(1.46, 0.34, 0.41, 0.01, 2), 0, 0.17, 0), bx, by, U, rot);
      // painting above the headboard
      const [px, py] = rel(x, y, rot, 0, -1.07);
      putParts(D.framedArt(art, 1.5, 1.0, M, 'float'), px, py, U + 1.45, rot);
      bake.add(...rel(x, y, rot, 0, -0.75), U + 2.7, WARM, 0.5, 3.0, { dir: [0, 0, -1], cosIn: 0.7, cosOut: 0.2 });
      real.push([...rel(x, y, rot, 0, 0.6), U + 2.4, 5, 8]);
    };
    bed(-10.6, -2.95, -0.29, M.art.field);
    bed(9.9, -2.55, 0.32, M.art.horizon);
    // upper lounge facing the sea (sofa back to the core wall)
    {
      const sx = 1.4, sy = -3.3;
      putParts(sofaRun(2.6, 0.98, { armL: true, armR: true, n: 3, seatFrom: -1.3, seatTo: 1.3 }, M, rng), sx, sy, U, 0.03);
      putParts(D.scatterCushion(rng, M.linenCocoa, 0.48, 0.16).map(([m, g]) => [m, g.rotateX(-0.4)]), sx - 0.8, sy - 0.2, U + 0.67, 0.03);
      putParts(D.scatterCushion(rng, M.velvetRust, 0.46, 0.16).map(([m, g]) => [m, g.rotateX(-0.4)]), sx + 0.85, sy - 0.2, U + 0.67, -0.05);
      put(M.nero, latheCap([[0, 0], [0.5, 0], [0.5, 0.33], [0.49, 0.34], [0, 0.34]], 64), sx, sy - 1.45, U);
      putParts(D.vessel('moon', M, M.glazeSand, 0.7, { seed: 91 }), sx + 0.15, sy - 1.45, U + 0.34);
      for (const s of [-1, 1]) {
        putParts(tubChair(M, { R: 0.42, A: 2.15, seatH: 0.42, backH: 0.72, armH: 0.6, thick: 0.12, legH: 0.06, mat: M.boucle, legMat: M.walnutDeep, plinth: true }), sx + s * 0.9, sy - 2.6, U, Math.PI + s * 0.35);
      }
      put(M.rugBed, rugGeo(3.2, 2.6), sx, sy - 1.5, U + 0.006, 0.03);
      const fl = D.floorLamp(M, { h: 1.55, shadeR: 0.22 });
      putParts(fl.parts, sx - 1.75, sy + 0.05, U);
      bake.add(sx - 1.75, sy + 0.05, U + fl.lampY, WARM, 0.9, 3.5, { minD: 0.25 });
      putParts(oliveTree(M, { seed: 29, height: 2.4, planterR: 0.42, planterH: 0.5 }), sx + 2.25, sy - 0.3, U, 1.3);
      real.push([sx, sy - 1.2, U + 2.6, 6, 8]);
    }
  }

  lap('upper');
  B.flush(root, bake);
  lap('flush');

  // ---- additive light pools on the polished floor (main camera only)
  {
    const geos = [];
    for (const p of pools) {
      if (p.surface === 'none' || p.intensity <= 0) continue;
      const g = new THREE.PlaneGeometry(p.r * 2, p.r * 2);
      g.rotateX(-Math.PI / 2);
      const c = new THREE.Color(1, 0.62, 0.32).multiplyScalar(p.intensity);
      const n = g.attributes.position.count;
      const colArr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colArr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      g.translate(p.x, p.z + 0.012, -p.y);
      geos.push(g);
    }
    if (geos.length) {
      const mat = M.pool.clone();
      mat.vertexColors = true;
      mat.color.setRGB(1, 1, 1);
      const merged = mergeVC(geos);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'interior-light-pools';
      mesh.renderOrder = 1;
      mesh.layers.set(2);
      root.add(mesh);
    }
  }

  // ---- real lights: few, soft, 2700 K, no shadows
  if (quality.interiorLights !== false) {
    for (const [x, y, z, intensity, dist] of real) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.66, 0.4), intensity, dist, 2);
      l.position.set(x, z, -y);
      root.add(l);
    }
  }
  lap('end');
  root.userData.timings = tm;
  return { root };
}

// ============================================================================
// builders (local space: front +z, base y = 0)
// ============================================================================

function mergeVC(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of list) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    col.set(g.attributes.color.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// rug slab whose UVs map the whole rug image once over its top
function rugGeo(w, d) {
  const g = rbox(w, 0.014, d, 0.006, 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getZ(i) / d + 0.5);
  return g;
}

// modular sofa run: plinth, upholstered deck, seat + back cushions, back frame, arms
function sofaRun(len, depth, o, M, rng) {
  const { armL = false, armR = false, n = 3, seatFrom = -len / 2, seatTo = len / 2, backFrom = -len / 2, backTo = len / 2, mat = M.boucle } = o;
  const backCushFrom = o.backCushFrom ?? backFrom, backCushTo = o.backCushTo ?? backTo;
  const parts = [];
  const armW = 0.2;
  const sf = seatFrom + (armL ? armW : 0), st = seatTo - (armR ? armW : 0);
  const backT = 0.22;
  // recessed walnut plinth
  parts.push([M.walnutDeep, at(rbox(len - 0.14, 0.07, depth - 0.14, 0.006, 1), 0, 0.035, -0.01)]);
  // upholstered deck
  parts.push([mat, at(softBox(len, 0.22, depth, { r: 0.07, belly: 0.01, seam: 'crease', seamDepth: 0.004, wrinkle: 0.0015, seed: 3 }), 0, 0.07 + 0.11, 0)]);
  // back frame
  parts.push([mat, at(softBox(backTo - backFrom, 0.36, backT, { r: 0.09, crown: 0.01, seam: 'crease', seed: 5, wrinkle: 0.0015 }), (backFrom + backTo) / 2, 0.29 + 0.18, -depth / 2 + backT / 2)]);
  // seat cushions (plump, slightly sat-in)
  const cw = (st - sf) / n;
  for (let i = 0; i < n; i++) {
    const cxp = sf + cw * (i + 0.5);
    const sd = depth - backT - 0.02;
    parts.push([mat, at(softBox(cw - 0.015, 0.17, sd, {
      r: 0.07, crown: 0.022, belly: 0.012, sag: [0.014, (rng() - 0.5) * 0.2, 0.05, 0.28], seam: 'welt', seamDepth: 0.0035,
      wrinkle: 0.0025, seed: Math.floor(rng() * 1000), frontDrop: 0.01,
    }), cxp, 0.29 + 0.085, -depth / 2 + backT + sd / 2 + 0.005)]);
  }
  // back cushions (leaning)
  const bf = Math.max(backCushFrom, sf), bt = Math.min(backCushTo, st);
  const bn = Math.max(1, Math.round((bt - bf) / 1.0));
  const bw = (bt - bf) / bn;
  for (let i = 0; i < bn; i++) {
    const g = softBox(bw - 0.03, 0.22, 0.5, { r: 0.09, crown: 0.035, belly: 0.01, seam: 'welt', seamDepth: 0.003, wrinkle: 0.003, seed: Math.floor(rng() * 1000) });
    g.rotateX(Math.PI / 2 - 0.2);
    parts.push([mat, at(g, bf + bw * (i + 0.5), 0.29 + 0.17 + 0.26, -depth / 2 + backT + 0.12)]);
  }
  // low rounded arms
  const arms = [];
  if (armL) arms.push(seatFrom + armW / 2);
  if (armR) arms.push(seatTo - armW / 2);
  for (const xx of arms) parts.push([mat, at(softBox(armW, 0.3, depth, { r: 0.09, crown: 0.012, seam: 'crease', seed: 9, wrinkle: 0.0015 }), xx, 0.29 + 0.15, 0)]);
  return parts;
}

// upholstered tub chair: shell lofted around the seat, seat cushion, legs
function tubChair(M, o) {
  const { R, A, seatH, backH, armH, thick, legH, mat, legMat, plinth = false } = o;
  const parts = [];
  const shellY0 = seatH - 0.1;
  const secs = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const a = -A + (2 * A * i) / N;
    const ta = Math.abs(a) / A;
    const top = armH + (backH - armH) * Math.cos(ta * Math.PI / 2) ** 1.3;
    const dx = Math.sin(a), dz = -Math.cos(a);
    const ro = R, ri = R - thick, rr = thick / 2;
    const sec = [];
    // closed profile in (radius, height): outer bottom -> outer top (round) -> inner top -> inner bottom
    const prof = [];
    prof.push([ro, shellY0]);
    prof.push([ro, top - rr]);
    for (let k = 1; k < 6; k++) { const t = (k / 6) * Math.PI; prof.push([ri + rr + Math.cos(t) * rr, top - rr + Math.sin(t) * rr]); }
    prof.push([ri, top - rr]);
    prof.push([ri, shellY0]);
    for (const [r, y] of prof) sec.push([dx * r, y, dz * r + 0.02]);
    secs.push(sec);
  }
  let shell = loft(secs);
  // make sure the outer surface faces outward
  shell.computeBoundingBox();
  {
    const p = shell.attributes.position, nn = shell.attributes.normal;
    // first vertex of the middle section is on the outer back surface (normal should point -z)
    const mid = Math.floor(N / 2) * secs[0].length;
    if (nn.getZ(mid) > 0) shell = flipFaces(shell);
    void p;
  }
  parts.push([mat, shell]);
  // seat platform + cushion
  parts.push([mat, at(softBox(R * 1.85, 0.1, R * 1.75, { r: 0.04, seam: null, wrinkle: 0.001, seed: 2 }), 0, shellY0 + 0.05, 0.02)]);
  parts.push([mat, at(softBox(R * 1.72, 0.09, R * 1.62, { r: 0.04, crown: 0.012, seam: 'welt', seamDepth: 0.003, seed: 3 }), 0, shellY0 + 0.1 + 0.035, 0.05)]);
  if (plinth) {
    parts.push([legMat, at(rbox(R * 1.6, legH + shellY0 - 0.06, R * 1.5, 0.01, 2), 0, (legH + shellY0 - 0.06) / 2 - legH * 0, 0.02)]);
  } else {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = cyl(0.009, 0.015, shellY0, 10);
      g.rotateZ(lx * 0.06); g.rotateX(-lz * 0.06);
      parts.push([legMat, at(g, lx * R * 0.62, 0, lz * R * 0.58 + 0.02)]);
    }
  }
  return parts;
}

// monitor: thin bezel, screen, rear housing, neck + foot. Screen faces +z (front).
function monitor(M, screenMat) {
  const parts = [];
  const w = 0.615, h = 0.36, cy = 0.13 + h / 2;
  parts.push([M.blackSteel, at(rbox(w, h, 0.012, 0.004, 1), 0, cy, 0)]);
  const s = new THREE.PlaneGeometry(w - 0.014, h - 0.03);
  parts.push([screenMat, at(s, 0, cy + 0.006, 0.0065)]);
  parts.push([M.aluminium, at(rbox(w * 0.7, h * 0.6, 0.03, 0.012, 2), 0, cy, -0.02)]);
  parts.push([M.aluminium, at(rbox(0.05, 0.2, 0.02, 0.006, 1), 0, 0.1, -0.06)]);
  parts.push([M.aluminium, at(rbox(0.22, 0.008, 0.17, 0.004, 1), 0, 0.004, -0.04)]);
  return parts;
}

// refined task chair: upholstered seat + curved back shell, alloy 5-star base
function taskChair(M) {
  const parts = [];
  parts.push([M.taskFabric, at(softBox(0.5, 0.075, 0.48, { r: 0.03, crown: 0.01, seam: 'welt', seamDepth: 0.002, seed: 12 }), 0, 0.48, 0)]);
  // curved back (loft section)
  const secs = [];
  for (let i = 0; i <= 16; i++) {
    const a = -0.55 + (1.1 * i) / 16;
    const R = 0.42;
    const sec = [];
    for (const [dr, y] of [[0, 0.56], [0, 1.08], [-0.02, 1.1], [-0.045, 1.08], [-0.045, 0.56], [-0.02, 0.54]]) {
      const r = R + dr;
      const lean = (y - 0.56) * 0.16;
      sec.push([Math.sin(a) * r, y, -Math.cos(a) * r + 0.18 - lean]);
    }
    secs.push(sec);
  }
  let back = loft(secs);
  if (back.attributes.normal.getZ(8 * 6) > 0) back = flipFaces(back);
  parts.push([M.taskFabric, back]);
  parts.push([M.aluminium, at(box(0.04, 0.3, 0.02), 0, 0.42, -0.24)]);
  // armrests
  for (const s of [-1, 1]) {
    parts.push([M.aluminium, at(box(0.02, 0.2, 0.02), s * 0.27, 0.52, -0.02)]);
    parts.push([M.leatherEspresso, at(rbox(0.06, 0.025, 0.24, 0.01, 2), s * 0.27, 0.635, 0.0)]);
  }
  parts.push([M.aluminium, at(cyl(0.024, 0.028, 0.3, 16), 0, 0.13, 0)]);
  parts.push([M.blackSteel, at(cyl(0.035, 0.035, 0.06, 16), 0, 0.4, 0)]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = rbox(0.33, 0.028, 0.045, 0.01, 2);
    leg.translate(0.165, 0.09, 0);
    leg.rotateY(a);
    parts.push([M.aluminium, leg]);
    const wh = cyl(0.026, 0.026, 0.03, 12);
    wh.rotateX(Math.PI / 2);
    wh.translate(Math.cos(a) * 0.32, 0.028, -Math.sin(a) * 0.32);
    parts.push([M.blackSteel, wh]);
  }
  return parts;
}

function barStool(M) {
  const parts = [];
  parts.push([M.leatherCognac, at(softBox(0.42, 0.07, 0.4, { r: 0.03, crown: 0.008, seam: 'welt', seamDepth: 0.002, seed: 14 }), 0, 0.71, 0)]);
  const secs = [];
  for (let i = 0; i <= 12; i++) {
    const a = -0.9 + (1.8 * i) / 12;
    const sec = [];
    for (const [r, y] of [[0.22, 0.76], [0.22, 0.9], [0.205, 0.915], [0.19, 0.9], [0.19, 0.76]]) sec.push([Math.sin(a) * r, y, -Math.cos(a) * r + 0.02]);
    secs.push(sec);
  }
  let back = loft(secs);
  if (back.attributes.normal.getZ(6 * 5) > 0) back = flipFaces(back);
  parts.push([M.leatherCognac, back]);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const g = cyl(0.011, 0.013, 0.68, 8);
    g.rotateZ(lx * 0.05); g.rotateX(-lz * 0.05);
    parts.push([M.blackSteel, at(g, lx * 0.16, 0, lz * 0.15)]);
  }
  const ring = new THREE.TorusGeometry(0.2, 0.008, 6, 48);
  ring.rotateX(Math.PI / 2);
  parts.push([M.blackSteel, at(ring, 0, 0.26, 0)]);
  return parts;
}

function bedParts(M, rng) {
  const parts = [];
  // upholstered platform + tall channel headboard
  parts.push([M.walnutDeep, at(rbox(2.0, 0.08, 2.1, 0.01, 1), 0, 0.04, 0.05)]);
  parts.push([M.linenTaupe, at(softBox(2.1, 0.28, 2.2, { r: 0.06, seam: 'welt', seamDepth: 0.003, seed: 21 }), 0, 0.08 + 0.14, 0.05)]);
  for (let i = 0; i < 6; i++) {
    parts.push([M.linenTaupe, at(softBox(0.42, 1.15, 0.12, { r: 0.05, crown: 0.0, belly: 0.012, seam: null, seed: 22 + i }), -1.05 + 0.21 + i * 0.42, 0.62, -1.0)]);
  }
  // mattress + duvet with a folded top edge
  parts.push([M.bedLinen, at(softBox(1.96, 0.24, 2.0, { r: 0.08, crown: 0.02, belly: 0.01, seam: 'welt', seed: 23 }), 0, 0.36 + 0.12, 0.1)]);
  parts.push([M.bedLinen, at(softBox(2.06, 0.08, 1.45, { r: 0.04, crown: 0.025, sag: [0.01, 0.2, 0.2, 0.4], seam: null, wrinkle: 0.006, wrinkleScale: 6, seed: 24, frontDrop: 0.05 }), 0, 0.6 + 0.04, 0.38)]);
  parts.push([M.bedLinen, at(softBox(2.04, 0.1, 0.32, { r: 0.045, crown: 0.01, seam: null, wrinkle: 0.005, seed: 25 }), 0, 0.64, -0.38)]);
  // pillows: two sleeping + two euro + a lumbar
  for (const s of [-1, 1]) {
    const p = D.scatterCushion(rng, M.bedLinen, 0.7, 0.2, true);
    for (const [, g] of p) g.rotateX(-1.2);
    D.xform(p, s * 0.48, 0.72, -0.72);
    parts.push(...p);
    const e = D.scatterCushion(rng, M.linenSand, 0.62, 0.18, false);
    for (const [, g] of e) g.rotateX(-0.25);
    D.xform(e, s * 0.5, 0.95, -0.86);
    parts.push(...e);
  }
  const lum = D.scatterCushion(rng, M.velvetRust, 0.45, 0.14, true);
  for (const [, g] of lum) g.rotateX(-0.5);
  D.xform(lum, 0, 0.8, -0.58);
  parts.push(...lum);
  // throw at the foot
  parts.push(...D.foldedThrow(M.herringbone, 2.0, 0.55, 3).map(([m, g]) => [m, at(g, 0, 0.68, 0.7)]));
  return parts;
}

// styled shelf: varied objects (books upright / stacked, vessels, sculpture,
// small framed art, plant) laid out left to right without repeats
function styleShelf(rng, M, xa, xb, y, z, seed, putParts, kitchen = false) {
  const r = mulberry32(1000 + seed * 31);
  const glazes = [M.glazeWhite, M.glazeSand, M.glazeCharcoal, M.glazeCeladon, M.glazeRust, M.glazeOchre, M.glazeIndigo, M.glazeBone];
  const kinds = kitchen ? ['jars', 'bowlstack', 'bottle', 'plates', 'vessel', 'books'] : ['books', 'stack', 'vessel', 'vessel2', 'sculpt', 'art', 'plant', 'books', 'bowl'];
  let x = xa;
  let i = Math.floor(r() * kinds.length);
  let guard = 0;
  while (x < xb - 0.12 && guard++ < 20) {
    const kind = kinds[i % kinds.length];
    i += 1 + Math.floor(r() * 2);
    const room = xb - x;
    let used = 0.2;
    const parts = [];
    if (kind === 'books') {
      const br = D.bookRow(r, M, Math.min(room, 0.25 + r() * 0.35));
      parts.push(...br.parts.map(([m, g]) => [m, g.translate(0, 0, -0.02)]));
      used = br.w + 0.04;
      for (const [, g] of parts) g.translate(0, 0, 0);
      putParts(parts, x, y, z, 0);
      x += used + 0.06;
      continue;
    } else if (kind === 'stack') {
      const st = D.bookStack(r, M, 2 + Math.floor(r() * 3), false);
      parts.push(...st.parts);
      used = 0.26;
      if (r() < 0.6) parts.push(...D.vessel('bud', M, glazes[Math.floor(r() * 8)], 0.8, { seed: seed * 3 }).map(([m, g]) => [m, g.translate(0, st.h, 0)]));
    } else if (kind === 'vessel' || kind === 'vessel2') {
      const kk = ['amphora', 'bottle', 'moon', 'jar', 'bud', 'cylinder', 'pebble'][Math.floor(r() * 7)];
      const s = 0.5 + r() * 0.5;
      parts.push(...D.vessel(kk, M, glazes[Math.floor(r() * 8)], s, { seed: seed * 7 + i, flutes: r() < 0.3 ? 14 : 0, fluteDepth: 0.05 }));
      used = 0.28 * s + 0.08;
    } else if (kind === 'sculpt') {
      parts.push(...D.sculpture(r() < 0.5 ? 'stack' : 'head', M).map(([m, g]) => [m, g.scale(0.7, 0.7, 0.7)]));
      used = 0.24;
    } else if (kind === 'art') {
      const arts = Object.values(M.art);
      const a = arts[Math.floor(r() * arts.length)];
      const w = 0.3 + r() * 0.12, h = w * 1.25;
      const fp = D.framedArt(a, w, h, M, r() < 0.5 ? 'black' : 'float');
      for (const [, g] of fp) { g.rotateX(-0.12); g.translate(0, 0.02, -0.06); }
      parts.push(...fp);
      used = w + 0.1;
    } else if (kind === 'plant') {
      parts.push(...D.shelfPlant(r, M, glazes[Math.floor(r() * 8)]));
      used = 0.26;
    } else if (kind === 'bowl' || kind === 'bowlstack') {
      parts.push(...D.vessel('bowl', M, glazes[Math.floor(r() * 8)], 0.7, { seed: seed + 5 }));
      if (kind === 'bowlstack') parts.push(...D.vessel('bowl', M, glazes[Math.floor(r() * 8)], 0.6, { seed: seed + 6 }).map(([m, g]) => [m, g.translate(0, 0.045, 0)]));
      used = 0.3;
    } else if (kind === 'jars') {
      for (let k = 0; k < 3; k++) parts.push(...D.vessel('jar', M, k === 1 ? M.glassSmoke : glazes[(seed + k) % 8], 0.55, { seed: seed + k }).map(([m, g]) => [m, g.translate(k * 0.11, 0, 0)]));
      used = 0.38;
    } else if (kind === 'bottle') {
      parts.push(...D.vessel('bottle', M, r() < 0.5 ? M.glassAmber : M.glassSmoke, 0.9, { seed }));
      used = 0.16;
    } else if (kind === 'plates') {
      for (let k = 0; k < 4; k++) parts.push(...D.vessel('shallow', M, glazes[(seed + 2) % 8], 0.55, { seed: k }).map(([m, g]) => [m, g.translate(0, k * 0.022, 0)]));
      used = 0.32;
    }
    if (used > room) break;
    putParts(parts, x + used / 2, y, z, (r() - 0.5) * 0.3);
    x += used + 0.05 + r() * 0.08;
  }
}
