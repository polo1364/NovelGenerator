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

test('missing quotation and transition are extraction issues with old/new values, not proven conflicts', () => {
  const old = { entity: '李斯', kind: 'character', location: '城外', evidence: '李斯站在城外' };
  const result = planning.checkStoryContinuity({ entities: [old] }, { entities: [
    { ...old, location: '書房', evidence: '李斯坐在書房', transitionEvidence: '不存在的移動' },
    { entity: '花', kind: 'item', holder: '李斯', evidence: '不存在的引句' }
  ] }, '李斯站在城外。李斯坐在書房。');
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.every(issue => issue.category === 'extraction'));
  assert.match(result.issues[0].message, /地點：城外 → 書房/);
  assert.match(result.issues[0].message, /不存在的移動/);
  assert.match(result.issues[1].message, /不存在的引句/);
  assert.equal(result.state.entities[0].location, '城外');
});

test('one rejected record does not freeze grounded updates or leak a rejected free summary', () => {
  const old = { entity: '小林', kind: 'character', location: '城外', evidence: '小林站在城外' };
  const result = planning.checkStoryContinuity({ establishedFacts: ['城門關閉'], characterStates: ['小林仍在城外'], recentOutcome: '舊結果', entities: [old] }, {
    characterStates: ['花已開口說話'], recentOutcome: '花已開口說話',
    entities: [{ ...old, location: '城內', evidence: '小林走進城內', transitionEvidence: '小林走進城內' }, { entity: '花', evidence: '假的引句' }]
  }, '小林站在城外。小林走進城內。', '小林走進城內。');
  assert.deepEqual(result.state.characterStates, ['小林走進城內']);
  assert.equal(result.state.recentOutcome, '小林走進城內');
  assert.ok(result.state.establishedFacts.includes('城門關閉'));
  const guidance = planning.formatStoryStateGuidance(result.state, { issues: result.issues });
  assert.match(guidance, /小林走進城內/);
  assert.doesNotMatch(guidance, /花已開口說話|小林仍在城外|舊結果/);
});

test('unconfirmed entity state remains stored but is not injected as definite current state', () => {
  const old = { entity: '李斯', location: '城外', evidence: '李斯站在城外' };
  const result = planning.checkStoryContinuity({ entities: [old], characterStates: ['李斯仍在城外'] }, {
    entities: [{ ...old, location: '書房', evidence: '李斯坐在書房' }]
  }, '李斯站在城外。李斯坐在書房。');
  assert.equal(result.state.entities[0].location, '城外');
  assert.doesNotMatch(planning.formatStoryStateGuidance(result.state, { issues: result.issues }), /城外|書房/);
});

test('pending state stays uncertain when omitted or repeated, and clears only on a grounded correction', () => {
  const old = { entity: '李斯', location: '城外', evidence: '李斯站在城外' };
  const prose = '李斯站在城外。李斯走進書房。李斯坐在書房。書房燈火熄滅。';
  const rejected = planning.checkStoryContinuity({ entities: [old] }, { entities: [{ ...old, location: '書房', evidence: '李斯坐在書房' }] }, prose);
  for (const next of [{ causalEvents: [{ event: '熄燈', evidence: '書房燈火熄滅' }] }, { entities: [old] }]) {
    const result = planning.checkStoryContinuity(rejected.state, next, prose, '書房燈火熄滅。', '', rejected.issues);
    assert.equal(result.issues.length, 1);
    assert.doesNotMatch(planning.formatStoryStateGuidance(result.state, { issues: result.issues }), /城外/);
  }
  const corrected = planning.checkStoryContinuity(rejected.state, { entities: [{ ...old, location: '書房', evidence: '李斯坐在書房', transitionEvidence: '李斯走進書房' }] }, prose, prose, '', rejected.issues);
  assert.deepEqual(corrected.issues, []);
  assert.equal(corrected.state.entities[0].location, '書房');
});

test('issue display limits never drop uncertainty needed to exclude stale facts', () => {
  const old = { entity: '李斯', location: '城外', evidence: '李斯站在城外' };
  const result = planning.checkStoryContinuity({ entities: [old] }, {
    characterKnowledge: Array.from({ length: 8 }, (_, i) => ({ character: `角色${i}`, fact: '秘密', evidence: '沒有這句話' })),
    causalEvents: Array.from({ length: 4 }, (_, i) => ({ event: `事件${i}`, evidence: '沒有這句話' })),
    entities: [{ ...old, location: '書房', evidence: '李斯坐在書房' }]
  }, '李斯站在城外。李斯坐在書房。');
  const issues = planning.getContinuityIssues(result.warnings, result.issues);
  assert.ok(issues.some(issue => issue.entity === '李斯'));
  assert.doesNotMatch(planning.formatStoryStateGuidance(result.state, { issues }), /城外/);
});

test('a newer missing quote cannot erase an unresolved transition requirement', () => {
  const old = { entity: '李斯', location: '城外', evidence: '李斯站在城外' };
  const prose = '李斯站在城外。李斯坐在書房。';
  const first = planning.checkStoryContinuity({ entities: [old] }, { entities: [{ ...old, location: '書房', evidence: '李斯坐在書房' }] }, prose);
  const second = planning.checkStoryContinuity(first.state, { entities: [{ ...old, location: '書房', evidence: '不存在的引句' }] }, prose, '', '', first.issues);
  const third = planning.checkStoryContinuity(second.state, { entities: [{ ...old, evidence: '李斯站在城外。' }] }, prose, '', '', second.issues);
  assert.ok(third.issues.some(issue => issue.code === 'missing_transition'));
  assert.doesNotMatch(planning.formatStoryStateGuidance(third.state, { issues: third.issues }), /城外/);
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
  assert.equal(h.calls[0].model, 'deepseek-flash');
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
