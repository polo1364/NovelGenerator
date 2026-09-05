const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const planning = require('../public/js/generation-planning');

const entity = { entity: '鑰匙', kind: 'item', holder: '小林', evidence: '小林握著鑰匙' };
test('empty extraction is invalid, not a successful continuity check', () => {
  assert.equal(planning.parseStoryState('{}'), null);
});
test('ledger retains legacy facts and grounds new knowledge in actual prose', () => {
  const result = planning.checkStoryContinuity({ establishedFacts: ['城門關閉'] }, {
    establishedFacts: ['城門關閉'], characterKnowledge: [
      { character: '小林', fact: '秘密', learnedFrom: '信件', evidence: '信上寫著秘密' },
      { character: '阿明', fact: '秘密', evidence: '不存在的引句' }
    ]
  }, '小林讀信，信上寫著秘密。');
  assert.deepEqual(result.state.establishedFacts, ['城門關閉']);
  assert.equal(result.state.characterKnowledge.length, 1);
  assert.equal(result.warnings.length, 1);
});

test('item transfer needs evidence from the new passage, not an old event', () => {
  const prose = '小林握著鑰匙。小林把鑰匙交給阿明。阿明握著鑰匙。';
  const next = { ...entity, holder: '阿明', evidence: '阿明握著鑰匙', transitionEvidence: '小林把鑰匙交給阿明' };
  const rejected = planning.checkStoryContinuity({ entities: [entity] }, { entities: [next] }, prose, '阿明握著鑰匙。');
  assert.equal(rejected.state.entities[0].holder, '小林');
  assert.equal(rejected.warnings.length, 1);
  const accepted = planning.checkStoryContinuity({ entities: [entity] }, { entities: [next] }, prose, prose);
  assert.equal(accepted.state.entities[0].holder, '阿明');
  assert.equal(accepted.warnings.length, 0);
});

for (const field of ['status', 'location']) {
  test(`${field} cannot change without a quoted transition`, () => {
    const old = { entity: '小林', kind: 'character', status: 'dead', location: '城外', evidence: '小林死在城外' };
    const next = { ...old, [field]: field === 'status' ? 'alive' : '城內', evidence: '小林站在城內' };
    const result = planning.checkStoryContinuity({ entities: [old] }, { entities: [next] }, '小林死在城外。小林站在城內。');
    assert.equal(result.state.entities[0][field], old[field]);
    assert.equal(result.warnings.length, 1);
  });
}

test('unknown extraction does not erase known ownership', () => {
  const result = planning.checkStoryContinuity({ entities: [entity] }, {
    entities: [{ ...entity, holder: 'unknown' }]
  }, entity.evidence);
  assert.equal(result.state.entities[0].holder, '小林');
});

const plan = JSON.stringify({ openingAnchor: '承接城門關閉', steps: [
  { action: '尋找鑰匙', motive: '進城', cause: '城門關閉', effect: '找到守衛' }
], allowedChanges: ['找到守衛'], fixedFacts: ['城門關閉'], evidenceNeeds: [] });

function requestHarness(request) {
  const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
  const start = app.indexOf('async function callDeepSeek(');
  const end = app.indexOf('const STORY_STATE_STORAGE_KEY', start);
  const calls = [];
  const ctx = { NovelGenerationPlanning: planning, storyStateRevision: 0, DOMException,
    setGenerationStage: () => {}, renderContinuityReport: () => {},
    isNonRetryable: err => err.name === 'AbortError', sleep: async () => {},
    doDeepSeekRequest: async (prompt, key, model, options) => {
      calls.push({ prompt, model, options });
      return request ? request(calls, ctx) : { text: options.taskType === 'plan' ? plan : '正文' };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(app.slice(start, end), ctx);
  return { ctx, calls };
}

test('prose requests first obtain one Flash plan and include priority rules', async () => {
  const h = requestHarness();
  assert.equal(await h.ctx.callDeepSeek('任務', null, 'deepseek-v4-pro', { taskType: 'story' }), '正文');
  assert.deepEqual(h.calls.map(c => c.options.taskType), ['plan', 'story']);
  assert.equal(h.calls[0].model, 'deepseek-v4-flash');
  assert.match(h.calls[1].prompt, /使用者明確設定 → 已確認正文 → 大綱 → 本章計畫/);
  assert.match(h.calls[1].prompt, /找到守衛/);
});

test('invalid plan stops before spending on prose', async () => {
  const h = requestHarness(() => ({ text: '{}' }));
  await assert.rejects(h.ctx.callDeepSeek('任務', null, 'model', { taskType: 'continuation' }), /章節計畫格式不完整/);
  assert.equal(h.calls.length, 1);
});

test('retrying prose reuses the same plan', async () => {
  const h = requestHarness(calls => {
    if (calls.length === 2) throw new Error('temporary');
    return { text: calls.length === 1 ? plan : '正文' };
  });
  await h.ctx.callDeepSeek('任務', null, 'model', { taskType: 'continuation' });
  assert.deepEqual(h.calls.map(c => c.options.taskType), ['plan', 'continuation', 'continuation']);
});

for (const action of ['abort', 'switch']) {
  test(`${action} during planning prevents the prose request`, async () => {
    const controller = new AbortController();
    const h = requestHarness((calls, ctx) => {
      if (action === 'abort') controller.abort();
      else ctx.storyStateRevision++;
      return { text: plan };
    });
    await assert.rejects(h.ctx.callDeepSeek('任務', null, 'model', {
      taskType: 'story', signal: controller.signal
    }), { name: 'AbortError' });
    assert.equal(h.calls.length, 1);
  });
}
