/**
 * 小說 TXT → LINE 記事本格式轉換
 * 清理 Markdown、整理段落、依字數／章節切分為可貼上的記事本片段
 */

/** LINE 記事本單則字數上限（預留緩衝） */
export const DEFAULT_CHAR_LIMIT = 9800;

const CHAPTER_PATTERN =
  /^(?:第[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+[章節回卷部集篇]|序章|楔子|引子|前言|尾聲|終章|番外|後記)/;

export function isChapterHeadingLine(line) {
  return CHAPTER_PATTERN.test(line.trim());
}

function isDecorativeLine(line) {
  const stripped = line.replace(/\s/g, '');
  if (!stripped) return true;
  if (stripped.length >= 3 && /^[-—=─━═_*~·•◆◇■□.…～#]+$/u.test(stripped)) return true;
  return false;
}

function collapseSymbolRuns(text) {
  return text
    .replace(/[-—=─━═]{3,}/g, '——')
    .replace(/[…．.]{4,}/g, '……')
    .replace(/[*]{4,}/g, '***')
    .replace(/[~～]{3,}/g, '～')
    .replace(/[_]{3,}/g, '')
    .replace(/[#]{3,}/g, '')
    .replace(/[·•]{3,}/g, '·');
}

export function splitLongTextIntoParagraphs(text) {
  text = text.trim();
  if (!text) return [];
  if (text.length <= 120) return [text];

  const sentences = text
    .split(/(?<=[。！？…」』】）])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return [text];

  const paras = [];
  let buf = '';
  for (const s of sentences) {
    const candidate = buf + s;
    const endCount = (buf.match(/[。！？…]/g) || []).length;
    if (buf && (candidate.length > 200 || endCount >= 2)) {
      paras.push(buf.trim());
      buf = s;
    } else {
      buf = candidate;
    }
  }
  if (buf.trim()) paras.push(buf.trim());
  return paras.length ? paras : [text];
}

/**
 * 將原始小說文字整理為適合 LINE 記事本的純文字
 */
export function optimizeForLineNote(text) {
  if (!text) return '';

  text = text.replace(/\uFFFD/g, '').replace(/\r\n/g, '\n').trim();
  text = collapseSymbolRuns(text);
  const outputParts = [];

  const pushBody = (raw) => {
    const cleaned = collapseSymbolRuns(raw.trim());
    if (!cleaned || isDecorativeLine(cleaned)) return;
    if (cleaned.length > 150) {
      splitLongTextIntoParagraphs(cleaned).forEach((p) =>
        outputParts.push({ kind: 'body', text: p })
      );
    } else {
      outputParts.push({ kind: 'body', text: cleaned });
    }
  };

  const coarseBlocks = text.split(/\n{2,}/);
  for (const block of coarseBlocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock || isDecorativeLine(trimmedBlock)) continue;

    const lines = trimmedBlock
      .split('\n')
      .map((line) =>
        line
          .trim()
          .replace(/^#{1,4}\s*/, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/__(.+?)__/g, '$1')
          .replace(/~~(.+?)~~/g, '$1')
          .trim()
      )
      .filter(Boolean);

    if (lines.length === 0) continue;

    if (lines.length === 1) {
      const line = lines[0];
      if (isChapterHeadingLine(line)) {
        outputParts.push({ kind: 'title', text: line });
      } else {
        pushBody(line);
      }
      continue;
    }

    for (const line of lines) {
      if (isChapterHeadingLine(line)) {
        outputParts.push({ kind: 'title', text: line });
      } else {
        pushBody(line);
      }
    }
  }

  if (outputParts.length === 0) {
    const plain = text.replace(/^#{1,4}\s*/gm, '').replace(/\n+/g, '');
    splitLongTextIntoParagraphs(plain).forEach((p) =>
      outputParts.push({ kind: 'body', text: p })
    );
  }

  let result = '';
  for (const part of outputParts) {
    if (part.kind === 'title') {
      result += `\n\n${part.text}\n\n`;
    } else {
      result += `　　${part.text}\n\n`;
    }
  }

  return result.trim();
}

/**
 * 依章節標題切分全文
 * @returns {{ title: string, body: string }[]}
 */
export function splitByChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  let currentTitle = '前言';
  let currentLines = [];

  const flush = () => {
    const body = currentLines.join('\n').trim();
    if (body || chapters.length === 0) {
      chapters.push({ title: currentTitle, body });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (isChapterHeadingLine(trimmed)) {
      flush();
      currentTitle = trimmed;
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return chapters.filter((c) => c.body);
}

/**
 * 將過長文字依段落邊界切分，每段不超過 charLimit
 */
export function splitByCharLimit(text, charLimit = DEFAULT_CHAR_LIMIT) {
  if (text.length <= charLimit) {
    return [text];
  }

  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  const chunks = [];
  let buf = '';

  const pushBuf = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = '';
  };

  for (const para of paragraphs) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length <= charLimit) {
      buf = candidate;
      continue;
    }

    if (buf) pushBuf();

    if (para.length <= charLimit) {
      buf = para;
      continue;
    }

    // 單段仍超長：依句子再切
    const sentences = splitLongTextIntoParagraphs(para);
    for (const s of sentences) {
      const next = buf ? `${buf}\n\n${s}` : s;
      if (next.length <= charLimit) {
        buf = next;
      } else {
        pushBuf();
        if (s.length <= charLimit) {
          buf = s;
        } else {
          // 硬切保底
          for (let i = 0; i < s.length; i += charLimit) {
            chunks.push(s.slice(i, i + charLimit));
          }
        }
      }
    }
  }

  pushBuf();
  return chunks;
}

/**
 * 完整轉換流程：整理格式 → 切章 → 依字數上限再切
 * @returns {{ index: number, label: string, text: string, chars: number }[]}
 */
export function convertNovelToLineNotes(rawText, charLimit = DEFAULT_CHAR_LIMIT) {
  const optimized = optimizeForLineNote(rawText);
  if (!optimized) return [];

  let chapters = splitByChapters(optimized);
  if (chapters.length === 0) {
    chapters = [{ title: '全文', body: optimized }];
  }

  const notes = [];

  for (const chapter of chapters) {
    const header = chapter.title;
    const chunks = splitByCharLimit(chapter.body, charLimit - header.length - 4);

    chunks.forEach((chunk, i) => {
      const partLabel = chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : '';
      const label = `${header}${partLabel}`;
      const text = `${label}\n\n${chunk}`;
      notes.push({
        index: notes.length + 1,
        label,
        text,
        chars: text.length,
      });
    });
  }

  return notes;
}
