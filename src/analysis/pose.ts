// 姿態來源 → KeypointSeries（公尺、Y 向上）。
// 支援 MediaPipe Pose（33 點，影像像素）與 Sports2D TRC。

import { THRESHOLDS as TH } from '../config/thresholds';
import { median } from './signal';
import type { KeypointSeries, Pt } from './types';

export type Side = 'right' | 'left';

/** 一幀 MediaPipe 結果：33 點，x、y 為像素，v 為 visibility */
export interface PoseFrame { t: number; lm: { x: number; y: number; v: number }[] | null }

const MP = {
  right: { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32, wrist: 16, eye: 5 },
  left: { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31, wrist: 15, eye: 2 },
};

/** 身高法比例尺（px/m）：開頭 1 秒靜止站立時，眼睛到腳跟的垂直像素距離 ÷ (0.925 × 身高) */
export function pxPerMFromHeight(frames: PoseFrame[], heightM: number): number | null {
  const t0 = frames.find((f) => f.lm)?.t ?? 0;
  const d: number[] = [];
  for (const f of frames) {
    if (!f.lm || f.t - t0 > TH.baseline.quietS) continue;
    const eye = (f.lm[2].y + f.lm[5].y) / 2;
    const heel = (f.lm[29].y + f.lm[30].y) / 2;
    d.push(heel - eye);
  }
  const m = median(d);
  return Number.isFinite(m) && m > 0 ? m / (TH.scale.eyeToHeelOfHeight * heightM) : null;
}

export function fromMediaPipe(frames: PoseFrame[], side: Side, pxPerM: number, imgW: number, imgH: number): KeypointSeries {
  const ix = MP[side];
  const mx = TH.live.marginRatio;
  const get = (f: PoseFrame, k: number): Pt => {
    const l = f.lm?.[k];
    if (!l || l.v < TH.live.minVisibility) return null;
    return [l.x / pxPerM, (imgH - l.y) / pxPerM];
  };
  return {
    t: frames.map((f) => f.t),
    hip: frames.map((f) => get(f, ix.hip)),
    knee: frames.map((f) => get(f, ix.knee)),
    ankle: frames.map((f) => get(f, ix.ankle)),
    heel: frames.map((f) => get(f, ix.heel)),
    toe: frames.map((f) => get(f, ix.toe)),
    wrist: frames.map((f) => get(f, ix.wrist)),
    inFrame: frames.map((f) => {
      if (!f.lm) return false;
      const ys = [f.lm[0].y, f.lm[ix.heel].y, f.lm[ix.toe].y];
      const xsv = [f.lm[ix.hip].x, f.lm[ix.toe].x, f.lm[ix.heel].x];
      return ys.every((y) => y > -mx * imgH && y < imgH * (1 + mx)) && xsv.every((x) => x > 0 && x < imgW);
    }),
  };
}

/**
 * Sports2D TRC（OpenSim 格式）。第 5 行起為資料：Frame#, Time, 各點 X Y Z。
 * 單位依 header 的 Units；像素座標（y 向下）會翻轉並用 px/m 換算。
 * 標記名稱以實際輸出為準：找 RHip / RKnee / RAnkle / RHeel / RBigToe（左側換 L）。
 */
export function parseTrc(text: string, side: Side, pxPerM?: number): { series: KeypointSeries; units: string; markers: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const hdrVals = lines[2].split('\t');
  const hdrKeys = lines[1].split('\t');
  const units = (hdrVals[hdrKeys.findIndex((k) => /units/i.test(k))] ?? 'm').trim();
  const names = lines[3].split('\t');
  const markers = names.slice(2).filter((s) => s.trim());
  const col = (re: RegExp) => {
    const k = names.findIndex((s) => re.test(s.trim()));
    return k < 0 ? -1 : k;
  };
  const S = side === 'right' ? 'R' : 'L';
  const cols = {
    hip: col(new RegExp(`^${S}Hip$`, 'i')),
    knee: col(new RegExp(`^${S}Knee$`, 'i')),
    ankle: col(new RegExp(`^${S}Ankle$`, 'i')),
    heel: col(new RegExp(`^${S}Heel$`, 'i')),
    toe: col(new RegExp(`^${S}(BigToe|Toe)$`, 'i')),
    wrist: col(new RegExp(`^${S}Wrist$`, 'i')),
  };
  if (cols.hip < 0) cols.hip = col(/^Hip$/i);
  for (const [k, v] of Object.entries(cols)) if (v < 0 && k !== 'wrist') throw new Error(`TRC 找不到 ${S}${k} 標記（現有：${markers.join(', ')}）`);
  const isPx = /px|pixel/i.test(units);
  if (isPx && !pxPerM) throw new Error('TRC 是像素座標，需要 px/m');
  // 每個 marker 名稱佔 3 欄（X Y Z）；名稱列中 marker 的位置 → 資料欄位 = 2 + 3 × (marker 序號)
  const dataCol = (nameIdx: number) => 2 + 3 * markers.indexOf(names[nameIdx].trim());
  const rows = lines.slice(5).map((l) => l.split('\t').map(Number)).filter((r) => r.length > 2 && Number.isFinite(r[1]));
  const pt = (r: number[], nameIdx: number): Pt => {
    if (nameIdx < 0) return null;
    const c = dataCol(nameIdx);
    const x = r[c], y = r[c + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return isPx ? [x / pxPerM!, -y / pxPerM!] : [x, y];
  };
  return {
    units,
    markers,
    series: {
      t: rows.map((r) => r[1]),
      hip: rows.map((r) => pt(r, cols.hip)),
      knee: rows.map((r) => pt(r, cols.knee)),
      ankle: rows.map((r) => pt(r, cols.ankle)),
      heel: rows.map((r) => pt(r, cols.heel)),
      toe: rows.map((r) => pt(r, cols.toe)),
      wrist: cols.wrist >= 0 ? rows.map((r) => pt(r, cols.wrist)) : undefined,
    },
  };
}
