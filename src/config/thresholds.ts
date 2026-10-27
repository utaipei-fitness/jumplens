// 所有門檻、截止頻率與容許誤差都放在這裡（SPEC 7.2 / 7.4 / 8 / 8.5），程式中不寫死數字。
// 內部單位一律 SI（m、s、度），只在介面層換算成 cm / ms。
// 這些是 SPEC 的起始值，需要用前測資料調整，不是已驗證的標準（SPEC 12.2）。

export const G = 9.81;

export const THRESHOLDS = {
  fps: {
    officialMin: 120, // < 120 → Fail
    officialFull: 240, // 120–239 → Warning
    liveMinForGct: 60, // Live 實測 fps < 60 時不顯示 GCT 與 RSI
  },
  clean: {
    maxGapFrames: 5, // 短缺口（< 5 幀）內插
    hampelHalfWindowS: 0.03, // Hampel 半窗（秒），依 fps 換算幀數，至少 3 幀
    hampelK: 3, // Hampel 判定倍數（MAD × 1.4826 × k）
    maxMissingRatio: 0.05, // 關鍵點遺失 > 5% → Fail
  },
  filter: {
    eventCutoffHz: 20, // 事件偵測用
    angleCutoffHz: 12, // 角度與軌跡圖用
    maxCutoffRatioOfFs: 0.4, // 低幀率時截止頻率上限 = 0.4 × fs（避免超過 Nyquist）
  },
  baseline: {
    quietS: 1.0, // 試跳開頭靜止 1 秒
    endQuietS: 1.0, // DJ 無地面基準時，用結尾靜止 1 秒當地面
  },
  events: {
    minThresholdM: 0.015, // 閾值 = max(1.5 cm, 5σ)
    sigmaMultiplier: 5,
    biasCorrection: true, // SPEC 8.2 第 4 步
    minFootSpeedForCorrection: 0.3, // m/s；穿越速度太小時不修正（避免除以接近 0）
    maxCorrectionS: 0.02, // 單側修正上限
    detectorDisagreeFrames: 2, // 兩個偵測器差 > 2 幀 → Warning
    detectorBSpeed: 0.5, // 第二偵測器：足部垂直速度門檻（m/s）
    minFlightS: 0.15,
    maxFlightS: 1.2,
  },
  phases: {
    onsetMinDropM: 0.01, // CMJ 動作開始 = 髖低於基準 max(1 cm, 5σ)
    sjHoldBandM: 0.01, // SJ 保持階段：髖偏離中位數 < 1 cm
    sjHoldMinS: 1.0,
    sjSquatMinDropM: 0.08, // 保持區間的髖至少比站立低 8 cm（排除開頭站立）
  },
  validity: {
    landingKneeFlexMaxDeg: 25, // 落地膝屈曲超過 → Warning（滯空法會高估）
    hipVsFlightMaxDiff: 0.15, // 髖位移法與滯空法差 > 15% → Warning
    sjHoldKneeMinDeg: 80,
    sjHoldKneeMaxDeg: 100,
    sjCmKneeDeg: 3, // 保持中膝屈曲增加（膝角減少）> 3° → 反向動作
    sjCmHipDipM: 0.02, // 起跳前髖下沉 > 2 cm → 反向動作
    sjCmWindowS: 0.3,
    djDropHeightDiffM: 0.03, // 估計落下高度與箱高差 > 3 cm → Warning
    djGctMinS: 0.1,
    djGctMaxS: 0.4,
    djPreRiseM: 0.02, // 踏出前髖上升 > 2 cm → 不是踏出（跳下）
    wristOffHipM: 0.12, // CMJ 手腕離開髖部 > 12 cm → Warning
  },
  scale: {
    eyeToHeelOfHeight: 0.925, // 身高法：眼睛到腳跟的垂直距離 ≈ 0.925 × 身高
    okDiff: 0.03,
    failDiff: 0.05,
  },
  live: {
    marginRatio: 0.05, // 四邊各留 5%
    bodyRatioMin: 0.5,
    bodyRatioMax: 0.6,
    tiltMaxDeg: 0.5,
    stillSpeedMps: 0.05, // 髖與踝速度低於此值
    stillHoldS: 1.0,
    brightnessMin: 70,
    brightnessMax: 200,
    sjHoldStableS: 1.0,
    bufferS: 8,
    minVisibility: 0.5,
  },
} as const;

export type Thresholds = typeof THRESHOLDS;
