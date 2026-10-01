import * as THREE from 'three';
import { LAYER } from './UniverseGeometry.js';

/**
 * Cheap analytic 3D curl noise. The universe is static geometry — every layer is
 * baked in CPU at build time — so the only per-frame GPU work is rotating each
 * star around its own orbit axis, which is a handful of sin/cos. No noise in the
 * shader, no texture fetch per particle.
 */

const sharedUniforms = () => ({
  uTime: { value: 0 },
  uSizeScale: { value: 1 },
  uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
  uOpacity: { value: 1 },
  // Light direction in world space, normalised in the shader. Off-axis so the
  // sphere shows a lit side and a shadowed side instead of reading flat.
  uLightDir: { value: new THREE.Vector3(0.45, 0.62, 0.64).normalize() },
});

const sharedVertexDecls = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  attribute float aSpin;
  attribute float aLayer;
  attribute vec3 aOrbitAxis;
  attribute float aOrbitRadius;
  attribute float aOrbitSpeed;
  attribute float aOrbitPhase;

  uniform float uTime;
  uniform float uSizeScale;
  uniform float uPixelRatio;
  uniform vec3 uLightDir;

  varying vec3 vColor;
  varying float vShade;
  varying float vLimb;
  varying float vCentre;
  varying float vTwinkle;
  varying float vDepthFade;

  // Rodrigues rotation: spin p around unit axis k by angle a.
  vec3 rotateAxis(vec3 p, vec3 k, float a) {
    float c = cos(a);
    float s = sin(a);
    return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c);
  }
`;

/**
 * Fragments shared by all layers: a soft round sprite with a hot centre.
 * vShade (lambert) and vLimb (silhouette highlight) are what make the core read
 * as a sphere rather than a flat cloud of dots.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vColor;
  varying float vShade;
  varying float vLimb;
  varying float vCentre;
  varying float vTwinkle;
  varying float vDepthFade;

  uniform float uOpacity;
  uniform float uEmissive;   // 0 = lit surface, 1 = self-luminous glow
  uniform float uLimbBoost;
  uniform float uCentreBoost;
  uniform float uCoreTight;  // tighter sprite falloff for the core shell
  uniform float uAlphaTest;  // 0 = soft additive haze, >0 = depth-writing surface

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Falling off toward the sprite edge; the core needs a tighter profile so
    // neighbouring shell points stay individually distinguishable.
    float tight = mix(1.0, 1.9, uCoreTight);
    float core = exp(-d * d * 26.0 * tight);
    float halo = exp(-d * d * 6.2 * tight) * 0.42;
    float alpha = core + halo;

    // The core writes depth so the near half of the shell occludes the far half.
    // Points are drawn in buffer order, not front-to-back, so without this the
    // fainter sprite edges of far-side particles would write depth first and the
    // sphere would come out as a muddy blend instead of a surface. Discarding
    // sub-threshold fragments means they never write depth at all.
    if (alpha < uAlphaTest) discard;

    vec3 col = vColor * (0.72 + vTwinkle * 0.55);
    // Hot white centre.
    col += vec3(0.42, 0.55, 0.9) * core * 0.5 * (0.35 + vTwinkle * 0.65);

    // Surface shading: lambert term darkens the unlit side, limb brightens the
    // silhouette, and the centre term brightens the middle of the disc. Together
    // they give the core visible volume instead of a flat bright ring.
    col *= mix(1.0, vShade, 1.0 - uEmissive);
    col += vColor * vLimb * uLimbBoost;
    col += mix(vColor, vec3(1.0), 0.35) * vCentre * uCentreBoost;

    gl_FragColor = vec4(col, alpha * uOpacity * vDepthFade * mix(1.0, 0.34 + vShade * 0.66, 1.0 - uEmissive));
  }
`;

/**
 * Core sphere. The fragment colour is alpha-blended rather than additively
 * accumulated, and the layer is rendered with depthWrite so the near half of the
 * shell hides the far half — that occlusion is what gives the point cloud an
 * actual surface instead of a uniform bright disc.
 */
const coreVertexShader = /* glsl */ `
  precision highp float;
  ${sharedVertexDecls}

  void main() {
    vec3 pos = position;

    // Very slow co-rotation so the surface is alive without losing the sphere.
    float spin = uTime * 0.02;
    pos = rotateAxis(pos, vec3(0.0, 1.0, 0.0), spin);

    vec3 n = normalize(pos);
    vec3 toLight = normalize(uLightDir);
    float ndl = dot(n, toLight);
    // Wrapped diffuse: keeps the dark side readable instead of crushing to black.
    vShade = 0.28 + 0.72 * smoothstep(-0.35, 1.0, ndl);

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vec3 viewDir = normalize(cameraPosition - worldPos.xyz);
    // facing == 1 at the centre of the disc, 0 on the silhouette.
    float facing = abs(dot(n, viewDir));
    // Limb: brightest where the normal is perpendicular to the view direction,
    // i.e. on the silhouette. The strongest "this is a sphere" cue available
    // without a mesh.
    vLimb = pow(1.0 - facing, 3.0);
    // Centre-hot: makes the middle of the disc the brightest region so the core
    // reads as a glowing body rather than a lit ring. Diffuse alone leaves the
    // centre dark whenever the lit side happens to face away from the camera.
    vCentre = pow(facing, 2.2);

    float tw = 0.5 + 0.5 * sin(uTime * aSpin + aSeed * 6.2831);
    vTwinkle = tw * 0.5;
    vColor = color;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;
    // Fade the far hemisphere a touch so the silhouette stays crisp when the
    // camera pulls in close.
    vDepthFade = 0.55 + 0.45 * facing;

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (300.0 / max(dist, 1.0));
    gl_PointSize = clamp(gl_PointSize, 0.6, 14.0);
  }
`;

/** Dust haze: emissive, additive, no lighting term — it should look like fog. */
const dustVertexShader = /* glsl */ `
  precision highp float;
  ${sharedVertexDecls}

  void main() {
    vec3 pos = position;
    // A shared, gentle swirl plus a per-particle rate so the cloud drifts rather
    // than spinning as one rigid body.
    float radius = length(pos.xz);
    float ang = uTime * 0.035 * (1.0 / (1.0 + radius * 0.045));
    pos = vec3(pos.x * cos(ang) - pos.z * sin(ang), pos.y, pos.x * sin(ang) + pos.z * cos(ang));
    pos = rotateAxis(pos, vec3(0.0, 1.0, 0.0), sin(uTime * 0.05 + aSeed) * 0.09);

    vColor = color;
    float tw = 0.5 + 0.5 * sin(uTime * aSpin + aSeed * 6.2831);
    vTwinkle = tw;
    vShade = 1.0;
    vLimb = 0.0;
    vCentre = 0.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;
    vDepthFade = smoothstep(320.0, 20.0, dist);

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (300.0 / max(dist, 1.0));
    gl_PointSize = clamp(gl_PointSize, 0.55, 30.0);
  }
`;

/**
 * Stars. Each one is rotated around its own `aOrbitAxis` at `aOrbitSpeed`, with a
 * small nod to radius (not a perfect circle) so the field does not look like
 * concentric rings. All of it happens in the vertex shader, so the CPU cost is
 * one uniform update per frame regardless of star count.
 */
const starVertexShader = /* glsl */ `
  precision highp float;
  ${sharedVertexDecls}

  void main() {
    vec3 axis = normalize(aOrbitAxis);
    float ang = uTime * aOrbitSpeed + aOrbitPhase;
    // Wobble the orbital plane slightly over time: a precessing ellipse.
    vec3 planeAxis = normalize(cross(axis, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    vec3 pos = rotateAxis(position, planeAxis, sin(uTime * 0.03 + aOrbitPhase) * 0.12);
    pos = rotateAxis(pos, axis, ang);

    vColor = color;
    float tw = 0.5 + 0.5 * sin(uTime * aSpin + aSeed * 6.2831);
    vTwinkle = tw;
    vShade = 1.0;
    vLimb = 0.0;
    vCentre = 0.0;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = -mvPosition.z;
    vDepthFade = smoothstep(420.0, 30.0, dist);

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (300.0 / max(dist, 1.0));
    gl_PointSize = clamp(gl_PointSize, 0.6, 40.0);
  }
`;

function makeMaterial({
  vertexShader,
  blending,
  depthWrite,
  uEmissive,
  uLimbBoost,
  uCentreBoost,
  uCoreTight,
  uAlphaTest,
  opacity,
}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms(),
      uOpacity: { value: opacity },
      uEmissive: { value: uEmissive },
      uLimbBoost: { value: uLimbBoost },
      uCentreBoost: { value: uCentreBoost },
      uCoreTight: { value: uCoreTight },
      uAlphaTest: { value: uAlphaTest },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite,
    depthTest: true,
    blending,
    vertexColors: true,
  });
}

/** Opaque-ish shaded sphere shell — the object that must read as a sphere. */
export function createCoreMaterial() {
  return makeMaterial({
    vertexShader: coreVertexShader,
    blending: THREE.NormalBlending,
    depthWrite: true,
    uEmissive: 0.0,
    uLimbBoost: 0.9,
    uCentreBoost: 0.55,
    uCoreTight: 1.0,
    // Keeps ~55% of each sprite: a solid-ish disc that occludes, with a soft edge.
    uAlphaTest: 0.55,
    opacity: 0.95,
  });
}

/** Additive haze that softens the gap between the core and the star field. */
export function createDustMaterial() {
  return makeMaterial({
    vertexShader: dustVertexShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uEmissive: 1.0,
    uLimbBoost: 0.0,
    uCentreBoost: 0.0,
    uCoreTight: 0.0,
    uAlphaTest: 0.0,
    opacity: 0.85,
  });
}

/** Bright satellites orbiting the core. */
export function createStarMaterial() {
  return makeMaterial({
    vertexShader: starVertexShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uEmissive: 1.0,
    uLimbBoost: 0.0,
    uCentreBoost: 0.0,
    uCoreTight: 0.0,
    uAlphaTest: 0.0,
    opacity: 1.0,
  });
}

export { LAYER };
