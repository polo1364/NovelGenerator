const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
const source = app.slice(app.indexOf('function setResultStreaming('), app.indexOf('// 直排：只在文字區攔截滾輪'));

for (const vertical of [false, true]) {
  test(`streaming updates visible word count before completion (vertical=${vertical})`, () => {
    const words = { textContent: '已生成 0 字' };
    const ctx = { resultDiv: {}, document: { body: { classList: { contains: () => true } }, getElementById: id => id === 'progressWords' ? words : null },
      isVerticalWriting: () => vertical, getVerticalScroller: () => null, isNearOutputEnd: () => false,
      scrollVerticalToTextEdge: () => {}, requestAnimationFrame: () => {}, countStoryWords: s => s.replace(/[\s#*_\-]/g, '').length };
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    ctx.setResultStreaming('### 第1章\n正文逐字出現');
    assert.equal(ctx.resultDiv.textContent, '### 第1章\n正文逐字出現');
    assert.equal(words.textContent, '已生成 9 字');
    ctx.setResultStreaming('原有正文\n\n接續內容');
    assert.equal(words.textContent, '已生成 8 字');
  });
}
