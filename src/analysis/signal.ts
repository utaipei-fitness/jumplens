// 訊號前處理（SPEC 8.1 第 4–5 步）：短缺口內插、Hampel 去離群、零相位 Butterworth。
// 全部是純函式，輸入不被修改。

export function median(a: number[]): number {
  const v = a.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (v.length === 0) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function std(a: number[]): number {
  const v = a.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** 取樣率：相鄰時間戳差的中位數（不用標稱 fps） */
export function samplingRate(t: number[]): number {
  const dt: number[] = [];
  for (let i = 1; i < t.length; i++) dt.push(t[i] - t[i - 1]);
  return 1 / median(dt);
}

/**
 * 以時間內插填補 NaN。maxGap 以內的缺口用線性內插；更長的缺口也會填（避免濾波器爆掉），
 * 但回傳 longGapMask 讓品質判斷知道哪些幀是真的遺失。
 */
export function fillGaps(t: number[], y: number[], maxGap: number): { y: number[]; longGapMask: boolean[] } {
  const n = y.length;
  const out = y.slice();
  const longGapMask = new Array<boolean>(n).fill(false);
  let i = 0;
  while (i < n) {
    if (Number.isFinite(out[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isFinite(out[j])) j++;
    const len = j - i;
    const a = i - 1, b = j;
    for (let k = i; k < j; k++) {
      if (a >= 0 && b < n) out[k] = out[a] + ((out[b] - out[a]) * (t[k] - t[a])) / (t[b] - t[a]);
      else if (a >= 0) out[k] = out[a];
      else if (b < n) out[k] = out[b];
      else out[k] = 0;
      if (len >= maxGap) longGapMask[k] = true;
    }
    i = j;
  }
  return { y: out, longGapMask };
}

/** Hampel 濾波：與滑動中位數差超過 k × 1.4826 × MAD 的點以中位數取代 */
export function hampel(y: number[], half: number, k: number): { y: number[]; outliers: number } {
  const n = y.length;
  const out = y.slice();
  let outliers = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
    const w = y.slice(lo, hi);
    const m = median(w);
    const mad = median(w.map((x) => Math.abs(x - m))) * 1.4826;
    if (mad > 0 && Math.abs(y[i] - m) > k * mad) { out[i] = m; outliers++; }
  }
  return { y: out, outliers };
}

/** 二階 Butterworth 低通係數（雙線性轉換 + 預扭曲） */
function butter2(fc: number, fs: number) {
  const K = Math.tan((Math.PI * fc) / fs);
  const norm = 1 / (1 + Math.SQRT2 * K + K * K);
  const b0 = K * K * norm;
  return { b: [b0, 2 * b0, b0], a: [1, 2 * (K * K - 1) * norm, (1 - Math.SQRT2 * K + K * K) * norm] };
}

function lfilter(b: number[], a: number[], x: number[]): number[] {
  // Direct Form II transposed，初始狀態設為輸入第一點的穩態，避免開頭暫態
  const y = new Array<number>(x.length);
  const x0 = x[0];
  let z1 = x0 - b[0] * x0;
  let z2 = b[2] * x0 - a[2] * x0;
  for (let i = 0; i < x.length; i++) {
    const yi = b[0] * x[i] + z1;
    z1 = b[1] * x[i] - a[1] * yi + z2;
    z2 = b[2] * x[i] - a[2] * yi;
    y[i] = yi;
  }
  return y;
}

/**
 * 四階零相位 Butterworth：二階濾波器前後各跑一次（filtfilt）。
 * 雙向濾波會讓 −3 dB 點下移，依 Winter (2009) 以 0.802 修正截止頻率。
 * 端點用奇對稱延伸（同 scipy filtfilt），截止頻率上限 0.4 × fs。
 */
export function butterFiltfilt(y: number[], fc: number, fs: number, maxRatio = 0.4): number[] {
  const n = y.length;
  if (n < 4) return y.slice();
  const fcEff = Math.min(fc / 0.802, maxRatio * fs);
  const { b, a } = butter2(fcEff, fs);
  const pad = Math.min(n - 1, Math.max(6, Math.round((3 * fs) / fcEff)));
  const ext: number[] = [];
  for (let i = pad; i >= 1; i--) ext.push(2 * y[0] - y[i]);
  for (let i = 0; i < n; i++) ext.push(y[i]);
  for (let i = n - 2; i >= n - 1 - pad; i--) ext.push(2 * y[n - 1] - y[i]);
  const fwd = lfilter(b, a, ext);
  const bwd = lfilter(b, a, fwd.reverse()).reverse();
  return bwd.slice(pad, pad + n);
}

/** 以實際時間戳做中央差分 */
export function derivative(t: number[], y: number[]): number[] {
  const n = y.length;
  const d = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    d[i] = b > a ? (y[b] - y[a]) / (t[b] - t[a]) : 0;
  }
  return d;
}

/** 在時間 tq 對序列做線性內插 */
export function interpAt(t: number[], y: number[], tq: number): number {
  if (tq <= t[0]) return y[0];
  const n = t.length;
  if (tq >= t[n - 1]) return y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tq) lo = mid; else hi = mid;
  }
  return y[lo] + ((y[hi] - y[lo]) * (tq - t[lo])) / (t[hi] - t[lo]);
}

export function indexAt(t: number[], tq: number): number {
  let best = 0;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - tq) < Math.abs(t[best] - tq)) best = i;
  return best;
}
