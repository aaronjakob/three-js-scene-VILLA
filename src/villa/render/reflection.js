import * as THREE from 'three';

// Planar reflection at the main-floor plane (y = 18 m): one render shared by the
// polished interior floor, the honed deck and the pool water. Roughness blur
// comes from mip levels of the reflection target.

export class ReflectionPlane {
  constructor(renderer, scene, { height = 18, scale = 0.5 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.height = height;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      samples: 0,
    });
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();
    this.uniforms = {
      tReflection: { value: this.rt.texture },
      uReflMatrix: { value: this.textureMatrix },
      uReflRes: { value: new THREE.Vector2(2, 2) },
    };
    this.hidden = [];
  }

  setSize(w, h) {
    const W = Math.max(2, Math.round(w * this.scale));
    const H = Math.max(2, Math.round(h * this.scale));
    this.rt.setSize(W, H);
    this.uniforms.uReflRes.value.set(W, H);
  }

  // patch standard/physical materials to mix the planar reflection in
  attach(list) {
    for (const { material, strength, roughness } of list) {
      material.userData.reflStrength = strength;
      const prev = material.onBeforeCompile;
      const self = this;
      material.onBeforeCompile = (sh, r) => {
        if (prev) prev(sh, r);
        sh.uniforms.tReflection = self.uniforms.tReflection;
        sh.uniforms.uReflMatrix = self.uniforms.uReflMatrix;
        sh.uniforms.uReflStrength = { value: strength };
        sh.uniforms.uReflRough = { value: roughness };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflCoord;\nvarying vec3 vReflW;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 rw = modelMatrix * vec4(transformed, 1.0);\nvReflW = rw.xyz;\nvReflCoord = uReflMatrix * rw;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D tReflection;\nuniform float uReflStrength;\nuniform float uReflRough;\nvarying vec4 vReflCoord;\nvarying vec3 vReflW;')
          .replace('#include <opaque_fragment>', `
{
  vec3 V = normalize(cameraPosition - vReflW);
  float cosT = clamp(V.y, 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec2 ruv = vReflCoord.xy / vReflCoord.w;
  float lod = uReflRough * 6.0;
  vec4 rc = textureLod(tReflection, ruv, lod);
  rc.rgb = min(rc.rgb, vec3(2.2)); // no blown sun disc in the floor
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float k = uReflStrength * mix(0.25, 1.0, F) * rc.a * smoothstep(0.9, 0.99, wN.y);
  outgoingLight = mix(outgoingLight, outgoingLight * 0.55 + rc.rgb, k * 0.85);
}
#include <opaque_fragment>`);
      };
      const prevKey = material.customProgramCacheKey;
      material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|refl';
      material.needsUpdate = true;
    }
  }

  attachPoolWater(waterMat) {
    this.poolWater = waterMat;
    waterMat.uniforms.tRefl.value = this.rt.texture;
    waterMat.uniforms.uHasRefl.value = 1;
    waterMat.uniforms.uReflMatrix.value = this.textureMatrix;
  }

  update(camera) {
    const { renderer, scene, virtualCamera: vc } = this;
    const h = this.height;
    // mirror camera across y = h
    const camPos = camera.position;
    if (camPos.y < h + 0.05) return; // below the plane: nothing sensible to reflect
    vc.copy(camera);
    vc.position.set(camPos.x, 2 * h - camPos.y, camPos.z);
    const target = new THREE.Vector3();
    camera.getWorldDirection(target);
    target.y = -target.y;
    target.add(vc.position);
    vc.up.copy(camera.up).applyQuaternion(camera.quaternion);
    vc.up.y = -vc.up.y;
    vc.lookAt(target);
    vc.far = camera.far;
    vc.layers.set(0);
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    // texture matrix
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);

    // hide reflective receivers + transparent water while rendering
    if (!this.receivers) {
      this.receivers = [];
      scene.traverse((o) => {
        if (o.isMesh && (o.material?.userData?.reflStrength !== undefined || o.material === this.poolWater || o.name === 'ocean' || o.name === 'pool-water')) this.receivers.push(o);
      });
    }
    const hidden = [];
    for (const o of this.receivers) if (o.visible) { o.visible = false; hidden.push(o); }
    const prevRT = renderer.getRenderTarget();
    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -h + 0.01)];
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.clippingPlanes = prevClip;
    for (const o of hidden) o.visible = true;
  }

  dispose() { this.rt.dispose(); }
}
