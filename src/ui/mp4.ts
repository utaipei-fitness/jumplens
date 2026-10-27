// 讀 MP4 / MOV 容器的影像軌時間資訊（瀏覽器版的 ffprobe 替代，SPEC 6.5 / 8.1）：
// mdhd 的 timescale + stts 的每幀時間長度 → 實際幀率與每幀時間戳，不信任檔名或使用者輸入。

export interface VideoTiming { fps: number; frames: number; durationS: number; timescale: number; hasEditList: boolean; variable: boolean }

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

export async function readVideoTiming(file: Blob): Promise<VideoTiming | null> {
  const buf = new DataView(await file.arrayBuffer());
  const tracks: { handler?: string; timescale?: number; stts?: [number, number][]; elst?: boolean }[] = [];
  let cur: (typeof tracks)[number] | null = null;
  const str = (o: number) => String.fromCharCode(buf.getUint8(o), buf.getUint8(o + 1), buf.getUint8(o + 2), buf.getUint8(o + 3));

  function walk(start: number, end: number) {
    let o = start;
    while (o + 8 <= end) {
      let size = buf.getUint32(o);
      const type = str(o + 4);
      let hdr = 8;
      if (size === 1) { size = Number(buf.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) return;
      const body = o + hdr;
      if (type === 'trak') { cur = {}; tracks.push(cur); }
      if (CONTAINERS.has(type)) walk(body, o + size);
      else if (cur && type === 'hdlr') cur.handler = str(body + 8);
      else if (cur && type === 'mdhd') cur.timescale = buf.getUint8(body) === 1 ? buf.getUint32(body + 20) : buf.getUint32(body + 12);
      else if (cur && type === 'elst') cur.elst = buf.getUint32(body + 4) > 1;
      else if (cur && type === 'stts') {
        const n = buf.getUint32(body + 4);
        cur.stts = [];
        for (let i = 0; i < n; i++) cur.stts.push([buf.getUint32(body + 8 + i * 8), buf.getUint32(body + 12 + i * 8)]);
      }
      o += size;
    }
  }
  try { walk(0, buf.byteLength); } catch { return null; }
  const v = tracks.find((t) => t.handler === 'vide' && t.timescale && t.stts?.length);
  if (!v) return null;
  let frames = 0, ticks = 0;
  for (const [c, d] of v.stts!) { frames += c; ticks += c * d; }
  // 主要幀長（出現最多的那一段）決定 fps；多段不同長度表示可變幀率或慢動作重新映射
  const main = v.stts!.reduce((a, b) => (b[0] > a[0] ? b : a));
  return { fps: v.timescale! / main[1], frames, durationS: ticks / v.timescale!, timescale: v.timescale!, hasEditList: !!v.elst, variable: v.stts!.length > 1 };
}
