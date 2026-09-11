const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planning = require('../public/js/generation-planning');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
function section(start, end) {
  const i = app.indexOf(start), j = app.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i);
  return app.slice(i, j);
}
function helpers(storage) {
  const saved = new Map();
  const ctx = { chaptersInput: { value: '10' }, lengthInput: { value: '50000' }, NovelGenerationPlanning: planning,
    localStorage: storage || { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } };
  vm.createContext(ctx);
  vm.runInContext(section('function isStoryResumePending(', 'function formatChapterWordRequirement('), ctx);
  return ctx;
}
test('unfinished last sentence is detected despite nearby punctuation and short output', () => {
  const c = helpers();
  for (const prefix of ['', '完整前文。'.repeat(300)]) {
    for (const reason of [null, 'stop', 'length', 'interrupted']) {
      assert.equal(c.isLikelyTruncated(prefix + '「帶走。」他對十二個戰士說。「萊', reason), true);
    }
  }
  for (const text of ['他離開了。', '「帶走。」', 'He left.', '她說：「等等……」', '（全文完）', '**（全文完）**']) {
    assert.equal(c.isLikelyTruncated(text, 'stop'), false, text);
  }
  assert.equal(c.isLikelyTruncated('前文（全文完）\n但他又看見', 'stop'), true);
});
test('existing chapter heading does not advance an unfinished or explicitly cut segment', () => {
  const c = helpers();
  const base = '## 第1章 起點\n他離開了。\n## 第2章 追蹤\n「帶走。」他說。「萊';
  const state = c.getContinuationChapterState(base, 10);
  assert.equal(state.inProgress, true);
  assert.equal(state.inProgressChapter, 2);
  assert.equal(c.getRemainingChapterCount(base, 10), 9);
  const complete = base + '恩已經走了。」';
  assert.equal(c.getContinuationChapterState(complete, 10).inProgress, false);
  assert.equal(c.getContinuationChapterState(complete, 10, { forceResume: true }).inProgressChapter, 2);
});
test('stream EOF without terminal event is interrupted, not successful completion', async () => {
  for (const terminal of ['', 'data: [DONE]\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n']) {
    const ctx = { DOMException, TextDecoder, confirmPeakPricing: () => true, DEEPSEEK_ENDPOINT: '/api/chat',
      NovelGenerationPlanning: planning, recordUsage: () => {},
      fetch: async () => new Response('data: {"choices":[{"delta":{"content":"他走了。"}}]}\n\n' + terminal) };
    vm.createContext(ctx);
    vm.runInContext(section('async function doDeepSeekRequest(', 'function setGenerationStage('), ctx);
    const result = await ctx.doDeepSeekRequest('正文', null, 'deepseek-flash', { onChunk: () => {}, taskType: 'story' });
    assert.equal(result.finishReason, terminal === '' ? 'interrupted' : terminal.includes('length') ? 'length' : null);
  }
});
test('bounded auto resume reports incomplete and does not silently drop cut text at word budget', async () => {
  const c = helpers();
  const statuses = [];
  Object.assign(c, { AUTO_TRUNCATE_RESUME_MAX: 1, userAborted: false, seriesAborted: false,
    latestStory: '## 第1章 起點\n「萊', sleep: async () => {}, isStoryOverWordBudget: () => true,
    isActiveStoryComplete: () => false, showStatus: (...args) => statuses.push(args), setGenerationStage: () => {} });
  let calls = 0;
  c.doContinueGeneration = async opts => {
    assert.equal(opts.truncatedResume, true);
    calls++;
    return { ok: true, truncated: true, cutOff: true, wordAdded: 2 };
  };
  vm.runInContext(section('async function doContinueGenerationWithAutoResume(', 'async function doContinueGeneration(opts'), c);
  const result = await c.doContinueGenerationWithAutoResume();
  assert.equal(calls, 2);
  assert.equal(result.incomplete, true);
  assert.equal(statuses.at(-1)[0], 'warning');
});

test('series does not mark or advance a volume when automatic continuation remains incomplete', async () => {
  const c = { seriesRunning: false, seriesAborted: false,
    storySeries: { activeVolumeIndex: 0, totalVolumes: 2, volumes: [{}] },
    getVolumeLabel: () => '第一集', isActiveStoryComplete: () => false,
    showStatus: () => {}, renderSeriesBar: () => {}, setGenerationStage: () => {},
    runAutoContinue: async () => {}, saveStorySeries: () => {},
    stripVolumeSuffix: value => value, extractBookTitle: () => '測試', latestStory: '「萊',
    startNextVolume: async () => { throw new Error('Must not advance incomplete volume'); } };
  vm.createContext(c);
  vm.runInContext(section('async function runAutoSeries(', '// ==================== 系列分集 UI'), c);
  await c.runAutoSeries(3);
  assert.notEqual(c.storySeries.volumes[0].complete, true);
});

test('unfinished metadata survives reload and cannot leak into another story', () => {
  const c = helpers();
  assert.equal(typeof c.setStoryResumePending, 'function');
  const story = '## 第1章 城門\n他走進城裡。';
  c.setStoryResumePending(story, true);
  assert.equal(c.getContinuationChapterState(story, 3).inProgress, true);
  assert.equal(c.isStoryResumePending(story + '另一個故事。'), false);
  const reloaded = helpers(c.localStorage);
  assert.equal(reloaded.getContinuationChapterState(story, 3).inProgress, true);
  reloaded.setStoryResumePending(story, false);
  assert.equal(reloaded.isStoryResumePending(story), false);
});

test('series preserves an incomplete orchestration result even with a textual ending marker', async () => {
  let appearsComplete = false;
  const c = { seriesRunning: false, seriesAborted: false,
    storySeries: { activeVolumeIndex: 0, totalVolumes: 2, volumes: [{}] },
    getVolumeLabel: () => '上集', isActiveStoryComplete: () => appearsComplete,
    showStatus: () => {}, renderSeriesBar: () => {}, setGenerationStage: () => {},
    runAutoContinue: async () => { appearsComplete = true; return { ok: true, incomplete: true }; } };
  vm.createContext(c);
  vm.runInContext(section('async function runAutoSeries(', '// ==================== 系列分集 UI'), c);
  await c.runAutoSeries(3);
  assert.notEqual(c.storySeries.volumes[0].complete, true);
});

test('stop during auto-resume delay sends no further request', async () => {
  const c = helpers();
  let calls = 0;
  Object.assign(c, { AUTO_TRUNCATE_RESUME_MAX: 2, userAborted: false, seriesAborted: false,
    latestStory: '## 第1章 起點\n「萊', isStoryOverWordBudget: () => false, isActiveStoryComplete: () => false,
    showStatus: () => {}, sleep: async () => { c.seriesAborted = true; },
    doContinueGeneration: async () => { calls++; return { ok: true, truncated: true, cutOff: true }; } });
  vm.runInContext(section('async function doContinueGenerationWithAutoResume(', 'async function doContinueGeneration(opts'), c);
  assert.equal((await c.doContinueGenerationWithAutoResume()).aborted, true);
  assert.equal(calls, 1);
});
