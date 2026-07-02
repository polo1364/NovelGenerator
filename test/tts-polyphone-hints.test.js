const { test } = require('node:test');
const assert = require('node:assert');
const {
  applyPolyphoneHints,
  applyWordJoiners,
  stripPhonemeTags,
  PROTECTED_WORDS
} = require('../public/js/tts-polyphone-hints.js');

// ---- 發音安全改寫（繁體多音字 → 簡體對應字） ----

test('睡著了 改寫為 睡着了（著 zháo）', () => {
  assert.equal(applyPolyphoneHints('他睡著了'), '他睡着了');
});

test('聽著 改寫為 听着（著 zhe 輕聲）', () => {
  assert.equal(applyPolyphoneHints('靜靜聽著雨聲'), '靜靜听着雨聲');
});

test('著名/執著 唸 zhù，不可改成 着', () => {
  assert.equal(applyPolyphoneHints('著名的作家很執著'), '著名的作家很執著');
});

test('原著/顯著/土著 保持 著', () => {
  const out = applyPolyphoneHints('原著中顯著描寫了土著部落');
  assert.ok(!out.includes('着'), `不應出現「着」：${out}`);
});

test('zhù 詞與 zhe 助詞混排時各自正確', () => {
  assert.equal(applyPolyphoneHints('他執著地看著原著'), '他執著地看着原著');
});

test('什麼 改寫為 什么', () => {
  assert.equal(applyPolyphoneHints('這是什麼'), '這是什么');
});

test('沒有/沒問題 改寫為 没', () => {
  assert.equal(applyPolyphoneHints('沒有問題，完全沒問題'), '没有問題，完全没問題');
});

test('很長 改寫為 很长', () => {
  assert.equal(applyPolyphoneHints('這條路很長'), '這條路很长');
});

test('睡覺/覺得 均改寫為 觉', () => {
  assert.equal(applyPolyphoneHints('該睡覺了，我覺得很睏'), '該睡觉了，我觉得很睏');
});

test('調酒 改寫為 调酒', () => {
  assert.equal(applyPolyphoneHints('他在調酒'), '他在调酒');
});

test('改寫為冪等操作（重複呼叫結果不變）', () => {
  const once = applyPolyphoneHints('他聽著音樂睡著了，什麼也沒說');
  assert.equal(applyPolyphoneHints(once), once);
});

test('空字串與 null 安全處理', () => {
  assert.equal(applyPolyphoneHints(''), '');
  assert.equal(applyPolyphoneHints(null), '');
});

// ---- stripPhonemeTags ----

test('stripPhonemeTags 還原純文字', () => {
  const tagged = '他睡<phoneme alphabet="sapi" ph="zhao 2">著</phoneme>了';
  assert.equal(stripPhonemeTags(tagged), '他睡著了');
});

// ---- word joiner ----

test('applyWordJoiners 插入 U+2060 且可還原', () => {
  const out = applyWordJoiners('這是什麼');
  assert.ok(out.includes('\u2060'));
  assert.equal(out.replace(/\u2060/g, ''), '這是什麼');
});

test('applyWordJoiners 對改寫後的簡體詞也有效', () => {
  const rewritten = applyPolyphoneHints('他睡著了');
  const out = applyWordJoiners(rewritten);
  assert.ok(out.includes('\u2060'), `改寫後的「睡着了」也應受保護：${out}`);
});

test('applyWordJoiners 不改動非保護詞', () => {
  assert.equal(applyWordJoiners('平凡的句子'), '平凡的句子');
});

test('PROTECTED_WORDS 由長到短排序（長詞優先匹配）', () => {
  for (let i = 1; i < PROTECTED_WORDS.length; i++) {
    assert.ok(
      PROTECTED_WORDS[i - 1].length >= PROTECTED_WORDS[i].length,
      `${PROTECTED_WORDS[i - 1]} 應不短於 ${PROTECTED_WORDS[i]}`
    );
  }
});
