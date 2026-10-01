/**
 * End-to-end gesture tests: synthetic hands are pushed through the real
 * GestureMapper + GestureArbiter + CameraController chain and we assert on the
 * resulting camera motion.
 *
 * The one thing this cannot fake is MediaPipe itself — the landmark geometry is
 * synthesised here, so `tests/logic.test.mjs` covers that half separately.
 *
 * Run: node tests/gestures.test.mjs
 */
import assert from 'node:assert/strict';
import { CameraController } from '../src/camera/CameraController.js';
import { GestureMapper, GestureArbiter } from '../src/gestures/GestureMapper.js';
import { GESTURE } from '../src/hands/HandTracker.js';
import { palmCenter, palmFlatness, fingerExtensions } from '../src/hands/LandmarkUtils.js';
import { makeRandom, gaussian } from '../src/utils/Math.js';
import { readFileSync } from 'node:fs';

const STEP = 1 / 60;
/** Radians -> degrees. */
const toDeg = (rad) => (rad * 180) / Math.PI;

// --- synthetic hand factory (reused from logic.test.mjs) ----------------------
function makeHand({ openness = 1, x = 0.5, y = 0.5, scale = 0.16 } = {}) {
  const lm = new Array(21);
  const s = scale;
  const put = (i, px, py) => {
    lm[i] = { x: x + px, y: y + py, z: 0 };
  };
  put(0, 0, s * 0.75);
  put(1, -s * 0.32, s * 0.5);
  put(5, -s * 0.24, -s * 0.1);
  put(9, -s * 0.02, -s * 0.16);
  put(13, s * 0.2, -s * 0.1);
  put(17, s * 0.38, s * 0.02);
  put(2, -s * 0.34, s * 0.28);

  const chains = [
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  const lengths = [1.35, 1.5, 1.38, 1.08];
  chains.forEach(([mcp, pip, dip, tip], ci) => {
    const px = lm[mcp].x - x;
    const py = lm[mcp].y - y;
    const len = s * lengths[ci] * openness;
    const curve = (1 - openness) * s * 0.9;
    put(pip, px, py - len * 0.42 + curve * 0.2);
    put(dip, px, py - len * 0.72 + curve * 0.7);
    put(tip, px, py - len + curve * 1.25);
  });

  const tSpread = 0.18 + openness * 0.72;
  put(3, -s * (0.44 + tSpread * 0.42), s * (0.24 - tSpread * 0.2));
  put(4, -s * (0.58 + tSpread * 0.78), s * (0.1 - tSpread * 0.42));
  return lm;
}

/** Mirrors what HandTracker builds per detection frame. */
function toHandState(lm, id) {
  const ext = fingerExtensions(lm);
  const extendedCount = ['thumb', 'index', 'middle', 'ring', 'pinky'].filter(
    (n) => ext[n] > 0.55,
  ).length;
  return {
    id,
    open: extendedCount >= 4 && palmFlatness(lm) >= 0.5,
    center: palmCenter(lm),
    extendedCount,
    extensions: ext,
  };
}

/** Replicates the tracker's ZOOM baseline + spread maths. */
function buildState(handList, aspect = 16 / 9, baseline = null) {
  const open = handList.filter((h) => h.open);
  const state = {
    hands: open,
    handCount: open.length,
    handDistance: 0,
    center: { x: 0.5, y: 0.5 },
    baselineDistance: baseline ?? 0.3,
    baselineCenter: { x: 0.5, y: 0.5 },
    spread: 0,
    gesture: GESTURE.IDLE,
  };

  if (open.length >= 2) {
    const [l, r] = open;
    state.handDistance = Math.hypot((l.center.x - r.center.x) * aspect, l.center.y - r.center.y);
    state.center = { x: (l.center.x + r.center.x) / 2, y: (l.center.y + r.center.y) / 2 };
    state.gesture = GESTURE.ZOOM;
    const ratio = state.handDistance / state.baselineDistance;
    const smoothed = Math.max(-1, Math.min(1, (ratio - 1) * 2.2));
    state.spread += (smoothed - state.spread) * (1 - Math.exp(-14 * STEP));
  } else if (open.length === 1) {
    state.center = { x: open[0].center.x, y: open[0].center.y };
    state.gesture = GESTURE.ROTATE;
  }
  return state;
}

function fakeCamera() {
  return {
    position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt() {},
  };
}

function setup() {
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const mapper = new GestureMapper(controls);
  return { controls, mapper };
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

console.log('\nGesture arbitration');

test('a fleeting hand does not take control (hold time)', () => {
  const arbiter = new GestureArbiter({ holdMs: 220 });
  let t = 0;
  arbiter.observe(GESTURE.ROTATE, t);
  // 100ms later the hand is gone again — below the hold threshold.
  t = 100;
  assert.equal(arbiter.resolve(GESTURE.IDLE, t), GESTURE.IDLE, 'must not switch yet');
  // Sustained past the threshold, it does take over.
  t = 260;
  assert.equal(arbiter.resolve(GESTURE.IDLE, t), GESTURE.ROTATE);
});

test('a single dropped frame mid-gesture does not drop control', () => {
  const arbiter = new GestureArbiter({ holdMs: 220 });
  let t = 0;

  // Zoom is proposed and held past the threshold, so it takes over.
  arbiter.observe(GESTURE.ZOOM, t);
  assert.equal(arbiter.resolve(GESTURE.IDLE, t), GESTURE.IDLE, 'must not switch instantly');
  t = 250;
  arbiter.observe(GESTURE.ZOOM, t);
  assert.equal(arbiter.resolve(GESTURE.IDLE, t), GESTURE.ZOOM);

  // One frame with no hands. The candidate flips to IDLE, but the hold
  // requirement means ZOOM keeps control across the gap.
  t = 266;
  arbiter.observe(GESTURE.IDLE, t);
  assert.equal(arbiter.resolve(GESTURE.ZOOM, t), GESTURE.ZOOM, 'a dropped frame released control');

  // Hands come straight back, so the candidate returns to ZOOM.
  t = 300;
  arbiter.observe(GESTURE.ZOOM, t);
  assert.equal(arbiter.resolve(GESTURE.ZOOM, t), GESTURE.ZOOM);
});

console.log('\nOne open hand → 360° rotation, no dead angle');

test('sweeping one hand across the frame turns the camera a full circle', () => {
  const { controls, mapper } = setup();

  // Hand starts on the left edge, sweeps right and wraps to the left again.
  let minTheta = Infinity;
  let maxTheta = -Infinity;
  for (let i = 0; i <= 400; i += 1) {
    const phase = i / 40;
    const x = 0.5 + Math.sin(phase) * 0.42;
    const y = 0.5;
    const state = buildState([toHandState(makeHand({ x, y }), 0)]);
    mapper.update(state, GESTURE.ROTATE, STEP);
    controls.update(STEP, { gestureActive: true });
    minTheta = Math.min(minTheta, controls.theta);
    maxTheta = Math.max(maxTheta, controls.theta);
  }

  // A sinusoid traces left->right->left->right, so the camera turns both ways.
  // The point of the sweep is that yaw keeps accumulating instead of resetting.
  assert.ok(
    toDeg(maxTheta - minTheta) > 90,
    `expected > 90 deg of travel, got ${toDeg(maxTheta - minTheta).toFixed(0)} deg`,
  );
});

test('a monotonic hand sweep turns the camera strictly one way', () => {
  const { controls, mapper } = setup();
  const STEP_X = 0.84 / 150;
  let previous = controls.theta;
  let wrongWay = 0;
  let frames = 0;

  for (let pass = 0; pass < 3; pass += 1) {
    // Hand leaves the frame and comes back at the left edge, so the mapper
    // re-anchors exactly as it would in real use.
    mapper.update(buildState([]), GESTURE.IDLE, STEP);
    for (let i = 0; i < 150; i += 1) {
      const x = 0.08 + i * STEP_X;
      const state = buildState([toHandState(makeHand({ x }), 0)]);
      mapper.update(state, GESTURE.ROTATE, STEP);
      controls.update(STEP, { gestureActive: true });
      // i === 0 is the re-anchor frame: the mapper deliberately captures the
      // hand's position instead of applying a jump from wherever it was before.
      if (i > 0 && controls.theta >= previous - 1e-12) wrongWay += 1;
      previous = controls.theta;
      frames += 1;
    }
  }

  assert.equal(wrongWay, 0, `${wrongWay}/${frames} frames failed to follow the hand`);
});

test('a stationary open hand holds the view still', () => {
  const { controls, mapper } = setup();
  for (let i = 0; i < 120; i += 1) {
    const state = buildState([toHandState(makeHand({ x: 0.5, y: 0.5 }), 0)]);
    mapper.update(state, GESTURE.ROTATE, STEP);
    controls.update(STEP, { gestureActive: true });
  }
  assert.ok(Math.abs(controls.theta) < 0.02, `yaw drifted to ${controls.theta}`);
  assert.ok(
    Math.abs(toDeg(controls.phi) - 78) < 1.2,
    `pitch drifted to ${toDeg(controls.phi).toFixed(1)} deg`,
  );
});

test('a wobbling hand produces no visible twitch', () => {
  const { controls, mapper } = setup();
  const random = makeRandom(4242);
  const thetas = [];
  for (let i = 0; i < 180; i += 1) {
    const x = 0.5 + gaussian(random) * 0.0015;
    const state = buildState([toHandState(makeHand({ x }), 0)]);
    mapper.update(state, GESTURE.ROTATE, STEP);
    controls.update(STEP, { gestureActive: true });
    thetas.push(controls.theta);
  }
  let maxStep = 0;
  for (let i = 1; i < thetas.length; i += 1) {
    maxStep = Math.max(maxStep, Math.abs(thetas[i] - thetas[i - 1]));
  }
  assert.ok(maxStep < 0.01, `jitter produced a ${maxStep.toFixed(4)} rad step`);
});

test('rotation does not change the dolly distance', () => {
  const { controls, mapper } = setup();
  const start = controls.goalRadius;
  for (let i = 0; i < 300; i += 1) {
    const x = 0.2 + i * 0.001;
    const state = buildState([toHandState(makeHand({ x }), 0)]);
    mapper.update(state, GESTURE.ROTATE, STEP);
  }
  assert.equal(controls.goalRadius, start, 'rotation must not zoom');
});

console.log('\nTwo open hands → zoom');

test('spreading both hands pulls the camera in', () => {
  const { controls, mapper } = setup();
  const start = controls.goalRadius;

  // Baseline is captured with the hands at the "đưa vào màn hình" width, then
  // the hands move apart.
  const baselineState = buildState(
    [toHandState(makeHand({ x: 0.35 }), 0), toHandState(makeHand({ x: 0.65 }), 1)],
  );
  const baseline = baselineState.handDistance;

  for (let i = 0; i < 90; i += 1) {
    const gap = 0.15 + (i / 90) * 0.22;
    const state = buildState(
      [toHandState(makeHand({ x: 0.5 - gap }), 0), toHandState(makeHand({ x: 0.5 + gap }), 1)],
      16 / 9,
      baseline,
    );
    mapper.update(state, GESTURE.ZOOM, STEP);
  }

  assert.ok(
    controls.goalRadius < start,
    `spreading must zoom IN: ${start} -> ${controls.goalRadius.toFixed(1)}`,
  );
});

test('bringing both hands together pushes the camera out', () => {
  const { controls, mapper } = setup();
  const start = controls.goalRadius;

  // Baseline is captured wide; the hands then squeeze inward past it.
  const baseline = buildState(
    [toHandState(makeHand({ x: 0.22 }), 0), toHandState(makeHand({ x: 0.78 }), 1)],
  ).handDistance;

  for (let i = 0; i < 90; i += 1) {
    const gap = 0.28 - (i / 90) * 0.24;
    const state = buildState(
      [toHandState(makeHand({ x: 0.5 - gap }), 0), toHandState(makeHand({ x: 0.5 + gap }), 1)],
      16 / 9,
      baseline,
    );
    mapper.update(state, GESTURE.ZOOM, STEP);
  }

  assert.ok(
    controls.goalRadius > start,
    `squeezing must zoom OUT: ${start} -> ${controls.goalRadius.toFixed(1)}`,
  );
});

test('zoom and rotation do not fight each other', () => {
  const { controls, mapper } = setup();
  const baseline = buildState(
    [toHandState(makeHand({ x: 0.35 }), 0), toHandState(makeHand({ x: 0.65 }), 1)],
  ).handDistance;
  const radiusBefore = controls.goalRadius;

  // Two hands held at the baseline width, dead centre: must not move at all.
  for (let i = 0; i < 120; i += 1) {
    const state = buildState(
      [toHandState(makeHand({ x: 0.35 }), 0), toHandState(makeHand({ x: 0.65 }), 1)],
      16 / 9,
      baseline,
    );
    mapper.update(state, GESTURE.ZOOM, STEP);
  }
  assert.ok(
    Math.abs(controls.goalRadius - radiusBefore) < 1e-6,
    'a still two-hand pose must not zoom',
  );
});

test('the two-hand vector component steers the orbit while zooming', () => {
  const { controls, mapper } = setup();
  const baseline = buildState(
    [toHandState(makeHand({ x: 0.35 }), 0), toHandState(makeHand({ x: 0.65 }), 1)],
  ).handDistance;
  const thetaBefore = controls.goalTheta;

  // Drift the whole pair left while spreading.
  for (let i = 0; i < 60; i += 1) {
    const gap = 0.15 + (i / 60) * 0.15;
    const shift = -0.05 * (i / 60);
    const state = buildState(
      [toHandState(makeHand({ x: 0.5 - gap + shift }), 0), toHandState(makeHand({ x: 0.5 + gap + shift }), 1)],
      16 / 9,
      baseline,
    );
    mapper.update(state, GESTURE.ZOOM, STEP);
  }
  assert.notEqual(controls.goalTheta, thetaBefore, 'midpoint drift must steer the orbit');
});

test('a closed fist changes nothing', () => {
  const { controls, mapper } = setup();
  const startRadius = controls.goalRadius;
  const startTheta = controls.goalTheta;

  for (let i = 0; i < 120; i += 1) {
    const fist = toHandState(makeHand({ openness: 0.05, x: 0.3 + i * 0.002 }), 0);
    const state = buildState([fist]);
    mapper.update(state, state.gesture, STEP);
  }

  assert.equal(controls.goalRadius, startRadius, 'a fist must not zoom');
  assert.equal(controls.goalTheta, startTheta, 'a fist must not rotate');
});

console.log('\nFull-frame simulation');

test('a realistic session: rotate, then zoom, then release', () => {
  const { controls, mapper } = setup();
  const arbiter = new GestureArbiter({ holdMs: 220 });
  const random = makeRandom(11);
  let active = GESTURE.IDLE;
  let t = 0;

  const run = (frames, makeState) => {
    for (let i = 0; i < frames; i += 1) {
      t += STEP * 1000;
      const state = makeState(i);
      arbiter.observe(state.gesture, t);
      active = arbiter.resolve(active, t);
      mapper.update(state, active, STEP);
      controls.update(STEP, { gestureActive: active !== GESTURE.IDLE });
    }
  };

  const jitter = () => gaussian(random) * 0.004;

  // 3s: one open hand sweeping left to right and back.
  run(180, (i) => {
    const x = 0.5 + Math.sin((i / 45) * Math.PI) * 0.35 + jitter();
    return buildState([toHandState(makeHand({ x, y: 0.5 + jitter() }), 0)]);
  });
  assert.ok(Math.abs(controls.theta) > 0.05, 'rotation phase did not move the camera');

  // 1s: hand held still, letting the smoothing catch up to the goal yaw.
  run(60, () => buildState([toHandState(makeHand({ x: 0.5 }), 0)]));
  const settledTheta = controls.theta;
  const settledRadius = controls.radius;

  // 2s more: the still hand must not push the camera anywhere.
  run(120, () => buildState([toHandState(makeHand({ x: 0.5 }), 0)]));
  assert.ok(
    Math.abs(controls.theta - settledTheta) < 0.01,
    `yaw drifted while the hand was still (${settledTheta.toFixed(4)} -> ${controls.theta.toFixed(4)})`,
  );
  assert.ok(
    Math.abs(controls.radius - settledRadius) < 0.01,
    'zoom drifted while the hand was still',
  );

  // 3s: two hands, spread wide then squeezed in.
  const baseline = buildState(
    [toHandState(makeHand({ x: 0.35 }), 0), toHandState(makeHand({ x: 0.65 }), 1)],
  ).handDistance;
  const radiusBeforeZoom = controls.goalRadius;
  run(180, (i) => {
    const gap = 0.16 + (i < 90 ? i / 90 : (180 - i) / 90) * 0.2;
    return buildState(
      [toHandState(makeHand({ x: 0.5 - gap + jitter() * 0.2 }), 0),
       toHandState(makeHand({ x: 0.5 + gap + jitter() * 0.2 }), 1)],
      16 / 9,
      baseline,
    );
  });
  assert.ok(controls.goalRadius < radiusBeforeZoom - 5, 'the zoom phase should pull in noticeably');

  // 1.5s: hands dropped entirely -> back to idle.
  run(90, () => buildState([]));
  assert.equal(active, GESTURE.IDLE, 'control was not released');

  // The camera is still in a valid, bounded state after the whole session.
  assert.ok(controls.radius >= controls.minRadius && controls.radius <= controls.maxRadius);
  assert.ok(Number.isFinite(controls.theta) && Number.isFinite(controls.phi));
  assert.ok(controls.phi > controls.minPhi && controls.phi < controls.maxPhi);
});

console.log('\nArbiter wiring contract (regression: main.js argument order)');

test('observe() result must not be fed back in as the active gesture', () => {
  // The bug this guards against:
  //   arbiter.resolve(arbiter.observe(candidate, now), state.gesture)
  // That swaps the roles: resolve() then compares a gesture *string* against a
  // timestamp, `nowMs - since` is NaN, and the hold time never fires, so every
  // gesture snaps on instantly. Simulate the real call sequence to prove the
  // correct order does gate the switch.
  const arbiter = new GestureArbiter({ holdMs: 110 });
  let active = GESTURE.IDLE;
  let t = 0;

  // A hand flashes past for 60ms — under the hold threshold.
  for (let i = 0; i < 4; i += 1) {
    t += 16;
    arbiter.observe(GESTURE.ROTATE, t);
    active = arbiter.resolve(active, t);
  }
  assert.equal(active, GESTURE.IDLE, 'a 60ms flash took control; hold time is being skipped');

  // Held for 300ms, it does take over.
  for (let i = 0; i < 20; i += 1) {
    t += 16;
    arbiter.observe(GESTURE.ROTATE, t);
    active = arbiter.resolve(active, t);
  }
  assert.equal(active, GESTURE.ROTATE, 'a sustained pose never took control');
});

test('the shipped hold time is short enough to feel responsive', () => {
  // main.js constructs the arbiter with this value; 110ms is one settle frame
  // plus a little. If someone raises it for safety, this fails and makes the
  // trade-off explicit.
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const match = source.match(/new GestureArbiter\(\{\s*holdMs:\s*(\d+)/);
  assert.ok(match, 'could not find the holdMs the app is actually configured with');
  const shipped = Number(match[1]);
  assert.ok(shipped <= 110, `holdMs is ${shipped}ms; response will feel sluggish`);
});

test('zoom reaches a useful speed within a second of a full spread', () => {
  // Guards the sensitivity change: a full-spread pull used to take noticeably
  // longer to move the camera. 1s of sustained spread should now cover real
  // ground.
  const controls = new CameraController(fakeCamera());
  controls.enableAutoSpin = false;
  const start = controls.goalRadius;
  for (let i = 0; i < 60; i += 1) controls.zoomBy(1, null, STEP);
  const moved = start - controls.goalRadius;
  assert.ok(moved > 30, `1s of full spread only moved ${moved.toFixed(1)} units`);
  assert.ok(moved < start, 'zoom went the wrong way');
});

console.log(`\n${passed} test(s) passed.`);
