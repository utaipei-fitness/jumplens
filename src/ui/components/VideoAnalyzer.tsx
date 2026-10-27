// 動作捕捉後即時分析：上傳影片 → 瀏覽器內逐幀 MediaPipe → 立即分析 → 帶骨架與事件標記的逐幀回放。
// 另可匯入 Sports2D TRC，或產生模擬試跳（示範用）。
import { useEffect, useRef, useState } from 'react';
import { fromMediaPipe, parseTrc, pxPerMFromHeight, type PoseFrame } from '../../analysis/pose';
import { median } from '../../analysis/signal';
import type { Mode, TestType } from '../../analysis/types';
import { THRESHOLDS as TH } from '../../config/thresholds';
import { defaultParams, NOISE_PRESETS, rng, simulate } from '../../sim/simulate';
import { detect, drawSkeleton, getLandmarker, type ModelSize } from '../landmarker';
import { readVideoTiming, type VideoTiming } from '../mp4';
import { actions, isFull, type Subject, type Trial } from '../store';

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    v.addEventListener('seeked', () => {
      if ('requestVideoFrameCallback' in v) { v.requestVideoFrameCallback(() => fin()); setTimeout(fin, 150); } else fin();
    }, { once: true });
    v.currentTime = t;
  });

/** 以 requestVideoFrameCallback 的 mediaTime 估計實際幀率（慢速播放避免螢幕更新率限制） */
async function detectFps(v: HTMLVideoElement): Promise<number | null> {
  if (!('requestVideoFrameCallback' in v)) return null;
  const times: number[] = [];
  v.muted = true;
  v.playbackRate = 0.125;
  await v.play().catch(() => undefined);
  await new Promise<void>((res) => {
    const stop = setTimeout(res, 4000);
    const cb = (_: number, meta: VideoFrameCallbackMetadata) => {
      times.push(meta.mediaTime);
      if (times.length > 16) { clearTimeout(stop); res(); } else v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  });
  v.pause();
  v.playbackRate = 1;
  const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 1e-4);
  return d.length >= 4 ? 1 / median(d) : null;
}

export function VideoAnalyzer({ test, subject, boxHeightM, onDone }: { test: TestType; subject: Subject; boxHeightM?: number; onDone: (t: Trial) => void }) {
  const [tab, setTab] = useState<'video' | 'trc' | 'sim'>('video');
  const [url, setUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fps, setFps] = useState<number | null>(null);
  const [timing, setTiming] = useState<VideoTiming | null>(null);
  const fileRef = useRef<File | null>(null);
  const [fpsOverride, setFpsOverride] = useState('');
  const [model, setModel] = useState<ModelSize>('full');
  const [mode, setMode] = useState<Mode>('official');
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [dur, setDur] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState<PoseFrame[] | null>(null);
  const [cur, setCur] = useState(0);
  const [ruler, setRuler] = useState<{ x: number; y: number }[]>([]);
  const [rulerMode, setRulerMode] = useState(false);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const vRef = useRef<HTMLVideoElement>(null);
  const cRef = useRef<HTMLCanvasElement>(null);
  const cancel = useRef(false);

  const effFps = Number(fpsOverride) > 0 ? Number(fpsOverride) : fps;

  async function onFile(f: File) {
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(f));
    setFileName(f.name);
    fileRef.current = f;
    setTiming(null);
    setFrames(null); setTrial(null); setRuler([]); setFps(null); setMsg(null);
  }

  async function onLoaded() {
    const v = vRef.current!;
    setDur(v.duration);
    setRange([0, v.duration]);
    setBusy('讀取影片時間資訊…');
    const tm = fileRef.current ? await readVideoTiming(fileRef.current) : null;
    setTiming(tm);
    const f = tm?.fps ?? (await detectFps(v));
    setFps(f);
    await seek(v, 0);
    setBusy(null);
    draw(null);
  }

  function draw(f: PoseFrame | null) {
    const v = vRef.current, c = cRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (f) drawSkeleton(ctx, f, 1);
    if (ruler.length) {
      ctx.strokeStyle = '#ef4444'; ctx.fillStyle = '#ef4444'; ctx.lineWidth = 3;
      ruler.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); });
      if (ruler.length === 2) { ctx.beginPath(); ctx.moveTo(ruler[0].x, ruler[0].y); ctx.lineTo(ruler[1].x, ruler[1].y); ctx.stroke(); }
    }
  }
  useEffect(() => { draw(frames?.[cur] ?? null); }, [ruler]); // eslint-disable-line react-hooks/exhaustive-deps

  const rulerPxPerM = ruler.length === 2 ? Math.hypot(ruler[1].x - ruler[0].x, ruler[1].y - ruler[0].y) / 1.0 : null;
  const rulerTilt = ruler.length === 2 ? Math.abs((Math.atan2(ruler[1].x - ruler[0].x, ruler[1].y - ruler[0].y) * 180) / Math.PI) % 180 : null;

  async function run() {
    const v = vRef.current!;
    if (!effFps) { setMsg('無法偵測幀率，請手動輸入'); return; }
    cancel.current = false;
    setBusy('載入姿態模型…'); setProgress(0); setTrial(null);
    const lm = await getLandmarker(model);
    const out: PoseFrame[] = [];
    const [a, b] = range;
    const n = Math.floor((b - a) * effFps);
    const ctx = cRef.current!.getContext('2d')!;
    for (let i = 0; i < n; i++) {
      if (cancel.current) break;
      const t = a + (i + 0.5) / effFps;
      await seek(v, t);
      const f = detect(lm, v, Math.round((i * 1000) / effFps) + 1, i / effFps);
      out.push(f);
      if (i % 4 === 0) {
        cRef.current!.width = v.videoWidth; cRef.current!.height = v.videoHeight;
        ctx.clearRect(0, 0, v.videoWidth, v.videoHeight);
        drawSkeleton(ctx, f);
        setProgress((i + 1) / n);
        setBusy(`姿態估計 ${i + 1} / ${n} 幀`);
      }
    }
    setBusy(null);
    if (cancel.current) return;
    setFrames(out);
    analyse(out);
  }

  function analyse(out: PoseFrame[]) {
    const v = vRef.current!;
    const hPpm = pxPerMFromHeight(out, subject.heightCm / 100);
    const ppm = rulerPxPerM ?? hPpm;
    if (!ppm) { setMsg('開頭 1 秒找不到完整人體，無法換算比例尺'); return; }
    const scaleDiff = rulerPxPerM && hPpm ? Math.abs(rulerPxPerM - hPpm) / rulerPxPerM : undefined;
    const series = fromMediaPipe(out, subject.side, ppm, v.videoWidth, v.videoHeight);
    const tr = actions.addTrial(test, mode, series, `影片 ${fileName}`, { boxHeightM, scaleDiff });
    setTrial(tr);
    onDone(tr);
    const r = tr.result;
    if (isFull(r)) {
      const k = Math.max(0, out.findIndex((f) => f.t >= r.events.takeoff_s));
      showFrame(k, out);
    }
    setMsg(`比例尺：${rulerPxPerM ? `尺法 ${rulerPxPerM.toFixed(1)} px/m、` : ''}身高法 ${hPpm?.toFixed(1) ?? '—'} px/m${scaleDiff !== undefined ? `（差 ${(scaleDiff * 100).toFixed(1)}%）` : ''}`);
  }

  async function showFrame(k: number, fr = frames) {
    if (!fr || !vRef.current || !effFps) return;
    setCur(k);
    await seek(vRef.current, range[0] + (k + 0.5) / effFps);
    draw(fr[k]);
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!rulerMode) return;
    const c = cRef.current!, rect = c.getBoundingClientRect();
    const p = { x: ((e.clientX - rect.left) / rect.width) * c.width, y: ((e.clientY - rect.top) / rect.height) * c.height };
    const next = ruler.length >= 2 ? [p] : [...ruler, p];
    setRuler(next);
    if (next.length === 2) setRulerMode(false);
  }

  async function onTrc(f: File) {
    try {
      const text = await f.text();
      const ppmIn = Number((document.getElementById('trc-ppm') as HTMLInputElement)?.value) || undefined;
      const { series, units, markers } = parseTrc(text, subject.side, ppmIn);
      const tr = actions.addTrial(test, mode, series, `TRC ${f.name}`, { boxHeightM });
      setTrial(tr); onDone(tr);
      setMsg(`已讀取 ${series.t.length} 幀（單位 ${units}，標記 ${markers.length} 個）`);
    } catch (e) { setMsg(String(e)); }
  }

  function onSim(fpsSim: number, noise: keyof typeof NOISE_PRESETS) {
    const seed = Math.floor(Math.random() * 1e9);
    const P = { ...defaultParams(test, rng(seed)), heightM: subject.heightCm / 100, ...(boxHeightM ? { boxM: boxHeightM } : {}) };
    const { series, truth } = simulate(P, fpsSim, NOISE_PRESETS[noise], seed + 1);
    const tr = actions.addTrial(test, fpsSim >= 120 ? 'official' : 'preview', series, `模擬 ${fpsSim} fps`, { boxHeightM });
    setTrial(tr); onDone(tr);
    const r = tr.result;
    setMsg(`模擬真值：滯空 ${(truth.flight * 1000).toFixed(1)} ms、高度 ${(truth.hFlight * 100).toFixed(2)} cm${truth.gct ? `、GCT ${(truth.gct * 1000).toFixed(1)} ms` : ''}；系統：${isFull(r) ? `${r.metrics.jump_height_cm!.toFixed(2)} cm${r.metrics.gct_ms ? `、GCT ${r.metrics.gct_ms.toFixed(1)} ms` : ''}` : r.flags[0]?.message}`);
  }

  const evFrames = trial && isFull(trial.result) && frames ? (() => {
    const r = trial.result;
    const idx = (t?: number) => (t === undefined ? -1 : frames.findIndex((f) => f.t >= t));
    return [['起跳', idx(r.events.takeoff_s)], ['落地', idx(r.events.landing_s)], ['最低點', idx(r.events.lowest_s)], ['觸地', idx(r.events.contact_s)]].filter((x) => (x[1] as number) >= 0) as [string, number][];
  })() : [];

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="tabs">
        <button className={tab === 'video' ? 'on' : ''} onClick={() => setTab('video')}>影片</button>
        <button className={tab === 'trc' ? 'on' : ''} onClick={() => setTab('trc')}>Sports2D TRC</button>
        <button className={tab === 'sim' ? 'on' : ''} onClick={() => setTab('sim')}>模擬試跳</button>
      </div>
      <div className="row small">
        <label className="row">模式
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="official">Official（≥ 120 fps 才能通過）</option>
            <option value="preview">Preview（低幀率，只供參考）</option>
          </select>
        </label>
      </div>

      {tab === 'video' && (
        <>
          <div className="row">
            <input type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <label className="row small">模型
              <select value={model} onChange={(e) => setModel(e.target.value as ModelSize)}>
                <option value="lite">lite（快）</option><option value="full">full</option><option value="heavy">heavy（準、慢）</option>
              </select>
            </label>
          </div>
          {url && (
            <>
              <div className="stage">
                <video ref={vRef} src={url} playsInline muted preload="auto" onLoadedMetadata={onLoaded} />
                <canvas ref={cRef} className={`overlay ${rulerMode ? 'click' : ''}`} onClick={onCanvasClick} />
                <div className="hud">
                  <span>{timing ? '容器' : '播放估計'} {fps ? `${fps.toFixed(2)} fps` : '—'}{timing ? ` · ${timing.frames} 幀 · ${timing.durationS.toFixed(2)} s${timing.variable ? ' · 可變幀長' : ''}${timing.hasEditList ? ' · 有 edit list（慢動作重映射？）' : ''}` : ''}{fpsOverride ? `（使用 ${fpsOverride}）` : ''}</span>
                  {frames && <span>幀 {cur + 1} / {frames.length}　t = {frames[cur]?.t.toFixed(3)} s</span>}
                  {fps !== null && fps < TH.fps.officialMin && <span style={{ background: '#b91c1c' }}>幀率 &lt; 120：可能被 iOS 轉檔，請改用「檔案」App 或 AirDrop 傳原始檔</span>}
                </div>
              </div>
              <div className="form">
                <label className="f">幀率（自動偵測不準時手動輸入）<input inputMode="decimal" placeholder={fps?.toFixed(1) ?? ''} value={fpsOverride} onChange={(e) => setFpsOverride(e.target.value)} /></label>
                <label className="f">分析起點 (s)<input type="number" step="0.1" min={0} max={dur} value={range[0].toFixed(2)} onChange={(e) => setRange([Number(e.target.value), range[1]])} /></label>
                <label className="f">分析終點 (s)<input type="number" step="0.1" min={0} max={dur} value={range[1].toFixed(2)} onChange={(e) => setRange([range[0], Number(e.target.value)])} /></label>
              </div>
              <div className="row">
                <button onClick={() => { setRulerMode(true); setRuler([]); }} disabled={!!busy}>點選 1 m 參照尺兩端</button>
                {rulerPxPerM && <span className="small">尺法 {rulerPxPerM.toFixed(1)} px/m　傾斜 {(rulerTilt! > 90 ? 180 - rulerTilt! : rulerTilt!).toFixed(1)}°{(rulerTilt! > 90 ? 180 - rulerTilt! : rulerTilt!) > 1 ? '（> 1°，手機沒調平）' : ''}</span>}
                {rulerMode && <span className="small muted">在畫面上點尺的 0 與 1.000 m 兩端</span>}
              </div>
              <div className="row">
                <button className="primary" onClick={run} disabled={!!busy || !effFps}>開始分析</button>
                {busy && <button onClick={() => (cancel.current = true)}>取消</button>}
                {busy && <span className="small muted">{busy}</span>}
              </div>
              {busy && <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>}
              {frames && (
                <div className="grid" style={{ gap: 6 }}>
                  <input type="range" min={0} max={frames.length - 1} value={cur} onChange={(e) => showFrame(Number(e.target.value))} />
                  <div className="row">
                    <button className="sm" onClick={() => showFrame(Math.max(0, cur - 1))}>◀ 上一幀</button>
                    <button className="sm" onClick={() => showFrame(Math.min(frames.length - 1, cur + 1))}>下一幀 ▶</button>
                    {evFrames.map(([l, k]) => <button key={l} className="sm" onClick={() => showFrame(k)}>{l}</button>)}
                  </div>
                </div>
              )}
            </>
          )}
          <p className="small muted">影片在本機瀏覽器內逐幀分析，不會上傳到任何伺服器。正式數據請用相機 App 慢動作 240 fps、1080p、1x 主鏡頭拍攝；受試者開頭需靜止站立 1 秒、落地後靜止 1 秒。</p>
        </>
      )}

      {tab === 'trc' && (
        <div className="grid" style={{ gap: 8 }}>
          <p className="small">匯入 Sports2D 輸出的 <code>.trc</code>（Body with feet）。使用面向鏡頭那側的 Hip / Knee / Ankle / Heel / BigToe。公尺單位可直接讀；像素單位需要 px/m。</p>
          <div className="row">
            <label className="row small">px/m（像素 TRC 才需要）<input id="trc-ppm" inputMode="decimal" style={{ width: 90 }} /></label>
            <input type="file" accept=".trc,text/plain" onChange={(e) => e.target.files?.[0] && onTrc(e.target.files[0])} />
          </div>
        </div>
      )}

      {tab === 'sim' && (
        <div className="grid" style={{ gap: 8 }}>
          <p className="small">產生一筆已知真值的合成試跳（與信效度驗證使用同一模型），可用來熟悉流程或檢查結果頁。</p>
          <div className="row">
            <button onClick={() => onSim(240, 'official')}>240 fps（正式拍攝雜訊）</button>
            <button onClick={() => onSim(60, 'live')}>60 fps（Live 雜訊）</button>
            <button onClick={() => onSim(30, 'live')}>30 fps（Live 雜訊）</button>
          </div>
        </div>
      )}
      {msg && <div className="info small">{msg}</div>}
    </div>
  );
}
