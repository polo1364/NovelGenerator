const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
test('status notices use explicit readable foreground and background colors', () => {
  const css = fs.readFileSync(require.resolve('../public/css/uiverse-editorial.css'), 'utf8');
  assert.match(css, /#generationCostNotice[\s\S]*#continuityReport[\s\S]*background:\s*#f5f0df/);
  assert.match(css, /#generationCostNotice[\s\S]*color:\s*#171816/);
});
function section(start, end) { return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))); }

test('continuity panel distinguishes unchecked, failed and checked states', () => {
  const panel = {};
  const ctx = { document: { getElementById: () => panel } };
  vm.createContext(ctx);
  vm.runInContext(section('function renderContinuityReport(', 'function readStoryStateLedger('), ctx);
  ctx.renderContinuityReport();
  assert.match(panel.textContent, /尚未檢查/);
  ctx.renderContinuityReport([], 'checked');
  assert.match(panel.textContent, /未發現規則衝突/);
  ctx.renderContinuityReport([], 'failed');
  assert.match(panel.textContent, /整理失敗/);
  ctx.renderContinuityReport(['缺少轉交依據'], 'checked');
  assert.match(panel.textContent, /待確認.*缺少轉交依據/);
  assert.equal(panel.hidden, false);
});

test('primary action area explains extra requests and mirrors pricing period', () => {
  assert.match(html, /id="generationCostNotice"/);
  assert.match(html, /Flash 章前規劃/);
  const panel = { dataset: {} }, reminder = { dataset: {} };
  const ctx = { document: { getElementById: id => id === 'offPeakReminder' ? reminder : panel },
    deepSeekPricing: { isPeakTime: () => true }, peakPriceMessage: () => '尖峰較貴，仍可生成' };
  vm.createContext(ctx);
  vm.runInContext(section('function updateOffPeakReminder(', '// 更新用量統計'), ctx);
  ctx.updateOffPeakReminder();
  assert.match(panel.textContent, /尖峰/);
  ctx.deepSeekPricing.isPeakTime = () => false;
  ctx.updateOffPeakReminder();
  assert.match(panel.textContent, /離峰/);
});

test('progress uses real request stages instead of time-based percentage', () => {
  assert.match(html, /id="generationStage"/);
  assert.match(app, /setGenerationStage\('plan'\)/);
  assert.match(app, /setGenerationStage\('story'\)/);
  assert.match(app, /setGenerationStage\('state'\)/);
  const timer = section('function startSimulatedProgress(', 'function updateGenerationProgress(');
  assert.doesNotMatch(timer, /simulatedProgress = 30|remainingSeconds|即將完成/);
  assert.match(timer, /已耗時/);
});
