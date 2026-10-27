// Live mode（SPEC 7.4）：瀏覽器相機 + MediaPipe，即時取景檢查、SJ 膝角監看、反向動作警示、自動切段與預覽值。
// 只產生 mode = preview 的試跳，不與正式結果混用。
import { useEffect, useRef, useState } from 'react';
import { kneeFlexion } from '../../analysis/analyze';
import { fromMediaPipe, type PoseFrame } from '../../analysis/pose';
import { median } from '../../analysis/signal';
import type { TestType } from '../../analysis/types';
import { THRESHOLDS as TH } from '../../config/thresholds';
import { detect, drawSkeleton, getLandmarker, type ModelSize } from '../landmarker';
import { actions, type Subject, type Trial } from '../store';

const L = TH.live;
type Check = { label: string; pass: boolean | null; value: string };

export function LiveView({ test, subject, boxHeightM, onTrial }: { test: TestType; subject: Subject; boxHeightM?: number; onTrial: (t: Trial) => void }) {
  const vRef = useRef<HTMLVideoElement>(null);
  const cRef = useRef<HTMLCanvasElement>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<ModelSize>('lite');
  const [info, setInfo] = useState({ reqFps: 0, realFps: 0, w: 0, h: 0 });
  const [checks, setChecks] = useState<Check[]>([]);
  const [tilt, setTilt] = useState<{ roll: number; pitch: number } | null>(null);
  const [knee, setKnee] = useState<{ deg: number; hold: boolean; alarm: string | null } | null>(null);
  const [phase, setPhase] = useState('等待受試者');
  const [rest, setRest] = useState(0);
  const st = useRef({ buf: [] as PoseFrame[], stillSince: 0, ready: false, airborne: false, landedAt: 0, holdSince: 0, holdKnee: [] as number[], holdHip: [] as number[], alarm: null as string | null, ppm: 0, brightness: 0, lastB: 0, groundPx: 0 });
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => () => stop.current(), []);
  useEffect(() => {
    if (rest <= 0) return;
    const id = setTimeout(() => setRest(rest - 1), 1000);
    return () => clearTimeout(id);
  }, [rest]);

  async function askTilt() {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (D.requestPermission && (await D.requestPermission()) !== 'granted') return;
    window.addEventListener('deviceorientation', (e) => {
      const land = Math.abs((screen.orientation?.angle ?? 0) % 180) === 90;
      const b = e.beta ?? 0, g = e.gamma ?? 0;
      setTilt(land ? { roll: Math.abs(b), pitch: Math.abs(90 - Math.abs(g)) } : { roll: Math.abs(g), pitch: Math.abs(90 - Math.abs(b)) });
    });
  }

  async function start() {
    setErr(null);
    if (!window.isSecureContext) { setErr('瀏覽器只在 HTTPS（或 localhost）開放相機。手機請用 npm run dev:phone 的 https 網址。'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', frameRate: { ideal: 60 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } } });
      const v = vRef.current!;
      v.srcObject = stream;
      await v.play();
      const s = stream.getVideoTracks()[0].getSettings();
      setInfo((i) => ({ ...i, reqFps: s.frameRate ?? 0, w: s.width ?? v.videoWidth, h: s.height ?? v.videoHeight }));
      const lm = await getLandmarker(model);
      setOn(true);
      let alive = true;
      const stamps: number[] = [];
      const canvas = cRef.current!;
      const small = document.createElement('canvas'); small.width = 32; small.height = 18;
      const loop = () => {
        if (!alive) return;
        const now = performance.now();
        const f = detect(lm, v, now, now / 1000);
        stamps.push(now); while (stamps.length > 30) stamps.shift();
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawSkeleton(ctx, f, 1, st.current.alarm ? '#ef4444' : '#22c55e');
        if (now - st.current.lastB > 500) {
          const sc = small.getContext('2d', { willReadFrequently: true })!;
          sc.drawImage(v, 0, 0, 32, 18);
          const d = sc.getImageData(0, 0, 32, 18).data;
          let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          st.current.brightness = s / (d.length / 4); st.current.lastB = now;
        }
        step(f, v.videoWidth, v.videoHeight);
        if (stamps.length > 5) setInfo((i) => ({ ...i, realFps: (1000 * (stamps.length - 1)) / (stamps[stamps.length - 1] - stamps[0]) }));
        if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
      };
      loop();
      stop.current = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); setOn(false); };
    } catch (e) {
      setErr(`無法開啟相機：${String(e)}`);
    }
  }

  function step(f: PoseFrame, W: number, H: number) {
    const s = st.current;
    s.buf.push(f);
    while (s.buf.length && f.t - s.buf[0].t > L.bufferS) s.buf.shift();
    const side = subject.side === 'right' ? { hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 } : { hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
    const cs: Check[] = [];
    if (!f.lm) {
      setChecks([{ label: '全身入鏡', pass: false, value: '找不到人' }]);
      return;
    }
    const p = f.lm;
    const top = p[0].y - 0.12 * (Math.max(p[29].y, p[30].y) - p[0].y);
    const bottom = Math.max(p[29].y, p[30].y, p[31].y, p[32].y);
    const xs = p.filter((q) => q.v > 0.5).map((q) => q.x);
    const inside = top > L.marginRatio * H && bottom < (1 - L.marginRatio) * H && Math.min(...xs) > L.marginRatio * W && Math.max(...xs) < (1 - L.marginRatio) * W;
    cs.push({ label: '全身入鏡（四邊留 5%）', pass: inside, value: inside ? 'OK' : '調整取景' });
    const ratio = (bottom - top) / H;
    cs.push({ label: '身高佔畫面', pass: ratio >= L.bodyRatioMin && ratio <= L.bodyRatioMax, value: `${(ratio * 100).toFixed(0)}%（50–60%）` });
    cs.push({ label: '手機水平', pass: tilt ? tilt.roll <= L.tiltMaxDeg && tilt.pitch <= L.tiltMaxDeg : null, value: tilt ? `橫滾 ${tilt.roll.toFixed(1)}°、俯仰 ${tilt.pitch.toFixed(1)}°` : '未授權感測器' });
    cs.push({ label: '亮度', pass: s.brightness >= L.brightnessMin && s.brightness <= L.brightnessMax, value: s.brightness.toFixed(0) });

    // 比例尺（身高法，即時）
    const eye = (p[2].y + p[5].y) / 2, heel = (p[29].y + p[30].y) / 2;
    const ppmNow = (heel - eye) / (TH.scale.eyeToHeelOfHeight * subject.heightCm / 100);
    // 站穩：髖與踝速度
    const prev = s.buf.length > 3 ? s.buf[s.buf.length - 4] : null;
    let speed = Infinity;
    if (prev?.lm && s.ppm) {
      const dt = f.t - prev.t;
      speed = Math.max(Math.hypot(p[side.hip].x - prev.lm[side.hip].x, p[side.hip].y - prev.lm[side.hip].y), Math.hypot(p[side.ankle].x - prev.lm[side.ankle].x, p[side.ankle].y - prev.lm[side.ankle].y)) / s.ppm / dt;
    }
    if (speed < L.stillSpeedMps) { if (!s.stillSince) s.stillSince = f.t; } else s.stillSince = 0;
    const still = s.stillSince > 0 && f.t - s.stillSince >= L.stillHoldS;
    if (still && !s.airborne) { s.ppm = s.ppm ? 0.9 * s.ppm + 0.1 * ppmNow : ppmNow; s.groundPx = Math.min(p[side.heel].y, p[side.toe].y) > 0 ? Math.max(p[side.heel].y, p[side.toe].y) : s.groundPx; }
    if (!s.ppm) s.ppm = ppmNow;
    cs.push({ label: '站穩', pass: still, value: still ? 'READY' : '請靜止 1 秒' });
    setChecks(cs);

    // SJ 膝角監看與反向動作警示
    const flex = kneeFlexion([p[side.hip].x, -p[side.hip].y], [p[side.knee].x, -p[side.knee].y], [p[side.ankle].x, -p[side.ankle].y]);
    if (test === 'SJ') {
      const inRange = flex >= TH.validity.sjHoldKneeMinDeg && flex <= TH.validity.sjHoldKneeMaxDeg;
      const hipM = -p[side.hip].y / s.ppm;
      if (inRange && !s.alarm) {
        if (!s.holdSince) { s.holdSince = f.t; s.holdKnee = []; s.holdHip = []; }
        s.holdKnee.push(flex); s.holdHip.push(hipM);
      } else if (!inRange && s.holdSince && f.t - s.holdSince < L.sjHoldStableS) s.holdSince = 0;
      const hold = s.holdSince > 0 && f.t - s.holdSince >= L.sjHoldStableS;
      if (hold && !s.alarm) {
        const kInc = flex - median(s.holdKnee), dip = median(s.holdHip) - hipM;
        if (kInc > TH.validity.sjCmKneeDeg || dip > TH.validity.sjCmHipDipM) s.alarm = `反向動作！膝角減少 ${kInc.toFixed(1)}°、髖下沉 ${(dip * 100).toFixed(1)} cm → 本次無效`;
      }
      setKnee({ deg: flex, hold, alarm: s.alarm });
    }

    // 自動切段：靜止 → 動作 → 滯空 → 靜止
    const footPx = Math.max(p[side.heel].y, p[side.toe].y);
    const liftM = s.groundPx ? (s.groundPx - footPx) / s.ppm : 0;
    const groundRef = test === 'DJ' ? 0.08 + (boxHeightM ?? 0.3) : 0.08;
    if (!s.airborne && liftM > groundRef && s.buf.length > 10) { s.airborne = true; setPhase('滯空中…'); }
    if (s.airborne && test === 'DJ' && liftM < -0.05) { /* DJ 箱上基準，落到地面 */ }
    if (s.airborne && still && !s.landedAt) s.landedAt = f.t;
    if (s.airborne && s.landedAt) finish(W, H);
    else if (!s.airborne) setPhase(still ? 'READY：可以開始' : '等待受試者站穩');
  }

  function finish(W: number, H: number) {
    const s = st.current;
    const frames = s.buf.slice();
    s.airborne = false; s.landedAt = 0; s.holdSince = 0;
    const alarm = s.alarm; s.alarm = null;
    const series = fromMediaPipe(frames, subject.side, s.ppm, W, H);
    const tr = actions.addTrial(test, 'preview', series, 'Live 相機', { boxHeightM });
    if (alarm && 'flags' in tr.result) tr.result.flags.push({ level: 'Fail', code: 'live_cm', message: alarm });
    onTrial(tr);
    setPhase('已擷取一次試跳，休息中');
    setRest(60);
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row">
        {!on ? <button className="primary" onClick={start}>開啟相機</button> : <button onClick={() => stop.current()}>關閉相機</button>}
        <label className="row small">模型
          <select value={model} onChange={(e) => setModel(e.target.value as ModelSize)} disabled={on}>
            <option value="lite">lite（手機建議）</option><option value="full">full</option>
          </select>
        </label>
        <button onClick={askTilt}>啟用水平感測</button>
      </div>
      {err && <div className="note">{err}</div>}
      <div className="stage" style={{ minHeight: on ? undefined : 120 }}>
        <video ref={vRef} playsInline muted />
        <canvas ref={cRef} className="overlay" />
        {on && (
          <div className="hud">
            <span>PREVIEW · 實測 {info.realFps.toFixed(0)} fps（相機回報 {info.reqFps.toFixed(0)}）· {info.w}×{info.h}</span>
            <span>{phase}{rest > 0 ? `　休息 ${rest} s` : ''}</span>
          </div>
        )}
      </div>
      {on && (
        <div className="grid cols-2">
          <div className="checks">
            {checks.map((c) => (
              <div key={c.label} className={`check ${c.pass === true ? 'pass' : c.pass === false ? 'fail' : ''}`}><span>{c.label}</span><b>{c.value}</b></div>
            ))}
          </div>
          {test === 'SJ' && knee && (
            <div>
              <div className={`gauge ${knee.alarm ? 'alarm' : knee.deg >= 80 && knee.deg <= 100 ? 'in' : 'out'}`}>{knee.deg.toFixed(0)}°</div>
              <p className="small" style={{ textAlign: 'center', margin: '6px 0' }}>
                {knee.alarm ?? (knee.hold ? 'HOLD OK — 可以喊 Go' : '蹲到膝屈曲 80–100° 並保持 1 秒')}
              </p>
              {knee.alarm && <button className="sm" onClick={() => { st.current.alarm = null; st.current.holdSince = 0; }}>清除警示</button>}
            </div>
          )}
        </div>
      )}
      <p className="small muted">Live 只做架設檢查、練習跳與 SJ 深度確認；數值標示 Preview，fps &lt; 60 時不顯示 GCT 與 RSI。正式試跳請切到相機 App 慢動作 240 fps 拍攝後到「影片分析」上傳。</p>
    </div>
  );
}
