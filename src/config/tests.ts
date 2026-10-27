// 三項測驗的說明文字與結果頁設定（SPEC 7.2 / 9）
import type { TestType } from '../analysis/types';

export interface TestConfig {
  name: string;
  fullName: string;
  cues: string[];
  landing: string;
  equipment: string;
  primary: { key: string; label: string; unit: string; digits: number };
  aux: { key: string; label: string; unit: string; digits: number }[];
}

export const TESTS: Record<TestType, TestConfig> = {
  CMJ: {
    name: 'CMJ',
    fullName: 'Countermovement Jump 反向動作跳',
    cues: ['雙手扠腰', '站穩 2 秒', '自選下蹲深度後盡力向上跳'],
    landing: '原地、雙腿伸直落地，落地後靜止 2 秒',
    equipment: '無',
    primary: { key: 'jump_height_cm', label: '跳躍高度', unit: 'cm', digits: 1 },
    aux: [
      { key: 'rsi_mod_m_s', label: 'RSImod', unit: 'm/s', digits: 2 },
      { key: 'cm_depth_cm', label: '下蹲深度', unit: 'cm', digits: 1 },
      { key: 'time_to_takeoff_ms', label: '起跳時間', unit: 'ms', digits: 0 },
    ],
  },
  SJ: {
    name: 'SJ',
    fullName: 'Squat Jump 蹲踞跳',
    cues: ['雙手扠腰', '蹲到膝約 90° 並保持 2–3 秒', '聽到 Go 後直接往上跳，不可先下沉'],
    landing: '同 CMJ',
    equipment: '深度參考（標記錐或棒子），測試員以量角器確認 80–100°',
    primary: { key: 'jump_height_cm', label: '跳躍高度', unit: 'cm', digits: 1 },
    aux: [
      { key: 'hold_knee_angle_deg', label: '保持膝角', unit: '°', digits: 0 },
      { key: 'cm_dip_cm', label: '反向下沉', unit: 'cm', digits: 1 },
    ],
  },
  DJ: {
    name: 'DJ',
    fullName: 'Drop Jump 落下跳',
    cues: ['雙手扠腰', '從跳箱邊緣「踏出」（不是跳下）', '雙腳落地後盡快、盡高地跳起'],
    landing: '第二次落地也要伸直腿，落回原標記',
    equipment: '跳箱，預設 30 cm（20–60 cm，需實測）',
    primary: { key: 'rsi_m_s', label: 'RSI', unit: 'm/s', digits: 2 },
    aux: [
      { key: 'gct_ms', label: '觸地時間 GCT', unit: 'ms', digits: 0 },
      { key: 'jump_height_cm', label: '跳躍高度', unit: 'cm', digits: 1 },
      { key: 'knee_flex_contact_deg', label: '觸地膝屈曲', unit: '°', digits: 0 },
    ],
  },
};

export const fmt = (v: number | undefined, d: number) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
