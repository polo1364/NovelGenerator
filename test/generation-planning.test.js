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
  assert.match(sw, /const CACHE_VERSION\s*=\s*'v89'/);
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
  assert.match(app, /getStoryStateGuidance\(latestStory\)/);
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
