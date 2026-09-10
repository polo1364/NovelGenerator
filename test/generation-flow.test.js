const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planning = require('../public/js/generation-planning');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');

function between(start, end) {
  const i = app.indexOf(start);
  const j = app.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `Missing application section: ${start}`);
  return app.slice(i, j);
}

function harness(request) {
  const storage = new Map();
  const calls = [];
  const ctx = {
    AbortController, DOMException, console,
    setGenerationStage: () => {}, startSimulatedProgress: () => {},
    NovelGenerationPlanning: planning,
    latestStory: '第一章正文'.repeat(50),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    countChapters: text => (text.match(/章/g) || []).length,
    callDeepSeek: async (...args) => {
      calls.push(args);
      return request ? request(...args) : '{"establishedFacts":["城門關閉"]}';
    }
  };
  vm.createContext(ctx);
  vm.runInContext(between("const STORY_STATE_STORAGE_KEY =", '// 全域中斷控制器'), ctx);
  return { ctx, storage, calls };
}

test('Flash defaults and legacy names send the official V4.1 ID with non-thinking options', async () => {
  const requests = [];
  const ctx = { DOMException, confirmPeakPricing: () => true,
    DEEPSEEK_ENDPOINT: '/api/chat', NovelGenerationPlanning: planning,
    recordUsage: () => {}, fetch: async (url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: '正文' }, finish_reason: 'stop' }] }) };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(between('async function doDeepSeekRequest(', 'function setGenerationStage('), ctx);
  for (const model of [undefined, 'deepseek-v4-flash', 'deepseek-flash']) {
    await ctx.doDeepSeekRequest('任務', null, model, { taskType: 'state', maxTokens: 1200 });
  }
  for (const body of requests) {
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.max_tokens, 1200);
    assert.equal(body.temperature, planning.getSamplingProfile('state').temperature);
  }
});

test('state extraction receives cancellation and never writes an aborted response', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController();
  const pending = h.ctx.refreshStoryStateLedger(h.ctx.latestStory, controller.signal);
  controller.abort();
  assert.equal(h.calls[0][3].signal.aborted, true);
  release('{"establishedFacts":["old"]}');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.storage.size, 0);
});

test('clearing a story invalidates a pending state response', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  h.ctx.clearStoryStateLedger();
  h.ctx.latestStory = '另一本故事'.repeat(50);
  release('{"establishedFacts":["old"]}');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.storage.size, 0);
});

test('changed prose rejects a stale state response even without clearing storage', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const pending = h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  h.ctx.latestStory += '新內容';
  release('{"establishedFacts":["old"]}');
  assert.equal(await pending, null);
  assert.equal(h.storage.size, 0);
});

test('unchanged prose reuses state without a second request', async () => {
  const h = harness();
  await h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  await h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  assert.equal(h.calls.length, 1);
  assert.match(h.ctx.getStoryStateGuidance(h.ctx.latestStory), /城門關閉/);
});

test('state warnings are persisted, displayed and injected without the rejected summary', async () => {
  const h = harness(() => JSON.stringify({
    establishedFacts: ['鑰匙在阿明手中'],
    entities: [{ entity: '鑰匙', kind: 'item', holder: '阿明', evidence: '阿明握著鑰匙' }]
  }));
  const oldStory = h.ctx.latestStory;
  h.storage.set('novelStoryStateLedger', JSON.stringify({ version: 1,
    sourceFingerprint: planning.createStoryFingerprint(oldStory), state: {
      establishedFacts: ['鑰匙在小林手中'],
      entities: [{ entity: '鑰匙', kind: 'item', holder: '小林', evidence: '小林握著鑰匙' }]
    }
  }));
  const panel = {};
  h.ctx.document = { getElementById: () => panel };
  h.ctx.latestStory += '阿明握著鑰匙。';
  await h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  const ledger = JSON.parse(h.storage.get('novelStoryStateLedger'));
  assert.equal(ledger.version, 2);
  assert.equal(ledger.state.entities[0].holder, '小林');
  assert.equal(ledger.warnings.length, 1);
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /缺少本次轉變依據/);
  const guidance = h.ctx.getStoryStateGuidance(h.ctx.latestStory);
  assert.match(guidance, /待確認項目/);
  assert.doesNotMatch(guidance, /鑰匙在阿明手中/);
  h.ctx.clearStoryStateLedger();
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /尚未檢查/);
});

test('unrelated stored book is not supplied as the previous state', async () => {
  const h = harness();
  h.storage.set('novelStoryStateLedger', JSON.stringify({
    sourceFingerprint: planning.createStoryFingerprint('另一本小說'), sourceLength: 5,
    state: { establishedFacts: ['不應混入的秘密'] }
  }));
  await h.ctx.refreshStoryStateLedger(h.ctx.latestStory);
  assert.doesNotMatch(h.calls[0][0], /不應混入的秘密/);
});

test('already canceled generation never starts a state request', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.ctx.refreshStoryStateLedger(h.ctx.latestStory, controller.signal), { name: 'AbortError' });
  assert.equal(h.calls.length, 0);
});

test('canceling state extraction clears the checking message', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const panel = {};
  h.ctx.document = { getElementById: () => panel };
  const controller = new AbortController();
  const pending = h.ctx.refreshStoryStateLedger(h.ctx.latestStory, controller.signal);
  assert.match(panel.textContent, /檢查中/);
  controller.abort();
  release('{"establishedFacts":["城門關閉"]}');
  await assert.rejects(pending, { name: 'AbortError' });
  assert.match(panel.textContent, /尚未檢查/);
});

function continuationHarness(request) {
  const h = harness(request || ((prompt, key, model, options) => options.taskType === 'state'
    ? '{"establishedFacts":["第二章取得鑰匙"]}' : '第二章正文'.repeat(50)));
  const c = h.ctx;
  const noop = () => {};
  for (const name of ['showStatus', 'showGenerationProgress', 'startSimulatedProgress',
    'scrollOutputAreaIntoView', 'setResultStreaming', 'persistStory', 'updateWordCount',
    'parseAndShowChapters', 'scheduleHideProgress', 'hideGenerationProgress']) c[name] = noop;
  for (const name of ['theme', 'setting', 'style', 'narrative', 'era', 'pacing', 'emotionalTone',
    'worldComplexity', 'rating', 'ending', 'model']) c[`${name}Select`] = { value: '' };
  Object.assign(c, {
    navigator: { onLine: true }, chaptersInput: { value: '0' },
    getStoryLengthPlan: () => ({ targetTotal: 0, wordsPerChapter: 100 }),
    formatChapterWordRequirement: () => '', countStoryWords: text => text.length,
    storySeries: null, currentOutline: '', collectCharactersInfo: () => ({ mainNames: [], secondaryNames: [], characterNames: [] }),
    specialElementsContainer: { querySelectorAll: () => [] },
    getSupplementaryNotesBlock: () => '', getUserNotesText: () => '',
    getNamePoolStoryBlock: () => '', getDiversityGuidance: () => '', getDiversityMode: () => 'rich',
    document: { getElementById: () => ({ style: {} }) },
    continueBtn: {}, generateBtn: {}, downloadBtn: {}, speakBtn: {}, bookReaderBtn: {}, resultDiv: {},
    beginGeneration: () => { c.currentAbortController = new AbortController(); return c.currentAbortController.signal; },
    endGeneration: () => { assert.match(c.getStoryStateGuidance(c.latestStory), /第二章取得鑰匙/); },
    tokensForChapterWords: () => 4096, stripDuplicateBookTitleLines: (base, added) => added,
    progressInterval: null, isActiveStoryComplete: () => false,
    shouldAutoResumeSegment: () => false, isCurrentChapterUnderTarget: () => false,
    userAborted: false, seriesAborted: false, AUTO_TRUNCATE_RESUME_MAX: 3
  });
  vm.runInContext(between('async function doContinueGenerationWithAutoResume(', 'function isAutoContinueEnabled('), c);
  return h;
}

test('ordinary completed continuation updates state before ending the generation', async () => {
  const h = continuationHarness();
  const c = h.ctx;
  const result = await c.doContinueGenerationWithAutoResume({ auto: true });
  assert.equal(result.ok, true);
  assert.deepEqual(h.calls.map(call => call[3].taskType), ['continuation', 'state']);
});

for (const [replacement, newerGeneration] of [['', false], ['短篇新書', false], ['短篇新書', true]]) {
  test(`switching story during state extraction preserves text and releases only its own lock (${replacement || 'empty'}, newer=${newerGeneration})`, async () => {
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const h = continuationHarness((prompt, key, model, options) => {
      if (options.taskType !== 'state') return '續章正文'.repeat(60);
      started();
      return new Promise(resolve => { release = resolve; });
    });
    const pending = h.ctx.doContinueGenerationWithAutoResume({ auto: true });
    await waiting;
    h.ctx.clearStoryStateLedger();
    h.ctx.latestStory = replacement;
    h.ctx.resultDiv.textContent = replacement;
    h.ctx.generateBtn.disabled = true;
    let ended = false;
    h.ctx.endGeneration = () => { ended = true; h.ctx.currentAbortController = null; };
    if (newerGeneration) h.ctx.currentAbortController = new AbortController();
    release('{"establishedFacts":["舊書"]}');
    assert.equal((await pending).aborted, true);
    assert.equal(h.ctx.latestStory, replacement);
    assert.equal(h.ctx.resultDiv.textContent, replacement);
    assert.equal(h.ctx.generateBtn.disabled, newerGeneration, 'release old lock but preserve a newer generation lock');
    assert.equal(ended, !newerGeneration);
    assert.equal(h.storage.size, 0);
  });
}

test('automatic requests recheck each peak interval and reuse its confirmation', () => {
  let now = '2026-09-11T00:59:00Z', confirmations = 0;
  class Clock extends Date { constructor() { super(now); } }
  const ctx = {
    Date: Clock, deepSeekPricing: require('../public/js/deepseek-pricing'),
    updateOffPeakReminder: () => {}, peakPriceMessage: () => '尖峰',
    window: { confirm: () => { confirmations++; return true; } }
  };
  vm.createContext(ctx);
  vm.runInContext(between("let confirmedPeakPeriod =", 'function updateOffPeakReminder('), ctx);
  assert.equal(ctx.confirmPeakPricing(true), true);
  assert.equal(confirmations, 0);
  now = '2026-09-11T01:00:00Z';
  ctx.confirmPeakPricing(true);
  ctx.confirmPeakPricing(true);
  assert.equal(confirmations, 1);
  now = '2026-09-11T06:00:00Z';
  ctx.confirmPeakPricing(true);
  assert.equal(confirmations, 2);
});

test('peak cancellation at the request boundary aborts before fetch', async () => {
  const ctx = { confirmPeakPricing: () => false, DOMException };
  vm.createContext(ctx);
  const prefix = between('async function doDeepSeekRequest(', 'const { onChunk = null, signal = null }');
  vm.runInContext(prefix + '\nthrow new Error("Reached request setup");\n}', ctx);
  await assert.rejects(ctx.doDeepSeekRequest('', null, '', {}), { name: 'AbortError' });
  assert.equal(ctx.userAborted, true);
  assert.equal(ctx.seriesAborted, true);
});

test('canceling peak confirmation prevents single-character generation', async () => {
  const context = { confirmPeakPricing: () => false };
  vm.createContext(context);
  const start = app.indexOf('async function aiCompleteCharacterRow(');
  assert.ok(start > 0);
  const prefix = app.slice(start, app.indexOf("if (btn) { btn.disabled = true;", start));
  vm.runInContext(prefix + '\nthrow new Error("Reached generation after cancellation");\n}', context);
  await context.aiCompleteCharacterRow({}, {});
});

test('canceling peak confirmation prevents title request in outline-to-story flow', async () => {
  const start = app.indexOf("generateFromOutlineBtn.addEventListener('click', async () => {");
  const bodyStart = app.indexOf('async () => {', start);
  const end = app.indexOf('generateFromOutlineBtn.disabled = true;', bodyStart);
  const handler = app.slice(bodyStart, end) + '\nthrow new Error("Reached paid title request");\n}\n}';
  const context = { currentOutline: '大綱', currentBookTitle: '', confirmPeakPricing: () => false };
  vm.createContext(context);
  await vm.runInContext('(' + handler + ')()', context);
});
