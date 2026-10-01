import { damp } from '../utils/Math.js';
import { GESTURE } from '../hands/HandTracker.js';

/**
 * Translates tracker state into camera intent.
 *
 * ROTATE — one open hand: palm displacement since the previous frame drives
 *          yaw + pitch. Re-anchored every frame, so the camera keeps following
 *          the hand indefinitely and yaw can accumulate unlimited turns.
 * ZOOM   — two open hands: the spread of the palms drives the dolly, and the
 *          drift of the midpoint (the "vector") steers the orbit a little so
 *          the motion feels directional rather than purely radial.
 *
 * Kept free of DOM/Three imports so it can be exercised directly in tests.
 */
export class GestureMapper {
  constructor(controls, { rotateSensitivity = 1, zoomLead = 0.55 } = {}) {
    this.controls = controls;
    this.rotateSensitivity = rotateSensitivity;
    this.zoomLead = zoomLead;

    this.rotateAnchor = { x: 0, y: 0, active: false };
    this.zoomAnchor = { x: 0, y: 0, active: false };
    this.smooth = { x: 0.5, y: 0.5, primed: false };
  }

  update(state, gesture, dt) {
    if (gesture === GESTURE.ROTATE) {
      this.#updateRotate(state, dt);
    } else {
      this.rotateAnchor.active = false;
    }

    if (gesture === GESTURE.ZOOM) {
      this.#updateZoom(state, dt);
    } else {
      this.zoomAnchor.active = false;
      this.smooth.primed = false;
    }
  }

  #updateRotate(state, dt) {
    const hand = state.hands.find((h) => h.open);
    if (!hand) return;

    if (!this.rotateAnchor.active) {
      this.rotateAnchor.x = hand.center.x;
      this.rotateAnchor.y = hand.center.y;
      this.rotateAnchor.active = true;
      return;
    }

    const dx = (hand.center.x - this.rotateAnchor.x) * this.rotateSensitivity;
    const dy = (hand.center.y - this.rotateAnchor.y) * this.rotateSensitivity;
    this.controls.rotateBy(dx, dy, dt);

    this.rotateAnchor.x = hand.center.x;
    this.rotateAnchor.y = hand.center.y;
  }

  #updateZoom(state, dt) {
    if (!this.smooth.primed) {
      this.smooth.x = state.center.x;
      this.smooth.y = state.center.y;
      this.smooth.primed = true;
    }
    const t = damp(24, dt);
    this.smooth.x += (state.center.x - this.smooth.x) * t;
    this.smooth.y += (state.center.y - this.smooth.y) * t;

    if (!this.zoomAnchor.active) {
      this.zoomAnchor.x = this.smooth.x;
      this.zoomAnchor.y = this.smooth.y;
      this.zoomAnchor.active = true;
      return;
    }

    const deltaX = this.smooth.x - this.zoomAnchor.x;
    const deltaY = this.smooth.y - this.zoomAnchor.y;
    this.controls.zoomBy(state.spread, { x: deltaX * this.zoomLead, y: deltaY * this.zoomLead }, dt);

    this.zoomAnchor.x = this.smooth.x;
    this.zoomAnchor.y = this.smooth.y;
  }
}

/**
 * Decides which gesture is a candidate, then requires it to hold for `holdMs`
 * before it becomes active. The delay is what stops a passing hand or a single
 * dropped frame from flipping the control mode.
 */
export class GestureArbiter {
  constructor({ holdMs = 220 } = {}) {
    this.holdMs = holdMs;
    this.candidate = GESTURE.IDLE;
    this.since = 0;
  }

  observe(gesture, nowMs) {
    if (gesture === this.candidate) return this.candidate;
    this.candidate = gesture;
    this.since = nowMs;
    return this.candidate;
  }

  /** @returns the gesture that should be active right now */
  resolve(active, nowMs) {
    if (this.candidate !== active && nowMs - this.since >= this.holdMs) {
      return this.candidate;
    }
    return active;
  }
}
