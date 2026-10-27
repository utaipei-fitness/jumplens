// 準備 MediaPipe 檔案（npm run dev 前自動執行）：
//   1. 從 node_modules 複製 WASM 到 public/mediapipe/wasm/
//   2. 模型：先找隔壁 fitness_coach/public/models 的本機檔，沒有才從 Google 官方網址下載
import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDst = join(root, 'public/models');
const siblingModels = join(root, '../fitness_coach/public/models');
const WASM_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];
const MODELS = ['lite', 'full', 'heavy'];
const modelUrl = (m) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/latest/pose_landmarker_${m}.task`;
const size = async (p) => { try { return (await stat(p)).size; } catch { return -1; } };

await mkdir(wasmDst, { recursive: true });
for (const f of WASM_FILES) {
  const src = join(wasmSrc, f), dst = join(wasmDst, f);
  if ((await size(src)) !== (await size(dst))) await copyFile(src, dst);
}
await mkdir(modelDst, { recursive: true });
for (const m of MODELS) {
  const file = `pose_landmarker_${m}.task`, dst = join(modelDst, file);
  if ((await size(dst)) > 0) continue;
  if ((await size(join(siblingModels, file))) > 0) { await copyFile(join(siblingModels, file), dst); console.log(`[mediapipe] 複製本機模型 ${file}`); continue; }
  try {
    console.log(`[mediapipe] 下載 ${file}…`);
    const res = await fetch(modelUrl(m));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await writeFile(`${dst}.download`, new Uint8Array(await res.arrayBuffer()));
    await rename(`${dst}.download`, dst);
  } catch (e) { console.warn(`[mediapipe] ${file} 下載失敗（${e}），該模型無法使用`); }
}
