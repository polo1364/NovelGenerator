(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DeepSeekPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // DeepSeek 官方價格（USD / 百萬 tokens），2026-09-10 查核：
  // https://api-docs.deepseek.com/quick_start/pricing/
  const PRICING = {
    'deepseek-flash': {
      offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 }
    },
    'deepseek-v4-pro': {
      offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
      peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
    }
  };

  function tokenCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function isPeakTime(date = new Date()) {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false;
    const hour = date.getUTCHours();
    return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  }

  function getNextOffPeakTime(date = new Date()) {
    const next = new Date(date.getTime());
    if (!isPeakTime(next)) return next;
    next.setUTCHours(next.getUTCHours() < 4 ? 4 : 10, 0, 0, 0);
    return next;
  }

  function getUsageBreakdown(usage) {
    const prompt = tokenCount(usage && usage.prompt_tokens);
    const completion = tokenCount(usage && usage.completion_tokens);
    const rawHit = usage && usage.prompt_cache_hit_tokens;
    const rawMiss = usage && usage.prompt_cache_miss_tokens;
    const hasHit = rawHit !== undefined && rawHit !== null && Number.isFinite(Number(rawHit));
    const hasMiss = rawMiss !== undefined && rawMiss !== null && Number.isFinite(Number(rawMiss));
    let cacheHit = hasHit ? Math.min(prompt, tokenCount(rawHit)) : 0;
    let cacheMiss = hasMiss ? Math.min(prompt - cacheHit, tokenCount(rawMiss)) : prompt - cacheHit;

    // 舊回應若缺少明細，或明細總和不足，未分類的輸入一律按較保守的 cache miss 計價。
    if (!hasHit && hasMiss) cacheHit = Math.max(0, prompt - cacheMiss);
    cacheMiss = Math.min(prompt - cacheHit, cacheMiss + Math.max(0, prompt - cacheHit - cacheMiss));

    return { prompt, completion, cacheHit, cacheMiss };
  }

  function calculateUsageCost(usage, model, date = new Date()) {
    // 舊 Flash 名稱由官方轉接新版；Pro 自此時起亦按 Flash 收費。
    const proRedirected = model === 'deepseek-v4-pro' && date.getTime() >= Date.parse('2026-09-14T04:00:00Z');
    const modelPricing = proRedirected ? PRICING['deepseek-flash'] : (PRICING[model] || PRICING['deepseek-flash']);
    const rates = isPeakTime(date) ? modelPricing.peak : modelPricing.offPeak;
    const tokens = getUsageBreakdown(usage);
    return (
      tokens.cacheHit * rates.cacheHit +
      tokens.cacheMiss * rates.cacheMiss +
      tokens.completion * rates.output
    ) / 1_000_000;
  }

  // Local planning scenarios, not a tokenizer or a spending cap. Each request
  // assumes 4k–20k uncached input tokens; state also reads the new segment.
  function estimateSegmentCost(words, model, date = new Date()) {
    const target = tokenCount(words) || 2500;
    const cost = (prompt, completion, requestModel) => calculateUsageCost({
      prompt_tokens: prompt, completion_tokens: completion
    }, requestModel, date);
    return {
      low: cost(4000, target, model) + cost(8000 + target, 1400, 'deepseek-flash'),
      high: cost(20000, target * 2, model) + cost(40000 + target * 2, 4600, 'deepseek-flash')
    };
  }

  return { PRICING, isPeakTime, getNextOffPeakTime, getUsageBreakdown, calculateUsageCost, estimateSegmentCost };
});
