/**
 * 小說對話角色／情緒分析（移植自 extx lib/deepseek.js）
 */
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/chat/completions';

const ROLE_SYSTEM_PROMPT =
  '你是小說對話分析助手，只輸出 JSON，不要任何解釋或 markdown。';

const ROLE_USER_PROMPT = `你是嚴謹的小說對話分析器。將下列文字切成連續片段，標註每段的說話者類型、性別與情緒。

【最高原則｜不可違反】
A. 所有片段的 "t" 依序「逐字拼接」後，必須與原文「完全一致」：包含每一個標點、空白、換行、引號，禁止增加、刪除、修改、改寫、重排任何字元。
B. 寧可切細也不要漏字。若不確定如何標註，就整段標為旁白(n)，但文字仍要完整保留。

【切分規則】
1. 對話（被「」『』" "“”包住的內容）與旁白要切成不同片段。
2. 引號本身要包含在對話片段內。說話標籤（如「他說」「她笑道」「李四怒吼」）屬於旁白(n)，不要併入對話。
3. 同一段引號內若情緒明顯轉折，可再切分為多段。

【角色判斷】
4. g：n=旁白/敘述，m=男性角色台詞，f=女性角色台詞；對話但無法判斷性別時用 n。
5. 同一個「具名角色」在全文性別需一致；可用稱謂（他/她）、角色名、上下文動作判斷。
6. 內心獨白、書信、引述他人原話，依其說話者性別判斷；無從判斷則 n。

【情緒判斷】
7. e 從這些擇一：neutral(平靜)、happy(開心)、excited(興奮/激動)、sad(難過/哽咽)、angry(生氣/怒吼)、fear(害怕/緊張)、gentle(溫柔/親密)、whisper(低語/輕聲)、cold(冷漠/譏諷)、serious(嚴肅/堅定)。
8. 依說話標籤與內容判斷（例：「怒吼」→angry、「哽咽」→sad、「低聲」→whisper、「冷笑」→cold）。旁白多為 neutral，必要時 serious 或 gentle。

【輸出格式】
只輸出 JSON 陣列，每元素為 {"g":"n|m|f","e":"情緒碼","t":"原文片段"}，不要任何解釋或 markdown。

文字：
`;

const VALID_EMOTIONS = ['neutral', 'happy', 'excited', 'sad', 'angry', 'fear', 'gentle', 'whisper', 'cold', 'serious'];

function stripJsonFence(s) {
  return String(s || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function quoteDelta(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === '「' || ch === '『') d++;
    else if (ch === '」' || ch === '』') d--;
  }
  return d;
}

function splitTextIntoBlocks(text, maxLen = 1500) {
  if (!text) return [];
  if (text.length <= maxLen) return [text];
  const blocks = [];
  const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]?/g) || [text];
  const hardMax = Math.floor(maxLen * 1.6);
  let cur = '';
  let depth = 0;
  for (const s of sentences) {
    const limit = depth > 0 ? hardMax : maxLen;
    if (cur && cur.length + s.length > limit) {
      blocks.push(cur);
      cur = '';
      depth = 0;
    }
    if (s.length > hardMax) {
      for (let i = 0; i < s.length; i += maxLen) blocks.push(s.slice(i, i + maxLen));
      cur = '';
      depth = 0;
    } else {
      cur += s;
      depth += quoteDelta(s);
      if (depth < 0) depth = 0;
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function realignSegments(block, rawSegs) {
  const out = [];
  let pos = 0;
  let matched = 0;

  for (const seg of rawSegs) {
    const t = seg.t;
    if (!t) continue;
    let idx = block.indexOf(t, pos);
    let useLen = t.length;
    if (idx === -1) {
      const tt = t.trim();
      if (tt && tt.length) {
        idx = block.indexOf(tt, pos);
        if (idx !== -1) useLen = tt.length;
      }
    }
    if (idx === -1) continue;

    if (idx > pos) {
      out.push({ g: 'n', e: 'neutral', t: block.slice(pos, idx) });
    }
    out.push({ g: seg.g, e: seg.e, t: block.slice(idx, idx + useLen) });
    pos = idx + useLen;
    matched++;
  }

  if (pos < block.length) {
    out.push({ g: 'n', e: 'neutral', t: block.slice(pos) });
  }

  const merged = [];
  for (const s of out) {
    if (!s.t) continue;
    const last = merged[merged.length - 1];
    if (last && last.g === s.g && last.e === s.e) last.t += s.t;
    else merged.push({ ...s });
  }
  return { segs: merged, matched };
}

async function analyzeRoleBlock(apiKey, block) {
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: ROLE_SYSTEM_PROMPT },
        { role: 'user', content: ROLE_USER_PROMPT + block }
      ],
      temperature: 0,
      max_tokens: Math.min(8192, Math.ceil(block.length * 1.9) + 512)
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API 錯誤 (${response.status})`);
  }

  const data = await response.json();
  const raw = stripJsonFence(data.choices?.[0]?.message?.content);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('DeepSeek 回傳格式無法解析');
  }
  if (!Array.isArray(parsed)) throw new Error('DeepSeek 回傳非陣列');

  const rawSegs = parsed
    .map((it) => ({
      g: it && (it.g === 'm' || it.g === 'f') ? it.g : 'n',
      e: it && VALID_EMOTIONS.includes(it.e) ? it.e : 'neutral',
      t: typeof it?.t === 'string' ? it.t : ''
    }))
    .filter((s) => s.t.length > 0);

  const { segs, matched } = realignSegments(block, rawSegs);
  if (!segs.length || matched === 0) {
    throw new Error('DeepSeek 切分無法對齊原文');
  }
  return { segs, usage: data.usage || null };
}

async function analyzeRoleBlockWithRetry(apiKey, block, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await analyzeRoleBlock(apiKey, block);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

function addUsage(acc, usage) {
  if (!usage) return acc;
  acc.prompt += usage.prompt_tokens || 0;
  acc.completion += usage.completion_tokens || 0;
  acc.total += usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
  acc.requests += 1;
  return acc;
}

async function analyzeDialogueRoles(apiKey, text, onProgress) {
  if (!apiKey) throw new Error('未設定 DeepSeek API Key');
  const blocks = splitTextIntoBlocks(text, 1800);
  const results = new Array(blocks.length);
  const usage = { prompt: 0, completion: 0, total: 0, requests: 0 };
  let done = 0;
  let next = 0;
  const CONCURRENCY = Math.min(3, blocks.length);

  async function worker() {
    while (next < blocks.length) {
      const i = next++;
      try {
        const r = await analyzeRoleBlockWithRetry(apiKey, blocks[i]);
        results[i] = r.segs;
        addUsage(usage, r.usage);
      } catch {
        results[i] = [{ g: 'n', e: 'neutral', t: blocks[i] }];
      }
      done++;
      if (typeof onProgress === 'function') onProgress(done, blocks.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const segments = [];
  for (const r of results) {
    if (!r) continue;
    for (const s of r) segments.push(s);
  }
  return { segments, usage };
}

module.exports = { analyzeDialogueRoles, splitTextIntoBlocks };
