(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BookDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GENRES = [
    { id: 'ancient', name: '山河藏卷', words: ['長安','江湖','山河','劍','宮','古','朝','江南','chang an'], patterns: ['lines','contours'], colors: ['#304e47','#743a30','#b8a485'] },
    { id: 'fantasy', name: '幻境典藏', words: ['龍','魔法','精靈','王冠','奇幻','dragon','magic','crown'], patterns: ['crest','botanical'], colors: ['#273d47','#493451','#38514b'] },
    { id: 'mystery', name: '暗夜檔案', words: ['密室','失蹤','證人','血色','謎','兇','遺書','mystery','witness'], patterns: ['lines','geometry'], colors: ['#282c33','#4f3038','#32464a'] },
    { id: 'science', name: '未來文庫', words: ['星際','量子','機械','銀河','宇宙','星艦','orbit','space','robot'], patterns: ['stars','geometry'], colors: ['#244350','#384759','#485153'] },
    { id: 'romance', name: '花信書簡', words: ['戀','花','告白','重逢','love','春天'], patterns: ['botanical','crest'], colors: ['#a7807c','#586449','#8c5862'] },
    { id: 'adventure', name: '遠行手記', words: ['遠征','荒島','航海','沙漠','冰原','探險','adventure','map'], patterns: ['contours','stars'], colors: ['#786044','#435b53','#85593e'] },
    { id: 'literature', name: '歲月選集', words: ['故鄉','歲月','詩','記憶','時光','散文','quiet','poem'], patterns: ['lines','botanical'], colors: ['#c9bea3','#899187','#7e5b46'] },
    { id: 'modern', name: '城市叢書', words: ['城市','都市','人生','公寓','neon','city','dream'], patterns: ['geometry','contours'], colors: ['#b87648','#455b67','#b7b09e'] }
  ];
  const MATERIALS = {
    hardback: ['cloth','paper'], rounded: ['leather','cloth'], flat: ['paper','cloth'],
    halfbound: ['leather'], jacket: ['paper'], stitched: ['paper','cloth']
  };
  const LAYOUTS = ['vertical','horizontal','columns','split','offset','label'];
  const COMPOSITIONS = ['central','asymmetric','divided','diagonal','framed','allover'];
  function hash(value) {
    let h = 2166136261;
    for (const c of String(value)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
    return h >>> 0;
  }
  function random(seed) {
    let state = hash(seed);
    return () => { state += 0x6D2B79F5; let t = state;
      t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function normalize(title) { return String(title || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ''); }
  function pick(seed, key, choices) { return choices[Math.floor(random(seed + ':' + key)() * choices.length)]; }
  function readableInk(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    const l = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    return (l + .05) / .063 > .948 / (l + .05) ? '#201e19' : '#faf3df';
  }
  function fitType(name, box, vertical, maximum) {
    // Conservative full-em glyph budget: font loading and mixed scripts cannot steal the safe zone.
    const count = Math.max(1, [...name].length);
    const inline = (vertical ? box[3] : box[2]) - 20;
    const block = (vertical ? box[2] : box[3]) - 20;
    let size = maximum;
    while (size > 4 && Math.ceil(count / Math.max(1, Math.floor(inline / (size * 1.15)))) * size * 1.5 > block) size -= .5;
    return size;
  }
  function generate(title, id) {
    const name = String(title || '').trim();
    const normalized = normalize(name);
    const seed = !normalized || /^(未命名|未命名書籍|未命名書籤)$/.test(normalized) ? 'untitled:' + String(id) : normalized;
    const ranked = GENRES.map((g, i) => ({ g, i, score: g.words.filter(w => normalized.includes(normalize(w))).length }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    const primary = ranked[0].score ? ranked[0].g : pick(seed, 'genre', GENRES);
    const secondary = ranked[1].score ? ranked[1].g : null;
    const structures = primary.id === 'ancient' ? ['stitched','halfbound','hardback','flat']
      : primary.id === 'science' || primary.id === 'modern' ? ['flat','jacket','hardback','rounded']
      : ['hardback','rounded','flat','halfbound','jacket'];
    const structure = pick(seed, 'structure', structures);
    const material = pick(seed, 'material', MATERIALS[structure]);
    const english = /[a-z]/i.test(normalized), long = [...normalized].length > 14;
    const layouts = english || long ? LAYOUTS.filter(l => l !== 'vertical' && l !== 'columns') : LAYOUTS;
    const layout = layouts[(hash(seed + ':typography') + [...normalized].length) % layouts.length];
    const titleBox = {
      vertical: [125,24,54,237], horizontal: [20,26,160,87], columns: [24,26,84,230],
      split: [20,196,160,81], offset: [18,24,131,96], label: [24,107,152,87]
    }[layout];
    const color = pick(seed, 'palette', primary.colors);
    const metal = primary.id === 'science' ? 'silver' : pick(seed, 'metal', ['gold','copper','none']);
    const design = { version: 1, seed: hash(seed).toString(16), genre: primary.id, collection: primary.name,
      secondary: secondary && secondary.id, structure, material, layout,
      composition: pick(seed, 'composition', COMPOSITIONS), pattern: pick(seed, 'pattern', primary.patterns),
      secondaryPattern: secondary ? pick(seed, 'secondary-pattern', secondary.patterns) : null,
      frame: pick(seed, 'frame', ['none','double','corners','inset','rules']), metal, color,
      ink: readableInk(color), accent: metal === 'silver' ? '#d6e1e3' : metal === 'copper' ? '#e7b398' : '#e0c48b',
      titleBox, fontSize: fitType(normalized, titleBox, layout === 'vertical' || layout === 'columns', english ? 27 : 32),
      spineFontSize: fitType(normalized, [0,0,52,164], true, 15),
      width: pick(seed, 'width', [92,96,100]), height: pick(seed, 'height', [94,97,100]),
      thickness: pick(seed, 'thickness', [8,11,14]), patternSeed: hash(seed + ':art') };
    return design;
  }
  // Only controlled numeric geometry enters SVG. User text is rendered separately with textContent.
  function ornament(design) {
    const r = random(design.patternSeed), n = (v) => Number(v.toFixed(2));
    const parts = [];
    function pattern(kind, light = false) {
      const count = 7 + Math.floor(r() * 8), cx = 65 + r() * 70, cy = 90 + r() * 120;
      const out = [];
      if (kind === 'stars') {
        const points = Array.from({ length: count + 8 }, () => [n(12 + r() * 176), n(12 + r() * 276)]);
        out.push(`<polyline points="${points.slice(0, count).map(p => p.join(',')).join(' ')}"/>`);
        points.forEach(([x,y], i) => out.push(`<circle cx="${x}" cy="${y}" r="${n(i % 3 ? 1.2 : 2.6)}"/>`));
        out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(25 + r() * 45)}" stroke-dasharray="2 6"/>`);
      } else if (kind === 'botanical') {
        const bend = 15 + r() * 45;
        for (let i = 0; i < count; i++) {
          const y = 25 + i * 240 / count, x = cx + Math.sin(i * .6) * bend, sign = i % 2 ? 1 : -1;
          out.push(`<path d="M${n(cx)} 285 Q${n(x)} ${n(y)} ${n(x + sign * 36)} ${n(y - 15)} Q${n(x + sign * 23)} ${n(y + 30)} ${n(x)} ${n(y)}"/>`);
        }
      } else if (kind === 'contours') {
        for (let i = 0; i < count; i++) {
          let d = '';
          for (let j = 0; j <= 36; j++) {
            const angle = j * Math.PI * 2 / 36, radius = 12 + i * 8 + Math.sin(j * .55 + r()) * (8 + i * 1.4);
            d += `${j ? 'L' : 'M'}${n(cx + Math.cos(angle) * radius)} ${n(cy + Math.sin(angle) * radius * 1.5)} `;
          }
          out.push(`<path d="${d}Z"/>`);
        }
      } else if (kind === 'crest') {
        const petals = 5 + Math.floor(r() * 7), radius = 30 + r() * 45;
        for (let i = 0; i < petals; i++) out.push(`<ellipse cx="${n(cx)}" cy="${n(cy - radius / 2)}" rx="${n(10 + r()*12)}" ry="${n(radius)}" transform="rotate(${n(i*360/petals)} ${n(cx)} ${n(cy)})"/>`);
        out.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius * 1.4)}"/><path d="M${n(cx)} ${n(cy-100)} V${n(cy+100)} M${n(cx-75)} ${n(cy)} H${n(cx+75)}"/>`);
      } else if (kind === 'geometry') {
        for (let i = 0; i < count; i++) {
          const x = n(r()*130), y = n(r()*240), size = n(20+r()*60);
          out.push(i % 2 ? `<circle cx="${x}" cy="${y}" r="${size/2}"/>`
            : `<rect x="${x}" y="${y}" width="${size}" height="${size}" transform="rotate(${n(r()*70)} ${x} ${y})"/>`);
        }
      } else {
        const slant = 20 + r() * 100;
        for (let i = 0; i < count + 8; i++) out.push(`<path d="M${n(i*13-40)} 0 Q${n(cx+slant)} ${n(cy)} ${n(i*13-slant)} 300"/>`);
      }
      return `<g opacity="${light ? .35 : .8}">${out.join('')}</g>`;
    }
    parts.push(pattern(design.pattern));
    if (design.secondaryPattern && design.secondaryPattern !== design.pattern) parts.push(pattern(design.secondaryPattern, true));
    const composition = {
      central: '', asymmetric: 'translate(-32 28) rotate(-12 100 150)', divided: 'translate(0 55) scale(1 .66)',
      diagonal: 'rotate(32 100 150)', framed: 'translate(24 36) scale(.76)', allover: 'translate(-30 -40) scale(1.3)'
    }[design.composition];
    const [x,y,w,h] = design.titleBox, clipId = 'art-' + design.seed;
    const rect = (a,b,c,d) => `<rect x="${a}" y="${b}" width="${c}" height="${d}"/>`;
    const safe = rect(0,0,200,y-7) + rect(0,y+h+7,200,300-y-h-7)
      + rect(0,y-7,x-7,h+14) + rect(x+w+7,y-7,200-x-w-7,h+14);
    const frames = {
      none: '', double: rect(12,18,176,264) + rect(16,24,168,252),
      corners: '<path d="M45 18H12V62 M155 18H188V62 M12 238V282H45 M188 238V282H155" stroke-width="2"/>',
      inset: '<path d="M10 285V85C10 -10 190 -10 190 85V285Z"/>',
      rules: '<path d="M16 18H184 M16 282H184" stroke-width="1.8"/>'
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><clipPath id="${clipId}">${safe}</clipPath></defs><g clip-path="url(#${clipId})" fill="none" stroke="currentColor" stroke-width=".8"><g transform="${composition}">${parts.join('')}</g><g opacity=".7">${frames[design.frame]}</g></g></svg>`;
  }
  function structuralSignature(d) {
    return [d.structure,d.material,d.layout,d.composition,d.pattern,d.secondaryPattern,d.frame].join('|');
  }
  return { generate, ornament, structuralSignature, normalize, MATERIALS, GENRES };
});
