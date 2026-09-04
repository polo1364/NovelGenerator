(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovelGenerationPlanning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAMPLING_PROFILES = Object.freeze({
    story: Object.freeze({ temperature: 0.9, frequency_penalty: 0.3 }),
    continuation: Object.freeze({ temperature: 0.78, frequency_penalty: 0.3 }),
    outline: Object.freeze({ temperature: 0.6, frequency_penalty: 0.3 }),
    title: Object.freeze({ temperature: 0.8, frequency_penalty: 0.3 }),
    state: Object.freeze({ temperature: 0.2, frequency_penalty: 0.3 }),
    assistant: Object.freeze({ temperature: 0.75, frequency_penalty: 0.3 })
  });

  const CHAPTER_HEADING_RE = /^\s*#{0,4}\s*(?:第\s*(\d+)\s*章|Chapter\s*(\d+))\s*[：:、.\-－—\s]*(.*)$/gim;
  const SECTION_HEADING_RE = /^\s*【[^\n】]+】\s*$/gm;
  const MAX_OUTLINE_GUIDANCE_LENGTH = 6000;
  const MAX_STATE_SOURCE_LENGTH = 12000;
  const MAX_STATE_ITEMS = 12;
  const MAX_STATE_ITEM_LENGTH = 240;
  const DIVERSITY_POOL_FRACTIONS = Object.freeze({
    stable: 0.25,
    rich: 0.65,
    experimental: 1
  });
  const DIVERSITY_TEMPERATURES = Object.freeze({
    stable: Object.freeze({ story: 0.75, continuation: 0.68, outline: 0.5, title: 0.7, assistant: 0.65 }),
    rich: Object.freeze({ story: 0.9, continuation: 0.78, outline: 0.6, title: 0.8, assistant: 0.75 }),
    experimental: Object.freeze({ story: 1.05, continuation: 0.9, outline: 0.75, title: 0.95, assistant: 0.85 })
  });

  function sanitizeStateList(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item === 'string' && item.trim())
      .slice(0, MAX_STATE_ITEMS)
      .map((item) => item.trim().slice(0, MAX_STATE_ITEM_LENGTH));
  }

  function sanitizeStoryState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      establishedFacts: sanitizeStateList(value.establishedFacts),
      characterStates: sanitizeStateList(value.characterStates),
      unresolvedThreads: sanitizeStateList(value.unresolvedThreads),
      timeline: sanitizeStateList(value.timeline),
      recentOutcome: typeof value.recentOutcome === 'string'
        ? value.recentOutcome.trim().slice(0, 500)
        : ''
    };
  }

  function parseStoryState(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return sanitizeStoryState(JSON.parse(raw.slice(start, end + 1)));
    } catch (_) {
      return null;
    }
  }

  function buildStoryStatePrompt({ previousState, storyText, chapterCount } = {}) {
    const previous = sanitizeStoryState(previousState) || {
      establishedFacts: [],
      characterStates: [],
      unresolvedThreads: [],
      timeline: [],
      recentOutcome: ''
    };
    const recentStory = String(storyText || '').slice(-MAX_STATE_SOURCE_LENGTH);
    return `你是長篇小說的連貫性編輯。請根據「已寫出的正文」更新故事狀態表。

規則：
• 只記錄正文已明確發生或確定的內容，不可把未來大綱當成既成事實。
• 保留仍有效的舊狀態，移除已解決的伏筆，更新人物與時間線。
• 每個陣列最多 ${MAX_STATE_ITEMS} 項，每項簡短具體。
• 只輸出 JSON 物件，不要 Markdown、code fence 或說明文字。

JSON 格式：
{"establishedFacts":[],"characterStates":[],"unresolvedThreads":[],"timeline":[],"recentOutcome":""}

目前已完成章節：約 ${Number.parseInt(chapterCount, 10) || 0} 章

【上一版狀態表】
${JSON.stringify(previous)}

【最近已寫正文】
${recentStory}`;
  }

  function formatStoryStateGuidance(value) {
    const state = sanitizeStoryState(value);
    if (!state) return '';
    const lines = ['\n\n【已確認故事狀態（不得矛盾）】'];
    if (state.establishedFacts.length) lines.push(`• 已確定事實：${state.establishedFacts.join('；')}`);
    if (state.characterStates.length) lines.push(`• 人物目前狀態：${state.characterStates.join('；')}`);
    if (state.unresolvedThreads.length) lines.push(`• 未解伏筆：${state.unresolvedThreads.join('；')}`);
    if (state.timeline.length) lines.push(`• 時間線：${state.timeline.join('；')}`);
    if (state.recentOutcome) lines.push(`• 最近章節結果：${state.recentOutcome}`);
    return lines.length > 1 ? lines.join('\n') : '';
  }

  function createStoryFingerprint(storyText) {
    const text = String(storyText || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }

  function hashSeed(value) {
    const text = String(value || 'default');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createSeededRandom(seed, namespace = 'default') {
    let state = hashSeed(`${String(seed || 'default')}::${namespace}`);
    return function seededRandom() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickSeededValue(items, random) {
    if (!Array.isArray(items) || !items.length) return '';
    const selected = items[Math.floor(random() * items.length)];
    return selected && typeof selected === 'object' ? selected.value : selected;
  }

  function buildAdvancedRandomSelection({ seed, mode = 'rich', options } = {}) {
    const normalizedMode = Object.hasOwn(DIVERSITY_POOL_FRACTIONS, mode) ? mode : 'rich';
    const fraction = DIVERSITY_POOL_FRACTIONS[normalizedMode];
    const source = options || {};
    const result = {};
    for (const key of ['narrative', 'era', 'pacing', 'rating', 'worldComplexity', 'emotionalTone', 'ending']) {
      const items = Array.isArray(source[key]) ? source[key] : [];
      const poolSize = key === 'era' ? items.length : Math.max(1, Math.ceil(items.length * fraction));
      const pool = items.slice(0, poolSize);
      result[key] = pickSeededValue(pool, createSeededRandom(seed, `advanced:${key}`));
    }
    return result;
  }

  function buildDiversityGuidance(mode = 'rich') {
    const normalizedMode = Object.hasOwn(DIVERSITY_POOL_FRACTIONS, mode) ? mode : 'rich';
    const details = {
      stable: '優先清晰因果、熟悉結構與閱讀流暢度；變化集中在場景、對話與局部轉折。',
      rich: '保持主線清楚，同時讓章節衝突形式、場景節奏與情緒推進具有變化，避免重複上一章的套路。',
      experimental: '可使用非線性、特殊視角或非常規場景轉換，但必須讓讀者能理解事件因果。'
    };
    const labels = { stable: '穩定', rich: '豐富', experimental: '實驗' };
    return `\n\n【創意幅度：${labels[normalizedMode]}】\n• ${details[normalizedMode]}\n• 創意變化不得破壞人物動機、已確認事實、時間線與本章大綱結果。`;
  }

  function extractChapterOutline(outlineText, chapterNumber) {
    const outline = String(outlineText || '').trim();
    const target = Number.parseInt(chapterNumber, 10);
    if (!outline || !Number.isFinite(target) || target < 1) return '';

    const headings = [];
    CHAPTER_HEADING_RE.lastIndex = 0;
    let match;
    while ((match = CHAPTER_HEADING_RE.exec(outline)) !== null) {
      headings.push({
        chapter: Number.parseInt(match[1] || match[2], 10),
        index: match.index
      });
    }

    const selectedIndex = headings.findIndex((heading) => heading.chapter === target);
    if (selectedIndex < 0) return '';

    const start = headings[selectedIndex].index;
    let end = selectedIndex + 1 < headings.length ? headings[selectedIndex + 1].index : outline.length;
    SECTION_HEADING_RE.lastIndex = start;
    const nextSection = SECTION_HEADING_RE.exec(outline);
    if (nextSection && nextSection.index > start && nextSection.index < end) end = nextSection.index;

    return outline.slice(start, end).trim();
  }

  function buildChapterOutlineGuidance(outlineText, chapterNumber) {
    const outline = String(outlineText || '').trim();
    const target = Number.parseInt(chapterNumber, 10);
    if (!outline || !Number.isFinite(target) || target < 1) return '';

    const chapterOutline = extractChapterOutline(outline, target);
    if (chapterOutline) {
      return `\n\n【本章大綱任務：第${target}章】\n${chapterOutline}\n• 只完成本章範圍，不可提前消耗後續章節的核心事件。\n• 可補充場景與細節，但不得改變本章事件結果、人物動機與伏筆方向。`;
    }

    return `\n\n【全書大綱參考：目前續寫第${target}章】\n${outline.slice(0, MAX_OUTLINE_GUIDANCE_LENGTH)}\n• 無法辨識逐章區塊，請依整體大綱承接前文，不可自行改寫主線方向。`;
  }

  function getSamplingProfile(taskType, diversityMode = 'rich') {
    const profile = SAMPLING_PROFILES[taskType] || SAMPLING_PROFILES.assistant;
    if (taskType === 'state') return { ...profile };
    const normalizedMode = Object.hasOwn(DIVERSITY_TEMPERATURES, diversityMode) ? diversityMode : 'rich';
    const temperatures = DIVERSITY_TEMPERATURES[normalizedMode];
    const key = Object.hasOwn(temperatures, taskType) ? taskType : 'assistant';
    return { ...profile, temperature: temperatures[key] };
  }

  return {
    extractChapterOutline,
    buildChapterOutlineGuidance,
    getSamplingProfile,
    parseStoryState,
    buildStoryStatePrompt,
    formatStoryStateGuidance,
    createStoryFingerprint,
    createSeededRandom,
    buildAdvancedRandomSelection,
    buildDiversityGuidance
  };
});
