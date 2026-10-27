// 內部信效度驗證報告：讀 public/validation/results.json（由 npm run validate 產生）
import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = any;
const TESTS = ['CMJ', 'SJ', 'DJ'] as const;
const tip = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 };
const loa = (b: R, u = '') => `${b.bias} [${b.loaLow}, ${b.loaHigh}]${u}`;

function BAPlot({ pts, ba }: { pts: { mean: number; diff: number }[]; ba: R }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 10, right: 56, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" />
        <XAxis type="number" dataKey="mean" name="平均" unit=" cm" stroke="var(--muted)" fontSize={11} domain={['dataMin - 2', 'dataMax + 2']} tickFormatter={(v) => v.toFixed(0)} />
        <YAxis type="number" dataKey="diff" name="差" unit=" cm" stroke="var(--muted)" fontSize={11} width={52} domain={[-3, 3]} />
        <Tooltip contentStyle={tip} formatter={(v) => Number(v).toFixed(2)} />
        <ReferenceLine y={ba.bias} stroke="var(--chart-1)" label={{ value: `偏差 ${ba.bias}`, position: 'right', fontSize: 11, fill: 'var(--chart-1)' }} />
        <ReferenceLine y={ba.loaHigh} stroke="var(--chart-2)" strokeDasharray="4 3" label={{ value: `+1.96SD ${ba.loaHigh}`, position: 'right', fontSize: 10, fill: 'var(--chart-2)' }} />
        <ReferenceLine y={ba.loaLow} stroke="var(--chart-2)" strokeDasharray="4 3" label={{ value: `−1.96SD ${ba.loaLow}`, position: 'right', fontSize: 10, fill: 'var(--chart-2)' }} />
        <Scatter data={pts} fill="var(--chart-1)" fillOpacity={0.45} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function Validation() {
  const [d, setD] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}validation/results.json`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch((e) => setErr(`讀不到驗證結果（${e}）。請先執行 npm run validate`));
  }, []);
  if (err) return <div className="note">{err}</div>;
  if (!d) return <p className="muted">載入中…</p>;
  const v = d.validity, rel = d.reliability;
  const fpsData = [240, 120, 60, 30].map((fps, i) => ({ fps: `${fps}`, CMJ: d.fps_sensitivity.CMJ[i].height_mae_cm, SJ: d.fps_sensitivity.SJ[i].height_mae_cm, DJ: d.fps_sensitivity.DJ[i].height_mae_cm }));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h1>內部信效度驗證（模擬研究）</h1>
      <div className="note">
        <b>這是什麼、不是什麼：</b>以物理模型產生<b>已知真值</b>的合成 CMJ / SJ / DJ（隨機身高、跳高、下蹲深度、GCT、蹠屈速度），依幀率取樣並加入姿態估計雜訊（白雜訊、低頻漂移、離群值、短暫遺失），再用與網頁<b>完全相同的分析程式</b>計算。
        它驗證的是「事件偵測與公式在已知真值下的準確度與重複性」，<b>不能取代</b> SPEC 12.1 的真人實測（Kinovea 人工標記、力板 / My Jump Lab、跨日重測）。
        真實姿態估計的誤差結構（例如腳尖被遮擋、鞋子、光線）可能比模擬差。
      </div>
      <div className="kpi">
        <div className="panel"><div className="small muted">公式檢查：滯空 0.5 s</div><div className="v">{d.formula.flight_0_5s_cm} cm</div><div className="small">{d.formula.pass ? '✓ 符合 SPEC P4（30.7 cm）' : '✗'}</div></div>
        {TESTS.map((t) => (
          <div key={t} className="panel"><div className="small muted">{t} 跳躍高度 ICC(A,1)（240 fps）</div><div className="v">{v[t].height_vs_flight_truth_icc.toFixed(3)}</div><div className="small muted">95% CI {v[t].height_icc_ci.join('–')}；MAE {v[t].height_vs_flight_truth.mae} cm</div></div>
        ))}
      </div>

      <section className="panel">
        <h2>1. 效標效度：240 fps 正式拍攝（每項 n = {v.CMJ.n}）</h2>
        <p className="small muted">參考值 = 模擬真值的滯空時間法高度（等同力板滯空法）。偏差 [95% 一致性界限]。關鍵點雜訊 σ ≈ 0.58 cm（約 2 px @ 3 mm/px）。</p>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th>指標</th><th>CMJ</th><th>SJ</th><th>DJ</th></tr></thead>
            <tbody>
              <tr><td>跳躍高度 (cm)</td>{TESTS.map((t) => <td key={t}>{loa(v[t].height_vs_flight_truth)}<br /><span className="small muted">r = {v[t].height_vs_flight_truth.r}</span></td>)}</tr>
              <tr><td>起跳時刻誤差 (ms)</td>{TESTS.map((t) => <td key={t}>{v[t].takeoff_err_ms.mean} ± {v[t].takeoff_err_ms.sd}</td>)}</tr>
              <tr><td>落地時刻誤差 (ms)</td>{TESTS.map((t) => <td key={t}>{v[t].landing_err_ms.mean} ± {v[t].landing_err_ms.sd}</td>)}</tr>
              <tr><td>滯空時間誤差 (ms)</td>{TESTS.map((t) => <td key={t}>{v[t].flight_err_ms.mean} ± {v[t].flight_err_ms.sd}</td>)}</tr>
              <tr><td>狀態 OK / Warning / Fail</td>{TESTS.map((t) => <td key={t}>{(v[t].status.OK * 100).toFixed(0)}% / {(v[t].status.Warning * 100).toFixed(0)}% / {(v[t].status.Fail * 100).toFixed(0)}%</td>)}</tr>
              <tr><td>Warning 來源</td>{TESTS.map((t) => <td key={t} className="small">偵測器不一致 {(v[t].warnings.detectors_disagree * 100).toFixed(0)}%<br />落地膝屈曲 {(v[t].warnings.landing_knee * 100).toFixed(0)}%</td>)}</tr>
            </tbody>
          </table>
        </div>
        <h3>次要指標</h3>
        <table className="t">
          <tbody>
            <tr><td>CMJ 下蹲深度 (cm)</td><td>{loa(v.CMJ.depth_cm)}</td></tr>
            <tr><td>CMJ 起跳時間 (ms)</td><td>{loa(v.CMJ.time_to_takeoff_ms)} <span className="small muted">— 動作開始依 SPEC 定義（低於基準 max(1 cm, 5σ) 再往回找），會比真正開始晚</span></td></tr>
            <tr><td>CMJ RSImod (m/s)</td><td>{loa(v.CMJ.rsi_mod)}，ICC {v.CMJ.rsi_mod_icc}</td></tr>
            <tr><td>SJ 保持膝角 (°)</td><td>{loa(v.SJ.hold_knee_deg)}；誤判反向動作 {(v.SJ.false_countermovement_rate * 100).toFixed(1)}%</td></tr>
            <tr><td>DJ GCT (ms)</td><td>{loa(v.DJ.gct_ms)}</td></tr>
            <tr><td>DJ RSI (m/s)</td><td>{loa(v.DJ.rsi)}，ICC {v.DJ.rsi_icc}</td></tr>
            <tr><td>DJ 落下高度 (cm)</td><td>{loa(v.DJ.drop_height_cm)}</td></tr>
          </tbody>
        </table>
        <h3>Bland–Altman：跳躍高度（系統 − 真值）</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {TESTS.map((t) => <div key={t}><b className="small">{t}</b><BAPlot pts={d.ba_points[t]} ba={v[t].height_vs_flight_truth} /></div>)}
        </div>
      </section>

      <section className="panel">
        <h2>2. SPEC 8.2 偏差修正的效果</h2>
        <table className="t">
          <thead><tr><th /><th>高度偏差（修正）</th><th>高度偏差（不修正）</th><th>起跳 / 落地時刻偏差（修正）</th><th>（不修正）</th></tr></thead>
          <tbody>{TESTS.map((t) => { const b = d.bias_correction[t]; return <tr key={t}><td>{t}</td><td>{b.with_correction.height_bias_cm} cm（{b.with_correction.height_bias_pct}%）</td><td>{b.without_correction.height_bias_cm} cm（{b.without_correction.height_bias_pct}%）</td><td>{b.with_correction.takeoff_ms} / {b.with_correction.landing_ms} ms</td><td>{b.without_correction.takeoff_ms} / {b.without_correction.landing_ms} ms</td></tr>; })}</tbody>
        </table>
        <p className="small muted">不修正時閾值穿越會讓滯空時間短約 18–20 ms、高度低估 7–8%（SPEC 估計約 5%）；修正後偏差 &lt; 1%。</p>
      </section>

      <section className="panel">
        <h2>3. 幀率敏感度（同一批動作降取樣）</h2>
        <div className="grid cols-2">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={fpsData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--chart-grid)" />
              <XAxis dataKey="fps" unit=" fps" stroke="var(--muted)" fontSize={12} />
              <YAxis unit=" cm" stroke="var(--muted)" fontSize={12} width={52} />
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="CMJ" stroke="var(--chart-1)" strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="SJ" stroke="var(--chart-3)" strokeWidth={2} isAnimationActive={false} />
              <Line dataKey="DJ" stroke="var(--chart-2)" strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="scroll-x">
            <table className="t small">
              <thead><tr><th>fps</th><th>CMJ 高度偏差 [LoA] cm</th><th>DJ GCT 偏差 ± SD ms</th><th>DJ RSI 平均絕對誤差</th></tr></thead>
              <tbody>{d.fps_sensitivity.CMJ.map((r: R, i: number) => { const j = d.fps_sensitivity.DJ[i]; return <tr key={r.fps}><td>{r.fps}</td><td>{r.height_bias_cm} [{r.height_loa.join(', ')}]</td><td>{j.gct_hidden ? '不顯示（< 60 fps）' : `${j.gct_bias_ms} ± ${j.gct_sd_ms}`}</td><td>{j.gct_hidden ? '—' : `${j.rsi_mae_pct}%`}</td></tr>; })}</tbody>
            </table>
          </div>
        </div>
        <p className="small muted">圖為高度平均絕對誤差。30 fps 時高度系統性高估約 1.4–1.8 cm、LoA 寬達 ±3.3 cm，支持 SPEC「Live 值不能當成果」。</p>
      </section>

      <section className="panel">
        <h2>4. 信度</h2>
        <h3>(a) 儀器重複性：同一個真實動作，兩次獨立取樣與雜訊（n = 30 名模擬受試者）</h3>
        <div className="scroll-x">
          <table className="t">
            <thead><tr><th /><th>指標</th><th>240 fps 正式</th><th>60 fps Live</th><th>30 fps Live</th></tr></thead>
            <tbody>{TESTS.map((t) => (
              <tr key={t}><td>{t}</td><td className="small">{rel[t].metric}</td>
                {['instrument_official_240', 'instrument_live_60', 'instrument_live_30'].map((k) => { const x = rel[t][k]; return <td key={k}>{x.icc_a1 !== undefined ? <>ICC {x.icc_a1}<br /><span className="small muted">[{x.icc_ci.join('–')}] SEM {x.sem}、MDC95 {x.mdc95}</span></> : <span className="small muted">GCT/RSI 不顯示</span>}</td>; })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <h3>(b) 跨日重測（加入生物變異，每日 3 跳取平均，2 天）</h3>
        <table className="t">
          <thead><tr><th /><th>系統 ICC(A,1) [95% CI]</th><th>系統 SEM / MDC95</th><th>真值 SEM / MDC95</th><th>系統額外增加的 SEM</th><th>單次內 3 跳 ICC(C,1)</th></tr></thead>
          <tbody>{TESTS.map((t) => { const x = rel[t].test_retest; return <tr key={t}><td>{t}</td><td>{x.system.icc_a1} [{x.system.icc_ci.join('–')}]</td><td>{x.system.sem} / {x.system.mdc95}</td><td>{x.true_values.sem} / {x.true_values.mdc95}</td><td>{x.sem_added_by_system}</td><td>{x.intra_session_3_trials.icc_c1}</td></tr>; })}</tbody>
        </table>
        <p className="small muted">{rel.CMJ.test_retest.assumptions}。重點不是 ICC 本身，而是「系統額外增加的 SEM」很小：真人重測的變異主要會來自受試者本身。</p>
      </section>

      <section className="panel">
        <h2>5. 有效性規則判斷</h2>
        <div className="grid cols-2">
          <div>
            <h3>SJ 反向動作（門檻 2 cm）</h3>
            <table className="t small"><thead><tr><th>真實下沉</th><th>判為無效</th></tr></thead>
              <tbody>{d.rules.sj_countermovement.map((r: R) => <tr key={r.dip_cm}><td>{r.dip_cm} cm{r.truly_invalid ? '（應判無效）' : ''}</td><td>{(r.flagged_rate * 100).toFixed(0)}%</td></tr>)}</tbody></table>
          </div>
          <div>
            <h3>SJ 保持膝角（80–100°）</h3>
            <table className="t small"><thead><tr><th>真實膝角</th><th>量測</th><th>判 Fail</th></tr></thead>
              <tbody>{d.rules.sj_hold_angle.map((r: R) => <tr key={r.true_knee_deg}><td>{r.true_knee_deg}°</td><td>{r.measured_mean} ± {r.measured_sd}</td><td>{(r.flagged_rate * 100).toFixed(0)}%</td></tr>)}</tbody></table>
          </div>
          <div>
            <h3>落地收腿：滯空法相對真實髖上升的偏差</h3>
            <table className="t small"><thead><tr><th>收腿</th><th>高估</th><th>落地膝屈曲警告</th><th>髖位移交叉檢查警告</th></tr></thead>
              <tbody>{d.rules.landing_tuck.map((r: R) => <tr key={r.tuck_cm}><td>{r.tuck_cm} cm</td><td>{r.height_vs_com_bias_cm} cm（{r.height_vs_com_bias_pct}%）</td><td>{(r.landing_knee_warning_rate * 100).toFixed(0)}%</td><td>{(r.hip_vs_flight_warning_rate * 100).toFixed(0)}%</td></tr>)}</tbody></table>
          </div>
          <div>
            <h3>比例尺誤差</h3>
            <table className="t small"><thead><tr><th>px/m 誤差</th><th>高度偏差</th><th>下蹲深度偏差</th></tr></thead>
              <tbody>{d.rules.scale_error.map((r: R) => <tr key={r.scale_err_pct}><td>{r.scale_err_pct}%</td><td>{r.height_bias_cm} cm</td><td>{r.depth_bias_pct}%</td></tr>)}</tbody></table>
            <p className="small muted">滯空法高度幾乎不受比例尺影響；距離類指標按比例偏移。</p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>6. 雜訊敏感度與真實影片</h2>
        <table className="t small">
          <thead><tr><th>雜訊</th>{TESTS.map((t) => <th key={t}>{t}：OK / Warn / Fail；高度 LoA</th>)}</tr></thead>
          <tbody>{[0, 1, 2].map((i) => <tr key={i}><td>{d.noise_sensitivity.CMJ[i].noise}（σ {d.noise_sensitivity.CMJ[i].keypoint_sd_cm} cm）</td>{TESTS.map((t) => { const r = d.noise_sensitivity[t][i]; return <td key={t}>{(r.status.OK * 100).toFixed(0)} / {(r.status.Warning * 100).toFixed(0)} / {(r.status.Fail * 100).toFixed(0)}%；[{r.height_loa.join(', ')}]</td>; })}</tr>)}</tbody>
        </table>
        <p className="small">既有的兩支 30 fps MediaPipe 影片（jump813、jump3011）沒有開頭靜止站立、相機也有移動，系統正確拒絕分析：{d.real_clips.map((r: R) => `${r.name} → ${r.status}`).join('；')}。</p>
      </section>
      <p className="small muted">產生時間 {new Date(d.generated).toLocaleString()}・每條件 n = {d.n_per_condition}・執行 {d.runtime_s} s・重跑：<code>npm run validate</code></p>
    </div>
  );
}
