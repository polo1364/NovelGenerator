const test = require('node:test');
const assert = require('node:assert/strict');
const design = require('../public/js/book-design');
const { books, titles } = require('./fixtures/bookshelf-books');

test('16 art directions have distinct geometry, reproducible variants and safe output', () => {
  assert.equal(design.STYLES.length, 16);
  const geometry = new Set();
  for (const style of design.STYLES) {
    const first = design.generate(style.words[0] + ' 典藏一', 1);
    const second = design.generate(style.words[0] + ' 典藏二', 2);
    assert.equal(first.direction, style.id);
    assert.equal(second.direction, style.id);
    assert.equal(first.directionName, style.name);
    assert.deepEqual(first, design.generate(style.words[0] + ' 典藏一', 999));
    const svg = design.ornament(first);
    assert.match(svg, new RegExp('data-art-direction="' + style.id + '"'));
    assert.notEqual(svg, design.ornament(second));
    assert.doesNotMatch(svg, /NaN|undefined|<script|onload|<image|<foreignObject|href=/);
    assert.ok(svg.length < 50000);
    const neutral = {...first, seed:'same',patternSeed:123,composition:'central',pattern:'lines',secondaryPattern:null,frame:'none',color:'#333333',ink:'#eeeeee',accent:'#aaaaaa',titleBox:[20,26,160,87]};
    geometry.add(design.ornament(neutral).replace(/data-art-direction="[^"]*"/g,''));
  }
  assert.equal(geometry.size, 16, 'directions differ beyond names, color and seed');
  assert.ok(new Set(books.map(b=>design.generate(b.title,b.id).direction)).size >= 12);
});
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
test('typography budgets displayed punctuation without changing seeded artwork', () => {
  const plain = design.generate('哥德時間的藏書', 1);
  const punctuated = design.generate('哥德：時間的藏書', 1);
  assert.equal(punctuated.seed, plain.seed);
  assert.equal(design.structuralSignature(punctuated), design.structuralSignature(plain));
  assert.equal(design.ornament(punctuated), design.ornament(plain));
  assert.ok(punctuated.fontSize < plain.fontSize);
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
