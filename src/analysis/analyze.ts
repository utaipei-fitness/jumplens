// 分析管線（SPEC 8）：清理 → 濾波 → 基準 → 事件 → 指標 → 品質。
// 跳躍高度只用滯空時間法 h = g·t_f²/8；髖位移法只作交叉檢查。

import { G, THRESHOLDS as TH } from '../config/thresholds';
import { butterFiltfilt, derivative, fillGaps, hampel, indexAt, interpAt, median, samplingRate, std } from './signal';
import type { AnalyzeOptions, Events, Flag, KeypointSeries, Metrics, Pt, Status, TrialResult } from './types';

export const jumpHeightFromFlight = (tf: number) => (G * tf * tf) / 8;

export class AnalysisError extends Error {
  constructor(public code: string, message: string, public advice?: string) { super(message); }
}

interface Prepared {
  t: number[];
  fps: number;
  hipE: number[]; footE: number[]; // 20 Hz（事件）
  hipA: number[]; knee: number[]; // 12 Hz（角度、圖）
  kneeRaw: number[];
  wristDist?: number[];
  missingRatio: number;
  outliers: number;
}

const ys = (p: Pt[]) => p.map((q) => (q ? q[1] : NaN));
const xs = (p: Pt[]) => p.map((q) => (q ? q[0] : NaN));

/** 膝屈曲角 = 180° − 大腿向量（髖−膝）與小腿向量（踝−膝）的夾角 */
export function kneeFlexion(hip: [number, number], knee: [number, number], ankle: [number, number]): number {
  const ax = hip[0] - knee[0], ay = hip[1] - knee[1];
  const bx = ankle[0] - knee[0], by = ankle[1] - knee[1];
  const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return 180 - (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

export function prepare(s: KeypointSeries): Prepared {
  const t = s.t;
  const n = t.length;
  if (n < 20) throw new AnalysisError('too_short', '影片太短，至少需要 20 幀', '請包含起跳前 1 秒靜止與落地後 1 秒靜止');
  const fps = samplingRate(t);
  const half = Math.max(3, Math.round(TH.clean.hampelHalfWindowS * fps));

  const footRaw = s.heel.map((h, i) => {
    const a = h ? h[1] : NaN, b = s.toe[i] ? s.toe[i]![1] : NaN;
    return Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b) : Number.isFinite(a) ? a : b;
  });
  const chans = { hipX: xs(s.hip), hipY: ys(s.hip), kneeX: xs(s.knee), kneeY: ys(s.knee), ankX: xs(s.ankle), ankY: ys(s.ankle), foot: footRaw };
  // 遺失 = 無法用短缺口內插補回的幀（或不在畫面內）
  const lost = new Array<boolean>(n).fill(false);
  let outliers = 0;
  const clean: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(chans)) {
    const g = fillGaps(t, v, TH.clean.maxGapFrames);
    g.longGapMask.forEach((m, i) => { if (m) lost[i] = true; });
    const filled = g.y;
    const h = hampel(filled, half, TH.clean.hampelK);
    outliers += h.outliers;
    clean[k] = h.y;
  }
  const fE = (y: number[]) => butterFiltfilt(y, TH.filter.eventCutoffHz, fps, TH.filter.maxCutoffRatioOfFs);
  const fA = (y: number[]) => butterFiltfilt(y, TH.filter.angleCutoffHz, fps, TH.filter.maxCutoffRatioOfFs);
  const hx = fA(clean.hipX), hy = fA(clean.hipY), kx = fA(clean.kneeX), ky = fA(clean.kneeY), ax = fA(clean.ankX), ay = fA(clean.ankY);
  const knee = hx.map((_, i) => kneeFlexion([hx[i], hy[i]], [kx[i], ky[i]], [ax[i], ay[i]]));
  // 未濾波（已清理）的膝角：用於觸地瞬間，避免零相位濾波把觸地後的屈膝「提前」帶進來
  const kneeRaw = hx.map((_, i) => kneeFlexion([clean.hipX[i], clean.hipY[i]], [clean.kneeX[i], clean.kneeY[i]], [clean.ankX[i], clean.ankY[i]]));
  const missing = lost.filter((m, i) => m || (s.inFrame && !s.inFrame[i])).length;

  let wristDist: number[] | undefined;
  if (s.wrist && s.wrist.filter(Boolean).length > n * 0.8) {
    const wx = fA(fillGaps(t, xs(s.wrist), TH.clean.maxGapFrames).y), wy = fA(fillGaps(t, ys(s.wrist), TH.clean.maxGapFrames).y);
    wristDist = wx.map((_, i) => Math.hypot(wx[i] - hx[i], wy[i] - hy[i]));
  }
  return { t, fps, hipE: fE(clean.hipY), footE: fE(clean.foot), hipA: hy, knee, kneeRaw, wristDist, missingRatio: missing / n, outliers };
}

/** 從 i 往回找 c 低於 thr 的幀，回傳亞幀穿越時間與穿越速度 */
function crossBackward(t: number[], c: number[], from: number, thr: number, stop = 0) {
  let i = from;
  while (i > stop && c[i] >= thr) i--;
  if (i <= stop && c[i] >= thr) return null;
  const f = (thr - c[i]) / (c[i + 1] - c[i]);
  return { t: t[i] + f * (t[i + 1] - t[i]), v: (c[i + 1] - c[i]) / (t[i + 1] - t[i]), idx: i };
}

function crossForward(t: number[], c: number[], from: number, thr: number, stop?: number) {
  const end = stop ?? c.length - 1;
  let j = from;
  while (j < end && c[j] >= thr) j++;
  if (c[j] >= thr || j === 0) return null;
  const f = (c[j - 1] - thr) / (c[j - 1] - c[j]);
  return { t: t[j - 1] + f * (t[j] - t[j - 1]), v: (c[j] - c[j - 1]) / (t[j] - t[j - 1]), idx: j };
}

function correction(thr: number, v: number, on: boolean) {
  if (!on || Math.abs(v) < TH.events.minFootSpeedForCorrection) return 0;
  return Math.min(thr / Math.abs(v), TH.events.maxCorrectionS);
}

/** 第二偵測器：足部垂直速度穿越「進出滯空時速度峰值的一半」（零相位濾波下階躍中點即事件時刻） */
function detectorB(p: Prepared, takeoff: number, landing: number) {
  const v = derivative(p.t, p.footE);
  const i0 = indexAt(p.t, takeoff), i1 = indexAt(p.t, landing);
  const w = Math.max(2, Math.round(0.05 * p.fps));
  let ipk = i0;
  for (let i = i0; i <= Math.min(i1, i0 + w); i++) if (v[i] > v[ipk]) ipk = i;
  let i = ipk;
  while (i > 0 && v[i] > v[ipk] / 2) i--;
  const tTo = p.t[i] + ((v[ipk] / 2 - v[i]) / (v[i + 1] - v[i])) * (p.t[i + 1] - p.t[i]);
  let jmn = i1;
  for (let j = Math.max(i0, i1 - w); j <= i1; j++) if (v[j] < v[jmn]) jmn = j;
  let j = jmn;
  while (j < v.length - 1 && v[j] < v[jmn] / 2) j++;
  const tLa = p.t[j - 1] + ((v[jmn] / 2 - v[j - 1]) / (v[j] - v[j - 1])) * (p.t[j] - p.t[j - 1]);
  return { takeoff_s: tTo, landing_s: tLa };
}

/** 觸地瞬間膝屈曲：觸地前 20 ms 內未濾波膝角的中位數（至少 2 幀） */
function kneeAtContact(p: Prepared, tc: number) {
  const w = Math.max(0.02, 2 / p.fps);
  const v = p.kneeRaw.filter((_, i) => p.t[i] <= tc && p.t[i] > tc - w);
  return v.length ? median(v) : interpAt(p.t, p.knee, tc);
}

function argmax(a: number[], lo = 0, hi = a.length - 1) {
  let k = lo;
  for (let i = lo; i <= hi; i++) if (a[i] > a[k]) k = i;
  return k;
}
function argmin(a: number[], lo = 0, hi = a.length - 1) {
  let k = lo;
  for (let i = lo; i <= hi; i++) if (a[i] < a[k]) k = i;
  return k;
}

/** SJ 保持階段：起跳前最長、髖偏離中位數 < band 的區間，且必須是蹲下狀態 */
function findHold(t: number[], hip: number[], end: number, hipBase: number) {
  const band = TH.phases.sjHoldBandM;
  let best: { lo: number; hi: number } | null = null;
  let lo = 0;
  for (let hi = 0; hi <= end; hi++) {
    // 縮小視窗直到 max−min ≤ 2·band
    for (;;) {
      let mx = -Infinity, mn = Infinity;
      for (let k = lo; k <= hi; k++) { if (hip[k] > mx) mx = hip[k]; if (hip[k] < mn) mn = hip[k]; }
      if (mx - mn <= 2 * band) break;
      lo++;
    }
    const m = median(hip.slice(lo, hi + 1));
    if (hipBase - m < TH.phases.sjSquatMinDropM) continue;
    if (!best || t[hi] - t[lo] > t[best.hi] - t[best.lo]) best = { lo, hi };
  }
  return best;
}

export interface ManualEvents { takeoff_s?: number; landing_s?: number; contact_s?: number }

export function analyze(s: KeypointSeries, opt: AnalyzeOptions, manual?: ManualEvents): TrialResult {
  const p = prepare(s);
  const { t, fps } = p;
  const n = t.length;
  const flags: Flag[] = [];
  const bias = opt.biasCorrection ?? TH.events.biasCorrection;
  const add = (level: Status, code: string, message: string, advice?: string) => flags.push({ level, code, message, advice });

  // ---- 基準（SPEC 8.1 第 6 步）
  const q = t.findIndex((x) => x - t[0] >= TH.baseline.quietS);
  const qEnd = q > 0 ? q : Math.min(n - 1, Math.round(fps));
  const hipBase = median(p.hipE.slice(0, qEnd));
  const hipSigma = std(p.hipE.slice(0, qEnd));
  const footStart = median(p.footE.slice(0, qEnd));
  let ground = opt.groundY;
  if (ground === undefined) {
    if (opt.test === 'DJ') {
      const e = t.findIndex((x) => t[n - 1] - x <= TH.baseline.endQuietS);
      ground = median(p.footE.slice(Math.max(0, e)));
    } else ground = footStart;
  }
  const sigma = opt.noiseSigma ?? std(p.footE.slice(0, qEnd));
  const thr = Math.max(TH.events.minThresholdM, TH.events.sigmaMultiplier * sigma);
  const c = p.footE.map((y) => y - ground!);

  // ---- 事件（SPEC 8.2）：從空中最高點往兩側找
  let searchFrom = 0;
  let contact: { t: number; idx: number } | undefined;
  let stepOff: number | undefined;
  if (opt.test === 'DJ') {
    const boxC = footStart - ground;
    if (boxC < 0.08) throw new AnalysisError('no_box', '偵測不到跳箱高度（起始足部高度與地面幾乎相同）', '請確認影片從站在跳箱上開始，並在結尾靜止 1 秒');
    const leave = c.findIndex((v) => v < boxC - thr);
    if (leave < 0) throw new AnalysisError('no_step', '找不到踏出跳箱', undefined);
    stepOff = t[leave];
    const cr = crossForward(t, c, leave, thr);
    if (!cr) throw new AnalysisError('no_contact', '找不到第一次觸地');
    contact = { t: cr.t + correction(thr, cr.v, bias), idx: cr.idx };
    searchFrom = cr.idx;
  }
  const lastI = n - 1 - Math.max(1, Math.round(0.05 * fps));
  const apex = argmax(p.hipE, searchFrom, lastI);
  if (c[apex] < thr) throw new AnalysisError('no_flight', '找不到滯空（最高點時足部仍在地面）', '請確認受試者完整入鏡、腳部未被切出畫面');
  const to = crossBackward(t, c, apex, thr, searchFrom);
  const la = crossForward(t, c, apex, thr);
  if (!to) throw new AnalysisError('no_takeoff', '找不到起跳', '請確認影片包含起跳前至少 1 秒靜止');
  if (!la) throw new AnalysisError('no_landing', '找不到落地', '請確認影片包含落地後至少 1 秒靜止');
  const autoTakeoff = to.t - correction(thr, to.v, bias);
  const autoLanding = la.t + correction(thr, la.v, bias);

  const takeoff = manual?.takeoff_s ?? autoTakeoff;
  const landing = manual?.landing_s ?? autoLanding;
  const contactT = manual?.contact_s ?? contact?.t;
  const tf = landing - takeoff;
  if (tf < TH.events.minFlightS || tf > TH.events.maxFlightS) {
    throw new AnalysisError('bad_flight', `滯空時間 ${(tf * 1000).toFixed(0)} ms 不合理`, '請檢查事件或重拍');
  }

  const h = jumpHeightFromFlight(tf);
  const metrics: Metrics = { jump_height_cm: h * 100, flight_time_ms: tf * 1000 };
  const events: Events = { takeoff_s: takeoff, landing_s: landing, apex_s: t[apex], source: manual ? 'manual' : 'auto' };
  const eventsAuto: Events = { ...events, takeoff_s: autoTakeoff, landing_s: autoLanding, source: 'auto' };
  if (contactT !== undefined) { events.contact_s = contactT; eventsAuto.contact_s = contact?.t; }
  if (stepOff !== undefined) { events.step_off_s = stepOff; eventsAuto.step_off_s = stepOff; }

  // ---- 交叉檢查
  const hipTo = interpAt(t, p.hipE, takeoff);
  metrics.hip_height_cm = (p.hipE[apex] - hipTo) * 100;
  if (Math.abs(metrics.hip_height_cm / 100 - h) / h > TH.validity.hipVsFlightMaxDiff) {
    add('Warning', 'hip_vs_flight', `髖位移法 ${metrics.hip_height_cm.toFixed(1)} cm 與滯空法差超過 15%`, '可能落地姿勢與起跳不同，或關鍵點抖動');
  }
  const landFlex = kneeAtContact(p, landing);
  metrics.landing_knee_flex_deg = landFlex;
  if (landFlex > TH.validity.landingKneeFlexMaxDeg) {
    add('Warning', 'landing_knee', `落地膝屈曲 ${landFlex.toFixed(0)}° 超過門檻，滯空法會高估高度`, '提醒受試者雙腿伸直落地');
  }
  const det = detectorB(p, autoTakeoff, autoLanding);
  const lim = TH.events.detectorDisagreeFrames / fps;
  if (Math.abs(det.takeoff_s - autoTakeoff) > lim || Math.abs(det.landing_s - autoLanding) > lim) {
    add('Warning', 'detectors_disagree', '兩個事件偵測器差超過 2 幀', '請用 Adjust events 逐幀確認起跳與落地');
  }

  const toI = indexAt(t, takeoff);
  // ---- 測驗別階段與有效性（SPEC 7.2 / 8.4）
  if (opt.test === 'CMJ') {
    const onsetThr = Math.max(TH.phases.onsetMinDropM, 5 * hipSigma);
    const low = argmin(p.hipE, 0, toI);
    // 先找髖低於基準 max(1 cm, 5σ) 的時刻，再往回找「持續下降」的起點（髖速度由負轉為 ≥ 0 處）
    const vHip = derivative(t, p.hipA);
    let i = low;
    while (i > 0 && p.hipE[i] < hipBase - onsetThr) i--;
    while (i > 0 && vHip[i] < 0 && p.hipA[i] < hipBase - 0.5 * hipSigma) i--;
    const onset = t[i];
    events.onset_s = eventsAuto.onset_s = onset;
    events.lowest_s = eventsAuto.lowest_s = t[low];
    metrics.cm_depth_cm = (hipBase - p.hipE[low]) * 100;
    metrics.time_to_takeoff_ms = (takeoff - onset) * 1000;
    metrics.rsi_mod_m_s = h / (takeoff - onset);
    if (i === 0) add('Warning', 'no_quiet_start', '起跳前沒有偵測到靜止站立', '開始錄影後先站穩 2 秒');
    if (p.wristDist) {
      const mx = Math.max(...p.wristDist.slice(i, toI + 1));
      if (mx > TH.validity.wristOffHipM) add('Warning', 'hands_off_hips', '手腕離開髖部（未維持雙手扠腰）', '請雙手扠腰重跳');
    }
  } else if (opt.test === 'SJ') {
    const hold = findHold(t, p.hipA, toI, hipBase);
    if (!hold || t[hold.hi] - t[hold.lo] < TH.phases.sjHoldMinS) {
      add('Fail', 'no_hold', '找不到 ≥ 1 秒的蹲姿保持階段', '蹲到膝約 90° 並保持 2–3 秒，聽到 Go 再跳');
    } else {
      events.hold_start_s = eventsAuto.hold_start_s = t[hold.lo];
      events.hold_end_s = eventsAuto.hold_end_s = t[hold.hi];
      const holdHip = median(p.hipA.slice(hold.lo, hold.hi + 1));
      const holdKnee = median(p.knee.slice(hold.lo, hold.hi + 1));
      metrics.hold_knee_angle_deg = holdKnee;
      const w0 = Math.max(hold.lo, indexAt(t, t[hold.hi] - TH.validity.sjCmWindowS));
      const dip = holdHip - Math.min(...p.hipA.slice(hold.lo, toI + 1));
      const kneeInc = Math.max(...p.knee.slice(w0, toI + 1)) - holdKnee;
      metrics.cm_dip_cm = Math.max(0, dip) * 100;
      metrics.cm_knee_increase_deg = Math.max(0, kneeInc);
      if (holdKnee < TH.validity.sjHoldKneeMinDeg || holdKnee > TH.validity.sjHoldKneeMaxDeg) {
        add('Fail', 'hold_angle', `保持膝角 ${holdKnee.toFixed(0)}° 不在 80–100°`, '用量角器確認深度後重拍');
      }
      if (dip > TH.validity.sjCmHipDipM || kneeInc > TH.validity.sjCmKneeDeg) {
        add('Fail', 'countermovement', `起跳前有反向動作（髖下沉 ${(dip * 100).toFixed(1)} cm、膝角減少 ${kneeInc.toFixed(1)}°）`, '聽到 Go 後直接往上跳，不可先下沉');
      }
    }
  } else {
    const gct = takeoff - contactT!;
    metrics.drop_height_cm = (footStart - ground) * 100;
    metrics.knee_flex_contact_deg = kneeAtContact(p, contactT!);
    const preRise = Math.max(...p.hipE.slice(0, indexAt(t, stepOff!) + 1)) - hipBase;
    if (preRise > TH.validity.djPreRiseM) add('Warning', 'jumped_off', '踏出前髖先上升（像是跳下而非踏出）', '請從箱緣「踏出」，不要往上跳');
    if (opt.boxHeightM !== undefined && Math.abs(metrics.drop_height_cm / 100 - opt.boxHeightM) > TH.validity.djDropHeightDiffM) {
      add('Warning', 'box_height', `估計落下高度 ${metrics.drop_height_cm.toFixed(1)} cm 與箱高 ${(opt.boxHeightM * 100).toFixed(0)} cm 差超過 3 cm`, '確認箱高輸入與比例尺');
    }
    if (opt.mode === 'preview' && fps < TH.fps.liveMinForGct - 1) {
      add('Warning', 'low_fps_gct', `實測 ${fps.toFixed(0)} fps < 60，不顯示 GCT 與 RSI`);
    } else {
      metrics.gct_ms = gct * 1000;
      metrics.rsi_m_s = h / gct;
      if (gct < TH.validity.djGctMinS || gct > TH.validity.djGctMaxS) add('Warning', 'gct_range', `GCT ${(gct * 1000).toFixed(0)} ms 不在 100–400 ms`);
    }
  }

  // ---- 品質（SPEC 8.5）
  if (opt.mode === 'official') {
    if (fps < TH.fps.officialMin) add('Fail', 'fps_low', `實際 ${fps.toFixed(0)} fps < 120`, '用相機 App 慢動作 240 fps 拍攝，並以「檔案」App 或 AirDrop 傳原始檔');
    else if (fps < TH.fps.officialFull - 1) add('Warning', 'fps_mid', `實際 ${fps.toFixed(0)} fps（120–239）`);
  }
  if (p.missingRatio > TH.clean.maxMissingRatio) add('Fail', 'missing', `關鍵點遺失 ${(p.missingRatio * 100).toFixed(1)}% > 5%`, '受試者需完整入鏡（頭到腳），必要時把腳架退後');
  if (opt.scaleDiff !== undefined) {
    if (opt.scaleDiff > TH.scale.failDiff) add('Fail', 'scale', `比例尺兩種來源差 ${(opt.scaleDiff * 100).toFixed(1)}% > 5%`, '重拍參照影片');
    else if (opt.scaleDiff > TH.scale.okDiff) add('Warning', 'scale', `比例尺兩種來源差 ${(opt.scaleDiff * 100).toFixed(1)}%`);
  }
  if (opt.backgroundShiftPx !== undefined && opt.backgroundShiftPx > 5) add('Fail', 'camera_moved', '背景位移 > 5 px', '相機可能被碰到，請重新校正');

  const status: Status = flags.some((f) => f.level === 'Fail') ? 'Fail' : flags.some((f) => f.level === 'Warning') ? 'Warning' : 'OK';

  // ---- 圖表序列（最多 800 點）
  const step = Math.max(1, Math.ceil(n / 800));
  const idx = Array.from({ length: Math.ceil(n / step) }, (_, k) => k * step);
  return {
    test: opt.test,
    mode: opt.mode,
    status,
    flags,
    fps,
    events,
    events_auto: eventsAuto,
    metrics,
    detectorB: det,
    baseline: { hipY: hipBase, footY: footStart, groundY: ground, sigma, threshold: thr },
    series: {
      t_s: idx.map((i) => t[i]),
      hip_y_cm: idx.map((i) => (p.hipA[i] - ground!) * 100),
      foot_y_cm: idx.map((i) => (p.footE[i] - ground!) * 100),
      knee_angle_deg: idx.map((i) => p.knee[i]),
    },
  };
}

/** 分析失敗時也回傳一份 Fail 結果，讓試跳清單能顯示原因與建議 */
export function analyzeSafe(s: KeypointSeries, opt: AnalyzeOptions, manual?: ManualEvents): TrialResult | { status: 'Fail'; flags: Flag[]; fps: number } {
  try {
    return analyze(s, opt, manual);
  } catch (e) {
    const err = e instanceof AnalysisError ? e : new AnalysisError('error', String(e));
    return { status: 'Fail', flags: [{ level: 'Fail', code: err.code, message: err.message, advice: err.advice }], fps: s.t.length > 1 ? samplingRate(s.t) : 0 };
  }
}
