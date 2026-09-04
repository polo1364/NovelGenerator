const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'public', 'js', 'deepseek-pricing.js');

function loadPricing() {
  assert.ok(fs.existsSync(modulePath), 'DeepSeek pricing module must exist');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('尖峰時段只包含 UTC 平日 01:00–04:00 與 06:00–10:00', () => {
  const { isPeakTime } = loadPricing();

  assert.equal(isPeakTime(new Date('2026-09-04T01:00:00Z')), true);
  assert.equal(isPeakTime(new Date('2026-09-04T03:59:59Z')), true);
  assert.equal(isPeakTime(new Date('2026-09-04T04:00:00Z')), false);
  assert.equal(isPeakTime(new Date('2026-09-04T06:00:00Z')), true);
  assert.equal(isPeakTime(new Date('2026-09-04T10:00:00Z')), false);
  assert.equal(isPeakTime(new Date('2026-09-05T02:00:00Z')), false);
});

test('尖峰時段會回傳下一個離峰開始時間', () => {
  const { getNextOffPeakTime } = loadPricing();

  assert.equal(
    getNextOffPeakTime(new Date('2026-09-04T02:30:00Z')).toISOString(),
    '2026-09-04T04:00:00.000Z'
  );
  assert.equal(
    getNextOffPeakTime(new Date('2026-09-04T08:30:00Z')).toISOString(),
    '2026-09-04T10:00:00.000Z'
  );
});

test('V4 Flash 依尖離峰及快取命中比例計價', () => {
  const { calculateUsageCost } = loadPricing();
  const usage = {
    prompt_tokens: 1_000_000,
    prompt_cache_hit_tokens: 250_000,
    prompt_cache_miss_tokens: 750_000,
    completion_tokens: 1_000_000
  };

  assert.equal(calculateUsageCost(usage, 'deepseek-v4-flash', new Date('2026-09-05T02:00:00Z')), 0.82675);
  assert.equal(calculateUsageCost(usage, 'deepseek-v4-flash', new Date('2026-09-04T02:00:00Z')), 1.6535);
});

test('V4 Pro 使用官方離峰價格', () => {
  const { calculateUsageCost } = loadPricing();
  const usage = {
    prompt_tokens: 1_000_000,
    prompt_cache_hit_tokens: 250_000,
    prompt_cache_miss_tokens: 750_000,
    completion_tokens: 1_000_000
  };

  assert.equal(calculateUsageCost(usage, 'deepseek-v4-pro', new Date('2026-09-05T02:00:00Z')), 2.4805);
});

test('舊回應沒有快取明細時將全部輸入視為 cache miss', () => {
  const { calculateUsageCost } = loadPricing();
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

  assert.equal(calculateUsageCost(usage, 'deepseek-v4-flash', new Date('2026-09-05T02:00:00Z')), 0.88);
});
