// MediaPipe Pose Landmarker（tasks-vision），WASM 與模型都從本機 public/ 載入
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame } from '../analysis/pose';

export type ModelSize = 'lite' | 'full' | 'heavy';
const BASE = import.meta.env.BASE_URL;
const cache = new Map<ModelSize, Promise<PoseLandmarker>>();

export function getLandmarker(model: ModelSize): Promise<PoseLandmarker> {
  if (!cache.has(model)) {
    cache.set(model, (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_${model}.task`, delegate },
        runningMode: 'VIDEO' as const,
        numPoses: 1,
      });
      try { return await PoseLandmarker.createFromOptions(vision, opts('GPU')); } catch { return await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    })());
  }
  return cache.get(model)!;
}

/** 偵測一幀，回傳像素座標 */
export function detect(lm: PoseLandmarker, src: HTMLVideoElement, tsMs: number, t: number): PoseFrame {
  const W = src.videoWidth, H = src.videoHeight;
  const res = lm.detectForVideo(src, tsMs);
  const p = res.landmarks[0];
  return { t, lm: p ? p.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 })) : null };
}

export const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

export function drawSkeleton(ctx: CanvasRenderingContext2D, f: PoseFrame, scale = 1, color = '#22c55e') {
  if (!f.lm) return;
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = '#f59e0b';
  for (const [a, b] of CONNECTIONS) {
    const p = f.lm[a], q = f.lm[b];
    if (p.v < 0.3 || q.v < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * scale, p.y * scale);
    ctx.lineTo(q.x * scale, q.y * scale);
    ctx.stroke();
  }
  for (const i of [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    const p = f.lm[i];
    if (p.v < 0.3) continue;
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, Math.max(3, 4 * scale), 0, Math.PI * 2);
    ctx.fill();
  }
}
