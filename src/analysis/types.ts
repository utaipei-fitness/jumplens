// 分析核心共用型別。座標單位：公尺，Y 軸向上為正，X 軸朝受試者前方。

export type TestType = 'CMJ' | 'SJ' | 'DJ';
export type Mode = 'preview' | 'official';
export type Status = 'OK' | 'Warning' | 'Fail';

export type Pt = [number, number] | null;

/** 單側（面向鏡頭那一側）矢狀面關鍵點時間序列 */
export interface KeypointSeries {
  t: number[]; // 每幀時間戳（秒）
  hip: Pt[];
  knee: Pt[];
  ankle: Pt[];
  heel: Pt[];
  toe: Pt[];
  wrist?: Pt[];
  /** 影像來源資訊（選填）：用於品質判斷 */
  inFrame?: boolean[];
}

export interface AnalyzeOptions {
  test: TestType;
  mode: Mode;
  /** DJ 箱高（m） */
  boxHeightM?: number;
  /** 地面基準（足部最低點的垂直位置，m）；由設定精靈的參照影片提供，沒有就自動估計 */
  groundY?: number;
  /** 足部靜止雜訊 σ（m）；由參照影片提供，沒有就用試跳開頭靜止段 */
  noiseSigma?: number;
  /** 比例尺兩種來源的相對差（尺法 vs 身高法），用於品質判斷 */
  scaleDiff?: number;
  /** 背景位移（px），用於品質判斷 */
  backgroundShiftPx?: number;
  /** 關掉 SPEC 8.2 偏差修正（驗證用） */
  biasCorrection?: boolean;
}

export interface Events {
  onset_s?: number;
  lowest_s?: number;
  hold_start_s?: number;
  hold_end_s?: number;
  step_off_s?: number;
  contact_s?: number; // DJ 第一次觸地
  takeoff_s: number;
  landing_s: number;
  apex_s: number;
  source: 'auto' | 'manual';
}

export interface Metrics {
  jump_height_cm?: number;
  flight_time_ms?: number;
  rsi_mod_m_s?: number;
  cm_depth_cm?: number;
  time_to_takeoff_ms?: number;
  hold_knee_angle_deg?: number;
  cm_dip_cm?: number;
  cm_knee_increase_deg?: number;
  gct_ms?: number;
  rsi_m_s?: number;
  knee_flex_contact_deg?: number;
  drop_height_cm?: number;
  hip_height_cm?: number; // 髖位移法（只作交叉檢查，不作為報告數值）
  landing_knee_flex_deg?: number;
}

export interface Flag {
  level: Status;
  code: string;
  message: string;
  advice?: string;
}

export interface TrialResult {
  test: TestType;
  mode: Mode;
  status: Status;
  flags: Flag[];
  fps: number;
  events: Events;
  events_auto: Events;
  metrics: Metrics;
  detectorB?: { takeoff_s: number; landing_s: number };
  baseline: { hipY: number; footY: number; groundY: number; sigma: number; threshold: number };
  series: { t_s: number[]; hip_y_cm: number[]; foot_y_cm: number[]; knee_angle_deg: number[] };
}
