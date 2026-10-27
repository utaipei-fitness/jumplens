// 內部信效度驗證（模擬研究）：npm run validate
// 用已知真值的合成跳躍，跑「與網頁完全相同」的分析程式，輸出 public/validation/results.json 與 validation/REPORT.md。
//
// 注意：這是方法學的內部驗證（演算法在已知真值下的準確度與重複性），
// 不能取代 SPEC 12.1 的真人實測（Kinovea 人工標記、力板 / My Jump Lab、跨日重測）。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, jumpHeightFromFlight } from '../src/analysis/analyze';
import { fromMediaPipe, pxPerMFromHeight, type PoseFrame } from '../src/analysis/pose';
import { blandAltman, bootstrapCI, icc, mean, sd, type BlandAltman } from '../src/analysis/stats';
import type { TestType, TrialResult } from '../src/analysis/types';
import { defaultParams, NOISE_PRESETS, rng, simulate, type NoiseParams, type SimParams, type Truth } from '../src/sim/simulate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS: TestType[] = ['CMJ', 'SJ', 'DJ'];
const N = Number(process.env.N ?? 150);
const t0 = Date.now();

type Run = { P: SimParams; truth: Truth; r: TrialResult | null; err?: string };
function run(P: SimParams, fps: number, noise: NoiseParams, seed: number, opts: { bias?: boolean; mode?: 'official' | 'preview' } = {}): Run {
  const { series, truth } = simulate(P, fps, noise, seed);
  try {
    return { P, truth, r: analyze(series, { test: P.test, mode: opts.mode ?? 'official', boxHeightM: P.boxM, biasCorrection: opts.bias }) };
  } catch (e) {
    return { P, truth, r: null, err: String(e) };
  }
}
const ok = (runs: Run[]) => runs.filter((x) => x.r) as (Run & { r: TrialResult })[];
const r2 = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const baR = (b: BlandAltman, d = 2) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, r2(v, k === 'r' || k === 'propSlope' ? 4 : d)]));
const statusRate = (runs: Run[]) => {
  const c = { OK: 0, Warning: 0, Fail: 0 };
  for (const x of runs) c[x.r ? x.r.status : 'Fail']++;
  return { OK: r2(c.OK / runs.length, 3), Warning: r2(c.Warning / runs.length, 3), Fail: r2(c.Fail / runs.length, 3) };
};
const flagRate = (runs: Run[], code: string) => r2(runs.filter((x) => x.r?.flags.some((f) => f.code === code)).length / runs.length, 3);

const params = (test: TestType, seed: number) => defaultParams(test, rng(seed));

const results: Record<string, unknown> = { generated: new Date().toISOString(), n_per_condition: N };

// ---------------------------------------------------------------- S1 公式
results.formula = {
  flight_0_5s_cm: r2(jumpHeightFromFlight(0.5) * 100, 2),
  expected_cm: 30.66,
  pass: Math.abs(jumpHeightFromFlight(0.5) * 100 - 30.66) < 0.01,
};

// ---------------------------------------------------------------- S2 效標效度（Official 240 fps）+ S3 偏差修正
const validity: Record<string, unknown> = {};
const biasEffect: Record<string, unknown> = {};
const baPoints: Record<string, { mean: number; diff: number }[]> = {};
for (const test of TESTS) {
  const runsOn: Run[] = [], runsOff: Run[] = [];
  for (let i = 0; i < N; i++) {
    const P = params(test, 1000 + i);
    runsOn.push(run(P, 240, NOISE_PRESETS.official, 5000 + i));
    runsOff.push(run(P, 240, NOISE_PRESETS.official, 5000 + i, { bias: false }));
  }
  const g = ok(runsOn);
  const hM = g.map((x) => x.r.metrics.jump_height_cm!), hT = g.map((x) => x.truth.hFlight * 100), hC = g.map((x) => x.truth.hCom * 100);
  const toErr = g.map((x) => (x.r.events.takeoff_s - x.truth.takeoff) * 1000);
  const laErr = g.map((x) => (x.r.events.landing_s - x.truth.landing) * 1000);
  const v: Record<string, unknown> = {
    n: g.length,
    analysable: r2(g.length / runsOn.length, 3),
    status: statusRate(runsOn),
    height_vs_flight_truth: baR(blandAltman(hM, hT)),
    height_vs_flight_truth_icc: r2(icc(hM.map((m, i) => [m, hT[i]])).iccA1, 4),
    height_icc_ci: bootstrapCI(hM.map((m, i) => [m, hT[i]]), (s) => icc(s).iccA1).map((x) => r2(x, 4)),
    height_vs_com_truth: baR(blandAltman(hM, hC)),
    takeoff_err_ms: { mean: r2(mean(toErr)), sd: r2(sd(toErr)) },
    landing_err_ms: { mean: r2(mean(laErr)), sd: r2(sd(laErr)) },
    detectorB_takeoff_err_ms: (() => { const e = g.map((x) => (x.r.detectorB!.takeoff_s - x.truth.takeoff) * 1000); return { mean: r2(mean(e)), sd: r2(sd(e)) }; })(),
    detectorB_landing_err_ms: (() => { const e = g.map((x) => (x.r.detectorB!.landing_s - x.truth.landing) * 1000); return { mean: r2(mean(e)), sd: r2(sd(e)) }; })(),
    flight_err_ms: { mean: r2(mean(laErr.map((l, i) => l - toErr[i]))), sd: r2(sd(laErr.map((l, i) => l - toErr[i]))) },
    warnings: { detectors_disagree: flagRate(runsOn, 'detectors_disagree'), hip_vs_flight: flagRate(runsOn, 'hip_vs_flight'), landing_knee: flagRate(runsOn, 'landing_knee') },
  };
  baPoints[test] = hM.map((m, i) => ({ mean: r2((m + hT[i]) / 2), diff: r2(m - hT[i], 3) }));
  if (test === 'CMJ') {
    const d = g.map((x) => [x.r.metrics.cm_depth_cm!, x.truth.depth! * 100]);
    const tt = g.map((x) => [x.r.metrics.time_to_takeoff_ms!, x.truth.timeToTakeoff! * 1000]);
    const rm = g.map((x) => [x.r.metrics.rsi_mod_m_s!, x.truth.hFlight / x.truth.timeToTakeoff!]);
    v.depth_cm = baR(blandAltman(d.map((p) => p[0]), d.map((p) => p[1])));
    v.time_to_takeoff_ms = baR(blandAltman(tt.map((p) => p[0]), tt.map((p) => p[1])), 1);
    v.rsi_mod = baR(blandAltman(rm.map((p) => p[0]), rm.map((p) => p[1])), 3);
    v.rsi_mod_icc = r2(icc(rm).iccA1, 4);
  }
  if (test === 'SJ') {
    const k = g.filter((x) => x.r.metrics.hold_knee_angle_deg !== undefined).map((x) => [x.r.metrics.hold_knee_angle_deg!, x.truth.holdKnee!]);
    v.hold_knee_deg = baR(blandAltman(k.map((p) => p[0]), k.map((p) => p[1])), 2);
    v.false_countermovement_rate = flagRate(runsOn, 'countermovement');
    v.false_hold_angle_rate = flagRate(runsOn, 'hold_angle');
  }
  if (test === 'DJ') {
    const gc = g.filter((x) => x.r.metrics.gct_ms !== undefined);
    const gct = gc.map((x) => [x.r.metrics.gct_ms!, x.truth.gct! * 1000]);
    const rsi = gc.map((x) => [x.r.metrics.rsi_m_s!, x.truth.hFlight / x.truth.gct!]);
    const drop = gc.map((x) => [x.r.metrics.drop_height_cm!, x.truth.boxM! * 100]);
    v.gct_ms = baR(blandAltman(gct.map((p) => p[0]), gct.map((p) => p[1])), 1);
    v.rsi = baR(blandAltman(rsi.map((p) => p[0]), rsi.map((p) => p[1])), 3);
    v.rsi_icc = r2(icc(rsi).iccA1, 4);
    v.drop_height_cm = baR(blandAltman(drop.map((p) => p[0]), drop.map((p) => p[1])));
  }
  validity[test] = v;

  const gOff = ok(runsOff);
  const off = blandAltman(gOff.map((x) => x.r.metrics.jump_height_cm!), gOff.map((x) => x.truth.hFlight * 100));
  const offTo = gOff.map((x) => (x.r.events.takeoff_s - x.truth.takeoff) * 1000);
  const offLa = gOff.map((x) => (x.r.events.landing_s - x.truth.landing) * 1000);
  biasEffect[test] = {
    with_correction: { height_bias_cm: r2(blandAltman(hM, hT).bias, 3), height_bias_pct: r2(mean(hM.map((m, i) => (m - hT[i]) / hT[i] * 100)), 2), takeoff_ms: r2(mean(toErr)), landing_ms: r2(mean(laErr)) },
    without_correction: { height_bias_cm: r2(off.bias, 3), height_bias_pct: r2(mean(gOff.map((x) => (x.r.metrics.jump_height_cm! - x.truth.hFlight * 100) / (x.truth.hFlight * 100) * 100)), 2), takeoff_ms: r2(mean(offTo)), landing_ms: r2(mean(offLa)) },
  };
  console.log(`[S2/S3] ${test} done ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
results.validity = validity;
results.bias_correction = biasEffect;
results.ba_points = baPoints;

// ---------------------------------------------------------------- S4 幀率敏感度
const fpsList = [240, 120, 60, 30];
const fpsSens: Record<string, unknown[]> = {};
const nF = Math.max(40, Math.round(N / 2));
for (const test of TESTS) {
  fpsSens[test] = [];
  for (const fps of fpsList) {
    const runs: Run[] = [];
    for (let i = 0; i < nF; i++) runs.push(run(params(test, 2000 + i), fps, NOISE_PRESETS.official, 6000 + i, { mode: 'preview' }));
    const g = ok(runs);
    const ba = blandAltman(g.map((x) => x.r.metrics.jump_height_cm!), g.map((x) => x.truth.hFlight * 100));
    const row: Record<string, unknown> = { fps, n: g.length, analysable: r2(g.length / runs.length, 3), height_bias_cm: r2(ba.bias), height_sd_cm: r2(ba.sd), height_loa: [r2(ba.loaLow), r2(ba.loaHigh)], height_mae_cm: r2(ba.mae) };
    if (test === 'DJ') {
      const gc = g.filter((x) => x.r.metrics.gct_ms !== undefined);
      if (gc.length > 2) {
        const gb = blandAltman(gc.map((x) => x.r.metrics.gct_ms!), gc.map((x) => x.truth.gct! * 1000));
        const rb = blandAltman(gc.map((x) => x.r.metrics.rsi_m_s!), gc.map((x) => x.truth.hFlight / x.truth.gct!));
        Object.assign(row, { gct_bias_ms: r2(gb.bias, 1), gct_sd_ms: r2(gb.sd, 1), rsi_bias: r2(rb.bias, 3), rsi_sd: r2(rb.sd, 3), rsi_mae_pct: r2(mean(gc.map((x) => Math.abs(x.r.metrics.rsi_m_s! / (x.truth.hFlight / x.truth.gct!) - 1) * 100)), 1) });
      } else Object.assign(row, { gct_hidden: true });
    }
    fpsSens[test].push(row);
  }
}
results.fps_sensitivity = fpsSens;
console.log(`[S4] done ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- S5 雜訊敏感度
const noiseSens: Record<string, unknown[]> = {};
for (const test of TESTS) {
  noiseSens[test] = [];
  for (const nz of ['none', 'official', 'poor'] as const) {
    const runs: Run[] = [];
    for (let i = 0; i < nF; i++) runs.push(run(params(test, 3000 + i), 240, NOISE_PRESETS[nz], 7000 + i));
    const g = ok(runs);
    const ba = blandAltman(g.map((x) => x.r.metrics.jump_height_cm!), g.map((x) => x.truth.hFlight * 100));
    noiseSens[test].push({ noise: nz, keypoint_sd_cm: r2(Math.hypot(NOISE_PRESETS[nz].whiteM, NOISE_PRESETS[nz].corrM) * 100, 2), status: statusRate(runs), height_bias_cm: r2(ba.bias), height_loa: [r2(ba.loaLow), r2(ba.loaHigh)], height_mae_cm: r2(ba.mae) });
  }
}
results.noise_sensitivity = noiseSens;
console.log(`[S5] done ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- S6 信度
// (a) 儀器重複性：同一個真實動作，兩次獨立取樣與雜訊（等同兩台相同系統同時拍）
// (b) 跨日重測：加入生物變異（受試者間 SD、跨日 CV 4%、試跳間 CV 3%），每日 3 跳取平均
const nS = 30;
const reliability: Record<string, unknown> = {};
const metricOf = (test: TestType, r: TrialResult) => (test === 'DJ' ? r.metrics.rsi_m_s : r.metrics.jump_height_cm);
const truthOf = (test: TestType, x: Run) => (test === 'DJ' ? x.truth.hFlight / x.truth.gct! : x.truth.hFlight * 100);
for (const test of TESTS) {
  const rel: Record<string, unknown> = { metric: test === 'DJ' ? 'RSI (m/s)' : 'Jump height (cm)' };
  for (const [label, fps, nz, mode] of [['official_240', 240, NOISE_PRESETS.official, 'official'], ['live_60', 60, NOISE_PRESETS.live, 'preview'], ['live_30', 30, NOISE_PRESETS.live, 'preview']] as const) {
    const rows: number[][] = [];
    for (let s = 0; s < nS; s++) {
      const P = params(test, 4000 + s);
      const a = run(P, fps, nz, 8000 + s, { mode }), b = run(P, fps, nz, 9000 + s, { mode });
      const ma = a.r && metricOf(test, a.r), mb = b.r && metricOf(test, b.r);
      if (ma !== undefined && mb !== undefined && ma !== null && mb !== null) rows.push([ma, mb]);
    }
    if (rows.length < 5) { rel[`instrument_${label}`] = { n: rows.length, note: '可分析筆數不足' }; continue; }
    const ic = icc(rows);
    rel[`instrument_${label}`] = { n: rows.length, icc_a1: r2(ic.iccA1, 4), icc_ci: bootstrapCI(rows, (s) => icc(s).iccA1).map((x) => r2(x, 4)), sem: r2(ic.sem, 3), mdc95: r2(ic.mdc95, 3) };
  }
  // (b)
  const r = rng(77 + TESTS.indexOf(test));
  const sysRows: number[][] = [], truRows: number[][] = [];
  const intra: number[][] = [];
  for (let s = 0; s < nS; s++) {
    const P0 = params(test, 4500 + s);
    const dayMeans: number[] = [], dayTruth: number[] = [];
    for (let day = 0; day < 2; day++) {
      const dayFactor = 1 + 0.04 * r.n();
      const vals: number[] = [], tv: number[] = [];
      for (let k = 0; k < 3; k++) {
        const P = { ...P0, comRiseM: P0.comRiseM * dayFactor * (1 + 0.03 * r.n()), gctS: P0.gctS * (1 + 0.04 * r.n()), cmDepthM: P0.cmDepthM * (1 + 0.05 * r.n()) };
        const x = run(P, 240, NOISE_PRESETS.official, 10000 + s * 10 + day * 3 + k);
        const m = x.r && metricOf(test, x.r);
        if (m !== undefined && m !== null) { vals.push(m); tv.push(truthOf(test, x)); }
      }
      if (day === 0 && vals.length === 3) intra.push(vals);
      dayMeans.push(vals.length ? mean(vals) : NaN);
      dayTruth.push(tv.length ? mean(tv) : NaN);
    }
    if (dayMeans.every(Number.isFinite)) { sysRows.push(dayMeans); truRows.push(dayTruth); }
  }
  const icS = icc(sysRows), icT = icc(truRows), icI = icc(intra);
  rel.test_retest = {
    n: sysRows.length,
    assumptions: '受試者間變異來自模擬母體；跨日 CV 4%、試跳間 CV 3%（假設值，需以實測取代）',
    system: { icc_a1: r2(icS.iccA1, 4), icc_ci: bootstrapCI(sysRows, (s) => icc(s).iccA1).map((x) => r2(x, 4)), sem: r2(icS.sem, 3), mdc95: r2(icS.mdc95, 3) },
    true_values: { icc_a1: r2(icT.iccA1, 4), sem: r2(icT.sem, 3), mdc95: r2(icT.mdc95, 3) },
    sem_added_by_system: r2(Math.sqrt(Math.max(0, icS.sem ** 2 - icT.sem ** 2)), 3),
    intra_session_3_trials: { n: intra.length, icc_c1: r2(icI.iccC1, 4), sem: r2(icI.sem, 3) },
  };
  reliability[test] = rel;
}
results.reliability = reliability;
console.log(`[S6] done ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- S7 有效性規則的判斷正確率
const rules: Record<string, unknown> = {};
const nR = 40;
{
  const rows = [];
  for (const dip of [0, 0.005, 0.01, 0.015, 0.025, 0.03, 0.04]) {
    const runs: Run[] = [];
    for (let i = 0; i < nR; i++) runs.push(run({ ...params('SJ', 11000 + i), sjDipM: dip }, 240, NOISE_PRESETS.official, 12000 + i));
    rows.push({ dip_cm: dip * 100, truly_invalid: dip > 0.02, flagged_rate: flagRate(runs, 'countermovement') });
  }
  rules.sj_countermovement = rows;
}
{
  const rows = [];
  for (const k of [70, 75, 78, 82, 90, 98, 102, 105, 110]) {
    const runs: Run[] = [];
    for (let i = 0; i < nR; i++) runs.push(run({ ...params('SJ', 13000 + i), holdKneeDeg: k }, 240, NOISE_PRESETS.official, 14000 + i));
    const g = ok(runs).filter((x) => x.r.metrics.hold_knee_angle_deg !== undefined);
    rows.push({ true_knee_deg: k, truly_out_of_range: k < 80 || k > 100, flagged_rate: flagRate(runs, 'hold_angle'), measured_mean: r2(mean(g.map((x) => x.r.metrics.hold_knee_angle_deg!)), 1), measured_sd: r2(sd(g.map((x) => x.r.metrics.hold_knee_angle_deg!)), 2) });
  }
  rules.sj_hold_angle = rows;
}
{
  const rows = [];
  for (const tuck of [0, 0.02, 0.05, 0.08, 0.12]) {
    const runs: Run[] = [];
    for (let i = 0; i < nR; i++) runs.push(run({ ...params('CMJ', 15000 + i), landTuckM: tuck }, 240, NOISE_PRESETS.official, 16000 + i));
    const g = ok(runs);
    rows.push({
      tuck_cm: tuck * 100,
      height_vs_com_bias_cm: r2(mean(g.map((x) => x.r.metrics.jump_height_cm! - x.truth.hCom * 100))),
      height_vs_com_bias_pct: r2(mean(g.map((x) => (x.r.metrics.jump_height_cm! / (x.truth.hCom * 100) - 1) * 100)), 1),
      landing_knee_warning_rate: flagRate(runs, 'landing_knee'),
      hip_vs_flight_warning_rate: flagRate(runs, 'hip_vs_flight'),
    });
  }
  rules.landing_tuck = rows;
}
{
  const rows = [];
  for (const e of [-0.05, -0.03, 0, 0.03, 0.05]) {
    const runs: Run[] = [];
    for (let i = 0; i < nR; i++) runs.push(run(params('CMJ', 17000 + i), 240, { ...NOISE_PRESETS.official, scaleErr: e }, 18000 + i));
    const g = ok(runs);
    rows.push({ scale_err_pct: e * 100, height_bias_cm: r2(mean(g.map((x) => x.r.metrics.jump_height_cm! - x.truth.hFlight * 100))), depth_bias_pct: r2(mean(g.map((x) => (x.r.metrics.cm_depth_cm! / (x.truth.depth! * 100) - 1) * 100)), 1) });
  }
  rules.scale_error = rows;
}
results.rules = rules;
console.log(`[S7] done ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- S8 真實影片（非標準流程）
const real: unknown[] = [];
for (const name of ['jump813', 'jump3011']) {
  const file = join(root, 'public/samples', `${name}.json`);
  if (!existsSync(file)) { real.push({ name, status: 'skipped', note: '本機沒有這份資料（不進 git）' }); continue; }
  const d = JSON.parse(readFileSync(file, 'utf8')) as { fps: number; W: number; H: number; frames: PoseFrame[] };
  const ppm = pxPerMFromHeight(d.frames, 1.75) ?? 300;
  const s = fromMediaPipe(d.frames, 'right', ppm, d.W, d.H);
  try {
    const r = analyze(s, { test: 'CMJ', mode: 'preview' });
    real.push({ name, fps: d.fps, status: r.status, height_cm: r2(r.metrics.jump_height_cm!, 1), flight_ms: r2(r.metrics.flight_time_ms!, 0), flags: r.flags.map((f) => f.message) });
  } catch (e) {
    real.push({ name, fps: d.fps, status: 'Fail', error: String(e) });
  }
}
results.real_clips = real;
results.runtime_s = r2((Date.now() - t0) / 1000, 1);

mkdirSync(join(root, 'public/validation'), { recursive: true });
writeFileSync(join(root, 'public/validation/results.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, (k, v) => (k === 'ba_points' ? undefined : v), 1));
