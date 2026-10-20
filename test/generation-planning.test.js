const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let planning = {};
try {
  planning = require(path.join(__dirname, '..', 'public', 'js', 'generation-planning.js'));
} catch (_) {
  // RED 階段：模組尚未建立時，以下介面斷言會明確失敗。
}

const sampleOutline = `【各章節大綱】
第1章：雨夜來客
主角收到一封沒有署名的信。

### 第2章：封鎖的月台
主角追查寄件地，第一次與守門人衝突。
結尾發現信封上的家徽。

第3章：舊宅回聲
家徽指向失蹤多年的家族。

【核心衝突設計】
真相與親情的拉扯。`;

test('extractChapterOutline 只取指定章節的大綱區塊', () => {
  assert.equal(typeof planning.extractChapterOutline, 'function');
  const result = planning.extractChapterOutline(sampleOutline, 2);

  assert.match(result, /第2章：封鎖的月台/);
  assert.match(result, /第一次與守門人衝突/);
  assert.doesNotMatch(result, /第1章|第3章|核心衝突設計/);
});

test('buildChapterOutlineGuidance 將指定章節轉成續寫任務', () => {
  assert.equal(typeof planning.buildChapterOutlineGuidance, 'function');
  const result = planning.buildChapterOutlineGuidance(sampleOutline, 2);

  assert.match(result, /【本章大綱任務：第2章】/);
  assert.match(result, /封鎖的月台/);
  assert.match(result, /只完成本章範圍/);
  assert.doesNotMatch(result, /雨夜來客|舊宅回聲/);
});

test('無法解析指定章節時保留精簡的全書大綱作為回退', () => {
  assert.equal(typeof planning.buildChapterOutlineGuidance, 'function');
  const result = planning.buildChapterOutlineGuidance('主角尋找失落王國，最後必須回到故鄉。', 4);

  assert.match(result, /【全書大綱參考：目前續寫第4章】/);
  assert.match(result, /失落王國/);
});

test('不同生成任務使用不同溫度且不再同時指定 top_p', () => {
  assert.equal(typeof planning.getSamplingProfile, 'function');
  const story = planning.getSamplingProfile('story');
  const continuation = planning.getSamplingProfile('continuation');
  const outline = planning.getSamplingProfile('outline');

  assert.ok(outline.temperature < continuation.temperature);
  assert.ok(continuation.temperature < story.temperature);
  assert.equal(Object.hasOwn(story, 'top_p'), false);
  assert.equal(Object.hasOwn(continuation, 'top_p'), false);
  assert.equal(Object.hasOwn(outline, 'top_p'), false);
});

test('未知任務回退到穩定的通用生成參數', () => {
  assert.deepEqual(planning.getSamplingProfile('unknown-task'), {
    temperature: 0.75,
    frequency_penalty: 0.3
  });
});

test('故事狀態 JSON 會去除 code fence 並限制欄位長度', () => {
  assert.equal(typeof planning.parseStoryState, 'function');
  const parsed = planning.parseStoryState(`\`\`\`json
  {
    "establishedFacts": ["港口已封鎖", "${'過'.repeat(300)}"],
    "characterStates": ["阿澄受傷但仍在行動"],
    "unresolvedThreads": ["匿名信的寄件者"],
    "timeline": ["第三天夜晚抵達港口"],
    "recentOutcome": "主角取得家徽"
  }
  \`\`\``);

  assert.equal(parsed.establishedFacts.length, 2);
  assert.equal(parsed.establishedFacts[1].length, 240);
  assert.deepEqual(parsed.unresolvedThreads, ['匿名信的寄件者']);
  assert.equal(parsed.recentOutcome, '主角取得家徽');
});

test('無效故事狀態不會污染續寫', () => {
  assert.equal(planning.parseStoryState('不是 JSON'), null);
  assert.equal(planning.formatStoryStateGuidance(null), '');
});

test('故事狀態提示只保留最近正文並要求純 JSON', () => {
  assert.equal(typeof planning.buildStoryStatePrompt, 'function');
  const prompt = planning.buildStoryStatePrompt({
    previousState: { establishedFacts: ['城門已關閉'] },
    storyText: `${'舊'.repeat(13000)}最近章節內容`,
    chapterCount: 3
  });

  assert.match(prompt, /只輸出 JSON 物件/);
  assert.match(prompt, /城門已關閉/);
  assert.match(prompt, /最近章節內容/);
  assert.doesNotMatch(prompt, /^舊{1000}/);
});

test('格式化後的故事狀態可直接注入續寫 prompt', () => {
  const guidance = planning.formatStoryStateGuidance({
    establishedFacts: ['港口已封鎖'],
    characterStates: ['阿澄左臂受傷'],
    unresolvedThreads: ['寄件者身分未明'],
    timeline: ['第三天夜晚'],
    recentOutcome: '取得家徽'
  });

  assert.match(guidance, /【已確認故事狀態（不得矛盾）】/);
  assert.match(guidance, /港口已封鎖/);
  assert.match(guidance, /寄件者身分未明/);
});

test('故事指紋可避免同一正文重複整理狀態', () => {
  assert.equal(typeof planning.createStoryFingerprint, 'function');
  assert.equal(planning.createStoryFingerprint('同一篇故事'), planning.createStoryFingerprint('同一篇故事'));
  assert.notEqual(planning.createStoryFingerprint('故事甲'), planning.createStoryFingerprint('故事乙'));
});

test('狀態整理使用最低溫度的獨立生成參數', () => {
  const state = planning.getSamplingProfile('state');
  const outline = planning.getSamplingProfile('outline');

  assert.ok(state.temperature < outline.temperature);
  assert.equal(Object.hasOwn(state, 'top_p'), false);
});

test('相同種子與子領域會產生相同亂數序列', () => {
  assert.equal(typeof planning.createSeededRandom, 'function');
  const first = planning.createSeededRandom('my-story', 'advanced');
  const second = planning.createSeededRandom('my-story', 'advanced');

  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

test('不同子領域不會因點擊順序共用亂數狀態', () => {
  const story = planning.createSeededRandom('my-story', 'story');
  const advanced = planning.createSeededRandom('my-story', 'advanced');

  assert.notEqual(story(), advanced());
});

test('穩定模式只從基礎區段挑選，時代仍保留完整範圍', () => {
  assert.equal(typeof planning.buildAdvancedRandomSelection, 'function');
  const makeOptions = (prefix) => Array.from({ length: 20 }, (_, index) => ({ value: `${prefix}-${index}` }));
  const options = {
    narrative: makeOptions('narrative'),
    era: makeOptions('era'),
    pacing: makeOptions('pacing'),
    rating: makeOptions('rating'),
    worldComplexity: makeOptions('world'),
    emotionalTone: makeOptions('tone'),
    ending: makeOptions('ending')
  };
  const selection = planning.buildAdvancedRandomSelection({ seed: 'stable-seed', mode: 'stable', options });

  assert.ok(options.narrative.slice(0, 5).some((item) => item.value === selection.narrative));
  assert.ok(options.pacing.slice(0, 5).some((item) => item.value === selection.pacing));
  assert.ok(options.era.some((item) => item.value === selection.era));
});

test('同一種子可重現整組進階設定', () => {
  const makeOptions = (prefix) => Array.from({ length: 8 }, (_, index) => ({ value: `${prefix}-${index}` }));
  const options = Object.fromEntries(
    ['narrative', 'era', 'pacing', 'rating', 'worldComplexity', 'emotionalTone', 'ending']
      .map((key) => [key, makeOptions(key)])
  );

  const first = planning.buildAdvancedRandomSelection({ seed: 'repeatable', mode: 'rich', options });
  const second = planning.buildAdvancedRandomSelection({ seed: 'repeatable', mode: 'rich', options });
  assert.deepEqual(first, second);
});

test('進階重抽避開目前選項但不超出創意幅度範圍', () => {
  const keys = ['narrative', 'era', 'pacing', 'rating', 'worldComplexity', 'emotionalTone', 'ending'];
  const options = Object.fromEntries(keys.map(key => [key, Array.from({ length: 8 }, (_, i) => ({ value: `${key}-${i}` }))]));
  for (const mode of ['stable', 'rich', 'experimental']) {
    let current = planning.buildAdvancedRandomSelection({ seed: 'repeatable', mode, options });
    for (let i = 0; i < 5; i++) {
      const next = planning.buildAdvancedRandomSelection({ seed: 'repeatable', mode, options, current });
      assert.deepEqual(next, planning.buildAdvancedRandomSelection({ seed: 'repeatable', mode, options, current }));
      for (const key of keys) {
        assert.notEqual(next[key], current[key]);
        const limit = key === 'era' ? 8 : Math.ceil(8 * ({ stable: 0.25, rich: 0.65, experimental: 1 })[mode]);
        assert.ok(options[key].slice(0, limit).some(item => item.value === next[key]));
      }
      current = next;
    }
  }
});

test('進階重抽允許單一選項保持不變並處理空選項', () => {
  const selection = planning.buildAdvancedRandomSelection({ seed: 'single', mode: 'stable', options: { narrative: [{ value: 'only' }, { value: 'outside' }], era: ['only'] }, current: { narrative: 'only', era: 'only' } });
  assert.equal(selection.narrative, 'only');
  assert.equal(selection.era, 'only');
  assert.equal(selection.ending, '');
});

test('創意幅度會調整正文溫度但不影響狀態整理', () => {
  const stable = planning.getSamplingProfile('story', 'stable');
  const rich = planning.getSamplingProfile('story', 'rich');
  const experimental = planning.getSamplingProfile('story', 'experimental');

  assert.ok(stable.temperature < rich.temperature);
  assert.ok(rich.temperature < experimental.temperature);
  assert.deepEqual(planning.getSamplingProfile('state', 'stable'), planning.getSamplingProfile('state', 'experimental'));
});

test('多樣性提示清楚標示可變範圍與不可破壞的故事契約', () => {
  assert.equal(typeof planning.buildDiversityGuidance, 'function');
  const guidance = planning.buildDiversityGuidance('experimental', 'seed-42');

  assert.match(guidance, /【創意幅度：實驗】/);
  assert.match(guidance, /可使用非線性/);
  assert.match(guidance, /不得破壞人物動機/);
  assert.doesNotMatch(guidance, /seed-42/);
});

test('工作坊依序載入規劃模組並快取到新版離線殼層', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

  assert.match(html, /generation-planning\.js[\s\S]*app\.js/);
  assert.match(sw, /const CACHE_VERSION\s*=\s*'v128'/);
  assert.match(sw, /\.\/js\/generation-planning\.js/);
});

test('小說正文、續寫、大綱與書名都標記生成任務類型', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /getSamplingProfile\(options\.taskType, options\.diversityMode\)/);
  assert.doesNotMatch(app, /requestBody\.top_p\s*=/);
  assert.match(app, /taskType:\s*'story'/);
  assert.match(app, /taskType:\s*'continuation'/);
  assert.match(app, /taskType:\s*'outline'/);
  assert.match(app, /taskType:\s*'title'/);
});

test('續寫 prompt 注入目前章節的大綱任務', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /buildChapterOutlineGuidance\(activeOutline, continuationChapterNumber\)/);
  assert.match(app, /\$\{chapterOutlineGuidance\}/);
});

test('完成章節後以 Flash 更新狀態表並在下一次續寫注入', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /const STORY_STATE_STORAGE_KEY\s*=\s*'novelStoryStateLedger'/);
  assert.match(app, /taskType:\s*'state'/);
  assert.match(app, /maxTokens:\s*3000/);
  assert.match(app, /getStoryStateGuidance\(latestStory, relevantText\)/);
  assert.match(app, /getPriorTextGuidance\(latestStory, latestStory\.length - storyContext\.length, relevantText\)/);
  assert.match(app, /\$\{storyStateGuidance\}/);
  assert.match(app, /await refreshStoryStateLedger\(latestStory, signal\)/);
});

test('狀態整理失敗不阻斷正文且新故事會清除舊狀態', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /retries:\s*0/);
  assert.match(app, /catch \(err\) \{[\s\S]*?故事狀態表更新略過/);
  assert.match(app, /clearStoryStateLedger\(\);[\s\S]*?latestStory = ''/);
});

test('狀態整理允許小於正文生成的輸出上限', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /const minOutputTokens = \['state', 'plan'\]\.includes\(options\.taskType\) \? 512 : 4096/);
});

test('工作坊保存創意幅度與隨機種子，並使用受控隨機組合', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(html, /id="diversityMode"/);
  assert.match(html, /id="randomSeed"/);
  assert.match(html, /id="newSeedBtn"/);
  assert.match(html, /不保證 AI 正文逐字相同/);
  assert.match(app, /diversityMode:\s*diversityModeSelect\.value/);
  assert.match(app, /randomSeed:\s*randomSeedInput\.value/);
  assert.match(app, /buildAdvancedRandomSelection\(/);
  assert.match(app, /createSeededRandom\(seed, 'story-elements'\)/);
});

test('生成與續寫會注入多樣性契約並傳入創意幅度', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  assert.match(app, /buildDiversityGuidance\(getDiversityMode\(\), getRandomSeed\(\)\)/);
  assert.match(app, /\$\{diversityGuidance\}/);
  assert.match(app, /diversityMode:\s*getDiversityMode\(\)/);
  assert.match(app, /getSamplingProfile\(options\.taskType, options\.diversityMode\)/);
});

test('全書章記：解析、依章號合併、注入續寫並在過長時縮短早期章節', () => {
  const raw = '```json\n{"establishedFacts":["甲"],"chapterNotes":[{"chapter":2,"note":"  因為失竊，  主角潛入倉庫，找到箱子。 "},{"chapter":"3","note":"結果被發現"},{"chapter":9,"note":"超出章數"},{"chapter":0,"note":"無效"}]}\n```';
  const parsed = planning.parseChapterNotes(raw, 3);
  assert.deepEqual(parsed, [{ chapter: 2, note: '因為失竊， 主角潛入倉庫，找到箱子。' }, { chapter: 3, note: '結果被發現' }]);
  assert.deepEqual(planning.parseChapterNotes('不是 JSON', 3), []);

  const merged = planning.mergeChapterNotes([{ chapter: 1, note: '第一章舊' }, { chapter: 3, note: '舊三' }], parsed);
  assert.deepEqual(merged.map(item => item.chapter), [1, 2, 3]);
  assert.equal(merged[2].note, '結果被發現');

  const guidance = planning.formatChapterNotesGuidance(merged);
  assert.match(guidance, /【全書章記/);
  assert.match(guidance, /第1章：第一章舊\n第2章：/);
  assert.equal(planning.formatChapterNotesGuidance([]), '');

  const many = Array.from({ length: 60 }, (_, i) => ({ chapter: i + 1, note: '事件'.repeat(60) }));
  const long = planning.formatChapterNotesGuidance(many, 3000);
  assert.ok(long.length < 3400, long.length);
  assert.match(long, /第60章：(事件){60}\n/);
  assert.match(long, /第1章：(事件){1,30}…/);

  const prompt = planning.buildStoryStatePrompt({ storyText: '正文', chapterCount: 3, notedChapters: [1, 2] });
  assert.match(prompt, /"chapterNotes"/);
  assert.match(prompt, /已有章記的章節：1、2/);
});

test('狀態表保留較多舊紀錄，未回收伏筆不會被擠掉', () => {
  const quote = i => `第${i}條伏筆的原文依據`;
  const text = Array.from({ length: 30 }, (_, i) => quote(i)).join('。');
  const records = Array.from({ length: 30 }, (_, i) => ({ thread: `伏筆${i}`, plantedChapter: '1', payoff: '', status: i < 20 ? 'open' : 'resolved', evidence: quote(i) }));
  const { state } = planning.checkStoryContinuity(null, { foreshadowing: records }, text, text);
  const threads = state.foreshadowing.map(item => item.thread);
  for (let i = 0; i < 20; i++) assert.ok(threads.includes(`伏筆${i}`), `open 伏筆${i} 應保留`);
  assert.ok(threads.length >= 24, threads.length);
});

test('全書章記存進狀態表並注入續寫 prompt', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /chapterNotes: planner\.mergeChapterNotes\(previous && previous\.chapterNotes, planner\.parseChapterNotes\(raw, countChapters\(story\)\)\)/);
  assert.match(app, /planner\.formatChapterNotesGuidance\(stored\.chapterNotes\)/);
});

test('寫後自檢：新內容有已驗證的人物設定衝突時退回重寫一次，仍衝突就暫停', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /function getNewTextConflicts\(newText\)/);
  assert.match(app, /latestStory = baseStory;[\s\S]*?localStorage\.setItem\(STORY_STATE_STORAGE_KEY, ledgerBefore\)/);
  assert.match(app, /continueChapterWithResume\(\{ \.\.\.opts, rewriteAttempt: true \}\)/);
  assert.match(app, /result\.conflictUnresolved = true/);
  assert.match(app, /\$\{storyStateGuidance\}\$\{chapterRewriteGuidance\}/);
});

test('全書因果審查：切章、分批、估價與章號解析', () => {
  assert.equal(planning.parseChapterNumber('12'), 12);
  assert.equal(planning.parseChapterNumber('十二'), 12);
  assert.equal(planning.parseChapterNumber('二十'), 20);
  assert.equal(planning.parseChapterNumber('一百零五'), 105);
  assert.equal(planning.parseChapterNumber('X'), 0);

  const story = '# 書名\n\n## 第一章 城門\n' + '甲'.repeat(5000) + '\n## 第2章 河岸\n' + '乙'.repeat(5000) + '\n## 第二章 重複章號\n' + '丙'.repeat(5000);
  const chapters = planning.splitStoryChapters(story);
  assert.deepEqual(chapters.map(item => item.chapter), [1, 2, 3]);
  assert.match(chapters[0].text, /^## 第一章 城門/);
  assert.deepEqual(planning.splitStoryChapters('沒有章名的正文'), [{ chapter: 1, text: '沒有章名的正文' }]);
  assert.deepEqual(planning.splitStoryChapters(''), []);

  const batches = planning.planCausalAuditBatches(chapters, 12000);
  assert.deepEqual(batches.map(batch => batch.chapters), [[1, 2], [3]]);
  assert.equal(batches[0].from, 1);
  assert.equal(batches[0].to, 2);
  const huge = planning.planCausalAuditBatches([{ chapter: 1, text: '長'.repeat(50000) }]);
  assert.ok(huge[0].length < 21000 && /中段略/.test(huge[0].text));

  const pricing = require(path.join(__dirname, '..', 'public', 'js', 'deepseek-pricing.js'));
  const estimate = planning.estimateCausalAuditCost(batches, pricing, new Date('2026-09-12T00:00:00Z'));
  assert.equal(estimate.requests, 2);
  assert.ok(estimate.low > 0 && estimate.high > estimate.low);
});

// 使用者以《冗餘資料》實測時的三個誤報，加上一個真正的矛盾。
const auditChapterTexts = {
  2: '## 第2章\n守門人倒在城門下，再也沒有醒來。',
  3: '## 第3章\n敖宸的巢穴在禁區深處需破譯才能進入。',
  4: '## 第4章\n沈硯舟讀取錄音筆得知裴玄齡與龍族蒐集迴路。',
  5: '## 第5章\n夜裡，錨點的指定程序剛啟動。',
  6: '## 第6章\n沈硯舟拼出座標，代價是遺忘顧星野殺人的片段。',
  7: '## 第7章\n這件事只有沈硯舟透過讀取能力知道片段。六小時後被指定為錨點的人是她。敖宸在圖書館現身。',
  8: '## 第8章\n守門人笑著替旅人倒酒。'
};
const auditBatch = () => planning.planCausalAuditBatches([7, 8].map(chapter => ({ chapter, text: auditChapterTexts[chapter] })))[0];

test('全書因果審查：prompt 帶前章章記、逐字事實與大綱，並說明大綱不是事實', () => {
  const batch = auditBatch();
  const outline = '第6章：拼座標\n沈硯舟付出遺忘代價。\n第7章：錨點\n沈硯舟只剩片段記憶。\n第1章：開頭\n不相干';
  const prompt = planning.buildCausalAuditPrompt({ batch, outline,
    priorNotes: [{ chapter: 4, note: '沈硯舟得知迴路' }, { chapter: 7, note: '舊七' }],
    priorFacts: [{ chapter: 4, subject: '沈硯舟', attribute: '知情', quote: '沈硯舟讀取錄音筆得知裴玄齡與龍族蒐集迴路' },
      { chapter: 3, subject: '路人甲', attribute: '地點', quote: '路人甲在碼頭' }] });
  assert.match(prompt, /第7～8章/);
  assert.match(prompt, /第4章：沈硯舟得知迴路/);
  assert.doesNotMatch(prompt, /舊七/);
  assert.match(prompt, /第4章｜沈硯舟｜知情：「沈硯舟讀取錄音筆得知裴玄齡與龍族蒐集迴路」/);
  assert.doesNotMatch(prompt, /路人甲在碼頭/, '主體沒出現在本批的事實不帶入');
  assert.match(prompt, /沈硯舟付出遺忘代價/);
  assert.doesNotMatch(prompt, /不相干/, '只帶本批與前三章的逐章大綱');
  assert.match(prompt, /大綱是計畫，不是已發生事實/);
  assert.match(prompt, /"priorQuote"/);
  assert.match(prompt, /"explanation"/);
  assert.match(prompt, /"facts"/);
});

test('全書因果審查：三個誤報實例不會報出，真正的矛盾仍會報出', () => {
  const batch = auditBatch();
  const raw = JSON.stringify({
    chapterNotes: [{ chapter: 7, note: '錨點指定' }, { chapter: 8, note: '守門人倒酒' }, { chapter: 9, note: '不在本批' }],
    facts: [
      { chapter: 7, subject: '敖宸', attribute: '地點', quote: '敖宸在圖書館現身' },
      { chapter: 8, subject: '守門人', attribute: '生死', quote: '捏造的事實句子' }
    ],
    contradictions: [
      // 誤報一：同一人物、不同事實；且大綱第6章安排了遺忘代價
      { chapter: 7, conflictsWith: 4, subject: '沈硯舟', attribute: '知情', quote: '只有沈硯舟透過讀取能力知道片段', priorQuote: '沈硯舟讀取錄音筆得知裴玄齡與龍族蒐集迴路',
        sameFact: false, explained: 'yes', explanation: '第6章拼座標時遺忘了片段', severity: 'high', issue: '知情範圍前後不一' },
      { chapter: 7, conflictsWith: 4, subject: '沈硯舟', attribute: '知情', quote: '只有沈硯舟透過讀取能力知道片段', priorQuote: '沈硯舟讀取錄音筆得知裴玄齡與龍族蒐集迴路',
        sameFact: true, explained: 'yes', explanation: '大綱第6章的遺忘代價', severity: 'high', issue: '知情範圍前後不一' },
      // 誤報二：時間差
      { chapter: 7, conflictsWith: 5, subject: '指定', attribute: '錨點時間', quote: '六小時後被指定為錨點', priorQuote: '指定程序剛啟動',
        sameFact: true, explained: 'yes', explanation: '程序啟動六小時後才完成指定', severity: 'medium', issue: '時間不一致' },
      // 誤報三：地點不同（兩句主體不同）
      { chapter: 7, conflictsWith: 3, subject: '敖宸', attribute: '位置', quote: '敖宸在圖書館現身', priorQuote: '巢穴在禁區深處需破譯',
        sameFact: true, explained: 'no', severity: 'high', issue: '敖宸位置矛盾' },
      // 前文引句不在指稱的章節
      { chapter: 8, conflictsWith: 4, subject: '守門人', attribute: '生死', quote: '守門人笑著替旅人倒酒', priorQuote: '守門人倒在城門下',
        sameFact: true, explained: 'no', severity: 'high', issue: '章號錯' },
      // 真正的矛盾
      { chapter: 8, conflictsWith: 2, subject: '守門人', attribute: '生死', quote: '守門人笑著替旅人倒酒', priorQuote: '守門人倒在城門下，再也沒有醒來',
        sameFact: true, explained: 'no', explanation: '', severity: 'high', issue: '已死的守門人再出現' },
      // 解釋勉強：降為待確認，不能是嚴重
      { chapter: 8, conflictsWith: 2, subject: '守門人', attribute: '生死', quote: '守門人笑著替旅人倒酒', priorQuote: '守門人倒在城門下',
        sameFact: true, explained: 'partial', explanation: '可能只是昏迷', severity: 'high', issue: '生死待確認' }
    ]
  });
  const result = planning.parseCausalAuditResult('```json\n' + raw + '\n```', batch, auditChapterTexts);
  assert.deepEqual(result.chapterNotes.map(item => item.chapter), [7, 8]);
  assert.deepEqual(result.facts, [{ chapter: 7, subject: '敖宸', attribute: '地點', quote: '敖宸在圖書館現身' }]);
  assert.equal(result.explained, 2);
  assert.equal(result.rejected, 3);
  assert.deepEqual(result.contradictions.map(item => [item.chapter, item.conflictsWith, item.severity]), [[8, 2, 'high'], [8, 2, 'uncertain']]);
  for (const text of ['沈硯舟', '指定', '敖宸']) {
    assert.ok(!result.contradictions.some(item => item.subject === text), `${text} 的誤報不應報出`);
  }
  assert.equal(result.contradictions[0].priorQuote, '守門人倒在城門下，再也沒有醒來');
  assert.equal(planning.parseCausalAuditResult('壞掉的 JSON', batch), null);

  const report = planning.formatCausalAuditReport({ status: 'stopped', completedBatches: 1, totalBatches: 2, from: 1, to: 8,
    contradictions: result.contradictions.slice().reverse(), failedBatches: [{ from: 9, to: 10, reason: '回應被截斷' }],
    rejected: result.rejected, explained: result.explained, notedChapters: 2 });
  assert.match(report, /已中途停止/);
  assert.match(report, /• 【嚴重】第8章 與 第2章 矛盾（守門人／生死）[\s\S]*• 【待確認】第8章/);
  assert.match(report, /第8章原文：「守門人笑著替旅人倒酒」\n  第2章原文：「守門人倒在城門下，再也沒有醒來」/);
  assert.match(report, /可能解釋：可能只是昏迷/);
  assert.match(report, /第9～10章（回應被截斷）/);
  assert.match(report, /另有 2 項 AI 找到合理解釋/);
  assert.match(report, /另有 3 項因兩邊引句/);
  assert.match(report, /已補建 2 章章記/);
  assert.match(planning.formatCausalAuditReport({ completedBatches: 1, totalBatches: 1, contradictions: [] }), /未發現明確的跨章因果矛盾/);
});

test('全書因果審查：面板按鈕、忙碌檢查、費用確認並把章記寫回狀態表', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="causalAuditBtn"[^>]*>全書因果審查</);
  assert.match(html, /id="causalAuditCancel"[^>]*hidden/);
  assert.match(html, /id="causalAuditReport"/);
  assert.match(app, /async function runCausalAudit\(\)[\s\S]*?rejectWhileGenerating\(\)[\s\S]*?planner\.estimateCausalAuditCost\(batches, deepSeekPricing\)[\s\S]*?confirm\(/);
  assert.match(app, /chapterNotes: planner\.mergeChapterNotes\(base\.chapterNotes, notes\)/);
  assert.match(app, /planner\.parseCausalAuditResult\(raw, batch, chapterTexts\)/);
  assert.match(app, /outline: getAuditOutline\(\)/);
  assert.match(app, /priorFacts: facts/);
  assert.match(app, /function beginGeneration\(\) \{[\s\S]*?causalAuditController\.abort\(\)/);
});

// 以下測試資料取自《霜啼輪迴》實際出現的生成錯誤。
test('前文原文檢索：視窗外舊章節的首次與最近出現原句會帶入續寫', () => {
  const story = [
    '第1章：冗餘資料', '他用拇指按住周硯白的徽章。讀取開始。周硯白當時在說話。',
    '第3章：靜止領域', '「第五輪迴的錨點是一名普通班學生，代號『燈芯』。」第三輪迴在西翼第三訓練場。',
    '第6章：龍鱗', '燈芯的感應半徑三十公尺。',
    '第7章：核心', '最近章節的正文，燈芯不在這裡被提到也沒關係。'
  ].join('\n');
  const windowStart = story.indexOf('第7章');
  const text = planning.buildPriorTextExcerpts({ storyText: story, windowStart, terms: ['燈芯', '周硯白', '不存在的名字'] });
  assert.match(text, /【前文相關原文/);
  assert.match(text, /第\d+章｜燈芯：「「第五輪迴的錨點是一名普通班學生，代號『燈芯』。」/);
  assert.match(text, /燈芯：「燈芯的感應半徑三十公尺。」/, '同時帶入最近一次出現');
  assert.match(text, /周硯白：「他用拇指按住周硯白的徽章。」/);
  assert.match(text, /「第一次」/);
  assert.doesNotMatch(text, /最近章節的正文/, '視窗內的章節不重複帶入');
  assert.equal(planning.buildPriorTextExcerpts({ storyText: story, windowStart: 0, terms: ['燈芯'] }), '');
  const tight = planning.buildPriorTextExcerpts({ storyText: story, windowStart, terms: ['燈芯', '周硯白'], budget: 40 });
  assert.ok(tight.split('\n').filter(line => line.startsWith('第')).length === 1, tight);

  assert.deepEqual(planning.selectRelevantTerms(['燈芯', '燈芯', '周硯白', '甲', '敖宸'], '本章大綱：燈芯與敖宸'), ['燈芯', '敖宸']);
});

test('全書設定詞典：新條目要有原文依據，人稱改變視為衝突，只帶入本章相關條目', () => {
  const ch4 = '蘇晚照的筆停了。她抬起頭。蘇晚照把紙片放在桌面上，指尖按住陣圖中央。';
  const parsed = planning.parseStoryBible(JSON.stringify({
    bible: [
      { name: '蘇晚照', kind: 'character', pronoun: '她', traits: '報社編輯，會用契約逼人說實話', firstChapter: 4, evidence: '蘇晚照的筆停了。' },
      { name: '捏造者', kind: 'character', pronoun: '他', traits: '不存在', firstChapter: 4, evidence: '正文裡沒有這句' },
      { name: '第三輪迴', kind: 'place', traits: '西翼第三訓練場', firstChapter: 1, evidence: '指尖按住陣圖中央' }
    ],
    bibleConflicts: [{ name: '第三輪迴', fixed: '西翼', issue: '地點改成東翼', evidence: '第三輪迴東翼出口' }]
  }));
  let { bible, conflicts } = planning.mergeStoryBible([], parsed.entries, ch4);
  assert.deepEqual(bible.map(item => item.name), ['蘇晚照', '第三輪迴']);
  assert.equal(conflicts.length, 0);

  const ch7 = '如果蘇晚照還活著，他會設法把護目鏡送到沈硯舟手裡。';
  ({ bible, conflicts } = planning.mergeStoryBible(bible, [{ name: '蘇晚照', kind: 'character', pronoun: '他', traits: '報社編輯', evidence: '他會設法把護目鏡送到' }], ch4 + ch7, ch7));
  assert.equal(bible[0].pronoun, '她', '人稱不被悄悄覆寫');
  assert.deepEqual(conflicts.map(item => item.name), ['蘇晚照']);
  assert.match(conflicts[0].issue, /「她」變成「他」/);

  const ch9 = '溫敘在第三輪迴東翼出口被刪除。';
  const verified = planning.verifyBibleConflicts(bible, [
    { name: '第三輪迴', fixed: '西翼', issue: '地點由西翼變成東翼', evidence: '第三輪迴東翼出口' },
    { name: '第三輪迴', fixed: '北翼', issue: '詞典沒有這個片段', evidence: '第三輪迴東翼出口' },
    { name: '第三輪迴', fixed: '西翼', issue: '新正文沒有這句', evidence: '捏造的新正文' },
    { name: '不存在', fixed: '西翼', issue: '詞典沒有這一項', evidence: '第三輪迴東翼出口' }
  ], ch9);
  assert.deepEqual(verified.map(item => item.issue), ['地點由西翼變成東翼']);

  const guidance = planning.formatStoryBibleGuidance(bible, '本章：蘇晚照去了檔案室');
  assert.match(guidance, /蘇晚照（角色，她）：報社編輯，會用契約逼人說實話（第4章登場）/);
  assert.doesNotMatch(guidance, /第三輪迴/, '本章沒出現的條目不帶入');
  assert.equal(planning.formatStoryBibleGuidance(bible, '無關'), '');

  const prompt = planning.buildStoryStatePrompt({ storyText: '正文', chapterCount: 4, previousBible: bible });
  assert.match(prompt, /【全書設定詞典（上一版，固定屬性）】\n\[\{"name":"蘇晚照"/);
  assert.match(prompt, /"bibleConflicts"/);
});

test('狀態表：物件持有人不會被大量登場人物擠掉', () => {
  const quote = i => `第${i}位角色的原文依據`;
  const records = [{ entity: '周硯白的徽章', kind: 'item', holder: '沈硯舟', evidence: '徽章收進了胸前的口袋' },
    ...Array.from({ length: 40 }, (_, i) => ({ entity: `角色${i}`, kind: 'character', location: '學院', evidence: quote(i) }))];
  const text = ['徽章收進了胸前的口袋', ...Array.from({ length: 40 }, (_, i) => quote(i))].join('。');
  const { state } = planning.checkStoryContinuity(null, { entities: records }, text, text);
  assert.ok(state.entities.some(item => item.entity === '周硯白的徽章'));
});

test('寫後機械檢查：常見簡體字轉繁體，偵測同段落的重複殘片', () => {
  assert.equal(planning.fixSimplifiedChinese('眼神裡有某种放弃的平静'), '眼神裡有某種放棄的平靜');
  assert.equal(planning.fixSimplifiedChinese('皇后在里長家門口'), '皇后在里長家門口', '繁體常用字不誤轉');

  const glitch = '他抓住葉知寒的肩膀，讀取能力自動觸發。葉知寒的記憶湧入，比以往任何一次都他抓住葉知寒的肩膀，讀取能力自動觸發的瞬間，記憶湧入的速度更猛烈。';
  const found = planning.findGenerationGlitches(glitch);
  assert.equal(found.length, 1);
  assert.match(found[0].snippet, /他抓住葉知寒的肩膀/);
  assert.deepEqual(planning.findGenerationGlitches('他記得。他記得。\n像一條被點亮的河流。\n像一條被點亮的河流。'), [], '短句反覆與跨段落重複不算殘片');
});
