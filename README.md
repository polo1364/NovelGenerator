# AI 小說工坊（NovelGenerator）

DeepSeek 驅動的長篇小說生成工具，附 Edge 神經語音朗讀與小說閱讀站。

## 快速開始

```bash
npm install
copy .env.example .env   # 填入 DEEPSEEK_API_KEY
npm start                # http://localhost:3000/
```

- 工坊主站：`http://localhost:3000/`
- 小說閱讀站：`http://localhost:3000/reader/`

## 環境變數（.env）

| 變數 | 必填 | 說明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 金鑰（只保存在後端） |
| `PORT` | 否 | 伺服器埠，預設 3000 |
| `DEEPSEEK_URL` | 否 | 自訂 DeepSeek 端點 |
| `TTS_PROXY_URL` | 否 | TTS 代理網址；設 `off` 只用 WebSocket 直連 |
| `API_TOKEN` | 否 | 設定後所有 `/api/*`（health 除外）須帶 `X-Api-Token` 標頭，供對外部署保護 |

## 目錄結構

| 路徑 | 用途 |
|------|------|
| `public/` | 工坊前端主線（index.html、app.js、css、sw.js） |
| `server.js` | Express 後端：靜態站 + `/api/chat`、`/api/tts`、`/api/analyze-roles` |
| `lib/` | 後端模組：Edge TTS 合成、角色/情緒分析 |
| `reader/` | 小說閱讀站（獨立 PWA） |
| `novels/` | 小說檔與 manifest.json |
| `scripts/sync-workshop.js` | 把 `public/` 同步到根目錄（GitHub Pages 部署用） |
| 根目錄 `index.html`、`js/`、`css/` 等 | GitHub Pages 部署副本，由 sync 腳本產生，**勿手改** |

## TTS 朗讀注意事項

- **多音字讀音**規則集中在 `public/js/tts-polyphone-hints.js`（前後端共用）。
  - 後端 WebSocket 直連路徑會組 SSML，`<phoneme>` 標註生效，讀音最準。
  - 代理 Worker **不支援 SSML**（會把標籤唸出來），該路徑會自動改用 word joiner（U+2060）保護詞彙。
- 新增錯音詞流程：
  1. 在 `tts-polyphone-hints.js` 的 `pairs` 加入 regex → phoneme 規則（注意長詞要排在短詞前）。
  2. 視需要加入 `PROTECTED_WORDS`（word joiner 詞表）。
  3. 執行 `npm test` 確認規則無誤傷。
  4. bump `public/sw.js` 的 `CACHE_VERSION`，並跑 `node scripts/sync-workshop.js` 同步根目錄。
  5. 重啟 `npm start`；瀏覽器強制重新整理。
- 修改 `public/` 的 JS/CSS 後都要 bump `CACHE_VERSION`，否則 PWA 用戶拿不到新版。

## 測試

```bash
npm test
```

目前涵蓋 `tts-polyphone-hints.js` 的多音字規則邊界案例。

## 部署

- **本機**：`npm start`（完整功能，含 DeepSeek 與本機 TTS）。
- **GitHub Pages**：跑 `node scripts/sync-workshop.js` 後推送；靜態站無後端，TTS 走代理 Worker、無法使用 DeepSeek 生成。
