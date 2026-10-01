import { createRenderer, createScene, createCamera, bindResize, detectQuality, QUALITY } from './core/App.js';
import { Universe } from './universe/Universe.js';
import { CameraController } from './camera/CameraController.js';
import { HandTracker, GESTURE } from './hands/HandTracker.js';
import { GestureMapper, GestureArbiter } from './gestures/GestureMapper.js';
import { HandOverlay } from './ui/HandOverlay.js';
import { HUD } from './ui/HUD.js';
import { damp } from './utils/Math.js';

const container = document.getElementById('app');
const boot = document.getElementById('boot');
const bootLabel = document.getElementById('boot-label');
const gate = document.getElementById('gate');
const startBtn = document.getElementById('start');
const camEl = document.getElementById('cam');

const qualityName = detectQuality();
const quality = QUALITY[qualityName];

let renderer;
let scene;
let camera;
let controls;
let universe;
let tracker;
let unbindResize = null;
let started = false;
let loopRunning = false;

const hud = new HUD();
const overlay = new HandOverlay(document.getElementById('cam-overlay'));
const clock = { last: performance.now() };

// ---------------------------------------------------------------- mouse input
const pointer = { down: false, x: 0, y: 0, id: -1 };

function bindPointer() {
  const el = renderer.domElement;

  el.addEventListener('pointerdown', (e) => {
    if (pointer.down) return;
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    controls.rotateByPixels(dx, dy, container.clientHeight);
  });

  const release = (e) => {
    if (e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = -1;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      controls.zoomByWheel(e.deltaY);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
      if (cameraOff) {
        hud.toast('Camera đang tắt — bấm phím C hoặc nút BẬT để bật lại', 'err');
        return;
      }
      tracker.setEnabled(!tracker.enabled);
      hud.setCameraLive(tracker.enabled, tracker.enabled ? 'TRACKING' : 'TRACKING OFF');
      hud.toast(tracker.enabled ? 'Nhận diện tay: BẬT' : 'Nhận diện tay: TẮT');
    } else if (e.key === 'h' || e.key === 'H') {
      hud.toggle();
    } else if (e.key === 'r' || e.key === 'R') {
      controls.reset();
      universe.reset();
      tracker.recalibrate();
      hud.toast('Đã đặt lại góc nhìn');
    } else if (e.key === 'f' || e.key === 'F') {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    } else if (e.key === 'c' || e.key === 'C') {
      toggleCamera();
    }
  });
}

// ------------------------------------------------------------- gesture wiring

let mapper = null;
const arbiter = new GestureArbiter({ holdMs: 110 });

// ------------------------------------------------------------------- main loop

let fps = 60;
let frame = 0;

function loop(now) {
  if (!loopRunning) return;
  requestAnimationFrame(loop);

  const dt = Math.min((now - clock.last) / 1000, 0.1);
  clock.last = now;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;

  const state = tracker.update(now, dt);
  // observe() reports what the tracker *suggests*; resolve() promotes it to active
  // only after it has held for arbiter.holdMs. Order matters: swapping these two
  // arguments makes resolve() compare a gesture string against a timestamp, so the
  // hold time silently never fires.
  arbiter.observe(tracker.candidate, now);
  const gesture = arbiter.resolve(state.gesture, now);
  tracker.commit(gesture);
  mapper.update(state, gesture, dt);

  const gestureActive = gesture !== GESTURE.IDLE;
  controls.update(dt, { gestureActive });
  universe.setAutoRotate(!gestureActive && !pointer.down && controls.enableAutoSpin);
  universe.update(dt, controls.distance);

  renderer.render(scene, camera);

  // HUD at ~20Hz: the DOM does not need 60 updates per second.
  if (frame % 3 === 0) {
    hud.update(state, gesture, controls.distance, fps);
    overlay.draw(state, gesture);
  }
  frame += 1;
}

// ---------------------------------------------------------------------- boot

function buildScene() {
  renderer = createRenderer(container, quality);
  scene = createScene();
  camera = createCamera(container);
  controls = new CameraController(camera);
  mapper = new GestureMapper(controls);
  universe = new Universe({ count: quality.count });
  scene.add(universe.group);
  unbindResize = bindResize(container, camera, renderer);
}

function setProgress(text) {
  bootLabel.textContent = text;
}

/**
 * Turns the camera off (and back on) on explicit user request.
 *
 * `getUserMedia` only prompts once, so a returning user can re-enable the
 * stream without reloading. Every stop() here actually releases the device —
 * that is the point: the browser's recording indicator should go out.
 */
let cameraOff = false;

async function toggleCamera() {
  if (!started) return;

  if (cameraOff) {
    try {
      setProgress('Đang bật lại camera…');
      await tracker.startCamera();
      camEl.srcObject = tracker.stream;
      await camEl.play().catch(() => {});
      tracker.setEnabled(true);
      cameraOff = false;
      hud.setCameraOn();
      hud.toast('Camera đã bật');
    } catch (err) {
      hud.toast(`Không bật được camera: ${err.message}`, 'err');
    }
    boot.classList.add('hidden');
    return;
  }

  tracker.stopCamera();
  camEl.srcObject = null;
  cameraOff = true;
  hud.setCameraOff();
  hud.toast('Camera đã tắt — vẫn điều khiển được bằng chuột');
}

async function bootSequence() {
  gate.classList.remove('hidden');
  boot.classList.remove('hidden');

  setProgress('Đang mở camera…');
  try {
    await tracker.startCamera();
  } catch (err) {
    boot.classList.add('hidden');
    hud.toast(`Không mở được camera: ${err.message}`, 'err');
    startBtn.disabled = false;
    startBtn.textContent = 'Thử lại';
    return;
  }

  camEl.srcObject = tracker.stream;
  await camEl.play().catch(() => {});

  setProgress('Đang tải mô hình nhận diện tay…');
  try {
    await tracker.loadModel();
  } catch (err) {
    boot.classList.add('hidden');
    hud.show();
    hud.setCameraLive(false, 'NO MODEL');
    hud.toast(err.message, 'err');
    startBtn.disabled = false;
    startBtn.textContent = 'Thử lại';
    return;
  }

  overlay.resize(camEl.clientWidth || 208, camEl.clientHeight || 156);
  window.addEventListener('resize', () => overlay.resize(camEl.clientWidth, camEl.clientHeight));

  boot.classList.add('hidden');
  gate.classList.add('hidden');
  started = true;
  cameraOff = false;
  hud.show();
  hud.setCameraOn();
  hud.toast(`${quality.count.toLocaleString('en-US')} hạt · nhận diện tay sẵn sàng`);

  bindPointer();
  hud.onCameraOff(toggleCamera);

  if (!loopRunning) {
    loopRunning = true;
    requestAnimationFrame((t) => {
      clock.last = t;
      loop(t);
    });
  }
}

startBtn.addEventListener('click', async () => {
  if (started) return;
  startBtn.disabled = true;
  startBtn.textContent = 'Đang khởi động…';
  await bootSequence();
});

// ------------------------------------------------------------------ lifecycle

window.addEventListener('beforeunload', () => {
  tracker?.dispose();
  universe?.dispose();
  unbindResize?.();
});

// `pagehide` also fires on mobile when the tab is backgrounded or closed, where
// beforeunload is unreliable. Without this the camera indicator can stay on.
window.addEventListener('pagehide', () => {
  tracker?.stopCamera();
});

tracker = new HandTracker({ width: 1280, height: 720, fps: 30 });

// Build the scene behind the start gate so the first paint already shows stars,
// then hand control over to the gate.
setProgress('Đang khởi tạo vũ trụ…');
buildScene();
renderer.render(scene, camera);
requestAnimationFrame(() => {
  boot.classList.add('hidden');
  startBtn.disabled = false;
  startBtn.textContent = 'Bật camera & bắt đầu';
});
