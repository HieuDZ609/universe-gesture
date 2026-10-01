import { GESTURE } from '../hands/HandTracker.js';

const MODE_LABEL = {
  [GESTURE.IDLE]: 'Idle',
  [GESTURE.ROTATE]: 'Xoay 360°',
  [GESTURE.ZOOM]: 'Zoom',
};

const FINGER_LABEL = {
  thumb: 'ngón cái',
  index: 'ăn',
  middle: 'giữa',
  ring: 'áp',
  pinky: 'út',
};

/**
 * Thin DOM layer: mode badge, numeric readouts, per-finger extension bars and
 * transient toasts. Kept deliberately small — all 3D work happens elsewhere.
 */
export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.mode = document.getElementById('mode');
    this.vHands = document.getElementById('v-hands');
    this.vDist = document.getElementById('v-dist');
    this.vCam = document.getElementById('v-cam');
    this.vFps = document.getElementById('v-fps');
    this.meter = document.getElementById('v-meter');
    this.fingers = document.getElementById('fingers');
    this.toastEl = document.getElementById('toast');
    this.camWrap = document.getElementById('cam-wrap');
    this.camLabel = document.getElementById('cam-label');
    this.camOff = document.getElementById('cam-off');

    this.rows = new Map();
    this.toastTimer = 0;
    this.lastGesture = null;
    this.emptyFingers = true;
  }

  show() {
    this.root.hidden = false;
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    return !this.root.hidden;
  }

  setCameraLive(live, label) {
    this.camWrap.classList.toggle('live', live);
    if (label) this.camLabel.textContent = label;
  }

  /** True while the camera preview should be shown. */
  get cameraVisible() {
    return !this.camWrap.classList.contains('off');
  }

  /**
   * Collapses the camera preview and reveals the off control. Called after the
   * user explicitly releases the camera so the stream is genuinely stopped
   * rather than merely hidden.
   */
  setCameraOff() {
    this.camWrap.classList.add('off');
    this.setCameraLive(false, 'CAMERA OFF');
    this.#updateCamButton();
  }

  setCameraOn() {
    this.camWrap.classList.remove('off');
    this.setCameraLive(true, 'TRACKING');
    this.#updateCamButton();
  }

  onCameraOff(handler) {
    this.camOff.addEventListener('click', handler);
  }

  #updateCamButton() {
    const on = this.cameraVisible;
    this.camOff.textContent = on ? 'TẮT' : 'BẬT';
    const label = on ? 'Tắt camera' : 'Bật lại camera';
    this.camOff.title = label;
    this.camOff.setAttribute('aria-label', label);
  }

  toast(message, kind = '') {
    this.toastEl.textContent = message;
    this.toastEl.className = `panel show ${kind}`.trim();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.className = 'panel';
    }, kind === 'err' ? 5200 : 2600);
  }

  update(state, gesture, cameraDistance, fps) {
    if (gesture !== this.lastGesture) {
      this.lastGesture = gesture;
      this.mode.dataset.mode = gesture;
      this.mode.textContent = MODE_LABEL[gesture] ?? gesture;
    }

    this.vHands.textContent = String(state.handCount);
    this.vDist.textContent = state.handDistance > 0 ? state.handDistance.toFixed(3) : '—';
    this.vCam.textContent = `${cameraDistance.toFixed(0)}u`;
    this.vFps.textContent = `${Math.round(fps)}`;

    if (gesture === GESTURE.ZOOM) {
      const pct = state.spread * 50;
      this.meter.style.left = pct >= 0 ? '50%' : `${50 + pct}%`;
      this.meter.style.width = `${Math.abs(pct)}%`;
    } else {
      this.meter.style.width = '0%';
    }

    this.#updateFingers(state);
  }

  #updateFingers(state) {
    const hand = state.hands.find((h) => h.open) ?? state.hands[0];

    if (!hand) {
      if (this.emptyFingers) return;
      // Built with DOM APIs rather than innerHTML: the content is a constant
      // today, but keeping every dynamic node on the explicit API path means a
      // future untrusted value can never land in an HTML sink by accident.
      this.fingers.replaceChildren();
      const note = document.createElement('div');
      note.id = 'hands-hidden';
      note.textContent = 'NO HANDS';
      this.fingers.appendChild(note);
      this.rows.clear();
      this.emptyFingers = true;
      return;
    }
    this.emptyFingers = false;

    if (!this.rows.size) {
      this.fingers.replaceChildren();
      for (const key of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        const row = document.createElement('div');
        row.className = 'frow';

        const name = document.createElement('span');
        name.className = 'n';
        name.textContent = FINGER_LABEL[key];

        const bar = document.createElement('span');
        bar.className = 'b';
        const fill = document.createElement('i');
        bar.appendChild(fill);

        const val = document.createElement('span');
        val.className = 'c';
        val.textContent = '0';

        row.append(name, bar, val);
        this.fingers.appendChild(row);
        this.rows.set(key, { row, bar: fill, val });
      }
    }

    for (const key of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      const entry = this.rows.get(key);
      const v = Math.round((hand.extensions[key] ?? 0) * 100);
      entry.bar.style.width = `${v}%`;
      entry.val.textContent = String(v);
      entry.row.classList.toggle('open', v > 55);
    }
  }
}
