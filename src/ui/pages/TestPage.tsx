// Test page（SPEC 7.1）：左欄 Protocol、中欄 Live / 影片分析、右欄 Trials；下方結果（SPEC 9）
import { useEffect, useState } from 'react';
import type { TestType } from '../../analysis/types';
import { fmt, TESTS } from '../../config/tests';
import { TrialsBar } from '../components/Charts';
import { LiveView } from '../components/LiveView';
import { TrialDetail } from '../components/TrialDetail';
import { TrialList } from '../components/TrialList';
import { VideoAnalyzer } from '../components/VideoAnalyzer';
import { isFull, useStore, validTrials } from '../store';

function RestTimer() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return (
    <div className="row">
      <button className="sm" onClick={() => setLeft(60)}>休息 60 s</button>
      <button className="sm" onClick={() => setLeft(180)}>測驗間 3 min</button>
      {left > 0 && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>}
    </div>
  );
}

export function TestPage({ test }: { test: TestType }) {
  const s = useStore();
  const cfg = TESTS[test];
  const [tab, setTab] = useState<'live' | 'upload'>('upload');
  const [sel, setSel] = useState<string | undefined>();
  if (!s.subject || !s.session) return <div className="panel">請先到 <a href="#/">受試者與 Session</a> 建立資料並完成架設檢查。</div>;
  const boxHeightM = test === 'DJ' ? s.session.boxHeightCm / 100 : undefined;
  const trial = s.trials.find((t) => t.id === sel) ?? s.trials.filter((t) => t.test === test).at(-1);
  const valid = validTrials(s.trials, test);
  const vals = valid.map((t) => ({ id: t.id, v: (isFull(t.result) ? (t.result.metrics as Record<string, number | undefined>)[cfg.primary.key] : undefined) ?? NaN })).filter((x) => Number.isFinite(x.v));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{cfg.fullName}</h1>
        <span className="small muted">{s.showName ? s.subject.name : s.subject.code} · 身高 {s.subject.heightCm} cm · {s.subject.side === 'right' ? '右' : '左'}側面向鏡頭{boxHeightM ? ` · 箱高 ${s.session.boxHeightCm} cm` : ''}</span>
      </div>
      <div className="grid cols-3">
        <aside className="panel">
          <h2>Protocol</h2>
          <ol className="tight">{cfg.cues.map((c) => <li key={c}>{c}</li>)}</ol>
          <h3>落地要求</h3><p className="small">{cfg.landing}</p>
          <h3>額外器材</h3><p className="small">{cfg.equipment}</p>
          <h3>規則</h3>
          <p className="small">每項至少 3 筆有效、最多 6 筆；順序 CMJ → SJ → DJ，測驗間休息至少 3 分鐘。開始前先做 2–3 次次最大努力練習跳（不分析）。</p>
          <RestTimer />
        </aside>
        <section className="panel">
          <div className="tabs">
            <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>Live 即時（Preview）</button>
            <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>影片分析（Official）</button>
          </div>
          {tab === 'live'
            ? <LiveView test={test} subject={s.subject} boxHeightM={boxHeightM} onTrial={(t) => setSel(t.id)} />
            : <VideoAnalyzer test={test} subject={s.subject} boxHeightM={boxHeightM} onDone={(t) => setSel(t.id)} />}
        </section>
        <aside className="panel"><TrialList trials={s.trials} test={test} selected={trial?.id} onSelect={setSel} /></aside>
      </div>
      <div className="grid cols-2">
        {trial ? <TrialDetail trial={trial} /> : <div className="panel muted">尚無試跳結果</div>}
        <div className="panel">
          <h2>所有有效正式試跳</h2>
          {vals.length > 0 && (
            <p className="small">最佳 <b>{fmt(Math.max(...vals.map((x) => x.v)), cfg.primary.digits)}</b> {cfg.primary.unit}　平均 {fmt(vals.reduce((a, b) => a + b.v, 0) / vals.length, cfg.primary.digits)} ± {fmt(vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b.v - vals.reduce((p, q) => p + q.v, 0) / vals.length) ** 2, 0) / (vals.length - 1)) : 0, cfg.primary.digits)}（n = {vals.length}）</p>
          )}
          <TrialsBar values={vals} unit={cfg.primary.unit} label={cfg.primary.label} />
          <div className="row" style={{ marginTop: 8 }}>
            <a className={`btn ${valid.length >= 3 ? 'primary' : ''}`} href="#/summary" aria-disabled={valid.length < 3}>View results{valid.length < 3 ? `（還需 ${3 - valid.length} 筆）` : ''}</a>
            {test !== 'DJ' && <a className="btn" href={`#/test/${test === 'CMJ' ? 'SJ' : 'DJ'}`}>下一項 →</a>}
          </div>
        </div>
      </div>
    </div>
  );
}
