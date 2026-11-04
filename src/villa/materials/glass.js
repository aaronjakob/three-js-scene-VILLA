import * as THREE from 'three';
import { atmosphereUniforms, GLSL_SKY, GLSL_HAZE, hazeUniforms } from '../render/atmosphere.js';

// Architectural glass without a transmission pass: Fresnel reflection of the
// analytic sky (the same sky that lights the scene), a faint green-grey body
// tint and premultiplied blending, so reflections stay at full strength while
// the interior shows through at normal incidence.
export function createGlassMaterial({ tint = 0.06, reflect = 1.0 } = {}) {
  return new THREE.ShaderMaterial({
    name: 'ArchGlass',
    uniforms: {
      ...atmosphereUniforms,
      ...hazeUniforms,
      uTint: { value: tint },
      uReflect: { value: reflect },
      uInside: { value: 0 },
      uEnvCube: { value: null },
      uHasEnvCube: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_SKY}
      ${GLSL_HAZE}
      uniform float uTint; uniform float uReflect; uniform float uInside;
      uniform samplerCube uEnvCube; uniform float uHasEnvCube;
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec3 V = normalize(vW - cameraPosition);
        vec3 N = normalize(vN);
        if (dot(N, V) > 0.0) N = -N;
        float c = clamp(dot(-V, N), 0.0, 1.0);
        float F = 0.04 + 0.96 * pow(1.0 - c, 5.0);
        vec3 R = reflect(V, N);
        // looking down at the glass from outside reflects the ground/sea: darken lower hemisphere
        vec3 sky;
        if (uHasEnvCube > 0.5) {
          // captured surroundings: sea, cliff, terraces, trees, sky
          sky = textureCube(uEnvCube, R).rgb;
        } else {
          sky = vh_sky(normalize(vec3(R.x, max(R.y, -0.25), R.z)), true);
          float below = smoothstep(0.02, -0.2, R.y);
          sky = mix(sky, vec3(0.05, 0.07, 0.07), below * 0.85);
        }
        // seen from inside, the panes mirror the warm, darker room instead of the sky
        sky = mix(sky, vec3(0.10, 0.075, 0.055), uInside * 0.9);
        float k = uReflect * mix(1.0, 0.5, uInside);
        vec3 refl = sky * F * k;
        float a = clamp(F * k + uTint * (1.0 - F), 0.0, 1.0);
        vec3 body = vec3(0.05, 0.065, 0.065) * uTint;
        vec3 col = refl + body;
        col = vh_applyHaze(col, vW, cameraPosition) * (a > 0.0 ? 1.0 : 0.0);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    fog: false,
  });
}
