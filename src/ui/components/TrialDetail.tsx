import type { ManualEvents } from '../../analysis/analyze';
import { fmt, TESTS } from '../../config/tests';
import { actions, isFull, type Trial } from '../store';
import { TrialChart } from './Charts';
import { StatusBadge } from './TrialList';

/** 單筆試跳結果：主要數值 + 輔助數值 + 圖 A + Adjust events（逐幀修正，保存自動與人工值） */
export function TrialDetail({ trial }: { trial: Trial }) {
  const r = trial.result;
  const cfg = TESTS[trial.test];
  if (!isFull(r)) {
    return (
      <div className="panel">
        <div className="row"><StatusBadge s="Fail" /><b>分析失敗</b></div>
        <ul className="tight">{r.flags.map((f, i) => <li key={i} className="flag-Fail">{f.message}{f.advice && <span className="muted">　→ {f.advice}</span>}</li>)}</ul>
        <p className="small muted">請依建議調整後 Retake。</p>
      </div>
    );
  }
  const m = r.metrics as Record<string, number | undefined>;
  const dt = 1 / r.fps;
  const cur: ManualEvents = { takeoff_s: r.events.takeoff_s, landing_s: r.events.landing_s, contact_s: r.events.contact_s };
  const nudge = (k: keyof ManualEvents, d: number) => actions.adjust(trial.id, { ...cur, [k]: (cur[k] ?? 0) + d * dt });
  const evRow = (k: keyof ManualEvents, label: string) => cur[k] !== undefined && (
    <tr>
      <td>{label}</td>
      <td>{(r.events_auto[k] as number | undefined)?.toFixed(4) ?? '—'}</td>
      <td>{trial.manual?.[k] !== undefined ? trial.manual[k]!.toFixed(4) : '—'}</td>
      <td className="row">
        <button className="sm" onClick={() => nudge(k, -1)}>−1 幀</button>
        <button className="sm" onClick={() => nudge(k, 1)}>+1 幀</button>
      </td>
    </tr>
  );
  return (
    <div className="panel grid" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <StatusBadge s={r.status} />
          <span className={`badge ${trial.mode === 'preview' ? 'preview' : 'OK'}`}>{trial.mode === 'preview' ? `Preview · ${r.fps.toFixed(0)} fps` : `Official · ${r.fps.toFixed(0)} fps`}</span>
        </div>
        <span className="small muted">{trial.id}</span>
      </div>
      {trial.mode === 'preview' && <div className="note">Preview 值只用於現場判斷（30 fps 時滯空差一幀約差 4 cm），不進入結果頁的最佳次、EUR 與正式匯出。</div>}
      <div className="metric">
        <span className="muted small">{cfg.primary.label}</span>
        <span className="v">{fmt(m[cfg.primary.key], cfg.primary.digits)}<small>{cfg.primary.unit}</small></span>
      </div>
      <div className="aux">
        {cfg.aux.map((a) => (
          <div key={a.key}><div className="small muted">{a.label}</div><div className="v">{fmt(m[a.key], a.digits)} <span className="small muted">{a.unit}</span></div></div>
        ))}
        <div><div className="small muted">滯空時間</div><div className="v">{fmt(m.flight_time_ms, 0)} <span className="small muted">ms</span></div></div>
      </div>
      {r.flags.length > 0 && (
        <details open={r.status !== 'OK'}>
          <summary className="small">品質訊息（{r.flags.length}）</summary>
          <ul className="tight small">{r.flags.map((f, i) => <li key={i} className={`flag-${f.level}`}>{f.message}{f.advice && <span className="muted">　→ {f.advice}</span>}</li>)}</ul>
        </details>
      )}
      <TrialChart r={r} />
      <details>
        <summary className="small">Adjust events（逐幀修正起跳 / 落地）</summary>
        {trial.series ? (
          <>
            <table className="t small">
              <thead><tr><th>事件</th><th>自動 (s)</th><th>人工 (s)</th><th /></tr></thead>
              <tbody>{evRow('contact_s', '第一次觸地')}{evRow('takeoff_s', '起跳')}{evRow('landing_s', '落地')}</tbody>
            </table>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="sm" disabled={!trial.manual} onClick={() => actions.adjust(trial.id, undefined)}>回到自動值</button>
              <span className="small muted">修正後指標立即重算；自動值與人工值都保存，可匯出做 Bland–Altman。</span>
            </div>
          </>
        ) : <p className="small muted">這筆試跳沒有保存原始關鍵點，無法重算。</p>}
        <p className="small muted">髖位移法交叉檢查：{fmt(m.hip_height_cm, 1)} cm（不作為報告值）　落地膝屈曲 {fmt(m.landing_knee_flex_deg, 0)}°　閾值 {(r.baseline.threshold * 100).toFixed(1)} cm（σ {(r.baseline.sigma * 1000).toFixed(1)} mm）</p>
      </details>
    </div>
  );
}
