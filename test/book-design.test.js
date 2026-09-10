const test = require('node:test');
const assert = require('node:assert/strict');
const design = require('../public/js/book-design');
const { books, titles } = require('./fixtures/bookshelf-books');
test('48 books have unique structural configurations without color, title or random IDs', () => {
  const signatures = books.map(b => design.structuralSignature(design.generate(b.title, b.id)));
  assert.equal(new Set(signatures).size, 48);
  const sample = design.generate(books[0].title, books[0].id);
  assert.equal(design.structuralSignature(sample), design.structuralSignature({ ...sample, color:'#ffffff', metal:'silver', seed:'different' }));
  for (const [genre, names] of Object.entries(titles)) {
    const result = names.map(t => design.generate(t, 1));
    assert.ok(new Set(result.map(d => d.layout)).size >= 3, `${genre}: at least three layouts`);
    assert.ok(new Set(result.map(d => d.composition)).size >= 3, `${genre}: at least three compositions`);
    assert.ok(new Set(result.map(d => d.structure)).size >= 2, `${genre}: at least two structures`);
  }
});
test('normalization, reload and sorting preserve designs; unnamed books use IDs', () => {
  assert.deepEqual(design.generate('《龍之契約》', 1), design.generate(' 龍之契約 ', 2));
  assert.deepEqual(design.generate('NEON City', 1), design.generate('neon city', 5));
  assert.notDeepEqual(design.generate('未命名', 1), design.generate('未命名', 2));
  assert.deepEqual(books.map(b => design.generate(b.title, b.id)), books.slice().reverse().map(b => design.generate(b.title, b.id)).reverse());
});
test('mixed topics blend and unknown titles fall back deterministically', () => {
  const mixed = design.generate('星艦上的魔法師', 1);
  assert.ok(mixed.secondary);
  assert.deepEqual(new Set([mixed.genre, mixed.secondary]), new Set(['science','fantasy']));
  assert.ok(design.GENRES.some(g => g.id === design.generate('XQZ 824', 1).genre));
});
test('materials are compatible; title zones fit and SVG contains controlled geometry only', () => {
  for (const b of [...books, { title: '<script>alert(1)</script>', id: 4 }]) {
    const d = design.generate(b.title, b.id), [x,y,w,h] = d.titleBox;
    assert.ok(design.MATERIALS[d.structure].includes(d.material));
    assert.ok(x >= 7 && y >= 7 && x+w+7 <= 200 && y+h+7 <= 300);
    const svg = design.ornament(d);
    assert.doesNotMatch(svg, /NaN|undefined|<script|onload|<image|<foreignObject|href=/);
    assert.match(svg, /clip-path=/);
    assert.ok(svg.length < 50000);
  }
});

test('every palette keeps readable title ink and typography accounts for long names', () => {
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
    .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
    .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
  for (let i=0; i<300; i++) {
    const d=design.generate('樣本 '+i,i), a=luminance(d.color), b=luminance(d.ink);
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5, d.color);
  }
  for (const title of ['宇宙圖書館裡那位記得所有故事卻忘了自己姓名的最後一名管理員','The Long Journey Through Our Forgotten Library']) {
    const d=design.generate(title,1);
    assert.ok(d.fontSize<27);
    assert.ok(!['vertical','columns'].includes(d.layout));
  }
});
