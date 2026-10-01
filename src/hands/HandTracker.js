import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  palmCenter,
  palmScale,
  palmFlatness,
  fingerExtensions,
  handDistance,
} from './LandmarkUtils.js';
import { clamp, damp } from '../utils/Math.js';

// BASE_URL keeps the paths correct for both `/` in dev and a sub-path deploy.
// It is inlined by Vite; the guard keeps this module importable from plain Node
// in the unit tests.
const BASE =
  (typeof import.meta.env !== 'undefined' && import.meta.env.BASE_URL) || '/';
const MODEL_LOCAL = `${BASE}models/hand_landmarker.task`;
const WASM_LOCAL = `${BASE}wasm`;

const MODEL_CDN =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

export const GESTURE = {
  IDLE: 'IDLE',
  ROTATE: 'ROTATE',
  ZOOM: 'ZOOM',
};

/**
 * Wraps MediaPipe HandLandmarker in VIDEO mode.
 *
 * Responsibilities:
 *   - own the webcam stream
 *   - run detection on a fixed cadence (keeps render loop smooth)
 *   - convert raw landmarks into a clean, smoothed `state` the camera reads
 *   - decide IDLE / ROTATE / ZOOM with hysteresis + hold time so the gesture
 *     does not flicker between states
 */
export class HandTracker {
  constructor({ width = 1280, height = 720, fps = 30 } = {}) {
    this.width = width;
    this.height = height;
    this.detectFps = fps;

    this.video = null;
    this.stream = null;
    this.landmarker = null;
    this.enabled = true;
    this.ready = false;
    this.error = null;

    this.lastVideoTime = -1;
    this.lastDetectionTime = 0;
    this.detectInterval = 1 / fps;

    this.state = {
      gesture: GESTURE.IDLE,
      hands: [],
      handCount: 0,
      handDistance: 0,
      /** Raw (unsmoothed) midpoint between the two palms. */
      center: { x: 0.5, y: 0.5 },
      /** Baseline captured the moment ZOOM was entered. */
      baselineDistance: 0,
      baselineCenter: { x: 0.5, y: 0.5 },
      /** +1 = hands apart (zoom in), -1 = hands together (zoom out). */
      spread: 0,
      fps: 0,
    };

    this.#candidateGesture = GESTURE.IDLE;
  }

  #candidateGesture;

  /** Opens the camera. Throws a caller-friendly Error on failure. */
  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Trình duyệt không hỗ trợ getUserMedia (cần HTTPS hoặc localhost).');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: this.width },
        height: { ideal: this.height },
        frameRate: { ideal: this.detectFps, max: 60 },
        facingMode: 'user',
      },
      audio: false,
    });

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = this.stream;
    await video.play();
    await new Promise((resolve) => {
      if (video.videoWidth > 0) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
    });

    this.video = video;
    return { videoWidth: video.videoWidth, videoHeight: video.videoHeight };
  }

  /** Loads the WASM runtime + hand model. Local files first, CDN as fallback. */
  async loadModel() {
    const options = {
      baseOptions: { modelAssetPath: MODEL_LOCAL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    };

    let fileset = null;
    try {
      fileset = await FilesetResolver.forVisionTasks(WASM_LOCAL);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch (localErr) {
      // Local WASM may be missing on a fresh clone: retry against the CDN.
      try {
        fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_CDN, delegate: 'GPU' },
        });
      } catch (cdnErr) {
        try {
          fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
          this.landmarker = await HandLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: MODEL_CDN, delegate: 'CPU' },
          });
        } catch {
          throw new Error(
            `Không tải được model nhận diện tay: ${localErr.message} / ${cdnErr.message}`,
          );
        }
      }
    }

    this.ready = true;
    return this.landmarker;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.#setGesture(GESTURE.IDLE);
  }

  #setGesture(next) {
    if (this.state.gesture === next) return;
    const prev = this.state.gesture;
    this.state.gesture = next;

    if (next === GESTURE.ZOOM && prev !== GESTURE.ZOOM) {
      // "đưa tay vào màn hình" — the moment ZOOM starts becomes the reference
      // distance that all later spreading/squeezing is measured against.
      this.state.baselineDistance = this.state.handDistance || 1e-3;
      this.state.baselineCenter = { ...this.state.center };
      this.state.spread = 0;
    }
  }

  /** Runs detection if the cadence allows, then refines the state. */
  update(nowMs, dt) {
    const st = this.state;
    st.fps = st.fps * 0.9 + (dt > 0 ? 1 / dt : 0) * 0.1;

    if (!this.enabled || !this.ready || !this.video || this.video.readyState < 2) {
      st.hands = [];
      st.handCount = 0;
      st.handDistance = 0;
      this.#candidateGesture = GESTURE.IDLE;
      this.#setGesture(GESTURE.IDLE);
      return st;
    }

    if (
      nowMs - this.lastDetectionTime >= this.detectInterval * 1000 &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastDetectionTime = nowMs;
      this.lastVideoTime = this.video.currentTime;

      const result = this.landmarker.detectForVideo(this.video, nowMs);
      this.#ingest(result);
    }

    return st;
  }

  #ingest(result) {
    const st = this.state;
    const landmarks = result?.landmarks ?? [];
    const handedness = result?.handedness ?? [];

    const hands = [];
    for (let i = 0; i < landmarks.length; i += 1) {
      const lm = landmarks[i];
      const ext = fingerExtensions(lm);
      let extended = 0;
      for (const name of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        // 0.55 keeps half-bent fingers out of the count.
        if (ext[name] > 0.55) extended += 1;
      }
      const spreadOfFingers = ext.index * 0.3 + ext.middle * 0.3 + ext.ring * 0.2 + ext.pinky * 0.2;

      hands.push({
        id: i,
        label: handedness[i]?.[0]?.categoryName ?? (i === 0 ? 'Left' : 'Right'),
        score: handedness[i]?.[0]?.score ?? 0,
        landmarks: lm,
        center: palmCenter(lm),
        scale: palmScale(lm),
        flatness: palmFlatness(lm),
        extensions: ext,
        extendedCount: extended,
        /** Open = at least 4 fingers out and the palm reads flat. */
        open: extended >= 4 && palmFlatness(lm) >= 0.5,
        spreadOfFingers,
      });
    }

    // Sort by X so "left"/"right" is stable regardless of detection order.
    hands.sort((a, b) => a.center.x - b.center.x);
    st.hands = hands;
    st.handCount = hands.length;

    const openHands = hands.filter((h) => h.open);

    if (openHands.length >= 2) {
      const [l, r] = openHands;
      const aspect = this.video ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
      st.handDistance = handDistance(l.center, r.center, aspect);
      st.center = {
        x: (l.center.x + r.center.x) * 0.5,
        y: (l.center.y + r.center.y) * 0.5,
      };
      this.#considerGesture(GESTURE.ZOOM);
    } else if (openHands.length === 1) {
      const h = openHands[0];
      st.center = { x: h.center.x, y: h.center.y };
      st.handDistance = 0;
      this.#considerGesture(GESTURE.ROTATE);
    } else {
      st.handDistance = 0;
      this.#considerGesture(GESTURE.IDLE);
    }

    if (st.gesture === GESTURE.ZOOM && st.handDistance > 1e-4) {
      // Ratio against the baseline captured on entry: >1 hands apart, <1 squeezed.
      const ratio = st.handDistance / Math.max(st.baselineDistance, 1e-4);
      const smoothed = clamp((ratio - 1) * 2.2, -1, 1);
      st.spread += (smoothed - st.spread) * damp(22, this.detectInterval);
    } else {
      st.spread *= 0.86;
    }
  }

  /** Records the gesture the latest detection run voted for. */
  #considerGesture(candidate) {
    this.#candidateGesture = candidate;
  }

  /** The gesture the latest detection run voted for, before hysteresis. */
  get candidate() {
    return this.#candidateGesture;
  }

  /** Applies a gesture decision made by the arbiter. */
  commit(gesture) {
    this.#setGesture(gesture);
    return this.state.gesture;
  }

  /** Re-baselines ZOOM to the current hand distance (called on RESET). */
  recalibrate() {
    if (this.state.gesture === GESTURE.ZOOM) {
      this.state.baselineDistance = this.state.handDistance || this.state.baselineDistance;
      this.state.baselineCenter = { ...this.state.center };
      this.state.spread = 0;
    }
  }

  /**
   * Releases the camera: stops every track and detaches the video element.
   * The landmarker is kept so the camera can be turned back on without
   * re-downloading the model.
   */
  stopCamera() {
    this.enabled = false;
    this.#setGesture(GESTURE.IDLE);
    this.state.hands = [];
    this.state.handCount = 0;
    this.state.handDistance = 0;

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
        // Belt and braces: some browsers keep the light on for a frame or two.
        track.enabled = false;
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
    this.lastVideoTime = -1;
  }

  dispose() {
    this.landmarker?.close?.();
    this.stopCamera();
  }
}
