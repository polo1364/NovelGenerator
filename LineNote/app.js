/**
 * 小說 TXT → LINE 記事本（單檔版，不依賴 ES Module）
 */
(function () {
  'use strict';

  const DEFAULT_CHAR_LIMIT = 9800;
  const CHAPTER_PATTERN =
    /^(?:第[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+[章節回卷部集篇]|序章|楔子|引子|前言|尾聲|終章|番外|後記)/;

  function isChapterHeadingLine(line) {
    return CHAPTER_PATTERN.test(line.trim());
  }

  function isDecorativeLine(line) {
    const stripped = line.replace(/\s/g, '');
    if (!stripped) return true;
    if (stripped.length >= 3 && /^[-—=─━═_*~·•◆◇■□.…～#]+$/u.test(stripped)) return true;
    return false;
  }

  /** 將過長的重複符號縮短，適合 LINE 記事本閱讀 */
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

  function splitLongTextIntoParagraphs(text) {
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

  function optimizeForLineNote(text) {
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

  function splitByChapters(text) {
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

  function splitByCharLimit(text, charLimit) {
    if (text.length <= charLimit) return [text];

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

  function convertNovelToLineNotes(rawText, charLimit) {
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

  // ── UI ──
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const pickFileBtn = document.getElementById('pickFileBtn');
  const sourceText = document.getElementById('sourceText');
  const sourceStats = document.getElementById('sourceStats');
  const charLimitInput = document.getElementById('charLimit');
  const convertBtn = document.getElementById('convertBtn');
  const copyAllBtn = document.getElementById('copyAllBtn');
  const noteList = document.getElementById('noteList');
  const noteCount = document.getElementById('noteCount');
  const toast = document.getElementById('toast');

  let currentNotes = [];

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function updateSourceStats() {
    const len = sourceText.value.length;
    sourceStats.innerHTML = len ? `原文：<b>${len.toLocaleString()}</b> 字` : '';
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      sourceText.value = String(reader.result || '');
      updateSourceStats();
      runConvert();
      showToast(`已匯入：${file.name}`);
    };
    reader.onerror = () => showToast('讀取檔案失敗');
    reader.readAsText(file, 'UTF-8');
  }

  function charClass(chars, limit) {
    if (chars > limit) return 'char-over';
    if (chars > limit * 0.95) return 'char-warn';
    return 'char-ok';
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`已複製：${label}`);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(ok ? `已複製：${label}` : '複製失敗，請手動選取');
      return ok;
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderNotes(notes, limit) {
    currentNotes = notes;
    copyAllBtn.disabled = notes.length === 0;

    if (notes.length === 0) {
      noteCount.textContent = '';
      noteList.innerHTML =
        '<div class="empty-hint">沒有可輸出的內容，請確認已貼上小說文字</div>';
      return;
    }

    noteCount.textContent = `（共 ${notes.length} 則）`;

    noteList.innerHTML = notes
      .map(
        (note) => `
    <article class="note-item" data-index="${note.index}">
      <div class="note-header">
        <h3 title="${escapeHtml(note.label)}">${note.index}. ${escapeHtml(note.label)}</h3>
        <span class="note-meta ${charClass(note.chars, limit)}">${note.chars.toLocaleString()} / ${limit.toLocaleString()} 字</span>
        <button type="button" class="btn btn-copy" data-copy="${note.index}">複製</button>
      </div>
      <div class="note-preview">${escapeHtml(note.text)}</div>
    </article>`
      )
      .join('');

    noteList.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.copy);
        const note = notes.find((n) => n.index === idx);
        if (!note) return;
        const ok = await copyText(note.text, note.label);
        if (ok) {
          btn.classList.add('copied');
          btn.textContent = '已複製';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.textContent = '複製';
          }, 1500);
        }
      });
    });
  }

  function runConvert() {
    const raw = sourceText.value.trim();
    const limit = Math.min(
      10000,
      Math.max(500, Number(charLimitInput.value) || DEFAULT_CHAR_LIMIT)
    );
    charLimitInput.value = limit;

    if (!raw) {
      renderNotes([], limit);
      return;
    }

    const notes = convertNovelToLineNotes(raw, limit);
    renderNotes(notes, limit);

    if (notes.length) {
      showToast(`已切分為 ${notes.length} 則記事本`);
    }
  }

  function openFilePicker(e) {
    if (e) e.preventDefault();
    if (fileInput) fileInput.click();
  }

  // 檔案選擇（change 事件為主要入口）
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    readFile(file);
    fileInput.value = '';
  });

  // 備用按鈕（部分環境 label 行為異常時）
  if (pickFileBtn) {
    pickFileBtn.addEventListener('click', openFilePicker);
  }

  // 拖放
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  sourceText.addEventListener('input', updateSourceStats);
  convertBtn.addEventListener('click', runConvert);

  copyAllBtn.addEventListener('click', async () => {
    if (!currentNotes.length) return;
    const separator = '\n\n——\n\n';
    const all = currentNotes.map((n) => n.text).join(separator);
    await copyText(all, `全部 ${currentNotes.length} 則（以分隔線區隔）`);
  });

  updateSourceStats();
})();
