(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovelCharacterDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const fields = Object.freeze([
    { key: 'background', label: '身分與關鍵經歷', placeholder: '例如：前醫師，曾因誤判失去病人' },
    { key: 'ability', label: '能力與代價', placeholder: '擅長什麼、能力限制，以及使用的代價' },
    { key: 'belief', label: '信念與底線', placeholder: '相信什麼；即使付出代價也不願做什麼' },
    { key: 'arc', label: '成長方向', placeholder: '從什麼狀態，逐步變成什麼樣的人' },
    { key: 'voice', label: '說話與行為習慣', placeholder: '用詞、反應與習慣；避免每句重複口頭禪', more: true },
    { key: 'allegiance', label: '陣營與利益牽絆', placeholder: '效忠誰、受誰牽制、想保護誰', more: true }
  ]);
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  function normalizeExtras(value = {}) {
    return Object.fromEntries(fields.map(({ key }) => [key, text(value?.[key])]));
  }
  function formatExtras(value) {
    const normalized = normalizeExtras(value);
    return fields.filter(({ key }) => normalized[key]).map(({ key, label }) => `${label}：${normalized[key]}`).join('；');
  }
  function isCompleteCharacter(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return ['gender', 'role', 'age', 'name', 'personality', 'goal', 'weakness', 'secret', 'relation', ...fields.map(field => field.key)]
      .every(key => (typeof value[key] === 'string' || (key === 'age' && typeof value[key] === 'number' && Number.isFinite(value[key]))) && text(value[key]));
  }
  function buildContext(settings = {}) {
    const labels = { theme: '主題', setting: '背景', style: '風格', chapters: '每集章節數', length: '每集預計字數', volumes: '預計集數',
      era: '時代', worldComplexity: '世界觀複雜度', rating: '內容分級', narrative: '敘事視角', pacing: '節奏', emotionalTone: '情感基調', ending: '結局傾向' };
    const parts = Object.entries(labels).filter(([key]) => text(settings[key])).map(([key, label]) => `${label}：${text(settings[key])}`);
    const modes = { stable: '穩定', rich: '豐富', experimental: '實驗' };
    if (modes[settings.diversityMode]) parts.push(`創意幅度：${modes[settings.diversityMode]}`);
    const elements = Array.isArray(settings.specialElements) ? [...new Set(settings.specialElements.map(text).filter(Boolean))].sort() : [];
    if (elements.length) parts.push(`特殊元素：${elements.join('、')}`);
    if (text(settings.notes)) parts.push(`自訂規則（優先於隨機選項）：${text(settings.notes)}`);
    return parts.join('\n') || '尚未設定故事條件';
  }
  const rules = '人物的能力與代價限制解法，不得突然獲得未建立的能力；突破信念與底線須有重大事件與合理動機；成長方向是尚未完成的轉變，必須逐步建立，不能一章跳到終點。目標須有動機與失敗代價；人際包含彼此利益與衝突；秘密須考慮知情者及揭露後果。特殊元素分配給適合的人物，不要人人塞滿；說話習慣自然點綴，不反覆套用。';
  return { fields, normalizeExtras, formatExtras, isCompleteCharacter, buildContext, rules };
});
