#!/usr/bin/env node
/**
 * 批次為舊書籤 AI 命名
 * 用法：node scripts/rename-bookmarks.js <輸入.json> [輸出.json]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/chat/completions';
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.RENAME_MODEL || 'deepseek-v4-flash';

function cleanBookTitle(raw) {
  let t = (raw || '').replace(/\uFFFD/g, '').trim();
  t = (t.split('\n').map(s => s.trim()).find(Boolean)) || '';
  t = t
    .replace(/^(書名|片名|標題|title)\s*[:：]\s*/i, '')
    .replace(/^[《【「『\[\("'`]+/, '')
    .replace(/[》】」』\]\)"'`]+$/, '')
    .replace(/[。！？!?．.]+$/, '')
    .trim();
  return t.slice(0, 20);
}

function extractContext(content) {
  const text = (content || '').replace(/\r\n/g, '\n');
  // 去掉開頭 AI 廢話
  const cleaned = text.replace(/^好的[，,].*?\n+/s, '').trim();
  // 取前 2500 字作為命名依據
  return cleaned.slice(0, 2500);
}

function hasBookTitleLine(content) {
  return /^#\s+[《【]?[^#\n]{2,20}[》】]?\s*$/m.test((content || '').slice(0, 200));
}

function prependBookTitle(content, title) {
  if (hasBookTitleLine(content)) {
    return content.replace(/^#\s+.+$/m, `# 《${title}》`);
  }
  return `# 《${title}》\n\n${content}`;
}

async function generateTitle(context, index, total) {
  const prompt = `你是專業的小說命名編輯。請根據下方小說開頭片段，為這部繁體中文小說取一個吸引人、貼合內容的「全書書名」（不是章節標題）。

【嚴格要求】
1. 只輸出書名本身，不要任何解釋、引號、書名號、標點符號或多餘文字
2. 長度 4～12 個字，必須具體呼應故事世界觀與氛圍，避免空泛
3. 不要直接使用章節小標題（如「羅盤裂」「血月之夜」），要提煉成整本書的書名
4. 不要出現「書名」「以下」「這是」「好的」等字樣
5. 繁體中文，禁止簡體字

【小說開頭片段】
${context}

請直接輸出書名：`;

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
      temperature: 0.85,
      max_tokens: 60,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const title = cleanBookTitle(raw);
  if (!title) throw new Error('空書名：' + JSON.stringify(raw).slice(0, 80));
  console.log(`  [${index}/${total}] → 《${title}》`);
  return title;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('用法：node scripts/rename-bookmarks.js <輸入.json> [輸出.json]');
    process.exit(1);
  }
  if (!API_KEY) {
    console.error('請在 .env 設定 DEEPSEEK_API_KEY');
    process.exit(1);
  }

  const absIn = path.resolve(inputPath);
  const absOut = path.resolve(
    process.argv[3] ||
      absIn.replace(/\.json$/i, '') + '_已命名.json'
  );

  const bookmarks = JSON.parse(fs.readFileSync(absIn, 'utf8'));
  if (!Array.isArray(bookmarks)) {
    console.error('JSON 必須是書籤陣列');
    process.exit(1);
  }

  console.log(`讀取 ${bookmarks.length} 筆書籤，開始 AI 命名...\n`);

  const results = [];
  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const oldTitle = (bm.title || '').slice(0, 40);
    console.log(`#${i + 1} 舊：${oldTitle}${bm.title?.length > 40 ? '…' : ''}`);

    try {
      const context = extractContext(bm.content || bm.title || '');
      const newTitle = await generateTitle(context, i + 1, bookmarks.length);
      bm.title = newTitle;
      if (bm.content) bm.content = prependBookTitle(bm.content, newTitle);
      results.push({ id: bm.id, old: oldTitle, new: newTitle, ok: true });
    } catch (err) {
      console.error(`  ✗ 失敗：${err.message}`);
      results.push({ id: bm.id, old: oldTitle, ok: false, error: err.message });
    }

    if (i < bookmarks.length - 1) await sleep(600);
  }

  fs.writeFileSync(absOut, JSON.stringify(bookmarks, null, 2), 'utf8');
  console.log(`\n✅ 已寫入：${absOut}`);

  const ok = results.filter(r => r.ok);
  console.log(`成功 ${ok.length}/${bookmarks.length}`);
  if (ok.length) {
    console.log('\n書名對照：');
    ok.forEach(r => console.log(`  《${r.new}》  ←  ${r.old}…`));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
