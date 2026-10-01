import * as THREE from 'three';
import {
  createUniverseLayers,
  R_CORE,
  R_DUST_OUT,
  R_STAR_OUT,
  LAYER,
} from './UniverseGeometry.js';
import { createCoreMaterial, createDustMaterial, createStarMaterial } from './UniverseMaterial.js';
import { clamp } from '../utils/Math.js';

/**
 * The universe: three particle layers that coexist for the whole session.
 *
 *   core   — a dense, shaded shell at R_CORE. Opaque-blended with depth writes so
 *            the near half of the shell occludes the far half; with wrapped
 *            diffuse lighting and a limb highlight it reads as an actual sphere.
 *   dust   — additive haze between R_DUST_IN and R_DUST_OUT, slowly swirling.
 *   stars  — satellites on individual inclined orbits from R_STAR_IN to
 *            R_STAR_OUT, spun around their own axis inside the vertex shader.
 *
 * The core never dissolves: there is no morph stage any more. The camera can
 * orbit indefinitely without the centre ever disappearing.
 */
export class Universe {
  constructor({ count = 120000 } = {}) {
    this.count = count;
    this.elapsed = 0;
    this.autoRotate = true;

    const { core, dust, stars, counts } = createUniverseLayers(count);
    this.counts = counts;
    this.sphereRadius = R_CORE;

    this.coreMaterial = createCoreMaterial();
    this.dustMaterial = createDustMaterial();
    this.starMaterial = createStarMaterial();

    this.core = new THREE.Points(core, this.coreMaterial);
    this.dust = new THREE.Points(dust, this.dustMaterial);
    this.stars = new THREE.Points(stars, this.starMaterial);
    this.core.frustumCulled = false;
    this.dust.frustumCulled = false;
    this.stars.frustumCulled = false;

    // Explicit render order. The core writes depth, so the additive layers drawn
    // after it get correctly occluded by the sphere while the dust in front of the
    // sphere still adds light on top of it.
    this.core.renderOrder = 0;
    this.dust.renderOrder = 1;
    this.stars.renderOrder = 2;

    this.group = new THREE.Group();
    this.group.add(this.core, this.dust, this.stars);

    this.materials = [this.coreMaterial, this.dustMaterial, this.starMaterial];
    this.geometries = [core, dust, stars];
  }

  get layer() {
    return LAYER;
  }

  /** @param {number} dt seconds  @param {number} cameraDistance current dolly distance */
  update(dt, cameraDistance = 128) {
    this.elapsed += dt;

    for (const material of this.materials) {
      material.uniforms.uTime.value = this.elapsed;
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
      // Perspective sells depth: sprites grow as the camera approaches. The rest
      // distance is 128, so uSizeScale is 1.0 there and only deviates when the
      // dolly actually moves — a resting sphere must not be shrunk.
      material.uniforms.uSizeScale.value = clamp(1 + (128 - cameraDistance) / 220, 0.9, 1.9);
    }

    if (this.autoRotate) {
      this.group.rotation.y += dt * 0.014;
      this.group.rotation.x = Math.sin(this.elapsed * 0.045) * 0.06;
    }
  }

  /** Called when the user drags with the mouse so gesture motion does not fight it. */
  setAutoRotate(enabled) {
    this.autoRotate = enabled;
  }

  reset() {
    this.elapsed = 0;
    this.group.rotation.set(0, 0, 0);
  }

  get bounds() {
    return { core: R_CORE, dust: R_DUST_OUT, stars: R_STAR_OUT };
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
