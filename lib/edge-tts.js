/**
 * Edge 神經語音合成（Node.js 直連 WebSocket）
 */
const crypto = require('crypto');
const { applyPolyphoneHints } = require('../public/js/tts-polyphone-hints.js');

const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const WSS_URL = `wss://${EDGE_BASE}/edge/v1?TrustedClientToken=${EDGE_TOKEN}`;
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';
const WIN_EPOCH = 11644473600;
/** 與 extx 相同：Node 直連 Edge WebSocket 常失敗，預設走代理 */
const DEFAULT_TTS_PROXY_URL = 'https://web-reader-tts-proxy.polo760504.workers.dev';

const EDGE_WS_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  Origin: 'chrome-extension://jdiccldaccahdggdbehgananajbkpgbf'
};

const RECOMMENDED_VOICES = [
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻（女聲・繁中）', lang: 'zh-TW', styles: ['general', 'calm', 'cheerful', 'sad', 'angry', 'fearful', 'gentle', 'serious', 'affectionate'] },
  { id: 'zh-TW-HsiaoYuNeural', name: '曉雨（女聲・繁中）', lang: 'zh-TW', styles: ['general', 'calm', 'cheerful', 'sad', 'gentle'] },
  { id: 'zh-CN-XiaoxiaoNeural', name: '曉曉（女聲・普通話）', lang: 'zh-CN', styles: ['general', 'cheerful', 'sad', 'gentle', 'serious', 'affectionate', 'fearful', 'angry'] },
  { id: 'zh-CN-YunxiNeural', name: '雲希（男聲・普通話）', lang: 'zh-CN', styles: ['general', 'narration-relaxed', 'cheerful', 'sad', 'serious', 'fearful', 'angry'] },
  { id: 'zh-CN-YunjianNeural', name: '雲健（男聲・渾厚旁白）', lang: 'zh-CN', styles: ['general', 'narration-relaxed', 'documentary-narration', 'sad', 'serious', 'cheerful', 'angry'] },
  { id: 'zh-CN-YunxiaNeural', name: '雲夏（少年男聲）', lang: 'zh-CN', styles: ['general', 'calm', 'cheerful', 'sad', 'angry', 'fearful'] },
  { id: 'zh-CN-XiaoyiNeural', name: '曉伊（女聲・甜美）', lang: 'zh-CN', styles: ['general', 'cheerful', 'gentle', 'sad', 'affectionate', 'serious'] },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼（女聲・粵語）', lang: 'zh-HK', styles: ['general'] },
  { id: 'zh-HK-WanLungNeural', name: '雲龍（男聲・粵語）', lang: 'zh-HK', styles: ['general'] }
];

function sha256Upper(text) {
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

function generateSecMsGec() {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks = Math.floor(ticks * 1e7);
  return sha256Upper(`${ticks}${EDGE_TOKEN}`);
}

function generateConnectionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function dateToString() {
  return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

function escapeXml(text) {
  return String(text)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlPreservingPhoneme(text) {
  const parts = String(text).split(/(<phoneme[\s\S]*?<\/phoneme>)/g);
  return parts.map((p) => (p.startsWith('<phoneme') ? p : escapeXml(p))).join('');
}

function rateToProsody(rate) {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function pitchToProsody(pitch) {
  const pct = Math.round((pitch - 1) * 50);
  return pct >= 0 ? `+${pct}Hz` : `${pct}Hz`;
}

function buildSsml(text, { voice, style, rate, pitch }) {
  const escaped = escapeXmlPreservingPhoneme(applyPolyphoneHints(text));
  const rateStr = rateToProsody(rate ?? 1);
  const pitchStr = pitchToProsody(pitch ?? 1);
  const lang = voice.startsWith('zh-TW') ? 'zh-TW' : voice.startsWith('zh-HK') ? 'zh-HK' : 'zh-CN';
  const inner =
    style && style !== 'general'
      ? `<mstts:express-as style="${style}"><prosody rate="${rateStr}" pitch="${pitchStr}">${escaped}</prosody></mstts:express-as>`
      : `<prosody rate="${rateStr}" pitch="${pitchStr}">${escaped}</prosody>`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">` +
    `<voice name="${voice}">${inner}</voice></speak>`
  );
}

function ssmlMessage(ssml) {
  return (
    `X-RequestId:${generateConnectionId()}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${dateToString()}Z\r\n` +
    `Path:ssml\r\n\r\n${ssml}`
  );
}

function configMessage() {
  return (
    `X-Timestamp:${dateToString()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    `{"context":{"synthesis":{"audio":{"metadataoptions":` +
    `{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},` +
    `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
  );
}

function parseBinaryMessage(data) {
  const view = new Uint8Array(data);
  if (view.length < 2) return null;
  const headerLen = (view[0] << 8) | view[1];
  if (headerLen > view.length) return null;
  const headerText = Buffer.from(view.slice(2, 2 + headerLen)).toString('utf8');
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const audioData = view.slice(2 + headerLen);
  if (headers.Path !== 'audio') return null;
  const ct = headers['Content-Type'];
  if (ct && ct !== 'audio/mpeg') return null;
  return audioData.length > 0 ? audioData : null;
}

function trimToMp3Start(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return bytes;
  }
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      return i === 0 ? bytes : bytes.slice(i);
    }
  }
  return bytes;
}

async function synthesizeViaProxy(proxyUrl, text, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(proxyUrl.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: applyPolyphoneHints(text),
        voice: options.voice,
        style: options.style,
        rate: options.rate,
        pitch: options.pitch
      })
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`TTS 代理失敗 (${response.status}): ${err.slice(0, 120)}`);
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error('代理回傳空的音訊');
    return Buffer.from(buffer);
  } finally {
    clearTimeout(timer);
  }
}

function synthesizeViaWebSocket(text, options, retry = true) {
  const secGec = generateSecMsGec();
  const connectionId = generateConnectionId();
  const wsUrl =
    `${WSS_URL}&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${secGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const ssml = buildSsml(text, options);

  return new Promise((resolve, reject) => {
    const audioParts = [];
    let settled = false;
    const ws = new WebSocket(wsUrl, { headers: EDGE_WS_HEADERS });

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(result);
    };

    const timeout = setTimeout(() => finish(new Error('Edge TTS 連線逾時')), 60000);

    ws.addEventListener('open', () => {
      ws.send(configMessage());
      ws.send(ssmlMessage(ssml));
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          if (audioParts.length === 0) {
            finish(new Error('未收到語音資料'));
          } else {
            const total = audioParts.reduce((n, p) => n + p.length, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const part of audioParts) {
              merged.set(part, offset);
              offset += part.length;
            }
            finish(null, Buffer.from(trimToMp3Start(merged)));
          }
        }
        return;
      }

      Promise.resolve(
        event.data instanceof ArrayBuffer
          ? event.data
          : event.data.arrayBuffer()
      ).then((buf) => {
        const audio = parseBinaryMessage(buf);
        if (audio) audioParts.push(audio);
      }).catch(() => {});
    });

    ws.addEventListener('error', () => finish(new Error('Edge TTS WebSocket 連線失敗')));

    ws.addEventListener('close', (ev) => {
      if (!settled && ev.code !== 1000) {
        if (retry && (ev.code === 1006 || ev.code === 1008)) {
          synthesizeViaWebSocket(text, options, false).then(resolve).catch(reject);
        } else {
          finish(new Error(`Edge TTS 連線關閉 (${ev.code})`));
        }
      }
    });
  });
}

async function synthesizeEdgeTts(text, options = {}) {
  const opts = {
    voice: options.voice || 'zh-CN-YunjianNeural',
    style: options.style || 'general',
    rate: Number(options.rate) || 1,
    pitch: Number(options.pitch) || 1
  };
  const envProxy = process.env.TTS_PROXY_URL;
  const proxyUrl = envProxy !== undefined
    ? String(envProxy).trim()
    : DEFAULT_TTS_PROXY_URL;
  if (proxyUrl && proxyUrl.toLowerCase() !== 'off') {
    try {
      return await synthesizeViaProxy(proxyUrl, text, opts);
    } catch (err) {
      console.warn('[edge-tts] 代理失敗，改直連 WebSocket:', err.message);
    }
  }
  return synthesizeViaWebSocket(text, opts);
}

module.exports = {
  RECOMMENDED_VOICES,
  synthesizeEdgeTts
};
