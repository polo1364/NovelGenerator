# Uiverse 編輯部機台介面設計

日期：2026-07-22

## 目標

以 Uiverse Galaxy 的 MIT 授權元件作為視覺素材，將 AI 小說工坊翻新為具有辨識度的「編輯部機台」。保留既有小說生成、設定、儲存、朗讀、匯出與閱讀邏輯，不更換前端技術棧。

## 設計方向

整體採現代編輯室與實體控制台的混合語彙：粗黑框、錯位陰影、紙張便箋、功能標籤及有限度的立體互動。色彩以墨黑、紙白、珊瑚紅、編輯綠和標記黃組成，避免回到單一米色書房或一般 SaaS 卡片頁。

首頁保留目前的創作流程，但重組視覺層級：

1. 頂部顯示品牌、模型連線狀態與五階段流程。
2. 「故事元素」、「進階設定」、「特殊元素」呈現為三個可操作模組卡，繼續開啟既有設定 modal。
3. 自訂規則與大綱預覽形成右側便箋區；窄螢幕時垂直排列。
4. 開始生成、繼續生成與清除結果維持既有功能，改為實體控制鍵外觀。
5. 特殊元素完整清單留在 modal 中，首頁只顯示已選數量和摘要，避免頁面被清單撐長。

## Uiverse 元件來源與改造

只抽取必要 HTML/CSS，不新增執行期依賴：

- `Buttons/0xnihilism_quiet-dog-6.html`：粗框、錯位陰影與按壓回饋，改造為主要動作按鈕。
- `Cards/0xnihilism_moody-moth-91.html`：立體 hover 層次，收斂角度與位移後用於設定模組。
- `Cards/Creatlydev_friendly-fish-0.html`：標籤與緞帶結構，簡化為 CORE、TUNE、SPICE 功能標籤。
- `Checkboxes/adamgiebl_proud-donkey-24.html`：彈跳勾選回饋，用於特殊元素選項。
- `Toggle-switches/Bodyhc_loud-badger-7.html`：實體切換語彙，縮小並套用既有色彩 token。

保留來源註解，所有選擇器加上專案命名範圍，避免 `.card`、`.container` 等通用名稱污染既有樣式。

## 技術邊界

- 保留 `public/index.html` 中所有現有 `id`、`data-*`、表單名稱和控制項語意。
- 不更改 `public/js/app.js` 的資料流程、事件處理、localStorage 鍵值與 API 呼叫。
- 以新的 `public/css/uiverse-editorial.css` 覆蓋視覺，避免在大型 `styles.css` 中做廣泛重排。
- 僅在樣式需要時新增不具行為的 wrapper 或 class；新增前先確認不影響既有選擇器。
- 保留深色模式，採相同結構但切換色彩 token。
- 動畫限制在 hover、focus 與按壓回饋；`prefers-reduced-motion: reduce` 時停用位移與動畫。

## 響應式行為

- `>= 1024px`：主設定區採左右雙欄，三張模組卡橫排。
- `768px–1023px`：內容維持雙欄但縮小間距，模組卡可換行。
- `< 768px`：所有內容單欄；流程列可水平滑動；按鈕維持至少 44px 點擊高度。
- 所有寬度禁止頁面級水平溢出，modal 內只有一個垂直捲動容器。

## 無障礙與狀態

- 保留原生 `button`、`input`、`select`、`textarea`，不以 `div` 模擬控制項。
- 所有互動元件提供可見的 `:focus-visible` 樣式。
- `disabled`、loading、success、error、selected 狀態均有非動畫識別。
- 文字與背景達到可讀對比，顏色不是唯一狀態提示。

## 驗證

1. 執行專案既有 `npm test`。
2. 啟動本機伺服器，確認控制台無錯誤。
3. 驗證故事元素、進階設定、特殊元素 modal 可開關且資料仍會更新摘要。
4. 驗證開始生成、繼續生成、清除、大綱、下載與朗讀按鈕仍連接原本事件。
5. 在 375、428、768、1280、1536px 檢查無水平溢出、文字遮擋與不可用控制項。
6. 檢查亮色、深色及 reduced-motion 模式。

## 非目標

- 不重寫 `app.js`。
- 不導入 React、Vue、Tailwind 或 Uiverse 執行期套件。
- 不改後端 API、生成提示詞、資料格式或 PWA 功能。
- 不複製 Uiverse 範例的品牌、文字或通用 class 名稱。
