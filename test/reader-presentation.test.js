const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require.resolve('../public/index.html'),'utf8');
const app = fs.readFileSync(require.resolve('../public/js/app.js'),'utf8');
const css = fs.readFileSync(require.resolve('../public/css/styles.css'),'utf8');
test('reader shows current font size and keeps original controls uniquely accessible', () => {
  assert.ok(html.includes('id="bookFontValue"'));
  for (const id of ['bookFontDec','bookFontInc','bookReaderClose','bookResetProgress','bookPrev','bookNext']) {
    assert.equal(html.split(`id="${id}"`).length-1,1);
    assert.match(html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))[0],/aria-label=/);
  }
  const apply = app.slice(app.indexOf('function applyFontSize()'),app.indexOf('function render()',app.indexOf('function applyFontSize()')));
  assert.match(apply,/bookFontValue/);
  assert.match(apply,/fontDec.disabled = fontSize <= 14/);
  assert.match(apply,/fontInc.disabled = fontSize >= 28/);
});
test('reader paper theme is shared with flip faces without changing measurement typography', () => {
  assert.ok(css.includes('--reader-paper:'));
  assert.match(css,/\.book-page,\s*\.book-flip-face\s*\{[^}]*background:[^}]*var\(--reader-paper\)/);
  assert.ok(css.includes('#bookReaderOverlay .book-tool-btn:focus-visible'));
  assert.ok(html.includes('book-reading-hint'));
});

test('running heads are decorative and separate from the measured story', () => {
  assert.equal((html.match(/class="book-running-head" aria-hidden="true"/g)||[]).length,2);
  assert.match(css,/\.book-book::before\s*\{/);
  assert.match(css,/\.book-book::after\s*\{/);
});
