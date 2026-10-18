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
  // 全書因果要靠舊紀錄：表格保留較多筆；未回收的伏筆全部保留（上限 40），已回收的只留最近幾筆。
  const RECORD_LIMITS = Object.freeze({ characterKnowledge: 16, causalEvents: 16, foreshadowing: 24, entities: 24 });
  const MAX_OPEN_FORESHADOWING = 40;
  function keepRecords(key, records) {
    const limit = RECORD_LIMITS[key] || 8;
    if (key !== 'foreshadowing') return records.slice(-limit);
    const open = records.filter(item => item.status !== 'resolved').slice(-MAX_OPEN_FORESHADOWING);
    const resolved = records.filter(item => item.status === 'resolved');
    const keep = new Set([...open, ...resolved.slice(-Math.max(4, limit - open.length))]);
    return records.filter(item => keep.has(item));
  }

  // 全書章記：每章一則「前因→事件→結果」，寫新章時依章序帶入，前面章節的因果才不會被遺忘。
  const MAX_CHAPTER_NOTE_LENGTH = 120;
  const CHAPTER_NOTES_BUDGET = 4000;
  function mergeChapterNotes(previous, next) {
    const notes = new Map();
    for (const item of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(next) ? next : [])]) {
      const chapter = Number.parseInt(item && item.chapter, 10);
      const note = item && typeof item.note === 'string' ? item.note.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAPTER_NOTE_LENGTH) : '';
      if (chapter >= 1 && note) notes.set(chapter, note);
    }
    return [...notes].sort((a, b) => a[0] - b[0]).map(([chapter, note]) => ({ chapter, note }));
  }
  function parseChapterNotes(rawText, maxChapter) {
    const raw = String(rawText || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    try {
      const value = JSON.parse(raw.slice(start, end + 1));
      const limit = Number.parseInt(maxChapter, 10) || 0;
      return mergeChapterNotes([], Array.isArray(value.chapterNotes) ? value.chapterNotes : [])
        .filter(item => !limit || item.chapter <= limit);
    } catch (_) {
      return [];
    }
  }
  function formatChapterNotesGuidance(value, budget = CHAPTER_NOTES_BUDGET) {
    const notes = mergeChapterNotes(value, []);
    if (!notes.length) return '';
    // 太長時從最早的章開始縮短，最近 5 章保留完整
    let shortLength = MAX_CHAPTER_NOTE_LENGTH;
    const render = () => notes.map((item, i) => `第${item.chapter}章：${i < notes.length - 5 && item.note.length > shortLength ? item.note.slice(0, shortLength) + '…' : item.note}`).join('\n');
    let text = render();
    while (text.length > budget && shortLength > 24) {
      shortLength -= 12;
      text = render();
    }
    return `\n\n【全書章記（已寫章節的前因與結果，依章序）】\n${text}\n• 新章節的事件須能由上列前因推得；已發生的結果與人物動機不得推翻，已回收的伏筆不重複回收。`;
  }

  // ③ 全書因果審查：逐批送出整本正文，補建章記並列出跨章矛盾；只報告，不改寫。
  const AUDIT_HEADING_RE = /^\s*#{0,4}\s*(?:第\s*([一二三四五六七八九十百千萬零〇兩壹貳參肆伍陸柒捌玖拾佰仟\d]+)\s*[章回]|Chapter\s*(\d+))[^\n]*$/gim;
  const AUDIT_BATCH_CHARS = 12000;
  const AUDIT_CHAPTER_CHARS = 20000;
  const AUDIT_MAX_TOKENS = 3000;
  const AUDIT_SEVERITIES = ['high', 'medium', 'low'];
  const CHINESE_DIGITS = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 兩: 2, 貳: 2, 三: 3, 參: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陸: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
  const CHINESE_UNITS = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 萬: 10000 };

  function parseChapterNumber(token) {
    const text = String(token || '').trim();
    if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
    let total = 0;
    let digit = 0;
    for (const char of text) {
      if (Object.hasOwn(CHINESE_DIGITS, char)) digit = CHINESE_DIGITS[char];
      else if (Object.hasOwn(CHINESE_UNITS, char)) {
        total += (digit || 1) * CHINESE_UNITS[char];
        digit = 0;
      } else return 0;
    }
    return total + digit;
  }

  function splitStoryChapters(storyText) {
    const story = String(storyText || '');
    const headings = [];
    AUDIT_HEADING_RE.lastIndex = 0;
    let match;
    while ((match = AUDIT_HEADING_RE.exec(story)) !== null) {
      headings.push({ index: match.index, number: parseChapterNumber(match[1] || match[2]) });
    }
    if (!headings.length) return story.trim() ? [{ chapter: 1, text: story.trim() }] : [];
    let last = 0;
    return headings.map((heading, i) => {
      // 章號重複或倒退（例如新的一集重新編號）時改用順序號，章記才不會互相覆蓋。
      const chapter = heading.number > last ? heading.number : last + 1;
      last = chapter;
      return { chapter, text: story.slice(heading.index, i + 1 < headings.length ? headings[i + 1].index : story.length).trim() };
    }).filter(item => item.text);
  }

  function trimAuditChapter(text, limit = AUDIT_CHAPTER_CHARS) {
    if (text.length <= limit) return text;
    const half = Math.floor(limit / 2);
    return `${text.slice(0, half)}\n……（中段略，未送審）……\n${text.slice(-half)}`;
  }

  function planCausalAuditBatches(chapters, maxChars = AUDIT_BATCH_CHARS) {
    const batches = [];
    let current = null;
    for (const item of Array.isArray(chapters) ? chapters : []) {
      const text = trimAuditChapter(String(item.text || ''));
      if (!current || current.length + text.length > maxChars) {
        current = { chapters: [], length: 0 };
        batches.push(current);
      }
      current.chapters.push({ chapter: item.chapter, text });
      current.length += text.length;
    }
    return batches.map(batch => ({
      from: batch.chapters[0].chapter,
      to: batch.chapters.at(-1).chapter,
      chapters: batch.chapters.map(item => item.chapter),
      parts: batch.chapters,
      text: batch.chapters.map(item => item.text).join('\n\n'),
      length: batch.length
    }));
  }

  // 本機情境估算，不是 tokenizer：中文約 1 字 ≈ 1 token，另加章記、狀態表與指示。
  function estimateCausalAuditCost(batches, pricing, date = new Date()) {
    const list = Array.isArray(batches) ? batches : [];
    const cost = (prompt, completion) => pricing.calculateUsageCost({ prompt_tokens: prompt, completion_tokens: completion }, 'deepseek-flash', date);
    let low = 0;
    let high = 0;
    list.forEach((batch, i) => {
      const context = Math.min(CHAPTER_NOTES_BUDGET, i * 400);
      low += cost(Math.round(batch.length * 0.7) + 1500 + context, 600);
      high += cost(Math.round(batch.length * 1.3) + 6000 + context, AUDIT_MAX_TOKENS);
    });
    return { requests: list.length, low, high };
  }

  function buildCausalAuditPrompt({ batch, priorNotes = [], storyState = null, characterCanon = '' } = {}) {
    const notes = mergeChapterNotes(priorNotes, []).filter(item => item.chapter < batch.from);
    const state = sanitizeStoryState(storyState);
    const tables = state ? Object.fromEntries(Object.keys(RECORD_FIELDS).map(key => [key, state[key]]).filter(([, value]) => value.length)) : {};
    return `你是長篇小說的因果審查編輯。請審查「本批正文」（第${batch.from}～${batch.to}章），完成兩件事：
1. chapterNotes：為本批每一章各寫一則章記（chapter 用阿拉伯數字：${batch.chapters.join('、')}）。note 最多 80 字，依序寫「前因 → 本章關鍵事件 → 結果與改變了什麼」，只寫正文已發生的事。
2. contradictions：找出本批正文與「前面章節章記」或本批其他章節之間的因果矛盾。

矛盾判準：
• 只報明確推翻已發生事實的情況：死者再度出現且無交代、物件持有人或地點無故改變、角色得知未曾得知的秘密、時間線倒錯、人物動機前後相反且無轉折。
• 新揭密、伏筆回收、角色說謊或誤會、合理的成長轉變，都不算矛盾。不確定就不報。
• 「全書狀態表」是全書寫完後的最新狀態；早期章節與它不同可能只是事情尚未發生，不能據此報矛盾。
• quote 必須逐字引用本批正文中造成矛盾的連續原文（4～40字），不可改寫或加省略號。
• against 寫被推翻的前文事實（引用章記或本批前段原文，最多 60 字）；conflictsWith 為該事實所在章號。
• severity：high＝推翻關鍵事實（生死、身分、主線因果）；medium＝動機、知情或時間線不合；low＝細節不一致。
• 最多 8 項，依嚴重度排序。沒有矛盾就輸出空陣列。
• 只輸出 JSON 物件，不要 Markdown、code fence 或說明文字；必須保留結尾括號。

JSON 格式：
{"chapterNotes":[{"chapter":${batch.from},"note":""}],"contradictions":[{"chapter":${batch.from},"conflictsWith":1,"severity":"medium","issue":"","quote":"","against":""}]}

【人物設定（約束資料，不是已發生事件）】
${characterCanon || '未提供'}

【前面章節章記（依章序）】
${notes.length ? notes.map(item => `第${item.chapter}章：${item.note}`).join('\n') : '無（本批是開頭）'}

【全書狀態表（最新狀態，僅供參考）】
${Object.keys(tables).length ? JSON.stringify(tables) : '無'}

【本批正文】
${batch.text}`;
  }

  function parseCausalAuditResult(rawText, batch) {
    const raw = String(rawText || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let value;
    try { value = JSON.parse(raw.slice(start, end + 1)); } catch (_) { return null; }
    if (!value || typeof value !== 'object') return null;
    const inBatch = new Set(batch.chapters);
    const chapterNotes = mergeChapterNotes([], Array.isArray(value.chapterNotes) ? value.chapterNotes : [])
      .filter(item => inBatch.has(item.chapter));
    let rejected = 0;
    const contradictions = [];
    for (const item of Array.isArray(value.contradictions) ? value.contradictions : []) {
      if (!item || typeof item !== 'object') continue;
      const chapter = Number.parseInt(item.chapter, 10);
      const conflictsWith = Number.parseInt(item.conflictsWith, 10);
      const quote = shortText(item.quote, 60);
      const issue = shortText(item.issue, 160);
      // 引句須逐字出現在本批正文、且在指稱的章內；找不到就不採用，避免模型捏造矛盾。
      const part = Array.isArray(batch.parts) ? batch.parts.find(entry => entry.chapter === chapter) : null;
      const chapterText = part ? part.text : batch.text;
      if (!inBatch.has(chapter) || !issue || quote.length < 4 || !chapterText.includes(quote)
          || !(conflictsWith >= 1) || conflictsWith > batch.to) {
        rejected++;
        continue;
      }
      contradictions.push({
        chapter, conflictsWith, issue, quote,
        against: shortText(item.against, 120),
        severity: AUDIT_SEVERITIES.includes(item.severity) ? item.severity : 'medium'
      });
    }
    return { chapterNotes, contradictions: contradictions.slice(0, 8), rejected };
  }

  function sortAuditContradictions(items) {
    return (Array.isArray(items) ? items : []).slice()
      .sort((a, b) => AUDIT_SEVERITIES.indexOf(a.severity) - AUDIT_SEVERITIES.indexOf(b.severity) || a.chapter - b.chapter);
  }

  function formatCausalAuditReport(audit) {
    if (!audit || typeof audit !== 'object') return '';
    const labels = { high: '嚴重', medium: '中度', low: '輕微' };
    const items = sortAuditContradictions(audit.contradictions);
    const failed = Array.isArray(audit.failedBatches) ? audit.failedBatches : [];
    const done = Number(audit.completedBatches) || 0;
    const total = Number(audit.totalBatches) || 0;
    const lines = [`全書因果審查${audit.status === 'stopped' ? '（已中途停止）' : audit.status === 'running' ? '（進行中）' : ''}：完成 ${done}/${total} 批，涵蓋第 ${audit.from || 1}～${audit.to || 0} 章；只報告，不改寫正文。`];
    lines.push(items.length ? `發現 ${items.length} 項疑似因果矛盾（依嚴重度排序，仍需對照情境判斷）：` : '未發現明確的跨章因果矛盾：僅代表 AI 審查未找到有原文依據的衝突，不保證全文無誤。');
    for (const item of items) {
      lines.push(`• 【${labels[item.severity] || '中度'}】第${item.chapter}章 與 第${item.conflictsWith}章 矛盾：${item.issue}\n  引句：「${item.quote}」${item.against ? `\n  前文：${item.against}` : ''}`);
    }
    if (failed.length) lines.push(`未完成批次：${failed.map(item => `第${item.from}～${item.to}章（${item.reason}）`).join('；')}。可再次執行審查補齊。`);
    if (audit.rejected) lines.push(`另有 ${audit.rejected} 項 AI 回報因引句無法在正文逐字找到，未採用。`);
    if (audit.notedChapters) lines.push(`已補建 ${audit.notedChapters} 章章記，續寫與狀態整理會沿用。`);
    return lines.join('\n');
  }

  function shortText(value, limit = 180) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function sanitizeRecords(value, fields) {
    if (!Array.isArray(value)) return [];
    // 上一版狀態也會經過這裡：只留前 8 筆會在每次合併時丟掉舊紀錄，改成保留最近 48 筆（實際上限見 RECORD_LIMITS）
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .slice(-48)
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

  function buildStoryStatePrompt({ previousState, storyText, chapterCount, characterCanon = '', previousIssues = [], notedChapters = [] } = {}) {
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
• chapterNotes 是全書章記：為「最近已寫正文」裡的每一章各寫一則（chapter 用阿拉伯數字，依正文章名；含最後一章）。note 最多 80 字，依序寫「前因 → 本章關鍵事件 → 結果與改變了什麼」，只寫正文已發生的事。「已有章記的章節」若本次正文沒有改寫它，就不用再寫。
• 整份 JSON（含 chapterNotes）以 2,000 字元以內為目標；超出時先減少表格筆數，章記優先保留，必須保留結尾括號，不可輸出半份 JSON。
• characterKnowledge 記錄誰知道什麼、透過誰或哪個事件得知；讀者知道不代表角色知道。
• causalEvents 記錄事件、人物動機、前因與結果；沒有依據的關聯不可當成事實。
• foreshadowing 記錄伏筆、埋設章節、預計回收位置與 open/resolved 狀態；預計回收不是已發生事件。
• entities 使用穩定名稱；kind 為 character/item，角色 status 為 alive/dead/unknown，並記錄目前 location；物件記錄 holder。
• evidence 必須逐字引用提供的正文（4～40字）；舊紀錄可沿用。位置、持有人、生死改變時，transitionEvidence 必須逐字引用本次新增正文中造成轉變的事件，不能只重複結果。
• 引句須為連續原文，不可合併不同句子、改寫同義字或自行加入省略號；引用缺漏只是摘要更新不完整，不可因此宣稱正文矛盾。
• 不確定時用空字串或 unknown；不要猜測。新揭密不等於矛盾，但不能推翻已確認事實。
• 對照人物設定檢查能力代價、信念底線與漸進成長；設定是約束，不代表轉變已發生。characterStates 摘要目前傷勢、關係、成長進度，不覆寫初始設定。
• characterConflicts 最多 3 項，每項 {"character":"設定中的人物名","conflictType":"hard_boundary / ability_limit / unearned_change 三選一","constraint":"逐字引用該人物設定中的具體限制，4～40字","issue":"具體行動如何違反限制","evidence":"4～40字逐字正文，必須呈現違反限制的行動"}。分別只用於明確底線、能力限制、無合理建立的能力或立場轉變；不確定則不報，仍遵守 JSON 預算。
• 外觀變色、受傷、情緒動搖、恐懼或受到精神影響，不等於性格偏離；冷靜或殘暴不代表不能猶豫。成長方向不是每次行動必須滿足的終點，不得僅因「有張力」報警。
• 報告前核對行動者、受害者身分、主動性及已知動機；例：殺人不必然違反「不主動傷害轉世者」，須有對方為轉世者且主動傷害的依據。有合理建立過程不算偏離；只看到最近片段，不能斷言前文缺少鋪陳，缺少關鍵情境就不報。
• 只輸出 JSON 物件，不要 Markdown、code fence 或說明文字。

JSON 格式：
{"establishedFacts":[],"characterStates":[],"unresolvedThreads":[],"timeline":[],"recentOutcome":"","chapterNotes":[{"chapter":1,"note":""}], "characterKnowledge":[{"character":"","fact":"","learnedFrom":"","evidence":""}],"causalEvents":[{"event":"","motive":"","cause":"","effect":"","evidence":""}],"foreshadowing":[{"thread":"","plantedChapter":"","payoff":"","status":"open","evidence":""}],"entities":[{"entity":"","kind":"character","status":"unknown","location":"","holder":"","evidence":"","transitionEvidence":""}]}

【人物設定（約束資料，不是已發生事件）】
${characterCanon || '未提供'}

目前已完成章節：約 ${Number.parseInt(chapterCount, 10) || 0} 章
已有章記的章節：${notedChapters.length ? notedChapters.join('、') : '無'}

【上一版狀態表】
${JSON.stringify(previous)}

【上一版待確認項目（保留值不是確定現況；須用正文引句修正，不得補造情節）】
${JSON.stringify(getContinuityIssues([], previousIssues))}

【最近已寫正文】
${recentStory}`;
  }

  function formatStoryStateGuidance(value, { issues = [] } = {}) {
    const state = sanitizeStoryState(value);
    if (!state) return '';
    if (issues.length) {
      const uncertain = new Set(issues.map(issue => issue.entity).filter(Boolean));
      for (const [key, fields] of Object.entries(RECORD_FIELDS)) {
        state[key] = state[key].filter(item => !uncertain.has(item[fields[0]]));
      }
      // 舊版摘要沒有逐項依據；僅注入仍有效表格中的原文，避免把保留的舊地點當成現況。
      const quotes = new Set(Object.keys(RECORD_FIELDS).flatMap(key => state[key].flatMap(item => [item.evidence, item.transitionEvidence])).filter(Boolean));
      for (const key of ['establishedFacts', 'characterStates', 'unresolvedThreads', 'timeline']) state[key] = state[key].filter(text => quotes.has(text));
      if (!quotes.has(state.recentOutcome)) state.recentOutcome = '';
    }
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

  function getContinuityIssues(warnings = [], issues) {
    const valid = Array.isArray(issues) ? issues.filter(issue => issue && typeof issue.message === 'string').map(issue => ({
      ...issue, category: ['extraction', 'conflict', 'review'].includes(issue.category) ? issue.category : 'review'
    })) : [];
    if (valid.length) return valid;
    return (Array.isArray(warnings) ? warnings : []).filter(message => typeof message === 'string').map(message => ({
      category: /找不到逐字原文依據|缺少本次轉變依據|狀態表格式無效/.test(message) ? 'extraction' : /疑似人物設定偏離/.test(message) ? 'conflict' : 'review',
      entity: message.split('：')[0], code: 'legacy', message
    }));
  }

  function checkStoryContinuity(previousValue, nextValue, storyText, addedText = storyText, characterCanon = '', previousIssues = []) {
    const previous = sanitizeStoryState(previousValue);
    const state = sanitizeStoryState(nextValue);
    if (!state) {
      const warnings = ['狀態表格式無效，保留上一版。'];
      return { state: previous, warnings, issues: getContinuityIssues(warnings) };
    }
    const warnings = [];
    const issues = [];
    const acceptedQuotes = [];
    const pending = getContinuityIssues([], previousIssues).filter(issue => issue.category === 'extraction');
    const resolved = new Set();
    const matchesRecord = (issue, table, item, id) => (!issue.table || issue.table === table)
      && issue.entity === item[RECORD_FIELDS[table][0]] && (!issue.recordId || issue.recordId === id);
    const report = (category, code, table, entity, message, recordId) => {
      warnings.push(message);
      issues.push({ category, code, table, entity, message, recordId });
    };
    const hasQuote = (text, quote) => typeof quote === 'string' && quote.length >= 4 && String(text || '').includes(quote);
    // 人物偏離是本次分析範圍的檢查，不是狀態轉移；同文重查也須驗證引句。
    state.characterConflicts = state.characterConflicts.filter(item => {
      const ownCanon = String(characterCanon).split('\n').find(line => /^角色\d+：\s*【([^】]+)】/.exec(line)?.[1] === item.character) || '';
      return ['hard_boundary', 'ability_limit', 'unearned_change'].includes(item.conflictType)
        && item.issue && hasQuote(ownCanon, item.constraint)
        && hasQuote(String(storyText || '').slice(-MAX_STATE_SOURCE_LENGTH), item.evidence);
    });
    state.characterConflicts.forEach(item => report('conflict', 'character_conflict', 'characterConflicts', item.character,
      `${item.character}：疑似人物設定偏離 — ${item.issue}（設定：${item.constraint}；原文：${item.evidence}）`));
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
          report('extraction', 'missing_quote', key, item[fields[0]],
            `${item[fields[0]]}：找不到逐字原文依據，未採用這項狀態。（AI 提供的引句：${item.evidence || '未提供'}）`, id);
          continue;
        }
        const changes = key === 'entities' && old
          ? ['status', 'location', 'holder'].filter(field => old[field] && item[field] && old[field] !== 'unknown' && item[field] !== 'unknown' && old[field] !== item[field]) : [];
        if (changes.length && !hasQuote(addedText, item.transitionEvidence)) {
          const labels = { status: '生死狀態', location: '地點', holder: '持有人' };
          const changeText = changes.map(field => `${labels[field]}：${old[field]} → ${item[field]}`).join('；');
          report('extraction', 'missing_transition', key, item.entity,
            `${item.entity}：${changeText}；改變但缺少本次轉變依據，保留原狀態供對照，現況待確認。\n結果引句：${item.evidence}；轉變引句：${item.transitionEvidence || '未提供'}。`, id);
          continue;
        }
        for (const issue of pending) {
          const needsTransition = issue.code === 'missing_transition' || issue.message.includes('缺少本次轉變依據');
          if (matchesRecord(issue, key, item, id) &&
              (!needsTransition || hasQuote(addedText, item.transitionEvidence))) resolved.add(issue);
        }
        merged.delete(id);
        merged.set(id, item);
        acceptedQuotes.push(item.transitionEvidence && hasQuote(addedText, item.transitionEvidence) ? item.transitionEvidence : item.evidence);
      }
      state[key] = keepRecords(key, [...merged.values()]);
    }
    // 模型省略或重複舊紀錄不等於解決問題；只保留仍有對應狀態的待確認標記。
    for (const issue of pending) {
      const retained = Object.entries(RECORD_FIELDS).some(([key]) => state[key].some(item =>
        matchesRecord(issue, key, item, key === 'characterKnowledge' ? `${item.character}:${item.fact}` : item[RECORD_FIELDS[key][0]])));
      if (!resolved.has(issue) && retained && !issues.some(current => current.category === 'extraction' && current.code === issue.code && current.entity === issue.entity && current.table === issue.table && current.recordId === issue.recordId)) {
        issues.push(issue);
        warnings.push(issue.message);
      }
    }
    // 部分紀錄失敗時，以已驗證表格原文更新摘要，不採用可能重新引入拒絕內容的自由摘要。
    if (warnings.length) {
      const uncertain = new Set(issues.map(issue => issue.entity));
      const quotesFor = key => [...new Set(state[key].filter(item => !uncertain.has(item[RECORD_FIELDS[key][0]]) && (key !== 'foreshadowing' || item.status !== 'resolved')).map(item => item.evidence).filter(Boolean))].slice(-MAX_STATE_ITEMS);
      state.establishedFacts = previous ? previous.establishedFacts : [];
      state.characterStates = quotesFor('entities');
      state.unresolvedThreads = quotesFor('foreshadowing');
      state.timeline = quotesFor('causalEvents');
      state.recentOutcome = acceptedQuotes.at(-1) || '';
    }
    return { state, warnings: warnings.slice(0, 12), issues };
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
    parseChapterNotes,
    mergeChapterNotes,
    formatChapterNotesGuidance,
    buildStoryStatePrompt,
    formatStoryStateGuidance,
    createStoryFingerprint,
    createSeededRandom,
    buildAdvancedRandomSelection,
    buildDiversityGuidance,
    buildContinuityRules,
    buildChapterPlanPrompt,
    parseChapterPlan,
    checkStoryContinuity,
    getContinuityIssues,
    parseChapterNumber,
    splitStoryChapters,
    planCausalAuditBatches,
    estimateCausalAuditCost,
    buildCausalAuditPrompt,
    parseCausalAuditResult,
    formatCausalAuditReport
  };
});
