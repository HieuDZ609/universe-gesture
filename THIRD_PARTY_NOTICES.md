# Third-Party Notices

The MIT License in [LICENSE](LICENSE) covers this project's own source code only.
The components below are used at runtime (or during the build) under their own
licenses. Reproduced here for convenience; the authoritative text ships with each
upstream project.

## Runtime dependencies

| Component | Version (exact) | License | Use |
|---|---|---|---|
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | WebGL renderer, `THREE.Points` particle layers |
| [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 1.0.1 | Apache-2.0 | Hand tracking; supplies the WASM runtime |
| MediaPipe [HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) model weights | float16/1 | Apache-2.0 | Hand landmark detection |

## Build-time dependencies

| Component | Version (exact) | License | Use |
|---|---|---|---|
| [Vite](https://github.com/vitejs/vite) | 8.3.1 | MIT | Dev server and production bundling |

The model weights and the WASM runtime are **not** committed to this repository.
`scripts/fetch-assets.mjs` downloads the model at install time and copies the
WASM files out of `node_modules`, so both are covered by the upstream licenses
listed above.

Apache License 2.0 full text: <https://www.apache.org/licenses/LICENSE-2.0>
MIT full text: see [LICENSE](LICENSE).
