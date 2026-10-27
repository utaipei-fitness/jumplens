// 合成跳躍軌跡（驗證用）：以物理模型產生已知真值的 CMJ / SJ / DJ 矢狀面關鍵點，
// 再依指定幀率取樣並加入姿態估計雜訊。真值事件是連續時間，不受取樣影響。
//
// 模型：髖部垂直軌跡分段（站立 → 下蹲 → Hermite 推蹬 → 拋物線滯空 → 緩衝 → 站立），
// 足部以腳尖為支點做蹠屈（腳跟抬起），膝由兩連桿反運動學求得。
// 滯空中足部隨髖平移；腳尖離地速度以時間常數 τr 從 0 爬升（真實的腳踝蹠屈延遲），
// 可選擇落地時收腿（tuck，滯空法會高估高度，SPEC 12.2）。

import { G } from '../config/thresholds';
import type { KeypointSeries, Pt, TestType } from '../analysis/types';

export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, n, range: (lo: number, hi: number) => lo + (hi - lo) * u() };
}
export type Rng = ReturnType<typeof rng>;

export interface NoiseParams {
  whiteM: number; // 每幀獨立雜訊 σ（m）
  corrM: number; // 低頻相關雜訊 σ（m，AR(1)，τ = 0.1 s）
  outlierP: number; // 每點每幀離群機率
  dropP: number; // 每點每幀開始遺失（1–4 幀）的機率
  timeJitterS: number; // 幀時間抖動 σ（瀏覽器相機）
  scaleErr: number; // 比例尺相對誤差（所有長度乘上 1 + e）
}

export const NOISE_PRESETS: Record<string, NoiseParams> = {
  none: { whiteM: 0, corrM: 0, outlierP: 0, dropP: 0, timeJitterS: 0, scaleErr: 0 },
  // 240 fps 1080p、4.5 m（約 3 mm/px）RTMPose：約 1–2 px 抖動
  official: { whiteM: 0.005, corrM: 0.003, outlierP: 0.002, dropP: 0.002, timeJitterS: 0, scaleErr: 0 },
  // 較差的姿態估計（遮擋、光線差）
  poor: { whiteM: 0.012, corrM: 0.006, outlierP: 0.006, dropP: 0.006, timeJitterS: 0, scaleErr: 0 },
  // 瀏覽器相機 + MediaPipe
  live: { whiteM: 0.008, corrM: 0.005, outlierP: 0.004, dropP: 0.004, timeJitterS: 0.002, scaleErr: 0 },
};

export interface SimParams {
  test: TestType;
  heightM: number; // 受試者身高
  comRiseM: number; // 真實髖（質心近似）起跳後上升高度 = v0²/2g
  cmDepthM: number; // CMJ 下蹲深度
  descentS: number;
  ascentS: number;
  toeRampS: number; // 腳尖離地速度爬升時間常數
  landTuckM: number; // 落地時足部相對髖抬高量（收腿），0 = 伸直落地
  // SJ
  holdS: number;
  holdKneeDeg: number;
  sjDipM: number; // 反向動作下沉量（0 = 無）
  // DJ
  boxM: number;
  gctS: number;
  quietS: number;
}

export interface Truth {
  takeoff: number;
  landing: number;
  flight: number;
  hFlight: number; // 滯空法真值（力板滯空時間法會得到的值）
  hCom: number; // 真實髖上升高度
  onset?: number;
  depth?: number;
  timeToTakeoff?: number;
  contact?: number;
  gct?: number;
  holdKnee?: number;
  dip?: number;
  boxM?: number;
  landingKneeFlex: number;
}

export function defaultParams(test: TestType, r: Rng): SimParams {
  return {
    test,
    heightM: r.range(1.55, 1.95),
    comRiseM: test === 'DJ' ? r.range(0.18, 0.42) : test === 'SJ' ? r.range(0.18, 0.45) : r.range(0.2, 0.55),
    cmDepthM: r.range(0.18, 0.36),
    descentS: r.range(0.4, 0.6),
    ascentS: r.range(0.25, 0.35),
    toeRampS: r.range(0.004, 0.015),
    landTuckM: 0,
    holdS: r.range(2, 3),
    holdKneeDeg: r.range(84, 96),
    sjDipM: 0,
    boxM: [0.3, 0.4][Math.floor(r.u() * 2)],
    gctS: r.range(0.17, 0.32),
    quietS: r.range(1.2, 1.6),
  };
}

// ---- 幾何
function body(H: number) {
  const s = H / 1.75;
  return {
    Lt: 0.245 * H, Ls: 0.246 * H,
    toe0: 0.02 * s, // 腳尖關鍵點離地高度
    // 足部各點相對腳尖（平放）
    heelRel: [-0.19 * s, 0.01 * s] as [number, number],
    ankleRel: [-0.14 * s, 0.048 * s] as [number, number],
  };
}
type Body = ReturnType<typeof body>;

/** 以腳尖為支點、腳跟抬起 θ（rad）時，腳跟與踝相對腳尖的位置 */
function footPose(b: Body, th: number) {
  const rot = (p: [number, number]): [number, number] => [p[0] * Math.cos(th) + p[1] * Math.sin(th), -p[0] * Math.sin(th) + p[1] * Math.cos(th)];
  return { heel: rot(b.heelRel), ankle: rot(b.ankleRel) };
}

/** 兩連桿反運動學：膝在前方 */
function solveKnee(b: Body, hip: [number, number], ank: [number, number]): [number, number] {
  const dx = hip[0] - ank[0], dy = hip[1] - ank[1];
  const d = Math.min(Math.hypot(dx, dy), b.Lt + b.Ls - 1e-6);
  const a = (b.Ls * b.Ls - b.Lt * b.Lt + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, b.Ls * b.Ls - a * a));
  const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
  const px = ank[0] + a * ux, py = ank[1] + a * uy;
  // 垂直方向取朝前（+x）那一側
  const nx = uy, ny = -ux;
  const s = nx >= 0 ? 1 : -1;
  return [px + s * hh * nx, py + s * hh * ny];
}

function flexOf(b: Body, d: number) {
  const c = (b.Lt * b.Lt + b.Ls * b.Ls - d * d) / (2 * b.Lt * b.Ls);
  return 180 - (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}
function dForFlex(b: Body, flexDeg: number) {
  const inc = ((180 - flexDeg) * Math.PI) / 180;
  return Math.sqrt(b.Lt * b.Lt + b.Ls * b.Ls - 2 * b.Lt * b.Ls * Math.cos(inc));
}

const smooth = (s: number) => (s <= 0 ? 0 : s >= 1 ? 1 : (1 - Math.cos(Math.PI * s)) / 2);
function hermite(p0: number, v0: number, p1: number, v1: number, T: number, s: number) {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * T * v0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * T * v1;
}

interface Frame { hip: [number, number]; knee: [number, number]; ankle: [number, number]; heel: [number, number]; toe: [number, number] }

/** 建立連續時間模型，回傳 pose(t) 與真值 */
export function buildModel(P: SimParams) {
  const b = body(P.heightM);
  const L = b.Lt + b.Ls;
  const dStand = 0.997 * L, dExt = 0.995 * L; // 站立約 8°、起跳 / 落地約 11° 膝屈曲
  const thTo = (40 * Math.PI) / 180;
  const ankleH = (th: number) => b.toe0 + footPose(b, th).ankle[1];
  const Ys = ankleH(0) + dStand;
  const Yto = ankleH(thTo) + dExt;
  const v0 = Math.sqrt(2 * G * P.comRiseM);
  const base = P.test === 'DJ' ? P.boxM : 0;
  const hipBackX = (y: number, ref: number) => -0.3 * Math.max(0, ref - y);

  type Seg = { t0: number; t1: number; hip: (t: number) => number; theta: (t: number) => number; ground: number; air?: (t: number) => { dy: number; tuck: number; ramp: number } };
  const segs: Seg[] = [];
  const truth: Partial<Truth> = {};
  let T = 0;
  const quiet = (dur: number, y0: number, g: number) => {
    const t0 = T;
    segs.push({ t0, t1: T + dur, hip: (t) => y0 + 0.001 * Math.sin(2 * Math.PI * 0.3 * (t - t0)), theta: () => 0, ground: g });
    T += dur;
  };

  let pushStartY = Ys - P.cmDepthM;
  let A = P.ascentS;
  quiet(P.quietS, Ys + base, base);

  if (P.test === 'CMJ') {
    const t0 = T, D = P.descentS;
    truth.onset = t0;
    segs.push({ t0, t1: t0 + D, hip: (t) => Ys - P.cmDepthM * smooth((t - t0) / D), theta: () => 0, ground: 0 });
    T += D;
    truth.depth = P.cmDepthM;
  } else if (P.test === 'SJ') {
    const dH = dForFlex(b, P.holdKneeDeg);
    let Yh = ankleH(0) + dH;
    for (let k = 0; k < 3; k++) Yh = ankleH(0) + Math.sqrt(dH * dH - hipBackX(Yh, Ys) ** 2);
    const t0 = T, D = 1.0;
    segs.push({ t0, t1: t0 + D, hip: (t) => Ys - (Ys - Yh) * smooth((t - t0) / D), theta: () => 0, ground: 0 });
    T += D;
    const t1 = T;
    segs.push({ t0: t1, t1: t1 + P.holdS, hip: (t) => Yh + 0.002 * Math.sin(2 * Math.PI * 0.5 * (t - t1)), theta: () => 0, ground: 0 });
    T += P.holdS;
    truth.holdKnee = P.holdKneeDeg;
    truth.dip = P.sjDipM;
    pushStartY = Yh + 0.002 * Math.sin(2 * Math.PI * 0.5 * P.holdS);
    if (P.sjDipM > 0) {
      const t2 = T, D2 = 0.18, y2 = pushStartY;
      segs.push({ t0: t2, t1: t2 + D2, hip: (t) => y2 - P.sjDipM * smooth((t - t2) / D2), theta: () => 0, ground: 0 });
      T += D2;
      pushStartY = y2 - P.sjDipM;
    }
    A = Math.max(P.ascentS, 0.35);
  }

  const addFlightAndLanding = (y0: number) => {
    // 滯空：髖拋物線；足部 = 起跳姿勢平移 − 腳尖爬升延遲 + 收腿
    const tTo = T;
    const ramp = (tau: number) => v0 * P.toeRampS * (1 - Math.exp(-tau / P.toeRampS));
    const hipF = (tau: number) => y0 + v0 * tau - (G * tau * tau) / 2;
    const tuckF = (tau: number) => P.landTuckM * smooth(tau / (2 * v0 / G));
    // 腳尖觸地：(hip − y0) − ramp + tuck = 0（找頂點之後的根）
    let lo = v0 / G, hi = 3 * v0 / G;
    const f = (tau: number) => hipF(tau) - y0 - ramp(tau) + tuckF(tau);
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
    const tf = (lo + hi) / 2;
    segs.push({ t0: tTo, t1: tTo + tf, hip: (t) => hipF(t - tTo), theta: () => thTo, ground: 0, air: (t) => ({ dy: hipF(t - tTo) - y0, tuck: tuckF(t - tTo), ramp: ramp(t - tTo) }) });
    T += tf;
    truth.takeoff = tTo;
    truth.landing = T;
    truth.flight = tf;
    truth.hFlight = (G * tf * tf) / 8;
    truth.hCom = P.comRiseM;
    // 落地：踝高度連續 → 求落地時的 θ
    const ankleAtLand = ankleH(thTo) + ramp(tf);
    let a = 0, c = Math.PI / 2;
    for (let k = 0; k < 60; k++) { const m = (a + c) / 2; if (ankleH(m) < ankleAtLand) a = m; else c = m; }
    const thL = (a + c) / 2;
    const yL = hipF(tf), vL = v0 - G * tf;
    truth.landingKneeFlex = flexOf(b, yL - ankleAtLand);
    const absorb = 0.12 + 0.3 * P.comRiseM;
    const t1 = T, T1 = Math.max(0.18, (2 * (yL - (Ys - absorb))) / Math.abs(vL));
    segs.push({ t0: t1, t1: t1 + T1, hip: (t) => hermite(yL, vL, Ys - absorb, 0, T1, (t - t1) / T1), theta: (t) => thL * (1 - Math.min(1, (t - t1) / 0.08)) ** 2, ground: 0 });
    T += T1;
    const t2 = T;
    segs.push({ t0: t2, t1: t2 + 0.6, hip: (t) => Ys - absorb * (1 - smooth((t - t2) / 0.6)), theta: () => 0, ground: 0 });
    T += 0.6;
    quiet(1.3, Ys, 0);
  };

  if (P.test === 'DJ') {
    // 踏出：從靜止自由落體，落下途中腳尖下壓 20°，腳尖觸地即為第一次觸地
    const tSo = T, thC = (20 * Math.PI) / 180;
    const yBox = Ys + P.boxM;
    // 空中蹠屈：腳尖相對踝下降量
    const toeDrop = (tau: number) => footPose(b, thC * smooth(tau / 0.15)).ankle[1] - footPose(b, 0).ankle[1];
    const hipF = (tau: number) => yBox - (G * tau * tau) / 2;
    const toeY = (tau: number) => P.boxM + b.toe0 - (G * tau * tau) / 2 - toeDrop(tau);
    let lo = 0, hi = 2;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (toeY(m) > b.toe0) lo = m; else hi = m; }
    const td = (lo + hi) / 2;
    segs.push({
      t0: tSo, t1: tSo + td, hip: (t) => hipF(t - tSo), theta: () => 0, ground: P.boxM,
      air: (t) => ({ dy: hipF(t - tSo) - yBox, tuck: 0, ramp: toeDrop(t - tSo) }),
    });
    T += td;
    truth.contact = T;
    truth.boxM = P.boxM;
    // 觸地期：腳跟下落 → 緩衝至最低 → 推蹬（腳跟抬起）→ 離地
    const yC = hipF(td), vC = -G * td;
    const thCon = thC; // 落下 0.15 s 後蹠屈已到 thC，觸地瞬間踝位置連續
    const T1 = Math.max(0.05, (P.gctS - (2 * (Yto - yC)) / v0) / (1 + Math.abs(vC) / v0));
    const yMin = yC - (Math.abs(vC) * T1) / 2;
    const T2 = (2 * (Yto - yMin)) / v0;
    const t1 = T;
    segs.push({ t0: t1, t1: t1 + T1, hip: (t) => hermite(yC, vC, yMin, 0, T1, (t - t1) / T1), theta: (t) => thCon * (1 - smooth((t - t1) / 0.05)), ground: 0 });
    T += T1;
    const t2 = T;
    segs.push({ t0: t2, t1: t2 + T2, hip: (t) => hermite(yMin, 0, Yto, v0, T2, (t - t2) / T2), theta: (t) => thTo * Math.max(0, Math.min(1, (t - (t2 + T2 - 0.1)) / 0.1)) ** 2, ground: 0 });
    T += T2;
    truth.gct = T - truth.contact;
    addFlightAndLanding(Yto);
  } else {
    const dP = Yto - pushStartY;
    A = Math.min(A, (2.5 * dP) / v0);
    const t0 = T, y0 = pushStartY;
    const thStart = t0 + A - 0.15;
    segs.push({ t0, t1: t0 + A, hip: (t) => hermite(y0, 0, Yto, v0, A, (t - t0) / A), theta: (t) => thTo * Math.max(0, Math.min(1, (t - thStart) / 0.15)) ** 2, ground: 0 }); // 蹠屈速度在離地時最大
    T += A;
    if (P.test === 'CMJ') truth.timeToTakeoff = T - truth.onset!;
    addFlightAndLanding(Yto);
  }
  const duration = T;

  // 每段的地面支點（腳尖 x 固定在 0.14·s 前方）
  const toeX = 0.14 * (P.heightM / 1.75);
  const takeoffFoot = (() => { const fp = footPose(b, thTo); return { toe: [toeX, b.toe0], heel: [toeX + fp.heel[0], b.toe0 + fp.heel[1]], ankle: [toeX + fp.ankle[0], b.toe0 + fp.ankle[1]] }; })();

  function pose(t: number): Frame {
    const sg = segs.find((s) => t >= s.t0 && t < s.t1) ?? segs[segs.length - 1];
    const hy = sg.hip(Math.min(t, sg.t1));
    let toe: [number, number], heel: [number, number], ankle: [number, number];
    if (sg.air && sg.ground === 0) {
      const a = sg.air(t);
      const up = a.dy + a.tuck;
      ankle = [takeoffFoot.ankle[0], takeoffFoot.ankle[1] + up];
      heel = [takeoffFoot.heel[0], takeoffFoot.heel[1] + up];
      toe = [toeX, b.toe0 + up - a.ramp];
    } else if (sg.air) {
      // DJ 落下：足部隨髖下落，腳尖下壓
      const a = sg.air(t);
      const fp = footPose(b, 0);
      ankle = [toeX + fp.ankle[0], sg.ground + b.toe0 + fp.ankle[1] + a.dy];
      heel = [toeX + fp.heel[0], sg.ground + b.toe0 + fp.heel[1] + a.dy];
      toe = [toeX, sg.ground + b.toe0 + a.dy - a.ramp];
    } else {
      const th = sg.theta(t);
      const fp = footPose(b, th);
      toe = [toeX, sg.ground + b.toe0];
      heel = [toeX + fp.heel[0], sg.ground + b.toe0 + fp.heel[1]];
      ankle = [toeX + fp.ankle[0], sg.ground + b.toe0 + fp.ankle[1]];
    }
    const hip: [number, number] = [ankle[0] + hipBackX(hy - (sg.ground || 0), Ys), hy];
    return { hip, knee: solveKnee(b, hip, ankle), ankle, heel, toe };
  }
  return { pose, duration, truth: truth as Truth, Ys };
}

/** 依幀率取樣並加入雜訊 */
export function sample(model: ReturnType<typeof buildModel>, fps: number, noise: NoiseParams, r: Rng): KeypointSeries {
  const phase = r.u() / fps;
  const n = Math.floor((model.duration - phase) * fps);
  const keys = ['hip', 'knee', 'ankle', 'heel', 'toe'] as const;
  const out: KeypointSeries = { t: [], hip: [], knee: [], ankle: [], heel: [], toe: [] };
  const rho = Math.exp(-1 / (fps * 0.1));
  const ar: Record<string, [number, number]> = {};
  const gap: Record<string, number> = {};
  for (const k of keys) { ar[k] = [r.n() * noise.corrM, r.n() * noise.corrM]; gap[k] = 0; }
  const sc = 1 + noise.scaleErr;
  for (let i = 0; i < n; i++) {
    const tTrue = phase + i / fps + r.n() * noise.timeJitterS;
    const f = model.pose(tTrue);
    out.t.push(phase + i / fps + (noise.timeJitterS ? r.n() * noise.timeJitterS * 0.2 : 0));
    for (const k of keys) {
      const a = ar[k];
      a[0] = rho * a[0] + Math.sqrt(1 - rho * rho) * noise.corrM * r.n();
      a[1] = rho * a[1] + Math.sqrt(1 - rho * rho) * noise.corrM * r.n();
      if (gap[k] > 0) { gap[k]--; (out[k] as Pt[]).push(null); continue; }
      if (noise.dropP && r.u() < noise.dropP) { gap[k] = Math.floor(r.u() * 4); (out[k] as Pt[]).push(null); continue; }
      let x = f[k][0] + a[0] + noise.whiteM * r.n();
      let y = f[k][1] + a[1] + noise.whiteM * r.n();
      if (noise.outlierP && r.u() < noise.outlierP) { x += 0.08 * r.n(); y += 0.08 * r.n(); }
      (out[k] as Pt[]).push([x * sc, y * sc]);
    }
  }
  return out;
}

export function simulate(P: SimParams, fps: number, noise: NoiseParams, seed: number) {
  const model = buildModel(P);
  return { series: sample(model, fps, noise, rng(seed)), truth: model.truth, params: P };
}
