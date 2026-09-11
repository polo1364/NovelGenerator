const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const planning = require('../public/js/generation-planning');
const modulePath = path.join(__dirname, '../public/js/character-design.js');
const design = fs.existsSync(modulePath) ? require(modulePath) : {};

test('character extras preserve all six fields and tolerate legacy data', () => {
  assert.equal(typeof design.normalizeExtras, 'function');
  const input = { background: ' 前醫師 ', ability: '救人但耗損體力', belief: '不傷無辜', arc: '學會信任', voice: '先反問', allegiance: '王室', ignored: 'x' };
  assert.deepEqual(design.normalizeExtras(input), {
    background: '前醫師', ability: input.ability, belief: input.belief, arc: input.arc, voice: input.voice, allegiance: input.allegiance
  });
  assert.ok(Object.values(design.normalizeExtras({})).every(value => value === ''));
  assert.match(design.formatExtras(input), /能力與代價：救人但耗損體力/);
  assert.match(design.formatExtras(input), /成長方向：學會信任/);
});

test('design context includes all story constraints, not runtime switches or future outline', () => {
  assert.equal(typeof design.buildContext, 'function');
  const settings = { theme: '奇幻', setting: '海港', style: '寫實', chapters: '10', length: '50000', volumes: 2,
    narrative: '第一人稱', era: '古代', pacing: '緩慢', rating: '普遍級', worldComplexity: '複雜', emotionalTone: '壓抑', ending: '悲劇', diversityMode: 'rich',
    specialElements: ['詛咒', '背叛'], notes: '禁止穿越', autoContinue: true, randomSeed: 'not-story-data', storyOutline: 'not-yet-fact' };
  const context = design.buildContext(settings);
  for (const value of ['海港', '寫實', '10', '50000', '第一人稱', '古代', '緩慢', '普遍級', '複雜', '壓抑', '悲劇', '詛咒', '背叛', '禁止穿越']) assert.ok(context.includes(value), value);
  assert.doesNotMatch(context, /not-story-data|not-yet-fact|autoContinue/);
  assert.equal(context, design.buildContext({ ...settings, randomSeed: 'other', specialElements: ['背叛', '詛咒'] }));
  assert.notEqual(context, design.buildContext({ ...settings, notes: '允許穿越' }));
});

test('empty or partial AI cast cannot be marked as a completed design', () => {
  assert.equal(typeof design.isCompleteCharacter, 'function');
  assert.equal(design.isCompleteCharacter({}), false);
  assert.equal(design.isCompleteCharacter({ name: '小林', ability: '救人' }), false);
  const complete = Object.fromEntries(['gender', 'role', 'age', 'name', 'personality', 'goal', 'weakness', 'secret', 'relation', ...design.fields.map(f => f.key)].map(key => [key, '已設定']));
  assert.equal(design.isCompleteCharacter(complete), true);
  assert.equal(design.isCompleteCharacter({ ...complete, ability: {} }), false);
});

test('state analysis receives character canon and verifies conflict evidence', () => {
  const prompt = planning.buildStoryStatePrompt({ storyText: '她突然違背誓言。', characterCanon: '不傷無辜；能力必須付出代價' });
  assert.match(prompt, /不傷無辜；能力必須付出代價/);
  assert.match(prompt, /characterConflicts/);
  const next = planning.parseStoryState(JSON.stringify({ recentOutcome: '違誓', characterConflicts: [
    { character: '小林', conflictType: 'hard_boundary', constraint: '不傷無辜', issue: '缺少突破底線的原因', evidence: '她突然違背誓言' },
    { character: '小王', issue: '無依據', evidence: '這句沒有出現' }
  ] }));
  const canon = '角色1：【小林】，信念與底線：不傷無辜。';
  const checked = planning.checkStoryContinuity(null, next, '她突然違背誓言。', undefined, canon);
  assert.ok(checked.warnings.some(w => w.includes('小林') && w.includes('底線')));
  assert.equal(checked.state.characterConflicts.length, 1);
  const recheck = planning.checkStoryContinuity(checked.state, next, '她突然違背誓言。', '', canon);
  assert.ok(recheck.warnings.some(w => w.includes('小林') && w.includes('底線')), 'same-text manual recheck must retain evidence-supported conflicts');
});

test('character warnings require a matching character constraint and supported conflict type', () => {
  const canon = '角色1：【申屠硯】，信念與底線：不主動傷害轉世者。\n角色2：【九黎梟】，個性：冷靜殘暴。';
  const story = '萊恩是轉世者。他親手殺死了萊恩。他的瞳孔完全被暗紅色覆蓋。';
  const valid = { character: '申屠硯', conflictType: 'hard_boundary', constraint: '不主動傷害轉世者', issue: '主動殺死轉世者，未見突破底線動機', evidence: '他親手殺死了萊恩' };
  const candidates = [
    valid,
    { character: '九黎梟', issue: '出現動搖', evidence: '他的瞳孔完全被暗紅色覆蓋' },
    { ...valid, character: '九黎梟' },
    { ...valid, conflictType: 'appearance' },
    { ...valid, constraint: '模型捏造的設定' },
    { ...valid, evidence: '正文沒有這項行動' }
  ];
  for (const candidate of candidates) {
    const checked = planning.checkStoryContinuity(null, { characterConflicts: [candidate] }, story, story, canon);
    assert.equal(checked.warnings.length, candidate === valid ? 1 : 0, JSON.stringify(candidate));
  }
  const relationCanon = '角色1：【阿甲】，信念與底線：不傷無辜，人際關係：與【阿乙】為兄弟。\n角色2：【阿乙】，個性：冷靜殘暴。';
  const borrowed = { character: '阿乙', conflictType: 'hard_boundary', constraint: '不傷無辜', issue: '傷害無辜', evidence: '阿乙殺死無辜路人' };
  assert.equal(planning.checkStoryContinuity(null, { characterConflicts: [borrowed] }, '阿乙殺死無辜路人。', undefined, relationCanon).warnings.length, 0);
  const prompt = planning.buildStoryStatePrompt({ storyText: story, characterCanon: canon });
  assert.match(prompt, /外觀.*情緒/);
  assert.match(prompt, /不能.*缺少.*鋪陳/);
});
