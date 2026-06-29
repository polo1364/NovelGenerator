/**
 * 小說工坊 — Edge 神經語音＋情緒朗讀（對齊 extx 擴充元件邏輯）
 */
(function (global) {
  const TTS_ENDPOINT = '/api/tts';
  const VOICES_ENDPOINT = '/api/tts/voices';
  const TTS_PROXY_URL = 'https://web-reader-tts-proxy.polo760504.workers.dev';
  const ANALYZE_ENDPOINT = '/api/analyze-roles';
  const ANALYZE_STREAM_ENDPOINT = '/api/analyze-roles/stream';
  const DEFAULT_VOICE = 'zh-CN-YunjianNeural';
  const VOICE_STORAGE_KEY = 'edgeSpeechVoice';
  const CHUNK_LEN = 200;

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

  // extx content.js EMOTION_STYLE_MAP
  const EMOTION_STYLE_MAP = {
    neutral: ['general'],
    happy: ['cheerful', 'friendly', 'affectionate', 'general'],
    excited: ['cheerful', 'friendly', 'lyrical', 'general'],
    sad: ['sad', 'depressed', 'gentle', 'calm', 'general'],
    angry: ['angry', 'disgruntled', 'serious', 'general'],
    fear: ['fearful', 'embarrassed', 'sad', 'general'],
    gentle: ['gentle', 'affectionate', 'calm', 'general'],
    whisper: ['gentle', 'affectionate', 'calm', 'general'],
    cold: ['serious', 'disgruntled', 'calm', 'general'],
    serious: ['serious', 'calm', 'narration-professional', 'general'],
    narration: ['narration-relaxed', 'documentary-narration', 'calm', 'general'],
    mysterious: ['fearful', 'serious', 'calm', 'general'],
    dramatic: ['serious', 'angry', 'general']
  };

  const EMOTION_PROSODY = {
    neutral: { rateMul: 1.0, pitchAdd: 0, pause: 300 },
    happy: { rateMul: 1.06, pitchAdd: 0.08, pause: 280 },
    excited: { rateMul: 1.14, pitchAdd: 0.14, pause: 200 },
    sad: { rateMul: 0.9, pitchAdd: -0.08, pause: 500 },
    angry: { rateMul: 1.1, pitchAdd: 0.06, pause: 320 },
    fear: { rateMul: 1.12, pitchAdd: 0.1, pause: 350 },
    gentle: { rateMul: 0.94, pitchAdd: -0.02, pause: 350 },
    whisper: { rateMul: 0.88, pitchAdd: -0.1, pause: 400 },
    cold: { rateMul: 0.96, pitchAdd: -0.06, pause: 380 },
    serious: { rateMul: 0.96, pitchAdd: -0.04, pause: 350 },
    narration: { rateMul: 1.0, pitchAdd: 0, pause: 300 },
    mysterious: { rateMul: 0.9, pitchAdd: -0.04, pause: 450 },
    dramatic: { rateMul: 1.02, pitchAdd: 0.04, pause: 400 }
  };

  const NARRATOR_STYLE_PREF = ['narration-relaxed', 'narration-professional', 'documentary-narration', 'calm'];

  let cachedVoices = RECOMMENDED_VOICES;
  let ttsModeCache = null;

  async function detectTtsMode() {
    if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
    if (ttsModeCache) return ttsModeCache;
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        ttsModeCache = 'local';
        return ttsModeCache;
      }
    } catch { /* GitHub Pages 等靜態站 */ }
    ttsModeCache = 'proxy';
    return ttsModeCache;
  }

  function getVoices() {
    return cachedVoices;
  }

  function getVoiceById(voiceId) {
    return cachedVoices.find((v) => v.id === voiceId) || cachedVoices.find((v) => v.id === DEFAULT_VOICE) || cachedVoices[0];
  }

  function getVoiceStyles(voiceId) {
    const v = getVoiceById(voiceId);
    return v?.styles?.length ? v.styles : ['general'];
  }

  function pickStyleForEmotion(voiceId, emotion) {
    const avail = getVoiceStyles(voiceId);
    const cands = EMOTION_STYLE_MAP[emotion] || EMOTION_STYLE_MAP.neutral;
    for (const c of cands) {
      if (avail.includes(c)) return c;
    }
    return 'general';
  }

  function pickNarratorStyle(voiceId) {
    const avail = getVoiceStyles(voiceId);
    for (const c of NARRATOR_STYLE_PREF) {
      if (avail.includes(c)) return c;
    }
    return 'general';
  }

  function prosodyForEmotion(emotion, baseRate, basePitch) {
    const p = EMOTION_PROSODY[emotion] || EMOTION_PROSODY.neutral;
    return {
      rate: Math.min(2, Math.max(0.5, baseRate * p.rateMul)),
      pitch: Math.min(2, Math.max(0.5, basePitch + p.pitchAdd)),
      pause: p.pause
    };
  }

  function buildEmotionParams(emotion, baseRate, basePitch, voiceId) {
    const prosody = prosodyForEmotion(emotion, baseRate, basePitch);
    return {
      rate: prosody.rate,
      pitch: prosody.pitch,
      volume: 1,
      pause: prosody.pause,
      style: pickStyleForEmotion(voiceId, emotion),
      emotion
    };
  }

  function detectEmotionFromText(text) {
    const sadKeywords = ['悲傷', '哭泣', '淚水', '死亡', '離別', '痛苦', '絕望', '心碎', '哀傷', '悼念', '嘆息', '憂愁', '哽咽'];
    const excitedKeywords = ['激動', '興奮', '勝利', '衝刺', '爆發', '熱血', '燃燒', '戰鬥', '吶喊', '奮起', '怒吼', '突破'];
    const mysteriousKeywords = ['神秘', '陰森', '詭異', '黑暗', '未知', '秘密', '隱藏', '恐怖', '懸疑', '謎團', '幽暗', '詛咒'];
    const gentleKeywords = ['溫柔', '輕聲', '微笑', '愛情', '甜蜜', '擁抱', '親吻', '溫暖', '呢喃', '柔情', '浪漫', '心動', '低聲'];
    const dramaticKeywords = ['震驚', '揭露', '轉折', '意外', '真相', '背叛', '復仇', '命運', '對決', '高潮', '決戰', '冷笑'];

    let sadScore = sadKeywords.filter((k) => text.includes(k)).length;
    let excitedScore = excitedKeywords.filter((k) => text.includes(k)).length;
    let mysteriousScore = mysteriousKeywords.filter((k) => text.includes(k)).length;
    let gentleScore = gentleKeywords.filter((k) => text.includes(k)).length;
    let dramaticScore = dramaticKeywords.filter((k) => text.includes(k)).length;

    if ((text.match(/！/g) || []).length > 2) excitedScore += 2;
    if ((text.match(/？/g) || []).length > 2) mysteriousScore += 1;
    if ((text.match(/⋯|…/g) || []).length > 1) sadScore += 1;

    const maxScore = Math.max(sadScore, excitedScore, mysteriousScore, gentleScore, dramaticScore);
    if (maxScore === 0) return 'narration';
    if (sadScore === maxScore) return 'sad';
    if (excitedScore === maxScore) return 'excited';
    if (mysteriousScore === maxScore) return 'mysterious';
    if (gentleScore === maxScore) return 'gentle';
    if (dramaticScore === maxScore) return 'dramatic';
    return 'narration';
  }

  function sanitizeTtsText(text) {
    if (!text) return '';
    let s = String(text);
    s = s.replace(/[#＃*＊_＿`´^＾~～｜|\\<>＜＞{}\[\]【】〖〗〔〕［］]/g, '');
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
    s = s.replace(/[—–\-=＝]{3,}/g, '');
    s = s.replace(/[ \t\u00A0]{2,}/g, ' ');
    return s.trim();
  }

  function hasSpeakableText(s) {
    return /[\p{L}\p{N}]/u.test(s || '');
  }

  function splitTextIntoChunks(text, maxLen = CHUNK_LEN) {
    if (text.length <= maxLen) return [text.trim()].filter(Boolean);
    const chunks = [];
    const sentences = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length > maxLen) {
        if (current) chunks.push(current.trim());
        if (sentence.length > maxLen) {
          for (let i = 0; i < sentence.length; i += maxLen) {
            chunks.push(sentence.slice(i, i + maxLen).trim());
          }
          current = '';
        } else {
          current = sentence;
        }
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  async function fetchVoices() {
    try {
      const res = await fetch(VOICES_ENDPOINT);
      if (!res.ok) return cachedVoices;
      const data = await res.json();
      if (Array.isArray(data.voices) && data.voices.length) {
        cachedVoices = data.voices;
      }
    } catch { /* ignore */ }
    return cachedVoices;
  }

  function populateVoiceSelect(selectEl, selectedId) {
    if (!selectEl) return;
    const saved = selectedId || localStorage.getItem(VOICE_STORAGE_KEY) || DEFAULT_VOICE;
    selectEl.innerHTML = '';
    const tw = cachedVoices.filter((v) => v.lang === 'zh-TW');
    const cn = cachedVoices.filter((v) => v.lang === 'zh-CN');
    const hk = cachedVoices.filter((v) => v.lang === 'zh-HK');

    function addGroup(label, list) {
      if (!list.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      list.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        group.appendChild(opt);
      });
      selectEl.appendChild(group);
    }

    addGroup('🇹🇼 繁體中文', tw);
    addGroup('🇨🇳 普通話', cn);
    addGroup('🇭🇰 粵語', hk);

    if ([...selectEl.options].some((o) => o.value === saved)) {
      selectEl.value = saved;
    } else if (selectEl.options.length) {
      selectEl.value = selectEl.options[0].value;
    }
  }

  function populateRoleSelects(narratorEl, maleEl, femaleEl, prefs = {}) {
    for (const sel of [narratorEl, maleEl, femaleEl]) {
      if (!sel) continue;
      sel.innerHTML = '';
      cachedVoices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        sel.appendChild(opt);
      });
    }
    const set = (sel, val, fallback) => {
      if (sel && val && [...sel.options].some((o) => o.value === val)) sel.value = val;
      else if (sel && fallback && [...sel.options].some((o) => o.value === fallback)) sel.value = fallback;
    };
    set(narratorEl, prefs.narratorVoice, DEFAULT_VOICE);
    set(maleEl, prefs.maleVoice, 'zh-CN-YunxiNeural');
    set(femaleEl, prefs.femaleVoice, 'zh-CN-XiaoxiaoNeural');
  }

  async function analyzeRoles(text, onProgress, signal) {
    const res = await fetch(ANALYZE_STREAM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({ text }),
      signal
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `角色分析失敗 (${res.status})`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('無法讀取分析進度串流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let segments = [];

    const handleEvent = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'start' && typeof onProgress === 'function') {
        onProgress(0, payload.total || 1);
      } else if (payload.type === 'progress' && typeof onProgress === 'function') {
        onProgress(payload.done || 0, payload.total || 1);
      } else if (payload.type === 'complete') {
        segments = payload.segments || [];
      } else if (payload.type === 'error') {
        throw new Error(payload.error || '角色分析失敗');
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        handleEvent(JSON.parse(line.slice(6)));
      }
    }

    if (buffer.trim()) {
      const line = buffer.split('\n').find((l) => l.startsWith('data: '));
      if (line) handleEvent(JSON.parse(line.slice(6)));
    }

    return segments;
  }

  /**
   * 依 extx 角色模式建立播放佇列：每段含 text / voice / style / rate / pitch
   */
  async function buildRolePlayQueue(text, options = {}) {
    const {
      narratorVoice = DEFAULT_VOICE,
      maleVoice = 'zh-CN-YunxiNeural',
      femaleVoice = 'zh-CN-XiaoxiaoNeural',
      baseRate = 1,
      basePitch = 1,
      dramaMode = true,
      onProgress
    } = options;

    const clean = sanitizeTtsText(text);
    if (!clean) return [];

    let segments;
    try {
      if (typeof onProgress === 'function') onProgress('start');
      segments = await analyzeRoles(clean, (done, total) => {
        if (typeof onProgress === 'function') onProgress('progress', done, total);
      });
      if (typeof onProgress === 'function') onProgress('done');
    } catch (err) {
      console.warn('角色分析失敗，改用單一語音:', err.message);
      segments = [{ g: 'n', e: 'neutral', t: clean }];
    }

    const voiceFor = (g) =>
      g === 'm' ? maleVoice : g === 'f' ? femaleVoice : narratorVoice;

    const merged = [];
    for (const seg of segments) {
      const g = seg.g === 'm' || seg.g === 'f' ? seg.g : 'n';
      const e = seg.e || 'neutral';
      const t = seg.t || '';
      if (!t) continue;
      const last = merged[merged.length - 1];
      if (last && last.g === g && last.e === e) last.t += t;
      else merged.push({ g, e, t });
    }

    const queue = [];
    for (const seg of merged) {
      const voice = voiceFor(seg.g);
      const style = seg.g === 'n'
        ? pickNarratorStyle(voice)
        : pickStyleForEmotion(voice, seg.e);
      const prosody = (seg.g !== 'n' && dramaMode)
        ? prosodyForEmotion(seg.e, baseRate, basePitch)
        : { rate: baseRate, pitch: basePitch, pause: 300 };

      for (const piece of splitTextIntoChunks(seg.t)) {
        if (!hasSpeakableText(piece)) continue;
        queue.push({
          text: piece,
          voice,
          style,
          rate: prosody.rate,
          pitch: prosody.pitch,
          pause: prosody.pause,
          g: seg.g,
          e: seg.e,
          sourceText: seg.t
        });
      }
    }
    return queue;
  }

  function buildSimplePlayQueue(segments, voiceId, emotionMode, baseRate, basePitch) {
    const queue = [];
    for (let si = 0; si < segments.length; si++) {
      const raw = segments[si];
      const emotion = emotionMode === 'auto'
        ? detectEmotionFromText(raw)
        : emotionMode;
      const params = buildEmotionParams(emotion, baseRate, basePitch, voiceId);
      const text = sanitizeTtsText(raw);
      if (!hasSpeakableText(text)) continue;
      for (const piece of splitTextIntoChunks(text)) {
        if (!hasSpeakableText(piece)) continue;
        queue.push({
          text: piece,
          voice: voiceId,
          style: params.style,
          rate: params.rate,
          pitch: params.pitch,
          pause: params.pause,
          emotion,
          sourceSegmentIndex: si,
          sourceText: raw
        });
      }
    }
    return queue;
  }

  async function synthesize({ text, voice, style, rate, pitch, signal }) {
    const mode = await detectTtsMode();
    const url = mode === 'local' ? TTS_ENDPOINT : mode === 'proxy' ? TTS_PROXY_URL : null;
    if (!url) throw new Error('請用 npm start 或 HTTPS 網頁開啟');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        text,
        voice: voice || DEFAULT_VOICE,
        style: style || 'general',
        rate: rate ?? 1,
        pitch: pitch ?? 1
      })
    });

    if (!res.ok) {
      let msg = `語音合成失敗 (${res.status})`;
      try {
        const err = await res.json();
        if (err?.error) msg = err.error;
      } catch {
        const t = await res.text().catch(() => '');
        if (t) msg = t.slice(0, 120);
      }
      throw new Error(msg);
    }
    return res.arrayBuffer();
  }

  async function checkAvailable() {
    const mode = await detectTtsMode();
    return mode === 'local' || mode === 'proxy';
  }

  global.EdgeTtsSpeech = {
    DEFAULT_VOICE,
    RECOMMENDED_VOICES,
    getVoices,
    fetchVoices,
    populateVoiceSelect,
    populateRoleSelects,
    pickStyleForEmotion,
    buildEmotionParams,
    detectEmotionFromText,
    sanitizeTtsText,
    analyzeRoles,
    buildRolePlayQueue,
    buildSimplePlayQueue,
    synthesize,
    checkAvailable
  };
})(window);
