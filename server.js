/* ============================================================
   AI 小說工坊 — 後端伺服器
   - 提供前端靜態檔（public/）
   - /api/chat：代理 DeepSeek Chat Completions，金鑰只保管於後端環境變數
   - 完整轉發串流（SSE）與非串流回應
   ============================================================ */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Readable } = require('stream');
const { synthesizeEdgeTts, RECOMMENDED_VOICES } = require('./lib/edge-tts');
const { analyzeDialogueRoles, splitTextIntoBlocks } = require('./lib/analyze-roles');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/chat/completions';

// 故事 prompt 可能很長，放寬 JSON body 上限
app.use(express.json({ limit: '8mb' }));

// 根目錄 = AI 小說工坊；/reader/ = 小說閱讀站
const ROOT = __dirname;
const NOVELS_DIR = path.join(ROOT, 'novels');
const READER_DIR = path.join(ROOT, 'reader');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/reader', (req, res) => {
  res.redirect('/reader/');
});

app.get('/reader/', (req, res) => {
  res.sendFile(path.join(READER_DIR, 'index.html'));
});

app.use('/reader', express.static(READER_DIR, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

app.get('/workshop', (req, res) => {
  res.redirect('/');
});

app.get('/workshop/', (req, res) => {
  res.redirect('/');
});

app.get('/edge-tts-speech.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'js', 'edge-tts-speech.js'));
});

app.use('/novels', express.static(NOVELS_DIR));

app.get('/api/novels', (req, res) => {
  try {
    const manifestPath = path.join(NOVELS_DIR, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return res.json(data);
    }
    if (!fs.existsSync(NOVELS_DIR)) {
      return res.json({ novels: [] });
    }
    const files = fs.readdirSync(NOVELS_DIR).filter((f) => f.endsWith('.txt'));
    res.json({
      novels: files.map((f) => ({
        id: f.replace(/\.txt$/i, ''),
        title: f.replace(/\.txt$/i, ''),
        file: f,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '讀取書庫失敗' });
  }
});

// 根目錄 index.html 為舊版備份；首頁統一由 public/index.html 提供
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css|webmanifest)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

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

/** Edge 神經語音：語音清單 */
app.get('/api/tts/voices', (req, res) => {
  res.json({ voices: RECOMMENDED_VOICES });
});

/** Edge 神經語音：合成 MP3（依情緒風格、語速、音調） */
app.post('/api/tts', async (req, res) => {
  const { text, voice, style, rate, pitch } = req.body || {};
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return res.status(400).json({ error: '缺少可朗讀的文字' });
  }
  if (trimmed.length > 5000) {
    return res.status(400).json({ error: '單段文字過長（上限 5000 字），請縮短朗讀範圍' });
  }

  try {
    const audio = await synthesizeEdgeTts(trimmed, { voice, style, rate, pitch });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio);
  } catch (err) {
    res.status(502).json({
      error: err?.message || 'Edge 語音合成失敗'
    });
  }
});

function validateAnalyzeRolesText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { error: '缺少可分析的文字' };
  if (trimmed.length > 50000) return { error: '文字過長（上限 50000 字）' };
  return { text: trimmed };
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** DeepSeek 角色／情緒分析（供 Edge 多角色朗讀） */
app.post('/api/analyze-roles', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '伺服器尚未設定 DEEPSEEK_API_KEY，無法分析角色語音' });
  }
  const validated = validateAnalyzeRolesText(req.body?.text);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }
  try {
    const { segments, usage } = await analyzeDialogueRoles(apiKey, validated.text);
    res.json({ ok: true, segments, usage });
  } catch (err) {
    res.status(502).json({ error: err?.message || '角色分析失敗' });
  }
});

/** 角色分析 SSE 串流（回報區塊進度 done/total） */
app.post('/api/analyze-roles/stream', async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '伺服器尚未設定 DEEPSEEK_API_KEY，無法分析角色語音' });
  }
  const validated = validateAnalyzeRolesText(req.body?.text);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const blocks = splitTextIntoBlocks(validated.text, 1800);

  const send = (payload) => {
    if (res.writableEnded) return;
    try {
      writeSse(res, payload);
    } catch {
      /* client disconnected */
    }
  };

  send({ type: 'start', total: blocks.length });

  try {
    const { segments, usage } = await analyzeDialogueRoles(apiKey, validated.text, (done, total) => {
      send({ type: 'progress', done, total });
    });
    send({ type: 'complete', segments, usage });
    if (!res.writableEnded) res.end();
  } catch (err) {
    send({ type: 'error', error: err?.message || '角色分析失敗' });
    if (!res.writableEnded) res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🛠️  AI 小說工坊： http://localhost:${PORT}/`);
  console.log(`📖 小說閱讀站： http://localhost:${PORT}/reader/`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️  尚未設定 DEEPSEEK_API_KEY，/api/chat 將回傳 500。請在 .env 設定金鑰。');
  }
});
