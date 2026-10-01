import { createWriteStream } from 'node:fs';
import { mkdir, stat, copyFile, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = join(root, 'public', 'models');
const wasmDir = join(root, 'public', 'wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_FILE = join(modelsDir, 'hand_landmarker.task');

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_module_internal.js',
  'vision_wasm_module_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} khi tải ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const s = await stat(dest);
  console.log(`  ✓ ${dest.replace(root + '/', '')} (${(s.size / 1048576).toFixed(2)} MB)`);
}

async function copyWasm() {
  const pkgDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  let entries;
  try {
    entries = await readdir(pkgDir);
  } catch {
    console.warn('  ! Không tìm thấy node_modules/@mediapipe/tasks-vision/wasm — bỏ qua copy WASM.');
    return false;
  }
  await mkdir(wasmDir, { recursive: true });
  let copied = 0;
  for (const name of WASM_FILES) {
    if (!entries.includes(name)) continue;
    const dest = join(wasmDir, name);
    if (await exists(dest)) continue;
    await copyFile(join(pkgDir, name), dest);
    copied += 1;
  }
  if (copied > 0) console.log(`  ✓ public/wasm: copy ${copied} file`);
  else console.log('  ✓ public/wasm: đã có đủ');
  return true;
}

async function main() {
  console.log('[assets] Chuẩn bị model + wasm cho nhận diện tay...');

  const hasLocalWasm = await copyWasm();

  if (await exists(MODEL_FILE)) {
    console.log('  ✓ hand_landmarker.task đã tồn tại');
  } else {
    try {
      await download(MODEL_URL, MODEL_FILE);
    } catch (err) {
      console.warn(`  ! Không tải được model: ${err.message}`);
      console.warn('    Ứng dụng sẽ tự thử lấy từ CDN khi chạy (cần mạng).');
      return;
    }
  }

  if (!hasLocalWasm) {
    console.log('  ! Thiếu WASM cục bộ — sẽ dùng CDN làm dự phòng.');
  }
  console.log('[assets] Xong.');
}

main().catch((err) => {
  console.warn('[assets] Bỏ qua:', err.message);
});
