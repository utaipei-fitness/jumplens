import type { TestType } from '../../analysis/types';
import { fmt, TESTS } from '../../config/tests';
import { actions, isFull, type Trial } from '../store';

export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge ${s}`}>{s}</span>;
}

export function TrialList({ trials, test, selected, onSelect }: { trials: Trial[]; test: TestType; selected?: string; onSelect: (id: string) => void }) {
  const cfg = TESTS[test];
  const list = trials.filter((t) => t.test === test).slice().reverse();
  const official = trials.filter((t) => t.test === test && t.mode === 'official');
  const valid = official.filter((t) => t.accepted !== false && t.result.status !== 'Fail').length;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>試跳</h2>
        <span className="small muted">正式有效 {valid} / 3（最多 6）</span>
      </div>
      {list.length === 0 && <p className="muted small">尚無試跳。Live 預覽或上傳影片後會出現在這裡。</p>}
      {list.map((t) => {
        const r = t.result;
        const pv = isFull(r) ? (r.metrics as Record<string, number | undefined>)[cfg.primary.key] : undefined;
        return (
          <div key={t.id} className={`trial ${selected === t.id ? 'sel' : ''}`} onClick={() => onSelect(t.id)} style={{ cursor: 'pointer' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row">
                <StatusBadge s={r.status} />
                {t.mode === 'preview' && <span className="badge preview">Preview {r.fps.toFixed(0)} fps</span>}
                {t.manual && <span className="badge preview">人工修正</span>}
              </span>
              <span className="small muted">{new Date(t.createdAt).toLocaleTimeString()}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ fontSize: 18 }}>{fmt(pv, cfg.primary.digits)} <span className="small muted">{cfg.primary.unit}</span></b>
              <span className="small muted">{t.source}</span>
            </div>
            {r.flags.length > 0 && (
              <ul className="tight flags">
                {r.flags.map((f, i) => (
                  <li key={i} className={`flag-${f.level}`}>{f.message}{f.advice ? <span className="muted">　→ {f.advice}</span> : null}</li>
                ))}
              </ul>
            )}
            <div className="row" onClick={(e) => e.stopPropagation()}>
              {t.mode === 'official' && r.status !== 'Fail' && (
                <>
                  <button className="sm" disabled={t.accepted === true} onClick={() => actions.setAccepted(t.id, true)}>Accept</button>
                  <button className="sm" disabled={t.accepted === false} onClick={() => actions.setAccepted(t.id, false)}>Reject</button>
                </>
              )}
              {t.accepted === true && <span className="small" style={{ color: 'var(--ok)' }}>已接受</span>}
              {t.accepted === false && <span className="small muted">不採用</span>}
              <button className="sm" onClick={() => confirm('刪除這筆試跳？') && actions.remove(t.id)}>刪除</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
