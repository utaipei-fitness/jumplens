# JumpLens — 單機側拍跳躍分析（網頁版）

依《Single-Camera Jump Analysis System — Build Spec》實作的瀏覽器版本：
**Live 即時預覽** + **動作捕捉後即時分析**（上傳影片 → 瀏覽器內逐幀 MediaPipe → 立即出結果）+ **內部信效度模擬驗證**。

## 網址

- 網頁版：https://utaipei-fitness.github.io/jumplens/（手機、平板、電腦都能直接開，相機需要 HTTPS，GitHub Pages 已是 HTTPS）
- 信效度報告：https://utaipei-fitness.github.io/jumplens/validation/report.html
- 推到 `main` 會自動測試並重新部署（`.github/workflows/deploy.yml`）。
- 受試者與試跳資料只存在各裝置自己的瀏覽器，不會上傳。

## 本機開發

```bash
npm install
npm run dev          # http://localhost:5173（電腦）
npm run dev:phone    # 區網 HTTPS，手機開相機用（第一次要信任自簽憑證）
npm run check        # 型別檢查 + 單元測試
npm run validate     # 重跑信效度模擬，結果寫到 public/validation/results.json
```

## 流程

受試者與 Session（必填欄位、架設容許誤差檢查）→ CMJ → SJ → DJ 測驗頁（Live / 影片分析 / Sports2D TRC / 模擬試跳）→ 總覽（最佳次、平均 ± SD、EUR、CSV / JSON / 自動 vs 人工事件配對匯出、列印）→ 信效度驗證頁。

## 檔案

| 路徑 | 用途 |
|---|---|
| `src/config/thresholds.ts` | 所有門檻、截止頻率（SPEC 起始值） |
| `src/analysis/analyze.ts` | 管線：清理 → 濾波 → 基準 → 事件（最高點往兩側、亞幀內插、偏差修正）→ 指標 → 品質 |
| `src/analysis/signal.ts` | 內插、Hampel、四階零相位 Butterworth |
| `src/analysis/pose.ts` | MediaPipe / Sports2D TRC → 公尺座標 |
| `src/analysis/stats.ts` | Bland–Altman、ICC、SEM、MDC、bootstrap CI |
| `src/sim/simulate.ts` | 已知真值的合成跳躍模型 + 雜訊模型 |
| `validation/run.ts` | 信效度模擬研究 |
| `src/ui/` | 介面（Live、影片分析、結果、總覽、驗證頁） |

## 與 SPEC 的差異（刻意的取捨）

- **沒有 FastAPI 後端與 Sports2D**：姿態估計改在瀏覽器內用 MediaPipe（heavy/full/lite），資料存在瀏覽器 localStorage。Sports2D 的 TRC 可直接匯入。之後要接後端只需改 `src/ui/store.ts`。
- **幀率**：從 MP4/MOV 容器的 `mdhd` + `stts` 讀實際幀率（取代 ffprobe）；讀不到才用播放估計，並可手動輸入。
- **第二事件偵測器**：SPEC 是足部 ROI 幀差；這裡用「足部垂直速度穿越峰值 50%」代替。
- **遺失關鍵點 > 5%** 以「短缺口內插補不回來的幀」計算。
- **落地 / 觸地膝屈曲** 取觸地前 20 ms 未濾波膝角，避免零相位濾波把觸地後的屈膝提前帶入。

## 尚未驗證（需要真機 / 真人）

- iPhone 慢動作檔經瀏覽器選取後的幀率與 edit list（慢動作重映射）行為。
- 手機 HTTPS 開相機、實際 fps、水平感測（iOS 授權）。
- SPEC 12.1 的真人驗證：Kinovea 人工標記、力板或 My Jump Lab、跨日重測。
