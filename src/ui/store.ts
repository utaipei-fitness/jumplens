// 本機儲存（瀏覽器 localStorage）：受試者、Session、設定、試跳。
// 沒有資料庫；之後要接後端只需改這個檔案（對應 SPEC 的 storage.py）。

import { useSyncExternalStore } from 'react';
import { analyzeSafe, type ManualEvents } from '../analysis/analyze';
import type { Flag, KeypointSeries, Mode, TestType, TrialResult } from '../analysis/types';

export interface Subject { code: string; name: string; sex: 'Male' | 'Female' | 'Other'; dob: string; heightCm: number; massKg: number; dominantLeg: 'Left' | 'Right'; side: 'right' | 'left'; footwear: 'Barefoot' | 'Shoes'; sport: string; notes: string; consent: boolean }
export interface Session { date: string; tester: string; phone: string; boxHeightCm: number; distanceM: number; cameraHeightM: number }
export type FailResult = { status: 'Fail'; flags: Flag[]; fps: number };
export interface Trial {
  id: string;
  test: TestType;
  mode: Mode;
  createdAt: string;
  source: string;
  accepted: boolean | null;
  result: TrialResult | FailResult;
  manual?: ManualEvents;
  series?: KeypointSeries; // 原始關鍵點（人工修正事件時重算用）
  options: { boxHeightM?: number; scaleDiff?: number };
}
export interface State { subject: Subject | null; session: Session | null; trials: Trial[]; showName: boolean }

const KEY = 'jumplens.v1';
const empty: State = { subject: null, session: null, trials: [], showName: false };
let state: State = load();
const subs = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 空間不足：丟掉最舊試跳的原始關鍵點再試一次
    try {
      const slim = { ...state, trials: state.trials.map((t, i) => (i < state.trials.length - 3 ? { ...t, series: undefined } : t)) };
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch { /* 仍失敗就只留在記憶體 */ }
  }
}
function set(next: Partial<State>) {
  state = { ...state, ...next };
  save();
  subs.forEach((f) => f());
}

export function useStore(): State {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);
}
export const getState = () => state;

export function nextSubjectCode() {
  let n = 1;
  try { n = Number(localStorage.getItem('jumplens.subjectSeq') ?? '0') + 1; localStorage.setItem('jumplens.subjectSeq', String(n)); } catch { /* ignore */ }
  return `S-${String(n).padStart(4, '0')}`;
}

export const actions = {
  saveSubject: (subject: Subject) => set({ subject }),
  saveSession: (session: Session) => set({ session }),
  toggleName: () => set({ showName: !state.showName }),
  reset: () => set({ ...empty }),
  addTrial(test: TestType, mode: Mode, series: KeypointSeries, source: string, options: Trial['options']) {
    const result = analyzeSafe(series, { test, mode, ...options });
    const officialCount = state.trials.filter((t) => t.test === test && t.mode === 'official').length;
    if (mode === 'official' && officialCount >= 6) throw new Error('每項測驗最多 6 筆正式試跳');
    const trial: Trial = {
      id: `T-${Date.now().toString(36)}`,
      test, mode, source, options,
      createdAt: new Date().toISOString(),
      accepted: result.status === 'Fail' ? false : null,
      result,
      series: compact(series),
    };
    set({ trials: [...state.trials, trial] });
    return trial;
  },
  setAccepted: (id: string, accepted: boolean) => set({ trials: state.trials.map((t) => (t.id === id ? { ...t, accepted } : t)) }),
  remove: (id: string) => set({ trials: state.trials.filter((t) => t.id !== id) }),
  /** 人工修正事件：保留自動值，重新計算指標 */
  adjust(id: string, manual: ManualEvents | undefined) {
    set({
      trials: state.trials.map((t) => {
        if (t.id !== id || !t.series) return t;
        const r = analyzeSafe(t.series, { test: t.test, mode: t.mode, ...t.options }, manual);
        if ('events_auto' in r && 'events_auto' in t.result) r.events_auto = t.result.events_auto;
        return { ...t, manual, result: r };
      }),
    });
  },
};

/** 座標取到 0.1 mm，減少儲存空間 */
function compact(s: KeypointSeries): KeypointSeries {
  const r = (p: [number, number] | null) => (p ? ([Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4] as [number, number]) : null);
  return { t: s.t.map((x) => Math.round(x * 1e5) / 1e5), hip: s.hip.map(r), knee: s.knee.map(r), ankle: s.ankle.map(r), heel: s.heel.map(r), toe: s.toe.map(r), wrist: s.wrist?.map(r), inFrame: s.inFrame };
}

export const isFull = (r: Trial['result']): r is TrialResult => 'metrics' in r;
export const validTrials = (trials: Trial[], test: TestType) => trials.filter((t) => t.test === test && t.mode === 'official' && t.accepted !== false && isFull(t.result) && t.result.status !== 'Fail');
