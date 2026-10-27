// 結果圖：圖表資料直接讀結果 JSON 的 series 與 events，不在前端重算指標（SPEC 9）
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrialResult } from '../../analysis/types';

const ev = (r: TrialResult) => {
  const e = r.events;
  const out: { t: number; label: string }[] = [];
  const add = (t: number | undefined, label: string) => t !== undefined && out.push({ t, label });
  add(e.onset_s, '開始');
  add(e.lowest_s, '最低點');
  add(e.step_off_s, '踏出');
  add(e.contact_s, '觸地');
  add(e.takeoff_s, '起跳');
  add(e.landing_s, '落地');
  return out;
};

/** 圖 A：髖（DJ 加足部）垂直位置對時間，標出事件與階段；可疊加膝角 */
export function TrialChart({ r, height = 260 }: { r: TrialResult; height?: number }) {
  const [knee, setKnee] = useState(false);
  const data = r.series.t_s.map((t, i) => ({ t: +t.toFixed(3), hip: +r.series.hip_y_cm[i].toFixed(1), foot: +r.series.foot_y_cm[i].toFixed(1), knee: +r.series.knee_angle_deg[i].toFixed(0) }));
  const e = r.events;
  return (
    <div>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span className="muted">髖{r.test === 'DJ' ? '與足部' : ''}垂直位置（cm，相對地面）</span>
        <label className="row"><input type="checkbox" checked={knee} onChange={(x) => setKnee(x.target.checked)} />疊加膝屈曲角</label>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 16, right: knee ? 8 : 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => v.toFixed(1)} stroke="var(--muted)" fontSize={12} unit=" s" />
          <YAxis yAxisId="y" stroke="var(--muted)" fontSize={12} width={44} />
          {knee && <YAxis yAxisId="k" orientation="right" stroke="var(--chart-3)" fontSize={12} width={36} />}
          <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} labelFormatter={(v) => `${Number(v).toFixed(3)} s`} />
          {e.onset_s !== undefined && e.lowest_s !== undefined && <ReferenceArea yAxisId="y" x1={e.onset_s} x2={e.lowest_s} fill="var(--chart-2)" fillOpacity={0.08} label={{ value: '下降', fontSize: 11, fill: 'var(--muted)' }} />}
          {e.lowest_s !== undefined && <ReferenceArea yAxisId="y" x1={e.lowest_s} x2={e.takeoff_s} fill="var(--chart-3)" fillOpacity={0.08} label={{ value: '上升', fontSize: 11, fill: 'var(--muted)' }} />}
          {e.hold_start_s !== undefined && <ReferenceArea yAxisId="y" x1={e.hold_start_s} x2={e.hold_end_s} fill="var(--chart-3)" fillOpacity={0.1} label={{ value: '保持', fontSize: 11, fill: 'var(--muted)' }} />}
          {e.contact_s !== undefined && <ReferenceArea yAxisId="y" x1={e.contact_s} x2={e.takeoff_s} fill="var(--chart-2)" fillOpacity={0.1} label={{ value: 'GCT', fontSize: 11, fill: 'var(--muted)' }} />}
          <ReferenceArea yAxisId="y" x1={e.takeoff_s} x2={e.landing_s} fill="var(--chart-1)" fillOpacity={0.08} label={{ value: '滯空', fontSize: 11, fill: 'var(--muted)' }} />
          {ev(r).map((x) => <ReferenceLine key={x.label} yAxisId="y" x={x.t} stroke="var(--muted)" strokeDasharray="3 3" />)}
          <Line yAxisId="y" dataKey="hip" name="髖" stroke="var(--chart-1)" dot={false} strokeWidth={2} isAnimationActive={false} />
          {r.test === 'DJ' && <Line yAxisId="y" dataKey="foot" name="足部" stroke="var(--chart-2)" dot={false} strokeWidth={2} isAnimationActive={false} />}
          {knee && <Line yAxisId="k" dataKey="knee" name="膝屈曲 (°)" stroke="var(--chart-3)" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </LineChart>
      </ResponsiveContainer>
      <div className="small muted">事件：{ev(r).map((x) => `${x.label} ${x.t.toFixed(3)} s`).join('　')}</div>
    </div>
  );
}

/** 圖 B：所有有效試跳長條，標出平均線與最佳次 */
export function TrialsBar({ values, unit, label }: { values: { id: string; v: number }[]; unit: string; label: string }) {
  if (!values.length) return <p className="muted small">尚無有效試跳</p>;
  const best = values.reduce((a, b) => (b.v > a.v ? b : a));
  const m = values.reduce((s, x) => s + x.v, 0) / values.length;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={values.map((x, i) => ({ name: `#${i + 1}`, v: x.v, id: x.id }))} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="name" stroke="var(--muted)" fontSize={12} />
        <YAxis stroke="var(--muted)" fontSize={12} width={44} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} ${unit}`, label]} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8 }} />
        <ReferenceLine y={m} stroke="var(--chart-2)" strokeDasharray="4 3" label={{ value: `平均 ${m.toFixed(2)}`, fontSize: 11, fill: 'var(--chart-2)', position: 'insideTopRight' }} />
        <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {values.map((x) => <Cell key={x.id} fill={x.id === best.id ? 'var(--chart-1)' : 'var(--chart-grid)'} stroke="var(--chart-1)" />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
