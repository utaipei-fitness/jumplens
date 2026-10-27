// 信效度統計：描述統計、Bland–Altman、ICC（McGraw & Wong）、SEM、MDC。

import { rng } from '../sim/simulate';

export const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export function sd(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a: number[], q: number) {
  const v = a.slice().sort((x, y) => x - y);
  const i = (v.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
export function pearson(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
export function linreg(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export interface BlandAltman { n: number; bias: number; sd: number; loaLow: number; loaHigh: number; propSlope: number; mae: number; rmse: number; r: number }

/** Bland–Altman：差 = 量測 − 參考 */
export function blandAltman(measured: number[], reference: number[]): BlandAltman {
  const d = measured.map((m, i) => m - reference[i]);
  const avg = measured.map((m, i) => (m + reference[i]) / 2);
  const b = mean(d), s = sd(d);
  return {
    n: d.length, bias: b, sd: s, loaLow: b - 1.96 * s, loaHigh: b + 1.96 * s,
    propSlope: linreg(avg, d).slope,
    mae: mean(d.map(Math.abs)), rmse: Math.sqrt(mean(d.map((x) => x * x))), r: pearson(measured, reference),
  };
}

export interface IccResult { iccA1: number; iccC1: number; sem: number; mdc95: number; msr: number; msc: number; mse: number; n: number; k: number }

/** 雙因子 ANOVA 的 ICC：data[i][j] = 受試者 i、第 j 次（或第 j 種方法） */
export function icc(data: number[][]): IccResult {
  const n = data.length, k = data[0].length;
  const grand = mean(data.flat());
  const rowM = data.map((r) => mean(r));
  const colM = Array.from({ length: k }, (_, j) => mean(data.map((r) => r[j])));
  let ssr = 0, ssc = 0, sst = 0;
  for (let i = 0; i < n; i++) ssr += k * (rowM[i] - grand) ** 2;
  for (let j = 0; j < k; j++) ssc += n * (colM[j] - grand) ** 2;
  for (const r of data) for (const x of r) sst += (x - grand) ** 2;
  const sse = sst - ssr - ssc;
  const msr = ssr / (n - 1), msc = ssc / (k - 1), mse = sse / ((n - 1) * (k - 1));
  const iccA1 = (msr - mse) / (msr + (k - 1) * mse + (k * (msc - mse)) / n);
  const iccC1 = (msr - mse) / (msr + (k - 1) * mse);
  // SEM = √(誤差均方 + 系統偏差變異)，依 Weir (2005) 用 √MSE；MDC95 = 1.96·√2·SEM
  const sem = Math.sqrt(mse);
  return { iccA1, iccC1, sem, mdc95: 1.96 * Math.SQRT2 * sem, msr, msc, mse, n, k };
}

/** 以受試者為單位重抽樣的 bootstrap 95% CI */
export function bootstrapCI<T>(items: T[], stat: (s: T[]) => number, B = 1000, seed = 1): [number, number] {
  const r = rng(seed);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const s = Array.from({ length: items.length }, () => items[Math.floor(r.u() * items.length)]);
    const v = stat(s);
    if (Number.isFinite(v)) vals.push(v);
  }
  return [quantile(vals, 0.025), quantile(vals, 0.975)];
}
