const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const planning = require('../public/js/generation-planning');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');

function between(start, end) {
  const i = app.indexOf(start);
  const j = app.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i, `Missing application section: ${start}`);
  return app.slice(i, j);
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('client abort mid-stream does not crash the /api/chat proxy', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const timer = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"字"}}]}\n\n'), 50);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => upstream.listen(0, resolve));
  t.after(() => upstream.close());
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DEEPSEEK_API_KEY: 'test',
      DEEPSEEK_URL: `http://127.0.0.1:${upstream.address().port}`, API_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let exited = false;
  server.on('exit', () => { exited = true; });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { if (String(chunk).includes(`localhost:${port}`)) resolve(); });
    server.on('exit', () => reject(new Error('server exited during startup')));
  });

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }], stream: true })
  });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await reader.read().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(exited, false, 'server must survive a client abort');
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);

  const badModel = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] })
  });
  assert.equal(badModel.status, 400);
});

test('aborted stream records an estimated usage instead of nothing', async () => {
  const recorded = [];
  const encoder = new TextEncoder();
  const ctx = { DOMException, TextDecoder, confirmPeakPricing: () => true, DEEPSEEK_ENDPOINT: '/api/chat',
    NovelGenerationPlanning: planning,
    recordUsage: (usage, model, meta) => recorded.push({ usage, model, meta }),
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"他走了很遠的路。"}}]}\n\n'));
        setTimeout(() => controller.error(new DOMException('stopped', 'AbortError')), 10);
      }
    }), { status: 200 }) };
  vm.createContext(ctx);
  vm.runInContext(between('async function doDeepSeekRequest(', 'function setGenerationStage('), ctx);
  await assert.rejects(ctx.doDeepSeekRequest('提示詞'.repeat(30), null, 'deepseek-flash', { onChunk: () => {}, taskType: 'story' }),
    { name: 'AbortError' });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].meta.estimated, true);
  assert.ok(recorded[0].usage.completion_tokens > 0 && recorded[0].usage.prompt_tokens > 0);
});

test('an older flow ending cannot release a newer generation lock', () => {
  const ctx = { AbortController, autoContinueRunning: false, seriesRunning: false, autoStartPending: false,
    storyStateController: null, showStatus: () => {} };
  vm.createContext(ctx);
  vm.runInContext(between('let currentAbortController = null;', 'const stopGenerationBtn'), ctx);
  const older = ctx.beginGeneration();
  const newer = ctx.beginGeneration();
  ctx.endGeneration(older);
  assert.equal(ctx.isGenerationBusy(), true);
  assert.equal(ctx.rejectWhileGenerating(), true);
  ctx.endGeneration(newer);
  assert.equal(ctx.isGenerationBusy(), false);
  vm.runInContext('autoStartPending = true', ctx);
  assert.equal(ctx.isGenerationBusy(), true);
});

test('short chapters never get an inverted word range', () => {
  const ctx = { chaptersInput: { value: '5' }, lengthInput: { value: '5000' } };
  vm.createContext(ctx);
  vm.runInContext(between('function getStoryLengthPlan(', 'function tokensForChapterWords('), ctx);
  for (const [chapters, total] of [['5', '5000'], ['3', '3000'], ['10', '50000'], ['1', '800']]) {
    const plan = ctx.getStoryLengthPlan(chapters, total);
    assert.ok(plan.minPerChapter <= plan.wordsPerChapter && plan.wordsPerChapter <= plan.maxPerChapter,
      `${total}/${chapters}: ${plan.minPerChapter}～${plan.maxPerChapter}`);
  }
  assert.equal(ctx.getStoryLengthPlan('10', '50000').minPerChapter, 4400);
});

test('story state guidance survives text appended after the last check', async () => {
  const storage = new Map();
  const ctx = {
    AbortController, DOMException, console,
    setGenerationStage: () => {}, startSimulatedProgress: () => {},
    NovelGenerationPlanning: planning,
    collectCharactersInfo: () => ({ charactersInfo: '' }),
    latestStory: '城門已經關閉。'.repeat(40),
    document: { getElementById: () => ({}) },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    countChapters: () => 1,
    callDeepSeek: async () => '{"establishedFacts":["城門關閉"]}'
  };
  vm.createContext(ctx);
  vm.runInContext(between('const STORY_STATE_STORAGE_KEY =', '// 全域中斷控制器'), ctx);
  await ctx.refreshStoryStateLedger(ctx.latestStory);
  assert.match(ctx.getStoryStateGuidance(ctx.latestStory), /城門關閉/);
  assert.match(ctx.getStoryStateGuidance(ctx.latestStory + '他們在夜裡出發，'), /城門關閉/);
  assert.equal(ctx.getStoryStateGuidance('完全不同的另一本書。'.repeat(40)), '');
});

test('user entry points refuse to start or switch stories while generating', () => {
  const generate = between("generateBtn.addEventListener('click', async () => {", '// 檢查離線狀態');
  assert.match(generate, /!generatingNextVolume && rejectWhileGenerating\(\)/);
  assert.match(between("continueBtn.addEventListener('click', () => {", 'doContinueGenerationWithAutoResume();'),
    /rejectWhileGenerating\(\)[\s\S]*seriesAborted = false/);
  assert.match(between('function loadBookmarkContent(bm) {', 'clearStoryStateLedger();'), /rejectWhileGenerating\(\)/);
  assert.match(between('function resetWorkspace() {', 'resultDiv.textContent'), /rejectWhileGenerating\(\)/);
  assert.match(between('async function generateOutline() {', 'confirmPeakPricing()'), /rejectWhileGenerating\(\)/);
  // 驗證通過前不得清空既有故事
  const handler = between("generateBtn.addEventListener('click', async () => {", '// 外層保險');
  assert.ok(handler.indexOf("localStorage.removeItem('savedStory')") > handler.indexOf('請至少設定一項'));
});
