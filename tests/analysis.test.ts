import { describe, expect, it } from 'vitest';
import { analyze, jumpHeightFromFlight } from '../src/analysis/analyze';
import { parseTrc } from '../src/analysis/pose';
import { butterFiltfilt } from '../src/analysis/signal';
import { blandAltman, icc } from '../src/analysis/stats';
import { defaultParams, NOISE_PRESETS, rng, simulate } from '../src/sim/simulate';

const sim = (test: 'CMJ' | 'SJ' | 'DJ', seed: number, over: object = {}, fps = 240, noise = NOISE_PRESETS.none) => {
  const P = { ...defaultParams(test, rng(seed)), ...over };
  return { P, ...simulate(P, fps, noise, seed + 1) };
};

describe('公式（SPEC 8.3）', () => {
  it('滯空 0.5 s → 30.7 cm', () => {
    expect(jumpHeightFromFlight(0.5) * 100).toBeCloseTo(30.66, 2);
  });
});

describe('濾波', () => {
  it('保留直流、壓低高頻', () => {
    const fs = 240;
    const y = Array.from({ length: 480 }, (_, i) => 1 + 0.1 * Math.sin((2 * Math.PI * 60 * i) / fs));
    const f = butterFiltfilt(y, 12, fs);
    const mid = f.slice(100, 380);
    expect(Math.max(...mid)).toBeLessThan(1.001);
    expect(Math.min(...mid)).toBeGreaterThan(0.999);
  });
});

describe('事件偵測（無雜訊合成軌跡）', () => {
  for (const test of ['CMJ', 'SJ', 'DJ'] as const) {
    it(`${test}：高度誤差 < 0.6 cm、事件誤差 < 8 ms`, () => {
      for (let s = 0; s < 5; s++) {
        const { truth, series, P } = sim(test, 100 + s * 7);
        const r = analyze(series, { test, mode: 'official', boxHeightM: P.boxM });
        expect(Math.abs(r.metrics.jump_height_cm! - truth.hFlight * 100)).toBeLessThan(0.6);
        expect(Math.abs(r.events.takeoff_s - truth.takeoff)).toBeLessThan(0.008);
        expect(Math.abs(r.events.landing_s - truth.landing)).toBeLessThan(0.008);
        if (test === 'DJ') expect(Math.abs(r.metrics.gct_ms! - truth.gct! * 1000)).toBeLessThan(10);
      }
    });
  }

  it('偏差修正（SPEC 8.2 第 4 步）讓高度偏差變小', () => {
    let on = 0, off = 0;
    for (let s = 0; s < 8; s++) {
      const { truth, series } = sim('CMJ', 200 + s);
      on += analyze(series, { test: 'CMJ', mode: 'official' }).metrics.jump_height_cm! - truth.hFlight * 100;
      off += analyze(series, { test: 'CMJ', mode: 'official', biasCorrection: false }).metrics.jump_height_cm! - truth.hFlight * 100;
    }
    expect(Math.abs(on / 8)).toBeLessThan(0.5);
    expect(off / 8).toBeLessThan(-1); // 不修正會低估
  });
});

describe('有效性規則（SPEC 7.2）', () => {
  it('SJ 起跳前下沉 3 cm → Fail（反向動作）', () => {
    const { series } = sim('SJ', 300, { sjDipM: 0.03 });
    const r = analyze(series, { test: 'SJ', mode: 'official' });
    expect(r.flags.some((f) => f.code === 'countermovement')).toBe(true);
    expect(r.status).toBe('Fail');
  });
  it('SJ 無下沉 → 不判反向動作', () => {
    const { series } = sim('SJ', 301);
    const r = analyze(series, { test: 'SJ', mode: 'official' });
    expect(r.flags.some((f) => f.code === 'countermovement')).toBe(false);
  });
  it('SJ 保持膝角 72° → Fail', () => {
    const { series } = sim('SJ', 302, { holdKneeDeg: 72 });
    const r = analyze(series, { test: 'SJ', mode: 'official' });
    expect(r.flags.some((f) => f.code === 'hold_angle')).toBe(true);
  });
  it('落地收腿 8 cm → 落地膝屈曲警告', () => {
    const { series } = sim('CMJ', 303, { landTuckM: 0.08 });
    const r = analyze(series, { test: 'CMJ', mode: 'official' });
    expect(r.flags.some((f) => f.code === 'landing_knee')).toBe(true);
  });
});

describe('品質關卡（SPEC 8.5）', () => {
  it('Official 60 fps → Fail', () => {
    const { series } = sim('CMJ', 400, {}, 60);
    expect(analyze(series, { test: 'CMJ', mode: 'official' }).status).toBe('Fail');
  });
  it('Preview 30 fps 的 DJ 不顯示 GCT / RSI', () => {
    const { series, P } = sim('DJ', 401, {}, 30);
    const r = analyze(series, { test: 'DJ', mode: 'preview', boxHeightM: P.boxM });
    expect(r.metrics.gct_ms).toBeUndefined();
    expect(r.metrics.rsi_m_s).toBeUndefined();
  });
});

describe('TRC 讀取', () => {
  it('Sports2D 公尺座標', () => {
    const { series } = sim('CMJ', 500);
    const names = ['RHip', 'RKnee', 'RAnkle', 'RHeel', 'RBigToe'];
    const keys = ['hip', 'knee', 'ankle', 'heel', 'toe'] as const;
    const head = [
      'PathFileType\t4\t(X/Y/Z)\ttest.trc',
      'DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames',
      `240\t240\t${series.t.length}\t5\tm\t240\t1\t${series.t.length}`,
      'Frame#\tTime\t' + names.map((n) => `${n}\t\t`).join(''),
      '\t\t' + names.map((_, i) => `X${i + 1}\tY${i + 1}\tZ${i + 1}`).join('\t'),
      '',
    ];
    const rows = series.t.map((t, i) => [i + 1, t, ...keys.flatMap((k) => [series[k][i]![0], series[k][i]![1], 0])].join('\t'));
    const { series: s2 } = parseTrc([...head, ...rows].join('\n'), 'right');
    expect(s2.t.length).toBe(series.t.length);
    expect(s2.toe[10]![1]).toBeCloseTo(series.toe[10]![1], 6);
    const a = analyze(series, { test: 'CMJ', mode: 'official' }), b = analyze(s2, { test: 'CMJ', mode: 'official' });
    expect(b.metrics.jump_height_cm).toBeCloseTo(a.metrics.jump_height_cm!, 6);
  });
});

describe('統計', () => {
  it('完全一致 → ICC = 1、Bland–Altman 偏差 0', () => {
    const x = [10, 20, 30, 40, 50];
    expect(icc(x.map((v) => [v, v])).iccA1).toBeCloseTo(1, 6);
    expect(blandAltman(x, x).bias).toBe(0);
  });
  it('ICC 已知值（Shrout & Fleiss 1979 範例資料）', () => {
    const d = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]];
    expect(icc(d).iccA1).toBeCloseTo(0.29, 2);
    expect(icc(d).iccC1).toBeCloseTo(0.71, 2);
  });
});

import { parseDate } from '../src/ui/pages/SessionPage';
describe('日期輸入', () => {
  it('接受常見寫法並整理成 YYYY-MM-DD', () => {
    expect(parseDate('2003-03-07')).toBe('2003-03-07');
    expect(parseDate('2003/3/7')).toBe('2003-03-07');
    expect(parseDate('20030307')).toBe('2003-03-07');
    expect(parseDate('2003.03.07')).toBe('2003-03-07');
  });
  it('拒絕不存在的日期', () => {
    expect(parseDate('2003-02-30')).toBe('');
    expect(parseDate('03-07')).toBe('');
  });
});
