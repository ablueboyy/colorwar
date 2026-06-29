# ColorWar 🎨⚔️

兩人線上即時對戰的「領地塗色 × 塔防」遊戲。用隨時間累積的金錢購買各式砲台，把地板染成自己的顏色、搶奪對方領地，時間到佔領面積大者獲勝。

完整設計請見 [SPEC.md](./SPEC.md)。

---

## 本機開發

```bash
npm install
npm run dev
```

開瀏覽器到 **http://localhost:5173**

`npm run dev` 會同時啟動：

- 後端權威伺服器（WebSocket，`localhost:3001`，自動重載）
- 前端 Vite dev server（`localhost:5173`，熱更新）

## 怎麼玩

1. 一邊點 **Create Room** → 得到 4 碼房號
2. 另一邊開同一網址 → 輸入房號 → **Join Room**
3. 自己一個人測試：開兩個瀏覽器分頁（或一個正常 + 一個無痕視窗）

操作：

- **左鍵**：在自己顏色的地板上放砲台
- **右鍵**：賣掉砲台（返還部分金錢）
- 下方面板切換砲台種類，滑鼠移到按鈕上會顯示該砲台的數值與說明

## 砲台一覽

| 砲台 | 定位 | 特性 |
|------|------|------|
| 基礎砲 | 通用前線 | 便宜耐用，單發染一格 |
| 連射砲 | 快速推進 | 射速極快、傷害低，快速鋪面 |
| 散射砲 | 近距擴張 | 扇形三連發，近距離強、血薄 |
| 狙擊砲 | 遠程拆塔 | 超長射程、優先狙擊敵方砲台 |
| 榴彈砲 | 遠程砲擊 | 遠射程＋範圍爆炸，射速慢 |
| 範圍砲 | 範圍翻盤 | 3×3 大範圍染色，又貴又慢 |
| 加速器 | 輔助加速 | 不發射，提升周圍友軍射速 |
| 維修車 | 維修補血 | 不發射，持續修復周圍友軍血量 |

## 調平衡

幾乎所有手感數值都集中在 **`src/shared/config.ts`**：盤面大小、局長、收入、各砲台的成本/血量/射速/射程/傷害。改完存檔，server 會自動重載；**重整瀏覽器重開房間**即套用新數值。

- 玩法規則（瞄準、傷害結算、勝負判定）：`src/shared/gameLogic.ts`
- 畫面（顏色、砲台外觀）：`src/client/renderer.ts`

---

## 部署到 Render

本專案附 [`render.yaml`](./render.yaml) Blueprint，連結 GitHub 後可一鍵建立服務。

1. 把專案推上 GitHub（見下方）。
2. 登入 [Render](https://render.com) → **New** → **Blueprint**。
3. 選這個 GitHub repo，Render 會讀取 `render.yaml`：
   - Build：`npm install && npm run build`
   - Start：`npm start`（單一服務同時供前端與 WebSocket）
4. 等部署完成，會拿到一個 `https://colorwar-xxxx.onrender.com` 網址，把它分享給朋友即可連線對戰。

> **注意**：Render 免費方案閒置約 15 分鐘會休眠，下次連線需等約 30 秒喚醒。要玩之前先打開網址等它醒來即可。

### 想找朋友臨時連線（不部署）

本機跑 `npm run dev` 後，用穿透工具把後端 3001 埠開出去：

```bash
npx localtunnel --port 3001
```

把產生的網址給朋友即可（前端也需一併開放，視情況可改用 ngrok 或直接部署）。

---

## 專案結構

```
colorwar/
├─ index.html              # 前端進入點
├─ src/
│  ├─ shared/              # 前後端共用：型別、設定、遊戲推進邏輯
│  │  ├─ types.ts
│  │  ├─ config.ts         # ← 調平衡看這裡
│  │  └─ gameLogic.ts      # stepGame()：權威狀態推進
│  ├─ server/              # WebSocket 權威伺服器 + 房間管理
│  │  ├─ index.ts
│  │  └─ room.ts
│  └─ client/              # Canvas 渲染 + 輸入 + 連線
│     ├─ main.ts
│     ├─ renderer.ts
│     └─ wsClient.ts
├─ render.yaml             # Render 部署設定
└─ SPEC.md                 # 設計規格
```
