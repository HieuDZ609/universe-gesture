import * as THREE from 'three';

export const QUALITY = {
  low: { pixelRatio: 1, count: 60000, antialias: false },
  medium: { pixelRatio: 1.35, count: 120000, antialias: true },
  high: { pixelRatio: 2, count: 180000, antialias: true },
};

export function detectQuality() {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = navigator.deviceMemory ?? 4;
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}

export function createRenderer(container, quality) {
  const renderer = new THREE.WebGLRenderer({
    antialias: quality.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.setClearColor(0x04060f, 1);
  renderer.domElement.setAttribute('aria-label', 'Vũ trụ hạt 3D');
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04060f, 0.0021);
  return scene;
}

export function createCamera(container) {
  const camera = new THREE.PerspectiveCamera(
    58,
    container.clientWidth / Math.max(container.clientHeight, 1),
    0.1,
    1400,
  );
  camera.position.set(0, 0, 128);
  return camera;
}

export function bindResize(container, camera, renderer) {
  const onResize = () => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  window.addEventListener('resize', onResize);
  onResize();
  return () => window.removeEventListener('resize', onResize);
}
