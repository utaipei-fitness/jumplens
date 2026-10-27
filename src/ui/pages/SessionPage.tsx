// 受試者資料（SPEC 5）+ Session 與架設檢查（SPEC 6.1 / 6.2）
import { useState } from 'react';
import { actions, nextSubjectCode, useStore, type Session, type Subject } from '../store';

const today = () => new Date().toISOString().slice(0, 10);

/** 接受 2003-03-07、2003/3/7、2003.03.07、20030307，回傳 YYYY-MM-DD；不是有效日期回傳 '' */
export function parseDate(text: string): string {
  const t = text.trim();
  const m = t.match(/^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})$/) ?? t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 直接打字的數字欄（不用上下箭頭）；打到一半的內容保留在欄位裡，無效時存 NaN 讓檢查訊息出現 */
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  return (
    <label className="f">{label}
      <input type="text" inputMode="decimal" value={text} onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.]/g, '');
        setText(v);
        onChange(v === '' ? NaN : Number(v));
      }} />
    </label>
  );
}

/** 直接打字的日期欄，失焦時整理成 YYYY-MM-DD */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const bad = text.trim() !== '' && !parseDate(text);
  return (
    <label className="f">{label}
      <input type="text" inputMode="numeric" placeholder="2003-03-07" value={text}
        onChange={(e) => { setText(e.target.value); onChange(parseDate(e.target.value)); }}
        onBlur={() => { const d = parseDate(text); if (d) setText(d); }} />
      {bad && <span className="small flag-Warning">請用 YYYY-MM-DD，例如 2003-03-07</span>}
    </label>
  );
}

export function SessionPage() {
  const s = useStore();
  const [sub, setSub] = useState<Subject>(s.subject ?? { code: '', name: '', sex: 'Male', dob: '', heightCm: 170, massKg: 65, dominantLeg: 'Right', side: 'right', footwear: 'Barefoot', sport: '', notes: '', consent: false });
  const [ses, setSes] = useState<Session>(s.session ?? { date: today(), tester: '', phone: 'iPhone', boxHeightCm: 30, distanceM: 4.5, cameraHeightM: 1.0 });
  const [eq, setEq] = useState<boolean[]>(Array(6).fill(!!s.session));
  const errors: string[] = [];
  if (!sub.name.trim()) errors.push('姓名必填');
  if (!sub.dob || sub.dob > today()) errors.push('出生日期必填（YYYY-MM-DD）且不得為未來日期');
  if (!(sub.heightCm >= 100 && sub.heightCm <= 230)) errors.push('身高需介於 100–230 cm（現場量測）');
  if (!(sub.massKg >= 30 && sub.massKg <= 200)) errors.push('體重需介於 30–200 kg');
  if (!sub.consent) errors.push('需勾選同意書');
  const distOk = Math.abs(ses.distanceM - 4.5) <= 0.1, hOk = Math.abs(ses.cameraHeightM - 1.0) <= 0.05;
  const boxOk = ses.boxHeightCm >= 20 && ses.boxHeightCm <= 60;
  const dateOk = !!ses.date;
  const setupOk = distOk && hOk && boxOk && dateOk && eq.every(Boolean);
  const u = <K extends keyof Subject>(k: K, v: Subject[K]) => setSub({ ...sub, [k]: v });
  const us = <K extends keyof Session>(k: K, v: Session[K]) => setSes({ ...ses, [k]: v });
  const EQ = ['iPhone 支援 1080p 240 fps，電量充足、勿擾', '腳架附水平儀、手機夾具', '1 m 剛性參照尺（兩端貼紙）', '地面膠帶十字與站位標記', '腳跟、腳尖、踝部對比色貼紙（面向鏡頭側）', '均勻燈光、避免逆光；貼身衣物'];

  return (
    <div className="grid" style={{ gap: 16 }}>
      <h1>受試者與 Session</h1>
      <section className="panel">
        <h2>受試者資料 {s.subject && <span className="badge OK">{s.subject.code}</span>}</h2>
        <div className="form">
          <label className="f">姓名 *<input value={sub.name} onChange={(e) => u('name', e.target.value)} /></label>
          <label className="f">性別 *<select value={sub.sex} onChange={(e) => u('sex', e.target.value as Subject['sex'])}><option>Male</option><option>Female</option><option>Other</option></select></label>
          <DateField label="出生日期 *" value={sub.dob} onChange={(v) => u('dob', v)} />
          <NumField label="身高 cm *（現場量測，用於比例尺）" value={sub.heightCm} onChange={(v) => u('heightCm', v)} />
          <NumField label="體重 kg *" value={sub.massKg} onChange={(v) => u('massKg', v)} />
          <label className="f">慣用腳 *<select value={sub.dominantLeg} onChange={(e) => u('dominantLeg', e.target.value as Subject['dominantLeg'])}><option>Right</option><option>Left</option></select></label>
          <label className="f">面向鏡頭側 *<select value={sub.side} onChange={(e) => u('side', e.target.value as Subject['side'])}><option value="right">Right</option><option value="left">Left</option></select></label>
          <label className="f">鞋著 *<select value={sub.footwear} onChange={(e) => u('footwear', e.target.value as Subject['footwear'])}><option>Barefoot</option><option>Shoes</option></select></label>
          <label className="f">運動 / 位置<input value={sub.sport} onChange={(e) => u('sport', e.target.value)} /></label>
          <label className="f">備註（傷病等）<input value={sub.notes} onChange={(e) => u('notes', e.target.value)} /></label>
        </div>
        <label className="row" style={{ marginTop: 12 }}><input type="checkbox" checked={sub.consent} onChange={(e) => u('consent', e.target.checked)} />受試者已簽署知情同意書 *</label>
        {errors.length > 0 && <ul className="tight small flag-Warning">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      <section className="panel">
        <h2>Session 與架設（SPEC 6）</h2>
        <div className="form">
          <DateField label="日期" value={ses.date} onChange={(v) => us('date', v)} />
          <label className="f">測試員<input value={ses.tester} onChange={(e) => us('tester', e.target.value)} /></label>
          <label className="f">手機機型<input value={ses.phone} onChange={(e) => us('phone', e.target.value)} /></label>
          <NumField label="DJ 箱高 cm（實測）" value={ses.boxHeightCm} onChange={(v) => us('boxHeightCm', v)} />
          <NumField label="鏡頭到跳躍平面 m（4.5 ± 0.1）" value={ses.distanceM} onChange={(v) => us('distanceM', v)} />
          <NumField label="鏡頭中心高度 m（1.0 ± 0.05）" value={ses.cameraHeightM} onChange={(v) => us('cameraHeightM', v)} />
        </div>
        <ul className="tight small">
          {!distOk && <li className="flag-Fail">距離超出容許誤差</li>}
          {!hOk && <li className="flag-Fail">鏡頭高度超出容許誤差</li>}
          {!boxOk && <li className="flag-Fail">箱高需介於 20–60 cm</li>}
          {!dateOk && <li className="flag-Fail">Session 日期格式需為 YYYY-MM-DD</li>}
        </ul>
        <h3>器材與相機設定確認</h3>
        <div className="grid" style={{ gap: 4 }}>
          {EQ.map((t, i) => <label key={t} className="row small"><input type="checkbox" checked={eq[i]} onChange={(e) => setEq(eq.map((x, j) => (j === i ? e.target.checked : x)))} />{t}</label>)}
        </div>
        <p className="small muted">相機：1x 主鏡頭、橫向、1080p 240 fps 慢動作、長按鎖定 AE/AF、關閉閃光燈與夜間模式；參照尺與受試者矢狀面同一深度（± 5 cm）。參照尺的點選在「影片分析」裡完成。</p>
      </section>

      <div className="row">
        <button className="primary" disabled={errors.length > 0 || !setupOk} onClick={() => { actions.saveSubject({ ...sub, code: sub.code || nextSubjectCode() }); actions.saveSession(ses); location.hash = '#/test/CMJ'; }}>
          儲存並開始測驗（CMJ → SJ → DJ）
        </button>
        {(errors.length > 0 || !setupOk) && <span className="small muted">所有必填欄位與架設檢查通過才能開始</span>}
        {s.subject && <button onClick={() => confirm('清除本機所有受試者與試跳資料？') && actions.reset()}>新受試者（清除資料）</button>}
      </div>
    </div>
  );
}
