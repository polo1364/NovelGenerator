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
  // Art directions are independent of book structure/layout; each draws new seeded geometry.
  const STYLES = [
    {id:'ink',name:'水墨山水',words:['水墨','ink wash'],genres:['ancient','literature'],colors:['#d7cfb6','#bcbba5','#4a5b51']},
    {id:'woodcut',name:'木刻版畫',words:['木刻','浮世繪','woodcut'],genres:['ancient','adventure'],colors:['#d3b98b','#374c60','#8d4b35']},
    {id:'deco',name:'裝飾藝術',words:['裝飾藝術','爵士','art deco'],genres:['fantasy','modern','romance'],colors:['#234c43','#303c52','#653a43']},
    {id:'gothic',name:'哥德藏典',words:['哥德','教堂','gothic'],genres:['fantasy','mystery'],colors:['#33303b','#572c3b','#384139']},
    {id:'celestial',name:'星象秘典',words:['星象','占星','塔羅','celestial'],genres:['fantasy','science'],colors:['#282c4a','#434059','#24464b']},
    {id:'cyber',name:'賽博未來',words:['賽博','霓虹','cyberpunk'],genres:['science','modern'],colors:['#202f3a','#33233e','#243c40']},
    {id:'blueprint',name:'工程藍圖',words:['藍圖','工程','blueprint'],genres:['science','adventure'],colors:['#294a6b','#345c63','#344e59']},
    {id:'herbarium',name:'植物標本',words:['植物標本','花園','herbarium'],genres:['romance','literature'],colors:['#d3ccb0','#b1b99b','#3b5748']},
    {id:'collage',name:'紙藝拼貼',words:['拼貼','剪報','collage'],genres:['modern','literature','romance'],colors:['#c9bb9e','#b5987d','#44556a']},
    {id:'bauhaus',name:'包浩斯',words:['包浩斯','構成主義','bauhaus'],genres:['modern','science'],colors:['#d7c6a6','#b18a68','#48545b']},
    {id:'minimal',name:'極簡文庫',words:['極簡','留白','minimal'],genres:['literature','modern','mystery'],colors:['#d2ccb9','#aebbb5','#485455']},
    {id:'ocean',name:'航海圖誌',words:['航海','海圖','nautical'],genres:['adventure','ancient'],colors:['#294e60','#c7b88f','#406663']},
    {id:'terrazzo',name:'礦石紙紋',words:['水磨石','礦石','terrazzo'],genres:['modern','romance'],colors:['#d1c0a7','#b6bda9','#b29c90']},
    {id:'manuscript',name:'古籍手稿',words:['手稿','羊皮紙','manuscript'],genres:['ancient','mystery','literature'],colors:['#c7b48e','#b8ab8e','#735345']},
    {id:'noir',name:'黑色電影',words:['黑色電影','黑幕','noir'],genres:['mystery','modern'],colors:['#30343a','#393f43','#542e37']},
    {id:'tapestry',name:'織錦花毯',words:['織錦','花毯','tapestry'],genres:['ancient','fantasy','romance'],colors:['#6d3641','#33514b','#574459']}
  ];
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
    const explicitStyle = STYLES.find(s => s.words.some(w => normalized.includes(normalize(w))));
    const direction = explicitStyle || pick(seed, 'art-direction', STYLES.filter(s => s.genres.includes(primary.id)));
    const color = pick(seed, 'palette', direction.colors);
    const metal = primary.id === 'science' ? 'silver' : pick(seed, 'metal', ['gold','copper','none']);
    const design = { version: 2, seed: hash(seed).toString(16), genre: primary.id, collection: primary.name,
      direction: direction.id, directionName: direction.name,
      secondary: secondary && secondary.id, structure, material, layout,
      composition: pick(seed, 'composition', COMPOSITIONS), pattern: pick(seed, 'pattern', primary.patterns),
      secondaryPattern: secondary ? pick(seed, 'secondary-pattern', secondary.patterns) : null,
      frame: pick(seed, 'frame', ['none','double','corners','inset','rules']), metal, color,
      ink: readableInk(color), accent: metal === 'silver' ? '#d6e1e3' : metal === 'copper' ? '#e7b398' : '#e0c48b',
      // Artwork uses the normalized seed, but punctuation also occupies visible text space.
      titleBox, fontSize: fitType(name, titleBox, layout === 'vertical' || layout === 'columns', english ? 27 : 32),
      spineFontSize: fitType(name, [0,0,52,164], true, 15),
      width: pick(seed, 'width', [92,96,100]), height: pick(seed, 'height', [94,97,100]),
      thickness: pick(seed, 'thickness', [8,11,14]), patternSeed: hash(seed + ':art') };
    return design;
  }
  function directionArt(design) {
    const r = random(design.patternSeed + ':direction'), n = v => Number(v.toFixed(2));
    const ink = design.ink, accent = design.accent;
    const out = [], cx = n(60+r()*80), cy = n(140+r()*70);
    const path = (d, attrs='') => `<path d="${d}" ${attrs}/>`;
    const circle = (x,y,radius,attrs='') => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" ${attrs}/>`;
    const rect = (x,y,w,h,attrs='') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs}/>`;
    switch (design.direction) {
      case 'ink':
        for(let i=0;i<4;i++) {
          const y=115+i*36, peak=20+r()*100;
          out.push(path(`M-20 ${y+65} Q30 ${n(peak)} 77 ${y+28} T220 ${y+24} V320H-20Z`,`fill="${ink}" opacity="${.12+i*.08}" stroke="none"`));
        }
        out.push(circle(cx,62,17+r()*9,`fill="${accent}" opacity=".75" stroke="none"`));
        for(let i=0;i<4;i++) out.push(path(`M${n(cx-30+i*12)} ${90+i*6}q4 -6 8 0q4 -5 8 0`));
        break;
      case 'woodcut':
        out.push(circle(cx,95,45,`fill="${accent}" opacity=".45" stroke="none"`));
        for(let i=0;i<12;i++) out.push(path(`M-20 ${130+i*12}Q${n(cx-60)} ${n(25+i*9)} ${cx} ${150+i*10}T225 ${110+i*13}`,`stroke="${ink}" stroke-width="${i%3===0?4:1.5}"`));
        break;
      case 'deco':
        for(let i=0;i<17;i++) out.push(path(`M100 280L${-85+i*24} ${n(25+Math.abs(i-8)*7+r()*10)}`,`stroke-width="${i%4===0?2.5:.8}"`));
        for(let i=0;i<4;i++) out.push(path(`M${22+i*13} 290V${80+i*20}L100 ${25+i*20}L${178-i*13} ${80+i*20}V290`));
        out.push(path(`M${cx} 155l24 36-24 36-24-36Z`,`fill="${accent}" opacity=".6"`));
        break;
      case 'gothic':
        for(let i=0;i<3;i++) {
          const x=15+i*58, top=n(30+r()*28);
          out.push(path(`M${x} 286V112Q${x} ${top+24} ${x+27} ${top}Q${x+54} ${top+24} ${x+54} 112V286Z`,`fill="${ink}" fill-opacity=".09" stroke-width="1.4"`));
          out.push(path(`M${x+27} ${top+12}V286 M${x} 130H${x+54} M${x} 260H${x+54}`));
          for(let j=0;j<5;j++) out.push(circle(x+27+Math.cos(j*1.257)*13,101+Math.sin(j*1.257)*13,8));
        }
        break;
      case 'celestial':
        out.push(circle(cx,cy,58),circle(cx,cy,72,'stroke-dasharray="1 5"'));
        for(let i=0;i<4;i++) out.push(`<ellipse cx="${cx}" cy="${cy}" rx="28" ry="110" transform="rotate(${i*45} ${cx} ${cy})"/>`);
        out.push(path(`M${cx} ${cy-26}l7 19 20 7-20 7-7 19-7-19-20-7 20-7Z`,`fill="${accent}"`));
        out.push(circle(40,52,13,`fill="${ink}"`));
        break;
      case 'cyber':
        for(let i=0;i<12;i++) {
          const x=n(8+r()*150), y=n(10+r()*270);
          out.push(path(`M${x} ${y}h24l18 18v36h-12`, `stroke-width="${i%3===0?3:1}"`));
          out.push(rect(x,y,5,5,`fill="${accent}"`));
        }
        for(let i=0;i<8;i++) out.push(rect(12+i*22,240+r()*40,12+r()*5,4,`fill="${ink}" opacity=".7"`));
        break;
      case 'blueprint':
        for(let i=0;i<15;i++) out.push(path(`M0 ${i*20}H200 M${i*20} 0V300`,'opacity=".2"'));
        out.push(circle(cx,cy,54),circle(cx,cy,25,'stroke-dasharray="3 3"'));
        out.push(path(`M${cx-70} ${cy}H${cx+70} M${cx} ${cy-70}V${cy+70} M22 40H174V268H22Z M30 280H170 M30 275V285 M170 275V285`));
        out.push(`<polygon points="30,70 80,40 165,80 110,118" fill="${accent}" fill-opacity=".12"/>`);
        break;
      case 'herbarium':
        for(let j=0;j<3;j++) {
          const x=40+j*55, bend=n(r()*25);
          out.push(path(`M${x} 290Q${x+bend} 150 ${x} 32`,'stroke-width="1.4"'));
          for(let i=0;i<5;i++) {
            const y=72+i*41, side=i%2?1:-1, reach=n(20+r()*18)*side;
            out.push(path(`M${x} ${y}q${reach} -35 ${reach} -4q0 21 ${-reach} 4Z`,`fill="${accent}" fill-opacity=".35"`));
          }
        }
        break;
      case 'collage':
        out.push(path(`M12 42L170 24 185 142 153 146 141 154 116 152 91 166 28 157Z`,`fill="${ink}" opacity=".18" stroke="none"`));
        out.push(rect(30,112,140,145,`fill="${accent}" opacity=".28" transform="rotate(${n(-12+r()*24)} 100 190)"`));
        out.push(circle(cx,cy,37,`fill="${ink}" opacity=".7" stroke="none"`));
        for(let i=0;i<9;i++) out.push(path(`M18 ${200+i*8}h${n(50+r()*70)}`,'opacity=".6"'));
        break;
      case 'bauhaus':
        out.push(rect(10,30,70,150,`fill="${ink}" opacity=".65" stroke="none"`));
        out.push(circle(126,90,53,`fill="${accent}" opacity=".8" stroke="none"`));
        out.push(path(`M20 280L${cx} 143 190 280Z`,`fill="${ink}" opacity=".45" stroke="none"`));
        out.push(rect(100,164,70,90,`fill="${accent}" opacity=".65" stroke="none"`));
        break;
      case 'minimal':
        out.push(circle(cx,220,32+r()*18,`fill="${ink}" opacity=".85" stroke="none"`));
        out.push(path(`M20 40H${n(70+r()*40)} M20 47H50`,'stroke-width="2"'));
        out.push(rect(20,280,160,2,`fill="${ink}" stroke="none"`));
        break;
      case 'ocean':
        for(let i=0;i<9;i++) {
          const y=142+i*18;
          out.push(path(`M-10 ${y}Q35 ${y-26} 85 ${y}T210 ${y}V${y+7}Q150 ${y-15} 100 ${y+8}T-10 ${y+5}Z`,`fill="${ink}" fill-opacity="${.12+i*.045}" stroke="${ink}" stroke-opacity=".3"`));
        }
        out.push(circle(cx,68,30),path(`M${cx} 23l7 38 38 7-38 7-7 38-7-38-38-7 38-7Z`,`fill="${ink}" opacity=".65"`));
        break;
      case 'terrazzo':
        for(let i=0;i<30;i++) {
          const x=n(r()*190),y=n(r()*290),w=n(5+r()*25),h=n(5+r()*30);
          out.push(path(`M${x} ${y}l${w} ${n(-h/3)} ${n(-w/4)} ${h} ${n(-w*.8)} ${n(-h/4)}Z`,`fill="${i%2?ink:accent}" opacity="${.18+r()*.4}" stroke="none"`));
        }
        break;
      case 'manuscript':
        out.push(rect(18,27,36,44,`fill="${accent}" fill-opacity=".4" stroke-width="2"`));
        for(let i=0;i<23;i++) {
          const y=35+i*11;
          out.push(path(`M${i<4?65:20} ${y}q14 -4 28 0t28 0t${n(25+r()*50)} 0`,`stroke="${ink}" opacity=".4" stroke-width="1.5"`));
        }
        out.push(path('M9 12h32M9 12v70M191 288h-32M191 288v-70','stroke-width="3"'));
        break;
      case 'noir':
        out.push(path(`M${cx} 40L-20 300H220Z`,`fill="${ink}" opacity=".12" stroke="none"`));
        for(let i=0;i<12;i++) out.push(path(`M-20 ${i*28}L220 ${i*28-64}`,'stroke-width="9" opacity=".25"'));
        for(let i=0;i<10;i++) out.push(rect(i*21,205+r()*45,19,100,`fill="${ink}" opacity=".7" stroke="none"`));
        break;
      case 'tapestry':
        for(let y=22;y<300;y+=44) for(let x=18;x<200;x+=41) {
          const s=n(9+r()*7);
          out.push(path(`M${x} ${y-s}q${s*2} ${s} 0 ${s*2}q${-s*2} ${-s} 0 ${-s*2}Z`,`fill="${accent}" fill-opacity=".28"`));
          out.push(circle(x,y,2,`fill="${ink}"`));
        }
        break;
    }
    return `<g data-art-direction="${design.direction}">${out.join('')}</g>`;
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
    parts.push(directionArt(design));
    // A restrained genre motif still connects hybrid subjects without drowning the art direction.
    if (design.direction !== 'minimal') parts.push(`<g opacity=".12">${pattern(design.pattern)}</g>`);
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
    return [d.direction,d.structure,d.material,d.layout,d.composition,d.pattern,d.secondaryPattern,d.frame].join('|');
  }
  return { generate, ornament, structuralSignature, normalize, MATERIALS, GENRES, STYLES };
});
