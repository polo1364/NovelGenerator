const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pricing = require('../public/js/deepseek-pricing');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const vm = require('node:vm');

test('estimate degrades safely while an older offline pricing module is still cached', () => {
  const estimateEl = {};
  const context = {document:{getElementById:()=>estimateEl},deepSeekPricing:{},
    getWordsPerApiCall:n=>n,getStoryLengthPlan:()=>({wordsPerChapter:2500}),modelSelect:{value:'deepseek-flash'}};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function updateGenerationEstimate('),app.indexOf('// 更新用量統計')),context);
  assert.doesNotThrow(()=>context.updateGenerationEstimate());
  assert.match(estimateEl.textContent,/重新整理/);
  assert.match(app,/getElementById\('generationControlsBtn'\)\?\.addEventListener/);
});

test('connection status does not overwrite chapter identity and continuation starts with cumulative words', () => {
  assert.doesNotMatch(app, /getElementById\('progressChapter'\)\.textContent = '正在連接 AI 服務/);
  const show = app.slice(app.indexOf('function showGenerationProgress('), app.indexOf('function hideGenerationProgress('));
  assert.match(show, /countStoryWords\(latestStory\)/);
  assert.match(show, /setGenerationStage\('connecting'\)/);
});

test('segment estimate includes main model and two Flash helpers under stated scenarios', () => {
  assert.equal(typeof pricing.estimateSegmentCost, 'function');
  const date = new Date('2026-09-10T00:00:00Z');
  const estimate = pricing.estimateSegmentCost(2500, 'deepseek-v4-pro', date);
  const cost = (prompt, completion, model) => pricing.calculateUsageCost({prompt_tokens:prompt, completion_tokens:completion}, model, date);
  assert.equal(estimate.low, cost(4000,2500,'deepseek-v4-pro') + cost(8000+2500,1400,'deepseek-flash'));
  assert.equal(estimate.high, cost(20000,5000,'deepseek-v4-pro') + cost(40000+5000,4600,'deepseek-flash'));
});

test('estimate follows peak and Pro redirect pricing and keeps invalid inputs finite', () => {
  assert.equal(typeof pricing.estimateSegmentCost, 'function');
  const estimate = (words, model, iso) => pricing.estimateSegmentCost(words, model, new Date(iso));
  const low = estimate(2500,'deepseek-flash','2026-09-10T00:00:00Z');
  const peak = estimate(2500,'deepseek-flash','2026-09-10T01:00:00Z');
  assert.equal(peak.low,low.low*2);
  assert.equal(peak.high,low.high*2);
  assert.deepEqual(estimate(2500,'deepseek-v4-pro','2026-09-15T00:00:00Z'),estimate(2500,'deepseek-flash','2026-09-15T00:00:00Z'));
  for (const words of [NaN, Infinity, -1, 0, 'oops']) {
    const value = estimate(words,'unknown','2026-09-10T00:00:00Z');
    assert.ok(Number.isFinite(value.low) && value.low > 0 && value.high > value.low);
  }
});

test('console retains canonical controls but offers only one dock entry and explains estimate scope', () => {
  assert.match(html, /id="generationControlsBtn"/);
  assert.match(html, /id="generateBtn"[^>]*hidden/);
  assert.match(html, /id="continueBtn"[^>]*hidden/);
  assert.match(html, /id="generationEstimate"/);
  assert.match(html, /非整章或整本/);
  for (const id of ['primaryGenerateBtn','primaryContinueBtn','stopGenerationBtn','progressChapter','progressWords','progressTime']) {
    assert.equal(html.split(`id="${id}"`).length-1,1);
  }
});
