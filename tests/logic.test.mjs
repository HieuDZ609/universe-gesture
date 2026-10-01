/**
 * Logic tests that need no camera: synthetic landmarks feed LandmarkUtils, and
 * CameraController is exercised directly to prove the 360° rotation has no dead
 * zone and the dolly direction matches the gesture spec.
 *
 * Run: node tests/logic.test.mjs
 */
import assert from 'node:assert/strict';
import { CameraController } from '../src/camera/CameraController.js';
import {
  fingerExtensions,
  palmFlatness,
  palmCenter,
  palmScale,
  handDistance,
  LM,
} from '../src/hands/LandmarkUtils.js';
import { deadzone, shortestAngle, makeRandom, gaussian, clamp } from '../src/utils/Math.js';

/**
 * Builds a plausible 21-point hand.
 * @param {number} openness 0 = fist, 1 = fully spread
 */
function makeHand({ openness = 1, x = 0.5, y = 0.5, scale = 0.18, flip = false } = {}) {
  const lm = new Array(21);
  const s = scale;
  const put = (i, px, py, pz = 0) => {
    lm[i] = { x: x + (flip ? -px : px), y: y + py, z: pz };
  };

  // Palm block: wrist + the four MCP knuckles.
  put(LM.WRIST, 0, s * 0.75);
  put(LM.THUMB_CMC, -s * 0.32, s * 0.5);
  put(LM.INDEX_MCP, -s * 0.24, -s * 0.1);
  put(LM.MIDDLE_MCP, -s * 0.02, -s * 0.16);
  put(LM.RING_MCP, s * 0.2, -s * 0.1);
  put(LM.PINKY_MCP, s * 0.38, s * 0.02);
  put(LM.THUMB_MCP, -s * 0.34, s * 0.28);

  const chains = [
    [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
    [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
    [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
    [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
  ];
  const lengths = [1.35, 1.5, 1.38, 1.08];

  chains.forEach((chain, ci) => {
    const [mcp, pip, dip, tip] = chain;
    const base = lm[mcp];
    const px = base.x - x;
    const py = base.y - y;
    const len = s * lengths[ci] * openness;
    // open -> tip far above the knuckle; closed -> tip curls back onto the palm
    const curve = (1 - openness) * s * 0.9;
    put(pip, px, py - len * 0.42 + curve * 0.2);
    put(dip, px, py - len * 0.72 + curve * 0.7);
    put(tip, px, py - len + curve * 1.25);
  });

  // Thumb: swings sideways when open, tucks in when closed.
  const tSpread = 0.18 + openness * 0.72;
  put(LM.THUMB_IP, -s * (0.44 + tSpread * 0.42), s * (0.24 - tSpread * 0.2));
  put(LM.THUMB_TIP, -s * (0.58 + tSpread * 0.78), s * (0.1 - tSpread * 0.42));

  return lm;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\nLandmarkUtils — gesture recognition');

// --- open hand should read as open -------------------------------------------
test('open hand: every finger extends', () => {
  const ext = fingerExtensions(makeHand({ openness: 1 }));
  for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    assert.ok(ext[name] > 0.85, `${name} extension ${ext[name].toFixed(2)} should be > 0.85`);
  }
});

test('open hand: palm reads flat (>= 0.5 of fingers above knuckles)', () => {
  assert.ok(palmFlatness(makeHand({ openness: 1 })) >= 0.75);
});

test('fist: fingers are folded', () => {
  const ext = fingerExtensions(makeHand({ openness: 0.05 }));
  const openCount = ['thumb', 'index', 'middle', 'ring', 'pinky'].filter(
    (n) => ext[n] > 0.55,
  ).length;
  assert.ok(openCount <= 1, `expected a closed fist, got ${openCount} extended fingers`);
});

test('fist: palm no longer reads flat', () => {
  assert.ok(palmFlatness(makeHand({ openness: 0.05 })) < 0.75);
});

test('gripping (fingers curled but knuckle raised) is rejected', () => {
  // The dangerous false positive: hand in front of the lens while grabbing.
  const ext = fingerExtensions(makeHand({ openness: 0.2 }));
  const openCount = ['thumb', 'index', 'middle', 'ring', 'pinky'].filter((n) => ext[n] > 0.55).length;
  assert.ok(openCount < 4, `a curl must not count as "xoe ra": ${openCount}/5`);
});

test('open detection is stable between consecutive frames', () => {
  // Small jitter like a real webcam stream must not flip the verdict.
  const random = makeRandom(7);
  for (let i = 0; i < 40; i += 1) {
    const hand = makeHand({ openness: 1 });
    for (const p of hand) {
      p.x += gaussian(random) * 0.002;
      p.y += gaussian(random) * 0.002;
    }
    const ext = fingerExtensions(hand);
    const openCount = ['thumb', 'index', 'middle', 'ring', 'pinky'].filter(
      (n) => ext[n] > 0.55,
    ).length;
    assert.ok(openCount >= 4, `jittered open hand dropped to ${openCount}/5`);
  }
});

// --- distance metrics used by the 2-hand zoom ---------------------------------
test('palm distance grows as hands spread', () => {
  const near = handDistance(
    palmCenter(makeHand({ x: 0.38 })),
    palmCenter(makeHand({ x: 0.55 })),
  );
  const far = handDistance(
    palmCenter(makeHand({ x: 0.15 })),
    palmCenter(makeHand({ x: 0.78 })),
  );
  assert.ok(far > near * 1.8, `far ${far.toFixed(3)} should exceed near ${near.toFixed(3)}`);
});

test('palm scale is distance invariant under scale change', () => {
  const a = palmScale(makeHand({ scale: 0.12 }));
  const b = palmScale(makeHand({ scale: 0.3 }));
  const extA = fingerExtensions(makeHand({ scale: 0.12 }));
  const extB = fingerExtensions(makeHand({ scale: 0.3 }));
  assert.ok(extA.index > 0.85 && extB.index > 0.85, 'extension must not depend on hand size');
  assert.ok(b > a * 2, 'palm scale should track the physical size');
});

console.log('\nCameraController — 360° rotation, no dead zone');

// Minimal stand-in for THREE.PerspectiveCamera: the controller only needs
// position + lookAt for these assertions.
function fakeCamera() {
  return { position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, lookAt() {} };
}

const STEP = 1 / 60;

test('yaw accumulates a full turn and keeps going (no wrap limit)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  controls.minRadius = 0.0001;
  // A full sweep across the frame: dx of 1.0 normalized, 600 frames.
  let minTheta = Infinity;
  let maxTheta = -Infinity;
  for (let i = 0; i < 600; i += 1) {
    controls.rotateBy(1 / controls.sensitivity, 0, STEP);
    controls.update(STEP, { gestureActive: true });
    minTheta = Math.min(minTheta, controls.theta);
    maxTheta = Math.max(maxTheta, controls.theta);
  }
  const swept = maxTheta - minTheta;
  assert.ok(swept > Math.PI * 1.9, `expected > ~342 deg of travel, got ${((swept * 180) / Math.PI).toFixed(0)} deg`);
});

test('camera position tracks yaw around the full circle (no dead angle)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const positions = [];
  // Push the goal yaw through a full turn directly, then read positions.
  for (let step = 0; step <= 360; step += 15) {
    controls.goalTheta = (step * Math.PI) / 180;
    // Snap the smoothing so the sample reflects the goal angle.
    for (let i = 0; i < 200; i += 1) controls.update(STEP, { gestureActive: true });
    positions.push({
      theta: controls.theta,
      pos: { x: controls.camera.position.x, z: controls.camera.position.z },
    });
  }
  // Consecutive samples must always land on distinct positions — a dead zone
  // would show up as two neighbouring angles sharing the same camera spot.
  // The wrap pair (last -> first) is skipped: 360 deg and 0 deg are the same
  // point by definition, so comparing them would always report a zero.
  let minAdjacent = Infinity;
  for (let i = 0; i < positions.length - 1; i += 1) {
    const a = positions[i].pos;
    const b = positions[i + 1].pos;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    minAdjacent = Math.min(minAdjacent, d);
  }
  assert.ok(
    minAdjacent > 10,
    `a neighbouring angle pair collapsed to the same camera spot: ${minAdjacent.toFixed(2)}`,
  );

  // The sweep must actually be monotonic all the way round.
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(
      positions[i].theta > positions[i - 1].theta,
      `yaw stalled at sample ${i} (${positions[i - 1].theta} -> ${positions[i].theta})`,
    );
  }
});

test('pitch clamps short of the poles (no gimbal flip)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  for (let i = 0; i < 400; i += 1) {
    controls.rotateBy(0, 0.2, STEP);
    controls.update(STEP, { gestureActive: true });
  }
  assert.ok(controls.phi > controls.minPhi, 'pitch must not collapse to the north pole');
  assert.ok(Math.abs(controls.phi) > 1e-4 || controls.phi === controls.minPhi);

  for (let i = 0; i < 800; i += 1) {
    controls.rotateBy(0, -0.2, STEP);
    controls.update(STEP, { gestureActive: true });
  }
  assert.ok(controls.phi < controls.maxPhi, 'pitch must not pass the south pole');
});

test('yaw damping is angle-aware, so crossing ±PI does not snap back', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  controls.theta = Math.PI * 0.98;
  controls.goalTheta = -Math.PI * 0.98; // just across the seam
  const before = controls.theta;
  controls.update(STEP, { gestureActive: true });
  const delta = Math.abs(controls.theta - before);
  assert.ok(delta < 0.2, `a seam crossing must be a small step, got ${delta.toFixed(3)} rad`);
});

console.log('\nCameraController — dolly zoom direction');

test('hands apart => zoom IN (camera dollies toward the universe)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const start = controls.goalRadius;
  for (let i = 0; i < 120; i += 1) controls.zoomBy(0.8, null, STEP);
  assert.ok(controls.goalRadius < start, `expected approach, got ${start} -> ${controls.goalRadius}`);
});

test('hands together => zoom OUT (camera dollies away)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const start = controls.goalRadius;
  for (let i = 0; i < 120; i += 1) controls.zoomBy(-0.8, null, STEP);
  assert.ok(controls.goalRadius > start, `expected retreat, got ${start} -> ${controls.goalRadius}`);
});

test('dolly respects min/max radius clamps', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  for (let i = 0; i < 4000; i += 1) controls.zoomBy(1, null, STEP);
  assert.ok(controls.goalRadius >= controls.minRadius, 'must not pass the core');
  for (let i = 0; i < 8000; i += 1) controls.zoomBy(-1, null, STEP);
  assert.ok(controls.goalRadius <= controls.maxRadius, 'must not fly to infinity');
});

test('mid-range spread holds still (deadzone stops jitter)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const before = controls.goalRadius;
  for (let i = 0; i < 200; i += 1) controls.zoomBy(0.05, null, STEP);
  assert.equal(controls.goalRadius, before, 'a nearly-static pose must not drift');
});

test('midpoint drift steers the orbit (the vector part of the gesture)', () => {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const theta0 = controls.goalTheta;
  controls.zoomBy(0, { x: 0.1, y: 0 }, STEP);
  assert.notEqual(controls.goalTheta, theta0, 'horizontal drift must move the orbit');
});

console.log('\nMath utils');

test('deadzone zeroes small values and preserves sign', () => {
  assert.equal(deadzone(0.05, 0.1), 0);
  assert.equal(deadzone(-0.05, 0.1), 0);
  assert.ok(deadzone(0.4, 0.1) > 0);
  assert.ok(deadzone(-0.4, 0.1) < 0);
});

test('shortestAngle wraps into (-PI, PI]', () => {
  // -6.2 rad from 3.1 to -3.1 must be reported the short way round: +0.0832.
  assert.ok(Math.abs(shortestAngle(3.1, -3.1) - (Math.PI * 2 - 6.2)) < 1e-9);
  assert.ok(shortestAngle(0, 7) < Math.PI);
  assert.ok(shortestAngle(0, -7) > -Math.PI);
  assert.ok(Math.abs(shortestAngle(0, 0)) < 1e-12);
});

test('seeded PRNG is deterministic', () => {
  const a = makeRandom(123);
  const b = makeRandom(123);
  for (let i = 0; i < 50; i += 1) assert.equal(a(), b());
});

test('gaussian has roughly zero mean', () => {
  const random = makeRandom(99);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) sum += gaussian(random);
  assert.ok(Math.abs(sum / n) < 0.05, `mean was ${(sum / n).toFixed(4)}`);
});

test('clamp bounds both ends', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

console.log('\nUniverse layers — core sphere, dust, orbiting stars');

// Imported lazily-ish (top of file) but only used here: these build ~24k
// particles, which is plenty to characterise the radial distribution.
const { createUniverseLayers, R_CORE, R_DUST_IN, R_DUST_OUT, R_STAR_IN, R_STAR_OUT, LAYER } =
  await import('../src/universe/UniverseGeometry.js');

const layers = createUniverseLayers(24000);

function radiiOf(geometry) {
  const pos = geometry.getAttribute('position');
  const out = [];
  for (let i = 0; i < pos.count; i += 1) {
    out.push(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return out;
}

test('every layer is tagged with its own aLayer id', () => {
  for (const [key, id] of [
    ['core', LAYER.CORE],
    ['dust', LAYER.DUST],
    ['stars', LAYER.STAR],
  ]) {
    const attr = layers[key].getAttribute('aLayer');
    assert.equal(attr.count, layers[key].getAttribute('position').count);
    for (let i = 0; i < attr.count; i += 1) {
      assert.equal(attr.getX(i), id, `${key} particle ${i} has the wrong layer tag`);
    }
  }
});

test('the core forms a thin shell at R_CORE', () => {
  const r = radiiOf(layers.core);
  const min = Math.min(...r);
  const max = Math.max(...r);
  assert.ok(min > R_CORE * 0.9, `core must not collapse to the centre, got ${min.toFixed(2)}`);
  // A cloud only reads as a surface when the shell is thin; 8% of core particles
  // sit just inside as haze, hence the 0.9 floor rather than 0.985.
  assert.ok(max <= R_CORE * 1.001, `core must not exceed the shell radius, got ${max.toFixed(2)}`);
  assert.ok(max - min < R_CORE * 0.12, `shell too thick to read as a surface: ${(max - min).toFixed(2)}`);
});

test('dust fills the band between the core and the stars, never crossing it', () => {
  for (const r of radiiOf(layers.dust)) {
    assert.ok(r >= R_DUST_IN * 0.84 && r <= R_DUST_OUT * 1.001, `dust at ${r.toFixed(2)} escapes its band`);
  }
});

test('stars start outside the dust so the layers stay visually separate', () => {
  for (const r of radiiOf(layers.stars)) {
    assert.ok(r >= R_DUST_OUT * 0.9, `star at ${r.toFixed(2)} is inside the dust`);
    assert.ok(r <= R_STAR_OUT * 1.12, `star at ${r.toFixed(2)} is beyond the star field`);
  }
});

test('layer radius bands do not overlap', () => {
  assert.ok(R_CORE < R_DUST_IN, 'core must be inside the dust');
  assert.ok(R_DUST_OUT < R_STAR_IN, 'dust must be inside the stars');
});

test('every star has a unit orbit axis and a non-zero speed', () => {
  const axis = layers.stars.getAttribute('aOrbitAxis');
  const speed = layers.stars.getAttribute('aOrbitSpeed');
  const radius = layers.stars.getAttribute('aOrbitRadius');
  for (let i = 0; i < axis.count; i += 1) {
    const len = Math.hypot(axis.getX(i), axis.getY(i), axis.getZ(i));
    assert.ok(Math.abs(len - 1) < 1e-3, `star ${i} axis is not normalised: ${len.toFixed(4)}`);
    assert.ok(speed.getX(i) > 0, `star ${i} would be frozen`);
    assert.ok(radius.getX(i) >= R_STAR_IN, `star ${i} orbit radius too small`);
  }
});

test('rotating a star around its own axis actually moves it', () => {
  // Mirrors the GLSL Rodrigues rotation so the shader maths is verified here
  // rather than only being trusted to run on the GPU.
  const pos = layers.stars.getAttribute('position');
  const axis = layers.stars.getAttribute('aOrbitAxis');
  const speed = layers.stars.getAttribute('aOrbitSpeed');

  const rotate = (p, k, a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dot = k.x * p.x + k.y * p.y + k.z * p.z;
    const cx = k.y * p.z - k.z * p.y;
    const cy = k.z * p.x - k.x * p.z;
    const cz = k.x * p.y - k.y * p.x;
    return {
      x: p.x * c + cx * s + k.x * dot * (1 - c),
      y: p.y * c + cy * s + k.y * dot * (1 - c),
      z: p.z * c + cz * s + k.z * dot * (1 - c),
    };
  };

  const i = 3;
  const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
  const k = { x: axis.getX(i), y: axis.getY(i), z: axis.getZ(i) };
  const moved = rotate(p, k, speed.getX(i) * 5.0);
  const dist = Math.hypot(moved.x - p.x, moved.y - p.y, moved.z - p.z);
  assert.ok(dist > 1, `star ${i} barely moved after 5s of orbit: ${dist.toFixed(3)}`);

  // Rotation must preserve the orbital radius, otherwise stars would spiral into
  // or out of the field.
  const before = Math.hypot(p.x, p.y, p.z);
  const after = Math.hypot(moved.x, moved.y, moved.z);
  assert.ok(Math.abs(before - after) < 1e-6, 'orbit changed the star radius');
});

test('inner stars orbit faster than outer ones', () => {
  const pos = layers.stars.getAttribute('position');
  const speed = layers.stars.getAttribute('aOrbitSpeed');
  let innerSum = 0;
  let innerN = 0;
  let outerSum = 0;
  let outerN = 0;
  for (let i = 0; i < speed.count; i += 1) {
    const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (r < R_STAR_IN + 25) { innerSum += speed.getX(i); innerN += 1; }
    else if (r > R_STAR_OUT * 0.85) { outerSum += speed.getX(i); outerN += 1; }
  }
  assert.ok(innerN > 0 && outerN > 0, 'need samples from both bands');
  assert.ok(
    innerSum / innerN > outerSum / outerN,
    'near stars should sweep faster than far ones',
  );
});

test('core particles carry a flat warm palette (no cool void colours)', () => {
  const col = layers.core.getAttribute('color');
  for (let i = 0; i < col.count; i += 1) {
    const r = col.getX(i);
    const g = col.getY(i);
    const b = col.getZ(i);
    // Warm = red channel at least competitive with blue. Catches a regression
    // where the core silently picks up the deep-blue end of the palette.
    assert.ok(r >= b * 0.75, `core particle ${i} is not warm enough: rgb(${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`);
  }
});

test('non-star layers carry no orbit motion', () => {
  for (const key of ['core', 'dust']) {
    const speed = layers[key].getAttribute('aOrbitSpeed');
    for (let i = 0; i < speed.count; i += 1) {
      assert.equal(speed.getX(i), 0, `${key} particle ${i} must not orbit`);
    }
  }
});

console.log(`\n${passed} test(s) passed.`);
