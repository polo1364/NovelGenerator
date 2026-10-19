/* Presentation only: the app owns story text, chapter parsing and every action. */
(function () {
  'use strict';
  const get = id => document.getElementById(id);
  const result = get('result');
  const scene = get('readingScene');
  if (!result || !scene) return;
  const viewport = get('verticalViewport');
  const index = get('manuscriptChapters');
  const follow = get('manuscriptFollow');
  let chapters = [];
  let pending = false;
  let artKey = null;

  function updateArt(title) {
    if (title === artKey || !window.BookDesign) return;
    artKey = title;
    const library = window.BookDesign;
    const name = library.normalize(title);
    const known = [...library.GENRES, ...library.STYLES].some(group => group.words.some(word => name.includes(library.normalize(word))));
    const design = library.generate(title, 'current-manuscript');
    // This is decorative binding art, not an invented scene from the story.
    // Unknown titles use nonfigurative geometry rather than a random genre.
    const art = { ...design, titleBox: [94,144,12,12] };
    if (!known) {
      art.direction = ['woodcut','bauhaus','collage','terrazzo'][parseInt(design.seed,16) % 4];
      art.pattern = 'geometry';
      art.secondaryPattern = null;
      art.color = '#3d443e';
      art.ink = '#e8ddc6';
      art.accent = '#c7a97e';
    }
    const svg = library.ornament(art).replace('<svg ', `<svg style="color:${art.ink}" `);
    scene.style.setProperty('--ms-art', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    scene.style.setProperty('--ms-art-paper', art.color);
    scene.style.setProperty('--ms-art-ink', art.ink);
    scene.dataset.artDirection = art.direction;
    scene.dataset.artSource = known ? 'title' : 'abstract';
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  const isVertical = () => result.classList.contains('vertical-writing');

  // 原稿紙一字一格：英數、空白、破折號、框線、部分符號在字型裡寬度不是一格，各包成一格寬，後面的字才不會錯位。textContent 不變。
  const HALF_WIDTH = /[\u0020-\u007E\u00A0-\u00FF\u2010-\u2015\u2025\u2500-\u25FF]+/g;
  const LONG_DASH = /[\u2014\u2015\u2500\u2501]/;        // 畫成貫穿整格的線，「——」才會連成一條
  const SIDEWAYS = /[\u2010-\u2013\u2025\u2502-\u257F]/; // 直排時跟著轉向，不強制直立
  function appendText(target, text) {
    let last = 0;
    for (const match of text.matchAll(HALF_WIDTH)) {
      if (match.index > last) target.append(document.createTextNode(text.slice(last, match.index)));
      for (const ch of match[0]) {
        const cell = document.createElement('span');
        cell.className = 'manuscript-hw' + (LONG_DASH.test(ch) ? ' manuscript-dash' : SIDEWAYS.test(ch) ? ' manuscript-sideways' : '');
        cell.textContent = ch;
        target.append(cell);
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) target.append(document.createTextNode(text.slice(last)));
  }

  // 長篇分段：每章（過長的章再於換行處切開）放進一個區塊，區塊用 content-visibility: auto，
  // 瀏覽器只排畫面附近的章節，數萬字的手稿載入時才不會整份排字。textContent 不變。
  const CHUNK_CHARS = 4000;
  function chunkEl(parent) {
    const el = document.createElement('span');
    el.className = 'manuscript-chunk';
    parent.append(el);
    return el;
  }
  function appendChunkedText(parent, text, chunk) {
    let from = 0;
    while (text.length - from > CHUNK_CHARS) {
      const cut = text.indexOf('\n', from + CHUNK_CHARS);
      if (cut < 0) break;
      appendText(chunk, text.slice(from, cut + 1));
      chunk = chunkEl(parent);
      from = cut + 1;
    }
    appendText(chunk, text.slice(from));
    return chunk;
  }

  function activeChapter() {
    const headings = [...result.querySelectorAll('.manuscript-chapter')];
    if (!headings.length) return;
    const box = viewport.getBoundingClientRect();
    let active = 0;
    // 直排由右往左讀：章名的右緣進到視窗右側就算讀到了
    headings.forEach((heading, i) => {
      // 還沒排版的章節：用所在區塊的位置，不為了讀章名位置強迫整段排版
      const skipped = heading.checkVisibility && !heading.checkVisibility({ contentVisibilityAuto: true });
      const rect = (skipped ? heading.closest('.manuscript-chunk') || heading : heading).getBoundingClientRect();
      if (isVertical() ? rect.right >= box.right - 60 : rect.top <= box.top + 60) active = i;
    });
    index.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-current', String(i === active)));
  }

  function decorate() {
    if (document.body.classList.contains('is-generating')) return;
    // Speech owns its highlight; a legacy target can be redecorated on return.
    if (result.querySelector('.speaking-segment, .manuscript-chapter')) return;
    const text = result.textContent;
    const valid = chapters.filter(chapter => chapter.fullLine && text.slice(chapter.index, chapter.index + chapter.fullLine.length) === chapter.fullLine);
    if (!valid.length) {
      // 沒有章名也要把半形字包成一格、長文分段
      if (!result.querySelector('.manuscript-hw, .manuscript-chunk') && (text.match(HALF_WIDTH) || text.length > CHUNK_CHARS)) {
        const fragment = document.createDocumentFragment();
        appendChunkedText(fragment, text, chunkEl(fragment));
        result.replaceChildren(fragment);
      }
      result.classList.remove('awaiting-layout');
      return;
    }
    const fragment = document.createDocumentFragment();
    let chunk = chunkEl(fragment);
    let start = 0;
    valid.forEach((chapter, i) => {
      const before = text.slice(start, chapter.index);
      if (i === 0 && /^\s*# [^\n]+\s*$/.test(before)) {
        const bookTitle = document.createElement('span');
        bookTitle.className = 'manuscript-markdown';
        bookTitle.textContent = before;
        chunk.append(bookTitle);
      } else {
        chunk = appendChunkedText(fragment, before, chunk);
      }
      if (chunk.childNodes.length) chunk = chunkEl(fragment);
      const heading = document.createElement('span');
      heading.className = 'manuscript-chapter';
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '2');
      heading.dataset.chapter = String(chapters.indexOf(chapter));
      heading.dataset.number = String(i + 1).padStart(2, '0');
      // Keep Markdown and whitespace in textContent for export / raw-text offsets.
      const prefix = chapter.fullLine.match(/^\s*#{1,4}\s*/)?.[0] || '';
      if (prefix) {
        const marker = document.createElement('span');
        marker.className = 'manuscript-markdown';
        marker.textContent = prefix;
        heading.append(marker);
      }
      const title = chapter.fullLine.slice(prefix.length);
      const chapterLabel = title.match(/^(?:第[^\s：:]+章|序章|楔子|引子|前言|尾聲|終章|番外|後記)[\s：:]+/u)?.[0] || '';
      if (chapterLabel) {
        const label = document.createElement('span');
        label.className = 'manuscript-chapter-label';
        appendText(label, chapterLabel);
        heading.append(label);
      }
      appendText(heading, title.slice(chapterLabel.length));
      chunk.append(heading);
      start = chapter.index + chapter.fullLine.length;
      const space = text.slice(start).match(/^[\t \r\n]+/)?.[0] || '';
      if (space) {
        const spacing = document.createElement('span');
        spacing.className = 'manuscript-markdown';
        spacing.textContent = space;
        heading.append(spacing);
        start += space.length;
      }
    });
    appendChunkedText(fragment, text.slice(start), chunk);
    const position = [viewport.scrollTop, viewport.scrollLeft];
    result.replaceChildren(fragment);
    result.classList.remove('awaiting-layout');
    [viewport.scrollTop, viewport.scrollLeft] = position;
    activeChapter();
  }

  function update() {
    pending = false;
    const text = result.textContent;
    if (!text.trim() && chapters.length) {
      chapters = [];
      index.replaceChildren();
    }
    const title = text.split('\n').find(line => /^#\s+\S/.test(line));
    const bookName = title ? title.replace(/^#\s+/, '').trim()
      : (text.trim() && typeof getBookName === 'function' ? getBookName({ title: '', content: text }) : '');
    setText(get('manuscriptTitle'), bookName || '未命名手稿');
    updateArt(bookName);
    scene.classList.toggle('manuscript-has-text', Boolean(text.trim()));
    get('manuscriptEmptyIndex').hidden = chapters.length > 0;
    const busy = document.body.classList.contains('is-generating');
    const status = busy
      ? [get('generationStage').textContent, get('progressWords').textContent, get('progressTime').textContent].join(' · ')
      : (get('status').querySelector('.status-text')?.textContent || (text.trim() ? '手稿已載入' : '準備開始創作'));
    setText(get('manuscriptStatus'), status);
    get('manuscriptContinue').disabled = get('primaryContinueBtn').disabled;
    get('manuscriptSave').disabled = !text.trim() || busy;
    for (const [name, original] of [['Read','bookReaderBtn'],['Speak','speakBtn']]) {
      get('manuscript' + name).disabled = get(original).disabled;
    }
    scene.querySelectorAll('[data-manuscript-format]').forEach(button => { button.disabled = get('downloadBtn').disabled; });
    const vertical = result.classList.contains('vertical-writing');
    get('manuscriptHorizontal').setAttribute('aria-pressed', String(!vertical));
    get('manuscriptVertical').setAttribute('aria-pressed', String(vertical));
    decorate();
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }

  function jumpTo(chapterIndex) {
    const heading = result.querySelector(`.manuscript-chapter[data-chapter="${chapterIndex}"]`);
    if (!heading) return false;
    follow.checked = false;
    const rect = heading.getBoundingClientRect(), box = viewport.getBoundingClientRect();
    if (isVertical()) viewport.scrollLeft += rect.right - box.right + 24;
    else viewport.scrollTop += rect.top - box.top - 24;
    activeChapter();
    return true;
  }

  window.ManuscriptWorkspace = {
    shouldFollow: () => follow.checked,
    plainText() {
      if (result.querySelector('.manuscript-chapter')) result.textContent = result.textContent;
    },
    jumpTo,
    setChapters(matches) {
      chapters = matches.map(chapter => ({ ...chapter }));
      index.replaceChildren();
      chapters.forEach((chapter, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.number = String(i + 1).padStart(2, '0');
        button.textContent = chapter.title;
        button.setAttribute('aria-current', String(i === 0));
        button.addEventListener('click', () => {
          if (!jumpTo(i)) get('chapterNavList').querySelectorAll('button')[i]?.click();
          index.querySelectorAll('button').forEach((item, j) => item.setAttribute('aria-current', String(i === j)));
        });
        index.append(button);
      });
      schedule();
    }
  };

  for (const [name, original] of [['Shelf','bookmarkNavToggle'],['Save','addBookmarkBtn'],['Read','bookReaderBtn'],['Speak','speakBtn'],['Continue','primaryContinueBtn'],['Horizontal','horizontalWritingBtn'],['Vertical','verticalWritingBtn']]) {
    get('manuscript' + name).addEventListener('click', () => get(original).click());
  }
  scene.querySelectorAll('[data-manuscript-format]').forEach(button => button.addEventListener('click', () => {
    get('toolbarDownloadMenu').querySelector(`[data-format="${button.dataset.manuscriptFormat}"]`).click();
    button.closest('details').open = false;
  }));
  get('manuscriptLatest').addEventListener('click', () => {
    follow.checked = true;
    scrollOutputToEnd();
  });
  viewport.addEventListener('wheel', event => {
    if (event.deltaY < 0 || event.deltaX < 0) follow.checked = false;
  }, { passive: true });
  viewport.addEventListener('touchstart', () => { follow.checked = false; }, { passive: true });
  viewport.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowLeft','PageUp','Home'].includes(event.key)) follow.checked = false;
  });
  viewport.addEventListener('scroll', activeChapter, { passive: true });
  // The inline index replaces the redundant floating chapter tab while reading.
  new IntersectionObserver(entries => {
    document.body.classList.toggle('manuscript-in-view', entries[0].isIntersecting);
  }).observe(scene);
  new MutationObserver(schedule).observe(result, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  for (const id of ['status','generationProgress','primaryContinueBtn','downloadBtn','bookReaderBtn','speakBtn']) {
    new MutationObserver(schedule).observe(get(id), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  }
  schedule();
})();
