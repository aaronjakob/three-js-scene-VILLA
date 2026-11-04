import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materials } from '../materials/library.js';
import { LEVEL } from '../core/world.js';
import { ANCHORS } from '../core/anchors.js';
import { merge } from '../architecture/geo.js';

const Z = LEVEL.main;
const V2 = (x, y) => new THREE.Vector2(x, y);

// Small builder that collects geometry per material and merges at the end
class Batch {
  constructor() { this.map = new Map(); }
  push(mat, geo) {
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
  }
  flush(root, { cast = true, receive = true } = {}) {
    for (const [mat, geos] of this.map) {
      const m = new THREE.Mesh(merge(geos), mat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      root.add(m);
    }
    this.map.clear();
  }
}

// place a local-space geometry: local x/z plane, y up; plan position (x, y), rotation (CCW, rad)
function place(g, x, y, z = Z, rot = 0) {
  g.rotateY(rot);
  g.translate(x, z, -y);
  return g;
}
function rbox(w, h, d, r = 0.05, seg = 4) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
}
function at(g, lx, ly, lz) { g.translate(lx, ly, lz); return g; }

export function buildInterior(ctx) {
  const { scene, quality } = ctx;
  const M = materials(quality);
  const root = new THREE.Group();
  root.name = 'interior';
  scene.add(root);
  const B = new Batch();
  const lights = [];

  // ===================== LIVING (south-west) ===============================
  {
    const [lx, ly] = ANCHORS.living; // -6, -3
    // rug
    B.push(M.rug, place(rbox(5.6, 0.018, 4.3, 0.008, 2), lx - 0.2, ly - 0.5, Z, 0.04));
    // L sofa: long run facing south + return facing east
    const sofa = (len, x, y, rot) => {
      const parts = [];
      // recessed plinth
      parts.push([M.walnutDark, at(rbox(len - 0.1, 0.1, 0.95, 0.02, 2), 0, 0.05, 0.0)]);
      // seat base
      parts.push([M.boucle, at(rbox(len, 0.28, 1.08, 0.1, 5), 0, 0.24, 0.0)]);
      // seat cushions
      const n = Math.max(2, Math.round(len / 1.05));
      const cw = len / n;
      for (let i = 0; i < n; i++) {
        parts.push([M.boucle, at(rbox(cw - 0.03, 0.16, 0.9, 0.075, 5), -len / 2 + cw * (i + 0.5), 0.45, 0.07)]);
        // back cushions (leaning)
        const bc = rbox(cw - 0.06, 0.52, 0.26, 0.11, 5);
        bc.rotateX(-0.12);
        parts.push([M.boucle, at(bc, -len / 2 + cw * (i + 0.5), 0.72, -0.4)]);
      }
      // back frame
      parts.push([M.boucle, at(rbox(len, 0.42, 0.22, 0.1, 5), 0, 0.52, -0.46)]);
      for (const [mat, g] of parts) B.push(mat, place(g, x, y, Z, rot));
    };
    sofa(5.0, lx - 0.4, ly + 1.75, 0); // long side, back to the north, faces the sea
    // return, faces east
    sofa(3.0, lx - 3.35, ly - 0.15, Math.PI / 2);
    // corner block
    B.push(M.boucle, place(rbox(1.08, 0.28, 1.08, 0.1, 5), lx - 3.35, ly + 1.75, Z + 0.1));
    B.push(M.boucle, place(rbox(1.0, 0.16, 1.0, 0.08, 5), lx - 3.35, ly + 1.75, Z + 0.45));
    // scatter pillows
    for (const [px, py, r] of [[-7.6, -1.45, 0.2], [-4.6, -1.45, -0.15], [-9.15, -2.6, Math.PI / 2 + 0.2]]) {
      const p = rbox(0.5, 0.42, 0.14, 0.07, 4);
      p.rotateX(-0.25);
      B.push(M.linen, place(p, px, py, Z + 0.72, r));
    }
    // poufs
    B.push(M.boucle, place(rbox(0.78, 0.42, 0.78, 0.1, 5), lx - 2.6, ly - 2.25, Z + 0.21, 0.2));
    B.push(M.boucle, place(rbox(0.7, 0.4, 0.7, 0.1, 5), lx + 1.45, ly - 1.0, Z + 0.2, -0.3));
    // dark stone drum tables (two)
    const drum = (r, h) => new THREE.LatheGeometry([V2(0, 0), V2(r * 0.92, 0), V2(r, 0.04), V2(r, h - 0.03), V2(r - 0.02, h), V2(0, h)], 72);
    B.push(M.darkStone, place(drum(0.62, 0.36), lx - 0.55, ly - 0.55));
    B.push(M.darkStone, place(drum(0.44, 0.3), lx + 0.55, ly - 1.25));
    // tabletop decor: books, bowl, globe lamp
    B.push(M.books, place(rbox(0.32, 0.06, 0.24, 0.01, 2), lx - 0.75, ly - 0.45, Z + 0.39, 0.3));
    B.push(M.ceramic, place(new THREE.LatheGeometry([V2(0, 0), V2(0.12, 0.0), V2(0.2, 0.08), V2(0.21, 0.1), V2(0.19, 0.1), V2(0.11, 0.02), V2(0, 0.02)], 40), lx - 0.35, ly - 0.7, Z + 0.36));
    const globe = new THREE.SphereGeometry(0.11, 24, 16);
    B.push(M.lampShade, place(globe, lx + 0.65, ly - 1.2, Z + 0.41));
    // lounge armchair facing the sofa across the tables
    {
      const g1 = rbox(0.9, 0.36, 0.86, 0.12, 5); at(g1, 0, 0.18, 0);
      const g2 = rbox(0.9, 0.5, 0.2, 0.1, 5); g2.rotateX(-0.2); at(g2, 0, 0.55, -0.36);
      const g3 = rbox(0.18, 0.28, 0.8, 0.08, 4); at(g3, -0.4, 0.48, 0);
      const g4 = rbox(0.18, 0.28, 0.8, 0.08, 4); at(g4, 0.4, 0.48, 0);
      for (const g of [g1, g2, g3, g4]) B.push(M.linen, place(g, lx + 1.9, ly - 2.4, Z, Math.atan2(-0.51, -0.86)));
    }
    // floor lamp (arched bronze with opal globe) behind the sofa corner
    {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        pts.push(new THREE.Vector3(-10.45 + t * 1.5, Z + Math.sin(t * Math.PI * 0.9) * 2.1 + t * 0.2, 0.15 - 0.35 * t));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.018, 8);
      B.push(M.metalDark, tube);
      B.push(M.darkStone, place(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 32), -10.45, -0.15, Z + 0.03));
      const shade = new THREE.SphereGeometry(0.18, 24, 16);
      shade.translate(-8.95, Z + 2.12, -0.2);
      B.push(M.lampShade, shade);
    }
    lights.push([lx, ly, Z + 3.2, 10, 14]);
    lights.push([-8.95, 0.2, Z + 1.9, 3.5, 6]);
  }

  // ===================== WORKSPACE (north-west) ============================
  {
    const [wx, wy] = ANCHORS.workspace; // -11.7, 2.4
    const deskL = 4.2, deskD = 0.86, deskH = 0.74;
    B.push(M.walnut, place(rbox(deskL, 0.06, deskD, 0.012, 2), wx, wy, Z + deskH - 0.06));
    // pedestal (drawers) at east end, slab leg at west end
    B.push(M.walnut, place(rbox(0.55, deskH - 0.06, deskD - 0.06, 0.01, 2), wx + deskL / 2 - 0.35, wy, Z));
    B.push(M.walnut, place(rbox(0.06, deskH - 0.06, deskD - 0.1, 0.01, 2), wx - deskL / 2 + 0.12, wy, Z));
    B.push(M.metalDark, place(rbox(0.52, 0.006, 0.006, 0.002, 1), wx + deskL / 2 - 0.35, wy - deskD / 2 + 0.03, Z + 0.45));
    // three monitors on the south edge, screens facing north (to the user)
    const mon = (dx, rot, scr) => {
      const body = rbox(0.74, 0.44, 0.03, 0.008, 2);
      const screen = new THREE.PlaneGeometry(0.71, 0.405);
      screen.rotateY(Math.PI); // face +y (north) after placement: plane faces +z local -> north is -z three
      screen.translate(0, 0, -0.016);
      // local: monitor faces -z (three) == north
      const arm = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 10); at(arm, 0, -0.33, 0.05);
      const base = rbox(0.22, 0.012, 0.16, 0.004, 1); at(base, 0, -0.44, 0.05);
      for (const g of [body, arm, base]) { at(g, 0, 0, 0); }
      const px = wx + dx, py = wy - 0.22;
      B.push(M.monitorBody, place(body, px, py, Z + deskH + 0.52, rot));
      B.push(M.monitorBody, place(arm, px, py, Z + deskH + 0.52, rot));
      B.push(M.monitorBody, place(base, px, py, Z + deskH + 0.52, rot));
      B.push(scr, place(screen, px, py, Z + deskH + 0.52, rot));
    };
    mon(-0.78, -0.33, M.screen2);
    mon(0, 0, M.screen);
    mon(0.78, 0.33, M.screen3);
    // keyboard, mouse, notebook, globe desk lamp, pot
    B.push(M.monitorBody, place(rbox(0.44, 0.015, 0.14, 0.005, 1), wx, wy + 0.12, Z + deskH));
    B.push(M.monitorBody, place(rbox(0.06, 0.02, 0.1, 0.01, 2), wx + 0.38, wy + 0.12, Z + deskH));
    B.push(M.books, place(rbox(0.22, 0.02, 0.3, 0.003, 1), wx - 0.6, wy + 0.15, Z + deskH, 0.2));
    B.push(M.lampShade, place(new THREE.SphereGeometry(0.12, 24, 16), wx - 1.75, wy - 0.18, Z + deskH + 0.12));
    B.push(M.darkStone, place(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 20), wx - 1.75, wy - 0.18, Z + deskH));
    // office chair
    {
      const seat = rbox(0.52, 0.08, 0.5, 0.03, 3); at(seat, 0, 0.48, 0);
      const back = rbox(0.48, 0.62, 0.06, 0.03, 3); back.rotateX(0.12); at(back, 0, 0.86, 0.27);
      const post = new THREE.CylinderGeometry(0.025, 0.03, 0.36, 12); at(post, 0, 0.28, 0);
      const star = [];
      for (let i = 0; i < 5; i++) {
        const leg = rbox(0.34, 0.03, 0.05, 0.01, 1);
        leg.translate(0.17, 0.08, 0);
        leg.rotateY((i / 5) * Math.PI * 2);
        star.push(leg);
        const wheel = new THREE.SphereGeometry(0.03, 10, 8);
        wheel.translate(Math.cos((i / 5) * Math.PI * 2) * 0.32, 0.03, -Math.sin((i / 5) * Math.PI * 2) * 0.32);
        star.push(wheel);
      }
      const cx = wx + 0.1, cy = wy + 0.82, cr = Math.PI + 0.1;
      B.push(M.leather, place(seat, cx, cy, Z, cr));
      B.push(M.leather, place(back, cx, cy, Z, cr));
      B.push(M.metalDark, place(post, cx, cy, Z, cr));
      B.push(M.metalDark, place(merge(star), cx, cy, Z, cr));
    }
    // feature wall dressing (south face of the wall at y = 4.7 - 0.18)
    const fy = 4.7 - 0.19;
    // walnut slats x -17.0 .. -12.4
    for (let x = -17.0; x < -12.4; x += 0.095) {
      B.push(M.walnut, place(rbox(0.045, 4.4, 0.06, 0.01, 1), x, fy - 0.03, Z));
    }
    // backlit shelving niche x -12.2 .. -8.6
    {
      const x0 = -12.2, x1 = -8.6;
      B.push(M.walnutDark, place(rbox(x1 - x0, 4.4, 0.04, 0.005, 1), (x0 + x1) / 2, fy + 0.02, Z));
      for (let k = 0; k < 6; k++) {
        const zz = Z + 0.45 + k * 0.62;
        B.push(M.walnut, place(rbox(x1 - x0, 0.04, 0.38, 0.01, 1), (x0 + x1) / 2, fy - 0.19, zz));
        // LED under each shelf
        B.push(M.ledSoft, place(rbox(x1 - x0 - 0.1, 0.008, 0.01, 0.002, 1), (x0 + x1) / 2, fy - 0.33, zz - 0.012));
        // books / objects
        let x = x0 + 0.1;
        let i = 0;
        while (x < x1 - 0.4) {
          const w = 0.35 + ((k * 7 + i * 3) % 5) * 0.08;
          if ((k + i) % 3 === 0) {
            B.push(M.books, place(rbox(w, 0.26, 0.24, 0.004, 1), x + w / 2, fy - 0.17, zz + 0.04));
          } else if ((k + i) % 3 === 1) {
            B.push((k + i) % 2 ? M.ceramic : M.ceramicDark, place(new THREE.LatheGeometry([V2(0, 0), V2(0.08, 0), V2(0.1, 0.12), V2(0.05, 0.24), V2(0.04, 0.26), V2(0, 0.26)], 24), x + 0.12, fy - 0.17, zz + 0.04));
          }
          x += w + 0.12;
          i++;
        }
      }
      // shelf uprights
      for (const x of [x0, (x0 + x1) / 2, x1]) B.push(M.walnut, place(rbox(0.04, 4.0, 0.38, 0.005, 1), x, fy - 0.19, Z + 0.2));
    }
    // rough stone panel x -8.4 .. -6.6 (the "rock wall" of the reference)
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
      B.push(M.stoneWall, place(g, -7.5, fy - 0.02, Z, 0));
    }
    lights.push([wx, wy + 0.4, Z + 3.0, 5, 9]);
  }

  // ===================== DINING (south-east) ===============================
  {
    const [dx, dy] = ANCHORS.dining; // 6.55, -2.55
    const top = new THREE.CylinderGeometry(1.12, 1.12, 0.05, 96);
    B.push(M.lightMarble, place(top, dx, dy, Z + 0.745));
    const base = new THREE.LatheGeometry([V2(0, 0), V2(0.55, 0), V2(0.55, 0.03), V2(0.26, 0.2), V2(0.2, 0.55), V2(0.34, 0.72), V2(0, 0.72)], 64);
    B.push(M.walnut, place(base, dx, dy, Z));
    // 8 upholstered chairs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 1.42;
      const cx = dx + Math.cos(a) * r, cy = dy + Math.sin(a) * r;
      const rot = Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI / 2; // face the centre
      const seat = rbox(0.52, 0.12, 0.5, 0.05, 4); at(seat, 0, 0.44, 0);
      // curved back: segment of a torus-ish shell
      const back = rbox(0.5, 0.42, 0.08, 0.04, 4); back.rotateX(0.1); at(back, 0, 0.74, 0.24);
      const legs = [];
      for (const [lx2, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.2], [0.2, 0.2]]) {
        const l = new THREE.CylinderGeometry(0.018, 0.014, 0.4, 8); at(l, lx2, 0.2, lz); legs.push(l);
      }
      // local chair front faces -z; rotate so the front faces the table centre
      const yaw = Math.atan2(Math.cos(a), -Math.sin(a));
      void rot;
      B.push(M.linen, place(seat, cx, cy, Z, yaw));
      B.push(M.linen, place(back, cx, cy, Z, yaw));
      B.push(M.walnut, place(merge(legs), cx, cy, Z, yaw));
    }
    // centrepiece
    B.push(M.ceramic, place(new THREE.LatheGeometry([V2(0, 0), V2(0.1, 0), V2(0.26, 0.06), V2(0.3, 0.12), V2(0.27, 0.12), V2(0.08, 0.02), V2(0, 0.02)], 48), dx, dy, Z + 0.77));
    // ring pendant
    const ring = new THREE.TorusGeometry(0.85, 0.022, 10, 120);
    ring.rotateX(Math.PI / 2);
    B.push(M.led, place(ring, dx, dy, Z + 2.55));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = new THREE.CylinderGeometry(0.003, 0.003, 1.9, 4);
      B.push(M.metalDark, place(c, dx + Math.cos(a) * 0.85, dy + Math.sin(a) * 0.85, Z + 2.55 + 0.95));
    }
    lights.push([dx, dy, Z + 2.3, 7, 10]);
  }

  // ===================== KITCHEN (north-east) ==============================
  {
    const [kx] = ANCHORS.kitchen; // 8.7, 3.4
    const iy = 2.65;
    // island: dark stone with waterfall ends
    B.push(M.darkStone, place(rbox(4.4, 0.06, 1.3, 0.01, 2), kx, iy, Z + 0.88));
    B.push(M.darkStone, place(rbox(0.06, 0.88, 1.3, 0.01, 2), kx - 2.17, iy, Z));
    B.push(M.darkStone, place(rbox(0.06, 0.88, 1.3, 0.01, 2), kx + 2.17, iy, Z));
    B.push(M.walnut, place(rbox(4.26, 0.84, 0.95, 0.01, 2), kx, iy + 0.12, Z + 0.02));
    // sink + bronze tap
    B.push(M.monitorBody, place(rbox(0.7, 0.02, 0.42, 0.04, 3), kx + 0.9, iy + 0.25, Z + 0.93));
    {
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.32, 0), new THREE.Vector3(0, 0.38, 0.12), new THREE.Vector3(0, 0.28, 0.2)];
      const tap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.014, 8);
      B.push(M.brass, place(tap, kx + 0.9, iy + 0.5, Z + 0.94, Math.PI));
    }
    // stools on the south side
    for (let i = 0; i < 4; i++) {
      const sx = kx - 1.5 + i;
      const seat = rbox(0.42, 0.08, 0.38, 0.03, 3); at(seat, 0, 0.66, 0);
      const back = rbox(0.4, 0.18, 0.05, 0.02, 3); at(back, 0, 0.82, -0.18);
      const legs = [];
      for (const [lx2, lz] of [[-0.16, -0.15], [0.16, -0.15], [-0.16, 0.15], [0.16, 0.15]]) {
        const l = new THREE.CylinderGeometry(0.012, 0.012, 0.64, 8); at(l, lx2, 0.32, lz); legs.push(l);
      }
      B.push(M.leather, place(merge([seat, back]), sx, iy - 0.98, Z, Math.PI));
      B.push(M.metalDark, place(merge(legs), sx, iy - 0.98, Z, Math.PI));
    }
    // back wall: tall walnut cabinetry with a backlit niche + counter
    const wy = 6.0 - 0.25 - 0.33;
    const x0 = 4.9, x1 = 15.3;
    // tall units left and right
    B.push(M.walnut, place(rbox(3.0, 3.0, 0.66, 0.01, 2), x0 + 1.5, wy, Z));
    B.push(M.walnut, place(rbox(3.2, 3.0, 0.66, 0.01, 2), x1 - 1.6, wy, Z));
    // reveal lines between doors
    for (let x = x0 + 0.6; x < x0 + 3.0; x += 0.6) B.push(M.metalDark, place(rbox(0.01, 2.9, 0.005, 0.002, 1), x, wy - 0.333, Z + 0.05));
    for (let x = x1 - 3.2 + 0.64; x < x1; x += 0.64) B.push(M.metalDark, place(rbox(0.01, 2.9, 0.005, 0.002, 1), x, wy - 0.333, Z + 0.05));
    // centre run: base units, dark stone counter + splash, open shelves with LED
    const cx0 = x0 + 3.0, cx1 = x1 - 3.2, cmid = (cx0 + cx1) / 2, cw = cx1 - cx0;
    B.push(M.walnut, place(rbox(cw, 0.86, 0.64, 0.01, 2), cmid, wy, Z));
    B.push(M.darkStone, place(rbox(cw, 0.05, 0.68, 0.006, 1), cmid, wy - 0.02, Z + 0.86));
    B.push(M.darkStone, place(rbox(cw, 0.9, 0.03, 0.004, 1), cmid, wy + 0.3, Z + 0.91));
    for (let k = 0; k < 2; k++) {
      const zz = Z + 1.95 + k * 0.5;
      B.push(M.walnut, place(rbox(cw, 0.04, 0.32, 0.006, 1), cmid, wy + 0.15, zz));
      B.push(M.ledSoft, place(rbox(cw - 0.1, 0.006, 0.01, 0.002, 1), cmid, wy + 0.01, zz - 0.01));
      for (let i = 0; i < 9; i++) {
        const xx = cx0 + 0.3 + i * (cw - 0.6) / 8;
        B.push(i % 3 === 0 ? M.ceramicDark : M.ceramic, place(new THREE.LatheGeometry([V2(0, 0), V2(0.07, 0), V2(0.09, 0.08 + (i % 2) * 0.06), V2(0.06, 0.16 + (i % 2) * 0.06), V2(0, 0.16 + (i % 2) * 0.06)], 20), xx, wy + 0.14, zz + 0.04));
      }
    }
    B.push(M.ledSoft, place(rbox(cw - 0.1, 0.006, 0.01, 0.002, 1), cmid, wy + 0.0, Z + 1.82));
    // upper cabinets above the shelves, up to the ceiling
    B.push(M.walnut, place(rbox(x1 - x0, 1.2, 0.66, 0.01, 2), (x0 + x1) / 2, wy, Z + 3.0));
    // island pendants: three opal globes
    for (let i = -1; i <= 1; i++) {
      B.push(M.lampShade, place(new THREE.SphereGeometry(0.16, 24, 16), kx + i * 1.3, iy, Z + 2.25));
      B.push(M.metalDark, place(new THREE.CylinderGeometry(0.003, 0.003, 2.0, 4), kx + i * 1.3, iy, Z + 2.25 + 1.12));
    }
    lights.push([kx, iy, Z + 2.0, 7, 9]);
  }

  // ===================== ENTRY HALL =======================================
  {
    B.push(M.walnut, place(rbox(1.9, 0.08, 0.42, 0.01, 2), 3.0, 8.9, Z + 0.78));
    B.push(M.darkStone, place(rbox(0.36, 0.78, 0.36, 0.02, 2), 2.4, 8.9, Z));
    B.push(M.darkStone, place(rbox(0.36, 0.78, 0.36, 0.02, 2), 3.6, 8.9, Z));
    B.push(M.ceramicDark, place(new THREE.LatheGeometry([V2(0, 0), V2(0.12, 0), V2(0.18, 0.2), V2(0.1, 0.5), V2(0.06, 0.56), V2(0, 0.56)], 32), 2.6, 8.9, Z + 0.86));
    lights.push([3.0, 8.4, Z + 3.4, 6, 10]);
    lights.push([6.5, 8.8, Z + 3.2, 4, 8]);
  }

  B.flush(root);

  // ===================== interior lights ====================================
  if (quality.interiorLights !== false) {
    for (const [x, y, z, intensity, dist] of lights) {
      const l = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.44), intensity * 2.2, dist * 1.3, 2);
      l.position.set(x, z, -y);
      root.add(l);
    }
  }

  return { root };
}
