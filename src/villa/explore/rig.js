import * as THREE from 'three';
import { VIEWS, VIEW_BY_ID } from '../core/anchors.js';
import { toThree, LEVEL } from '../core/world.js';

// Fixed views + smooth transitions + optional human-height free walk.
// Walk mode: WASD/arrow keys move, mouse drag (or pointer lock) looks.
// Collision: 2D segment/circle colliders from the villa + floor heights from
// the villa's walkable surfaces and the analytic terrain.

const tmpV = new THREE.Vector3();

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CameraRig {
  constructor({ camera, canvas, field, villa, reducedMotion, onChange, onViewChange }) {
    this.camera = camera;
    this.canvas = canvas;
    this.field = field;
    this.villa = villa;
    this.reducedMotion = reducedMotion;
    this.onChange = onChange;
    this.onViewChange = onViewChange;
    this.currentView = null;
    this.anim = null;
    this.explore = false;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector3();
    this.velocityY = 0;

    this._onKeyDown = (e) => {
      if (!this.explore) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
        this.onChange();
      }
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._drag = null;
    this._onPointerDown = (e) => {
      if (!this.explore) return;
      this._drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    };
    this._onPointerMove = (e) => {
      if (!this.explore) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === canvas) {
        dx = e.movementX; dy = e.movementY;
      } else if (this._drag) {
        dx = e.clientX - this._drag.x; dy = e.clientY - this._drag.y;
        this._drag = { x: e.clientX, y: e.clientY };
      } else return;
      this.yaw -= dx * 0.0032;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0032, -1.25, 1.25);
      this._applyLook();
      this.onChange();
    };
    this._onPointerUp = () => { this._drag = null; };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  viewPose(id) {
    const v = VIEW_BY_ID[id];
    return { pos: toThree(v.position), target: toThree(v.target), fov: v.fov };
  }

  setView(id, { instant = false, duration } = {}) {
    if (!VIEW_BY_ID[id]) return;
    const to = this.viewPose(id);
    this.explore = false;
    this.keys.clear();
    const from = {
      pos: this.camera.position.clone(),
      target: this.camera.position.clone().add(this.camera.getWorldDirection(tmpV).multiplyScalar(20)),
      fov: this.camera.fov,
    };
    this.currentView = id;
    this.onViewChange?.(id);
    if (instant || this.reducedMotion || !this.currentPoseValid) {
      this._apply(to.pos, to.target, to.fov);
      this.anim = null;
      this.currentPoseValid = true;
      this.onChange();
      return;
    }
    const dist = from.pos.distanceTo(to.pos);
    const dur = duration ?? THREE.MathUtils.clamp(1.4 + dist / 60, 1.6, 3.6);
    // arc through a lifted midpoint for long moves (never through walls)
    const lift = Math.min(dist * 0.25, 30);
    const mid = from.pos.clone().lerp(to.pos, 0.5);
    mid.y = Math.max(mid.y, Math.max(from.pos.y, to.pos.y) + lift * (dist > 25 ? 1 : 0));
    this.anim = { from, to, mid, t: 0, dur };
    this.onChange();
  }

  _apply(pos, target, fov) {
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  setExplore(on) {
    this.explore = on;
    this.anim = null;
    if (on) {
      const d = this.camera.getWorldDirection(tmpV);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      this.pos.copy(this.camera.position);
      // drop to human height if we were floating
      const floor = this.floorHeight(this.pos.x, -this.pos.z, this.pos.y);
      if (floor !== null && this.pos.y - floor > 2.5) this.pos.y = floor + LEVEL.eye;
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      this._applyLook();
    } else if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
    this.onChange();
  }

  _applyLook() {
    const e = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    this.camera.position.copy(this.pos);
    this.camera.updateMatrixWorld();
  }

  floorHeight(gx, gy, currentY) {
    let best = null;
    const walk = this.villa?.walkHeight?.(gx, gy, currentY);
    if (walk != null) best = walk;
    const t = this.field.height(gx, gy);
    if (best === null || (t > best && t < currentY + 0.6)) best = Math.max(best ?? -Infinity, t);
    return best;
  }

  update(dt) {
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const k = easeInOut(Math.min(1, a.t));
      // quadratic bezier position
      const p0 = a.from.pos, p1 = a.mid, p2 = a.to.pos;
      const pos = new THREE.Vector3()
        .copy(p0).multiplyScalar((1 - k) * (1 - k))
        .addScaledVector(p1, 2 * (1 - k) * k)
        .addScaledVector(p2, k * k);
      const target = a.from.target.clone().lerp(a.to.target, k);
      const fov = THREE.MathUtils.lerp(a.from.fov, a.to.fov, k);
      this._apply(pos, target, fov);
      if (a.t >= 1) this.anim = null;
      return true;
    }
    if (this.explore && this.keys.size) {
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4.2 : 1.9) * dt;
      let fx = 0, fz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const dx = ((fx * c + fz * s) / len) * speed;
      const dz = ((-fx * s + fz * c) / len) * speed;
      this._move(dx, dz);
      this._applyLook();
      return true;
    }
    return false;
  }

  _move(dx, dz) {
    const r = 0.32;
    let nx = this.pos.x + dx;
    let nz = this.pos.z + dz;
    const colliders = this.villa?.colliders ?? [];
    const feetY = this.pos.y - LEVEL.eye;
    // resolve against segments/circles (plan coords: gx = x, gy = -z)
    for (let iter = 0; iter < 3; iter++) {
      for (const c of colliders) {
        if (c.minY !== undefined && (feetY + 1.7 < c.minY || feetY > c.maxY)) continue;
        if (c.type === 'seg') {
          const ax = c.a[0], ay = -c.a[1], bx = c.b[0], by = -c.b[1];
          const ex = bx - ax, ey = by - ay;
          const l2 = ex * ex + ey * ey || 1;
          let t = ((nx - ax) * ex + (nz - ay) * ey) / l2;
          t = Math.max(0, Math.min(1, t));
          const px = ax + ex * t, py = ay + ey * t;
          const ddx = nx - px, ddy = nz - py;
          const d = Math.hypot(ddx, ddy);
          if (d < r && d > 1e-6) {
            nx = px + (ddx / d) * r;
            nz = py + (ddy / d) * r;
          }
        } else if (c.type === 'circle') {
          const cx = c.c[0], cy = -c.c[1];
          const ddx = nx - cx, ddy = nz - cy;
          const d = Math.hypot(ddx, ddy);
          const rr = c.r + r;
          if (d < rr && d > 1e-6) {
            nx = cx + (ddx / d) * rr;
            nz = cy + (ddy / d) * rr;
          }
        }
      }
    }
    const floor = this.floorHeight(nx, -nz, this.pos.y);
    if (floor === null) return;
    const targetY = floor + LEVEL.eye;
    // block steps higher than 0.45 m and drops greater than 1.2 m (no falling off cliffs)
    if (targetY - this.pos.y > 0.45 || this.pos.y - targetY > 1.2) return;
    if (floor < 0.3) return; // no walking into the sea
    this.pos.set(nx, THREE.MathUtils.lerp(this.pos.y, targetY, 0.5), nz);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }
}

export { VIEWS };
