// Session summary（SPEC 9）：三張卡片、EUR、匯出（CSV / JSON / 驗證配對資料）與列印版面
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TestType, TrialResult } from '../../analysis/types';
import { fmt, TESTS } from '../../config/tests';
import { StatusBadge } from '../components/TrialList';
import { actions, isFull, useStore, validTrials, type Trial } from '../store';

const prim = (t: Trial, test: TestType) => (isFull(t.result) ? (t.result.metrics as Record<string, number | undefined>)[TESTS[test].primary.key] : undefined);

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const csvCell = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : `"${String(v).replace(/"/g, '""')}"`);

export function Summary() {
  const s = useStore();
  if (!s.subject) return <div className="panel">尚未建立受試者。</div>;
  const best: Partial<Record<TestType, { t: Trial; v: number; mean: number; sd: number; n: number }>> = {};
  for (const test of ['CMJ', 'SJ', 'DJ'] as TestType[]) {
    const vt = validTrials(s.trials, test).map((t) => ({ t, v: prim(t, test)! })).filter((x) => Number.isFinite(x.v));
    if (!vt.length) continue;
    const b = vt.reduce((a, c) => (c.v > a.v ? c : a));
    const m = vt.reduce((a, c) => a + c.v, 0) / vt.length;
    best[test] = { ...b, mean: m, sd: vt.length > 1 ? Math.sqrt(vt.reduce((a, c) => a + (c.v - m) ** 2, 0) / (vt.length - 1)) : 0, n: vt.length };
  }
  const eur = best.CMJ && best.SJ ? best.CMJ.v / best.SJ.v : undefined;
  const who = s.showName ? s.subject.name : s.subject.code;

  const rows = s.trials.map((t) => {
    const r = t.result as TrialResult;
    const full = isFull(t.result);
    return {
      subject: s.subject!.code, ...(s.showName ? { name: s.subject!.name } : {}), trial_id: t.id, test: t.test, mode: t.mode, status: t.result.status, accepted: t.accepted, fps: t.result.fps, source: t.source,
      takeoff_auto_s: full ? r.events_auto.takeoff_s : undefined, landing_auto_s: full ? r.events_auto.landing_s : undefined, contact_auto_s: full ? r.events_auto.contact_s : undefined,
      takeoff_manual_s: t.manual?.takeoff_s, landing_manual_s: t.manual?.landing_s, contact_manual_s: t.manual?.contact_s,
      ...(full ? r.metrics : {}),
      flags: t.result.flags.map((f) => `${f.level}:${f.code}`).join('; '),
    };
  });
  const toCsv = (rs: Record<string, unknown>[]) => {
    const keys = [...new Set(rs.flatMap((r) => Object.keys(r)))];
    return [keys.join(','), ...rs.map((r) => keys.map((k) => csvCell(r[k])).join(','))].join('\n');
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Session summary · {who}</h1>
        <span className="small muted">{s.session?.date} · 測試員 {s.session?.tester || '—'} · {s.session?.phone}</span>
      </div>
      <div className="cards">
        {(['CMJ', 'SJ', 'DJ'] as TestType[]).map((test) => {
          const b = best[test], cfg = TESTS[test];
          return (
            <div key={test} className="panel">
              <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{test}</h2>{b && <StatusBadge s={b.t.result.status} />}</div>
              <div className="metric"><span className="small muted">最佳 {cfg.primary.label}</span><span className="v">{fmt(b?.v, cfg.primary.digits)}<small>{cfg.primary.unit}</small></span></div>
              <p className="small muted">{b ? `平均 ${fmt(b.mean, cfg.primary.digits)} ± ${fmt(b.sd, cfg.primary.digits)}（n = ${b.n}）${b.n < 3 ? '・有效試跳未滿 3 筆' : ''}` : '尚無有效正式試跳'}</p>
              {b && isFull(b.t.result) && <div className="aux">{cfg.aux.map((a) => <div key={a.key}><div className="small muted">{a.label}</div><div className="v">{fmt((b.t.result as TrialResult).metrics[a.key as keyof TrialResult['metrics']], a.digits)} <span className="small muted">{a.unit}</span></div></div>)}</div>}
            </div>
          );
        })}
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h2>EUR（CMJ / SJ 最佳高度）</h2>
          <div className="metric"><span className="v">{fmt(eur, 2)}</span></div>
          {best.CMJ && best.SJ && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={[{ n: 'CMJ', v: best.CMJ.v }, { n: 'SJ', v: best.SJ.v }]} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" unit=" cm" stroke="var(--muted)" fontSize={12} />
                <YAxis type="category" dataKey="n" stroke="var(--muted)" fontSize={12} width={40} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)} cm`} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
                <Bar dataKey="v" fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="small muted">不顯示好壞評級：本方法沒有適用的常模。</p>
        </div>
        <div className="panel noprint">
          <h2>Export</h2>
          <div className="grid" style={{ gap: 8 }}>
            <button onClick={() => download(`${s.subject!.code}_trials.csv`, toCsv(rows.filter((r) => r.mode === 'official')), 'text/csv')}>CSV：正式試跳與事件時間</button>
            <button onClick={() => download(`${s.subject!.code}_all_incl_preview.csv`, toCsv(rows), 'text/csv')}>CSV：含 Preview（另檔）</button>
            <button onClick={() => download(`${s.subject!.code}_session.json`, JSON.stringify({ subject: s.showName ? s.subject : { ...s.subject, name: undefined }, session: s.session, trials: s.trials.map((t) => ({ ...t, series: undefined })) }, null, 1), 'application/json')}>JSON</button>
            <button onClick={() => download(`${s.subject!.code}_auto_vs_manual.csv`, toCsv(rows.filter((r) => r.takeoff_manual_s !== undefined || r.landing_manual_s !== undefined)), 'text/csv')}>驗證配對資料（自動 vs 人工事件）</button>
            <button onClick={() => window.print()}>列印 / 存成 PDF</button>
            <label className="row small"><input type="checkbox" checked={s.showName} onChange={() => actions.toggleName()} />匯出與標題顯示姓名（預設只顯示代號）</label>
          </div>
        </div>
      </div>
      <p className="small muted">所有數值在完成 SPEC 12.1 的真人驗證前只能稱為「估計值」。</p>
    </div>
  );
}
