/* ============================================================
   AI 小說工坊 — 後端伺服器
   - 提供前端靜態檔（public/）
   - /api/chat：代理 DeepSeek Chat Completions，金鑰只保管於後端環境變數
   - 完整轉發串流（SSE）與非串流回應
   ============================================================ */

require('dotenv').config();
const path = require('path');
const express = require('express');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/chat/completions';

// 故事 prompt 可能很長，放寬 JSON body 上限
app.use(express.json({ limit: '8mb' }));

// 提供前端靜態檔
app.use(express.static(path.join(__dirname, 'public')));

/**
 * DeepSeek 代理端點
 * 前端送來的 body 與直接呼叫 DeepSeek 相同（model / messages / stream …），
 * 這裡只負責補上 Authorization 金鑰並原樣轉發回應。
 */
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: { message: '伺服器尚未設定 DEEPSEEK_API_KEY 環境變數，請聯絡管理員。' },
    });
  }

  // 客戶端中斷（按下「停止生成」或關閉分頁）時，連帶中止上游請求
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) return; // 客戶端已斷線
    return res.status(502).json({
      error: { message: '無法連線至 DeepSeek：' + (err && err.message ? err.message : String(err)) },
    });
  }

  // 轉發狀態碼與內容型別（保留 SSE 的 text/event-stream）
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // 避免反向代理緩衝串流

  if (!upstream.body) {
    return res.end();
  }

  // 將上游的 Web ReadableStream 串接到 Express 回應
  try {
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502);
    res.end();
  }
});

// 健康檢查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, keyConfigured: Boolean(process.env.DEEPSEEK_API_KEY) });
});

app.listen(PORT, () => {
  console.log(`🚀 AI 小說工坊已啟動： http://localhost:${PORT}`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  尚未設定 DEEPSEEK_API_KEY，/api/chat 將回傳 500。請在 .env 設定金鑰。');
  }
});
