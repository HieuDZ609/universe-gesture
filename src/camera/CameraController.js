import * as THREE from 'three';
import { clamp, damp, deadzone, shortestAngle } from '../utils/Math.js';

const DEG = Math.PI / 180;

/**
 * Orbit + dolly controller driven by hands (with mouse fallback).
 *
 * Coordinate model: spherical around `target`.
 *   radius  — distance to the target; hand spread changes this (dolly)
 *   theta   — azimuth (yaw), continuous, no wrapping limits -> full 360°
 *   phi     — polar angle, clamped just shy of the poles so the up vector never
 *             degenerates (no gimbal dead spot / flip)
 *
 * Yaw is stored unwrapped so a full turn keeps accumulating and never snaps.
 */
export class CameraController {
  constructor(camera, { target = new THREE.Vector3(0, 0, 0) } = {}) {
    this.camera = camera;
    this.target = target.clone();

    this.radius = 128;
    this.goalRadius = 128;
    this.minRadius = 14;
    this.maxRadius = 260;

    this.theta = 0;
    this.goalTheta = 0;
    this.phi = 78 * DEG;
    this.goalPhi = 78 * DEG;
    this.minPhi = 6 * DEG;
    this.maxPhi = 174 * DEG;

    this.autoSpin = 0.016;
    this.enableAutoSpin = true;
    this.sensitivity = 3.8;
    // Dolly speed in world units per second at full spread.
    this.zoomSpeed = 118;

    this.#apply();
  }

  /** One-hand open gesture: palm movement drives yaw/pitch. */
  rotateBy(dx, dy, dt) {
    this.goalTheta -= dx * this.sensitivity;
    this.goalPhi = clamp(this.goalPhi - dy * this.sensitivity, this.minPhi, this.maxPhi);
    void dt;
    this.enableAutoSpin = false;
  }

  /**
   * Two-hand open gesture.
   * @param {number} spread  -1..1 (>1 = hands apart)
   * @param {{x:number,y:number}} centerDelta palm-midpoint movement since entry,
   *        used as the "vector" component of the gesture
   */
  zoomBy(spread, centerDelta, dt) {
    // Map spread to a dolly step: deadzone in the middle so a still pose is stable.
    const s = deadzone(spread, 0.1);
    if (s !== 0) {
      // Frame-rate independent dolly: radius units per second, scaled by spread.
      this.goalRadius = clamp(
        this.goalRadius - s * this.zoomSpeed * dt,
        this.minRadius,
        this.maxRadius,
      );
    }

    // The vector part: midpoint drift gently swings the orbit so the motion feels
    // directional rather than purely radial.
    if (centerDelta && (Math.abs(centerDelta.x) > 1e-4 || Math.abs(centerDelta.y) > 1e-4)) {
      this.goalTheta -= centerDelta.x * 0.55;
      this.goalPhi = clamp(this.goalPhi - centerDelta.y * 0.4, this.minPhi, this.maxPhi);
      this.enableAutoSpin = false;
    }
  }

  /** Mouse drag fallback. */
  rotateByPixels(dxPixels, dyPixels, viewportHeight) {
    this.goalTheta -= (dxPixels / viewportHeight) * 3.1;
    this.goalPhi = clamp(
      this.goalPhi - (dyPixels / viewportHeight) * 2.2,
      this.minPhi,
      this.maxPhi,
    );
    this.enableAutoSpin = false;
  }

  /** Mouse wheel fallback. */
  zoomByWheel(deltaY) {
    const factor = Math.exp(clamp(deltaY, -120, 120) * 0.0012);
    this.goalRadius = clamp(this.goalRadius * factor, this.minRadius, this.maxRadius);
    this.enableAutoSpin = false;
  }

  dollyTo(radius) {
    this.goalRadius = clamp(radius, this.minRadius, this.maxRadius);
  }

  update(dt, { gestureActive = false } = {}) {
    if (this.enableAutoSpin && !gestureActive) {
      this.goalTheta += this.autoSpin * dt;
    }

    // Yaw uses angle-aware damping so crossing ±PI never snaps.
    this.theta += shortestAngle(this.theta, this.goalTheta) * damp(6.5, dt);
    this.phi += (this.goalPhi - this.phi) * damp(6.5, dt);
    this.radius += (this.goalRadius - this.radius) * damp(5.2, dt);

    this.#apply();
  }

  #apply() {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  reset() {
    this.goalTheta = 0;
    this.goalPhi = 78 * DEG;
    this.goalRadius = 128;
    this.theta = 0;
    this.phi = 78 * DEG;
    this.radius = 128;
    this.enableAutoSpin = true;
  }

  get distance() {
    return this.radius;
  }
}
