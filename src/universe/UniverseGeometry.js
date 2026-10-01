import * as THREE from 'three';
import { makeRandom, gaussian } from '../utils/Math.js';

/**
 * Three concentric particle layers that coexist forever — there is no morph.
 *
 *   CORE  a dense shell at R_CORE that must read as a solid sphere
 *   DUST  a turbulent, clumpy cloud hugging the core
 *   STARS far satellites on individual inclined orbits around the core
 *
 * Radii never overlap, so the eye can always separate the layers:
 *   core <= R_CORE | dust R_DUST_IN..R_DUST_OUT | stars R_STAR_IN..R_STAR_OUT
 */
export const R_CORE = 32;
export const R_DUST_IN = 40;
export const R_DUST_OUT = 78;
export const R_STAR_IN = 85;
export const R_STAR_OUT = 190;

export const LAYER = { CORE: 0, DUST: 1, STAR: 2 };

/** Share of the particle budget per layer. */
const LAYER_SHARE = {
  [LAYER.CORE]: 0.62,
  [LAYER.DUST]: 0.26,
  [LAYER.STAR]: 0.12,
};

function buildClusters(random, count) {
  const clusters = [];
  for (let i = 0; i < count; i += 1) {
    const dir = new THREE.Vector3(gaussian(random), gaussian(random), gaussian(random));
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(R_DUST_IN + random() * (R_DUST_OUT - R_DUST_IN));

    clusters.push({
      center: dir,
      radius: 6 + random() * 13,
      twist: 0.55 + random() * 0.9,
    });
  }
  return clusters;
}

const TWIST_AXIS = new THREE.Vector3(0.4, 0.85, -0.3).normalize();

/**
 * Dust particle: spiral arm or cluster knot, always between R_DUST_IN and
 * R_DUST_OUT so it forms a soft shell of haze around the core.
 */
function dustPosition(random, clusters, out) {
  const roll = random();

  if (roll < 0.44) {
    const arm = Math.floor(random() * 3) * ((Math.PI * 2) / 3);
    const t = random();
    const radius = R_DUST_IN + Math.pow(t, 0.62) * (R_DUST_OUT - R_DUST_IN);
    const spin = 1.05 + radius * 0.052;
    const scatter = gaussian(random) * (1.6 + radius * 0.07);
    const theta = arm + radius * spin + scatter * 0.55;
    // Thickness tapers toward the outer edge so the layer hugs the core.
    const thickness = 1.5 + (R_DUST_OUT - radius) * 0.18;
    const y = gaussian(random) * thickness;
    out.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
    return out;
  }

  if (roll < 0.78) {
    const cluster = clusters[Math.floor(random() * clusters.length)];
    out.set(gaussian(random), gaussian(random), gaussian(random));
    const l1 = Math.abs(out.x) + Math.abs(out.y) + Math.abs(out.z) + 1e-4;
    out.multiplyScalar((cluster.radius * Math.pow(random(), 0.55)) / (l1 / 1.732));
    out.applyAxisAngle(TWIST_AXIS, cluster.twist);
    out.add(cluster.center);
    // Clamp back into the dust band in case the cluster threw a knot outside it.
    const r = out.length();
    if (r > R_DUST_OUT) out.multiplyScalar(R_DUST_OUT / r);
    if (r < R_DUST_IN * 0.85) out.multiplyScalar((R_DUST_IN * 0.85) / (r || 1));
    return out;
  }

  out.set(gaussian(random), gaussian(random), gaussian(random));
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
  out.normalize().multiplyScalar(R_DUST_IN + Math.pow(random(), 0.4) * (R_DUST_OUT - R_DUST_IN));
  return out;
}

/**
 * Core shell position. A point cloud only reads as a *surface* when the shell is
 * thin relative to the sprite size and the front of the shell occludes the back,
 * so the radius is squeezed hard against R_CORE and biased toward the equator
 * (denser at the silhouette, where the limb highlight will be applied).
 */
function corePosition(random, out) {
  out.set(gaussian(random), gaussian(random), gaussian(random));
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
  out.normalize();

  // Thin shell: +/-0.22 world units on a radius of 32.
  let r = R_CORE * (0.985 + random() * 0.015);
  // 8% of the core sits just inside as a faint inner haze behind the shell.
  if (random() < 0.08) r *= 0.94 + random() * 0.04;
  return out.multiplyScalar(r);
}

const PALETTE = {
  deep: new THREE.Color('#0a1a4a'),
  blue: new THREE.Color('#2f6bff'),
  cyan: new THREE.Color('#48e8ff'),
  teal: new THREE.Color('#14c9b0'),
  violet: new THREE.Color('#8b5cf6'),
  magenta: new THREE.Color('#e879f9'),
  rose: new THREE.Color('#ff6b8b'),
  gold: new THREE.Color('#ffc46b'),
  amber: new THREE.Color('#ff8a3d'),
  white: new THREE.Color('#f2f8ff'),
};

const RAMPS = [
  [PALETTE.deep, PALETTE.blue, PALETTE.cyan],
  [PALETTE.blue, PALETTE.violet, PALETTE.magenta],
  [PALETTE.violet, PALETTE.rose, PALETTE.gold],
  [PALETTE.teal, PALETTE.cyan, PALETTE.white],
  [PALETTE.gold, PALETTE.amber, PALETTE.white],
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const tmpB = new THREE.Color();

function sampleRamp(ramp, k, out) {
  const span = ramp.length - 1;
  const scaled = clamp01(k) * span;
  const idx = Math.min(Math.floor(scaled), span - 1);
  out.copy(ramp[idx]).lerp(ramp[idx + 1], scaled - idx);
  return out;
}

/**
 * Core hue runs white -> gold -> amber, i.e. a warm plasma sphere. Dust and stars
 * stay cool-to-varied so the centre always reads as the hottest, brightest object.
 */
function buildCoreColor(random, out) {
  // Strictly the gold -> amber -> white ramp. Staying off the cool half of the
  // palette is deliberate: a blue core would blend into the dust and the eye
  // would lose the "hottest object at the centre" reading.
  sampleRamp(RAMPS[4], clamp01(random() * 0.72), out);
  return out;
}

function buildColor(random, r, out) {
  const clusterHit = random();
  let ramp;
  if (clusterHit < 0.34) ramp = RAMPS[4];
  else if (clusterHit < 0.56) ramp = RAMPS[2];
  else if (clusterHit < 0.72) ramp = RAMPS[3];
  else if (clusterHit < 0.86) ramp = RAMPS[1];
  else ramp = RAMPS[0];

  // Hot near the core, dim out in the field.
  const heat = clamp01(1 - (r - R_CORE) / (R_DUST_OUT - R_CORE));
  sampleRamp(ramp, clamp01(heat * 0.85 + random() * 0.3 - 0.08), out);
  return out;
}

/**
 * Builds the three particle layers.
 *
 * Shared attributes on every layer: position, color, aSize, aSeed, aSpin.
 * Orbit attributes exist on the star layer (and are zero elsewhere) so a single
 * shader can branch on aLayer without separate programs.
 *
 * The core's positions are additionally returned as `spherePositions` for tests.
 */
export function createUniverseLayers(count = 120000) {
  const random = makeRandom(0x5eed1e);
  const clusters = buildClusters(random, 26);

  const coreCount = Math.floor(count * LAYER_SHARE[LAYER.CORE]);
  const dustCount = Math.floor(count * LAYER_SHARE[LAYER.DUST]);
  const starCount = count - coreCount - dustCount;

  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const axis = new THREE.Vector3();

  const mk = (n) => ({
    positions: new Float32Array(n * 3),
    colors: new Float32Array(n * 3),
    sizes: new Float32Array(n),
    seeds: new Float32Array(n),
    spins: new Float32Array(n),
    orbitAxis: new Float32Array(n * 3),
    orbitRadius: new Float32Array(n),
    orbitSpeed: new Float32Array(n),
    orbitPhase: new Float32Array(n),
  });

  const core = mk(coreCount);
  const dust = mk(dustCount);
  const stars = mk(starCount);

  // ---- core: the visible sphere -------------------------------------------
  for (let i = 0; i < coreCount; i += 1) {
    corePosition(random, v);
    core.positions[i * 3] = v.x;
    core.positions[i * 3 + 1] = v.y;
    core.positions[i * 3 + 2] = v.z;

    buildCoreColor(random, c);
    core.colors[i * 3] = c.r;
    core.colors[i * 3 + 1] = c.g;
    core.colors[i * 3 + 2] = c.b;

    // Sprites must be large enough that the shell actually covers pixels. The
    // sphere subtends ~660px at the default dolly distance, and half the core
    // particles are depth-rejected (only the near half of the shell survives),
    // so this needs to be generous or the sphere reads as sparse confetti.
    core.sizes[i] = 1.15 + Math.pow(random(), 2.0) * 3.0;
    core.seeds[i] = random() * Math.PI * 2;
    core.spins[i] = 0.2 + random() * 0.8;
  }

  // ---- dust: haze around the sphere ---------------------------------------
  for (let i = 0; i < dustCount; i += 1) {
    dustPosition(random, clusters, v);
    dust.positions[i * 3] = v.x;
    dust.positions[i * 3 + 1] = v.y;
    dust.positions[i * 3 + 2] = v.z;

    buildColor(random, v.length(), c);
    dust.colors[i * 3] = c.r;
    dust.colors[i * 3 + 1] = c.g;
    dust.colors[i * 3 + 2] = c.b;

    dust.sizes[i] = 0.55 + Math.pow(random(), 3.2) * 2.4;
    dust.seeds[i] = random() * Math.PI * 2;
    dust.spins[i] = 0.3 + random() * 1.6;
  }

  // ---- stars: individual orbits around the core ---------------------------
  for (let i = 0; i < starCount; i += 1) {
    // Randomly inclined orbital plane, biased away from the poles so most
    // orbits read as circling the sphere rather than seen edge-on as a line.
    axis.set(gaussian(random), gaussian(random) * 0.55, gaussian(random));
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    axis.normalize();

    const orbitRadius = R_STAR_IN + Math.pow(random(), 0.7) * (R_STAR_OUT - R_STAR_IN);

    // Start the star somewhere on its own orbit plane, then let the shader spin
    // it around `axis` over time. Eccentricity via a radius jitter so orbits do
    // not look like a set of concentric perfect circles.
    const phi = random() * Math.PI * 2;
    const tilt = 0.86 + random() * 0.28;
    v.set(Math.cos(phi) * orbitRadius, 0, Math.sin(phi) * orbitRadius);
    v.applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
    v.applyAxisAngle(axis, random() * Math.PI * 2);
    v.normalize().multiplyScalar(orbitRadius * (0.94 + random() * 0.12));

    stars.positions[i * 3] = v.x;
    stars.positions[i * 3 + 1] = v.y;
    stars.positions[i * 3 + 2] = v.z;

    stars.orbitAxis[i * 3] = axis.x;
    stars.orbitAxis[i * 3 + 1] = axis.y;
    stars.orbitAxis[i * 3 + 2] = axis.z;
    stars.orbitRadius[i] = orbitRadius;
    // Keplerian-looking falloff: inner stars sweep faster than distant ones.
    stars.orbitSpeed[i] = (0.05 + random() * 0.09) * Math.pow(R_STAR_OUT / orbitRadius, 1.5);
    stars.orbitPhase[i] = random() * Math.PI * 2;

    const hot = random();
    sampleRamp(hot < 0.4 ? RAMPS[3] : hot < 0.78 ? RAMPS[0] : RAMPS[4], 0.35 + random() * 0.65, c);
    stars.colors[i * 3] = c.r;
    stars.colors[i * 3 + 1] = c.g;
    stars.colors[i * 3 + 2] = c.b;

    stars.sizes[i] = 0.7 + Math.pow(random(), 3.8) * 4.2;
    stars.seeds[i] = random() * Math.PI * 2;
    stars.spins[i] = 0.4 + random() * 2.4;
  }

  const toGeometry = (data, layer) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(data.seeds, 1));
    g.setAttribute('aSpin', new THREE.BufferAttribute(data.spins, 1));
    g.setAttribute('aOrbitAxis', new THREE.BufferAttribute(data.orbitAxis, 3));
    g.setAttribute('aOrbitRadius', new THREE.BufferAttribute(data.orbitRadius, 1));
    g.setAttribute('aOrbitSpeed', new THREE.BufferAttribute(data.orbitSpeed, 1));
    g.setAttribute('aOrbitPhase', new THREE.BufferAttribute(data.orbitPhase, 1));

    // aLayer is constant per object, so one shared array keeps the shader simple.
    const n = data.sizes.length;
    const layerArr = new Float32Array(n).fill(layer);
    g.setAttribute('aLayer', new THREE.BufferAttribute(layerArr, 1));

    g.computeBoundingSphere();
    // The shader moves particles outside the authored positions (orbits), so the
    // computed bounds are wrong; set a sphere that comfortably covers all layers.
    g.boundingSphere.radius = R_STAR_OUT * 1.1;
    g.boundingSphere.center.set(0, 0, 0);
    return g;
  };

  return {
    core: toGeometry(core, LAYER.CORE),
    dust: toGeometry(dust, LAYER.DUST),
    stars: toGeometry(stars, LAYER.STAR),
    counts: { core: coreCount, dust: dustCount, stars: starCount },
  };
}
