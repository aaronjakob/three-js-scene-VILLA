import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// HDR pipeline: scene (MSAA, half-float) -> GTAO (depth-reconstructed normals,
// so alpha-tested foliage is respected) -> composite -> bloom -> filmic grade.

const compositeFrag = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform float uAOStrength;
uniform float uHasAO;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tScene, vUv);
  if (uHasAO > 0.5) {
    float ao = texture2D(tAO, vUv).r;
    ao = mix(1.0, ao, uAOStrength);
    c.rgb *= ao;
  }
  gl_FragColor = c;
}
`;

const finalFrag = /* glsl */ `
uniform sampler2D tColor;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uVignette;
uniform vec2 uResolution;
uniform float uTonemap;
varying vec2 vUv;

// ACES fitted (Stephen Hill)
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 color) {
  const mat3 ACESInputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602));
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
// AgX (Troy Sobotka / three.js port), punchy look
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutsetMatrix = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  // punchy
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, 0.0), vec3(1.25));
  color = luma + 1.25 * (color - luma) * 0.92;
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tColor, vUv).rgb * uExposure;
  c = uTonemap > 0.5 ? agx(c) : acesFitted(c);
  // grade in display-linear
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = c * uGain + uLift * (1.0 - c);
  c = clamp(c, 0.0, 1.0);
  vec3 s = toSRGB(c);
  // gentle S-curve
  s = mix(s, s * s * (3.0 - 2.0 * s), uContrast);
  // vignette
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float v = 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  s *= v;
  s += (hash(vUv * uResolution) - 0.5) / 255.0;
  gl_FragColor = vec4(s, 1.0);
}
`;

const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class Pipeline {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.q = quality;
    this.width = 1;
    this.height = 1;

    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
      depthTexture,
    });
    this.compRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

    if (quality.ao) {
      this.gtao = new GTAOPass(scene, camera, 2, 2);
      // use our resolved depth (respects alpha-tested foliage); normals from depth
      this.gtao.setGBuffer(depthTexture, undefined);
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtao.updateGtaoMaterial({
        radius: 0.9,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1.0,
        samples: quality.aoSamples ?? 16,
        distanceFallOff: 1.0,
        screenSpaceRadius: false,
      });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    }

    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tAO: { value: null },
        uAOStrength: { value: 0.85 },
        uHasAO: { value: quality.ao ? 1 : 0 },
      },
      vertexShader: quadVert,
      fragmentShader: compositeFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.compQuad = new FullScreenQuad(this.compMat);

    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.12, 0.4, 3.0);
    }

    this.grade = {
      exposure: 1.6,
      saturation: 1.1,
      contrast: 0.14,
      lift: new THREE.Vector3(0.006, 0.004, 0.0),
      gain: new THREE.Vector3(1.04, 1.0, 0.93),
      vignette: 0.16,
      tonemap: 1,
    };
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.compRT.texture },
        uExposure: { value: 1 },
        uSaturation: { value: 1 },
        uContrast: { value: 0 },
        uLift: { value: new THREE.Vector3() },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uVignette: { value: 0.15 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTonemap: { value: 1 },
      },
      vertexShader: quadVert,
      fragmentShader: finalFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.finalQuad = new FullScreenQuad(this.finalMat);
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    this.compRT.setSize(w, h);
    if (this.gtao) {
      const s = this.q.aoScale ?? 1;
      this.gtao.setSize(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
    }
    if (this.bloom) this.bloom.setSize(w, h);
    this.finalMat.uniforms.uResolution.value.set(w, h);
  }

  render(target = null) {
    const { renderer, scene, camera } = this;
    const P = this.profile;
    P?.('start');
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    P?.('scene');

    if (this.gtao) {
      this.gtao.camera = camera;
      this.gtao.render(renderer, null, this.sceneRT);
      this.compMat.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    }
    P?.('ao');
    renderer.setRenderTarget(this.compRT);
    this.compQuad.render(renderer);

    if (this.bloom) {
      this.bloom.renderToScreen = false;
      this.bloom.render(renderer, null, this.compRT, 0, false);
    }

    P?.('bloom');
    const u = this.finalMat.uniforms;
    const g = this.grade;
    u.uExposure.value = g.exposure;
    u.uSaturation.value = g.saturation;
    u.uContrast.value = g.contrast;
    u.uLift.value.copy(g.lift);
    u.uGain.value.copy(g.gain);
    u.uVignette.value = g.vignette;
    u.uTonemap.value = g.tonemap;
    renderer.setRenderTarget(target);
    this.finalQuad.render(renderer);
    P?.('final');
  }

  dispose() {
    this.sceneRT.dispose();
    this.compRT.dispose();
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.compMat.dispose();
    this.finalMat.dispose();
    this.compQuad.dispose();
    this.finalQuad.dispose();
  }
}
