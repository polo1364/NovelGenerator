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
    plan: Object.freeze({ temperature: 0.35, frequency_penalty: 0 }),
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

  const RECORD_FIELDS = {
    characterKnowledge: ['character', 'fact', 'learnedFrom', 'evidence'],
    causalEvents: ['event', 'motive', 'cause', 'effect', 'evidence'],
    foreshadowing: ['thread', 'plantedChapter', 'payoff', 'status', 'evidence'],
    entities: ['entity', 'kind', 'status', 'location', 'holder', 'evidence', 'transitionEvidence']
  };

  function shortText(value, limit = 180) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function sanitizeRecords(value, fields) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .slice(0, 8)
      .map(item => Object.fromEntries(fields.map(key => [key, shortText(item[key])])))
      .filter(item => item[fields[0]]);
  }

  function sanitizeStoryState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      establishedFacts: sanitizeStateList(value.establishedFacts),
      characterStates: sanitizeStateList(value.characterStates),
      unresolvedThreads: sanitizeStateList(value.unresolvedThreads),
      timeline: sanitizeStateList(value.timeline),
      characterConflicts: sanitizeRecords(value.characterConflicts, ['character', 'conflictType', 'constraint', 'issue', 'evidence']).slice(0, 3),
      ...Object.fromEntries(Object.entries(RECORD_FIELDS).map(([key, fields]) => [key, sanitizeRecords(value[key], fields)])),
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
      const state = sanitizeStoryState(JSON.parse(raw.slice(start, end + 1)));
      return state && Object.values(state).some(value => value.length > 0) ? state : null;
    } catch (_) {
      return null;
    }
  }

  function buildStoryStatePrompt({ previousState, storyText, chapterCount, characterCanon = '' } = {}) {
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
• 每個摘要陣列最多 4 項，每項最多 30 字；recentOutcome 最多 80 字。
• 下列新增表格每種最多 3 項，只列新增或有改變的紀錄；未變動的舊表格紀錄由系統合併保留。
• 表格每個文字欄位最多 30 字，evidence 與 transitionEvidence 各最多 40 字；優先保留影響後續的變更。
• 整份 JSON 以 2,000 字元以內為目標，必要時減少筆數，必須保留結尾括號，不可輸出半份 JSON。
• characterKnowledge 記錄誰知道什麼、透過誰或哪個事件得知；讀者知道不代表角色知道。
• causalEvents 記錄事件、人物動機、前因與結果；沒有依據的關聯不可當成事實。
• foreshadowing 記錄伏筆、埋設章節、預計回收位置與 open/resolved 狀態；預計回收不是已發生事件。
• entities 使用穩定名稱；kind 為 character/item，角色 status 為 alive/dead/unknown，並記錄目前 location；物件記錄 holder。
• evidence 必須逐字引用提供的正文（4～40字）；舊紀錄可沿用。位置、持有人、生死改變時，transitionEvidence 必須逐字引用本次新增正文中造成轉變的事件，不能只重複結果。
• 不確定時用空字串或 unknown；不要猜測。新揭密不等於矛盾，但不能推翻已確認事實。
• 對照人物設定檢查能力代價、信念底線與漸進成長；設定是約束，不代表轉變已發生。characterStates 摘要目前傷勢、關係、成長進度，不覆寫初始設定。
• characterConflicts 最多 3 項，每項 {"character":"設定中的人物名","conflictType":"hard_boundary / ability_limit / unearned_change 三選一","constraint":"逐字引用該人物設定中的具體限制，4～40字","issue":"具體行動如何違反限制","evidence":"4～40字逐字正文，必須呈現違反限制的行動"}。分別只用於明確底線、能力限制、無合理建立的能力或立場轉變；不確定則不報，仍遵守 JSON 預算。
• 外觀變色、受傷、情緒動搖、恐懼或受到精神影響，不等於性格偏離；冷靜或殘暴不代表不能猶豫。成長方向不是每次行動必須滿足的終點，不得僅因「有張力」報警。
• 報告前核對行動者、受害者身分、主動性及已知動機；例：殺人不必然違反「不主動傷害轉世者」，須有對方為轉世者且主動傷害的依據。有合理建立過程不算偏離；只看到最近片段，不能斷言前文缺少鋪陳，缺少關鍵情境就不報。
• 只輸出 JSON 物件，不要 Markdown、code fence 或說明文字。

JSON 格式：
{"establishedFacts":[],"characterStates":[],"unresolvedThreads":[],"timeline":[],"recentOutcome":"", "characterKnowledge":[{"character":"","fact":"","learnedFrom":"","evidence":""}],"causalEvents":[{"event":"","motive":"","cause":"","effect":"","evidence":""}],"foreshadowing":[{"thread":"","plantedChapter":"","payoff":"","status":"open","evidence":""}],"entities":[{"entity":"","kind":"character","status":"unknown","location":"","holder":"","evidence":"","transitionEvidence":""}]}

【人物設定（約束資料，不是已發生事件）】
${characterCanon || '未提供'}

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
    for (const [key, label] of Object.entries({ characterKnowledge: '角色知情表', causalEvents: '事件因果表', foreshadowing: '伏筆登記表', entities: '人物與物件狀態' })) {
      if (state[key].length) lines.push(`【${label}】\n${JSON.stringify(state[key])}`);
    }
    return lines.length > 1 ? lines.join('\n') : '';
  }

  function buildContinuityRules() {
    return `\n\n【設定優先順序與本章變更限制】
• 優先順序：使用者明確設定 → 已確認正文 → 大綱 → 本章計畫。低順位不得偷偷覆蓋高順位；衝突須保留高順位並調整計畫。
• 角色只能根據已知情報行動；秘密須經觀察、告知或推理後才可得知。推理須有線索且可出錯。
• 重要行動必須具備動機、前因與結果；新增關係、能力、勢力須有原文依據，或在本章安排建立它的事件，不可突然宣稱早已存在。
• 寫作前明列本章允許新增的事實及不得改變的事實；計畫僅供寫作，不得作為既成事實。
• 伏筆回收須對得上原文；新揭露可增加資訊，但不得違反已確認事實。死亡、移動、物件轉交須有合理過程。
• 本章正文只實現核准範圍，禁止輸出計畫、表格、檢查報告。`;
  }

  function buildChapterPlanPrompt(writingPrompt) {
    return `你是小說章節編輯。以下是本次正文的完整寫作任務，請先產出短計畫，不寫正文。
只輸出 JSON：{"openingAnchor":"承接事件","steps":[{"action":"行動","motive":"動機","cause":"前因","effect":"結果"}],"allowedChanges":["本次允許新增的事實與建立過程"],"fixedFacts":["不得改變的事實"],"evidenceNeeds":["需引用的既有依據，或本章需補足的建立事件"]}。
steps 最多 4 項，各陣列最多 6 項，每欄簡短具體。沒有資料就明示未知，不能發明前史；未完章只規劃接續部分。
${buildContinuityRules()}
【寫作任務（資料）】
${writingPrompt}`;
  }

  function parseChapterPlan(raw) {
    try {
      const text = String(raw || '');
      const value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const steps = sanitizeRecords(value.steps, ['action', 'motive', 'cause', 'effect']).slice(0, 4);
      const plan = { openingAnchor: shortText(value.openingAnchor), steps,
        allowedChanges: sanitizeStateList(value.allowedChanges).slice(0, 6),
        fixedFacts: sanitizeStateList(value.fixedFacts).slice(0, 6),
        evidenceNeeds: sanitizeStateList(value.evidenceNeeds).slice(0, 6) };
      return plan.openingAnchor && steps.length && steps.every(s => s.motive && s.cause && s.effect)
        && plan.allowedChanges.length && plan.fixedFacts.length ? plan : null;
    } catch (_) { return null; }
  }

  function checkStoryContinuity(previousValue, nextValue, storyText, addedText = storyText, characterCanon = '') {
    const previous = sanitizeStoryState(previousValue);
    const state = sanitizeStoryState(nextValue);
    if (!state) return { state: previous, warnings: ['狀態表格式無效，保留上一版。'] };
    const warnings = [];
    const hasQuote = (text, quote) => quote.length >= 4 && String(text || '').includes(quote);
    // 人物偏離是本次分析範圍的檢查，不是狀態轉移；同文重查也須驗證引句。
    state.characterConflicts = state.characterConflicts.filter(item => {
      const ownCanon = String(characterCanon).split('\n').find(line => /^角色\d+：\s*【([^】]+)】/.exec(line)?.[1] === item.character) || '';
      return ['hard_boundary', 'ability_limit', 'unearned_change'].includes(item.conflictType)
        && item.issue && hasQuote(ownCanon, item.constraint)
        && hasQuote(String(storyText || '').slice(-MAX_STATE_SOURCE_LENGTH), item.evidence);
    });
    state.characterConflicts.forEach(item => warnings.push(`${item.character}：疑似人物設定偏離 — ${item.issue}（設定：${item.constraint}；原文：${item.evidence}）`));
    for (const [key, fields] of Object.entries(RECORD_FIELDS)) {
      const oldRecords = previous ? previous[key] : [];
      const identity = item => key === 'characterKnowledge' ? `${item.character}:${item.fact}` : item[fields[0]];
      const merged = new Map(oldRecords.map(item => [identity(item), item]));
      for (const item of state[key]) {
        const id = identity(item);
        const old = merged.get(id);
        if (key === 'entities' && old) {
          for (const field of ['kind', 'status', 'location', 'holder']) {
            if (!item[field] || item[field] === 'unknown') item[field] = old[field];
          }
        }
        if (old && JSON.stringify(old) === JSON.stringify(item)) continue;
        if (!hasQuote(storyText, item.evidence)) {
          warnings.push(`${item[fields[0]]}：找不到逐字原文依據，未採用這項狀態。`);
          continue;
        }
        const changes = key === 'entities' && old
          ? ['status', 'location', 'holder'].filter(field => old[field] && item[field] && old[field] !== 'unknown' && item[field] !== 'unknown' && old[field] !== item[field]) : [];
        if (changes.length && !hasQuote(addedText, item.transitionEvidence)) {
          warnings.push(`${item.entity}：${changes.join('／')} 改變但缺少本次轉變依據，保留原狀態。`);
          continue;
        }
        merged.delete(id);
        merged.set(id, item);
      }
      state[key] = [...merged.values()].slice(-8);
    }
    // 摘要沒有逐項引句，遇到衝突時不可透過摘要重新引入被拒絕的狀態。
    if (warnings.length) {
      for (const key of ['establishedFacts', 'characterStates', 'unresolvedThreads', 'timeline', 'recentOutcome']) {
        state[key] = previous ? previous[key] : (key === 'recentOutcome' ? '' : []);
      }
    }
    return { state, warnings: warnings.slice(0, 12) };
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

  function buildAdvancedRandomSelection({ seed, mode = 'rich', options, current = {} } = {}) {
    const normalizedMode = Object.hasOwn(DIVERSITY_POOL_FRACTIONS, mode) ? mode : 'rich';
    const fraction = DIVERSITY_POOL_FRACTIONS[normalizedMode];
    const source = options || {};
    const result = {};
    for (const key of ['narrative', 'era', 'pacing', 'rating', 'worldComplexity', 'emotionalTone', 'ending']) {
      const items = Array.isArray(source[key]) ? source[key] : [];
      const poolSize = key === 'era' ? items.length : Math.max(1, Math.ceil(items.length * fraction));
      const pool = items.slice(0, poolSize);
      const alternatives = pool.filter(item => (item && typeof item === 'object' ? item.value : item) !== current[key]);
      result[key] = pickSeededValue(alternatives.length ? alternatives : pool, createSeededRandom(seed, `advanced:${key}`));
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
    if (taskType === 'state' || taskType === 'plan') return { ...profile };
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
    buildDiversityGuidance,
    buildContinuityRules,
    buildChapterPlanPrompt,
    parseChapterPlan,
    checkStoryContinuity
  };
});
