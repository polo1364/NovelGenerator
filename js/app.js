/* ============================================================
   AI 小說工坊 — 應用程式邏輯
   （由 index.html 內嵌 <script> 抽離，採傳統 script 全域作用域）
   ============================================================ */

      function getSiteBase() {
        var path = location.pathname.replace(/\\/g, '/');
        var low = path.toLowerCase();
        var idx = low.indexOf('/novelgenerator');
        if (idx >= 0) {
          var base = path.substring(0, idx + '/NovelGenerator'.length);
          return base.endsWith('/') ? base : base + '/';
        }
        if (path.endsWith('/')) return path;
        var dir = path.replace(/\/[^/]*$/, '/');
        return dir || '/';
      }

      (function fixReaderSiteLink() {
        var link = document.getElementById('readerSiteLink');
        if (link) link.href = getSiteBase() + 'reader/';
      })();

      // ==================== 離線模式檢測 ====================
      const offlineBanner = document.getElementById('offlineBanner');
      let isOnline = navigator.onLine;

      function updateOnlineStatus() {
        isOnline = navigator.onLine;
        
        if (!isOnline) {
          offlineBanner.textContent = '📴 目前為離線模式 - 朗讀、閱讀、匯出、匯入功能仍可使用';
          offlineBanner.classList.remove('online');
          offlineBanner.classList.add('show');
          
          // 禁用需要網路的按鈕
          if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.title = '離線模式下無法生成故事';
          }
          if (continueBtn) {
            continueBtn.disabled = true;
            continueBtn.title = '離線模式下無法繼續生成';
          }
        } else {
          offlineBanner.textContent = '✅ 已恢復網路連線';
          offlineBanner.classList.add('online');
          offlineBanner.classList.add('show');
          
          // 恢復按鈕
          if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.title = '';
          }
          if (continueBtn && latestStory) {
            continueBtn.disabled = false;
            continueBtn.title = '';
          }
          
          // 3秒後隱藏提示
          setTimeout(() => {
            offlineBanner.classList.remove('show');
          }, 3000);
        }
      }

      // 監聽網路狀態變化
      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);

      // 初始檢查
      if (!navigator.onLine) {
        setTimeout(updateOnlineStatus, 500);
      }

      // ==================== PWA：註冊 Service Worker + 自動更新 ====================
      if ('serviceWorker' in navigator) {
        let swRefreshing = false;

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (swRefreshing) return;
          swRefreshing = true;
          window.location.reload();
        });

        function promptSwUpdate(reg) {
          const waiting = reg.waiting;
          if (!waiting || !navigator.serviceWorker.controller) return;
          // 已有新版在等候 → 通知 SW 立即啟用，controllerchange 會觸發 reload
          if (typeof showStatus === 'function') {
            showStatus('loading', '🔄 發現新版本，正在更新…');
          }
          waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        function watchSwUpdate(reg) {
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed') promptSwUpdate(reg);
            });
          });
        }

        async function checkSwUpdate() {
          try {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
          } catch (e) { /* 離線時略過 */ }
        }

        window.addEventListener('load', () => {
          var base = getSiteBase();
          navigator.serviceWorker.register(base + 'sw.js', { scope: base })
            .then((reg) => {
              watchSwUpdate(reg);
              if (reg.waiting) promptSwUpdate(reg);
              // 每次開啟 / 回到前景時檢查更新（PWA 從主畫面開啟也會觸發）
              checkSwUpdate();
              document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') checkSwUpdate();
              });
            })
            .catch((err) => console.warn('Service Worker 註冊失敗：', err));
        });
      }

      // ==================== 元素取得 ====================
      const modelSelect = document.getElementById('model');
      const themeSelect = document.getElementById('theme');
      const settingSelect = document.getElementById('setting');
      const styleSelect = document.getElementById('style');
      const chaptersInput = document.getElementById('chapters');
      const lengthInput = document.getElementById('length');
      const notesInput = document.getElementById('notes');
      let currentOutline = null;
      let currentBookTitle = '';
      const generateBtn = document.getElementById('generateBtn');
      const downloadBtn = document.getElementById('downloadBtn');
      const continueBtn = document.getElementById('continueBtn');
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      const outputWrap = document.getElementById('outputWrap');
      const verticalViewport = document.getElementById('verticalViewport');

      function isMobileReadingLayout() {
        return window.matchMedia('(max-width: 768px)').matches;
      }

      /** 手機底部橫向工具列佔用的下緣留白；右側 dock 不縮減閱讀高度 */
      function getMobileBottomInset() {
        if (!isMobileReadingLayout()) return 0;
        const toolbar = document.querySelector('.floating-toolbar');
        if (!toolbar) return 10;
        const rect = toolbar.getBoundingClientRect();
        if (rect.height <= 0) return 10;
        const vv = window.visualViewport;
        const visualBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        if (rect.top >= visualBottom - 8) return 10;
        if (rect.top < visualBottom * 0.55) return 10;
        return Math.max(10, Math.ceil(visualBottom - rect.top + 6));
      }

      function syncVerticalViewportHeight() {
        if (!verticalViewport) return;
        if (!isVerticalWriting()) {
          verticalViewport.style.height = '';
          document.body.classList.remove('vertical-reading-mobile');
          return;
        }
        if (!isMobileReadingLayout()) {
          verticalViewport.style.height = '';
          document.body.classList.remove('vertical-reading-mobile');
          return;
        }

        document.body.classList.add('vertical-reading-mobile');

        const vv = window.visualViewport;
        const visualBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        const visualTop = vv ? vv.offsetTop : 0;
        const header = document.querySelector('.reading-scene .output-header');
        const headerBottom = header
          ? header.getBoundingClientRect().bottom
          : verticalViewport.getBoundingClientRect().top;
        const topAnchor = Math.max(headerBottom, visualTop + 4);
        const bottomInset = getMobileBottomInset();
        const viewportH = vv ? vv.height : window.innerHeight;
        let available = Math.floor(visualBottom - topAnchor - bottomInset);
        const maxH = Math.floor(viewportH * 0.88);
        available = Math.min(Math.max(300, available), maxH);
        verticalViewport.style.height = available + 'px';
      }

      function syncVerticalLayout(forStream = false) {
        if (!isVerticalWriting() || !resultDiv || !verticalViewport) return;
        syncVerticalViewportHeight();
        const blockHeight = verticalViewport.clientHeight;
        if (blockHeight <= 0) return;
        resultDiv.style.height = blockHeight + 'px';
        resultDiv.style.width = 'max-content';
        resultDiv.style.display = 'inline-block';
        void resultDiv.offsetWidth;
        const contentWidth = resultDiv.scrollWidth;
        const viewWidth = verticalViewport.clientWidth;
        // 生成中：紙張寬度貼合文字，避免空白紙先長出去、字卻不動
        const minWidth = (forStream && document.body.classList.contains('is-generating'))
          ? contentWidth
          : Math.max(contentWidth, viewWidth);
        resultDiv.style.minWidth = minWidth + 'px';
      }

      /** 直排串流：用 Range 對齊文字，不依賴 scrollLeft 正負方向（各瀏覽器直排實作不同） */
      function scrollVerticalToTextEdge(preferStart) {
        const scroller = getVerticalScroller();
        if (!scroller || !resultDiv) return;
        const generating = document.body.classList.contains('is-generating');
        syncVerticalLayout(generating);
        const textNode = resultDiv.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE || textNode.length === 0) return;
        const len = textNode.length;
        const range = document.createRange();
        if (preferStart) {
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(1, len));
        } else {
          range.setStart(textNode, Math.max(0, len - 1));
          range.setEnd(textNode, len);
        }
        const r = range.getBoundingClientRect();
        const v = scroller.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) return;
        const margin = 28;
        if (preferStart) {
          // 開頭：首字保持在 viewport 右側（直排起點）
          if (r.right > v.right - margin) scroller.scrollLeft += r.right - (v.right - margin);
          if (r.left < v.left + margin) scroller.scrollLeft += r.left - (v.left + margin);
        } else {
          // 追最新：末字保持在 viewport 左側（直排延伸方向）
          if (r.left < v.left + margin) scroller.scrollLeft += r.left - (v.left + margin);
          if (r.right > v.right - margin) scroller.scrollLeft += r.right - (v.right - margin);
        }
      }

      function scrollVerticalStream() {
        if (!isVerticalWriting()) return;
        const scroller = getVerticalScroller();
        if (!scroller || !resultDiv) return;
        const viewWidth = scroller.clientWidth;
        const contentWidth = resultDiv.scrollWidth;
        // 未溢出 → 固定看開頭；已溢出 → 追最新字
        scrollVerticalToTextEdge(contentWidth <= viewWidth);
      }

      function getContentScroller() {
        return verticalViewport || outputWrap;
      }

      function isVerticalWriting() {
        return Boolean(outputWrap && outputWrap.classList.contains('vertical-scroll'));
      }

      function getVerticalScroller() {
        return verticalViewport || outputWrap;
      }

      function getVerticalScrollMax() {
        const scroller = getVerticalScroller();
        if (!scroller) return 0;
        return Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      }

      /** true = 開頭在 scrollLeft 較小端；false = 開頭在 scrollLeft 較大端（依瀏覽器直排實作而異） */
      let verticalScrollStartAtMin = null;

      function isVerticalTextStartInView(scroller) {
        if (!resultDiv || !scroller) return false;
        const textNode = resultDiv.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE || textNode.length === 0) return false;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(1, textNode.length));
        const r = range.getBoundingClientRect();
        const v = scroller.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) return false;
        return r.left < v.right && r.right > v.left && r.top < v.bottom && r.bottom > v.top;
      }

      function detectVerticalScrollOrigin(force = false) {
        if (!force && verticalScrollStartAtMin !== null) return verticalScrollStartAtMin;
        const scroller = getVerticalScroller();
        if (!scroller || !isVerticalWriting()) {
          verticalScrollStartAtMin = true;
          return verticalScrollStartAtMin;
        }
        const max = getVerticalScrollMax();
        if (max <= 0) {
          verticalScrollStartAtMin = true;
          return verticalScrollStartAtMin;
        }
        const saved = scroller.scrollLeft;
        scroller.scrollLeft = 0;
        const startAt0 = isVerticalTextStartInView(scroller);
        scroller.scrollLeft = max;
        const startAtMax = isVerticalTextStartInView(scroller);
        scroller.scrollLeft = saved;
        if (startAt0 && !startAtMax) verticalScrollStartAtMin = true;
        else if (startAtMax && !startAt0) verticalScrollStartAtMin = false;
        else verticalScrollStartAtMin = true;
        return verticalScrollStartAtMin;
      }

      function verticalScrollLeftForStart() {
        detectVerticalScrollOrigin();
        const max = getVerticalScrollMax();
        return verticalScrollStartAtMin ? 0 : max;
      }

      function verticalScrollLeftForLatest() {
        detectVerticalScrollOrigin();
        const max = getVerticalScrollMax();
        if (max <= 0) return 0;
        return verticalScrollStartAtMin ? max : 0;
      }

      function isNearPageBottom(threshold = 140) {
        const scrollPos = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;
        return scrollPos >= docHeight - threshold;
      }
      let verticalScrollToStartPending = false;
      let verticalStartResizeObserver = null;
      // 直排：初次生成時固定顯示開頭（右側），而非跟著串流捲到頁尾
      let streamAnchorStart = false;

      function isNearOutputEnd(threshold = 140) {
        if (isVerticalWriting()) {
          const scroller = getVerticalScroller();
          if (!resultDiv || !scroller) return true;
          const textNode = resultDiv.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE || textNode.length === 0) return true;
          const contentWidth = resultDiv.scrollWidth;
          const viewWidth = scroller.clientWidth;
          if (contentWidth <= viewWidth) return true;
          const range = document.createRange();
          range.setStart(textNode, Math.max(0, textNode.length - 1));
          range.setEnd(textNode, textNode.length);
          const r = range.getBoundingClientRect();
          const v = scroller.getBoundingClientRect();
          return r.left >= v.left - threshold && r.right <= v.right + threshold;
        }
        if (!outputWrap) return isNearPageBottom(threshold);
        if (outputWrap.classList.contains('horizontal-scroll')) {
          const scroller = getContentScroller();
          const scrollPos = scroller.scrollTop + scroller.clientHeight;
          return scrollPos >= scroller.scrollHeight - threshold;
        }
        return isNearPageBottom(threshold);
      }
      function alignVerticalScrollToStart(forStream = false) {
        const scroller = getVerticalScroller();
        if (!scroller || !resultDiv) return false;
        const streaming = forStream || document.body.classList.contains('is-generating');
        syncVerticalLayout(streaming);
        const textNode = resultDiv.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE && textNode.length > 0) {
          scrollVerticalToTextEdge(true);
          return true;
        }
        return false;
      }

      /** 直排：不捲整頁（避免跳頁尾）；橫排才 scrollIntoView */
      function scrollOutputAreaIntoView() {
        if (isVerticalWriting()) return;
        if (resultDiv) resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      /** 清除可能殘留的整頁鎖定（舊版 position:fixed 若未解鎖會導致整站無法捲動） */
      function releaseVerticalPageLock() {
        document.documentElement.classList.remove('vertical-generating-lock');
        document.body.classList.remove('vertical-generating-lock');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
      }
      releaseVerticalPageLock();
      function unbindVerticalStartScrollObserver() {
        if (verticalStartResizeObserver) {
          verticalStartResizeObserver.disconnect();
          verticalStartResizeObserver = null;
        }
      }
      function scrollVerticalToStart(useRetry = true) {
        if (!isVerticalWriting()) return;
        verticalScrollToStartPending = true;
        unbindVerticalStartScrollObserver();
        if (alignVerticalScrollToStart()) {
          verticalScrollToStartPending = false;
          return;
        }
        if (!useRetry || !resultDiv) {
          verticalScrollToStartPending = false;
          return;
        }
        let attempts = 0;
        const tick = () => {
          if (!verticalScrollToStartPending || attempts >= 20) {
            verticalScrollToStartPending = false;
            return;
          }
          attempts += 1;
          if (alignVerticalScrollToStart()) {
            verticalScrollToStartPending = false;
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        verticalStartResizeObserver = new ResizeObserver(() => {
          if (!verticalScrollToStartPending || document.body.classList.contains('is-generating')) return;
          if (alignVerticalScrollToStart()) {
            verticalScrollToStartPending = false;
            unbindVerticalStartScrollObserver();
          }
        });
        verticalStartResizeObserver.observe(resultDiv);
      }
      function scrollOutputToEnd() {
        if (isVerticalWriting()) {
          scrollVerticalStream();
          return;
        }
        if (!outputWrap) {
          window.scrollTo({ top: document.documentElement.scrollHeight });
          return;
        }
        if (outputWrap.classList.contains('horizontal-scroll')) {
          getContentScroller().scrollTop = getContentScroller().scrollHeight;
        } else {
          window.scrollTo({ top: document.documentElement.scrollHeight });
        }
      }
      function scrollOutputHorizontal(delta) {
        if (!isVerticalWriting()) return;
        const scroller = getVerticalScroller();
        const maxScroll = getVerticalScrollMax();
        scroller.scrollLeft = Math.max(0, Math.min(maxScroll, scroller.scrollLeft + delta));
      }
      function handleVerticalScrollWheel(e) {
        if (!isVerticalWriting() || !verticalViewport) return;
        const rect = verticalViewport.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          return;
        }
        // 滾輪往上（deltaY < 0）→ 文字區往右；往下 → 往左（直排閱讀直覺）
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation();
        scrollOutputHorizontal(-delta);
      }

      function setResultStreaming(text) {
        const generating = document.body.classList.contains('is-generating');
        resultDiv.textContent = text;
        if (isVerticalWriting()) {
          // 生成中：只捲 viewport 橫軸，不碰 window；尊重使用者手動捲動
          if (generating) {
            const scroller = getVerticalScroller();
            const viewWidth = scroller ? scroller.clientWidth : 0;
            const contentWidth = resultDiv.scrollWidth;
            if (contentWidth <= viewWidth) {
              scrollVerticalToTextEdge(true);
            } else if (isNearOutputEnd()) {
              scrollVerticalToTextEdge(false);
            }
          } else if (isNearOutputEnd()) {
            scrollVerticalStream();
          }
          return;
        }
        const stick = generating || isNearOutputEnd();
        if (stick) {
          requestAnimationFrame(() => scrollOutputToEnd());
        }
      }

      // 直排：只在文字區攔截滾輪，往下＝往右滑
      if (verticalViewport) {
        verticalViewport.addEventListener('wheel', handleVerticalScrollWheel, { passive: false });
      }
      if (resultDiv) {
        resultDiv.addEventListener('wheel', handleVerticalScrollWheel, { passive: false });
      }
      window.addEventListener('resize', () => {
        if (isVerticalWriting()) syncVerticalLayout();
      });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          if (isVerticalWriting()) syncVerticalLayout();
        });
        window.visualViewport.addEventListener('scroll', () => {
          if (isVerticalWriting()) syncVerticalViewportHeight();
        });
      }
      if (resultDiv) {
        new MutationObserver(() => {
          if (!isVerticalWriting()) return;
          const generating = document.body.classList.contains('is-generating');
          if (generating) return; // 串流捲動由 setResultStreaming 處理，避免每字觸發兩次
          syncVerticalLayout();
          if (verticalScrollToStartPending) alignVerticalScrollToStart();
        }).observe(resultDiv, { childList: true, characterData: true, subtree: true });
      }
      window.addEventListener('load', () => {
        releaseVerticalPageLock();
        if (!isVerticalWriting()) return;
        const run = () => scrollVerticalToStart(true);
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(run).catch(run);
        } else {
          run();
        }
      });

      const charactersContainer = document.getElementById('charactersContainer');
      const characterTabs = document.getElementById('characterTabs');
      const randomAllCharactersBtn = document.getElementById('randomAllCharactersBtn');
      const addCharacterBtn = document.getElementById('addCharacterBtn');

      // 浮動工具列元素
      const apiPanelToggle = document.getElementById('apiPanelToggle');
      const apiPanel = document.getElementById('apiPanel');
      const apiPanelClose = document.getElementById('apiPanelClose');
      const toolbarDownloadMenu = document.getElementById('toolbarDownloadMenu');

      // ==================== 浮動工具列事件 ====================
      // API 面板開關
      apiPanelToggle.addEventListener('click', () => {
        apiPanel.classList.toggle('open');
        // 關閉下載選單
        toolbarDownloadMenu.classList.remove('open');
      });

      apiPanelClose.addEventListener('click', () => {
        apiPanel.classList.remove('open');
      });

      // 點擊外部關閉 API 面板
      document.addEventListener('click', (e) => {
        if (!apiPanel.contains(e.target) && !apiPanelToggle.contains(e.target)) {
          apiPanel.classList.remove('open');
        }
        if (!toolbarDownloadMenu.contains(e.target) && !downloadBtn.contains(e.target)) {
          toolbarDownloadMenu.classList.remove('open');
        }
      });

      // 下載選單開關
      downloadBtn.addEventListener('click', () => {
        if (downloadBtn.disabled) return;
        toolbarDownloadMenu.classList.toggle('open');
        // 關閉 API 面板
        apiPanel.classList.remove('open');
      });

      // 下載選單按鈕事件
      toolbarDownloadMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const format = btn.dataset.format;
          if (format === 'txt') {
            downloadAsTxt();
          } else if (format === 'html') {
            downloadAsHtml();
          }
          toolbarDownloadMenu.classList.remove('open');
        });
      });

      // ESC 鍵關閉模態視窗
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          // 關閉 API 面板
          apiPanel.classList.remove('open');
          // 關閉下載選單
          toolbarDownloadMenu.classList.remove('open');
          // 關閉朗讀模態視窗
          const speechModal = document.getElementById('speechModal');
          if (speechModal && speechModal.classList.contains('open')) {
            speechModal.classList.remove('open');
          }
        }
      });

      // 進階設定元素
      const narrativeSelect = document.getElementById('narrative');
      const eraSelect = document.getElementById('era');
      const pacingSelect = document.getElementById('pacing');
      const ratingSelect = document.getElementById('rating');
      const worldComplexitySelect = document.getElementById('worldComplexity');
      const emotionalToneSelect = document.getElementById('emotionalTone');
      const endingSelect = document.getElementById('ending');
      const specialElementsContainer = document.getElementById('specialElementsContainer');
      // 選續集類結局時，自動把「預計集數」帶到 2（若使用者仍為 1）
      if (endingSelect) {
        endingSelect.addEventListener('change', () => {
          const volEl = document.getElementById('volumes');
          if (!volEl) return;
          if (ENDING_SERIES.has(endingSelect.value.trim()) && (parseInt(volEl.value, 10) || 1) < 2) {
            volEl.value = 2;
          }
        });
      }

      // 浮動章節導航元素
      const chapterNavContainer = document.getElementById('chapterNavContainer');
      const chapterNavToggle = document.getElementById('chapterNavToggle');
      const chapterNavPanel = document.getElementById('chapterNavPanel');
      const chapterNavClose = document.getElementById('chapterNavClose');
      const chapterNavList = document.getElementById('chapterNavList');
      const chapterBadge = document.getElementById('chapterBadge');
      const readingProgress = document.getElementById('readingProgress');

      // 書籤元素
      const addBookmarkBtn = document.getElementById('addBookmarkBtn');
      const exportBookmarksBtn = document.getElementById('exportBookmarksBtn');
      const importBookmarksBtn = document.getElementById('importBookmarksBtn');
      const importFileInput = document.getElementById('importFileInput');
      const bookmarkSearch = document.getElementById('bookmarkSearch');
      const bookmarkSort = document.getElementById('bookmarkSort');
      const bookmarkList = document.getElementById('bookmarkList');

      // 朗讀模態視窗元素
      const speakBtn = document.getElementById('speakBtn');
      const bookReaderBtn = document.getElementById('bookReaderBtn');
      const speechModal = document.getElementById('speechModal');
      const closeSpeechModal = document.getElementById('closeSpeechModal');
      const voiceSelect = document.getElementById('voiceSelect');
      const speechRate = document.getElementById('speechRate');
      const speechPitch = document.getElementById('speechPitch');
      const rateValue = document.getElementById('rateValue');
      const pitchValue = document.getElementById('pitchValue');
      const emotionMode = document.getElementById('emotionMode');
      const playPauseBtn = document.getElementById('playPauseBtn');
      const stopSpeechBtn = document.getElementById('stopSpeechBtn');
      const resetSpeechBtn = document.getElementById('resetSpeechBtn');
      const speechProgressFill = document.getElementById('speechProgressFill');
      const speechProgressText = document.getElementById('speechProgressText');

      // 主要動作列元素（提前取得，避免 updateStepper 早期呼叫時的 TDZ）
      const primaryGenerateBtn = document.getElementById('primaryGenerateBtn');
      const primaryContinueBtn = document.getElementById('primaryContinueBtn');
      const resetWorkspaceBtn = document.getElementById('resetWorkspaceBtn');
      const primaryActionHint = document.getElementById('primaryActionHint');
      const perChapterHint = document.getElementById('perChapterHint');

      // 編輯彈窗元素
      const editModal = document.getElementById('editModal');
      const editBookmarkTitle = document.getElementById('editBookmarkTitle');
      const editBookmarkTags = document.getElementById('editBookmarkTags');
      const editBookmarkNotes = document.getElementById('editBookmarkNotes');
      const cancelEditBtn = document.getElementById('cancelEditBtn');
      const saveEditBtn = document.getElementById('saveEditBtn');

      let latestStory = '';
      let editingBookmarkId = null;
      let chapterMatches = [];
      let isPanelOpen = false;
      // ===== 系列分集狀態 =====
      let storySeries = null;        // { seriesTitle, totalVolumes, activeVolumeIndex, volumes: [...] }
      let seriesRunning = false;     // auto_all 進行中（鎖併發，見錯誤10）
      let seriesAborted = false;     // 系列級停止（不被 beginGeneration 重置，見錯誤11）
      let generatingNextVolume = false; // 由 startNextVolume 觸發的生成（保留 series 狀態）
      let generateDoneResolver = null;  // 讓系列流程可 await 一次完整生成
      function settleGenerate() {
        if (generateDoneResolver) { const r = generateDoneResolver; generateDoneResolver = null; r(); }
      }

      // ==================== 狀態顯示 ====================
      let statusHideTimer = null;
      function showStatus(type, message) {
        const icons = {
          loading: '⏳',
          success: '✅',
          error: '❌',
          warning: '⚠️'
        };
        statusDiv.className = `status show ${type}`;
        statusDiv.querySelector('.status-icon').textContent = icons[type] || '';
        statusDiv.querySelector('.status-text').textContent = message;
        if (statusHideTimer) { clearTimeout(statusHideTimer); statusHideTimer = null; }
        // loading 為持續性狀態不自動關閉；其餘訊息浮在畫面上，數秒後自動淡出避免遮擋
        if (type !== 'loading') {
          statusHideTimer = setTimeout(hideStatus, type === 'error' ? 8000 : 4000);
        }
      }

      function hideStatus() {
        if (statusHideTimer) { clearTimeout(statusHideTimer); statusHideTimer = null; }
        statusDiv.className = 'status';
      }

      // 狀態列已改為固定浮動提示，永遠可見，不需再捲動；保留此別名相容既有呼叫。
      function showStatusInView(type, message) {
        showStatus(type, message);
      }

      // ==================== DeepSeek API 與用量統計 ====================
      // 金鑰已移至後端（環境變數），前端僅呼叫自家代理端點，不再接觸金鑰。
      const DEEPSEEK_ENDPOINT = '/api/chat';

      // DeepSeek 標準定價（USD / 百萬 tokens），僅供估算參考
      const DEEPSEEK_PRICING = {
        'deepseek-v4-flash': { input: 0.14, output: 0.28 },
        'deepseek-v4-pro':   { input: 0.435, output: 0.87 }
      };

      // 載入用量統計
      function loadUsageStats() {
        try {
          const saved = JSON.parse(localStorage.getItem('deepseekUsage'));
          if (saved && typeof saved === 'object') {
            return {
              requests: saved.requests || 0,
              promptTokens: saved.promptTokens || 0,
              completionTokens: saved.completionTokens || 0,
              totalTokens: saved.totalTokens || 0
            };
          }
        } catch (e) {}
        return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }

      let usageStats = loadUsageStats();
      let lastUsage = null; // 最近一次請求的用量

      function saveUsageStats() {
        try {
          localStorage.setItem('deepseekUsage', JSON.stringify(usageStats));
        } catch (e) {
          console.warn('用量統計儲存失敗：', e);
        }
      }

      // 讀取/儲存費用上限
      function getCostLimit() {
        const v = parseFloat(localStorage.getItem('deepseekCostLimit'));
        return isNaN(v) ? 0 : v;
      }

      // 估算累計費用（USD）
      function estimateUsageCost() {
        // 以目前選擇的模型定價估算（混用模型時為近似值）
        const pricing = DEEPSEEK_PRICING[modelSelect.value] || DEEPSEEK_PRICING['deepseek-v4-flash'];
        const inputCost = usageStats.promptTokens / 1000000 * pricing.input;
        const outputCost = usageStats.completionTokens / 1000000 * pricing.output;
        return inputCost + outputCost;
      }

      // 更新用量統計的畫面顯示
      function updateUsageUI() {
        const fmt = (n) => (n || 0).toLocaleString();
        const reqEl = document.getElementById('usageRequests');
        const promptEl = document.getElementById('usagePromptTokens');
        const completionEl = document.getElementById('usageCompletionTokens');
        const totalEl = document.getElementById('usageTotalTokens');
        const costEl = document.getElementById('usageCost');
        const lastEl = document.getElementById('usageLast');
        const costContainer = costEl ? costEl.closest('.usage-cost') : null;
        if (reqEl) reqEl.textContent = fmt(usageStats.requests);
        if (promptEl) promptEl.textContent = fmt(usageStats.promptTokens);
        if (completionEl) completionEl.textContent = fmt(usageStats.completionTokens);
        if (totalEl) totalEl.textContent = fmt(usageStats.totalTokens);

        const cost = estimateUsageCost();
        if (costEl) costEl.textContent = '$' + cost.toFixed(4);

        // 超過費用上限時標紅
        const limit = getCostLimit();
        if (costContainer) {
          costContainer.classList.toggle('over-limit', limit > 0 && cost >= limit);
        }

        // 最近一次用量
        if (lastEl) {
          if (lastUsage) {
            lastEl.textContent = `最近一次：輸入 ${fmt(lastUsage.prompt)} + 輸出 ${fmt(lastUsage.completion)} ＝ ${fmt(lastUsage.total)} tokens`;
          } else {
            lastEl.textContent = '最近一次：尚無資料';
          }
        }
      }

      // 記錄一次 API 呼叫的用量
      function recordUsage(usage) {
        usageStats.requests += 1;
        if (usage) {
          const prompt = usage.prompt_tokens || 0;
          const completion = usage.completion_tokens || 0;
          const total = usage.total_tokens || (prompt + completion);
          usageStats.promptTokens += prompt;
          usageStats.completionTokens += completion;
          usageStats.totalTokens += total;
          lastUsage = { prompt, completion, total };
        } else {
          lastUsage = null;
        }
        saveUsageStats();

        // 費用上限提醒
        const limit = getCostLimit();
        const cost = estimateUsageCost();
        if (limit > 0 && cost >= limit) {
          showStatus('warning', `⚠️ 已達費用上限提醒：估算累計 $${cost.toFixed(4)} ≥ $${limit.toFixed(2)}`);
        }

        updateUsageUI();
      }

      // 重設用量統計
      const resetUsageBtn = document.getElementById('resetUsageBtn');
      if (resetUsageBtn) {
        resetUsageBtn.addEventListener('click', () => {
          if (confirm('確定要重設用量統計嗎？此操作無法復原。')) {
            usageStats = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
            lastUsage = null;
            saveUsageStats();
            updateUsageUI();
            showStatus('success', '📊 用量統計已重設');
          }
        });
      }

      // 費用上限輸入
      const costLimitInput = document.getElementById('costLimitInput');
      if (costLimitInput) {
        costLimitInput.value = getCostLimit() > 0 ? String(getCostLimit()) : '';
        costLimitInput.addEventListener('change', () => {
          const v = parseFloat(costLimitInput.value);
          try {
            localStorage.setItem('deepseekCostLimit', isNaN(v) || v < 0 ? '0' : String(v));
          } catch (e) {}
          updateUsageUI();
        });
      }

      // 各模型的選用提示
      const MODEL_HINTS = {
        'deepseek-v4-flash': '✍️ V4 高速版：文筆流暢、速度快、費用更低，最適合長篇小說正文。',
        'deepseek-v4-pro': '🧠 V4 專業版：邏輯推理更強，適合設計嚴謹的大綱與複雜劇情；費用較高。'
      };

      function updateModelHint() {
        const hintEl = document.getElementById('modelHint');
        if (hintEl) hintEl.textContent = MODEL_HINTS[modelSelect.value] || '';
      }

      // 切換模型時更新費用估算與提示
      modelSelect.addEventListener('change', () => {
        updateUsageUI();
        updateModelHint();
      });

      // 初始顯示
      updateUsageUI();
      updateModelHint();

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 將 API 錯誤轉換為易懂的中文提示
      function friendlyApiError(status, msgStr) {
        const raw = msgStr || '';
        const lower = raw.toLowerCase();
        // 後端自家錯誤（金鑰未設定 / 無法連線 DeepSeek）：直接顯示其訊息
        if (raw.includes('DEEPSEEK_API_KEY') || raw.includes('伺服器尚未設定') || raw.includes('無法連線至 DeepSeek')) {
          return raw;
        }
        if (lower.includes('insufficient balance')) {
          return 'DeepSeek 帳戶餘額不足，請至 platform.deepseek.com 儲值後再試';
        } else if (status === 401 || lower.includes('authentication') || lower.includes('invalid api key') || lower.includes('no api key')) {
          return '後端 DeepSeek 金鑰無效或未設定，請聯絡管理員檢查伺服器設定';
        } else if (status === 429 || lower.includes('rate limit') || lower.includes('too many')) {
          return '請求過於頻繁，請稍後再試';
        } else if (status >= 500 || lower.includes('server') || lower.includes('overloaded')) {
          return 'DeepSeek 伺服器忙碌或暫時錯誤，請稍後重試';
        }
        return raw || `HTTP ${status}`;
      }

      // 判斷錯誤是否「不應重試」
      function isNonRetryable(err) {
        if (err && err.name === 'AbortError') return true;
        const m = err && err.message ? err.message : '';
        // 餘額不足 / 金鑰無效 / 後端尚未設定金鑰：重試也不會成功，直接快速回報
        return /餘額不足|金鑰無效|金鑰無效或未設定|尚未設定|DEEPSEEK_API_KEY/.test(m);
      }

      // 單次 DeepSeek 請求（依 options.onChunk 決定是否串流）
      async function doDeepSeekRequest(prompt, apiKey, model, options) {
        const { onChunk = null, signal = null } = options || {};
        const usedModel = model || 'deepseek-v4-flash';
        const useStream = typeof onChunk === 'function';

        const requestBody = {
          model: usedModel,
          messages: [{ role: 'user', content: prompt }],
          stream: useStream
        };
        if (useStream) requestBody.stream_options = { include_usage: true };
        // deepseek-v4-flash：關閉 thinking 模式以加快寫作、降低費用；提高輸出上限避免長章節被截斷。
        // temperature 0.9 + top_p 0.9 收斂取樣空間：中文長篇若 temperature 過高
        //（如 1.3~1.5）或上下文累積過長，容易取樣崩壞成「字都對、語意全亂」的亂碼，
        // 故採偏保守設定，並用 frequency_penalty 抑制重複退化。
        // deepseek-v4-pro：同樣關閉 thinking，保留寫作參數。
        if (usedModel === 'deepseek-v4-flash' || usedModel === 'deepseek-v4-pro') {
          requestBody.thinking = { type: 'disabled' };
          const requestedMax = options.maxTokens;
          requestBody.max_tokens = requestedMax
            ? Math.min(16384, Math.max(4096, requestedMax))
            : 8192;
          requestBody.temperature = 0.9;
          requestBody.top_p = 0.9;
          requestBody.frequency_penalty = 0.3;
        }

        const response = await fetch(DEEPSEEK_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: signal || undefined
        });

        // 非串流模式
        if (!useStream) {
          let data;
          try {
            data = await response.json();
          } catch (e) {
            throw new Error(`HTTP ${response.status}：無法解析回應`);
          }
          if (!response.ok || data.error) {
            const rawMsg = (data && data.error && (data.error.message || data.error)) || `HTTP ${response.status}`;
            throw new Error(friendlyApiError(response.status, typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg)));
          }
          if (!data.choices || data.choices.length === 0) {
            throw new Error('沒有獲得內容');
          }
          recordUsage(data.usage);
          const nonStreamText = (data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '').replace(/\uFFFD/g, '');
          const nsFinish = data.choices[0].finish_reason || null;
          if (typeof options.onComplete === 'function') options.onComplete({ finishReason: nsFinish });
          return { text: nonStreamText.trim(), gotContent: true, finishReason: nsFinish };
        }

        // 串流模式：HTTP 錯誤時，body 會是 JSON 錯誤物件
        if (!response.ok) {
          let errMsg = `HTTP ${response.status}`;
          try {
            const errData = await response.json();
            errMsg = (errData && errData.error && (errData.error.message || errData.error)) || errMsg;
          } catch (e) {}
          throw new Error(friendlyApiError(response.status, typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let usage = null;
        let gotContent = false;
        let finishReason = null;

        const processLine = (line) => {
          const t = line.trim();
          if (!t || !t.startsWith('data:')) return;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') return;
          let json;
          try { json = JSON.parse(payload); } catch (e) { return; }
          if (json.usage) usage = json.usage;
          if (json.choices && json.choices[0] && json.choices[0].finish_reason) {
            finishReason = json.choices[0].finish_reason;
          }
          let delta = json.choices && json.choices[0] && json.choices[0].delta ? (json.choices[0].delta.content || '') : '';
          // 過濾 DeepSeek 串流偶發的 U+FFFD 取代字元（中文內容不應出現，純屬雜訊）
          if (delta) delta = delta.replace(/\uFFFD/g, '');
          if (delta) {
            fullText += delta;
            gotContent = true;
            onChunk(fullText, delta);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) processLine(line);
        }
        // 串流結束：flush 解碼器殘留位元組並處理最後一行
        buffer += decoder.decode();
        if (buffer) processLine(buffer);

        recordUsage(usage);
        const requestedMax = requestBody.max_tokens;
        if (!finishReason && usage && requestedMax && usage.completion_tokens >= Math.floor(requestedMax * 0.92)) {
          finishReason = 'length';
        }
        if (typeof options.onComplete === 'function') options.onComplete({ finishReason });
        return { text: fullText.trim(), gotContent, finishReason };
      }

      // 呼叫 DeepSeek，含失敗自動重試（僅在尚未輸出內容時重試）；回傳生成文字
      async function callDeepSeek(prompt, apiKey, model, options = {}) {
        const maxRetries = typeof options.retries === 'number' ? options.retries : 2;
        let lastErr;
        // 包裝 onChunk 以偵測是否已開始輸出：一旦串流出內容，重試會從頭重來、
        // 造成畫面重跑與重複計費，故已輸出後不再重試。
        let hasStreamed = false;
        const userOnChunk = options.onChunk;
        const effectiveOptions = typeof userOnChunk === 'function'
          ? { ...options, onChunk: (full, delta) => { hasStreamed = true; return userOnChunk(full, delta); } }
          : options;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await doDeepSeekRequest(prompt, apiKey, model, effectiveOptions);
            return result.text;
          } catch (err) {
            lastErr = err;
            // 不重試：使用者中斷、餘額不足、金鑰錯誤
            if (isNonRetryable(err)) throw err;
            // 不重試：本次已串流出部分內容（重試會從頭覆蓋並重複計費）
            if (hasStreamed) throw err;
            if (attempt < maxRetries) {
              await sleep(800 * (attempt + 1)); // 指數退避
              continue;
            }
          }
        }
        throw lastErr;
      }

      // 全域中斷控制器：用於「停止生成」
      let currentAbortController = null;
      let userAborted = false;

      function beginGeneration() {
        currentAbortController = new AbortController();
        userAborted = false;
        return currentAbortController.signal;
      }

      function endGeneration() {
        currentAbortController = null;
      }

      const stopGenerationBtn = document.getElementById('stopGenerationBtn');
      if (stopGenerationBtn) {
        stopGenerationBtn.addEventListener('click', () => {
          // 系列級停止：即使單次生成已結束，也要讓 runAutoSeries 不再開下一集（錯誤11）
          seriesAborted = true;
          if (currentAbortController) {
            userAborted = true;
            currentAbortController.abort();
            showStatus('info', '⏹ 已停止生成');
          }
        });
      }

      // ==================== 載入已儲存的故事 ====================
      const savedStory = (localStorage.getItem('savedStory') || '').replace(/\uFFFD/g, '');
      if (savedStory) {
        latestStory = savedStory;
        resultDiv.textContent = savedStory;
        // 直接用 getElementById 確保獲取正確的元素
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('continueBtn').disabled = false;
        document.getElementById('speakBtn').disabled = false;
        parseAndShowChapters(savedStory);
        console.log('已載入儲存的故事，按鈕已啟用');
      }

      // ==================== 還原系列分集狀態（錯誤8） ====================
      storySeries = loadStorySeries();
      if (storySeries && Array.isArray(storySeries.volumes)) {
        const vEl = document.getElementById('volumes');
        if (vEl) vEl.value = storySeries.totalVolumes;
        // 以作用中的集內容為主（若 savedStory 為空才補回）
        const activeVol = storySeries.volumes[storySeries.activeVolumeIndex];
        if (activeVol && activeVol.content && !savedStory) {
          latestStory = activeVol.content;
          resultDiv.textContent = latestStory;
          parseAndShowChapters(latestStory);
        }
        // renderSeriesBar 於 DOM 後段定義，延後呼叫確保可用
        setTimeout(() => { try { renderSeriesBar(); } catch (e) {} }, 0);
      }

      // ==================== 隨機資料庫 ====================
      const themeCategories = [
        { name: '奇幻類', items: [
          '史詩奇幻','高等奇幻','黑暗奇幻','都市奇幻','輕奇幻','童話改編','神話傳說',
          '精靈與矮人','龍與魔法','魔法世界','勇者與魔王','魔王轉生','騎士傳說',
          '神獸契約','魔法少女','奇幻冒險','尋龍之旅','魔法師之路','王國興衰'
        ]},
        { name: '仙俠武俠類', items: [
          '仙俠修真','玄幻修真','古裝武俠','現代修仙','洪荒流','神話修真',
          '江湖俠客','門派爭鬥','劍與情仇','飛升成仙','道法自然','武林至尊',
          '妖魔鬼怪','陰陽師','捉妖記','修魔大道','逆天改命','氣運之子'
        ]},
        { name: '科幻類', items: [
          '硬科幻','軟科幻','太空歌劇','賽博龐克','蒸汽龐克','柴油龐克',
          '後啟示錄','人工智慧','時間旅行','外星文明','基因改造','虛擬實境',
          '機甲戰爭','星際戰爭','殖民星球','克隆人','意識上傳','量子世界',
          '近未來都市','反烏托邦','生化危機','納米科技','太空探索','第一次接觸'
        ]},
        { name: '愛情類', items: [
          '浪漫愛情','甜蜜寵愛','虐戀情深','禁忌之戀','破鏡重圓','先婚後愛',
          '青梅竹馬','一見鍾情','日久生情','暗戀成真','歡喜冤家','辦公室戀情',
          '豪門恩怨','灰姑娘','霸道總裁','跨越時空的愛','異族之戀','人妖之戀',
          '婚後生活','甜蜜日常','雙向暗戀','契約戀愛','重生追愛','娛樂圈戀愛'
        ]},
        { name: '懸疑推理類', items: [
          '本格推理','社會派推理','密室殺人','連環殺手','法庭攻防','警匪對決',
          '間諜諜戰','犯罪心理','冷案重啟','復仇計畫','完美犯罪','懸疑推理',
          '心理懸疑','反轉劇情','尋找真兇','神探破案','暗黑偵探','無罪推定'
        ]},
        { name: '恐怖驚悚類', items: [
          '心理恐怖','靈異鬼怪','克蘇魯神話','都市怪談','詛咒傳說','鬼屋探險',
          '喪屍危機','邪教儀式','恐怖驚悚','民俗恐怖','校園怪談','醫院驚魂',
          '怪物獵人','深海恐懼','太空驚魂','末日求生','異形入侵','寄生獸'
        ]},
        { name: '歷史類', items: [
          '歷史傳奇','宮廷鬥爭','後宮爭寵','戰國風雲','三國演義','楚漢爭霸',
          '民國風華','古代商戰','帝王將相','亂世英雄','歷史穿越','架空歷史',
          '抗戰風雲','諜戰風雲','科舉之路','盛世繁華','王朝覆滅','開國大業'
        ]},
        { name: '現代都市類', items: [
          '現代都市','職場風雲','娛樂圈','體育競技','電競熱血','創業奮鬥',
          '校園青春','家庭倫理','社會寫實','網紅生活','直播人生','都市異能',
          '重生都市','商戰風雲','醫療職人','法律正義','教師人生','記者追蹤'
        ]},
        { name: '軍事戰爭類', items: [
          '軍事戰爭','戰爭史詩','特種兵','傭兵生涯','軍旅生活','海軍艦隊',
          '空戰英雄','狙擊手','諜報人員','戰地醫護','戰爭與和平','未來戰爭'
        ]},
        { name: '冒險探索類', items: [
          '海洋冒險','西部拓荒','北歐維京','探險尋寶','荒野求生','登山探險',
          '叢林探險','沙漠之旅','極地冒險','地心探索','空島冒險','異世界探險'
        ]},
        { name: '生活職業類', items: [
          '美食料理','甜點烘焙','音樂夢想','繪畫人生','舞蹈青春','攝影故事',
          '寵物情緣','園藝生活','手工藝人','書店日常','咖啡廳物語','花店故事'
        ]},
        { name: '特殊題材類', items: [
          '末世廢土','異能覺醒','系統流','無限流','副本遊戲','直播求生',
          '規則怪談','詭異遊戲','靈氣復甦','諸天萬界','快穿系統','綜漫同人',
          '異世界轉生','重生復仇','重生經商','重生娛樂圈','空間種田','隨身老爺爺'
        ]},
        { name: '年代/懷舊類', items: [
          '年代生活','八零年代','九零年代','千禧校園','老上海往事','眷村歲月',
          '改革開放浪潮','下海經商','知青歲月','工廠青春','票證年代','大院子弟'
        ]},
        { name: '諜戰/特工類', items: [
          '冷戰諜影','反間諜戰','地下情報網','潛伏敵營','密碼破譯','雙面間諜',
          '特工歸來','情報販子','叛逃與追緝','黑色行動'
        ]},
        { name: '機甲/星際細分', items: [
          '機甲格鬥','駕駛員之魂','星艦艦長','星際傭兵','銀河開拓','戴森球建造',
          '宇宙文明','蟲族戰爭','星海殖民','曲速遠征'
        ]},
        { name: '克蘇魯/詭秘類', items: [
          '舊日支配者','瘋狂山脈','深潛者傳說','非歐幾何','污染與瘋狂','禁忌知識',
          'SCP收容','異常檔案','詭秘規則','怪奇調查局'
        ]},
        { name: '轉生變身類', items: [
          '轉生史萊姆','轉生成劍','轉生成龍','轉生成魔王','轉生成幽靈','轉生成NPC',
          '最弱職業逆襲','被廢除的勇者','解雇後封神','轉生反派千金'
        ]},
        { name: '地下城/迷宮類', items: [
          '地下城經營','迷宮主','成為迷宮BOSS','探索者公會','地城討伐','深層攻略'
        ]},
        { name: '經營建設類', items: [
          '基地建設','王國經營','商業帝國','餐廳經營','旅館經營','莊園領主',
          '科技樹點滿','資源帝國','城邦崛起'
        ]},
        { name: '特殊融合類', items: [
          '料理修仙','賽博修真','機械飛升','靈氣復甦現代','末世種田','廢土綠洲',
          '大海賊時代','海賊王座','聊齋志異','山海奇譚','神怪志異','劍與魔法'
        ]},
        { name: '無限/輪迴類', items: [
          '無限恐怖','輪迴樂園','主神空間','副本輪迴','死亡輪迴','詛咒輪迴'
        ]},
        { name: '現代職人細分', items: [
          '刑偵重案','法醫筆記','消防英雄','急診風雲','飛行員之路','遠洋船員',
          '荒野直播','靈異直播','寵物醫生','米其林之路'
        ]},
        { name: '體育競技類', items: [
          '足球風雲','籃球青春','網球對決','圍棋少年','F1賽車','游泳之路',
          '馬拉松挑戰','滑冰競技','拳擊擂台','奧運追夢'
        ]},
        { name: '偶像音樂類', items: [
          '偶像養成','地下樂團','聲優之路','唱跳練習生','綜藝星探','古典音樂家',
          '街頭嘻哈','樂隊主唱','鋼琴師成長','國樂傳承'
        ]},
        { name: '宮廷宅鬥類', items: [
          '後宮爭寵','宅門嫡女','嫡庶之爭','侯府深深','皇后之路','和親公主',
          '寵妃復寵','望族聯姻','正室對決','深閨密謀'
        ]},
        { name: '網文機制類', items: [
          '全民領主','國運直播','萬界聊天群','每日簽到','人生模擬器','功德成聖',
          '詞條抽取','許願系統','商城兌換流','經驗加倍'
        ]},
        { name: '武道格鬥類', items: [
          '地下拳賽','綜合格鬥','劍道之心','空手道之路','跆拳道挑戰','泰拳燃魂',
          '摔跤擂台','散打冠軍','街頭格鬥','傳統武術'
        ]},
        { name: '海外華人類', items: [
          '華僑商戰','唐人街傳奇','留學生涯','海外移民','異國合夥','唐人街探案',
          '唐人街餐館','回流創業','僑鄉報國','雙城生活'
        ]},
        { name: '耽美百合類', items: [
          '雙男主之戀','百合純愛','ABO設定','年上攻','年下寵','師徒戀',
          '宿敵相愛','破鏡重圓BL','職場雙雄','校園純愛BL'
        ]}
      ];
      const themes = themeCategories.flatMap(c => c.items);

      const settingCategories = [
        { name: '奇幻世界', items: [
          '虛構的中世紀王國','精靈族的森林國度','矮人的地底城市','龍族盤據的火山島',
          '魔法師的浮空塔','被詛咒的黑暗森林','神聖的光明神殿','亡靈橫行的荒原',
          '海妖出沒的神秘海域','隱藏在迷霧中的仙境','魔法公會總部','冒險者協會',
          '魔獸橫行的危險地帶','古老的魔法遺跡','封印邪神的聖地','龍騎士的訓練場',
          '精靈女王的宮殿','獸人部落的營地','半獸人的邊境要塞','魔法結界保護的學院'
        ]},
        { name: '仙俠修真世界', items: [
          '修仙門派的靈山','洞天福地','魔教總壇','妖族領地','靈獸森林',
          '仙人洞府','煉丹閣','藏經閣','劍冢','雷劫渡劫之地',
          '凡人修仙界','上古戰場遺跡','秘境入口','仙魔戰場','輪迴之地',
          '天庭凌霄殿','地府閻羅殿','龍宮','蓬萊仙島','崑崙仙境'
        ]},
        { name: '古代中國', items: [
          '皇宮紫禁城','王府深宅','江南水鄉','邊塞關隘','絲路古道',
          '唐朝長安城','宋代繁華汴京','明朝江南','清朝京城','戰國時代的城池',
          '三國時期的戰場','科舉考場','青樓楚館','客棧茶樓','鏢局總部',
          '武林盟主的莊園','隱世村落','少林寺','武當山','峨眉金頂'
        ]},
        { name: '古代其他', items: [
          '古羅馬競技場','埃及法老王宮','希臘神殿','維京海盜船','日本戰國城堡',
          '中世紀歐洲城堡','騎士團要塞','阿拉伯宮殿','瑪雅神廟','印加帝國',
          '波斯帝國','拜占庭皇宮','蒙古大草原','奧斯曼帝國','中世紀修道院'
        ]},
        { name: '近現代歷史', items: [
          '民國時期的上海灘','十里洋場','租界區','抗戰時期的重慶','延安窯洞',
          '維多利亞時代的倫敦','工業革命的工廠','美國西部荒野','淘金熱時代',
          '二戰時期的歐洲戰場','冷戰時期的柏林','六七十年代的香港','八九十年代的台灣'
        ]},
        { name: '現代都市', items: [
          '繁華的現代大都會','國際金融中心','頂級跨國企業總部','創業孵化器',
          '時尚雜誌社','電視台演播廳','電影拍攝現場','娛樂公司練習室',
          '高級私人會所','地下拳場','酒吧夜店','高檔餐廳','米其林廚房',
          '私立貴族學校','普通高中校園','大學城','研究所實驗室','醫學院附屬醫院'
        ]},
        { name: '職業場所', items: [
          '忙碌的三甲醫院','律師事務所','警察局刑偵隊','法院審判庭','檢察院',
          '消防局','軍事基地','特種部隊訓練營','情報機構總部','監獄',
          '精神病院','心理診所','殯儀館','考古現場','博物館'
        ]},
        { name: '科幻世界', items: [
          '近未來的高科技城市','賽博龐克的霓虹都市','人工智慧統治的城市',
          '遙遠的太空殖民地','宇宙戰艦內部','太空站','火星殖民基地','月球基地',
          '海底都市','虛擬實境世界','量子電腦核心','基因改造實驗室',
          '反烏托邦的監控城市','廢土末世','喪屍肆虐的城市','外星人飛船內部',
          '環形世界','戴森球','星際貿易站','銀河聯邦議會','克隆人培育中心'
        ]},
        { name: '異世界/異空間', items: [
          '平行宇宙','異次元空間','夢境世界','靈界與冥府','天界與仙境',
          '地獄深淵','時間裂縫之中','量子疊加的世界','遊戲副本空間','諸神的領域',
          '意識空間','虛數空間','混沌之海','創世之初','世界盡頭'
        ]},
        { name: '自然環境', items: [
          '與世隔絕的孤島','永夜的極地','沙漠中的綠洲','漂浮在空中的島嶼',
          '地下深處的洞穴','活火山口','冰封的古城','被遺忘的古文明遺跡',
          '熱帶雨林深處','神秘的百慕達','馬里亞納海溝','喜馬拉雅之巔',
          '亞馬遜叢林','撒哈拉沙漠','南極冰原','北極凍土','大堡礁'
        ]},
        { name: '日常溫馨場所', items: [
          '溫馨的咖啡廳','老舊的書店','神秘的古董店','熱鬧的遊樂園',
          '安靜的圖書館','溫暖的麵包店','文藝的花店','治癒的寵物店',
          '復古的唱片行','手作工作室','社區活動中心','屋頂天台',
          '海邊小木屋','山間民宿','鄉村農場','葡萄酒莊園','溫泉旅館'
        ]},
        { name: '特殊建築', items: [
          '魔法學院','蒸汽龐克城市','空中花園','海底宮殿','樹屋村落',
          '移動城堡','機械巨獸內部','諾亞方舟','通天塔','地下城市',
          '廢棄的主題樂園','鬧鬼的老宅','廢棄的精神病院','地下實驗室','祕密基地'
        ]},
        { name: '電競/直播', items: [
          '電競戰隊基地','職業選手宿舍','大型電競館','個人直播間','MCN經紀公司','遊戲開發工作室'
        ]},
        { name: '深空/軌道', items: [
          '軌道都市','太空電梯','深空殖民艦','曲速戰艦','星際蟲洞站','小行星礦場','軌道環居住區'
        ]},
        { name: '賽博空間', items: [
          '賽博貧民窟','義體改造診所','黑客地下室','巨型企業摩天樓','霓虹紅燈區','地下黑市'
        ]},
        { name: '現代修真', items: [
          '靈氣復甦的現代都市','都市修真坊市','隱世宗門入口','地脈龍穴','古武世家祖宅'
        ]},
        { name: '末世廢土', items: [
          '廢土綠洲城邦','地下輻射避難所','末世安全屋','喪屍圍城的商場','末世資源回收站'
        ]},
        { name: '海上/空中', items: [
          '海上浮城','移動的鯨船','雲端浮島都市','深海實驗艙','空中纜車列車'
        ]},
        { name: '規則怪談', items: [
          '詭異的無限樓層','循環的末班捷運','沒有出口的旅館','深夜的便利商店','異常的老舊公寓'
        ]},
        { name: '職人場所', items: [
          '刑警重案隊辦公室','法醫解剖室','消防分隊','急診搶救室','遠洋貨輪甲板','飛機駕駛艙'
        ]},
        { name: '日常經營', items: [
          '街角小餐館','轉角咖啡店','獨立二手書店','深夜食堂','鄉間民宿小院','邊境拓荒村'
        ]},
        { name: '古代細分', items: [
          '塞外草原王庭','江湖客棧','漕運碼頭','邊關軍鎮','清修道觀','深山佛寺禪院'
        ]},
        { name: '奇幻細分', items: [
          '冒險者酒館','地下城入口','巨龍的巢穴','世界樹之下','元素交匯位面','亡靈墓園'
        ]},
        { name: '體育競技場館', items: [
          '職業足球場','室內籃球館','網球中心','圍棋競技館','F1賽車賽道','奧運游泳館',
          '拳擊訓練館','滑冰競技場'
        ]},
        { name: '偶像娛樂場所', items: [
          '練習室鏡牆','大型演唱會館','錄音棚控制室','聲優配音間','綜藝錄影棚','地下Live House',
          '經紀公司會議室','音樂學院禮堂'
        ]},
        { name: '宮廷宅邸', items: [
          '紫禁城後宮','侯府正院','嫡女閨房','正房主院','側院妾室','深宮冷院',
          '鳳儀宮','宗人府'
        ]},
        { name: '海外華人場景', items: [
          '舊金山唐人街','海外華人商會','留學生宿舍','唐人街中華商會館','僑鄉古厝','唐人埠碼頭',
          '華人超市街區','雙語社區中心'
        ]},
        { name: '武道格鬥場', items: [
          '綜合格鬥八角籠','劍道館','空手道道場','跆拳道館','泰拳訓練營','摔跤擂台',
          '散打訓練中心','傳統武館'
        ]},
        { name: '網文機制空間', items: [
          '領主核心領地','國運試煉塔','萬界聊天維度','系統商城空間','功德輪迴殿','詞條抽取祭壇',
          '副本空間入口','新手村村莊'
        ]},
        { name: '民俗志怪場景', items: [
          '鄉野廟會','宗祠祠堂','山神廟宇','河神渡口','城隍廟後巷','送葬山路',
          '古村落祠堂','摩崖石刻窟'
        ]}
      ];
      const settingsData = settingCategories.flatMap(c => c.items);

      const styleCategories = [
        { name: '情感基調', items: [
          '溫馨治癒','甜蜜浪漫','輕鬆幽默','青春活力','熱血燃情',
          '感人催淚','虐心糾結','悲傷哀婉','沉重壓抑','黑暗絕望',
          '溫柔細膩','清新淡雅','詩意唯美','勵志向上','正能量'
        ]},
        { name: '氛圍風格', items: [
          '神秘詭異','懸疑緊張','驚悚恐怖','陰森詭譎','荒誕離奇',
          '史詩壯闘','大氣磅礴','恢弘壯麗','莊嚴肅穆','蒼涼悲壯',
          '明亮歡快','俏皮可愛','夢幻迷離','空靈縹緲','禪意悠遠'
        ]},
        { name: '敘事風格', items: [
          '細膩描寫','白描手法','意識流','蒙太奇','碎片化敘事',
          '多線並進','雙線交織','環形敘事','倒敘插敘','非線性敘事',
          '第一人稱','第三人稱限知','全知視角','多視角切換','書信體'
        ]},
        { name: '節奏風格', items: [
          '快節奏爽文','緊湊刺激','高潮迭起','一氣呵成',
          '慢熱鋪陳','娓娓道來','循序漸進','細水長流',
          '張弛有度','跌宕起伏','平鋪直敘','留白想像'
        ]},
        { name: '文學風格', items: [
          '古典優雅','華麗繁複','簡約留白','粗獷豪放',
          '現實主義','魔幻現實','超現實主義','象徵主義',
          '黑色幽默','辛辣諷刺','批判現實','哲理思辨',
          '抒情散文','詩化語言','口語化','文白夾雜'
        ]},
        { name: '類型風格', items: [
          '輕小說風','網文爽文','純文學','嚴肅文學',
          '文藝清新','都市輕熟','職場精英','校園純愛',
          '古言典雅','現言都市','甜寵溺愛','BE美學',
          '硬核寫實','軟糯治癒','中二熱血','腹黑搞笑'
        ]},
        { name: '特殊風格', items: [
          '新武俠','傳統武俠','仙俠飄逸','玄幻熱血',
          '硬科幻','軟科幻','賽博龐克','蒸汽龐克',
          '哥特風','暗黑系','克蘇魯','民俗風',
          '日系輕小說','韓式甜劇','美劇節奏','英劇質感'
        ]},
        { name: '情緒導向', items: [
          '爽點密集','打臉爽文','逆襲翻盤','裝逼打臉',
          '細膩情感','慢熱暗戀','情感糾葛','人性探討',
          '腦洞大開','無厘頭','鬼畜搞笑','溫馨日常'
        ]},
        { name: '結構與筆法', items: [
          '群像史詩','偽紀錄片風','新聞報導體','設定流硬核','志怪筆記體','史官紀傳體',
          '寓言體','實驗文體','多媒體拼貼','彈幕吐槽風','遊戲化敘述','單元劇式'
        ]},
        { name: '類型筆觸', items: [
          '克系冷硬','軍武硬核','廢土荒涼','規則驚悚','SCP檔案風','賽博冷硬',
          '蒸汽復古','黑色電影風','公路電影感','偵探冷硬派'
        ]},
        { name: '東方美學', items: [
          '武俠寫意','東方水墨','古韻雅緻','禪意留白','江湖快意'
        ]},
        { name: '輕鬆向', items: [
          '宅向吐槽','日常流水帳治癒','種田慢綜','爽感無敵流','沙雕歡樂'
        ]},
        { name: '體育競技筆法', items: [
          '賽場臨場感','訓練日誌體','教練視角','對決鏡頭感','競技熱血','傷病療養線',
          '團隊袍澤情','冠軍史詩感'
        ]},
        { name: '偶像娛樂筆法', items: [
          '舞台光影感','練習紀實風','粉絲追星視角','緋聞八卦調','綜藝剪輯感','出道成長線',
          '鏡頭演技派','幕後辛酸'
        ]},
        { name: '宮鬥宅鬥筆法', items: [
          '嫡庶話本風','後宮攻略體','內宅禮制細','權謀對白密','步步驚心系','華服宮燈感',
          '宅門話裡話','翻臉如翻書'
        ]},
        { name: '網文機制筆法', items: [
          '系統提示流','數據面板感','升級爽節奏','聊天群梗體','商城兌換敘','副本攻略記',
          '國運解說風','詞條羅列硬'
        ]},
        { name: '格鬥熱血筆法', items: [
          '擂台吶喊感','道場修行記','熱血對白調','技術拆解流','對決慢鏡感','傷痕成長線',
          '榮耀頒獎式','一拳一腳寫'
        ]},
        { name: '海外華人筆法', items: [
          '雙語夾雜體','鄉愁散文感','唐人街煙火','移民血淚記','文化衝突對','商戰實錄風',
          '留學自傳體','雙城並敘'
        ]},
        { name: '耽美百合筆法', items: [
          '心動細膩系','含蓄推拉調','高糖撒糖','虐戀BE系','ABO資訊素','年上寵溺調',
          '宿敵張力','校園純情系'
        ]}
      ];
      const stylesArr = styleCategories.flatMap(c => c.items);

      const categoryHintMaps = {
        theme: {
          '奇幻類': 'AI 會建構帶魔法與超自然的奇幻世界，展開冒險與奇想',
          '仙俠武俠類': 'AI 會走修仙或江湖路線，著重武學修行、門派與恩怨情仇',
          '科幻類': 'AI 會以科技與未來想像為核心，推演其對世界與人的影響',
          '愛情類': 'AI 會把情感關係當主軸，細寫戀愛的心動、拉扯與甜或虐',
          '懸疑推理類': 'AI 會佈局謎團與線索，靠推理與反轉逐步揭開真相',
          '恐怖驚悚類': 'AI 會營造恐怖與緊張氛圍，帶來未知、威脅與求生壓力',
          '歷史類': 'AI 會以歷史或仿古背景鋪陳權謀、時代變局與人物命運',
          '現代都市類': 'AI 會貼近當代都市生活，描寫現實中的競爭、人際與際遇',
          '軍事戰爭類': 'AI 會以戰爭與軍旅為背景，寫作戰、紀律與生死袍澤',
          '冒險探索類': 'AI 會安排前往未知之地的旅程，重探索、挑戰與發現',
          '生活職業類': 'AI 會以某個興趣或行業為主線，寫投入、成長與生活情味',
          '特殊題材類': 'AI 會套用網文流行的機制化套路，帶明確目標與升級感',
          '年代/懷舊類': 'AI 會重現特定年代的生活質感與時代記憶',
          '諜戰/特工類': 'AI 會寫情報與潛伏，著重身分掩護與心理博弈',
          '機甲/星際細分': 'AI 會以機甲或星際戰爭為核心，展開科幻軍事冒險',
          '克蘇魯/詭秘類': 'AI 會營造不可名狀的未知與瘋狂，帶詭秘規則與恐懼',
          '轉生變身類': 'AI 會讓主角轉生或變身後，走適應新身分與逆襲的路線',
          '地下城/迷宮類': 'AI 會以地城或迷宮為核心舞台，圍繞探索與攻略',
          '經營建設類': 'AI 會寫從無到有的經營與建設，逐步壯大勢力或事業',
          '特殊融合類': 'AI 會混搭不同類型元素，創造跨界的新奇設定',
          '無限/輪迴類': 'AI 會讓角色反覆闖關或輪迴，在循環中求生與突破',
          '現代職人細分': 'AI 會深入某個現代專業領域，寫其日常、專業與挑戰',
          '體育競技類': 'AI 會以體育賽事與訓練為主軸，寫競技、成長與勝負榮光',
          '偶像音樂類': 'AI 會圍繞舞台、練習與出道，寫追夢、曝光與粉絲情感',
          '宮廷宅鬥類': 'AI 會以後宮或宅門為舞台，寫權謀、位份爭奪與人情算計',
          '網文機制類': 'AI 會套用明確的系統或機制規則，推動升級與爽感節奏',
          '武道格鬥類': 'AI 會以格鬥技藝與擂台對決為核心，寫訓練、對戰與榮譽',
          '海外華人類': 'AI 會寫華人在異國的打拼、文化碰撞與身分認同',
          '耽美百合類': 'AI 會以同性情感為主軸，細寫心動、拉扯與關係確立'
        },
        setting: {
          '奇幻世界': 'AI 會把舞台設在充滿魔法與異族的西方奇幻世界',
          '仙俠修真世界': 'AI 會把場景設在充滿靈氣與仙魔的修真世界',
          '古代中國': 'AI 會以古代中華的宮廷或江湖為舞台，重古風氛圍',
          '古代其他': 'AI 會以某個異域古文明為舞台，帶其獨特風土',
          '近現代歷史': 'AI 會把場景設在近現代的歷史時期，帶時代動盪感',
          '現代都市': 'AI 會把場景設在當代都市的現實空間，貼近日常生活',
          '職業場所': 'AI 會以某個專業工作現場為舞台，帶職場真實感',
          '科幻世界': 'AI 會把場景設在科技高度發展的未來或異世界',
          '異世界/異空間': 'AI 會把舞台設在超現實的異世界或特殊空間',
          '自然環境': 'AI 會以壯闊或險惡的自然環境為舞台，帶野性氣息',
          '日常溫馨場所': 'AI 會把場景設在溫馨的生活空間，營造治癒氛圍',
          '特殊建築': 'AI 會以一處奇特而富想像力的建築為主要舞台',
          '電競/直播': 'AI 會把舞台設在電競與直播的數位娛樂場景',
          '深空/軌道': 'AI 會把場景設在太空軌道與深空設施',
          '賽博空間': 'AI 會把場景設在高科技低生活的賽博都市',
          '現代修真': 'AI 會把場景設在靈氣復甦的現代修真世界',
          '末世廢土': 'AI 會把舞台設在秩序崩壞、資源匱乏的末世廢土',
          '海上/空中': 'AI 會以海上或空中的特殊場景為舞台',
          '規則怪談': 'AI 會把場景設在詭異封閉、暗藏規則的空間',
          '職人場所': 'AI 會以某個職人的工作現場為舞台，帶專業細節',
          '日常經營': 'AI 會把場景設在一處小店或據點，圍繞經營日常',
          '古代細分': 'AI 會以某個古風的特定地點為舞台',
          '奇幻細分': 'AI 會以奇幻世界中的某個標誌性地點為舞台',
          '體育競技場館': 'AI 會把場景設在體育賽事與訓練的專業場館',
          '偶像娛樂場所': 'AI 會把舞台設在練習、錄製與演出的娛樂場所',
          '宮廷宅邸': 'AI 會把場景設在後宮或深宅大院，帶位份與禮制壓力',
          '海外華人場景': 'AI 會以華人聚集的異國街區或僑居空間為舞台',
          '武道格鬥場': 'AI 會把場景設在道場、擂台等格鬥訓練與對決場所',
          '網文機制空間': 'AI 會把舞台設在帶系統規則的異空間或機制化場域',
          '民俗志怪場景': 'AI 會以廟會、祠堂等民俗場所營造志怪氛圍'
        },
        style: {
          '情感基調': 'AI 會以一種明確的情緒基調貫穿全文',
          '氛圍風格': 'AI 會用一種特定氣氛籠罩場景與敘事',
          '敘事風格': 'AI 會採用特定的敘事手法與視角來組織故事',
          '節奏風格': 'AI 會依此控制情節推進的快慢與張弛',
          '文學風格': 'AI 會以此決定用詞、修辭與整體文體取向',
          '類型風格': 'AI 會用某種類型文慣用的筆觸來書寫',
          '特殊風格': 'AI 會套用某種類型化風格的獨特語感',
          '情緒導向': 'AI 會偏重某一種閱讀感受來安排內容',
          '結構與筆法': 'AI 會採用較特殊的敘事結構或文體形式',
          '類型筆觸': 'AI 會用硬核類型特有的冷硬語感書寫',
          '東方美學': 'AI 會以東方古典韻味與寫意筆法書寫',
          '輕鬆向': 'AI 會走輕鬆娛樂、無壓力的敘事路線',
          '體育競技筆法': 'AI 會用賽場臨場感與競技節奏來書寫',
          '偶像娛樂筆法': 'AI 會以舞台、練習與娛樂圈語感呈現',
          '宮鬥宅鬥筆法': 'AI 會用內宅禮制與權謀對白營造宅鬥氛圍',
          '網文機制筆法': 'AI 會以系統提示、數據與升級節奏推進敘事',
          '格鬥熱血筆法': 'AI 會用擂台熱血與技術拆解寫對決場面',
          '海外華人筆法': 'AI 會以雙語夾雜與鄉愁質感書寫華人故事',
          '耽美百合筆法': 'AI 會以細膩心動與情感推拉為敘事主調'
        },
        special: {
          '系統機制': '金手指、任務、升級等遊戲化系統元素',
          '穿越重生': '穿書、回檔、奪舍等時空與命運改寫',
          '感情線': '戀愛、暗戀、三角關係等情感衝突元素',
          '主角類型': '主角人設類型，如廢柴逆襲、反派主角',
          '劇情元素': '復仇、背叛、懸念等推動情節的橋段',
          '世界觀': '力量體系、陣營格局等世界底層設定',
          '場景設定': '標誌性場景或反覆出現的舞台',
          '生活元素': '日常細節、興趣嗜好等生活質感',
          '競爭對抗': '比賽、對決、排名等競爭衝突',
          '特殊能力': '異能、魔法、血脈等超自然能力',
          '身份職業': '主角或關鍵角色的身分與職業標籤',
          '特殊設定': '罕見或腦洞型世界/劇情設定',
          '種族設定': '人外、異族、血脈等非人種族元素',
          '現代職場': '辦公室、創業、職場人際等現代工作場景',
          '情境模式': '特定情境套路，如密閉空間、限時任務',
          '網路時代': '直播、演算法、加密詐騙等數位社會元素',
          '經營養成': '種田、養成、經營類慢節奏發展',
          '伏筆懸念': '埋線、反轉、謎題等懸念設計元素',
          '人際糾葛': '家族、師徒、宿敵等複雜人際關係',
          '道德困境': '兩難抉擇、善惡模糊等倫理衝突',
          '規則怪談': '詭異規則、禁忌行為等恐怖生存元素',
          '反差喜劇': '烏龍、裝逼翻車等搞笑反差橋段',
          '秘密組織': '地下勢力、情報網、神秘結社',
          '成長蛻變': '角色心理成長、接納過去等蛻變弧線',
          '神器法寶': '武器、道具、傳說寶物等關鍵物品',
          '儀式禁忌': '祭祀、詛咒、禁忌儀式等神秘儀軌',
          '心理博弈': '試探、欺瞞、心理戰等智力對抗',
          '身分偽裝': '假身分、臥底、易容等身份欺瞞',
          '委託任務': '接案、攻略、討伐等任務驅動情節',
          '語言咒術': '言靈、咒語、契約文字等語言力量'
        }
      };

      function attachCategoryHints(categories, hintMap) {
        categories.forEach((cat) => {
          cat.hint = hintMap[cat.name] || cat.name;
        });
      }
      attachCategoryHints(themeCategories, categoryHintMaps.theme);
      attachCategoryHints(settingCategories, categoryHintMaps.setting);
      attachCategoryHints(styleCategories, categoryHintMaps.style);

      const advancedFieldHints = {
        '敘事視角': '決定誰在講故事、用什麼文體（第一人稱、多線、元敘事等）',
        '時代設定': '故事所在的年代或架空紀元，影響科技、禮俗與社會氛圍',
        '故事節奏': '情節推進快慢：慢熱鋪陳、爽文連環或開局高潮等',
        '內容分級': '適讀年齡與內容尺度，界定暴力、情感等描寫邊界',
        '世界觀複雜度': '設定複雜度：從單一場景到多國多勢力的格局規模',
        '情感基調': '全書情緒色調，如治癒、黑暗、懸疑或熱血',
        '結局傾向': '收尾方向：圓滿、悲劇、開放式或遺憾圓滿等'
      };

      const storyFieldHints = {
        '主題': '故事核心題材類型，決定情節主軸與衝突方向',
        '背景': '主要發生場景與世界舞台，影響氛圍與細節描寫',
        '風格': '文筆與敘事調性，如爽文、文藝、輕鬆或史詩感'
      };

      // 各進階選項對 AI 生成的實際影響（hover 時顯示）
      const advancedOptionImpacts = {
        // ── 敘事視角 ──
        '第一人稱': '全程用「我」書寫，只寫主角看得到、感受得到的事，代入感強但視野受限',
        '第三人稱限知': '貼著主角寫、可描其內心，但不透露其他角色在想什麼',
        '第三人稱全知': '用上帝視角，能寫任何人的內心、自由切換場景並加以評論',
        '第二人稱': '用「你」稱呼主角，營造強烈沉浸與實驗感',
        '多視角切換': '每章換一個角色的眼睛看同一世界，逐步拼出全貌',
        '雙線敘事': '安排兩條主線輪流推進、最後交會，適合雙主角或今昔對照',
        '群像劇視角': '不設單一主角，戲份平均分給多名角色，重在眾生百態',
        '對立視角': '讓敵我雙方交替發聲，呈現同一衝突的兩種立場',
        '書信體': '用一封封書信往來推進劇情，靠字裡行間透露資訊',
        '日記體': '以逐日日記口吻書寫，帶私密感與時間流逝',
        '回憶錄': '讓主角事後回望人生，語氣滄桑並暗示已知的結局',
        '旁白敘述': '安排一個故事外的講述者引導與評點劇情',
        '採訪體': '用問答訪談形式，透過受訪者之口揭露事件',
        '檔案體': '用報告、卷宗的冷峻文體呈現，客觀而疏離',
        '意識流': '大量寫內心獨白與跳躍聯想，重感受、淡化情節',
        '碎片式': '打散時間順序、用零散片段拼湊，需讀者自行重組',
        '倒敘': '先給結局再回溯成因，重點放在「為什麼會走到這步」',
        '插敘': '在主線中穿插回憶片段，逐步補全人物背景',
        '環形敘事': '讓開頭與結尾呼應，形成閉環或宿命輪迴感',
        '不可靠敘述者': '讓敘述帶有隱瞞或誤導，真相需讀者自行辨別',
        '元敘事': '讓角色意識到自己身在故事中，會打破第四面牆',
        '系統提示風格': '穿插【系統】面板、任務與屬性提示等遊戲化文字',
        '多時間線交錯': '讓過去與現在並行敘述，逐步對接兩條時間線',
        '遊戲日誌體': '用任務 log、戰報形式記錄冒險過程',
        '論壇聊天室體': '用貼文與留言串呈現事件與眾人反應',
        'AI旁白': '以人工智慧的冷靜口吻講述整個故事',
        '實況轉播體': '用即時播報的緊湊口吻推進，臨場感強',
        '文件拼貼體': '拼接信件、剪報、報告等多種文件來說故事',
        '動物視角': '用動物或非人存在的眼睛觀察人類世界，帶陌生化視角',

        // ── 時代設定 ──
        '遠古神話時代': '以盤古女媧等神話為底，充滿創世、洪荒與神祇色彩',
        '上古三皇五帝': '部落聯盟與人文初開，帶質樸蒼茫的上古感',
        '夏商周': '青銅、禮器、占卜與分封制的古樸禮制氛圍',
        '先秦時代': '諸侯爭霸、百家爭鳴，思想與縱橫權謀交鋒',
        '秦朝': '始皇一統、郡縣嚴法與大一統的肅殺氣象',
        '漢朝': '絲路、外戚、儒術與雄渾的兩漢氣度',
        '三國': '群雄割據、謀士武將與亂世逐鹿的權謀戰爭',
        '魏晉南北朝': '清談玄學、名士風流與門閥世族的頹靡美感',
        '隋唐時代': '盛世繁華、開放包容與詩酒風流',
        '五代十國': '政權更迭頻繁、藩鎮割據的動盪亂世',
        '宋朝': '文人雅趣、市井繁榮與重文輕武的雅韻',
        '元朝': '草原鐵騎、多族並存與遼闊帝國氣象',
        '明朝': '錦衣衛、東廠、內閣與市井繁華的權謀底色',
        '清朝': '宮廷皇權、旗人禮制與封建晚期的森嚴',
        '清末民初': '新舊碰撞、列強環伺與變革動盪的時代裂縫',
        '民國時代': '上海灘、租界、洋場與亂世兒女的摩登與離亂',
        '抗戰時期': '烽火家國、犧牲與民族存亡的沉重底色',
        '建國初期': '百廢待興、集體理想與樸素年代感（1949-1960）',
        '特殊年代': '運動與動盪下的人性掙扎（1960-1980）',
        '改革開放': '下海經商、時代機遇與新舊觀念衝撞（1980-2000）',
        '古希臘': '城邦、神話、哲學辯論與命運悲劇',
        '古羅馬': '軍團、競技場、元老院與帝國榮光及腐敗',
        '黑暗時代': '中世紀早期的蒙昧、瘟疫與封建雛形',
        '西方中世紀': '騎士、城堡、教會與封建領主的劍與信仰',
        '文藝復興': '藝術覺醒、人文主義與陰謀交織的華麗',
        '大航海時代': '遠洋探險、殖民、海盜與地理大發現',
        '啟蒙時代': '理性、沙龍、革命前夕的思想激盪',
        '維多利亞時代': '英倫紳士淑女、蒸汽、禮教與階級的優雅壓抑',
        '工業革命': '蒸汽工廠、城市化與貧富撕裂的巨變年代',
        '一戰時期': '壕溝戰、機槍與一代人幻滅的底色',
        '二戰時期': '世界大戰、諜報與存亡抉擇的宏大殘酷',
        '冷戰時期': '鐵幕、間諜、核陰影與意識形態對峙',
        '古埃及': '法老、金字塔、神廟與尼羅河文明',
        '古巴比倫': '兩河文明、空中花園與占星神權',
        '古印度': '恆河、種姓、梵天諸神與哲思',
        '日本戰國': '大名割據、武士、忍者與下克上',
        '江戶時代': '幕府、町人文化、劍客與武士道',
        '明治維新': '和洋交會、變法圖強的東洋轉型',
        '北歐維京': '長船、劫掠、神話與嚴酷的海洋部族',
        '奧斯曼帝國': '蘇丹宮廷、後宮、清真與橫跨歐亞的帝國',
        '蒙古帝國': '鐵騎西征、草原霸業與征服世界的野心',
        '美國西部': '牛仔、槍手、拓荒與蠻荒法外之地',
        '現代': '當代都市為背景，貼近現實生活與科技',
        '近未來': '2030-2050 的可預見科技與社會變遷',
        '中未來': '2050-2100 的深度科技化與新社會形態',
        '遠未來': '星際航行、殖民與高度發達文明',
        '超未來': '宇宙終末、文明極限與超越想像的存在',
        '末日後': '資源匱乏、秩序崩壞的廢土求生為主軸',
        '喪屍末日': '活死人圍城、人性考驗與絕境求生',
        '核戰後': '輻射廢土：變種威脅、避難所與掠奪者，語言粗糲',
        '氣候災變': '生態崩潰、極端天災與人類存續掙扎',
        '架空歷史': '從「如果歷史轉了個彎」出發改寫世界走向',
        '平行時空': '另一個與現實相似卻不同的世界',
        '時間穿越': '角色跨越時代，製造今昔碰撞與蝴蝶效應',
        '永恆之城': '時間凝滯、循環或不老的奇異空間',
        '洪荒': '天地初開、大神巫妖為底的宏大東方神話',
        '仙俠世界': '修仙問道、宗門、法寶與飛升',
        '玄幻大陸': '鬥氣、魔法、血脈與等級森嚴的力量體系',
        '西幻大陸': '劍與魔法、種族、地城與冒險者',
        '蒸汽龐克': '齒輪蒸汽科技打造復古而奇異的工業世界',
        '賽博龐克': '高科技低生活：義體、企業霸權與霓虹貧民窟',
        '克蘇魯': '不可名狀的恐懼、瘋狂與渺小的人類',
        '哥特風': '黑暗浪漫、古堡、吸血鬼與陰鬱美感',
        '大正浪漫': '和洋折衷、摩登與懷舊交織的雅致',
        '昭和時代': '復古日本、庶民生活與時代懷舊感',
        '千禧年代': '2000 前後的網路萌芽與世紀之交氛圍',
        '八零九零年代': '兩岸三地懷舊、卡帶錄影帶與純真年代',
        '靈氣復甦紀元': '現代都市突然靈氣復甦、修真崛起的新紀元',
        '星際大航海': '殖民拓荒、星際貿易與新邊疆冒險',
        '後人類紀元': '意識上傳、義體改造與人類定義的動搖',
        '矽基文明': 'AI 主導、人類邊緣化的機械文明',
        '蒸汽中華': '融合東方美學與蒸汽科技的架空中華',
        '靈能復興': '超能力公開化後社會秩序的重構',
        '大瘟疫時代': '隔離、恐慌與重建為背景的人性百態',
        '太空殖民晚期': '星海邦聯、殖民地矛盾與宇宙政治',

        // ── 故事節奏 ──
        '慢熱鋪陳': '前段細膩鋪墊人物與世界，後勁醞釀較久',
        '標準節奏': '張弛有度地推進，鋪陳與高潮均衡',
        '快節奏': '事件密集、少廢話，情節推進緊湊',
        '極速節奏': '一波接一波幾乎不留喘息，資訊高度濃縮',
        '爽文節奏': '高潮迭起、打臉不斷，即時給予爽感回饋',
        '懸疑節奏': '層層埋線、逐步剝繭，靠謎題牽引',
        '文藝節奏': '重內心與氛圍，情節推進緩而有韻味',
        '史詩節奏': '宏大格局與長時間跨度緩緩鋪展',
        '日常節奏': '聚焦生活瑣事與細節，舒適治癒',
        '驚悚節奏': '步步緊逼、營造壓迫與不安',
        '浪漫節奏': '放慢在情感互動上，細寫心動與曖昧',
        '熱血節奏': '戰鬥與燃點密集，情緒持續高漲',
        '倒敘節奏': '先拋結局再回頭補因果，懸念在過程',
        '環形節奏': '劇情首尾呼應、形成循環結構',
        '碎片節奏': '用時間跳躍的片段讓讀者逐步拼出真相',
        '漸進節奏': '由慢到快、漸入佳境，後段越發緊湊',
        '波浪節奏': '高低起伏交替，緊張與舒緩輪番出現',
        '階梯節奏': '逐步升級衝突與格局，層層遞進',
        '爆發節奏': '長段蓄力、於關鍵點集中爆發高潮',
        '雙線節奏': '兩條線並行推進、在高潮處交匯',
        '開局即高潮': '第一章就拋出強衝突或懸念抓住讀者',
        '單元劇節奏': '一章一個相對獨立的小故事，串成長篇',
        '養成漸進': '以陪伴式的緩慢成長為主軸',
        '慢綜治癒': '維持鬆弛無壓力的慢綜藝氛圍',
        '群像輪轉': '多名角色輪流成為焦點推進劇情',
        '懸念鉤子連發': '幾乎每章結尾都留鉤子，逼人追更',

        // ── 內容分級 ──
        '全年齡': '內容乾淨、無血腥色情，適合所有讀者',
        '12+': '允許輕微衝突與朦朧情感，整體仍溫和',
        '15+': '可寫中度戰鬥與曖昧，尺度適中',
        '18+': '允許較激烈的暴力或情感描寫',
        '純愛向': '清水甜文路線，溫馨無腥羶',
        '輕度曖昧': '情感點到為止，留白多、意猶未盡',
        '中度情感': '情感描寫較深入細膩',
        '暗黑向': '黑暗劇情與道德灰色地帶',
        '獵奇向': '奇特、挑戰常規的設定與情節',
        '血腥向': '戰鬥與傷害描寫較直接激烈',
        '驚悚向': '加重恐怖驚悚氛圍與感官刺激',
        '虐心向': '刻意製造情感拉扯與痛點，刀片不斷',
        '致鬱向': '沉重壓抑、偏悲劇的情緒走向',
        '治癒向': '以溫暖療癒、給人安慰為目標',
        '搞笑向': '密集安排笑點，整體輕鬆歡樂',
        '正劇向': '嚴肅認真，以劇情與人物深度為重',
        '闔家歡': '老少咸宜、溫馨正向路線',
        '燒腦向': '加入需要推理思考的複雜設計',
        '無腦爽向': '主打痛快爽感，不糾結邏輯',
        '群像向': '著墨眾生百態，戲份分散多角',
        '考據向': '注重設定考究與細節真實感',

        // ── 世界觀複雜度 ──
        '極簡': '弱化背景設定，全力聚焦角色與情感',
        '簡單': '單一場景與清晰設定，易於理解',
        '中等': '建構 2-3 個陣營或國家的中等格局',
        '複雜': '鋪陳多國多勢力與較詳盡的設定',
        '史詩級': '龐大世界觀、多線並進的宏大敘事',
        '超史詩': '跨多位面、多時代交織的極致格局',
        '單場景深挖': '集中在一地一事，做深度刻畫',
        '城市級': '以一座城為舞台，勢力錯綜交織',
        '國家級': '朝堂與江湖、內外交困的一國格局',
        '大陸級': '多國爭霸、諸侯割據的大陸版圖',
        '世界級': '全球格局、大國博弈為舞台',
        '宇宙級': '星際文明與種族對抗的宇宙尺度',
        '多元宇宙': '平行世界與維度穿梭的多重宇宙',
        '鬆散設定': '以劇情為先，設定隨需要靈活調整',
        '硬核設定': '維持嚴格體系與邏輯自洽',
        '軟科幻': '把科技當背景，不深究原理',
        '硬科幻': '講求科學嚴謹與邏輯推演',
        '低魔世界': '魔法稀少而珍貴，貼近寫實',
        '高魔世界': '魔法充斥日常，奇幻感濃厚',
        '規則驅動': '以嚴格規則主導劇情走向與衝突',
        '克系不可知': '保留真相不可名狀的未知與恐懼',
        '雙世界對照': '兩個世界互相映照、對比推進',

        // ── 情感基調 ──
        '歡樂輕鬆': '笑點滿滿、輕快愉悅的閱讀感',
        '溫馨治癒': '暖心療癒、撫慰人心的氛圍',
        '浪漫甜蜜': '甜寵戀愛為主，糖分很高',
        '熱血燃向': '情緒澎湃燃爆，激情四射',
        '青春活力': '朝氣蓬勃的青春氣息',
        '勵志向上': '傳遞努力必有回報的正能量',
        '希望光明': '即使黑暗也導向黎明與希望',
        '虐心糾結': '製造情感拉扯與糾結，刀片預警',
        '黑暗沉重': '壓抑致鬱的沉重氛圍',
        '悲傷憂鬱': '渲染淚點與意難平的憂傷',
        '絕望窒息': '看不到希望的絕望壓迫',
        '孤獨寂寞': '突顯孤單疏離、一個人的寂寥',
        '蒼涼悲壯': '悲劇英雄與壯烈犧牲的蒼涼',
        '懸疑緊張': '步步為營、真相撲朔的張力',
        '詭異驚悚': '細思極恐、脊背發涼的詭異',
        '驚險刺激': '心跳加速、危機連連',
        '壓迫窒息': '危機四伏、無處可逃的壓迫',
        '神秘詭譎': '迷霧重重、疑點叢生的神秘',
        '史詩壯闘': '宏大敘事與英雄傳說鋪展',
        '諷刺幽默': '黑色喜劇嘲諷現實',
        '哲理深沉': '探討人生命題、發人深省',
        '荒誕離奇': '魔幻現實、荒誕不經的路線',
        '複雜糾葛': '愛恨交織、立場模糊的複雜關係',
        '灰色地帶': '不設絕對善惡，道德模糊',
        '爽快解壓': '看完神清氣爽、解壓',
        '慢生活': '歲月靜好、平淡是真的慢步調',
        '復古懷舊': '渲染年代感與回憶殺',
        '夢幻唯美': '如夢似幻、美輪美奐的意境',
        '現實殘酷': '社會寫實、揭露殘酷人生',
        '超脫世俗': '出世情懷與道法自然的超然',
        '燃中帶虐': '熱血激昂中埋入虐心刀點',
        '苦中作樂': '角色在逆境中仍保有幽默與韌性',
        '爽中帶感': '兼顧爽感與動人情感',
        '平靜致鬱': '以平靜筆調寫無聲的絕望',
        '史詩悲憫': '宏大敘事中注入慈悲與人文關懷',
        '溫暖治癒中帶痛': '療癒中夾帶淡淡的痛與淚',

        // ── 結局傾向 ──
        'HE': '大團圓、皆大歡喜的圓滿收尾',
        'BE': '悲劇收場、留下意難平',
        'OE': '開放結局收束，留給讀者想像',
        'TE': '揭開隱藏真相的真結局',
        'NE': '中規中矩、平實的普通結局',
        '圓滿HE': '所有角色都得到幸福結局',
        '遺憾HE': '整體圓滿但保留一絲遺憾',
        '苦盡甘來HE': '角色歷盡艱辛後終獲幸福',
        '雙向奔赴HE': '有情人相互奔赴、終成眷屬',
        '虐心BE': '相愛之人終究無法在一起',
        '壯烈犧牲BE': '英雄轟烈犧牲收尾',
        '宿命BE': '命運使然、無力回天的悲劇成真',
        '黑化BE': '主角墮落黑化、萬劫不復',
        '滅世BE': '世界毀滅、無人倖免',
        '逆轉結局': '結尾拋出震撼大反轉',
        '反殺結局': '主角絕地反擊、逆風翻盤',
        '反派勝利': '正義敗北、黑暗勝出',
        '第三方結局': '螳螂捕蟬、黃雀在後的第三方得利',
        '半開放': '完結主線但保留支線留白',
        '伏筆結局': '埋下續作伏筆、留懸念待解',
        '意識流結局': '夢境般模糊的意識流收尾',
        '讀者選擇': '結局解讀權交給讀者',
        '輪迴結局': '首尾呼應、宿命循環',
        '覺醒結局': '打破第四面牆、角色覺醒',
        '多結局': '暗示 IF 線與平行世界的多重結局',
        '續集鋪墊': '為新旅程鋪墊、預告續集',
        '番外預告': '完結主線並預告番外延續',
        '夢醒結局': '揭曉原來是一場夢',
        '死亡結局': '以主角死亡終結故事',
        '昇華結局': '角色超脫凡塵、境界昇華',
        '雙結局並陳': '同時呈現 HE 與 BE 兩種結局',
        '循環解脫': '終結宿命輪迴而解脫',
        '犧牲換新生': '以犧牲換取未來與新生',
        '開放暗示HE': '留白收尾但明顯傾向圓滿',
        '虐後HE': '大虐之後給出團圓結局',
        '神隱結局': '角色悄然消失、不告而別'
      };

      // 主題：逐選項對生成的實際影響
      const themeOptionImpacts = {
        // 奇幻類
        '史詩奇幻': '寫宏大的奇幻世界與正邪決戰，格局壯闊、命運交織',
        '高等奇幻': '建構完整獨立的異世界與魔法體系，純幻想遠離現實',
        '黑暗奇幻': '走陰暗殘酷的奇幻路線，充滿墮落、犧牲與道德灰色',
        '都市奇幻': '把魔法與超自然藏進現代都市，寫日常中的隱秘奇幻',
        '輕奇幻': '寫輕鬆易讀的奇幻小品，魔法點綴、氛圍溫和',
        '童話改編': '以經典童話為底重新演繹，帶新解或黑暗反轉',
        '神話傳說': '取材神話傳說，重述神祇、英雄與遠古傳奇',
        '精靈與矮人': '圍繞精靈、矮人等奇幻種族的文化與世仇展開',
        '龍與魔法': '以巨龍與魔法為核心，寫馴龍、屠龍或龍族傳說',
        '魔法世界': '建構以魔法運作的世界，圍繞魔法學習與力量爭奪',
        '勇者與魔王': '寫勇者對抗魔王的經典冒險與宿命對決',
        '魔王轉生': '讓魔王重生或轉世，翻轉立場重新崛起',
        '騎士傳說': '寫騎士的榮譽、征戰與忠誠的傳奇',
        '神獸契約': '圍繞與神獸締結契約、並肩成長與戰鬥展開',
        '魔法少女': '寫少女獲得魔法之力、對抗邪惡並成長',
        '奇幻冒險': '安排一趟奇幻世界的冒險旅程與夥伴羈絆',
        '尋龍之旅': '以尋找巨龍或龍之秘寶為主線展開遠征',
        '魔法師之路': '寫魔法師從入門到大成的修習與試煉',
        '王國興衰': '描寫奇幻王國的崛起、權鬥與衰亡',
        // 仙俠武俠類
        '仙俠修真': '寫修仙問道、渡劫飛升的仙俠歷程',
        '玄幻修真': '融合玄幻設定與修真體系，力量升級感強',
        '古裝武俠': '寫古代江湖的武功、俠義與快意恩仇',
        '現代修仙': '讓修仙者身處現代，衝突於靈氣與科技之間',
        '洪荒流': '以洪荒神話為底，寫大神通與天道博弈',
        '神話修真': '結合神話體系與修真，向仙神境界攀登',
        '江湖俠客': '寫行走江湖的俠客與其恩怨情義',
        '門派爭鬥': '圍繞門派間的爭鬥、傳承與陰謀展開',
        '劍與情仇': '以劍客的愛恨情仇為核心，快意又深情',
        '飛升成仙': '寫主角一路修行、最終飛升成仙',
        '道法自然': '走清逸的修道路線，重意境與心境',
        '武林至尊': '寫主角問鼎武林之巔的爭霸歷程',
        '妖魔鬼怪': '寫人與妖魔鬼怪交鋒或糾纏的故事',
        '陰陽師': '以陰陽術數、驅邪降妖為主軸',
        '捉妖記': '圍繞捉妖除魔的任務與奇遇展開',
        '修魔大道': '走以魔入道的路線，亦正亦邪',
        '逆天改命': '寫主角逆抗天命、扭轉既定命運',
        '氣運之子': '寫身負氣運的主角一路機遇不斷地崛起',
        // 科幻類
        '硬科幻': '講求科學嚴謹，圍繞真實科技原理推演',
        '軟科幻': '把科技當背景，聚焦人與社會的想像',
        '太空歌劇': '寫跨星系的宏大冒險、帝國與星際戰爭',
        '賽博龐克': '寫高科技低生活，義體、企業霸權與街頭反抗',
        '蒸汽龐克': '以齒輪蒸汽科技打造復古奇異的工業世界',
        '柴油龐克': '以柴油機械與戰間期美學構築硬派世界',
        '後啟示錄': '寫文明崩壞後的廢土求生與重建',
        '人工智慧': '圍繞 AI 覺醒、人機關係與倫理衝突',
        '時間旅行': '以穿梭時間、改變過去與悖論為核心',
        '外星文明': '寫與外星種族的接觸、衝突或共存',
        '基因改造': '圍繞基因工程、改造人與倫理爭議',
        '虛擬實境': '把舞台放進虛擬世界，虛實交錯',
        '機甲戰爭': '以機甲駕駛與大規模機械戰為主軸',
        '星際戰爭': '寫星系間的軍事對抗與宏大戰役',
        '殖民星球': '寫開拓外星殖民地的艱險與矛盾',
        '克隆人': '圍繞複製人身分、人權與自我認同',
        '意識上傳': '探討意識數位化後的存在與人性',
        '量子世界': '以量子現象、平行可能性玩轉設定',
        '近未來都市': '寫可預見未來的都市科技與社會變遷',
        '反烏托邦': '寫極權監控下的壓抑社會與反抗',
        '生化危機': '以病毒、變異與末日疫情為主軸',
        '納米科技': '圍繞奈米機械帶來的變革與失控',
        '太空探索': '寫深空探險、未知星域的發現與挑戰',
        '第一次接觸': '聚焦人類初次遭遇外星文明的震撼與抉擇',
        // 愛情類
        '浪漫愛情': '以浪漫戀情為主軸，細寫心動與相守',
        '甜蜜寵愛': '走甜寵路線，滿滿糖分與寵溺互動',
        '虐戀情深': '寫相愛卻備受折磨的深情虐戀',
        '禁忌之戀': '圍繞不被允許的戀情與其掙扎',
        '破鏡重圓': '寫分離的戀人歷經波折後重修舊好',
        '先婚後愛': '從婚姻開始，再慢慢培養出愛情',
        '青梅竹馬': '寫從小相伴的戀人日久生情',
        '一見鍾情': '以怦然心動的初遇展開戀情',
        '日久生情': '寫相處中悄然滋長的感情',
        '暗戀成真': '寫暗戀者最終修成正果',
        '歡喜冤家': '以鬥嘴冤家互相吸引的戀情為趣味',
        '辦公室戀情': '寫職場中萌生的戀愛與現實考量',
        '豪門恩怨': '以豪門家族的愛恨糾葛為背景',
        '灰姑娘': '寫平凡女孩與尊貴對象的愛情童話',
        '霸道總裁': '寫強勢總裁與其戀人的甜寵拉扯',
        '跨越時空的愛': '寫超越時空阻隔的深情戀曲',
        '異族之戀': '寫人與異族之間的禁忌戀情',
        '人妖之戀': '寫人與妖之間的深情與宿命',
        '婚後生活': '聚焦婚後日常的甜蜜與磨合',
        '甜蜜日常': '以戀人溫馨日常的小確幸為主',
        '雙向暗戀': '寫兩人互相暗戀卻不自知的甜蜜',
        '契約戀愛': '從假戀愛契約發展出真感情',
        '重生追愛': '讓角色重生後重新追回摯愛',
        '娛樂圈戀愛': '寫演藝圈中的戀情與名利考驗',
        // 懸疑推理類
        '本格推理': '以嚴謹詭計與線索，讓讀者一同破解',
        '社會派推理': '藉案件揭露社會問題與人性陰暗',
        '密室殺人': '圍繞不可能犯罪的密室詭計展開',
        '連環殺手': '追查連續殺人案與兇手的心理',
        '法庭攻防': '以法庭上的證據與辯論定勝負',
        '警匪對決': '寫警方與罪犯的鬥智鬥力',
        '間諜諜戰': '圍繞情報、潛伏與雙面博弈',
        '犯罪心理': '深入罪犯與辦案者的心理側寫',
        '冷案重啟': '重新偵辦塵封舊案、翻出真相',
        '復仇計畫': '以縝密的復仇布局推動劇情',
        '完美犯罪': '寫看似天衣無縫的犯罪與破綻',
        '懸疑推理': '佈局謎團與線索，層層推理解謎',
        '心理懸疑': '以心理錯位與不安營造懸念',
        '反轉劇情': '鋪陳伏筆，於結尾拋出意外反轉',
        '尋找真兇': '以追查真兇為主線層層逼近',
        '神探破案': '寫神探憑推理與觀察屢破奇案',
        '暗黑偵探': '走冷硬陰暗風格的偵探辦案',
        '無罪推定': '圍繞證明清白與司法正義的角力',
        // 恐怖驚悚類
        '心理恐怖': '以心理壓迫與精神崩解營造恐懼',
        '靈異鬼怪': '寫鬼魂、靈異事件與陰森氛圍',
        '克蘇魯神話': '寫不可名狀的舊日支配者與瘋狂',
        '都市怪談': '以都市傳說與身邊怪事製造驚悚',
        '詛咒傳說': '圍繞古老詛咒與其連鎖厄運',
        '鬼屋探險': '寫探入鬼屋遭遇的驚魂事件',
        '喪屍危機': '寫喪屍爆發後的絕境求生',
        '邪教儀式': '圍繞邪教、獻祭與禁忌儀式',
        '恐怖驚悚': '營造持續的恐怖與緊張刺激',
        '民俗恐怖': '以民間信仰與禁忌習俗製造陰森',
        '校園怪談': '寫校園中流傳的靈異怪事',
        '醫院驚魂': '以醫院為舞台上演驚悚事件',
        '怪物獵人': '寫獵殺各種怪物的驚險行動',
        '深海恐懼': '以深海未知與幽閉營造恐懼',
        '太空驚魂': '寫封閉太空中的未知威脅',
        '末日求生': '寫災難末世下的生存掙扎',
        '異形入侵': '寫異形怪物入侵與人類抵抗',
        '寄生獸': '圍繞寄生生物與人體異變的恐怖',
        // 歷史類
        '歷史傳奇': '以歷史為底鋪陳人物傳奇與大時代',
        '宮廷鬥爭': '寫宮廷權力傾軋與爾虞我詐',
        '後宮爭寵': '圍繞後宮妃嬪的爭寵與算計',
        '戰國風雲': '寫戰國群雄割據與縱橫謀略',
        '三國演義': '以三國群雄逐鹿與智謀交鋒為題',
        '楚漢爭霸': '寫楚漢相爭的英雄與天下之爭',
        '民國風華': '以民國時代的動盪與風華為背景',
        '古代商戰': '寫古代商賈的經營與商場鬥爭',
        '帝王將相': '聚焦帝王與將相的權謀與功業',
        '亂世英雄': '寫亂世中崛起的英雄與抉擇',
        '歷史穿越': '讓現代人穿越古代、攪動歷史',
        '架空歷史': '以「若歷史轉彎」改寫時代走向',
        '抗戰風雲': '以抗戰烽火與家國存亡為背景',
        '諜戰風雲': '寫近代情報戰與潛伏鬥爭',
        '科舉之路': '寫寒窗苦讀、科舉晉身的奮鬥',
        '盛世繁華': '描繪盛世的繁榮景象與眾生百態',
        '王朝覆滅': '寫一個王朝由盛轉衰的崩解',
        '開國大業': '寫開國創業、平定天下的雄圖',
        // 現代都市類
        '現代都市': '寫當代都市生活的際遇與人情',
        '職場風雲': '以職場競爭、晉升與權謀為主',
        '娛樂圈': '寫演藝圈的名利、光鮮與內幕',
        '體育競技': '寫運動場上的拼搏與奪冠夢',
        '電競熱血': '寫電競選手的訓練、對戰與榮耀',
        '創業奮鬥': '寫白手起家、闖蕩商海的奮鬥',
        '校園青春': '寫校園中的青春、友情與戀愛',
        '家庭倫理': '聚焦家庭關係的溫情與矛盾',
        '社會寫實': '以寫實筆觸描繪社會百態',
        '網紅生活': '寫網紅經營與流量時代的浮沉',
        '直播人生': '以直播為舞台寫個人的起落',
        '都市異能': '讓異能者身處都市、暗藏波瀾',
        '重生都市': '讓角色重生回到過去改寫都市人生',
        '商戰風雲': '寫商業帝國的博弈與併購鬥爭',
        '醫療職人': '寫醫護人員的專業日常與生死',
        '法律正義': '以律師、司法追求正義為主',
        '教師人生': '寫教育工作者的付出與成長',
        '記者追蹤': '寫記者追查真相、揭露內幕',
        // 軍事戰爭類
        '軍事戰爭': '以戰爭與軍事行動為核心展開',
        '戰爭史詩': '寫大時代戰爭的宏大史詩',
        '特種兵': '寫特種部隊的訓練與極限任務',
        '傭兵生涯': '寫傭兵出生入死的戰場人生',
        '軍旅生活': '寫軍營中的紀律、袍澤與成長',
        '海軍艦隊': '以海戰與艦隊指揮為主軸',
        '空戰英雄': '寫飛行員的空中纏鬥與英勇',
        '狙擊手': '聚焦狙擊手的潛伏、耐心與一擊',
        '諜報人員': '寫情報人員的滲透與危險任務',
        '戰地醫護': '寫戰場救護的搶救與人性光輝',
        '戰爭與和平': '在戰爭背景下寫命運與人性反思',
        '未來戰爭': '寫高科技武器主導的未來戰場',
        // 冒險探索類
        '海洋冒險': '寫航海遠洋的冒險與未知海域',
        '西部拓荒': '寫西部荒野的拓荒與槍手傳奇',
        '北歐維京': '寫維京海盜的劫掠、航海與神話',
        '探險尋寶': '以尋找失落寶藏的探險為主線',
        '荒野求生': '寫在荒野絕境中的生存挑戰',
        '登山探險': '寫攀登險峰的挑戰與意志',
        '叢林探險': '寫深入叢林的探索與危機',
        '沙漠之旅': '寫穿越沙漠的艱險旅程',
        '極地冒險': '寫極地嚴寒中的探險與求生',
        '地心探索': '寫深入地底未知世界的探險',
        '空島冒險': '寫漂浮空島間的奇幻冒險',
        '異世界探險': '寫踏入異世界的探索與奇遇',
        // 生活職業類
        '美食料理': '以料理與美食為主線，寫廚藝與人情',
        '甜點烘焙': '寫烘焙甜點的手藝與溫暖故事',
        '音樂夢想': '寫追逐音樂夢想的努力與舞台',
        '繪畫人生': '寫以繪畫為志業的創作與成長',
        '舞蹈青春': '寫為舞蹈揮灑汗水的青春與夢想',
        '攝影故事': '以攝影之眼捕捉人與世界的故事',
        '寵物情緣': '寫人與寵物之間的陪伴與情誼',
        '園藝生活': '寫園藝種植的療癒日常',
        '手工藝人': '寫手作職人的匠心與堅持',
        '書店日常': '以書店為舞台寫溫馨的日常',
        '咖啡廳物語': '在咖啡廳裡寫來往人們的故事',
        '花店故事': '以花店為背景寫花與人的情緣',
        // 特殊題材類
        '末世廢土': '寫末世廢土的求生與資源爭奪',
        '異能覺醒': '寫主角覺醒異能後的變局',
        '系統流': '以系統面板與任務驅動主角成長',
        '無限流': '寫在一個個副本世界間闖關求生',
        '副本遊戲': '把闖關副本的遊戲機制當主線',
        '直播求生': '寫邊直播邊在險境中求生',
        '規則怪談': '以詭異規則與遵守與否製造驚悚',
        '詭異遊戲': '寫被迫參與的死亡或詭異遊戲',
        '靈氣復甦': '寫現代靈氣復甦、超凡崛起的新局',
        '諸天萬界': '寫穿梭諸天萬界、集齊機緣的旅程',
        '快穿系統': '讓主角綁定系統、快速穿梭各世界任務',
        '綜漫同人': '把多部作品角色與世界交織同框',
        '異世界轉生': '讓主角轉生異世界、重啟人生',
        '重生復仇': '讓角色重生後展開縝密復仇',
        '重生經商': '讓角色重生後憑先知經商致富',
        '重生娛樂圈': '讓角色重生後在娛樂圈翻身',
        '空間種田': '結合隨身空間與種田經營的慢日常',
        '隨身老爺爺': '寫主角獲得隨身高人指點的成長',
        // 年代/懷舊類
        '年代生活': '重現舊年代的生活質感與人情味',
        '八零年代': '以 1980 年代的社會風貌為背景',
        '九零年代': '以 1990 年代的時代氛圍為背景',
        '千禧校園': '寫千禧年前後的校園青春',
        '老上海往事': '重現老上海的摩登與風雲',
        '眷村歲月': '寫眷村生活的人情與時代印記',
        '改革開放浪潮': '寫改革開放下的機遇與變遷',
        '下海經商': '寫時代浪潮中下海經商的起落',
        '知青歲月': '寫知青上山下鄉的青春與滄桑',
        '工廠青春': '寫工廠年代的奮鬥與集體記憶',
        '票證年代': '重現物資憑票的年代生活百態',
        '大院子弟': '寫大院子弟的成長與時代烙印',
        // 諜戰/特工類
        '冷戰諜影': '以冷戰情報對抗與諜影重重為背景',
        '反間諜戰': '寫揪出內鬼、反制敵方間諜',
        '地下情報網': '圍繞地下情報網的經營與危機',
        '潛伏敵營': '寫長期潛伏敵營的隱忍與風險',
        '密碼破譯': '以破譯密碼、情報攻防為核心',
        '雙面間諜': '寫遊走兩方的雙面間諜與身分危機',
        '特工歸來': '寫退役特工重出江湖的行動',
        '情報販子': '寫買賣情報者遊走灰色地帶',
        '叛逃與追緝': '寫叛逃者與追緝者的貓鼠對決',
        '黑色行動': '寫見不得光的秘密行動與犧牲',
        // 機甲/星際細分
        '機甲格鬥': '以機甲近身格鬥與熱血對決為主',
        '駕駛員之魂': '寫機甲駕駛員的羈絆與成長',
        '星艦艦長': '寫星艦艦長指揮航行與作戰',
        '星際傭兵': '寫星際傭兵接單闖蕩的冒險',
        '銀河開拓': '寫開拓銀河新疆域的雄圖',
        '戴森球建造': '以巨型天體工程建造為題的硬核科幻',
        '宇宙文明': '寫宇宙尺度的文明興衰與博弈',
        '蟲族戰爭': '寫人類對抗蟲族的殘酷戰爭',
        '星海殖民': '寫星海殖民地的拓荒與矛盾',
        '曲速遠征': '寫超光速遠征深空的探索',
        // 克蘇魯/詭秘類
        '舊日支配者': '寫舊日支配者降臨與人類的渺小',
        '瘋狂山脈': '以極地未知遺跡與古老恐怖為題',
        '深潛者傳說': '寫深海異族與血脈詛咒的恐懼',
        '非歐幾何': '以扭曲空間與認知崩壞製造詭異',
        '污染與瘋狂': '寫接觸禁忌後的精神污染與瘋狂',
        '禁忌知識': '圍繞追求禁忌知識的代價',
        'SCP收容': '以異常物項的收容與失控為題',
        '異常檔案': '用檔案形式記錄超常現象與調查',
        '詭秘規則': '以必須遵守的詭異規則製造壓迫',
        '怪奇調查局': '寫專責調查超自然事件的組織',
        // 轉生變身類
        '轉生史萊姆': '寫轉生成史萊姆後的成長與逆襲',
        '轉生成劍': '讓主角轉生為劍、以物之視角闖蕩',
        '轉生成龍': '寫轉生為龍後的成長與稱霸',
        '轉生成魔王': '寫轉生成魔王、重建勢力的歷程',
        '轉生成幽靈': '以幽靈之身展開的奇異經歷',
        '轉生成NPC': '寫轉生為遊戲 NPC 後掙脫設定',
        '最弱職業逆襲': '寫最弱職業出身者的逆襲之路',
        '被廢除的勇者': '寫被廢黜勇者的東山再起',
        '解雇後封神': '寫遭放逐者另起爐灶、終成傳說',
        '轉生反派千金': '讓主角轉生成反派千金並改寫結局',
        // 地下城/迷宮類
        '地下城經營': '寫經營地下城、抵禦入侵者的策略',
        '迷宮主': '以迷宮主宰視角布置與防守',
        '成為迷宮BOSS': '寫化身迷宮首領的成長與對抗',
        '探索者公會': '圍繞探索者公會的任務與冒險',
        '地城討伐': '寫組隊攻略地城的戰鬥與寶藏',
        '深層攻略': '寫向地城深層挺進的極限挑戰',
        // 經營建設類
        '基地建設': '寫從零建設基地、逐步壯大',
        '王國經營': '寫治理王國、發展國力的謀略',
        '商業帝國': '寫打造商業帝國的經營與競爭',
        '餐廳經營': '寫經營餐廳的用心與人情故事',
        '旅館經營': '寫經營旅館、迎來送往的故事',
        '莊園領主': '寫領主經營莊園、發展領地',
        '科技樹點滿': '以研發科技、逐項解鎖為樂趣',
        '資源帝國': '寫掌控資源、建立產業帝國',
        '城邦崛起': '寫一座城邦由弱到強的崛起',
        // 特殊融合類
        '料理修仙': '把料理與修仙結合，以廚藝入道',
        '賽博修真': '融合賽博科技與東方修真',
        '機械飛升': '以機械改造走向飛升的另類修行',
        '靈氣復甦現代': '寫現代靈氣復甦後的修行新局',
        '末世種田': '在末世廢土中經營種田、自給自足',
        '廢土綠洲': '寫在廢土中打造綠洲家園',
        '大海賊時代': '寫群雄逐夢的大海賊冒險時代',
        '海賊王座': '寫爭奪海上霸權與寶藏的征途',
        '聊齋志異': '以志怪短篇的人妖鬼狐奇緣為題',
        '山海奇譚': '取材山海經的奇獸與上古奇想',
        '神怪志異': '寫神怪交織的志異奇談',
        '劍與魔法': '以劍與魔法的經典西幻設定展開',
        // 無限/輪迴類
        '無限恐怖': '寫在恐怖副本間輪番求生',
        '輪迴樂園': '以輪迴闖關的樂園設定推進',
        '主神空間': '寫被主神空間選中、闖世界求生',
        '副本輪迴': '在一個個副本中反覆挑戰求生',
        '死亡輪迴': '寫角色死亡後不斷重來、尋求破局',
        '詛咒輪迴': '寫被詛咒困在輪迴中掙扎解脫',
        // 現代職人細分
        '刑偵重案': '寫刑警偵辦重案的推理與追兇',
        '法醫筆記': '以法醫解剖與物證還原真相',
        '消防英雄': '寫消防員的搶救與生死一線',
        '急診風雲': '寫急診室的搶救與醫護日常',
        '飛行員之路': '寫民航或軍機飛行員的養成與挑戰',
        '遠洋船員': '寫遠洋船員的航海生活與孤寂',
        '荒野直播': '寫在荒野邊求生邊直播的冒險',
        '靈異直播': '寫直播探訪靈異地點的驚悚',
        '寵物醫生': '寫獸醫救治動物的溫情日常',
        '米其林之路': '寫廚師追逐米其林星級的奮鬥',
        // 體育競技類
        '足球風雲': '以足球賽場為主軸，寫戰術、隊友與冠軍之夢',
        '籃球青春': '寫籃球場上的熱血對決與青春成長',
        '網球對決': '以網球單打或雙打，寫技術磨練與大賽對決',
        '圍棋少年': '寫圍棋對弈、棋道修養與勝負心魔',
        'F1賽車': '以方程式賽車為舞台，寫速度、車隊與彎道生死一瞬',
        '游泳之路': '寫游泳訓練、泳池競速與突破個人極限',
        '馬拉松挑戰': '以長跑馬拉松為主線，寫耐力、意志與終點衝線',
        '滑冰競技': '寫花式滑冰或競速滑冰的優雅與競技壓力',
        '拳擊擂台': '以拳擊擂台為核心，寫出拳、挨揍與榮耀復仇',
        '奧運追夢': '寫朝奧運金牌奮鬥的多年訓練與賽場高光',
        // 偶像音樂類
        '偶像養成': '寫練習生選拔、出道與偶像舞台成長',
        '地下樂團': '寫地下樂團排練、小場演出與堅持夢想',
        '聲優之路': '以配音演員養成為主線，寫試音、角色與幕後聲線',
        '唱跳練習生': '寫唱跳練習、考核淘汰與團體出道',
        '綜藝星探': '以綜藝選秀或星探發掘為舞台，寫曝光與人設',
        '古典音樂家': '寫古典樂演奏、指揮或作曲的藝術追求',
        '街頭嘻哈': '以街頭嘻哈文化為底，寫饒舌、塗鴉與地下認同',
        '樂隊主唱': '寫樂隊主唱的創作、巡演與團隊羈絆',
        '鋼琴師成長': '以鋼琴學習與演奏為主線，寫技法與舞台恐懼',
        '國樂傳承': '寫國樂器演奏、傳承師承與新舊融合',
        // 宮廷宅鬥類
        '後宮爭寵': '以後宮嬪妃爭寵為主軸，寫位份、子嗣與帝心',
        '宅門嫡女': '寫宅門中嫡女的身份、教養與婚嫁算計',
        '嫡庶之爭': '以嫡庶之爭為核心，寫資源、尊卑與反擊',
        '侯府深深': '寫侯府深宅內的人情冷暖與權力暗流',
        '皇后之路': '以登上后位為目標，寫權謀、聯盟與母儀天下',
        '和親公主': '寫和親公主遠嫁異國的命運與政治牽絆',
        '寵妃復寵': '寫失寵後重新得寵的逆襲與心計',
        '望族聯姻': '以世家聯姻為紐帶，寫利益、情義與門第',
        '正室對決': '寫正室與側室或妾室的明爭暗鬥',
        '深閨密謀': '以深閨女子密謀為主，寫情報、同盟與反殺',
        // 網文機制類
        '全民領主': '寫全民進入領主世界，建設領地、征伐升級',
        '國運直播': '以國運直播為設定，寫全民關注下的闖關與博弈',
        '萬界聊天群': '寫加入跨界聊天群，靠交流與交易改寫命運',
        '每日簽到': '以每日簽到獎勵為機制，推動穩步變強',
        '人生模擬器': '寫反覆模擬人生選擇，試錯找最優路線',
        '功德成聖': '以累積功德、行善積德為升級路徑',
        '詞條抽取': '寫抽取隨機詞條能力，組合搭配變強',
        '許願系統': '以許願兌現為核心機制，寫願望代價與取捨',
        '商城兌換流': '寫靠積分或貨幣在神秘商城兌換能力與道具',
        '經驗加倍': '以經驗加倍等增益機制，加速成長與爽感',
        // 武道格鬥類
        '地下拳賽': '寫地下黑拳賽的殘酷對決與賭局陰影',
        '綜合格鬥': '以綜合格鬥為舞台，寫站立、摔柔與終結技',
        '劍道之心': '寫劍道修習、段位晉升與一招一式的精神',
        '空手道之路': '以空手道訓練與大賽為主線，寫禮儀與剛猛',
        '跆拳道挑戰': '寫跆拳道腿法訓練、品勢與實戰對決',
        '泰拳燃魂': '以泰拳膝肘為特色，寫狠勁訓練與擂台熱血',
        '摔跤擂台': '寫摔跤或摔角擂台的力量對抗與戲劇張力',
        '散打冠軍': '以散打冠軍之路為目標，寫實戰與教練羈絆',
        '街頭格鬥': '寫街頭格鬥、地下規則與自保反擊',
        '傳統武術': '以傳統武術門派為底，寫師承、套路與實戰',
        // 海外華人類
        '華僑商戰': '寫華僑在異國經商創業的競爭與算計',
        '唐人街傳奇': '以唐人街為舞台，寫江湖、商幫與移民史',
        '留學生涯': '寫海外留學的學業、孤獨與文化適應',
        '海外移民': '以移民定居為主線，寫身份、工作與家庭重建',
        '異國合夥': '寫華人與當地人合夥創業的磨合與信任',
        '唐人街探案': '以唐人街為背景，寫移民社會的謎案與偵破',
        '唐人街餐館': '寫唐人街餐館經營、食客故事與鄉愁味道',
        '回流創業': '寫海外回流後創業或紮根的二次選擇',
        '僑鄉報國': '以報效祖國為動機，寫僑胞資金、技術與情感',
        '雙城生活': '寫往返兩地、雙城奔波的生活與身分撕裂',
        // 耽美百合類
        '雙男主之戀': '以兩位男性主角的戀愛為主軸展開',
        '百合純愛': '以兩位女性主角的純愛與心動為主軸',
        'ABO設定': '套用 ABO 世界觀，寫資訊素、配對與社會規則',
        '年上攻': '寫年長一方主動追求、引導的戀愛關係',
        '年下寵': '寫年下一方撒嬌、被寵溺的甜蜜互動',
        '師徒戀': '以師徒身分為禁忌或張力，寫情愫漸生',
        '宿敵相愛': '寫宿敵之間從對立到相愛的轉折',
        '破鏡重圓BL': '寫同性戀人分手後重逢、修復關係',
        '職場雙雄': '以職場雙男主為舞台，寫合作與暗戀',
        '校園純愛BL': '寫校園裡男生之間的純愛與青春'
      };

      // 背景：逐選項對生成的實際影響
      const settingOptionImpacts = {
        // 奇幻世界
        '虛構的中世紀王國': '以城堡、領主與封建禮制為舞台，帶中世紀奇幻質感',
        '精靈族的森林國度': '以古老森林、精靈文明與自然魔法為主要場景',
        '矮人的地底城市': '以地下城邦、鍛造與礦脈為舞台，幽閉而堅固',
        '龍族盤據的火山島': '以火山島、龍族威壓與熔岩危機為背景',
        '魔法師的浮空塔': '以懸空高塔、奧術研究與高空視野為場景',
        '被詛咒的黑暗森林': '以陰森詛咒森林營造壓抑與未知威脅',
        '神聖的光明神殿': '以神殿、聖光與宗教秩序為莊嚴背景',
        '亡靈橫行的荒原': '以荒原、亡靈出沒與死寂氛圍為舞台',
        '海妖出沒的神秘海域': '以迷霧海域、海妖傳說與航海危險為場景',
        '隱藏在迷霧中的仙境': '以迷霧仙境、隱世與超脫凡俗為背景',
        '魔法公會總部': '以公會總部、任務發布與法師聚集為舞台',
        '冒險者協會': '以冒險者接案、組隊與酒館情報為日常場景',
        '魔獸橫行的危險地帶': '以魔獸出沒的險地強調戰鬥與求生',
        '古老的魔法遺跡': '以失落遺跡、古代機關與秘寶為探索舞台',
        '封印邪神的聖地': '以封印聖地、禁忌與瀕臨甦醒的邪神為背景',
        '龍騎士的訓練場': '以龍騎訓練、騎龍試煉與榮耀競技為場景',
        '精靈女王的宮殿': '以精靈宮廷、優雅禮儀與森林王權為舞台',
        '獸人部落的營地': '以獸人營地、部落規矩與野性文化為背景',
        '半獸人的邊境要塞': '以邊境要塞、種族摩擦與駐防生活為場景',
        '魔法結界保護的學院': '以魔法學院、結界內外的安全與修習為舞台',
        // 仙俠修真世界
        '修仙門派的靈山': '以靈山門派、清修與師徒傳承為修真舞台',
        '洞天福地': '以洞天福地、靈氣充沛與隱世修煉為場景',
        '魔教總壇': '以魔教總壇、邪功與正邪對立為陰暗背景',
        '妖族領地': '以妖族領地、非人種族與弱肉強食為舞台',
        '靈獸森林': '以靈獸棲息的森林，寫契約、馴服與奇遇',
        '仙人洞府': '以仙人洞府、禁制與遺留傳承為探索場景',
        '煉丹閣': '以煉丹房、丹火與丹藥成敗為修真細節',
        '藏經閣': '以藏經閣、功法典籍與參悟為修習舞台',
        '劍冢': '以劍冢、名劍與劍意傳承為武道場景',
        '雷劫渡劫之地': '以渡劫雷池、天劫與生死一線為關鍵場景',
        '凡人修仙界': '以凡人界與修仙界並存的階層世界為背景',
        '上古戰場遺跡': '以上古戰場殘骸、殺意與機緣為舞台',
        '秘境入口': '以秘境入口、爭奪與限時探索為場景',
        '仙魔戰場': '以仙魔交戰的戰場，瀰漫殘酷與因果',
        '輪迴之地': '以輪迴之地、前世因果與輪迴規則為背景',
        '天庭凌霄殿': '以天庭凌霄、仙官禮制與天規為神界舞台',
        '地府閻羅殿': '以地府審判、輪迴與陰司秩序為冥界場景',
        '龍宮': '以海底龍宮、水府仙珍與龍族威儀為舞台',
        '蓬萊仙島': '以蓬萊仙島、求仙與長生傳說為場景',
        '崑崙仙境': '以崑崙仙山、上古仙脈與大道清修為背景',
        // 古代中國
        '皇宮紫禁城': '以紫禁城深宮、皇權與朝堂禮制為舞台',
        '王府深宅': '以王府深宅、嫡庶與內院規矩為背景',
        '江南水鄉': '以江南水鄉、橋巷與煙雨詩意為場景',
        '邊塞關隘': '以邊關要塞、戍邊與胡漢交界為舞台',
        '絲路古道': '以絲路商隊、異域風情與長途跋涉為場景',
        '唐朝長安城': '以盛唐長安、開放繁華與万国來朝為背景',
        '宋代繁華汴京': '以汴京市井、商賈與文人雅集為舞台',
        '明朝江南': '以明代江南、商幫與科舉風氣為場景',
        '清朝京城': '以清代京城、旗人禮制與宮禁森嚴為背景',
        '戰國時代的城池': '以戰國城池、諸侯割據與縱橫捭闔為舞台',
        '三國時期的戰場': '以三國戰場、謀略與軍陣對決為場景',
        '科舉考場': '以科舉考場、寒窗與金榜題名為背景',
        '青樓楚館': '以青樓楚館、才貌與紅塵情緣為舞台',
        '客棧茶樓': '以客棧茶樓、江湖情報與過客聚散為場景',
        '鏢局總部': '以鏢局走鏢、護鏢與江湖規矩為背景',
        '武林盟主的莊園': '以盟主莊園、武林聚會與江湖秩序為舞台',
        '隱世村落': '以隱世村落、避世與樸素人情為場景',
        '少林寺': '以少林禪武、戒律與武僧修行為背景',
        '武當山': '以武當道觀、太極與清修為舞台',
        '峨眉金頂': '以峨眉金頂、女俠門風與雲海為場景',
        // 古代其他
        '古羅馬競技場': '以羅馬競技場、角鬥與帝國榮光為舞台',
        '埃及法老王宮': '以法老王宮、尼羅河與神權為背景',
        '希臘神殿': '以希臘神殿、神諭與城邦悲劇為場景',
        '維京海盜船': '以維京長船、劫掠與北歐神話為舞台',
        '日本戰國城堡': '以戰國城堡、大名與合戰為背景',
        '中世紀歐洲城堡': '以歐洲城堡、騎士與封建領主為場景',
        '騎士團要塞': '以騎士團要塞、誓言與聖戰為舞台',
        '阿拉伯宮殿': '以阿拉伯宮殿、沙漠與一千零一夜風情為背景',
        '瑪雅神廟': '以瑪雅神廟、叢林與古文明謎團為場景',
        '印加帝國': '以印加高原、梯田與帝國遺跡為舞台',
        '波斯帝國': '以波斯宮廷、絲路與帝國威儀為背景',
        '拜占庭皇宮': '以拜占庭皇宮、東正教與帝國餘暉為場景',
        '蒙古大草原': '以蒙古草原、遊牧與鐵騎為舞台',
        '奧斯曼帝國': '以奧斯曼宮廷、蘇丹與多族並存為背景',
        '中世紀修道院': '以修道院、抄經與隱修生活為場景',
        // 近現代歷史
        '民國時期的上海灘': '以民國上海灘、租界與風雲際會為舞台',
        '十里洋場': '以十里洋場、霓虹與紙醉金迷為背景',
        '租界區': '以租界區、中西交錯與治外法權為場景',
        '抗戰時期的重慶': '以抗戰重慶、防空洞與堅韌為舞台',
        '延安窯洞': '以延安窯洞、革命與艱苦歲月為背景',
        '維多利亞時代的倫敦': '以維多利亞倫敦、霧都與紳士淑女為場景',
        '工業革命的工廠': '以蒸汽工廠、勞工與機械轟鳴為舞台',
        '美國西部荒野': '以西部荒野、牛仔與法外之地為背景',
        '淘金熱時代': '以淘金熱、夢想與蠻荒秩序為場景',
        '二戰時期的歐洲戰場': '以二戰歐洲戰場、廢墟與存亡為舞台',
        '冷戰時期的柏林': '以冷戰柏林、鐵幕與間諜陰影為背景',
        '六七十年代的香港': '以六七十年代香港、市井與動盪為場景',
        '八九十年代的台灣': '以八九十年代台灣、社會轉型與懷舊為舞台',
        // 現代都市
        '繁華的現代大都會': '以現代大都會、快節奏與都市叢林為舞台',
        '國際金融中心': '以金融中心、資本博弈與精英競爭為背景',
        '頂級跨國企業總部': '以跨國企業總部、高層決策與職場政治為場景',
        '創業孵化器': '以創業孵化器、夢想與破釜沉舟為舞台',
        '時尚雜誌社': '以時尚雜誌社、潮流與名利場為背景',
        '電視台演播廳': '以演播廳、鏡頭與直播壓力為場景',
        '電影拍攝現場': '以片場、導演與演員的幕後為舞台',
        '娛樂公司練習室': '以練習室、練習生與出道競爭為背景',
        '高級私人會所': '以私人會所、階級與隱秘交易為場景',
        '地下拳場': '以地下拳場、血腥與賭注為舞台',
        '酒吧夜店': '以酒吧夜店、夜生活與短暫邂逅為背景',
        '高檔餐廳': '以高檔餐廳、精緻料理與服務細節為場景',
        '米其林廚房': '以米其林廚房、高壓出餐與廚藝對決為舞台',
        '私立貴族學校': '以貴族學校、階級差異與青春競爭為背景',
        '普通高中校園': '以普通高中、課業與同儕關係為場景',
        '大學城': '以大學城、社團、戀愛與畢業抉擇為青春舞台',
        '研究所實驗室': '以研究所實驗室、科研與師生關係為背景',
        '醫學院附屬醫院': '以醫學院醫院、實習與生死第一線為場景',
        // 職業場所
        '忙碌的三甲醫院': '以三甲醫院、急診與醫護高壓為舞台',
        '律師事務所': '以律所、案件攻防與正義與利益為背景',
        '警察局刑偵隊': '以刑偵隊、辦案與正邪較量為場景',
        '法院審判庭': '以審判庭、證詞與法槌定音為舞台',
        '檢察院': '以檢察院、起訴與證據鏈為背景',
        '消防局': '以消防局、出警與火場搶救為場景',
        '軍事基地': '以軍事基地、紀律與訓練為舞台',
        '特種部隊訓練營': '以特種訓練營、極限試煉與戰友羈絆為背景',
        '情報機構總部': '以情報總部、機密與諜報為場景',
        '監獄': '以監獄、鐵窗與生存法則為壓抑舞台',
        '精神病院': '以精神病院、治療與現實與幻覺為背景',
        '心理診所': '以心理診所、傾聽與內心創傷為場景',
        '殯儀館': '以殯儀館、告別與生死邊界為舞台',
        '考古現場': '以考古現場、發掘與歷史重現為背景',
        '博物館': '以博物館、文物與靜默的故事為場景',
        // 科幻世界
        '近未來的高科技城市': '以近未來都市、新科技與社會變革為舞台',
        '賽博龐克的霓虹都市': '以霓虹都市、義體與企業霸權為背景',
        '人工智慧統治的城市': '以 AI 統治城市、監控與人機關係為場景',
        '遙遠的太空殖民地': '以太空殖民地、拓荒與異星環境為舞台',
        '宇宙戰艦內部': '以戰艦艙室、封閉空間與艦隊生活為背景',
        '太空站': '以太空站、失重與軌道孤絕為場景',
        '火星殖民基地': '以火星基地、紅土與殖民困境為舞台',
        '月球基地': '以月球基地、低重力與地月補給為背景',
        '海底都市': '以海底都市、耐壓與深海未知為場景',
        '虛擬實境世界': '以虛擬世界、數位身分與虛實交界為舞台',
        '量子電腦核心': '以量子核心、運算與現實改寫為背景',
        '基因改造實驗室': '以基因實驗室、改造與倫理邊界為場景',
        '反烏托邦的監控城市': '以監控城市、極權與反抗為壓抑舞台',
        '廢土末世': '以廢土末世、資源匱乏與秩序崩壞為背景',
        '喪屍肆虐的城市': '以喪屍圍城、封鎖與求生為場景',
        '外星人飛船內部': '以外星飛船內部、未知科技與幽閉為舞台',
        '環形世界': '以環形世界、人造天體與宏觀尺度為背景',
        '戴森球': '以戴森球、恆星級工程與文明極限為場景',
        '星際貿易站': '以星際貿易站、各族交易與灰色地帶為舞台',
        '銀河聯邦議會': '以銀河議會、星際政治與外交為背景',
        '克隆人培育中心': '以克隆中心、複製人與身分倫理為場景',
        // 異世界/異空間
        '平行宇宙': '以平行宇宙、另一個自己與分歧為舞台',
        '異次元空間': '以異次元、規則異常與迷失為背景',
        '夢境世界': '以夢境世界、虛幻與潛意識為場景',
        '靈界與冥府': '以靈界冥府、亡者與陰陽交界為舞台',
        '天界與仙境': '以天界仙境、仙樂與超脫凡俗為背景',
        '地獄深淵': '以地獄深淵、業火與審判為場景',
        '時間裂縫之中': '以時間裂縫、時序錯亂與因果為舞台',
        '量子疊加的世界': '以量子疊加、多重可能同時存在為背景',
        '遊戲副本空間': '以遊戲副本、關卡規則與通關為場景',
        '諸神的領域': '以神域、神威與凡人不可直視為舞台',
        '意識空間': '以意識空間、內心投射與精神對決為背景',
        '虛數空間': '以虛數空間、數學與存在邊界為場景',
        '混沌之海': '以混沌之海、無序與創世前後為舞台',
        '創世之初': '以創世之初、萬物初生與原初之力為背景',
        '世界盡頭': '以世界盡頭、終焉與邊界之外為場景',
        // 自然環境
        '與世隔絕的孤島': '以孤島、與世隔絕與自救為舞台',
        '永夜的極地': '以極地永夜、嚴寒與孤絕為背景',
        '沙漠中的綠洲': '以沙漠綠洲、水源與短暫生機為場景',
        '漂浮在空中的島嶼': '以浮空島、失重與雲海為奇幻舞台',
        '地下深處的洞穴': '以地下洞穴、幽閉與未知深處為背景',
        '活火山口': '以活火山口、熔岩與地熱危機為場景',
        '冰封的古城': '以冰封古城、沉睡與甦醒為舞台',
        '被遺忘的古文明遺跡': '以遺忘遺跡、失落文明與考古謎團為背景',
        '熱帶雨林深處': '以雨林深處、濕熱與原始生態為場景',
        '神秘的百慕達': '以百慕達、失蹤與超自然傳說為舞台',
        '馬里亞納海溝': '以深海海溝、壓力與未知生物為背景',
        '喜馬拉雅之巔': '以喜馬拉雅、稀薄空氣與登頂為場景',
        '亞馬遜叢林': '以亞馬遜叢林、河流與原住民為舞台',
        '撒哈拉沙漠': '以撒哈拉、酷熱與無盡沙海為背景',
        '南極冰原': '以南極冰原、科考與極地生存為場景',
        '北極凍土': '以北極凍土、永凍層與極夜為舞台',
        '大堡礁': '以大堡礁、珊瑚與海洋生態為背景',
        // 日常溫馨場所
        '溫馨的咖啡廳': '以咖啡廳、香氣與短暫停留為治癒舞台',
        '老舊的書店': '以舊書店、塵封書頁與慢時光為背景',
        '神秘的古董店': '以古董店、舊物與塵封故事為場景',
        '熱鬧的遊樂園': '以遊樂園、歡笑與短暫逃離現實為舞台',
        '安靜的圖書館': '以圖書館、靜謐與知識為背景',
        '溫暖的麵包店': '以麵包店、剛出爐香氣與街坊人情為場景',
        '文藝的花店': '以花店、花語與季節更迭為舞台',
        '治癒的寵物店': '以寵物店、毛孩與陪伴為背景',
        '復古的唱片行': '以唱片行、復古與懷舊為場景',
        '手作工作室': '以手作工作室、匠心與創作過程為舞台',
        '社區活動中心': '以社區中心、鄰里與日常聚會為背景',
        '屋頂天台': '以屋頂天台、城市夜景與私密對話為場景',
        '海邊小木屋': '以海邊小木屋、潮聲與遠離喧囂為舞台',
        '山間民宿': '以山間民宿、雲霧與慢生活為背景',
        '鄉村農場': '以鄉村農場、田園與四季勞作為場景',
        '葡萄酒莊園': '以葡萄酒莊、葡萄園與釀造為舞台',
        '溫泉旅館': '以溫泉旅館、蒸氣與放鬆為背景',
        // 特殊建築
        '魔法學院': '以魔法學院、課程與同學羈絆為奇幻舞台',
        '蒸汽龐克城市': '以蒸汽城市、齒輪與復古科技為背景',
        '空中花園': '以空中花園、懸空綠意與奇觀為場景',
        '海底宮殿': '以海底宮殿、水壓與水府威儀為舞台',
        '樹屋村落': '以樹屋村落、林間生活與自然共生為背景',
        '移動城堡': '以移動城堡、遷徙與機關為奇幻場景',
        '機械巨獸內部': '以巨獸內部、生物機械與幽閉為舞台',
        '諾亞方舟': '以諾亞方舟、洪水與方舟上的生存為背景',
        '通天塔': '以通天塔、登塔與神人界限為場景',
        '地下城市': '以地下城市、人造日光與封閉社會為舞台',
        '廢棄的主題樂園': '以廢棄樂園、殘影與詭異懷舊為背景',
        '鬧鬼的老宅': '以鬧鬼老宅、陳年秘密與靈異為場景',
        '廢棄的精神病院': '以廢棄精神病院、瘋狂與禁忌為驚悚舞台',
        '地下實驗室': '以地下實驗室、秘密研究與失控為背景',
        '祕密基地': '以秘密基地、隱藏與作戰指揮為場景',
        // 電競/直播
        '電競戰隊基地': '以戰隊基地、訓練與團隊戰術為舞台',
        '職業選手宿舍': '以選手宿舍、同袍生活與賽季壓力為背景',
        '大型電競館': '以電競館、觀眾與現場對決為場景',
        '個人直播間': '以直播間、鏡頭前與彈幕互動為舞台',
        'MCN經紀公司': '以 MCN 公司、簽約與流量運營為背景',
        '遊戲開發工作室': '以遊戲工作室、開發與上線為場景',
        // 深空/軌道
        '軌道都市': '以軌道都市、失重生活與太空居民為舞台',
        '太空電梯': '以太空電梯、登升與地軌交界為背景',
        '深空殖民艦': '以殖民艦、長途航行與世代船為場景',
        '曲速戰艦': '以曲速戰艦、星際機動與艦橋指揮為舞台',
        '星際蟲洞站': '以蟲洞站、跳躍與時空轉折為背景',
        '小行星礦場': '以小行星礦場、採礦與真空作業為場景',
        '軌道環居住區': '以軌道環、環形居住與人造重力為舞台',
        // 賽博空間
        '賽博貧民窟': '以賽博貧民窟、混亂與底層掙扎為背景',
        '義體改造診所': '以義體診所、改造與身體邊界為場景',
        '黑客地下室': '以黑客地下室、入侵與數位暗網為舞台',
        '巨型企業摩天樓': '以企業摩天樓、高層權力與玻璃牢籠為背景',
        '霓虹紅燈區': '以霓虹紅燈區、夜與灰色交易為場景',
        '地下黑市': '以地下黑市、非法交易與情報為舞台',
        // 現代修真
        '靈氣復甦的現代都市': '以靈氣復甦都市、隱世與現代並存為背景',
        '都市修真坊市': '以修真坊市、靈石交易與修士聚集為場景',
        '隱世宗門入口': '以宗門入口、結界與凡俗難入為舞台',
        '地脈龍穴': '以地脈龍穴、靈氣匯聚與爭奪為背景',
        '古武世家祖宅': '以古武祖宅、傳承與家族規矩為場景',
        // 末世廢土
        '廢土綠洲城邦': '以廢土綠洲、城邦秩序與資源分配為舞台',
        '地下輻射避難所': '以輻射避難所、封閉與配給為背景',
        '末世安全屋': '以安全屋、儲備與最後防線為場景',
        '喪屍圍城的商場': '以喪屍圍城商場、困守與突圍為舞台',
        '末世資源回收站': '以回收站、廢品與以物易物為背景',
        // 海上/空中
        '海上浮城': '以海上浮城、潮汐與漂浮聚落為舞台',
        '移動的鯨船': '以鯨船、航海與與巨獸共生為背景',
        '雲端浮島都市': '以雲端浮島、高空與雲海為場景',
        '深海實驗艙': '以深海實驗艙、壓力與封閉監測為舞台',
        '空中纜車列車': '以空中纜車、懸空軌道與俯瞰為背景',
        // 規則怪談
        '詭異的無限樓層': '以無限樓層、循環與詭異規則為驚悚舞台',
        '循環的末班捷運': '以末班捷運、無人車站與規則為背景',
        '沒有出口的旅館': '以無出口旅館、困住與禁忌為場景',
        '深夜的便利商店': '以深夜便利店、詭異客人與規則為舞台',
        '異常的老舊公寓': '以老舊公寓、鄰居與異常現象為背景',
        // 職人場所
        '刑警重案隊辦公室': '以重案隊辦公室、案卷與連夜辦案為舞台',
        '法醫解剖室': '以解剖室、屍檢與證據還原為背景',
        '消防分隊': '以消防分隊、出警與火場為場景',
        '急診搶救室': '以急診搶救室、分秒與生死搶救為舞台',
        '遠洋貨輪甲板': '以遠洋甲板、孤寂與海上生活為背景',
        '飛機駕駛艙': '以駕駛艙、飛行與高空決策為場景',
        // 日常經營
        '街角小餐館': '以街角小餐館、熟客與煙火氣為舞台',
        '轉角咖啡店': '以轉角咖啡店、日常與短暫停留為背景',
        '獨立二手書店': '以二手書店、舊書與慢生活為場景',
        '深夜食堂': '以深夜食堂、夜食與過客故事為舞台',
        '鄉間民宿小院': '以鄉間民宿、小院與旅人為背景',
        '邊境拓荒村': '以邊境拓荒村、開墾與艱苦為場景',
        // 古代細分
        '塞外草原王庭': '以塞外王庭、遊牧與胡漢交界為舞台',
        '江湖客棧': '以江湖客棧、過客與情報為背景',
        '漕運碼頭': '以漕運碼頭、貨船與幫會為場景',
        '邊關軍鎮': '以邊關軍鎮、駐防與戰事為舞台',
        '清修道觀': '以道觀清修、丹經與隱逸為背景',
        '深山佛寺禪院': '以深山禪院、鐘磬與修行為場景',
        // 奇幻細分
        '冒險者酒館': '以冒險者酒館、委託與傳聞為奇幻舞台',
        '地下城入口': '以地下城入口、組隊與攻略為背景',
        '巨龍的巢穴': '以龍巢、寶藏與龍威為場景',
        '世界樹之下': '以世界樹下、根系與位面交匯為舞台',
        '元素交匯位面': '以元素位面、法則交錯為奇幻背景',
        '亡靈墓園': '以亡靈墓園、亡者與陰冷為場景',
        // 體育競技場館
        '職業足球場': '以職業足球場、看台與綠茵為競技舞台',
        '室內籃球館': '以室內籃球館、木地板與觀眾吶喊為背景',
        '網球中心': '以網球中心、球場與大賽氛圍為場景',
        '圍棋競技館': '以圍棋競技館、對弈室與靜謐對局為舞台',
        'F1賽車賽道': '以賽車賽道、彎道與維修區為速度舞台',
        '奧運游泳館': '以奧運游泳館、泳池與計時為競技場景',
        '拳擊訓練館': '以拳擊訓練館、沙袋與擂台為格鬥背景',
        '滑冰競技場': '以滑冰競技場、冰面與觀眾席為舞台',
        // 偶像娛樂場所
        '練習室鏡牆': '以練習室鏡牆、排練與汗水分鏡為背景',
        '大型演唱會館': '以大型演唱會館、燈光與萬人舞台為場景',
        '錄音棚控制室': '以錄音棚控制室、麥克風與混音為舞台',
        '聲優配音間': '以聲優配音間、隔音棚與台本為背景',
        '綜藝錄影棚': '以綜藝錄影棚、燈架與現場導播為場景',
        '地下Live House': '以地下 Live House、近距離演出為舞台',
        '經紀公司會議室': '以經紀公司會議室、合約與資源分配為背景',
        '音樂學院禮堂': '以音樂學院禮堂、演奏與師生評選為場景',
        // 宮廷宅邸
        '紫禁城後宮': '以紫禁城後宮、妃嬪與位份為權謀舞台',
        '侯府正院': '以侯府正院、家規與嫡庶為宅鬥背景',
        '嫡女閨房': '以嫡女閨房、私語與婚嫁籌謀為場景',
        '正房主院': '以正房主院、掌家權與內宅秩序為舞台',
        '側院妾室': '以側院妾室、爭寵與暗流為背景',
        '深宮冷院': '以深宮冷院、失寵與孤寂為壓抑場景',
        '鳳儀宮': '以鳳儀宮、中宮威儀與後宮核心為舞台',
        '宗人府': '以宗人府、宗室譜系與皇族事務為背景',
        // 海外華人場景
        '舊金山唐人街': '以舊金山唐人街、商舖與移民史為舞台',
        '海外華人商會': '以海外華人商會、同鄉網絡與商戰為背景',
        '留學生宿舍': '以留學生宿舍、異國日常與同儕為場景',
        '唐人街中華商會館': '以中華商會館、鄉誼與議事為舞台',
        '僑鄉古厝': '以僑鄉古厝、祖屋與返鄉記憶為背景',
        '唐人埠碼頭': '以唐人埠碼頭、貨船與勞工為場景',
        '華人超市街區': '以華人超市街區、煙火氣與社群為舞台',
        '雙語社區中心': '以雙語社區中心、文化活動與融合為背景',
        // 武道格鬥場
        '綜合格鬥八角籠': '以八角籠、鐵網與近身對決為格鬥舞台',
        '劍道館': '以劍道館、木劍與禮儀對練為背景',
        '空手道道場': '以空手道道場、型與實戰為場景',
        '跆拳道館': '以跆拳道館、道服與品勢為舞台',
        '泰拳訓練營': '以泰拳訓練營、膝肘與沙袋為背景',
        '摔跤擂台': '以摔跤擂台、抱摔與觀眾為場景',
        '散打訓練中心': '以散打訓練中心、實戰對練為舞台',
        '傳統武館': '以傳統武館、師承與套路為背景',
        // 網文機制空間
        '領主核心領地': '以領主核心領地、建設與征伐為機制舞台',
        '國運試煉塔': '以國運試煉塔、層層闖關為場景',
        '萬界聊天維度': '以跨界聊天維度、資訊交換為異空間背景',
        '系統商城空間': '以系統商城空間、兌換與規則為舞台',
        '功德輪迴殿': '以功德輪迴殿、因果與獎懲為場景',
        '詞條抽取祭壇': '以詞條抽取祭壇、隨機能力為機制背景',
        '副本空間入口': '以副本空間入口、組隊與傳送為舞台',
        '新手村村莊': '以新手村村莊、起步與引導為場景',
        // 民俗志怪場景
        '鄉野廟會': '以鄉野廟會、鑼鼓與民俗為志怪背景',
        '宗祠祠堂': '以宗祠祠堂、牌位與宗族規矩為舞台',
        '山神廟宇': '以山神廟宇、香火與禁忌為場景',
        '河神渡口': '以河神渡口、渡船與水鬼傳說為背景',
        '城隍廟後巷': '以城隍廟後巷、陰司與市井交界為舞台',
        '送葬山路': '以送葬山路、紙錢與亡靈為詭祕場景',
        '古村落祠堂': '以古村落祠堂、族規與舊事為背景',
        '摩崖石刻窟': '以摩崖石刻窟、古咒與封印為舞台'
      };

      // 風格：逐選項對生成的實際影響
      const styleOptionImpacts = {
        // 情感基調
        '溫馨治癒': '以溫暖療癒的筆調書寫，給人安慰與柔軟',
        '甜蜜浪漫': '以甜寵浪漫的語感，細寫心動與糖分',
        '輕鬆幽默': '以輕鬆幽默的口吻，穿插笑點與鬆弛',
        '青春活力': '以青春洋溢的語調，充滿朝氣與衝勁',
        '熱血燃情': '以熱血激昂的文筆，情緒持續高漲',
        '感人催淚': '以催淚動人的描寫，引發共鳴與淚點',
        '虐心糾結': '以虐心糾結的基調，情感拉扯深重',
        '悲傷哀婉': '以悲傷哀婉的筆觸，彌漫離愁與遺憾',
        '沉重壓抑': '以沉重壓抑的語感，氛圍陰鬱逼人',
        '黑暗絕望': '以黑暗絕望的基調，幾乎看不到光明',
        '溫柔細膩': '以溫柔細膩的描寫，情感流轉含蓄',
        '清新淡雅': '以清新淡雅的筆調，如微風般舒適',
        '詩意唯美': '以詩意唯美的語言，營造優美意境',
        '勵志向上': '以勵志向上的基調，傳遞希望與力量',
        '正能量': '以正能量的語感，過程與收尾偏光明',
        // 氛圍風格
        '神秘詭異': '以神秘詭異的氛圍籠罩全篇',
        '懸疑緊張': '以懸疑緊張的氣氛，步步緊逼',
        '驚悚恐怖': '以驚悚恐怖的調性，製造不安',
        '陰森詭譎': '以陰森詭譎的筆觸，陰冷而詭祕',
        '荒誕離奇': '以荒誕離奇的語感，打破常規邏輯',
        '史詩壯闘': '以史詩壯闊的氣勢，格局宏大',
        '大氣磅礴': '以大氣磅礴的描寫，氣象萬千',
        '恢弘壯麗': '以恢弘壯麗的場景與敘事鋪陳',
        '莊嚴肅穆': '以莊嚴肅穆的基調，凝重而肅正',
        '蒼涼悲壯': '以蒼涼悲壯的韻味，壯烈而淒美',
        '明亮歡快': '以明亮歡快的語調，陽光明媚',
        '俏皮可愛': '以俏皮可愛的筆觸，靈動討喜',
        '夢幻迷離': '以夢幻迷離的氛圍，如夢似幻',
        '空靈縹緲': '以空靈縹緲的意境，超凡脫俗',
        '禪意悠遠': '以禪意悠遠的韻味，淡泊寧靜',
        // 敘事風格
        '細膩描寫': '以細膩描寫刻畫心理與感官細節',
        '白描手法': '以白描手法，簡潔而傳神',
        '意識流': '以意識流寫內心跳躍與聯想',
        '蒙太奇': '以蒙太奇剪接場景與意象',
        '碎片化敘事': '以碎片化敘事拼湊真相',
        '多線並進': '以多線並進交織推進情節',
        '雙線交織': '以雙線交織互為映照',
        '環形敘事': '以環形敘事首尾呼應',
        '倒敘插敘': '以倒敘插敘打亂時間順序',
        '非線性敘事': '以非線性敘事自由跳躍',
        '第一人稱': '以第一人稱「我」貫穿全文',
        '第三人稱限知': '以限知第三人稱貼近主角視角',
        '全知視角': '以全知視角自由俯瞰眾生',
        '多視角切換': '以多視角切換展開全貌',
        '書信體': '以書信往來構成敘事',
        // 節奏風格
        '快節奏爽文': '以快節奏爽文推進，高潮密集',
        '緊湊刺激': '以緊湊刺激的節奏，少廢話',
        '高潮迭起': '以高潮迭起的安排，一波接一波',
        '一氣呵成': '以一氣呵成的敘事，流暢不停',
        '慢熱鋪陳': '以慢熱鋪陳漸入佳境',
        '娓娓道來': '以娓娓道來的語感，如說書人',
        '循序漸進': '以循序漸進的推進，層層遞進',
        '細水長流': '以細水長流的節奏，潤物無聲',
        '張弛有度': '以張弛有度的節奏，緊緩交替',
        '跌宕起伏': '以跌宕起伏的情節，起落分明',
        '平鋪直敘': '以平鋪直敘的口吻，直白清楚',
        '留白想像': '以留白想像，少說多示意',
        // 文學風格
        '古典優雅': '以古典優雅的文言韻味書寫',
        '華麗繁複': '以華麗繁複的修辭點綴',
        '簡約留白': '以簡約留白，少即是多',
        '粗獷豪放': '以粗獷豪放的筆鋒，慷慨激昂',
        '現實主義': '以現實主義寫實，貼近生活',
        '魔幻現實': '以魔幻現實融合日常與奇異',
        '超現實主義': '以超現實主義打破邏輯',
        '象徵主義': '以象徵主義隱喻寄意',
        '黑色幽默': '以黑色幽默嘲諷荒誕',
        '辛辣諷刺': '以辛辣諷刺針砭時弊',
        '批判現實': '以批判現實揭露社會陰影',
        '哲理思辨': '以哲理思辨探討人生命題',
        '抒情散文': '以抒情散文般的感傷筆調',
        '詩化語言': '以詩化語言營造意境',
        '口語化': '以口語化親切平易',
        '文白夾雜': '以文白夾雜的古風語感',
        // 類型風格
        '輕小說風': '以輕小說風的對白與輕快語感',
        '網文爽文': '以網文爽文的套路與即時滿足',
        '純文學': '以純文學的雕琢與深度',
        '嚴肅文學': '以嚴肅文學的厚重與思辨',
        '文藝清新': '以文藝清新的文青調性',
        '都市輕熟': '以都市輕熟的都會質感',
        '職場精英': '以職場精英的專業與光鮮',
        '校園純愛': '以校園純愛的青春純淨',
        '古言典雅': '以古言典雅的文言氣韻',
        '現言都市': '以現言都市的當代語感',
        '甜寵溺愛': '以甜寵溺愛的糖分與寵溺',
        'BE美學': '以BE美學的悲劇美感收尾',
        '硬核寫實': '以硬核寫實的專業細節',
        '軟糯治癒': '以軟糯治癒的柔軟筆觸',
        '中二熱血': '以中二熱血的豪言與燃點',
        '腹黑搞笑': '以腹黑搞笑的反差與機鋒',
        // 特殊風格
        '新武俠': '以新武俠的現代江湖語感',
        '傳統武俠': '以傳統武俠的古典俠義韻味',
        '仙俠飄逸': '以仙俠飄逸的雲海仙氣',
        '玄幻熱血': '以玄幻熱血的升級與戰鬥',
        '硬科幻': '以硬科幻的科學嚴謹語感',
        '軟科幻': '以軟科幻的人文想像語感',
        '賽博龐克': '以賽博龐克的霓虹冷硬',
        '蒸汽龐克': '以蒸汽龐克的齒輪復古',
        '哥特風': '以哥特風的黑暗浪漫',
        '暗黑系': '以暗黑系的陰鬱美學',
        '克蘇魯': '以克蘇魯的不可名狀恐懼',
        '民俗風': '以民俗風的鄉野怪談韻味',
        '日系輕小說': '以日系輕小說的對白與萌感',
        '韓式甜劇': '以韓式甜劇的細膩情感',
        '美劇節奏': '以美劇節奏的快切與懸念',
        '英劇質感': '以英劇質感的沉穩與質感',
        // 情緒導向
        '爽點密集': '以密集爽點持續給予滿足感',
        '打臉爽文': '以打臉逆襲的痛快橋段為主',
        '逆襲翻盤': '以逆襲翻盤的逆轉為高潮',
        '裝逼打臉': '以裝逼後打臉的反差爽感',
        '細膩情感': '以細膩情感慢火燉煮',
        '慢熱暗戀': '以慢熱暗戀的含蓄與試探',
        '情感糾葛': '以情感糾葛的拉扯為主',
        '人性探討': '以人性探討的深度為重',
        '腦洞大開': '以腦洞大開的奇想設定',
        '無厘頭': '以無厘頭的荒誕笑料',
        '鬼畜搞笑': '以鬼畜搞笑的誇張反差',
        '溫馨日常': '以溫馨日常的小確幸為主',
        // 結構與筆法
        '群像史詩': '以群像史詩的多角色並進',
        '偽紀錄片風': '以偽紀錄片風的紀實口吻',
        '新聞報導體': '以新聞報導體的客觀敘述',
        '設定流硬核': '以設定流硬核的詳盡世界觀',
        '志怪筆記體': '以志怪筆記體的短篇奇聞',
        '史官紀傳體': '以史官紀傳體的編年筆法',
        '寓言體': '以寓言體的隱喻敘事',
        '實驗文體': '以實驗文體打破常規形式',
        '多媒體拼貼': '以多媒體拼貼的混雜文本',
        '彈幕吐槽風': '以彈幕吐槽風的互動感',
        '遊戲化敘述': '以遊戲化敘述的系統提示感',
        '單元劇式': '以單元劇式的一章一故事',
        // 類型筆觸
        '克系冷硬': '以克系冷硬的壓抑筆觸',
        '軍武硬核': '以軍武硬核的專業術語',
        '廢土荒涼': '以廢土荒涼的乾涸語感',
        '規則驚悚': '以規則驚悚的冷峻壓迫',
        'SCP檔案風': '以SCP檔案風的異常報告體',
        '賽博冷硬': '以賽博冷硬的霓虹疏離',
        '蒸汽復古': '以蒸汽復古的機械懷舊',
        '黑色電影風': '以黑色電影風的陰影與宿命',
        '公路電影感': '以公路電影感的漂泊與邂逅',
        '偵探冷硬派': '以偵探冷硬派的簡潔陽剛',
        // 東方美學
        '武俠寫意': '以武俠寫意的留白與氣韻',
        '東方水墨': '以東方水墨的淡遠意境',
        '古韻雅緻': '以古韻雅緻的典雅文氣',
        '禪意留白': '以禪意留白的空靈簡淨',
        '江湖快意': '以江湖快意的灑脫與恩仇',
        // 輕鬆向
        '宅向吐槽': '以宅向吐槽的梗與自嘲',
        '日常流水帳治癒': '以日常流水帳的平淡治癒',
        '種田慢綜': '以種田慢綜的悠閒節奏',
        '爽感無敵流': '以爽感無敵流的暢快碾壓',
        '沙雕歡樂': '以沙雕歡樂的無腦搞笑',
        // 體育競技筆法
        '賽場臨場感': '以賽場臨場感寫觀眾、哨聲與關鍵一球',
        '訓練日誌體': '以訓練日誌體記錄日課、體能與進步',
        '教練視角': '以教練視角寫戰術佈置與選手心理',
        '對決鏡頭感': '以對決鏡頭感切換攻防與慢動作高光',
        '競技熱血': '以競技熱血的吶喊與逆轉燃點',
        '傷病療養線': '以傷病療養線寫復健、挫折與重返賽場',
        '團隊袍澤情': '以團隊袍澤情寫隊友默契與並肩作戰',
        '冠軍史詩感': '以冠軍史詩感烘托決賽與榮耀時刻',
        // 偶像娛樂筆法
        '舞台光影感': '以舞台光影感寫燈光、舞步與萬人矚目',
        '練習紀實風': '以練習紀實風寫鏡前反覆與汗水細節',
        '粉絲追星視角': '以粉絲追星視角穿插應援與距離感',
        '緋聞八卦調': '以緋聞八卦調寫媒體、人設與輿論壓力',
        '綜藝剪輯感': '以綜藝剪輯感的快切橋段與效果字幕感',
        '出道成長線': '以出道成長線寫選秀、淘汰與首次登台',
        '鏡頭演技派': '以鏡頭演技派細寫表情、台詞與鏡頭意識',
        '幕後辛酸': '以幕後辛酸寫練習生壓力與光環背後',
        // 宮鬥宅鬥筆法
        '嫡庶話本風': '以嫡庶話本風寫尊卑、名分與口舌',
        '後宮攻略體': '以後宮攻略體寫位份、恩寵與算計',
        '內宅禮制細': '以內宅禮制細寫請安、規矩與掌家',
        '權謀對白密': '以權謀對白密寫話裡有話、試探與結盟',
        '步步驚心系': '以步步驚心系營造一步踏錯的壓迫',
        '華服宮燈感': '以華服宮燈感寫服飾、燈影與深宮氛圍',
        '宅門話裡話': '以宅門話裡話寫笑裡藏刀、婆媳妯娌',
        '翻臉如翻書': '以翻臉如翻書的快節奏恩仇反轉',
        // 網文機制筆法
        '系統提示流': '以系統提示流穿插任務、獎勵與警告',
        '數據面板感': '以數據面板感呈現屬性、等級與數值變化',
        '升級爽節奏': '以升級爽節奏密集給予變強反饋',
        '聊天群梗體': '以聊天群梗體穿插群聊、吐槽與情報',
        '商城兌換敘': '以商城兌換敘寫積分、道具與取捨',
        '副本攻略記': '以副本攻略記寫規則、通關與獎勵',
        '國運解說風': '以國運解說風寫全民關注與闖關播報',
        '詞條羅列硬': '以詞條羅列硬詳述能力組合與搭配',
        // 格鬥熱血筆法
        '擂台吶喊感': '以擂台吶喊感寫觀眾、鈴聲與終結一擊',
        '道場修行記': '以道場修行記寫日課、師承與段位',
        '熱血對白調': '以熱血對白調寫挑釁、誓言與不服',
        '技術拆解流': '以技術拆解流細寫招式、破綻與戰術',
        '對決慢鏡感': '以對決慢鏡感拉長關鍵一拳一腳',
        '傷痕成長線': '以傷痕成長線寫敗北、療傷與再戰',
        '榮耀頒獎式': '以榮耀頒獎式烘托冠軍、金腰帶與全場',
        '一拳一腳寫': '以一拳一腳寫的硬碰硬實戰描寫',
        // 海外華人筆法
        '雙語夾雜體': '以雙語夾雜體混用中英文對白與思考',
        '鄉愁散文感': '以鄉愁散文感寫故土、味道與遙望',
        '唐人街煙火': '以唐人街煙火寫街坊、商舖與移民日常',
        '移民血淚記': '以移民血淚記寫漂泊、歧視與堅持',
        '文化衝突對': '以文化衝突對寫價值觀碰撞與磨合',
        '商戰實錄風': '以商戰實錄風寫合約、資金與同鄉網絡',
        '留學自傳體': '以留學自傳體寫課業、孤獨與自我發現',
        '雙城並敘': '以雙城並敘交替書寫兩地生活與身分',
        // 耽美百合筆法
        '心動細膩系': '以心動細膩系放大細微表情與心跳',
        '含蓄推拉調': '以含蓄推拉調寫試探、迴避與靠近',
        '高糖撒糖': '以高糖撒糖密集給予甜蜜互動',
        '虐戀BE系': '以虐戀BE系加重誤會、犧牲與遺憾',
        'ABO資訊素': '以ABO資訊素寫氣味、易感與配對張力',
        '年上寵溺調': '以年上寵溺調寫包容、引導與守護',
        '宿敵張力': '以宿敵張力寫對立中的吸引與默契',
        '校園純情系': '以校園純情系寫青春、暗戀與初次心動'
      };

      function findCategoryHint(value, categories) {
        if (!value) return '';
        const cat = categories.find((c) => c.items.includes(value));
        return cat && cat.hint ? cat.hint : '';
      }

      const chapterOpts = [5, 8, 10, 12, 15];
      const lengthOpts = [30000, 50000, 70000, 90000];

      const nameOptions = ['艾琳','洛恩','凱亞','米爾','席恩','薇拉','祈安','杜林','希爾維','萊雅','伊凡','法蘭','格蘭','梅芙','安娜','雷格','索菲','艾略特','亞歷克','莫妮卡','路西','伊芙','加百列','亞當','瑪雅','艾德','薩拉','杰登','琪拉','德瑞克','凱瑟琳','馬丁','羅絲','奧利維','昆汀','哈莉','伯納德','海倫','丹尼爾','雷切爾','山姆','艾薇','諾亞','艾米莉','布萊恩','艾蜜莉亞','達米安','露西亞','米蘭達','亞歷山大','波琳娜','亨利','蘇菲亞','費南多','克萊兒','埃德加','歐文','莉亞','查爾斯','哈娜','杰克','瑪蒂爾達','托尼','娜塔莉','達瑞斯','克里斯','艾瑪','羅伯特','凱特','格蕾絲','莫里斯','普拉多','勞拉','維克多','凱莉','菲利普','瑞秋','史蒂夫','羅伊','哈德森','妮可','克麗絲汀','萊昂','梅根','杜蘭','馬雅','蘭斯洛特','卡羅爾','伊麗莎白','伊薩貝拉','考特尼','蔣琴','唐娜','塞德里克','布蘭妮','雷蒙','凱薩琳','阿萊克斯','加布里埃拉','西蒙'];
      
      // 男性名字
      const maleNames = ['洛恩','米爾','席恩','祈安','杜林','伊凡','法蘭','格蘭','雷格','艾略特','亞歷克','加百列','亞當','艾德','杰登','德瑞克','馬丁','奧利維','昆汀','伯納德','丹尼爾','山姆','諾亞','布萊恩','達米安','亞歷山大','亨利','費南多','埃德加','歐文','查爾斯','杰克','托尼','達瑞斯','克里斯','羅伯特','莫里斯','普拉多','維克多','菲利普','史蒂夫','羅伊','哈德森','萊昂','杜蘭','蘭斯洛特','塞德里克','雷蒙','阿萊克斯','西蒙','威廉','詹姆斯','麥克','大衛','約瑟夫','理查','湯瑪斯','安德魯','乔治','艾倫','凱文','乔納森','乔舒亞','萊恩','尼古拉斯','贾斯汀','布兰登','泰勒','亚伦','杰瑞米','肖恩','德里克','马修','保罗','卡尔','文森特'];
      
      // 女性名字
      const femaleNames = ['艾琳','凱亞','薇拉','希爾維','萊雅','梅芙','安娜','索菲','莫妮卡','路西','伊芙','瑪雅','薩拉','琪拉','凱瑟琳','羅絲','哈莉','海倫','雷切爾','艾薇','艾米莉','艾蜜莉亞','露西亞','米蘭達','波琳娜','蘇菲亞','克萊兒','莉亞','哈娜','瑪蒂爾達','娜塔莉','艾瑪','凱特','格蕾絲','勞拉','凱莉','瑞秋','妮可','克麗絲汀','梅根','馬雅','卡羅爾','伊麗莎白','伊薩貝拉','考特尼','蔣琴','唐娜','布蘭妮','凱薩琳','加布里埃拉','艾莉絲','維多利亞','奧莉維亞','夏洛特','阿曼達','潔西卡','珍妮佛','蜜雪兒','妮娜','克蘿伊','莎曼珊','黛安娜','凱蒂','艾莉森','布麗姬特','莫妮克','安琪拉','史黛西','坦雅','蘿拉','潘乃拉'];
      // ========== 個性選項（分類整理）==========
      const personalityOptions = [
        // ═══════ 【溫暖正向型】═══════
        '善良單純','溫柔體貼','樂觀開朗','熱情友善','真誠坦率','樂於助人',
        '善解人意','細心體貼','隨和包容','親切和藹','陽光燦爛','暖心治癒',
        '純真無邪','赤子之心','天真爛漫','心地善良','與人為善','古道熱腸',
        // ═══════ 【堅強勇敢型】═══════
        '勇敢無畏','堅毅不屈','正義感強','俠肝義膽','見義勇為','剛正不阿',
        '責任感強','意志堅定','百折不撓','越挫越勇','臨危不懼','視死如歸',
        '鐵骨錚錚','寧折不彎','大義凜然','捨生取義','義無反顧','一往無前',
        // ═══════ 【聰明理性型】═══════
        '機智靈活','心思縝密','沉穩可靠','冷靜理智','深謀遠慮','足智多謀',
        '聰明絕頂','過目不忘','學識淵博','博學多才','觸類旁通','見微知著',
        '明察秋毫','洞察人心','運籌帷幄','謀定後動','精明幹練','老謀深算',
        // ═══════ 【領袖魅力型】═══════
        '領導魅力','王者風範','霸氣側漏','氣場強大','威嚴莊重','不怒自威',
        '雄才大略','高瞻遠矚','胸懷天下','大局為重','知人善任','禮賢下士',
        '一言九鼎','言出必行','殺伐果斷','雷厲風行','獨斷專行','乾綱獨斷',
        // ═══════ 【藝術浪漫型】═══════
        '富有創意','浪漫多情','感性細膩','詩情畫意','風花雪月','多愁善感',
        '文藝氣質','書卷氣','才華橫溢','藝術天分','品味獨特','追求美感',
        '天馬行空','異想天開','不拘一格','特立獨行','率性而為','隨心所欲',
        // ═══════ 【外冷內熱型】═══════
        '外冷內熱','面冷心熱','口嫌體正','刀子嘴豆腐心','高冷但關心人',
        '不善表達但行動派','嘴硬心軟','表面無情實則深情','冷面熱心腸',
        '悶騷','看似疏離實則在意','默默守護型','不說但都記在心裡',
        // ═══════ 【傲嬌系列】═══════
        '傲嬌','別扭彆扭','嘴上說不要身體很誠實','死要面子','愛逞強',
        '不坦率','欲擒故縱','故作冷淡','假裝不在乎','口是心非',
        '吃醋不承認','偷偷關注','嘴上嫌棄實際寵溺','表面高傲內心期待',
        // ═══════ 【病嬌系列】═══════
        '病嬌','佔有欲極強','獨佔欲爆棚','控制欲強','偏執','瘋批',
        '黑化預備','愛到極端','不許你看別人','為愛瘋狂','執念深重',
        '偏激','極端','愛恨分明','一念天堂一念地獄','你是我的',
        // ═══════ 【天然呆系列】═══════
        '天然呆','迷糊','慢半拍','後知後覺','遲鈍','天然黑',
        '無意識撩人','不諳世事','單純到傻','傻白甜','呆萌','治癒系笨蛋',
        '沒有心機','直球選手','不懂曖昧','認真到可愛','無自覺魅力',
        // ═══════ 【腹黑系列】═══════
        '腹黑','笑裡藏刀','綿裡藏針','心機深沉','城府極深','老狐狸',
        '表面無害內心腹黑','假裝單純','扮豬吃老虎','隱藏實力','深藏不露',
        '看穿一切但不說','默默佈局','一切盡在掌握','以退為進','暗中操控',
        // ═══════ 【毒舌系列】═══════
        '毒舌','嘴毒心善','損友','吐槽役','嘴賤','說話不過腦',
        '一針見血','戳人痛處','直言不諱','有話直說','不留情面',
        '諷刺挖苦','話中帶刺','冷嘲熱諷','陰陽怪氣','說話帶刀',
        // ═══════ 【中二系列】═══════
        '中二病','自我感覺良好','幻想症','戲精','愛演','自我陶醉',
        '封印之力','右手的黑暗','背負詛咒','被選中的人','覺醒的力量',
        // ═══════ 【社恐系列】═══════
        '社恐','怕生','內向','不善言辭','安靜','喜歡獨處','害羞',
        '人群恐懼','不敢看人眼睛','緊張結巴','躲在角落','存在感薄',
        '一個人才自在','社交電量低','需要獨處充電','熟人面前反差大',
        // ═══════ 【話癆系列】═══════
        '話癆','嘮叨','碎碎念','停不下來','社牛','自來熟','人來瘋',
        '愛說話','表達欲強','分享欲滿滿','喜歡八卦','消息靈通',
        '什麼都要說','藏不住話','嘴巴閒不住','沒人聊天會悶死',
        // ═══════ 【冷酷無情型】═══════
        '冷酷無情','鐵石心腸','六親不認','心狠手辣','眼裡揉不得沙',
        '冷血','無情','不講情面','公事公辦','對事不對人',
        '不會心軟','下手絕不留情','斬草除根','除惡務盡','眼神冷漠',
        // ═══════ 【陰暗系列】═══════
        '陰鬱','悲觀厭世','看透一切','失去希望','行屍走肉','孤僻',
        '自閉','不信任任何人','把所有人推開','自我封閉','心如死灰',
        '活著沒意思','無所謂','都一樣','習慣孤獨','與世隔絕',
        // ═══════ 【瘋狂系列】═══════
        '瘋批美人','瘋癲','不按牌理出牌','行為難以預測','天才與瘋子一線間',
        '戰鬥狂人','嗜殺','血腥','暴力傾向','破壞欲強','殺人如麻',
        '瘋狂科學家','實驗狂人','為研究不擇手段','走火入魔','入魔',
        // ═══════ 【高嶺之花型】═══════
        '清冷禁慾','仙氣飄飄','遺世獨立','不食人間煙火','超凡脫俗',
        '淡漠疏離','拒人千里','高高在上','不可褻玩','可望不可及',
        '無欲無求','看淡一切','與世無爭','雲淡風輕','心如止水',
        // ═══════ 【魅惑型】═══════
        '妖媚','魅惑眾生','風情萬種','狐狸精','撩人','勾人',
        '媚骨天成','天生尤物','萬人迷','蠱惑人心','令人沉淪',
        '邪魅狂狷','邪氣','痞氣','壞壞的','危險的魅力',
        // ═══════ 【動物系性格】═══════
        '狼狗型','奶狗型','大型犬性格','小狼狗','忠犬','撒嬌精',
        '貓系性格','高冷貓','黏人貓','傲嬌貓','好奇貓',
        '狐狸性格','小狐狸','狡猾','機靈','狡黠',
        '兔系','軟萌','膽小','愛撒嬌','需要保護',
        // ═══════ 【反差萌系列】═══════
        '反差萌','平時高冷私下幼稚','外表凶狠內心柔軟','看起來弱實則超強',
        '嚴肅但愛玩','冷淡但吃醋','強大但怕蟲','高手但路痴',
        '霸總但下廚狂魔','女王但私下軟萌','反派但護短','魔王但怕老婆'
      ];

      // ========== 目標選項（大幅擴充）==========
      const goalOptions = [
        // ═══════ 【復仇雪恨類】═══════
        '為家人報仇','為師門復仇','為故鄉復仇','為愛人復仇','為摯友報仇',
        '為前世復仇','推翻暴政','清算舊帳','洗刷冤屈','討回公道',
        '殺死仇人','毀滅敵對勢力','讓背叛者付出代價','向整個世界復仇',
        '追殺逃亡的兇手','血債血償','以牙還牙','一個都不放過',
        '讓他們跪著求饒','毀掉他們珍視的一切','奪回被搶走的一切',
        // ═══════ 【尋找探索類】═══════
        '尋找失蹤的親人','尋找真正的身世','尋找親生父母','尋找失散的孿生',
        '尋找傳說中的寶藏','尋找長生不老的秘密','尋找治病的靈藥','尋找解藥',
        '尋找失落的文明','尋找通往異世界的門','尋找前世的記憶','尋找轉世的愛人',
        '尋找神器碎片','尋找預言中的救世主','尋找遺失的傳承','尋找上古秘典',
        '探索未知大陸','探索深海遺跡','探索星際','探索夢境世界','探索時間縫隙',
        '解開古老謎題','破解上古預言','追尋真相','揭開歷史真相','找出幕後黑手',
        // ═══════ 【拯救守護類】═══════
        '拯救世界','拯救人類','拯救被困的愛人','拯救瀕臨滅絕的種族',
        '拯救被詛咒的族人','拯救失落的靈魂','拯救墮落的神','拯救黑化的愛人',
        '保護故鄉','保護最後的希望','守護重要之人','守護家族血脈',
        '守護世界和平','守護最後的淨土','守護傳承','成為守護者',
        '阻止末日','阻止瘟疫蔓延','阻止戰爭','阻止黑暗儀式',
        '阻止時空崩塌','阻止人工智能暴走','阻止魔王復活','阻止神的毀滅計劃',
        '治癒被詛咒的人','解除封印','打破結界','消滅邪惡組織','淨化污染之地',
        // ═══════ 【變強成長類】═══════
        '成為最強者','成為一代宗師','成為天下第一','登頂武道巔峰',
        '突破修為瓶頸','渡過天劫','飛升成仙','證道成神','超脫輪迴',
        '獲得神的認可','超越前人','超越自己的極限','打破命運枷鎖',
        '證明自己的價值','讓看不起我的人後悔','逆天改命','從廢材到天才',
        '打敗宿敵','戰勝心魔','克服過去的創傷','擺脫命運束縛',
        '打破階級限制','推翻不公的制度','讓世界認可','名震天下',
        // ═══════ 【建設統治類】═══════
        '建立理想國度','統一天下','稱霸一方','建立不朽帝國',
        '重建家園','復興家族','光復門派','重振宗門榮光',
        '建立商業帝國','成為首富','壟斷市場','建立跨國集團',
        '創建門派','開宗立派','培養接班人','傳承衣缽',
        '改變世界秩序','推行新的制度','革新舊世界','開創新紀元',
        '建造通天塔','開闢新世界','殖民外星','建立AI烏托邦',
        // ═══════ 【情感追求類】═══════
        '找到真愛','追到心上人','讓他/她愛上我','重新贏回愛人',
        '與失散的愛人重逢','跨越阻礙在一起','證明愛情','執子之手白頭偕老',
        '治癒他/她的傷痛','喚醒失憶的愛人','等待轉世重逢',
        '報答恩情','履行承諾','完成約定','實現共同的夢想',
        '照顧家人','養育子女','讓家人過上好日子','保護想保護的人',
        // ═══════ 【自我實現類】═══════
        '追求自由','掙脫束縛','做自己想做的事','活出自己',
        '尋求內心平靜','放下執念','與過去和解','找到心靈歸宿',
        '贖罪','彌補過錯','完成臨終遺願','了卻未竟之事',
        '體驗人間百態','嘗遍世間美食','遊歷四方','看遍天下美景',
        '找到人生意義','悟道','參透生死','明白活著的意義',
        '留下傳世之作','青史留名','讓後人記住','不枉此生',
        // ═══════ 【職業成就類】═══════
        '成為電競冠軍','成為頂流偶像','出道C位','拿影帝影后',
        '創業成功','公司上市','財務自由','實現階層躍升',
        '成為名醫','攻克絕症','醫學突破','懸壺濟世',
        '成為大律師','伸張正義','為弱者發聲','改變不公',
        '實現科學突破','獲得諾貝爾獎','改變人類命運','推動文明進步',
        '成為名廚','米其林三星','傳承美食文化','開遍全球的店',
        // ═══════ 【科幻特殊類】═══════
        '移民火星','星際探索','第一個踏足外星','接觸外星文明',
        '進入虛擬世界','成為頂級玩家','掌控虛擬帝國','逃離虛擬囚籠',
        '破解系統漏洞','成為黑客之王','控制全球網絡','揭露陰謀',
        '獲得超能力','覺醒異能','控制自己的能力','成為異能王者',
        '完成基因進化','超越人類極限','上傳意識永生','成為新人類',
        // ═══════ 【修仙玄幻類】═══════
        '長生不死','白日飛升','位列仙班','成為大羅金仙',
        '成為魔王','統一魔界','魔道至尊','以魔入道',
        '逆天成神','弒神','取代天道','重塑三界',
        '收服神獸','集齊法寶','煉製神丹','鑄造神兵',
        '開創功法','自成一脈','悟出大道','創造世界',
        // ═══════ 【網文特殊類】═══════
        '獲得系統認可','綁定最強系統','升級系統','成為系統之主',
        '完成主神任務','逃離無限流世界','成為主神','打破世界壁壘',
        '攻略所有角色','全員好感度MAX','收服所有人','後宮滿員',
        '改寫劇本','讓反派洗白','拯救注定死亡的人','改變既定結局',
        '成為穿書大佬','掌控劇情走向','讓所有人按我的劇本走','HE結局'
      ];

      // ========== 弱點選項（大幅擴充）==========
      const weaknessOptions = [
        // ═══════ 【身體素質弱點】═══════
        '體力極差','身體虛弱','先天不足','體弱多病','免疫力低下',
        '容易生病','慢性病纏身','低血糖','貧血','心臟不好',
        '肺活量小','耐力差','反應遲鈍','協調性差','柔韌性差',
        '肌肉萎縮','骨質疏鬆','關節問題','脊椎問題','偏頭痛',
        // ═══════ 【感官缺陷】═══════
        '視力不佳','近視','遠視','色盲','夜盲症','弱視',
        '聽力受損','耳鳴','味覺遲鈍','嗅覺喪失','觸覺過敏',
        '平衡感差','暈眩症','眩暈','感官過載','感官遲鈍',
        // ═══════ 【睡眠問題】═══════
        '失眠症','嗜睡症','淺眠易醒','噩夢連連','夢遊症',
        '睡眠呼吸中止','晝夜顛倒','無法入睡','睡眠恐懼','睡太少會暴躁',
        // ═══════ 【過敏與禁忌】═══════
        '過敏體質','花粉過敏','食物過敏','藥物過敏','金屬過敏',
        '對陽光過敏','對某種元素過敏','不能吃特定食物','接觸特定物質會虛弱',
        '聞到特定氣味會不適','對酒精過敏','乳糖不耐','麩質過敏',
        // ═══════ 【舊傷與殘疾】═══════
        '身體有舊傷','戰爭後遺症','內傷未癒','經脈受損','丹田破碎',
        '殘疾','行動不便','單眼失明','斷臂','斷腿','啞巴','聾子',
        '毒素累積','中毒未解','詛咒纏身','業力反噬','天道懲罰',
        // ═══════ 【壽命與代價】═══════
        '壽命將盡','時日無多','被抽取了壽命','每使用能力減壽',
        '每日需服藥續命','靠丹藥維持','需要特殊血液','需要吸收生命力',
        '使用能力會折壽','超過極限會死','力量會反噬','透支生命',
        // ═══════ 【力量失控】═══════
        '力量會暴走','無法完全控制能力','情緒激動時失控','滿月會失控',
        '身體被封印','力量被壓制','只能發揮一成實力','每次解封代價巨大',
        '能力有副作用','使用後會虛弱','冷卻時間長','使用次數有限',
        // ═══════ 【恐懼症】═══════
        '恐高','懼高症','恐水','恐黑','恐火','恐雷',
        '幽閉恐懼','廣場恐懼','社交恐懼','密集恐懼','深海恐懼',
        '怕蛇','怕蟲','怕蜘蛛','怕老鼠','怕鬼','怕屍體',
        '怕血','怕醫院','怕打針','怕手術','怕牙醫',
        '怕死亡','怕疾病','怕衰老','怕失去','怕被拋棄',
        // ═══════ 【心理創傷】═══════
        '創傷後遺症','PTSD','童年陰影','原生家庭創傷','被霸凌的陰影',
        '戰爭創傷','目睹慘劇的陰影','被背叛的傷痛','失去至親的痛',
        '噩夢纏身','閃回','聽到特定聲音會崩潰','看到特定場景會失控',
        '觸發點敏感','無法面對過去','選擇性失憶','自我保護性遺忘',
        // ═══════ 【性格缺陷】═══════
        '過於善良','過於心軟','過於信任他人','無法拒絕請求','老好人',
        '優柔寡斷','猶豫不決','衝動易怒','三分鐘熱度','虎頭蛇尾',
        '拖延症','完美主義','強迫症','潔癖','控制欲過強',
        '嫉妒心重','報復心強','記仇','睚眥必報','小心眼',
        '太在意他人看法','玻璃心','敏感脆弱','容易受傷','鑽牛角尖',
        '過度自責','自我懷疑','自卑','自負','死要面子',
        '固執己見','一根筋','不會變通','聽不進勸','撞南牆不回頭',
        '情緒化','易怒','愛哭','愛逞強','愛面子',
        // ═══════ 【社交障礙】═══════
        '社恐','不善言辭','不會聊天','冷場王','句點王',
        '不會看氣氛','說話直接易得罪人','情商低','不懂人情世故',
        '無法處理人際關係','不會拒絕','討好型人格','邊緣人',
        '獨來獨往','無法融入群體','被孤立','不合群',
        // ═══════ 【能力缺陷】═══════
        '不擅長說謊','臉上藏不住事','一說謊就心虛','表情管理差',
        '路痴','絕對方向感缺失','看地圖也會迷路','原地轉圈',
        '臉盲','記不住人臉','叫錯名字','認錯人',
        '手殘','手笨','動手能力差','什麼都會壞',
        '廚藝災難','暗黑料理',
        '五音不全','唱歌跑調','節奏感差','舞蹈白痴',
        '數學白痴','理科廢物','邏輯思維弱','計算能力差',
        '科技苦手','電子產品殺手',
        // ═══════ 【生活技能缺失】═══════
        '不會游泳','旱鴨子','不會騎車','不會開車',
        '恐機','暈車暈船','暈3D','動暈症',
        '不會理財','月光族','存不住錢','衝動消費',
        '健忘','丟三落四','注意力缺失','無法專注',
        '生活不能自理','不會做家務','不會照顧自己',
        // ═══════ 【奇幻設定弱點】═══════
        '特定咒語會失效','真名被知道會被控制','被念出全名會虛弱',
        '見到十字架會虛弱','無法進入聖地','神聖系攻擊傷害加倍',
        '被特定材質所傷會致命','銀器','寒鐵','玄鐵','特殊木材',
        '弱點在心臟部位','弱點被打會一擊致命','有明顯的破綻',
        '需要定期吸取能量','需要月光','需要血液','需要靈氣',
        '離開水源會虛弱','不能見光','日光會灼傷','只能夜間行動',
        '力量來源會被剝奪','失去信物就失去能力','契約有致命條款',
        '每次重生會丟失一段記憶','記憶會隨時間消失','遺忘詛咒',
        // ═══════ 【情感軟肋】═══════
        '執著於過去','無法放下','活在回憶裡','走不出來',
        '無法放下仇恨','被仇恨蒙蔽','為復仇失去理智',
        '對特定人物言聽計從','被某人拿捏','無條件信任某人',
        '容易被美色迷惑','見到美人走不動路','英雄難過美人關',
        '見不得別人受苦','聖母心','會為陌生人出頭',
        '會為重要之人不顧一切','容易被威脅','軟肋明顯',
        '無法對孩子下手','對老人心軟','對弱者心軟',
        '聽不得親人被侮辱','一踩即跳的點','容易被激怒',
        '對故鄉有執念','鄉愁','思念之情','牽掛太多',
        '會被真心話打動','吃軟不吃硬','心軟',
        // ═══════ 【現代成癮】═══════
        '網路成癮','手機依賴症','社群媒體焦慮','FOMO症候群',
        '遊戲成癮','追劇成癮','咖啡因上癮','奶茶續命',
        '購物狂','選擇困難症','囤積症',
        '工作狂','過勞體質','停不下來','不會休息'
      ];

      // ========== 秘密選項（大幅擴充）==========
      const secretOptions = [
        // ═══════ 【皇室貴族身份】═══════
        '真實身份是王族','是亡國公主/王子','是皇帝私生子','是太子','是攝政王',
        '是失落帝國的繼承人','是被廢黜的皇族','是流落民間的貴族','是前朝遺孤',
        '是世家嫡子/嫡女','是豪門私生子','是被調換的真正繼承人','是被隱藏的血脈',
        // ═══════ 【神魔妖身份】═══════
        '真實身份是魔王','是魔王轉世','是魔王之子','是墮落的天使',
        '真實身份是神的孩子','是神的轉世','是神的代行者','是神選之人',
        '是預言之子','是天命之人','是救世主','是毀滅者',
        '是妖怪變的','是狐妖','是蛇妖','是龍族','是鳳凰',
        '是神獸化形','是上古神獸','是洪荒異種','是天外來客',
        '是吸血鬼','是狼人','是亡靈','是鬼魂','是惡靈轉生',
        // ═══════ 【間諜臥底身份】═══════
        '是臥底間諜','是雙面間諜','是敵國細作','是組織安插的釘子',
        '是敵人派來的','是來監視的','是有任務在身','真正效忠的另有其人',
        '是叛徒','是內鬼','是告密者','是背叛者',
        // ═══════ 【隱藏高手身份】═══════
        '是隱居的絕世高手','是退隱的殺神','是封刀的劍聖','是歸隱的宗師',
        '是逃亡的通緝犯','是被追殺的人','是隱姓埋名的復仇者','是改頭換面的人',
        '實力一直在隱藏','境界遠超表面','扮豬吃老虎','深藏不露',
        // ═══════ 【穿越重生身份】═══════
        '是穿越者','是異世界來的','是從現代穿越的','是從未來穿越的',
        '是重生者','是回到過去的','是重活一世的','記得前世的一切',
        '是系統宿主','綁定了系統','有金手指','有外掛',
        '是玩家','是書中角色覺醒了','知道劇情走向','是穿書的',
        // ═══════ 【人造生命身份】═══════
        '是克隆人','是複製體','是實驗品','是人造人',
        '是機器人','是AI覺醒體','是仿生人','是改造人',
        '是試管嬰兒','是基因改造產物','是生化武器','是超級士兵計劃產物',
        // ═══════ 【性別與人格秘密】═══════
        '其實是另一個性別','女扮男裝','男扮女裝','隱瞞真實性別',
        '有雙重人格','體內有另一個靈魂','被附身','與他人共用身體',
        '其實已經死了只是不知道','是鬼但自己不知道','活在幻覺中','一切都是夢',
        // ═══════ 【血統秘密】═══════
        '體內有龍族血脈','是龍的後裔','有上古血脈','是純血種',
        '體內封印著邪神','是邪神容器','被選為祭品','是詛咒的載體',
        '體內有遠古神獸','與魔族有血緣','是神魔混血','是禁忌之子',
        '是禁忌之戀的產物','是仇人之子','是不該存在的','出生就是錯誤',
        '血液有特殊能力','血能治病','血能解毒','血是最強的藥',
        '血統被詛咒','生來帶著詛咒','命中注定悲劇','無法逃脫的宿命',
        '是最後一個純血','是瀕危種族','是滅族的倖存者','是唯一的血脈',
        // ═══════ 【黑暗過去】═══════
        '曾經殺過人','手上沾滿鮮血','殺人如麻','是劊子手',
        '曾經毀滅過一個城市','造成過大屠殺','是戰犯','是滅族的凶手',
        '曾經背叛過摯友','出賣過同伴','為了活命犧牲別人','踩著別人上位',
        '曾經是反派','做過壞事','黑歷史','不堪回首的過去',
        '曾經是邪教成員','參與過邪惡儀式','獻祭過他人','與邪神有牽連',
        '曾與惡魔簽約','出賣了靈魂','有不可違抗的契約','被束縛著',
        '曾在地獄待過','去過冥界','經歷過死亡','死而復生',
        '曾經歷過無數輪迴','活了無數世','見證過滄海桑田','永生的詛咒',
        '曾經失去過記憶','被消除了記憶','有一段空白','不知道自己是誰',
        '過去是殺手','是暗殺者','是死神',
        // ═══════ 【情感罪過】═══════
        '曾經愛過敵人','愛過不該愛的人','背叛過愛人','辜負過深情',
        '曾拋棄過孩子','有不認的親人','逃避過責任','虧欠了家人',
        '曾見死不救','眼睜睜看著人死','沒能救下重要的人','是倖存者',
        '曾為了活命出賣同伴','犧牲了別人','踏著屍骨活下來','背負著亡者',
        '做過不可告人的交易','出賣過原則','違背過誓言','欺騙過信任自己的人',
        // ═══════ 【隱藏能力】═══════
        '擁有預知能力','能看到未來','知道會發生什麼','先知',
        '擁有讀心術','能聽到他人心聲','知道所有人在想什麼','無法關閉',
        '能看見鬼魂','陰陽眼','能見到常人看不見的','通靈',
        '能穿梭夢境','入夢','操控夢境','夢境行者',
        '能操控時間','時間系能力','暫停時間','時間倒流',
        '擁有毀滅世界的力量','是行走的核彈','失控就是末日','被封印的力量',
        '擁有起死回生的能力','能復活死者','逆轉生死','死神',
        '擁有死亡回溯','死後能重來','無限復活','存檔讀檔',
        '能與動物交流','能聽懂獸語','能操控動物','萬獸之王',
        '能使用禁術','掌握禁忌之力','會被天道追殺','代價巨大',
        '身體里封印著強大存在','是容器','是器皿','內有大佬',
        '力量一直在壓制中','只展現了一成','真正實力深不可測',
        // ═══════ 【情感秘密】═══════
        '暗戀著某人','單相思','愛而不敢說','默默守護',
        '曾經深愛過仇敵','愛上了不該愛的人','禁忌之戀','錯誤的感情',
        '有一段不能說的戀情','秘密戀愛','地下情','不被祝福的愛',
        '有私生子','有孩子但沒公開','隱瞞了後代','不知道自己有孩子',
        '曾被愛人背叛','被拋棄過','被辜負過','愛情創傷',
        '其實恨著表面親近的人','笑裡藏刀','表面和善內心憎恨',
        '假裝愛著不愛的人','逢場作戲','利用感情','政治婚姻',
        '為愛做過瘋狂的事','為愛殺人','為愛背叛一切','為愛獻出生命',
        // ═══════ 【現代身份秘密】═══════
        '是網紅的小號','是匿名大V','有秘密帳號','是知名博主',
        '是匿名作家','是暢銷書作者','是神秘的創作者','筆名無人知曉',
        '有龐大的秘密財產','是隱形富豪','其實很有錢','裝窮',
        '是地下勢力的金主','背後是黑道','有不乾淨的關係','灰色收入',
        '有海外秘密身份','雙重國籍','另一個身份','逃亡在外',
        '從事灰色職業','是駭客','是詐騙犯','是洗錢的','是走私的',
        '在暗網有身份','是暗網大佬','交易過違禁品','見不得光',
        '掌握某人的把柄','握有證據','知道秘密','能威脅別人',
        '知道某個驚天大秘密','是知情者','是目擊者','被滅口名單上的人',
        '被威脅保守秘密','被要挾','有把柄在別人手裡','身不由己',
        // ═══════ 【世界真相秘密】═══════
        '與神簽訂了契約','與天道有約定','是神的棋子','背負著使命',
        '知道世界的真相','知道這是小說','知道這是遊戲','清醒者',
        '見過創世的場景','見證過世界誕生','知道一切的起源','上古記憶',
        '記得前世所有記憶','輪迴記憶','無數世的記憶','永恆的記憶',
        '是從未來來的','是未來人','知道歷史走向','穿越時間線',
        '是從平行世界來的','是另一個世界的','維度旅行者','位面行者',
        '活了幾百年','不老不死','見證了歷史','永生者',
        '經歷過世界毀滅','末日倖存者','見過終結','知道世界會怎麼滅亡',
        '知道所有人的命運','命運觀測者','能看到死期','知道結局'
      ];

      // ========== 人際關係選項（大幅擴充）==========
      const relationOptions = [
        // ═══════ 【直系血親】═══════
        '父母與子女','單親家庭','繼父繼母','養父養母','生父生母',
        '失散多年的親人','從小分離','被拐走的孩子','被調換的嬰兒',
        '隱瞞的親子關係','私生子','不被承認的孩子','見不得光的血脈',
        '祖孫關係','隔代撫養','太爺爺輩的存在','跨越時空的祖孫',
        // ═══════ 【兄弟姐妹】═══════
        '親兄弟姐妹','龍鳳胎','雙胞胎','多胞胎','年齡差距大的兄弟姐妹',
        '同父異母','同母異父','素未謀面的手足','失散的孿生',
        '繼兄弟姐妹','義兄弟姐妹','結拜兄弟','結義姐妹','拜把子',
        '兄弟鬩牆','姐妹反目','手足相殘','骨肉相爭',
        // ═══════ 【其他親戚】═══════
        '叔伯姑舅姨','表兄弟姐妹','堂兄弟姐妹','遠房親戚',
        '其實是遠房親戚','隱藏的血緣','同族','同宗',
        '偽裝的家人','冒充的親人','假的家人','入贅','招親',
        // ═══════ 【青梅竹馬類】═══════
        '青梅竹馬','兩小無猜','一起長大','從小認識',
        '鄰居家的孩子','指腹為婚','娃娃親','世交之好',
        '小時候訂的婚約','兒時的約定','童年的承諾','刻在樹上的誓言',
        '長大後重逢','多年後再見','物是人非','你還記得我嗎',
        // ═══════ 【一見鍾情類】═══════
        '一見鍾情','一眼萬年','初見傾心','見色起意',
        '命中注定','緣分天定','紅線牽引','天生一對',
        '救命之恩以身相許','英雄救美','美救英雄','窮途末路被收留',
        '素不相識卻莫名信任','陌生的熟悉感','似曾相識','前世的牽絆',
        // ═══════ 【日久生情類】═══════
        '日久生情','患難見真情','共患難','同生共死',
        '從討厭到喜歡','歡喜冤家','不打不相識','吵著吵著就在一起了',
        '從陌生到熟悉','漸漸習慣你的存在','什麼時候開始在意你的',
        '友達以上戀人未滿','曖昧不明','若即若離','欲說還休',
        // ═══════ 【禁忌之戀類】═══════
        '禁忌之戀','不倫之戀','師生戀','主僕戀','年齡差',
        '跨越種族的愛情','人妖殊途','人鬼情未了','人神之戀',
        '敵對陣營的戀人','羅密歐與茱麗葉','愛上了不該愛的人',
        '仇人之子/女','愛上仇人','相愛相殺','又愛又恨',
        '包辦婚約','政治聯姻','和親','利益婚姻','商業聯姻',
        '同性愛人','隱秘的戀情','不被接受的愛','為愛對抗世界',
        // ═══════ 【單戀暗戀類】═══════
        '暗戀多年','單相思','愛而不得','得不到的永遠在騷動',
        '默默守護','遠遠看著就好','只要你幸福','成全你和別人',
        '備胎','第二選擇','永遠的朋友區','被發好人卡',
        '錯過','來不及說出口','一直等待','等一個不會回來的人',
        // ═══════ 【感情糾葛類】═══════
        '三角戀','多角關係','情敵','搶奪戀人',
        '前任','現任','小三','介入者',
        '分手後再相遇','舊情復燃','破鏡重圓','和好如初',
        '被愛人背叛','被拋棄','被劈腿','信任崩塌',
        '為愛放棄一切','愛到卑微','失去自我','患得患失',
        '異地戀','網戀','跨國戀','時差戀愛',
        '虐戀','病態依戀','控制欲','佔有欲','你是我的',
        // ═══════ 【摯友知己類】═══════
        '最好的朋友','閨蜜','兄弟','鐵哥們','死黨',
        '患難之交','生死之交','過命的交情','一起扛過槍',
        '知己','靈魂伴侶','最懂我的人','無話不談',
        '曾經救命恩人','曾被對方救過','以命換命','生死與共',
        // ═══════ 【表面朋友類】═══════
        '表面朋友','塑膠姐妹','酒肉朋友','利益之交',
        '點頭之交','泛泛之交','認識但不熟','見面打招呼',
        '利益同盟','互相利用','各取所需','合則聚散則離',
        '共同秘密','有把柄在對方手上','互相牽制','互相忌憚',
        // ═══════ 【反目成仇類】═══════
        '真心換絕情','朋友變仇人','反目成仇','形同陌路',
        '漸行漸遠','走散了','不再聯繫','老死不相往來',
        '誤會','解不開的心結','說不清的往事','各執一詞',
        '背叛','出賣','落井下石','反戈一擊',
        // ═══════ 【師徒傳承類】═══════
        '師徒','師父與徒弟','掌門與弟子','前輩與後輩',
        '師兄弟','師姐妹','同門','同一個師父',
        '大師兄','關門弟子','入室弟子','記名弟子',
        '繼承衣缽','傳授絕學','秘密教導','傾囊相授',
        '名義上的徒弟','掛名弟子','只是表面','另有師承',
        '師生轉為戀人','超越師徒的感情','亦師亦父','如父如兄',
        '叛出師門','欺師滅祖','弒師','恩斷義絕',
        '對師父又敬又恨','愛恨交織','糾葛不清',
        '師徒反目','超越師父','青出於藍','徒弟打敗師父',
        // ═══════ 【主從效忠類】═══════
        '主人與僕從','主子與奴才','少爺小姐與丫鬟小廝',
        '君王與臣子','帝王與將軍','皇帝與近臣','王與騎士',
        '領主與騎士','將軍與士兵','頭領與部下','老大與小弟',
        '雇主與員工','老闆與打工人','甲方與乙方',
        '主人與契約者','召喚師與召喚獸','馴獸師與靈獸',
        '神與信徒','教主與教徒','神父與信眾',
        '系統與宿主','AI與使用者','創造者與被造物',
        '效忠','誓死追隨','以命相護','為主赴死',
        // ═══════ 【宿敵仇恨類】═══════
        '宿敵','一生之敵','命中注定的對手','此生必須打敗的人',
        '世仇','家族世仇','門派世仇','國仇家恨',
        '殺父/母之仇','滅門之仇','奪妻/夫之恨','毀我一切',
        '不共戴天','你死我活','有你沒我','一山不容二虎',
        '競爭對手','商業對手','職場對手','政敵',
        '暗中較勁','明爭暗鬥','互相看不順眼','針鋒相對',
        '表面和平實則對立','笑裡藏刀','各懷鬼胎','虛與委蛇',
        '被迫敵對','身不由己','各為其主','立場不同',
        '因誤會成仇','本不該是敵人','陰差陽錯','被人挑撥',
        // ═══════ 【亦敵亦友類】═══════
        '亦敵亦友','合作與對抗','互相欣賞的對手','惺惺相惜',
        '表面仇敵實則合作','暗中聯手','共同的敵人','敵人的敵人是朋友',
        '臨時同盟','利益一致',
        '互相猜忌卻又合作','信任又防備','合作但保持距離',
        '命運綁定','一榮俱榮一損俱損','連坐','牽一髮動全身',
        // ═══════ 【靈魂羈絆類】═══════
        '靈魂連結','心靈感應','能感知對方','心有靈犀',
        '共用一個身體','輪流控制','你中有我我中有你',
        '一方是另一方的分身','影子','鏡像','另一個自己',
        '互為對方的光與暗','一體兩面','相生相克','命運對立',
        '契約關係','靈魂契約','血契','不可違背的約定',
        // ═══════ 【命運糾纏類】═══════
        '命運的羈絆','冥冥中注定','劫數難逃',
        '輪迴中反覆相遇','每一世都會遇見','逃不開的因果',
        '不同時空的同一人','平行世界的自己','另一個版本的我',
        '未來的自己','過去的自己','時間線上的相遇',
        '穿越前就認識','書中讀過對方的故事','夢中見過',
        '轉世的親人','前世的戀人','上輩子的仇人','因果輪迴',
        // ═══════ 【組織同僚類】═══════
        '同事','同學','同窗','同班同學',
        '室友','舍友','鄰居','樓上樓下','隔壁',
        '同一個組織成員','戰友','隊友','同伴','夥伴',
        '合作夥伴','生意夥伴','創業夥伴','拍檔',
        '投資關係','債務關係','欠錢的','被欠錢的',
        '臨時組隊','被迫合作','勉強湊合','不得不一起',
        // ═══════ 【現代社交類】═══════
        '網友','網戀對象','從未見過面','只在網上認識',
        '粉絲與偶像','追星','飯圈','站姐',
        '直播間認識','彈幕聊天','打賞關係','榜一大哥',
        '遊戲隊友','開黑','網遊夫妻','公會成員',
        '相親對象','介紹認識','父母安排','被催婚',
        '前任的朋友','閨蜜的前任','朋友的朋友','圈子太小',
        '醫患關係','律師與委託人','記者與線人','警察與線人',
        '房東與租客','快遞小哥','外賣員','常去的店的店員'
      ];

      // ==================== 填充 Datalist ====================
      function populateDatalist(listId, options) {
        const datalist = document.getElementById(listId);
        if (datalist) {
          datalist.innerHTML = options.map(opt => `<option value="${opt}">`).join('');
        }
      }
      
      // 初始化所有 datalist（保留作為瀏覽器原生備援）
      populateDatalist('personality-list', personalityOptions);
      populateDatalist('goal-list', goalOptions);
      populateDatalist('weakness-list', weaknessOptions);
      populateDatalist('secret-list', secretOptions);
      populateDatalist('relation-list', relationOptions);

      // ==================== 自訂下拉選單（可點開／捲動／過濾／自由輸入）====================
      function attachCombobox(input, options) {
        if (!input || input.__comboAttached) return;
        input.__comboAttached = true;

        const wrap = document.createElement('div');
        wrap.className = 'combo';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.classList.add('combo-input');

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'combo-toggle';
        toggle.tabIndex = -1;
        toggle.setAttribute('aria-label', '展開選項');
        toggle.innerHTML = '<span class="combo-caret"></span>';
        wrap.appendChild(toggle);

        const menu = document.createElement('ul');
        menu.className = 'combo-menu';
        wrap.appendChild(menu);

        let activeIndex = -1;
        let filtered = options.slice();

        function buildMenu(filterText) {
          const q = (filterText || '').trim();
          filtered = q ? options.filter(o => o.includes(q)) : options.slice();
          menu.innerHTML = '';
          if (filtered.length === 0) {
            const li = document.createElement('li');
            li.className = 'combo-empty';
            li.textContent = '無相符選項，可直接輸入自訂';
            menu.appendChild(li);
            return;
          }
          const curVal = input.value.trim();
          filtered.forEach((opt) => {
            const li = document.createElement('li');
            li.className = 'combo-item';
            li.textContent = opt;
            if (opt === curVal) li.classList.add('selected');
            li.addEventListener('mousedown', (e) => {
              e.preventDefault(); // 避免 input 先 blur 關閉選單
              choose(opt);
            });
            menu.appendChild(li);
          });
        }

        function open(filterText) {
          closeAllCombos(wrap);
          buildMenu(filterText);
          wrap.classList.add('open');
          activeIndex = -1;
        }
        function close() {
          wrap.classList.remove('open');
          activeIndex = -1;
        }
        function choose(val) {
          input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        }
        function highlight(idx) {
          const items = Array.from(menu.querySelectorAll('.combo-item'));
          if (items.length === 0) return;
          activeIndex = (idx + items.length) % items.length;
          items.forEach((it, i) => it.classList.toggle('active', i === activeIndex));
          items[activeIndex].scrollIntoView({ block: 'nearest' });
        }

        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          if (wrap.classList.contains('open')) { close(); }
          else { open(''); input.focus(); }
        });
        input.addEventListener('focus', () => open(input.value));
        input.addEventListener('input', () => open(input.value));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown') {
            if (!wrap.classList.contains('open')) open(input.value); else highlight(activeIndex + 1);
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            highlight(activeIndex - 1); e.preventDefault();
          } else if (e.key === 'Enter') {
            if (wrap.classList.contains('open') && activeIndex >= 0 && filtered[activeIndex]) {
              choose(filtered[activeIndex]); e.preventDefault();
            }
          } else if (e.key === 'Escape') {
            close();
          }
        });
      }

      // 關閉所有（或除了指定的）下拉選單
      function closeAllCombos(except) {
        document.querySelectorAll('.combo.open').forEach(c => {
          if (c !== except) c.classList.remove('open');
        });
      }
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.combo')) closeAllCombos();
      });

      // ==================== 進階設定資料 ====================
      // 敘事視角
      const narrativeOptions = [
        // 基本視角
        { value: '第一人稱', label: '👤 第一人稱 - 「我走進房間...」' },
        { value: '第三人稱限知', label: '👁️ 第三人稱限知 - 跟隨主角視角' },
        { value: '第三人稱全知', label: '🌐 第三人稱全知 - 上帝視角' },
        { value: '第二人稱', label: '🫵 第二人稱 - 「你走進房間...」' },
        // 切換視角
        { value: '多視角切換', label: '🔄 多視角切換 - 每章不同角色' },
        { value: '雙線敘事', label: '⚡ 雙線敘事 - 兩條主線交織' },
        { value: '群像劇視角', label: '👥 群像劇視角 - 無固定主角' },
        { value: '對立視角', label: '⚔️ 對立視角 - 敵對雙方交替' },
        // 特殊敘事
        { value: '書信體', label: '✉️ 書信體 - 以書信呈現' },
        { value: '日記體', label: '📔 日記體 - 日記形式記錄' },
        { value: '回憶錄', label: '📜 回憶錄 - 主角回顧往事' },
        { value: '旁白敘述', label: '🎙️ 旁白敘述 - 故事外的講述者' },
        { value: '採訪體', label: '🎤 採訪體 - 訪談問答形式' },
        { value: '檔案體', label: '📁 檔案體 - 檔案報告形式' },
        // 創新敘事
        { value: '意識流', label: '🌊 意識流 - 角色內心獨白' },
        { value: '碎片式', label: '🧩 碎片式 - 非線性敘事' },
        { value: '倒敘', label: '⏪ 倒敘 - 從結局開始' },
        { value: '插敘', label: '📍 插敘 - 穿插回憶' },
        { value: '環形敘事', label: '🔁 環形敘事 - 首尾呼應' },
        { value: '不可靠敘述者', label: '🎭 不可靠敘述者 - 敘述可能有誤' },
        { value: '元敘事', label: '📖 元敘事 - 打破第四面牆' },
        { value: '系統提示風格', label: '💻 系統提示風格 - 【系統】形式' },
        // 新增敘事
        { value: '多時間線交錯', label: '⏱️ 多時間線交錯 - 過去現在並行' },
        { value: '遊戲日誌體', label: '🎮 遊戲日誌體 - 任務/log 記錄' },
        { value: '論壇聊天室體', label: '💬 論壇/聊天室 - 帖文與留言' },
        { value: 'AI旁白', label: '🤖 AI 旁白 - 人工智慧講述' },
        { value: '實況轉播體', label: '📡 實況轉播 - 即時播報口吻' },
        { value: '文件拼貼體', label: '🗂️ 文件拼貼 - 報告/信件/剪報' },
        { value: '動物視角', label: '🐾 動物/非人視角 - 以動物為敘述者' }
      ];

      // 時代設定
      const eraOptions = [
        // ═══ 中國古代 ═══
        { value: '遠古神話時代', label: '🏛️ 遠古神話 - 盤古女媧時代' },
        { value: '上古三皇五帝', label: '👑 三皇五帝 - 黃帝炎帝' },
        { value: '夏商周', label: '🏺 夏商周 - 青銅禮器' },
        { value: '先秦時代', label: '⚔️ 春秋戰國 - 百家爭鳴' },
        { value: '秦朝', label: '🐉 秦朝 - 始皇一統' },
        { value: '漢朝', label: '🏯 兩漢 - 絲路開通' },
        { value: '三國', label: '⚔️ 三國 - 群雄逐鹿' },
        { value: '魏晉南北朝', label: '🎭 魏晉 - 風流名士' },
        { value: '隋唐時代', label: '🌸 隋唐 - 盛世繁華' },
        { value: '五代十國', label: '🗡️ 五代十國 - 亂世紛爭' },
        { value: '宋朝', label: '📜 兩宋 - 文人雅韻' },
        { value: '元朝', label: '🐎 元朝 - 草原帝國' },
        { value: '明朝', label: '🏮 明朝 - 錦衣衛東廠' },
        { value: '清朝', label: '👘 清朝 - 宮廷皇權' },
        // ═══ 中國近現代 ═══
        { value: '清末民初', label: '🎩 清末民初 - 變革動盪' },
        { value: '民國時代', label: '🌇 民國 - 上海灘' },
        { value: '抗戰時期', label: '💣 抗日戰爭 - 烽火歲月' },
        { value: '建國初期', label: '🚩 建國初期 - 1949-1960' },
        { value: '特殊年代', label: '📕 特殊年代 - 1960-1980' },
        { value: '改革開放', label: '🌅 改革開放 - 1980-2000' },
        // ═══ 西方歷史 ═══
        { value: '古希臘', label: '🏛️ 古希臘 - 城邦哲學' },
        { value: '古羅馬', label: '⚔️ 古羅馬 - 帝國榮光' },
        { value: '黑暗時代', label: '🌑 黑暗時代 - 中世紀早期' },
        { value: '西方中世紀', label: '🏰 中世紀 - 騎士城堡' },
        { value: '文藝復興', label: '🎨 文藝復興 - 藝術覺醒' },
        { value: '大航海時代', label: '⛵ 大航海 - 地理大發現' },
        { value: '啟蒙時代', label: '💡 啟蒙時代 - 理性之光' },
        { value: '維多利亞時代', label: '👒 維多利亞 - 英倫風情' },
        { value: '工業革命', label: '⚙️ 工業革命 - 蒸汽時代' },
        { value: '一戰時期', label: '🎖️ 一戰時期 - 壕溝戰' },
        { value: '二戰時期', label: '💣 二戰時期 - 世界大戰' },
        { value: '冷戰時期', label: '🕵️ 冷戰 - 鐵幕時代' },
        // ═══ 其他文明 ═══
        { value: '古埃及', label: '🏺 古埃及 - 金字塔法老' },
        { value: '古巴比倫', label: '🌙 古巴比倫 - 空中花園' },
        { value: '古印度', label: '🕉️ 古印度 - 恆河文明' },
        { value: '日本戰國', label: '⚔️ 日本戰國 - 武士時代' },
        { value: '江戶時代', label: '🎌 江戶時代 - 忍者武士道' },
        { value: '明治維新', label: '🌅 明治維新 - 東洋變革' },
        { value: '北歐維京', label: '🪓 維京時代 - 海盜掠奪' },
        { value: '奧斯曼帝國', label: '🌙 奧斯曼 - 蘇丹宮廷' },
        { value: '蒙古帝國', label: '🐎 蒙古帝國 - 征服世界' },
        { value: '美國西部', label: '🤠 美國西部 - 牛仔時代' },
        // ═══ 現代與未來 ═══
        { value: '現代', label: '🏙️ 現代 - 當代都市' },
        { value: '近未來', label: '🔮 近未來 - 2030-2050' },
        { value: '中未來', label: '🌐 中未來 - 2050-2100' },
        { value: '遠未來', label: '🚀 遠未來 - 星際時代' },
        { value: '超未來', label: '🌌 超未來 - 宇宙終末' },
        // ═══ 末世與架空 ═══
        { value: '末日後', label: '☢️ 末日後 - 廢土世界' },
        { value: '喪屍末日', label: '🧟 喪屍末日 - 活死人' },
        { value: '核戰後', label: '☣️ 核戰後 - 輻射廢土' },
        { value: '氣候災變', label: '🌊 氣候災變 - 生態崩潰' },
        { value: '架空歷史', label: '🌀 架空歷史 - 如果歷史...' },
        { value: '平行時空', label: '🔄 平行時空 - 另一個世界' },
        { value: '時間穿越', label: '⏳ 時間穿越 - 跨越時代' },
        { value: '永恆之城', label: '🏛️ 永恆之城 - 時間凍結' },
        // ═══ 奇幻架空 ═══
        { value: '洪荒', label: '🌋 洪荒 - 天地初開' },
        { value: '仙俠世界', label: '☯️ 仙俠 - 修仙問道' },
        { value: '玄幻大陸', label: '✨ 玄幻 - 鬥氣魔法' },
        { value: '西幻大陸', label: '🏰 西幻 - 劍與魔法' },
        { value: '蒸汽龐克', label: '⚙️ 蒸汽龐克 - 齒輪蒸汽' },
        { value: '賽博龐克', label: '🌃 賽博龐克 - 高科技低生活' },
        { value: '克蘇魯', label: '🐙 克蘇魯 - 宇宙恐懼' },
        { value: '哥特風', label: '🦇 哥特風 - 黑暗浪漫' },
        // 新增時代
        { value: '大正浪漫', label: '🌸 大正浪漫 - 和洋折衷' },
        { value: '昭和時代', label: '📻 昭和時代 - 復古日本' },
        { value: '千禧年代', label: '💿 千禧年代 - 2000 前後' },
        { value: '八零九零年代', label: '📼 八零九零 - 兩岸三地懷舊' },
        { value: '靈氣復甦紀元', label: '🌿 靈氣復甦 - 現代修真新紀元' },
        { value: '星際大航海', label: '🛰️ 星際大航海 - 殖民拓荒' },
        { value: '後人類紀元', label: '🧬 後人類 - 意識與義體' },
        { value: '矽基文明', label: '💡 矽基文明 - AI 主導時代' },
        { value: '蒸汽中華', label: '⚙️ 蒸汽中華 - 東方蒸汽朋克' },
        { value: '靈能復興', label: '🔮 靈能復興 - 超能力公開化' },
        { value: '大瘟疫時代', label: '🦠 大瘟疫 - 隔離與重建' },
        { value: '太空殖民晚期', label: '🌌 殖民晚期 - 星海邦聯' }
      ];

      // 故事節奏
      const pacingOptions = [
        // 基本節奏
        { value: '慢熱鋪陳', label: '🐢 慢熱鋪陳 - 細膩描寫，娓娓道來' },
        { value: '標準節奏', label: '⚖️ 標準節奏 - 張弛有度，收放自如' },
        { value: '快節奏', label: '🏃 快節奏 - 緊湊刺激，事件密集' },
        { value: '極速節奏', label: '⚡ 極速節奏 - 分秒必爭，喘不過氣' },
        // 類型節奏
        { value: '爽文節奏', label: '💥 爽文節奏 - 高潮迭起，打臉不斷' },
        { value: '懸疑節奏', label: '🔍 懸疑節奏 - 層層剝繭，真相漸露' },
        { value: '文藝節奏', label: '🎭 文藝節奏 - 重視內心，淡化情節' },
        { value: '史詩節奏', label: '📖 史詩節奏 - 宏大敘事，時間跨度長' },
        { value: '日常節奏', label: '☕ 日常節奏 - 生活瑣事，治癒舒適' },
        { value: '驚悚節奏', label: '😱 驚悚節奏 - 緊張壓迫，步步驚心' },
        { value: '浪漫節奏', label: '💕 浪漫節奏 - 情感細膩，怦然心動' },
        { value: '熱血節奏', label: '🔥 熱血節奏 - 戰鬥激昂，燃點不斷' },
        // 特殊節奏
        { value: '倒敘節奏', label: '⏪ 倒敘節奏 - 結局開場，追溯原因' },
        { value: '環形節奏', label: '🔁 環形節奏 - 首尾呼應，命運輪迴' },
        { value: '碎片節奏', label: '🧩 碎片節奏 - 時間跳躍，拼湊真相' },
        { value: '漸進節奏', label: '📈 漸進節奏 - 由慢到快，漸入佳境' },
        { value: '波浪節奏', label: '🌊 波浪節奏 - 起伏交替，張弛有度' },
        { value: '階梯節奏', label: '📶 階梯節奏 - 逐步升級，層層遞進' },
        { value: '爆發節奏', label: '💣 爆發節奏 - 蓄力爆發，高潮集中' },
        { value: '雙線節奏', label: '🔀 雙線節奏 - 並行推進，交匯高潮' },
        // 新增節奏
        { value: '開局即高潮', label: '🚀 開局即高潮 - 第一章就抓人' },
        { value: '單元劇節奏', label: '📺 單元劇 - 一章一個小故事' },
        { value: '養成漸進', label: '🌱 養成漸進 - 陪伴式成長' },
        { value: '慢綜治癒', label: '🍃 慢綜治癒 - 鬆弛無壓力' },
        { value: '群像輪轉', label: '👥 群像輪轉 - 多角色輪流推進' },
        { value: '懸念鉤子連發', label: '🪝 鉤子連發 - 章章留懸念' }
      ];

      // 內容分級
      const ratingOptions = [
        // 年齡分級
        { value: '全年齡', label: '👶 全年齡 - 適合所有人閱讀' },
        { value: '12+', label: '🔹 12歲以上 - 輕微衝突/情感' },
        { value: '15+', label: '🔸 15歲以上 - 中度戰鬥/曖昧' },
        { value: '18+', label: '🔴 18歲以上 - 較激烈內容' },
        // 內容傾向
        { value: '純愛向', label: '💕 純愛向 - 清水甜文，溫馨治癒' },
        { value: '輕度曖昧', label: '💗 輕度曖昧 - 點到為止，意猶未盡' },
        { value: '中度情感', label: '💖 中度情感 - 情感描寫較深入' },
        { value: '暗黑向', label: '🖤 暗黑向 - 黑暗劇情，道德灰色' },
        { value: '獵奇向', label: '👁️ 獵奇向 - 奇特設定，挑戰常規' },
        { value: '血腥向', label: '🩸 血腥向 - 戰鬥描寫較激烈' },
        { value: '驚悚向', label: '👻 驚悚向 - 恐怖驚悚元素' },
        { value: '虐心向', label: '💔 虐心向 - 情感拉扯，刀片不斷' },
        { value: '致鬱向', label: '😢 致鬱向 - 沉重壓抑，悲劇走向' },
        { value: '治癒向', label: '🌸 治癒向 - 溫暖人心，療癒系' },
        { value: '搞笑向', label: '😂 搞笑向 - 輕鬆歡樂，笑點密集' },
        { value: '正劇向', label: '📖 正劇向 - 嚴肅認真，劇情為主' },
        // 新增傾向
        { value: '闔家歡', label: '👨‍👩‍👧‍👦 闔家歡 - 老少咸宜' },
        { value: '燒腦向', label: '🧩 燒腦向 - 需動腦推理' },
        { value: '無腦爽向', label: '😎 無腦爽向 - 圖一個痛快' },
        { value: '群像向', label: '👥 群像向 - 重在眾生百態' },
        { value: '考據向', label: '📚 考據向 - 注重設定與細節' }
      ];

      // 世界觀複雜度
      const worldComplexityOptions = [
        // 基本複雜度
        { value: '極簡', label: '⚪ 極簡 - 背景模糊，聚焦角色' },
        { value: '簡單', label: '🔘 簡單 - 單一場景，易於理解' },
        { value: '中等', label: '🔵 中等 - 2-3個陣營/國家' },
        { value: '複雜', label: '🔴 複雜 - 多國多勢力，詳細設定' },
        { value: '史詩級', label: '🌟 史詩級 - 龐大世界觀，多線並進' },
        { value: '超史詩', label: '🌌 超史詩 - 多位面/多時代交織' },
        // 特殊設定
        { value: '單場景深挖', label: '🔬 單場景深挖 - 一地一事，深度刻畫' },
        { value: '城市級', label: '🏙️ 城市級 - 一城之內，勢力錯綜' },
        { value: '國家級', label: '🏯 國家級 - 朝堂江湖，內外交困' },
        { value: '大陸級', label: '🗺️ 大陸級 - 多國爭霸，諸侯割據' },
        { value: '世界級', label: '🌍 世界級 - 全球格局，大國博弈' },
        { value: '宇宙級', label: '🚀 宇宙級 - 星際文明，種族對抗' },
        { value: '多元宇宙', label: '🌐 多元宇宙 - 平行世界，維度穿梭' },
        // 體系設定
        { value: '鬆散設定', label: '🎲 鬆散設定 - 服務劇情，隨寫隨編' },
        { value: '硬核設定', label: '📐 硬核設定 - 嚴格體系，邏輯自洽' },
        { value: '軟科幻', label: '🔮 軟科幻 - 科技為背景，不深究' },
        { value: '硬科幻', label: '⚛️ 硬科幻 - 科學嚴謹，邏輯推演' },
        // 新增複雜度
        { value: '低魔世界', label: '🕯️ 低魔世界 - 魔法稀少而珍貴' },
        { value: '高魔世界', label: '🔥 高魔世界 - 魔法充斥日常' },
        { value: '規則驅動', label: '📐 規則驅動 - 嚴格規則主導劇情' },
        { value: '克系不可知', label: '🐙 克系不可知 - 真相不可名狀' },
        { value: '雙世界對照', label: '🪞 雙世界對照 - 兩個世界互映' }
      ];

      // 情感基調
      const emotionalToneOptions = [
        // 正向基調
        { value: '歡樂輕鬆', label: '😄 歡樂輕鬆 - 笑點滿滿，開心閱讀' },
        { value: '溫馨治癒', label: '🌸 溫馨治癒 - 暖心故事，療癒人心' },
        { value: '浪漫甜蜜', label: '💗 浪漫甜蜜 - 甜到齁，戀愛腦必看' },
        { value: '熱血燃向', label: '🔥 熱血燃向 - 燃爆全場，激情澎湃' },
        { value: '青春活力', label: '🌈 青春活力 - 朝氣蓬勃，青春無悔' },
        { value: '勵志向上', label: '💪 勵志向上 - 努力就會有回報' },
        { value: '希望光明', label: '☀️ 希望光明 - 黑暗後是黎明' },
        // 負向基調
        { value: '虐心糾結', label: '💔 虐心糾結 - 情感拉扯，刀片預警' },
        { value: '黑暗沉重', label: '🖤 黑暗沉重 - 致鬱走向，壓抑氛圍' },
        { value: '悲傷憂鬱', label: '😢 悲傷憂鬱 - 淚點滿滿，意難平' },
        { value: '絕望窒息', label: '😰 絕望窒息 - 看不到希望' },
        { value: '孤獨寂寞', label: '🌙 孤獨寂寞 - 一個人的夜晚' },
        { value: '蒼涼悲壯', label: '🍂 蒼涼悲壯 - 悲劇英雄，壯烈犧牲' },
        // 緊張刺激基調
        { value: '懸疑緊張', label: '🔍 懸疑緊張 - 步步為營，真相撲朔' },
        { value: '詭異驚悚', label: '👻 詭異驚悚 - 細思極恐，脊背發涼' },
        { value: '驚險刺激', label: '💥 驚險刺激 - 心跳加速，喘不過氣' },
        { value: '壓迫窒息', label: '😱 壓迫窒息 - 危機四伏，無處可逃' },
        { value: '神秘詭譎', label: '🌀 神秘詭譎 - 迷霧重重，疑點叢生' },
        // 複雜基調
        { value: '史詩壯闘', label: '⚔️ 史詩壯闘 - 宏大敘事，英雄傳說' },
        { value: '諷刺幽默', label: '😏 諷刺幽默 - 黑色喜劇，嘲諷現實' },
        { value: '哲理深沉', label: '🤔 哲理深沉 - 探討人生，發人深省' },
        { value: '荒誕離奇', label: '🎪 荒誕離奇 - 魔幻現實，荒誕不經' },
        { value: '複雜糾葛', label: '🔀 複雜糾葛 - 愛恨交織，立場模糊' },
        { value: '灰色地帶', label: '⬛ 灰色地帶 - 無絕對善惡，道德模糊' },
        // 特殊基調
        { value: '爽快解壓', label: '💯 爽快解壓 - 看完神清氣爽' },
        { value: '慢生活', label: '☕ 慢生活 - 歲月靜好，平淡是真' },
        { value: '復古懷舊', label: '📻 復古懷舊 - 年代感，回憶殺' },
        { value: '夢幻唯美', label: '✨ 夢幻唯美 - 如夢似幻，美輪美奐' },
        { value: '現實殘酷', label: '🏚️ 現實殘酷 - 社會寫實，殘酷人生' },
        { value: '超脫世俗', label: '🏔️ 超脫世俗 - 出世情懷，道法自然' },
        // 新增基調
        { value: '燃中帶虐', label: '🔥💔 燃中帶虐 - 熱血裡藏刀' },
        { value: '苦中作樂', label: '🙂 苦中作樂 - 逆境也要笑' },
        { value: '爽中帶感', label: '💯 爽中帶感 - 痛快又動人' },
        { value: '平靜致鬱', label: '🌫️ 平靜致鬱 - 無聲的絕望' },
        { value: '史詩悲憫', label: '🕊️ 史詩悲憫 - 宏大中的慈悲' },
        { value: '溫暖治癒中帶痛', label: '🌤️ 治癒帶痛 - 暖中有淚' }
      ];

      // 結局傾向
      const endingOptions = [
        // 經典結局
        { value: 'HE', label: '😊 HE（Happy End）- 大團圓，皆大歡喜' },
        { value: 'BE', label: '😢 BE（Bad End）- 悲劇收場，意難平' },
        { value: 'OE', label: '🤔 OE（Open End）- 開放結局，留給讀者' },
        { value: 'TE', label: '✨ TE（True End）- 真結局，隱藏真相' },
        { value: 'NE', label: '😶 NE（Normal End）- 普通結局，中規中矩' },
        // 特殊HE
        { value: '圓滿HE', label: '🎉 圓滿HE - 所有人都幸福' },
        { value: '遺憾HE', label: '🌅 遺憾HE - 大方向好，但有遺憾' },
        { value: '苦盡甘來HE', label: '🌈 苦盡甘來HE - 歷盡艱辛終得幸福' },
        { value: '雙向奔赴HE', label: '💕 雙向奔赴HE - 有情人終成眷屬' },
        // 特殊BE
        { value: '虐心BE', label: '💔 虐心BE - 明明相愛卻無法在一起' },
        { value: '壯烈犧牲BE', label: '⚔️ 壯烈BE - 英雄犧牲，轟轟烈烈' },
        { value: '宿命BE', label: '🎭 宿命BE - 命運使然，無力回天' },
        { value: '黑化BE', label: '🖤 黑化BE - 主角墮落，萬劫不復' },
        { value: '滅世BE', label: '💀 滅世BE - 世界毀滅，無人倖免' },
        // 反轉結局
        { value: '逆轉結局', label: '😱 逆轉結局 - 最後大反轉，真相震撼' },
        { value: '反殺結局', label: '🗡️ 反殺結局 - 絕地反擊，逆風翻盤' },
        { value: '反派勝利', label: '😈 反派勝利 - 正義敗北，黑暗勝出' },
        { value: '第三方結局', label: '🦅 第三方結局 - 螳螂捕蟬黃雀在後' },
        // 開放式結局
        { value: '半開放', label: '🌅 半開放 - 主線完結，支線留白' },
        { value: '伏筆結局', label: '❓ 伏筆結局 - 暗示續作，懸念待解' },
        { value: '意識流結局', label: '🌀 意識流結局 - 夢境般模糊' },
        { value: '讀者選擇', label: '📖 讀者選擇 - 你認為是什麼就是什麼' },
        // 特殊結局
        { value: '輪迴結局', label: '🔄 輪迴結局 - 首尾呼應，宿命循環' },
        { value: '覺醒結局', label: '👁️ 覺醒結局 - 打破第四面牆' },
        { value: '多結局', label: '🔀 多結局暗示 - IF線，平行世界' },
        { value: '續集鋪墊', label: '📚 續集鋪墊 - 新的旅程即將開始' },
        { value: '番外預告', label: '🎬 番外預告 - 主線完結，番外繼續' },
        { value: '夢醒結局', label: '💭 夢醒結局 - 原來是一場夢' },
        { value: '死亡結局', label: '☠️ 死亡結局 - 主角死亡，故事終結' },
        { value: '昇華結局', label: '🌟 昇華結局 - 超脫凡塵，境界提升' },
        // 新增結局
        { value: '雙結局並陳', label: '🔀 雙結局並陳 - HE/BE 同時呈現' },
        { value: '循環解脫', label: '🔄 循環解脫 - 終結宿命輪迴' },
        { value: '犧牲換新生', label: '🕯️ 犧牲換新生 - 以犧牲開啟未來' },
        { value: '開放暗示HE', label: '🌅 開放暗示HE - 留白但傾向圓滿' },
        { value: '虐後HE', label: '💔➡️💕 虐後HE - 大虐之後終團圓' },
        { value: '神隱結局', label: '🌫️ 神隱結局 - 角色悄然消失' }
      ];

      // 特殊元素：逐選項對生成的實際影響（hover 時顯示，分批補齊）
      const specialElementImpacts = {
        // ── 系統機制 ──
        goldenFinger: '主角擁有超常優勢或外掛，可打破常理推進劇情',
        upgrade: '以打怪練級、境界突破為核心成長路線',
        skill: '可解鎖、組合的技能體系，影響戰鬥與策略選擇',
        inventory: '獨立儲物空間，收納資源並隨身取用',
        shop: '用積分或貨幣在系統內購買道具與能力',
        mission: '發布主線、支線任務，驅動情節推進',
        lottery: '以隨機抽取獲得獎勵，增添不確定與驚喜',
        achievement: '達成條件解鎖成就與額外獎勵',
        title: '獲得稱號附帶屬性或身分加成',
        attribute: '力量、智力等數值化屬性可見、可成長',
        level: '明確等級階梯，升級帶來能力躍升',
        exp: '透過行動累積經驗，換取升級與解鎖',
        points: '自由分配屬性點，塑造角色發展方向',
        mall: '以任務或活動積分兌換珍稀物品',
        daily: '每日簽到領取獎勵，形成日常節奏',
        synthesis: '組合材料合成新道具或裝備',
        gacha: '以抽卡獲得角色、夥伴或強力道具',
        binding: '神器或道具需認主，他人難以使用',
        'ranking-sys': '全服或區域排名，激發競爭與追逐',

        // ── 穿越重生 ──
        bookWorld: '穿越進書本或劇本世界，知曉原劇情卻可能改寫命運',
        soulSwap: '兩人靈魂交換身體，以錯位身分應對生活與關係',
        regression: '回到過去某時間點，帶著記憶重新選擇',
        dream: '穿越發生在夢境與現實交錯之間',
        summon: '從另一世界被召喚而來，異界勇者或召喚設定',
        possession: '靈魂佔據他人身體，帶來身分與記憶衝突',
        infant: '從嬰幼時期帶記憶重生，從小布局人生',
        'memory-awaken': '逐漸甦醒前世或隱藏記憶，重新認識自己',
        'worldline-shift': '微小選擇導致世界線偏離原著或現實',
        'plot-fix': '有意修正原劇走向，挽回悲劇或改寫結局',
        'butterfly-effect': '小改動引發連鎖巨變，後果難以預料',
        'karma-backlash': '改寫命運後遭因果或規則反噬',
        'fate-rewrite': '主動對抗既定命運，走未載於原著的路',
        'timeline-merge': '多條時間線收束合併，記憶與事件重疊',
        'prophecy-break': '挑戰不可逆的預言或神諭，尋找破局',

        // ── 感情線 ──
        firstLove: '青澀初戀的心動、試探與成長',
        jealousy: '因在意而產生嫉妒，推動情感張力',
        'love-hate': '愛與恨交織，關係在吸引與排斥間拉扯',
        'secret-love': '關係需隱藏，在外界壓力下秘密相守',
        'redemption-love': '一方或雙方以愛彼此治癒與拯救',
        triangle: '三人情感糾葛，抉擇與拉扯為主軸',
        double: '兩條並行的戀愛線，各自發展又可能交織',
        'age-gap': '年齡差距帶來的觀念、地位與情感張力',
        'master-disciple': '師徒身分下的禁忌或漸生情愫',
        'boss-employee': '職場權力差下的戀情與顧忌',
        'rival-love': '從對立競爭逐漸轉為愛慕',
        'pet-love': '跨越物種或異族的戀情設定',
        'reincarnation-love': '跨越輪迴再續前緣的宿命之戀',

        // ── 主角類型 ──
        underdog: '起點弱勢、備受輕視，靠成長逆轉處境',
        villain: '以反派視角或立場推進故事，道德灰色',
        healer: '擅長支援、治療與輔助隊友的角色定位',
        strategist: '靠謀略、佈局與算計解決衝突',
        salted: '消極躺平、不求上進，卻常被命運推著走',
        lucky: '運氣極佳，逢凶化吉、機緣不斷',
        hardworking: '靠勤奮與堅持彌補天賦不足',
        cold: '外冷內熱、寡言克制的人設基調',
        sunny: '開朗熱情、帶動氣氛的正面人設',
        dark: '經歷打擊後走向黑暗或偏激',
        dual: '兩種人格或身分交替主導行為',
        genius: '天資過人、年少成名的主角設定',
        veteran: '閱歷深厚、老練穩重的智者型主角',
        naive: '單純善良、易信他人的性格底色',
        schemer: '表面溫和、內心算計深沉',
        tsundere: '嘴硬心軟、不擅表達關心',
        yandere: '愛到極致、可能走向偏執與占有',
        chuuni: '中二發言與自我戲劇化的個性',
        'mob-face': '外貌平凡、不引人注目卻藏有實力或故事',
        'anti-hero': '手段灰色、目標卻可能正義的矛盾主角',
        reluctant: '不情願卻被推上舞台，被動應對使命',

        // ── 劇情元素 ──
        conspiracy: '幕後勢力佈局、層層陰謀逐步揭開',
        puzzle: '謎題、機關與線索串連的探險解謎',
        mystery: '未知力量或規則牽動事件發展',
        prophecy: '預言或天命牽引角色走向既定或抗命之路',
        secret: '身世、來歷等核心秘密待揭露',
        betrayal: '信任崩塌、立場反轉的衝擊轉折',
        redemption: '犯錯或墮落者尋求彌補與救贖',
        comeback: '陷入絕境後逆轉翻盤',
        inheritance: '古遺跡、傳承之力或秘法繼承',
        treasure: '爭奪寶物、解開寶藏之謎',
        escape: '被追殺或通緝下的逃亡與反擊',
        rescue: '營救人質或重要角色的任務驅動',
        trial: '試煉、考驗檢驗實力與心性',
        awakening: '潛能或力量在關鍵時刻覺醒',
        disguise: '偽裝身分或臥底滲透',
        investigation: '追查事件真相、拼湊證據',
        misunderstanding: '因誤會產生衝突，後需澄清',
        pretend: '假扮戀人或合作，感情漸成真',
        sacrifice: '為他人或大義付出重大犧牲',
        'reunion-plot': '離散後重逢、相認的感動橋段',

        // ── 世界觀 ──
        magic: '以魔法規則與施法體系為世界底層邏輯',
        technology: '高科技、未來社會與科學設定為背景',
        western: '劍與魔法、騎士王國等西方奇幻舞台',
        eastern: '修仙、江湖、東方神話等玄幻舞台',
        hybrid: '東西方或科幻奇幻元素混搭的世界',
        fairy: '童話式規則、寓言氛圍與奇幻生物',

        // ── 場景設定 ──
        school: '學院或門派為主要活動與成長舞台',
        kingdom: '建國、治國、擴張領土的經營敘事',
        tower: '逐層挑戰高塔或試煉，難度遞增',
        guild: '創建或經營公會、凝聚夥伴與資源',
        arena: '競技場對決、排名與榮譽爭奪',
        auction: '拍賣珍稀物品，牽動勢力與財力博弈',
        secretRealm: '探索秘境、機緣與未知危險並存',
        sect: '宗門大派內的傳承、派系與規矩',
        city: '現代或架空都市的叢林法則與人際網絡',
        village: '小鎮鄉村的熟人社會與慢節奏生活',
        forest: '森林荒野求生、探險與野獸威脅',
        sky: '浮空島、空中城等天空舞台',
        underground: '地下城、地底文明或暗世界',
        'ancient-ruins': '古代遺跡考古、機關與失落文明',
        hospital: '醫療現場、生死抉擇與專業壓力',
        prison: '監獄囚籠中的生存與越獄或洗冤',
        casino: '賭場博弈、運氣與心理戰',

        // ── 生活元素 ──
        craft: '鍛造兵器或煉製丹藥等技藝線',
        healing: '日常治癒、照顧與舒緩的生活質感',
        travel: '旅途見聞、異地邂逅與冒險',
        collection: '收集稀有物品或圖鑑的嗜好驅動',
        decoration: '佈置居所、營造生活美學',
        fashion: '服裝設計、穿搭與審美表達',
        medicine: '行醫問道、診治與藥理知識',
        teaching: '傳道授業、培育後輩',
        fishing: '釣魚、養殖等悠閒技藝日常',
        garden: '園藝花卉、四季更迭的靜謐描寫',
        tea: '品茶、茶會等雅事與人情往來',
        writing: '執筆著書、記錄傳奇或輿論影響',
        cooking: '烹飪技藝、美食與宴請人情',
        painting: '繪畫創作、藝術與審美衝突',
        dance: '舞蹈排練、表演與舞台競爭',
        sports: '體育訓練、賽事與團隊精神',
        gambling: '賭局、勝負心與風險抉擇',

        // ── 競爭對抗 ──
        faction: '陣營分明、立場對立的衝突格局',
        competition: '正式比賽、賽制與名次爭奪',
        politics: '朝堂權謀、派系鬥爭與利益交換',
        family: '家族興衰、繼承與內鬥',
        heist: '盜竊、詐騙與高智商犯罪橋段',
        survival: '生存淘汰、資源爭奪與人性考驗',
        ranking: '以排行榜名次驅動的對抗與追趕',
        territory: '地盤、領地或勢力範圍的爭奪',
        resources: '搶奪礦產、糧草等戰略資源',
        throne: '皇位或家主之位繼承之爭',
        spy: '間諜潛伏、情報戰與雙面身分',
        assassination: '刺殺行動、暗殺組織與陰謀',
        rebellion: '起義造反、推翻既有秩序',
        'gang-war': '黑幫火拼、地盤與仇殺',
        'idol-battle': '偶像、明星之間的資源與人氣競爭',
        'school-rivalry': '校園派系、社團或班級對立',
        'dimension-war': '跨位面、跨世界的宏大戰爭',

        // ── 特殊能力 ──
        eye: '特殊瞳術或視覺能力，看穿或制敵',
        bloodline: '血脈覺醒帶來天賦與傳承記憶',
        contract: '與靈體、魔物等締約召喚作戰',
        transformation: '變身、化形改變外貌或戰力',
        mind: '讀心、心靈感應或精神攻擊',
        element: '操控火、水、風、雷等元素力量',
        time: '時間暫停、回溯或加速等能力',
        space: '空間傳送、儲存或切割等能力',
        gravity: '操控重力改變戰場與行動',
        illusion: '製造幻象迷惑或困敵',
        poison: '用毒、解毒與毒理攻防',
        necro: '操控亡靈、死靈法術與陰暗力量',
        holy: '神聖、治癒與驅邪的光明力量',
        'dark-power': '黑暗、腐蝕或詛咒類力量',
        beast: '獸化、野性本能與獸形戰鬥',
        copy: '複製他人能力或招式',
        prediction: '預知片段未來、趨吉避凶',
        'healing-power': '超自然治癒、復甦與淨化',
        'luck-power': '氣運影響機緣、避禍或招財',
        charm: '魅惑、說服或精神影響他人',
        domination: '霸氣、威壓或精神支配',
        creation: '憑空創造物質、生命或規則',

        // ── 身份職業 ──
        prince: '王室身分帶來權力、責任與宮廷鬥爭',
        assassin: '殺手技藝、暗殺任務與道德拉扯',
        merchant: '商路經營、財富累積與商戰博弈',
        knight: '騎士榮譽、征戰與守護誓言',
        mage: '魔法研習、咒語與奧術對決',
        thief: '竊盜技藝、俠盜義行或神偷傳說',
        priest: '神職信仰、儀式與神恩或神罰',
        hunter: '追獵魔物、野外求生與賞金任務',
        chef: '廚藝技藝、美食征服與宴飲人情',
        doctor: '診治救人、藥理知識與醫德抉擇',
        teacher: '教導後輩、傳承知識與師道責任',
        emperor: '帝王權柄、朝堂治理與天下大勢',
        slave: '奴隸身分下的壓迫、反抗與翻身',
        orphan: '無依成長、尋根與自立之路',
        noble: '貴族禮儀、世家门第與社交政治',
        commoner: '平民視角、市井生活與草根逆襲',
        idol: '演藝舞台、粉絲與娛樂圈生態',
        programmer: '程式、駭客技術與數位攻防',
        detective: '偵查辦案、推理與正義追索',
        soldier: '軍旅紀律、戰場生死與袍澤情誼',
        pirate: '海上劫掠、自由與法外規則',
        necromancer: '死靈術、亡者操控與禁忌代價',

        // ── 特殊設定 ──
        nonHuman: '主角或關鍵角色為非人種族身分',
        immortal: '長生不死帶來的時間觀與孤獨',
        reincarnator: '多次輪迴、累積經驗與周目記憶',
        reader: '知曉原著劇情，試圖改寫或利用情報',
        cannon: '原著炮灰身分，努力求生改命',
        sickly: '體弱多病，限制行動卻可能以智謀補足',
        amnesia: '失憶謎團，逐步拼回身分與真相',
        mute: '失聲或啞巴，以行動與文字溝通',
        blind: '視覺缺失，強化其他感官與直覺',
        curse: '詛咒纏身，需尋找解除或共存之道',
        seal: '力量或記憶被封印，解封為關鍵轉折',
        clone: '分身或複製體引發身分與倫理問題',
        'hybrid-race': '混血身分夾雜兩族文化與歧視',
        gender: '性別轉換帶來身分、關係與自我認同變化',
        age: '身體年齡驟變，重新適應社會角色',
        possessed: '被外靈附身，意識爭奪或共生',
        'shared-body': '多人共用同一身體，輪流或爭奪主導',
        invisible: '隱形能力或隱身狀態改變互動方式',
        miniature: '身體縮放，視角與能力隨尺寸變化',
        'multiple-lives': '多條性命或復活次數，敢於冒險',
        deadline: '生命或任務倒數，時間壓力貫穿全篇',

        // ── 種族設定 ──
        elf: '長壽優雅、魔法親和與森林文明',
        dwarf: '鍛造技藝、地下城邦與固執豪爽',
        dragon: '龍族威儀、宝藏與古老血脈',
        vampire: '吸血長生、暗夜規則與誘惑危險',
        werewolf: '月相變身、野性與族群認同',
        'demon-race': '魔族力量、深淵文化與人魔對立',
        angel: '神聖秩序、羽翼與天界使命',
        beastman: '獸耳獸尾、部落習性與力量體質',
        mermaid: '海洋文明、歌聲與陸海隔離',
        ghost: '亡靈存在、執念與陰陽交界',
        sprite: '自然精靈、小巧魔法與森林守護',
        goblin: '群居狡詐、地下掠奪與弱小逆襲',
        orc: '蠻力好戰、部落榮譽與戰爭文化',
        android: '人造生命、程式倫理與人機界線',
        alien: '異星文明、科技差異與文化衝擊',
        deity: '神祇血脈或神族，權能與信仰牽連',
        'half-elf': '半精靈夾在人類與精靈之間',
        dragonkin: '龍人血脈，鱗甲與龍威傳承',
        insectoid: '蟲族蜂巢、集體意識或外骨骼戰士',
        'plant-folk': '植物系生命，光合、扎根與自然法則',
        'stellar-spirit': '星靈、宇宙能量與天象感應',
        'slime-folk': '史萊姆變形、吞噬與黏液體質',

        // ── 現代職場 ──
        secretary: '秘書協調、日程與上司身邊的權力近距離',
        lawyer: '法律攻防、庭辯與正義與利益拉扯',
        journalist: '採訪調查、新聞倫理與輿論影響',
        designer: '設計創作、審美競賽與客戶需求',
        model: '時尚舞台、鏡頭壓力與形象經營',
        athlete: '競技訓練、傷病與榮耀追逐',
        scientist: '實驗研究、發現與學術或商業倫理',
        pilot: '飛行任務、高空風險與冷靜判斷',
        firefighter: '救火救援、生死一線與團隊默契',
        'chef-modern': '現代餐飲主廚，米其林壓力與創意料理',
        baker: '烘焙技藝、小店溫情與手作堅持',
        barista: '咖啡文化、熟客人情與都市慢節奏',
        bartender: '酒吧夜生活、傾聽故事與調酒技藝',
        youtuber: '影音創作、流量焦慮與粉絲互動',
        'writer-modern': '寫作編劇、版權與創作瓶頸',

        // ── 情境模式 ──
        'escape-room': '密室機關、限時解謎與團隊合作',
        'battle-royale': '大規模生存競賽，最後倖存者',
        'deserted-island': '荒島缺水缺糧、求生與人性',
        'treasure-hunt': '按線索尋寶、競速與陷阱',
        'murder-mystery': '兇案調查、嫌疑人與反轉揭兇',
        'dating-sim': '戀愛選項、好感度與多結局路線',
        'idol-raising': '培育偶像、訓練與出道競爭',
        'cooking-battle': '料理對決、評審與創意比拼',
        'music-competition': '音樂舞台、評分與才華綻放',
        'fashion-show': '走秀、設計師與時尚圈博弈',
        'reality-show': '真人秀錄製、鏡頭內外人設',
        'talent-show': '選秀淘汰、觀眾投票與夢想追逐',
        'game-show': '綜藝遊戲關卡、獎金與笑點',

        // ── 網路時代 ──
        'live-reward': '直播打賞、榜一與虛擬經濟',
        barrage: '彈幕即時互動，影響氣氛與劇情',
        'viral-post': '論壇神帖爆紅、輿論發酵',
        'opinion-war': '公關攻防、立場站隊與話語權',
        doxxing: '人肉搜索、隱私曝光與網路暴力',
        'flame-war': '炎上、網暴與集體攻擊',
        vtuber: '虛擬形象直播、中之人與粉絲文化',
        metaverse: '虛擬世界社交、資產與身分',
        deepfake: '深度偽造影片，真假難辨的信任危機',
        'big-data': '大數據監控、畫像與隱私邊界',
        influencer: '網紅帶貨、流量變現與人設維護',
        trending: '熱搜霸榜、話題操控與輿情風向',
        'algo-feed': '演算法推薦塑造資訊繭房',
        'digital-legacy': '死後數位帳號、遺言與記憶留存',
        'cyber-stalking': '網路跟蹤、騷擾與數位恐懼',
        'anon-forum': '匿名論壇、爆料與地下話語',
        'ai-hallucination': 'AI 生成內容失真、信任危機',
        'crypto-scam': '加密貨幣詐騙、韭菜與泡沫',
        'podcast-drama': '播客節目引發的爭議與輿論',
        'meme-war': '迷因梗圖大戰、青年亞文化攻防',

        // ── 經營養成 ──
        recruit: '招募人才、面試與團隊組建',
        'internal-affairs': '內政建設、民生與制度推行',
        diplomacy: '外交談判、結盟與國際博弈',
        reputation: '聲望累積影響招募、貿易與事件',
        'territory-expand': '開疆拓土、屯田與邊防',
        'resource-mgmt': '糧草金錢等資源調度與短缺危機',
        'train-successor': '培養繼承人、傳位與試煉',
        'gather-talent': '禮賢下士、招攬名臣猛將',
        'morale-system': '士氣高低影響戰力與民心',
        'morale-collapse': '士氣崩潰引發潰敗或內亂',
        'supply-chain': '糧道、補給線與後勤成敗',
        'season-event': '四季農事、節慶與天時影響',
        'public-support': '民心向背決定統治穩固',
        'tax-reform': '稅制調整引發利益重分配',
        'disaster-relief': '災害應對、賑濟與民怨',
        'trade-route': '商路開拓、關稅與貿易戰',

        // ── 伏筆懸念 ──
        foreshadowing: '前文細節為後文反轉埋伏筆',
        'red-herring': '故意誤導讀者的假線索',
        'chekhov-gun': '早期出現的物件或設定必有用處',
        'mega-twist': '震撼級大反轉顛覆認知',
        cliffhanger: '章末懸念勾住讀者追更',
        'unreliable-clue': '看似可靠卻可能造假或曲解的線索',
        'identity-reveal': '關鍵身分在高潮時揭露',
        countdown: '倒數計時製造緊迫危機感',
        macguffin: '推動劇情卻未必解釋清楚的目標物',
        'delayed-revenge': '復仇計畫蟄伏多時後爆發',
        'double-twist': '反轉之後再反轉，層層剝離',
        'unreliable-narrator-hint': '敘述者可能隱瞞或誤導的詭計',
        'planted-evidence': '被人栽贓的假證據牽動調查',
        'false-protagonist': '假主角誤導，真主角後出',
        'hidden-ally': '暗中相助的盟友遲遲現身',
        'slow-reveal': '真相漸進揭露，不一次說破',
        'breadcrumb-trail': '零散小線索引導拼出全貌',
        'nested-mystery': '謎中謎、一層套一層的懸案',

        // ── 人際糾葛 ──
        'mentor-betrayal': '師徒決裂、理念或利益衝突',
        'blood-feud': '家族世仇代代相傳',
        'sworn-brothers': '義結金蘭、同生共死的情義',
        'best-friend-turn': '摯友反目，信任崩塌',
        'debt-of-life': '救命之恩牽動日後抉擇',
        'grudge-chain': '復仇連環，冤冤相報',
        'sibling-rivalry': '手足競爭繼承、寵愛或道途',
        'master-apprentice': '師徒情深、傳承與守護',
        'loyalty-test': '忠誠試煉，考驗立場與取捨',
        'proxy-grudge': '上一代仇恨延續到下一代',
        'debt-trap': '人情債難還，被迫妥協',
        'estranged-family': '親情疏離、誤會與和解',
        'protector-bond': '守護之約，以命相護的羈絆',
        'rival-respect': '宿敵相爭又彼此敬重',
        'betrayed-trust': '信任被背叛後的修復或復仇',
        'found-family': '非血緣卻情同家人的羈絆',
        'clan-duty': '宗族責任壓過個人意願',
        'mentor-sacrifice': '師長犧牲換取弟子生路',

        // ── 道德困境 ──
        trolley: '兩難抉擇，無完美答案的倫理難題',
        'lesser-evil': '兩害相權取其輕的痛苦決定',
        vigilante: '私刑正義，法外制裁的灰色',
        'white-lie': '善意謊言，保護與欺瞞的界線',
        'hostage-trade': '人質交換，救誰放棄誰',
        'sacrifice-one': '為救多數而犧牲少數',
        'ends-justify': '為達目的不擇手段的正當化',
        'dirty-hands': '為正義卻不得不沾染罪惡',
        'mercy-kill': '安樂死或仁慈殺害的抉擇',
        whistleblower: '吹哨告密，揭露黑幕的代價',
        'loyalty-vs-justice': '忠於所屬還是堅持正義',
        'forgive-enemy': '是否原諒傷害過自己的人',
        'obey-immoral-order': '服從上級惡令還是抗命',
        'truth-vs-harm': '說出真相可能傷害無辜',
        'resource-ration': '稀缺資源如何公平分配',
        'collateral-damage': '行動附帶傷害是否可接受',

        // ── 規則怪談 ──
        'midnight-taboo': '午夜後不可觸犯的禁忌規則',
        'no-look-back': '回頭即觸發詭異後果',
        'stair-count': '數樓梯階數不對會出事',
        'smile-detect': '辨識真假笑臉以區分人與詭',
        'wrong-floor': '電梯或樓層錯誤進入異空間',
        'mirror-rule': '鏡中映像違反常理的規則',
        'red-light-green': '紅綠燈式生死遊戲規則',
        'dont-answer': '特定來電或呼喚不可回應',
        'count-sheep': '數羊等催眠陷阱引誘入睡',
        'empty-seat': '空位不可坐，坐了會被盯上',
        'photo-taboo': '拍照會拍到不該存在的東西',
        'name-call': '直呼真名或禁忌名會招禍',
        'door-knock': '敲門次數錯誤開錯門',
        'elevator-ride': '電梯搭乘須遵守詭異守則',
        'school-handbook': '校規手冊藏有生存規則',
        'survival-manual': '詭異場所附贈的生存指南',
        'rule-update': '規則中途變更，舊知識失效',
        'rule-conflict': '兩條規則互相矛盾，進退兩難',

        // ── 反差喜劇 ──
        'roast-narrator': '旁白或角色吐槽製造笑點',
        'social-death': '公開社死、尷尬到想消失',
        'misunderstand-chain': '烏龍誤會連環放大',
        'dense-protagonist': '遲鈍錯過信號，反差製造笑料',
        'lucky-misfire': '運氣太好反而鬧出烏龍',
        'overpowered-comedy': '實力過強卻用在搞笑場合',
        'serious-fail': '嚴肅場面突然翻車出糗',
        'prop-fail': '道具或法術失靈鬧笑話',
        'wrong-person': '認錯人導致尷尬或誤會',
        'eavesdrop-fail': '偷聽只聽一半造成曲解',
        'dramatic-pause': '氣氛正緊張卻尷尬冷場',
        'npc-break': '打破第四面牆、吐槽設定',
        'clumsy-hero': '笨手笨腳卻意外過關',
        overreaction: '小事先反應過度，誇張好笑',
        'comedy-timing': '笑點節奏精準，包袱抖得剛好',
        'absurd-logic': '荒謬邏輯自圓其說，離譜卻好笑',

        // ── 秘密組織 ──
        'shadow-council': '影子議會在幕後操控局勢',
        'underground-guild': '地下公會承接見不得光的委託',
        'informant-web': '情報網交織，消息即權力',
        'sleeper-agent': '沉睡間諜多年後喚醒執行任務',
        'black-market': '黑市樞紐交易禁品與情報',
        'secret-society': '秘密結社守護古老誓約',
        'assassin-guild': '殺手公會規矩森嚴、任務派發',
        'resistance-cell': '地下抵抗組織對抗暴政',
        'cult-inner': '邪教內圈儀式與洗腦控制',
        'spy-ring': '諜報網滲透各方勢力',
        'hidden-order': '隱世宗門或教團不問世事',
        'mercenary-corp': '傭兵集團以契約作戰',
        'smuggler-net': '走私網絡運送禁運物',
        watchers: '守望者組織監視異常與威脅',
        'archive-bureau': '機密檔案局保存禁忌真相',
        'double-agency': '雙面間諜網，誰也不知誰是誰的人',

        // ── 成長蛻變 ──
        'let-go-obsession': '放下執念，與過去和解',
        'learn-trust': '學會信任他人，打開心扉',
        'accept-past': '接納不堪的過去，不再逃避',
        'forgive-self': '原諒自己的錯誤與軟弱',
        'mentor-legacy': '繼承師長意志，延續其路',
        'overcome-fear': '克服內心恐懼，勇敢前行',
        'humble-pride': '放下傲慢，承認不足',
        'find-purpose': '找到人生使命與方向',
        'mature-choice': '以成熟心態做出艱難抉擇',
        'break-cycle': '打破家族或命運的惡性循環',
        'self-worth': '建立自我價值，不再討好',
        'empathy-gain': '學會共情，理解他人處境',
        'leadership-grow': '從跟隨者成長為領袖',
        'accept-loss': '接受失去，帶著遺憾繼續活',
        'redefine-success': '重新定義何謂成功與幸福',
        'inner-peace': '內心獲得平靜，不再被執念驅使',

        // ── 神器法寶 ──
        'weapon-bond': '神器認主，人器一心',
        'cursed-blade': '詛咒之刃帶來力量與代價',
        'sealed-power': '封印力量逐步解放',
        'living-weapon': '活體兵器有意識、會對話',
        'soul-vessel': '法器寄魂，與持有者共生',
        'legendary-armor': '傳說甲冑護體、名揚四方',
        'artifact-hunt': '追尋失落神器的冒險',
        'broken-relic': '破碎聖物待修復或重鑄',
        'forbidden-tome': '禁書秘典記載禁忌知識',
        'pocket-dimension': '次元袋內藏獨立小空間',
        'sentient-item': '道具自有靈識，會提要求',
        'upgrade-weapon': '兵器隨戰役進化升階',
        'dual-wield-artifact': '雙神器並用，相輔或相剋',
        'sacrifice-weapon': '血祭開刃，以代價換力量',
        'lost-artifact': '失落神器重現世間引發爭奪',
        'counter-artifact': '專門克制某類力量或敵人的法寶',

        // ── 儀式禁忌 ──
        'blood-oath': '以血立誓，違者遭契約反噬',
        'naming-taboo': '真名不可輕呼，直呼則受制或招禍',
        'sacrifice-rite': '獻祭儀式換取力量或神恩',
        'contract-soul': '靈魂契約綁定，難以違背',
        'breaking-taboo': '破禁必付代價，愈重禁愈慘',
        'summoning-circle': '法陣召喚異界存在，風險難控',
        'purification-rite': '淨化儀式驅邪、洗罪或治癒',
        'binding-ceremony': '束縛典禮將人與物鎖定契約',
        'ancestral-rite': '祭祖儀式連結先祖與宗族力量',
        'forbidden-rite': '禁術儀式強大卻觸犯禁忌',
        'bloodline-awaken-rite': '血脈覺醒儀式引爆潛藏傳承',
        'seal-breaking-rite': '解封儀式釋放被封印之力',
        'oath-punishment': '違誓者受契約或神罰制裁',
        'moon-ritual': '依月相進行的儀式，威力隨盈虧',
        'death-rite': '送葬儀式引導亡魂、安撫或封印',
        'initiation-trial': '入門試煉，通過方獲承認與秘法',

        // ── 心理博弈 ──
        gaslight: '扭曲對方認知，令其懷疑自我判斷',
        interrogation: '審訊室內的心理壓迫與攻防',
        'bluff-chain': '虛張聲勢連環，真假難辨',
        'trust-test': '刻意試探忠誠，試出真心或破綻',
        'memory-implant': '植入假記憶，改寫認知與立場',
        'mind-game': '心理棋局，步步試探底線與弱點',
        'reverse-psych': '反心理戰，誘敵走入自設陷阱',
        'guilt-trip': '用罪惡感操控對方就範',
        'false-confession': '假供詞誤導調查或保護真兇',
        'split-personality-trap': '利用人格分裂或偽裝設下陷阱',
        'emotional-blackmail': '以情感要挾，逼迫對方妥協',
        'cognitive-dissonance': '製造認知矛盾，動搖信念與判斷',
        'prisoner-dilemma': '囚徒困境式合作與背叛抉擇',
        'information-war': '真假消息混戰，操控輿論與決策',
        'profile-target': '剖析弱點、恐懼與慾望精準下套',
        'break-will': '瓦解意志，逼其屈服或崩潰',

        // ── 身分偽裝 ──
        'fake-death': '假死脫身，避開追殺或輿論',
        'deep-cover': '長期臥底，深埋假身分多年',
        'body-double': '替身代赴險境或掩護真身',
        'gender-disguise': '改扮性別隱藏身分混入場合',
        'noble-incognito': '貴人微服私訪，察民情或辦密事',
        'false-identity': '偽造證件與履歷，冒充他人',
        'undercover-mission': '臥底任務滲透敵對組織',
        'stolen-face': '盜用他人容貌，冒充其行事',
        'alias-life': '以化名生活，切斷過去軌跡',
        'impersonate-official': '冒充官吏，利用權柄達目的',
        'witness-protection': '證人保護計畫，換身分藏蹤',
        'mask-reveal': '面具揭曉，身分震驚全場',
        'double-life': '白天與黑夜兩套身分並行',
        'infiltrate-enemy': '潛入敵營，冒死收集情報',
        'fake-marriage': '假結婚掩人耳目或達成協議',
        'identity-theft': '盜用他人身分，頂替其人生',

        // ── 委託任務 ──
        'bounty-board': '懸賞榜發布任務，吸引冒險者接案',
        'escort-mission': '護送要人貨物，途中遭襲',
        'timed-quest': '限時委託，逾期失敗或懲罰',
        'chain-quest': '連環委託，完成一環解鎖下一環',
        'fail-penalty': '任務失敗須付違約代價',
        'mystery-commission': '委託人與目的不明，疑雲重重',
        'delivery-run': '快遞運送，途中不得拆封或延誤',
        'investigation-job': '受託調查事件，按酬取證',
        'rescue-contract': '救援契約，限期救出目標',
        'assassination-contract': '暗殺委託，道德與利益拉扯',
        'gather-materials': '採集稀有材料，深入險地',
        'dungeon-contract': '攻略地城或秘境的委託',
        'negotiation-mission': '受託談判，左右局勢走向',
        'sabotage-job': '破壞任務，摧毀設施或計畫',
        'relay-mission': '接力任務，多人或分階段完成',
        'hidden-objective': '表面目標之外另有隱藏任務',

        // ── 語言咒術 ──
        'true-name': '知真名即可束縛或命令對象',
        'forbidden-word': '某些詞語不可說出，否則招禍',
        'oath-binding': '誓言出口即具拘束力，違則反噬',
        'written-curse': '寫下文字即成詛咒，難以抹除',
        'song-magic': '歌詠術以旋律施法或安撫',
        'rune-script': '符文咒文刻印即發動力量',
        'verbal-contract': '言靈契約，說出即生效',
        'whisper-spell': '低語咒術，悄聲卻致命',
        'name-steal': '竊取真名，奪其身分或控制權',
        'prophecy-verse': '預言詩句暗藏命運指引或陷阱',
        'command-word': '命令言靈，一語定生死',
        'silence-curse': '禁言詛咒，無法說出關鍵資訊',
        'story-weave': '敘事編織，說出的故事影響現實',
        'ancient-tongue': '古語咒令，常人難解其力',
        'lie-detection-word': '測謊言靈，辨真假之言',
        'seal-incantation': '封印咒語，鎖住力量或存在'
      };

      // 特殊元素（分類）
      const specialElementCategories = [
        {
          name: '系統機制',
          icon: '⚙️',
          items: [
            { id: 'goldenFinger', icon: '✨', label: '金手指/外掛' },
            { id: 'upgrade', icon: '📈', label: '升級打怪' },
            { id: 'skill', icon: '🎯', label: '技能樹' },
            { id: 'inventory', icon: '🎒', label: '隨身空間' },
            { id: 'shop', icon: '🛒', label: '系統商店' },
            { id: 'mission', icon: '📋', label: '任務系統' },
            { id: 'lottery', icon: '🎰', label: '抽獎/轉盤' },
            { id: 'achievement', icon: '🏅', label: '成就系統' },
            { id: 'title', icon: '🎖️', label: '稱號系統' },
            { id: 'attribute', icon: '📉', label: '屬性面板' },
            { id: 'level', icon: '⬆️', label: '等級制度' },
            { id: 'exp', icon: '💠', label: '經驗值' },
            { id: 'points', icon: '🔵', label: '點數分配' },
            { id: 'mall', icon: '🏬', label: '積分商城' },
            { id: 'daily', icon: '📅', label: '每日簽到' },
            { id: 'synthesis', icon: '🔧', label: '合成系統' },
            { id: 'gacha', icon: '🎁', label: '抽卡/召喚' },
            { id: 'binding', icon: '🔗', label: '綁定/認主' },
            { id: 'ranking-sys', icon: '📊', label: '排行榜系統' },
          ]
        },
        {
          name: '穿越重生',
          icon: '🔄',
          items: [
            { id: 'bookWorld', icon: '📖', label: '穿書/穿劇' },
            { id: 'soulSwap', icon: '👻', label: '靈魂互換' },
            { id: 'regression', icon: '⏪', label: '回檔重來' },
            { id: 'dream', icon: '💭', label: '夢境穿越' },
            { id: 'summon', icon: '🌀', label: '被召喚' },
            { id: 'possession', icon: '👤', label: '奪舍附身' },
            { id: 'infant', icon: '👒', label: '胎穿/幼年' },
            { id: 'memory-awaken', icon: '💡', label: '記憶覺醒' },
            { id: 'worldline-shift', icon: '🌿', label: '世界線偏移' },
            { id: 'plot-fix', icon: '✏️', label: '劇情修正' },
            { id: 'butterfly-effect', icon: '🦋', label: '蝴蝶效應' },
            { id: 'karma-backlash', icon: '⚡', label: '因果反噬' },
            { id: 'fate-rewrite', icon: '📜', label: '命運改寫' },
            { id: 'timeline-merge', icon: '🔀', label: '時間線合併' },
            { id: 'prophecy-break', icon: '💥', label: '打破預言' },
          ]
        },
        {
          name: '感情線',
          icon: '💕',
          items: [
            { id: 'firstLove', icon: '🌸', label: '初戀情懷' },
            { id: 'jealousy', icon: '😤', label: '吃醋情節' },
            { id: 'love-hate', icon: '💢💕', label: '愛恨糾葛' },
            { id: 'secret-love', icon: '🤫💕', label: '隱婚/秘戀' },
            { id: 'redemption-love', icon: '🕊️💕', label: '救贖之戀' },
            { id: 'triangle', icon: '🔺', label: '三角戀' },
            { id: 'double', icon: '👫👫', label: '雙CP線' },
            { id: 'age-gap', icon: '👴👧', label: '年齡差' },
            { id: 'master-disciple', icon: '👨‍🏫💕', label: '師徒戀' },
            { id: 'boss-employee', icon: '👔💕', label: '上下級戀愛' },
            { id: 'rival-love', icon: '🤝💕', label: '宿敵變愛人' },
            { id: 'pet-love', icon: '🐾💕', label: '人外/獸人戀' },
            { id: 'reincarnation-love', icon: '🔄💕', label: '前世今生戀' },
          ]
        },
        {
          name: '主角類型',
          icon: '🦸',
          items: [
            { id: 'underdog', icon: '🐕', label: '廢柴逆襲' },
            { id: 'villain', icon: '😈', label: '反派主角' },
            { id: 'healer', icon: '💚', label: '輔助/奶媽' },
            { id: 'strategist', icon: '🧠', label: '智謀型' },
            { id: 'salted', icon: '🧂', label: '鹹魚躺平' },
            { id: 'lucky', icon: '🍀', label: '歐皇運氣' },
            { id: 'hardworking', icon: '💦', label: '努力型' },
            { id: 'cold', icon: '🧊', label: '高冷禁慾' },
            { id: 'sunny', icon: '☀️', label: '陽光開朗' },
            { id: 'dark', icon: '🌑', label: '黑化主角' },
            { id: 'dual', icon: '🎭', label: '雙重人格' },
            { id: 'genius', icon: '🧒', label: '天才少年' },
            { id: 'veteran', icon: '👴', label: '老謀深算' },
            { id: 'naive', icon: '😇', label: '天真單純' },
            { id: 'schemer', icon: '🦊', label: '腹黑心機' },
            { id: 'tsundere', icon: '😤', label: '傲嬌主角' },
            { id: 'yandere', icon: '🔪💕', label: '病嬌主角' },
            { id: 'chuuni', icon: '✨', label: '中二主角' },
            { id: 'mob-face', icon: '👤', label: '路人臉主角' },
            { id: 'anti-hero', icon: '🦇', label: '反英雄' },
            { id: 'reluctant', icon: '😩', label: '被迫營業型' },
          ]
        },
        {
          name: '劇情元素',
          icon: '📜',
          items: [
            { id: 'conspiracy', icon: '🕸️', label: '陰謀詭計' },
            { id: 'puzzle', icon: '🧩', label: '解謎探險' },
            { id: 'mystery', icon: '🔮', label: '神秘力量' },
            { id: 'prophecy', icon: '📜', label: '預言/天命' },
            { id: 'secret', icon: '🤫', label: '身世之謎' },
            { id: 'betrayal', icon: '🗡️', label: '背叛反轉' },
            { id: 'redemption', icon: '🕊️', label: '救贖' },
            { id: 'comeback', icon: '🔙', label: '絕地反擊' },
            { id: 'inheritance', icon: '📿', label: '遺跡傳承' },
            { id: 'treasure', icon: '💎', label: '尋寶奪寶' },
            { id: 'escape', icon: '🏃', label: '逃亡追殺' },
            { id: 'rescue', icon: '🆘', label: '營救任務' },
            { id: 'trial', icon: '⚖️', label: '試煉考驗' },
            { id: 'awakening', icon: '👁️', label: '覺醒劇情' },
            { id: 'disguise', icon: '🎭', label: '偽裝臥底' },
            { id: 'investigation', icon: '🔍', label: '調查真相' },
            { id: 'misunderstanding', icon: '❓', label: '誤會劇情' },
            { id: 'pretend', icon: '💑', label: '假戲真做' },
            { id: 'sacrifice', icon: '🕯️', label: '犧牲奉獻' },
            { id: 'reunion-plot', icon: '🤝', label: '重逢相認' },
          ]
        },
        {
          name: '世界觀',
          icon: '🌍',
          items: [
            { id: 'magic', icon: '🪄', label: '魔法體系' },
            { id: 'technology', icon: '🤖', label: '科技未來' },
            { id: 'western', icon: '🏰', label: '西方奇幻' },
            { id: 'eastern', icon: '🏯', label: '東方玄幻' },
            { id: 'hybrid', icon: '🔀', label: '混合世界觀' },
            { id: 'fairy', icon: '🧚', label: '童話世界' },
          ]
        },
        {
          name: '場景設定',
          icon: '🏛️',
          items: [
            { id: 'school', icon: '🏫', label: '學院/門派' },
            { id: 'kingdom', icon: '👑', label: '王國建設' },
            { id: 'tower', icon: '🗼', label: '爬塔/登頂' },
            { id: 'guild', icon: '🏠', label: '公會經營' },
            { id: 'arena', icon: '🏟️', label: '競技場' },
            { id: 'auction', icon: '🔨', label: '拍賣會' },
            { id: 'secretRealm', icon: '🌀', label: '秘境探索' },
            { id: 'sect', icon: '⛩️', label: '宗門大派' },
            { id: 'city', icon: '🌆', label: '都市叢林' },
            { id: 'village', icon: '🏘️', label: '鄉村小鎮' },
            { id: 'forest', icon: '🌲', label: '森林荒野' },
            { id: 'sky', icon: '☁️', label: '天空浮島' },
            { id: 'underground', icon: '🕳️', label: '地下世界' },
            { id: 'ancient-ruins', icon: '🏚️', label: '古代遺跡' },
            { id: 'hospital', icon: '🏥', label: '醫院診所' },
            { id: 'prison', icon: '🔒', label: '監獄囚籠' },
            { id: 'casino', icon: '🎰', label: '賭場娛樂城' },
          ]
        },
        {
          name: '生活元素',
          icon: '🏡',
          items: [
            { id: 'craft', icon: '🔨', label: '鍛造/煉丹' },
            { id: 'healing', icon: '🌿', label: '治癒日常' },
            { id: 'travel', icon: '🗺️', label: '旅行冒險' },
            { id: 'collection', icon: '📦', label: '收集癖' },
            { id: 'decoration', icon: '🏠', label: '裝飾佈置' },
            { id: 'fashion', icon: '👗', label: '服裝設計' },
            { id: 'medicine', icon: '💊', label: '醫術醫道' },
            { id: 'teaching', icon: '📚', label: '教書育人' },
            { id: 'fishing', icon: '🎣', label: '釣魚養殖' },
            { id: 'garden', icon: '🌷', label: '園藝花卉' },
            { id: 'tea', icon: '🍵', label: '茶道雅事' },
            { id: 'writing', icon: '✍️', label: '著書立傳' },
            { id: 'cooking', icon: '👨‍🍳', label: '廚藝烹飪' },
            { id: 'painting', icon: '🎨', label: '繪畫藝術' },
            { id: 'dance', icon: '💃', label: '舞蹈表演' },
            { id: 'sports', icon: '⚽', label: '體育運動' },
            { id: 'gambling', icon: '🎲', label: '賭博博弈' },
          ]
        },
        {
          name: '競爭對抗',
          icon: '⚔️',
          items: [
            { id: 'faction', icon: '⚔️', label: '陣營對立' },
            { id: 'competition', icon: '🏆', label: '比賽競技' },
            { id: 'politics', icon: '🏛️', label: '權謀政治' },
            { id: 'family', icon: '👨‍👩‍👧', label: '家族興衰' },
            { id: 'heist', icon: '🎭', label: '盜賊詐騙' },
            { id: 'survival', icon: '🏕️', label: '生存淘汰' },
            { id: 'ranking', icon: '📊', label: '排行榜戰' },
            { id: 'territory', icon: '🗺️', label: '地盤爭奪' },
            { id: 'resources', icon: '⛏️', label: '資源掠奪' },
            { id: 'throne', icon: '👑', label: '奪嫡爭位' },
            { id: 'spy', icon: '🕵️', label: '間諜潛伏' },
            { id: 'assassination', icon: '🗡️', label: '刺殺暗殺' },
            { id: 'rebellion', icon: '✊', label: '起義造反' },
            { id: 'gang-war', icon: '🔫', label: '黑幫火拼' },
            { id: 'idol-battle', icon: '🎤', label: '偶像競爭' },
            { id: 'school-rivalry', icon: '🏫', label: '校園對立' },
            { id: 'dimension-war', icon: '🌌', label: '位面戰爭' },
          ]
        },
        {
          name: '特殊能力',
          icon: '🌟',
          items: [
            { id: 'eye', icon: '👁️', label: '特殊眼睛' },
            { id: 'bloodline', icon: '🩸', label: '血脈覺醒' },
            { id: 'contract', icon: '📜', label: '契約召喚' },
            { id: 'transformation', icon: '🦋', label: '變身/化形' },
            { id: 'mind', icon: '🧠', label: '讀心/心靈' },
            { id: 'element', icon: '🔥💧', label: '元素操控' },
            { id: 'time', icon: '⏳', label: '時間能力' },
            { id: 'space', icon: '🌀', label: '空間能力' },
            { id: 'gravity', icon: '🌍', label: '重力操控' },
            { id: 'illusion', icon: '🎪', label: '幻術/幻象' },
            { id: 'poison', icon: '☠️', label: '毒術用毒' },
            { id: 'necro', icon: '💀', label: '亡靈死靈' },
            { id: 'holy', icon: '😇', label: '神聖光明' },
            { id: 'dark-power', icon: '🌑', label: '黑暗力量' },
            { id: 'beast', icon: '🐺', label: '獸化野性' },
            { id: 'copy', icon: '📋', label: '複製能力' },
            { id: 'prediction', icon: '🔮', label: '預知未來' },
            { id: 'healing-power', icon: '💚', label: '治癒能力' },
            { id: 'luck-power', icon: '🍀', label: '氣運加持' },
            { id: 'charm', icon: '💋', label: '魅惑能力' },
            { id: 'domination', icon: '👑', label: '支配霸氣' },
            { id: 'creation', icon: '🌟', label: '創造能力' },
          ]
        },
        {
          name: '身份職業',
          icon: '👔',
          items: [
            { id: 'prince', icon: '🤴', label: '王子公主' },
            { id: 'assassin', icon: '🗡️', label: '殺手刺客' },
            { id: 'merchant', icon: '💼', label: '商人富豪' },
            { id: 'knight', icon: '⚔️', label: '騎士勇者' },
            { id: 'mage', icon: '🧙', label: '法師魔法師' },
            { id: 'thief', icon: '🦹', label: '盜賊俠盜' },
            { id: 'priest', icon: '⛪', label: '神官祭司' },
            { id: 'hunter', icon: '🏹', label: '獵人獵魔' },
            { id: 'chef', icon: '👨‍🍳', label: '廚師美食家' },
            { id: 'doctor', icon: '👨‍⚕️', label: '醫生藥師' },
            { id: 'teacher', icon: '👨‍🏫', label: '老師導師' },
            { id: 'emperor', icon: '👑', label: '帝王皇帝' },
            { id: 'slave', icon: '⛓️', label: '奴隸囚徒' },
            { id: 'orphan', icon: '🥺', label: '孤兒棄子' },
            { id: 'noble', icon: '🎩', label: '貴族世家' },
            { id: 'commoner', icon: '👤', label: '平民百姓' },
            { id: 'idol', icon: '🎤', label: '偶像明星' },
            { id: 'programmer', icon: '💻', label: '程序員/駭客' },
            { id: 'detective', icon: '🔍', label: '偵探警探' },
            { id: 'soldier', icon: '🎖️', label: '軍人士兵' },
            { id: 'pirate', icon: '🏴‍☠️', label: '海盜船長' },
            { id: 'necromancer', icon: '💀', label: '死靈法師' },
          ]
        },
        {
          name: '特殊設定',
          icon: '🎲',
          items: [
            { id: 'nonHuman', icon: '🧝', label: '非人種族' },
            { id: 'immortal', icon: '♾️', label: '不死永生' },
            { id: 'reincarnator', icon: '🔁', label: '多周目' },
            { id: 'reader', icon: '📖', label: '原著黨' },
            { id: 'cannon', icon: '💥', label: '炮灰求生' },
            { id: 'sickly', icon: '🤒', label: '病弱體質' },
            { id: 'amnesia', icon: '❓', label: '失憶設定' },
            { id: 'mute', icon: '🤐', label: '啞巴/失聲' },
            { id: 'blind', icon: '👓', label: '盲人設定' },
            { id: 'curse', icon: '🔮', label: '詛咒纏身' },
            { id: 'seal', icon: '🔒', label: '封印解封' },
            { id: 'clone', icon: '👥', label: '分身/複製體' },
            { id: 'hybrid-race', icon: '🧬', label: '混血兒' },
            { id: 'gender', icon: '⚧️', label: '性轉設定' },
            { id: 'age', icon: '👶👴', label: '年齡變化' },
            { id: 'possessed', icon: '👻', label: '被附身' },
            { id: 'shared-body', icon: '🔄', label: '共用身體' },
            { id: 'invisible', icon: '👁️‍🗨️', label: '隱形人' },
            { id: 'miniature', icon: '🐜', label: '縮小變大' },
            { id: 'multiple-lives', icon: '💜', label: '多條命' },
            { id: 'deadline', icon: '⏰', label: '倒計時設定' },
          ]
        },
        {
          name: '種族設定',
          icon: '🧬',
          items: [
            { id: 'elf', icon: '🧝', label: '精靈族' },
            { id: 'dwarf', icon: '⛏️', label: '矮人族' },
            { id: 'dragon', icon: '🐉', label: '龍族' },
            { id: 'vampire', icon: '🧛', label: '吸血鬼' },
            { id: 'werewolf', icon: '🐺', label: '狼人' },
            { id: 'demon-race', icon: '👹', label: '魔族惡魔' },
            { id: 'angel', icon: '😇', label: '天使族' },
            { id: 'beastman', icon: '🦁', label: '獸人族' },
            { id: 'mermaid', icon: '🧜', label: '人魚族' },
            { id: 'ghost', icon: '👻', label: '幽靈亡靈' },
            { id: 'sprite', icon: '✨', label: '精靈/妖精' },
            { id: 'goblin', icon: '👺', label: '哥布林' },
            { id: 'orc', icon: '👹', label: '獸人/半獸人' },
            { id: 'android', icon: '🤖', label: '機器人/仿生人' },
            { id: 'alien', icon: '👽', label: '外星種族' },
            { id: 'deity', icon: '🌟', label: '神族' },
            { id: 'half-elf', icon: '🧝‍♀️', label: '半精靈族' },
            { id: 'dragonkin', icon: '🐲', label: '龍人族' },
            { id: 'insectoid', icon: '🐛', label: '蟲族' },
            { id: 'plant-folk', icon: '🌿', label: '植物族' },
            { id: 'stellar-spirit', icon: '✨', label: '星靈族' },
            { id: 'slime-folk', icon: '🫧', label: '史萊姆族' },
          ]
        },
        {
          name: '現代職場',
          icon: '🏢',
          items: [
            { id: 'secretary', icon: '📋', label: '秘書助理' },
            { id: 'lawyer', icon: '⚖️', label: '律師法官' },
            { id: 'journalist', icon: '📰', label: '記者編輯' },
            { id: 'designer', icon: '🎨', label: '設計師' },
            { id: 'model', icon: '📸', label: '模特兒' },
            { id: 'athlete', icon: '🏃', label: '運動員' },
            { id: 'scientist', icon: '🔬', label: '科學家' },
            { id: 'pilot', icon: '✈️', label: '飛行員' },
            { id: 'firefighter', icon: '🚒', label: '消防員' },
            { id: 'chef-modern', icon: '👨‍🍳', label: '主廚' },
            { id: 'baker', icon: '🥖', label: '烘焙師' },
            { id: 'barista', icon: '☕', label: '咖啡師' },
            { id: 'bartender', icon: '🍸', label: '調酒師' },
            { id: 'youtuber', icon: '📱', label: 'YouTuber' },
            { id: 'writer-modern', icon: '✍️', label: '作家編劇' },
          ]
        },
        {
          name: '情境模式',
          icon: '🎬',
          items: [
            { id: 'escape-room', icon: '🚪', label: '密室逃脫' },
            { id: 'battle-royale', icon: '🏆', label: '大逃殺' },
            { id: 'deserted-island', icon: '🏝️', label: '荒島求生' },
            { id: 'treasure-hunt', icon: '🗺️', label: '尋寶遊戲' },
            { id: 'murder-mystery', icon: '🔪', label: '謀殺之謎' },
            { id: 'dating-sim', icon: '💕', label: '戀愛遊戲' },
            { id: 'idol-raising', icon: '🌟', label: '偶像養成' },
            { id: 'cooking-battle', icon: '🍳', label: '料理對決' },
            { id: 'music-competition', icon: '🎵', label: '音樂競賽' },
            { id: 'fashion-show', icon: '👗', label: '時裝秀' },
            { id: 'reality-show', icon: '📺', label: '真人秀' },
            { id: 'talent-show', icon: '🎭', label: '選秀節目' },
            { id: 'game-show', icon: '🎮', label: '遊戲節目' },
          ]
        },
        {
          name: '網路時代',
          icon: '🌐',
          items: [
            { id: 'live-reward', icon: '💰', label: '直播打賞' },
            { id: 'barrage', icon: '💬', label: '彈幕互動' },
            { id: 'viral-post', icon: '🔥', label: '論壇神帖' },
            { id: 'opinion-war', icon: '📢', label: '輿論戰' },
            { id: 'doxxing', icon: '🔎', label: '人肉搜索' },
            { id: 'flame-war', icon: '🔥', label: '炎上/網暴' },
            { id: 'vtuber', icon: '🎙️', label: '虛擬主播' },
            { id: 'metaverse', icon: '🕶️', label: '元宇宙' },
            { id: 'deepfake', icon: '🎭', label: 'AI換臉' },
            { id: 'big-data', icon: '📡', label: '大數據監控' },
            { id: 'influencer', icon: '📱', label: '網紅經濟' },
            { id: 'trending', icon: '📈', label: '熱搜霸榜' },
            { id: 'algo-feed', icon: '📊', label: '演算法推薦' },
            { id: 'digital-legacy', icon: '💾', label: '數位遺產' },
            { id: 'cyber-stalking', icon: '👁️', label: '賽博跟蹤' },
            { id: 'anon-forum', icon: '🕳️', label: '匿名論壇' },
            { id: 'ai-hallucination', icon: '🤖', label: 'AI幻覺' },
            { id: 'crypto-scam', icon: '₿', label: '加密詐騙' },
            { id: 'podcast-drama', icon: '🎙️', label: '播客風波' },
            { id: 'meme-war', icon: '😂', label: '迷因大戰' },
          ]
        },
        {
          name: '經營養成',
          icon: '🏗️',
          items: [
            { id: 'recruit', icon: '🤝', label: '招募人才' },
            { id: 'internal-affairs', icon: '📜', label: '內政經營' },
            { id: 'diplomacy', icon: '🕊️', label: '外交結盟' },
            { id: 'reputation', icon: '⭐', label: '聲望系統' },
            { id: 'territory-expand', icon: '🗺️', label: '領土擴張' },
            { id: 'resource-mgmt', icon: '⛏️', label: '資源管理' },
            { id: 'train-successor', icon: '🎓', label: '培養接班' },
            { id: 'gather-talent', icon: '🌟', label: '廣納賢才' },
            { id: 'morale-system', icon: '😊', label: '士氣系統' },
            { id: 'morale-collapse', icon: '😰', label: '士氣崩潰' },
            { id: 'supply-chain', icon: '🚚', label: '供應鏈' },
            { id: 'season-event', icon: '🍂', label: '季節事件' },
            { id: 'public-support', icon: '👥', label: '民心系統' },
            { id: 'tax-reform', icon: '💰', label: '稅制改革' },
            { id: 'disaster-relief', icon: '🆘', label: '災害應對' },
            { id: 'trade-route', icon: '🛤️', label: '商路開拓' },
          ]
        },
        {
          name: '伏筆懸念',
          icon: '🪝',
          items: [
            { id: 'foreshadowing', icon: '🌱', label: '伏筆鋪陳' },
            { id: 'red-herring', icon: '🐟', label: '誤導線索' },
            { id: 'chekhov-gun', icon: '🔫', label: '契訶夫之槍' },
            { id: 'mega-twist', icon: '🌀', label: '神級反轉' },
            { id: 'cliffhanger', icon: '⛰️', label: '章末懸念' },
            { id: 'unreliable-clue', icon: '❓', label: '不可靠線索' },
            { id: 'identity-reveal', icon: '🎭', label: '身份揭露' },
            { id: 'countdown', icon: '⏰', label: '倒數危機' },
            { id: 'macguffin', icon: '📦', label: '麥高芬' },
            { id: 'delayed-revenge', icon: '⏳', label: '延遲復仇' },
            { id: 'double-twist', icon: '🔄', label: '雙重反轉' },
            { id: 'unreliable-narrator-hint', icon: '📖', label: '敘述性詭計' },
            { id: 'planted-evidence', icon: '🔍', label: '栽贓線索' },
            { id: 'false-protagonist', icon: '🎭', label: '假主角' },
            { id: 'hidden-ally', icon: '🤝', label: '隱藏盟友' },
            { id: 'slow-reveal', icon: '🌫️', label: '漸進揭露' },
            { id: 'breadcrumb-trail', icon: '🍞', label: '麵包屑線索' },
            { id: 'nested-mystery', icon: '🪆', label: '嵌套謎團' },
          ]
        },
        {
          name: '人際糾葛',
          icon: '🤼',
          items: [
            { id: 'mentor-betrayal', icon: '⚔️', label: '師徒反目' },
            { id: 'blood-feud', icon: '🩸', label: '血親世仇' },
            { id: 'sworn-brothers', icon: '🤝', label: '義結金蘭' },
            { id: 'best-friend-turn', icon: '💔', label: '摯友決裂' },
            { id: 'debt-of-life', icon: '🙏', label: '救命之恩' },
            { id: 'grudge-chain', icon: '⛓️', label: '連環仇怨' },
            { id: 'sibling-rivalry', icon: '👫', label: '手足相爭' },
            { id: 'master-apprentice', icon: '👨‍🏫', label: '師徒情深' },
            { id: 'loyalty-test', icon: '🛡️', label: '忠誠試煉' },
            { id: 'proxy-grudge', icon: '🎯', label: '代際仇恨' },
            { id: 'debt-trap', icon: '💳', label: '人情債務' },
            { id: 'estranged-family', icon: '🏚️', label: '疏離親情' },
            { id: 'protector-bond', icon: '🛡️', label: '守護之約' },
            { id: 'rival-respect', icon: '🤜', label: '宿敵相惜' },
            { id: 'betrayed-trust', icon: '🗡️', label: '信任背叛' },
            { id: 'found-family', icon: '🏠', label: '非血緣家人' },
            { id: 'clan-duty', icon: '🏯', label: '宗族責任' },
            { id: 'mentor-sacrifice', icon: '🕯️', label: '師長犧牲' },
          ]
        },
        {
          name: '道德困境',
          icon: '⚖️',
          items: [
            { id: 'trolley', icon: '🚃', label: '兩難抉擇' },
            { id: 'lesser-evil', icon: '😈', label: '兩害相權' },
            { id: 'vigilante', icon: '🦸', label: '私刑正義' },
            { id: 'white-lie', icon: '🤥', label: '善意謊言' },
            { id: 'hostage-trade', icon: '🔁', label: '人質交換' },
            { id: 'sacrifice-one', icon: '☝️', label: '犧牲少數' },
            { id: 'ends-justify', icon: '🎯', label: '目的正當化' },
            { id: 'dirty-hands', icon: '🖐️', label: '雙手染血' },
            { id: 'mercy-kill', icon: '💉', label: '安樂抉擇' },
            { id: 'whistleblower', icon: '📢', label: '吹哨告密' },
            { id: 'loyalty-vs-justice', icon: '⚖️', label: '忠義兩難' },
            { id: 'forgive-enemy', icon: '🕊️', label: '原諒仇敵' },
            { id: 'obey-immoral-order', icon: '📜', label: '服從惡令' },
            { id: 'truth-vs-harm', icon: '💬', label: '真相傷人' },
            { id: 'resource-ration', icon: '🍞', label: '資源分配' },
            { id: 'collateral-damage', icon: '💥', label: '附帶傷害' },
          ]
        },
        {
          name: '規則怪談',
          icon: '📋',
          items: [
            { id: 'midnight-taboo', icon: '🌙', label: '午夜禁忌' },
            { id: 'no-look-back', icon: '🚫', label: '不可回頭' },
            { id: 'stair-count', icon: '🪜', label: '數樓梯' },
            { id: 'smile-detect', icon: '😊', label: '笑臉辨識' },
            { id: 'wrong-floor', icon: '🏢', label: '錯層樓' },
            { id: 'mirror-rule', icon: '🪞', label: '鏡中規則' },
            { id: 'red-light-green', icon: '🚦', label: '紅綠燈遊戲' },
            { id: 'dont-answer', icon: '📞', label: '不可接聽' },
            { id: 'count-sheep', icon: '🐑', label: '數羊陷阱' },
            { id: 'empty-seat', icon: '💺', label: '空位勿坐' },
            { id: 'photo-taboo', icon: '📷', label: '拍照禁忌' },
            { id: 'name-call', icon: '📛', label: '直呼其名' },
            { id: 'door-knock', icon: '🚪', label: '敲門次數' },
            { id: 'elevator-ride', icon: '🛗', label: '電梯規則' },
            { id: 'school-handbook', icon: '📕', label: '校規手冊' },
            { id: 'survival-manual', icon: '📖', label: '生存手冊' },
            { id: 'rule-update', icon: '🔄', label: '規則更新' },
            { id: 'rule-conflict', icon: '⚠️', label: '規則衝突' },
          ]
        },
        {
          name: '反差喜劇',
          icon: '🤣',
          items: [
            { id: 'roast-narrator', icon: '🎤', label: '吐槽旁白' },
            { id: 'social-death', icon: '😱', label: '社死現場' },
            { id: 'misunderstand-chain', icon: '🔗', label: '烏龍連環' },
            { id: 'dense-protagonist', icon: '🤔', label: '遲鈍主角' },
            { id: 'lucky-misfire', icon: '🍀', label: '烏龍逆襲' },
            { id: 'overpowered-comedy', icon: '💪', label: '強到好笑' },
            { id: 'serious-fail', icon: '🎭', label: '嚴肅翻車' },
            { id: 'prop-fail', icon: '🎪', label: '道具烏龍' },
            { id: 'wrong-person', icon: '👤', label: '認錯人' },
            { id: 'eavesdrop-fail', icon: '👂', label: '偷聽誤會' },
            { id: 'dramatic-pause', icon: '⏸️', label: '尷尬冷場' },
            { id: 'npc-break', icon: '🧱', label: '打破第四牆' },
            { id: 'clumsy-hero', icon: '🤕', label: '笨手笨腳' },
            { id: 'overreaction', icon: '😤', label: '反應過度' },
            { id: 'comedy-timing', icon: '⏱️', label: '喜劇時機' },
            { id: 'absurd-logic', icon: '🌀', label: '荒謬邏輯' },
          ]
        },
        {
          name: '秘密組織',
          icon: '🕵️',
          items: [
            { id: 'shadow-council', icon: '🌑', label: '影子議會' },
            { id: 'underground-guild', icon: '🕳️', label: '地下公會' },
            { id: 'informant-web', icon: '🕸️', label: '情報網' },
            { id: 'sleeper-agent', icon: '😴', label: '沉睡間諜' },
            { id: 'black-market', icon: '🏴', label: '黑市樞紐' },
            { id: 'secret-society', icon: '🔺', label: '秘密結社' },
            { id: 'assassin-guild', icon: '🗡️', label: '殺手公會' },
            { id: 'resistance-cell', icon: '✊', label: '地下抵抗' },
            { id: 'cult-inner', icon: '🕯️', label: '邪教內圈' },
            { id: 'spy-ring', icon: '💍', label: '諜報網' },
            { id: 'hidden-order', icon: '📿', label: '隱世宗門' },
            { id: 'mercenary-corp', icon: '⚔️', label: '傭兵集團' },
            { id: 'smuggler-net', icon: '📦', label: '走私網絡' },
            { id: 'watchers', icon: '👁️', label: '守望者組織' },
            { id: 'archive-bureau', icon: '📁', label: '機密檔案局' },
            { id: 'double-agency', icon: '🎭', label: '雙面間諜網' },
          ]
        },
        {
          name: '成長蛻變',
          icon: '🦋',
          items: [
            { id: 'let-go-obsession', icon: '🕊️', label: '放下執念' },
            { id: 'learn-trust', icon: '🤝', label: '學會信任' },
            { id: 'accept-past', icon: '📜', label: '接納過去' },
            { id: 'forgive-self', icon: '💚', label: '原諒自己' },
            { id: 'mentor-legacy', icon: '🌟', label: '傳承意志' },
            { id: 'overcome-fear', icon: '😨', label: '克服恐懼' },
            { id: 'humble-pride', icon: '🙇', label: '放下傲慢' },
            { id: 'find-purpose', icon: '🧭', label: '找到使命' },
            { id: 'mature-choice', icon: '🌱', label: '成熟抉擇' },
            { id: 'break-cycle', icon: '🔓', label: '打破循環' },
            { id: 'self-worth', icon: '💎', label: '自我價值' },
            { id: 'empathy-gain', icon: '❤️', label: '學會共情' },
            { id: 'leadership-grow', icon: '👑', label: '領袖成長' },
            { id: 'accept-loss', icon: '🍂', label: '接受失去' },
            { id: 'redefine-success', icon: '🏆', label: '重新定義成功' },
            { id: 'inner-peace', icon: '☯️', label: '內心平靜' },
          ]
        },
        {
          name: '神器法寶',
          icon: '⚔️',
          items: [
            { id: 'weapon-bond', icon: '🗡️', label: '認主神器' },
            { id: 'cursed-blade', icon: '☠️', label: '詛咒之刃' },
            { id: 'sealed-power', icon: '🔒', label: '封印解放' },
            { id: 'living-weapon', icon: '🐉', label: '活體兵器' },
            { id: 'soul-vessel', icon: '💎', label: '寄魂法器' },
            { id: 'legendary-armor', icon: '🛡️', label: '傳說甲冑' },
            { id: 'artifact-hunt', icon: '🗺️', label: '神器追尋' },
            { id: 'broken-relic', icon: '💔', label: '破碎聖物' },
            { id: 'forbidden-tome', icon: '📕', label: '禁書秘典' },
            { id: 'pocket-dimension', icon: '🎒', label: '次元袋' },
            { id: 'sentient-item', icon: '💬', label: '有靈道具' },
            { id: 'upgrade-weapon', icon: '⬆️', label: '兵器進化' },
            { id: 'dual-wield-artifact', icon: '⚔️', label: '雙神器' },
            { id: 'sacrifice-weapon', icon: '🩸', label: '血祭開刃' },
            { id: 'lost-artifact', icon: '❓', label: '失落神器' },
            { id: 'counter-artifact', icon: '🔄', label: '克制法寶' },
          ]
        },
        {
          name: '儀式禁忌',
          icon: '🕯️',
          items: [
            { id: 'blood-oath', icon: '🩸', label: '血誓' },
            { id: 'naming-taboo', icon: '📛', label: '真名禁忌' },
            { id: 'sacrifice-rite', icon: '🔥', label: '獻祭儀式' },
            { id: 'contract-soul', icon: '📜', label: '靈魂契約' },
            { id: 'breaking-taboo', icon: '💥', label: '破禁代價' },
            { id: 'summoning-circle', icon: '⭕', label: '召喚法陣' },
            { id: 'purification-rite', icon: '💧', label: '淨化儀式' },
            { id: 'binding-ceremony', icon: '🔗', label: '束縛典禮' },
            { id: 'ancestral-rite', icon: '🏛️', label: '祭祖儀式' },
            { id: 'forbidden-rite', icon: '🚫', label: '禁術儀式' },
            { id: 'bloodline-awaken-rite', icon: '🌅', label: '血脈覺醒儀' },
            { id: 'seal-breaking-rite', icon: '🔓', label: '解封儀式' },
            { id: 'oath-punishment', icon: '⚡', label: '違誓懲罰' },
            { id: 'moon-ritual', icon: '🌕', label: '月相儀式' },
            { id: 'death-rite', icon: '💀', label: '送葬儀式' },
            { id: 'initiation-trial', icon: '🎓', label: '入門試煉' },
          ]
        },
        {
          name: '心理博弈',
          icon: '🧠',
          items: [
            { id: 'gaslight', icon: '💡', label: '煤氣燈效應' },
            { id: 'interrogation', icon: '🪑', label: '審訊心理戰' },
            { id: 'bluff-chain', icon: '🃏', label: '虛張連環' },
            { id: 'trust-test', icon: '🧪', label: '信任試探' },
            { id: 'memory-implant', icon: '💉', label: '記憶植入' },
            { id: 'mind-game', icon: '♟️', label: '心理棋局' },
            { id: 'reverse-psych', icon: '🔄', label: '反心理戰' },
            { id: 'guilt-trip', icon: '😔', label: '罪惡感操控' },
            { id: 'false-confession', icon: '📝', label: '假供詞' },
            { id: 'split-personality-trap', icon: '🎭', label: '人格陷阱' },
            { id: 'emotional-blackmail', icon: '🖤', label: '情感勒索' },
            { id: 'cognitive-dissonance', icon: '🌀', label: '認知失調' },
            { id: 'prisoner-dilemma', icon: '🔒', label: '囚徒困境' },
            { id: 'information-war', icon: '📡', label: '資訊戰' },
            { id: 'profile-target', icon: '🎯', label: '弱點剖析' },
            { id: 'break-will', icon: '💔', label: '意志擊潰' },
          ]
        },
        {
          name: '身分偽裝',
          icon: '🎭',
          items: [
            { id: 'fake-death', icon: '⚰️', label: '假死脫身' },
            { id: 'deep-cover', icon: '🕵️', label: '長期臥底' },
            { id: 'body-double', icon: '👥', label: '替身' },
            { id: 'gender-disguise', icon: '👗', label: '女扮男裝' },
            { id: 'noble-incognito', icon: '🎩', label: '微服私訪' },
            { id: 'false-identity', icon: '🪪', label: '假身分證' },
            { id: 'undercover-mission', icon: '📋', label: '臥底任務' },
            { id: 'stolen-face', icon: '🎭', label: '盜用容貌' },
            { id: 'alias-life', icon: '📛', label: '化名生活' },
            { id: 'impersonate-official', icon: '🏛️', label: '冒充官吏' },
            { id: 'witness-protection', icon: '🛡️', label: '證人保護' },
            { id: 'mask-reveal', icon: '🎪', label: '面具揭曉' },
            { id: 'double-life', icon: '🌓', label: '雙面人生' },
            { id: 'infiltrate-enemy', icon: '🏴', label: '潛入敵營' },
            { id: 'fake-marriage', icon: '💒', label: '假結婚' },
            { id: 'identity-theft', icon: '🆔', label: '身分盜用' },
          ]
        },
        {
          name: '委託任務',
          icon: '📜',
          items: [
            { id: 'bounty-board', icon: '📌', label: '懸賞榜' },
            { id: 'escort-mission', icon: '🛡️', label: '護送任務' },
            { id: 'timed-quest', icon: '⏰', label: '限時委託' },
            { id: 'chain-quest', icon: '🔗', label: '連環委託' },
            { id: 'fail-penalty', icon: '❌', label: '失敗懲罰' },
            { id: 'mystery-commission', icon: '❓', label: '神秘委託' },
            { id: 'delivery-run', icon: '📦', label: '快遞任務' },
            { id: 'investigation-job', icon: '🔍', label: '調查委託' },
            { id: 'rescue-contract', icon: '🆘', label: '救援契約' },
            { id: 'assassination-contract', icon: '🗡️', label: '暗殺委託' },
            { id: 'gather-materials', icon: '🌿', label: '採集任務' },
            { id: 'dungeon-contract', icon: '🏰', label: '攻略委託' },
            { id: 'negotiation-mission', icon: '🤝', label: '談判任務' },
            { id: 'sabotage-job', icon: '💣', label: '破壞任務' },
            { id: 'relay-mission', icon: '🏃', label: '接力任務' },
            { id: 'hidden-objective', icon: '🎯', label: '隱藏目標' },
          ]
        },
        {
          name: '語言咒術',
          icon: '📖',
          items: [
            { id: 'true-name', icon: '📛', label: '真名束縛' },
            { id: 'forbidden-word', icon: '🚫', label: '禁語' },
            { id: 'oath-binding', icon: '📜', label: '誓言拘束' },
            { id: 'written-curse', icon: '✍️', label: '文字詛咒' },
            { id: 'song-magic', icon: '🎵', label: '歌詠術' },
            { id: 'rune-script', icon: '🔣', label: '符文咒文' },
            { id: 'verbal-contract', icon: '💬', label: '言靈契約' },
            { id: 'whisper-spell', icon: '👂', label: '低語咒術' },
            { id: 'name-steal', icon: '🎭', label: '竊取真名' },
            { id: 'prophecy-verse', icon: '📖', label: '預言詩句' },
            { id: 'command-word', icon: '👑', label: '命令言靈' },
            { id: 'silence-curse', icon: '🤐', label: '禁言詛咒' },
            { id: 'story-weave', icon: '🧵', label: '敘事編織' },
            { id: 'ancient-tongue', icon: '🏛️', label: '古語咒令' },
            { id: 'lie-detection-word', icon: '🔍', label: '測謊言靈' },
            { id: 'seal-incantation', icon: '🔒', label: '封印咒語' },
          ]
        }
      ];

      attachCategoryHints(specialElementCategories, categoryHintMaps.special);

      const specialElementMeta = new Map();
      specialElementCategories.forEach((cat) => {
        cat.items.forEach((item) => {
          specialElementMeta.set(item.id, {
            label: item.label,
            category: cat.name,
            hint: specialElementImpacts[item.id] || cat.hint || cat.name
          });
        });
      });

      function buildForbiddenSpecialLabels() {
        const advancedValues = [
          narrativeOptions, eraOptions, pacingOptions, ratingOptions,
          worldComplexityOptions, emotionalToneOptions, endingOptions
        ].flatMap(opts => opts.map(o => o.value));
        return new Set([
          ...themes, ...settingsData, ...stylesArr, ...advancedValues
        ]);
      }

      function validateSpecialElements(categories) {
        const forbidden = buildForbiddenSpecialLabels();
        const ids = new Set();
        const labels = new Set();
        const overlaps = [];
        const dupIds = [];
        const dupLabels = [];
        categories.forEach(cat => {
          cat.items.forEach(item => {
            if (forbidden.has(item.label)) overlaps.push(item);
            if (ids.has(item.id)) dupIds.push(item.id);
            if (labels.has(item.label)) dupLabels.push(item.label);
            ids.add(item.id);
            labels.add(item.label);
          });
        });
        if (overlaps.length) console.warn('[specialElements] 與故事/進階重疊:', overlaps);
        if (dupIds.length) console.error('[specialElements] 重複 id:', dupIds);
        if (dupLabels.length) console.error('[specialElements] 重複 label:', dupLabels);
      }
      validateSpecialElements(specialElementCategories);

      // 扁平化用於相容舊程式碼
      const specialElements = specialElementCategories.flatMap(cat => cat.items);

      function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
      }

      /** 隨機設定 7 項進階選項 */
      function randomizeAdvancedSettings() {
        if (!narrativeSelect) return;
        narrativeSelect.value = pickRandom(narrativeOptions).value;
        eraSelect.value = pickRandom(eraOptions).value;
        pacingSelect.value = pickRandom(pacingOptions).value;
        ratingSelect.value = pickRandom(ratingOptions).value;
        worldComplexitySelect.value = pickRandom(worldComplexityOptions).value;
        emotionalToneSelect.value = pickRandom(emotionalToneOptions).value;
        endingSelect.value = pickRandom(endingOptions).value;
        endingSelect.dispatchEvent(new Event('change', { bubbles: true }));
        saveSettingsToLocal();
      }

      // ==================== 人物設定 ====================
      function addCharacterRow(randomize = false) {
        const row = document.createElement('div');
        row.className = 'character-row';
        updateCharacterIndices();
        const index = charactersContainer.children.length + 1;
        row.innerHTML = `
          <div class="char-head">
            <span class="char-index">人物 ${index}</span>
            <select class="char-gender">
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="不明">不明</option>
            </select>
            <select class="char-role" title="角色定位（影響戲份輕重）">
              <option value="">定位</option>
              <option value="男主角">男主角</option>
              <option value="女主角">女主角</option>
              <option value="男配角">男配角</option>
              <option value="女配角">女配角</option>
              <option value="反派">反派</option>
              <option value="路人">路人</option>
            </select>
            <input type="text" class="char-age" placeholder="年齡" maxlength="12" inputmode="text" />
            <input type="text" class="char-name" placeholder="姓名" />
            <div class="char-actions">
              <button type="button" class="char-random-btn btn-outline btn-small" title="隨機此人物">🎲</button>
              <button type="button" class="char-ai-btn" title="用 AI 補完此人物">✨</button>
              <button type="button" class="char-remove-btn btn-outline btn-small" title="移除此人物">✕</button>
            </div>
          </div>
          <div class="char-fields">
            <label class="char-field"><span class="char-field-label">個性</span><input type="text" class="char-personality" placeholder="個性特質…" autocomplete="off" /></label>
            <label class="char-field"><span class="char-field-label">目標</span><input type="text" class="char-goal" placeholder="想達成的目標…" autocomplete="off" /></label>
            <label class="char-field"><span class="char-field-label">弱點</span><input type="text" class="char-weakness" placeholder="致命弱點…" autocomplete="off" /></label>
            <label class="char-field"><span class="char-field-label">祕密</span><input type="text" class="char-secret" placeholder="不可告人的祕密…" autocomplete="off" /></label>
            <label class="char-field char-field-wide"><span class="char-field-label">人際</span><input type="text" class="char-relation" placeholder="與其他角色的關係…" autocomplete="off" /></label>
          </div>
        `;
        const randBtn = row.querySelector('.char-random-btn');
        randBtn.addEventListener('click', () => {
          randomizeRow(row, false);
          saveSettingsToLocal();
        });

        const aiBtn = row.querySelector('.char-ai-btn');
        aiBtn.addEventListener('click', () => {
          if (typeof aiCompleteCharacterRow === 'function') aiCompleteCharacterRow(row, aiBtn);
        });
        
        const removeBtn = row.querySelector('.char-remove-btn');
        removeBtn.addEventListener('click', () => {
          if (charactersContainer.children.length > 1) {
            const idx = Array.from(charactersContainer.children).indexOf(row);
            row.remove();
            updateCharacterIndices();
            renderCharacterTabs();
            setActiveCharacter(Math.min(idx, charactersContainer.children.length - 1));
            saveSettingsToLocal();
          } else {
            alert('至少需要保留一位人物！');
          }
        });
        
        // 監聽輸入變更以自動儲存，並同步 title 讓滑鼠懸停可看完整內容
        const saveDebounced = debounce(saveSettingsToLocal, 500);
        row.querySelectorAll('input, select').forEach(el => {
          el.addEventListener('change', saveSettingsToLocal);
          el.addEventListener('input', () => { el.title = el.value; saveDebounced(); });
        });
        // 姓名變更時即時更新書籤標籤
        const nameInput = row.querySelector('.char-name');
        if (nameInput) nameInput.addEventListener('input', () => renderCharacterTabs());
        
        charactersContainer.appendChild(row);

        // 將 5 個建議欄位升級為可點選的自訂下拉（可點開、可捲動、可過濾、可自由輸入）
        attachCombobox(row.querySelector('.char-personality'), personalityOptions);
        attachCombobox(row.querySelector('.char-goal'), goalOptions);
        attachCombobox(row.querySelector('.char-weakness'), weaknessOptions);
        attachCombobox(row.querySelector('.char-secret'), secretOptions);
        attachCombobox(row.querySelector('.char-relation'), relationOptions);

        if (randomize) {
          // 新增人物時，先收集已有的名字避免重複
          usedNames.clear();
          Array.from(charactersContainer.children).forEach(r => {
            if (r !== row) {
              const name = r.querySelector('.char-name').value.trim();
              if (name) usedNames.add(name);
            }
          });
          randomizeRow(row, false);
        }

        // 更新書籤並切換到這位新人物
        renderCharacterTabs();
        setActiveCharacter(charactersContainer.children.length - 1);
      }
      
      // 更新人物編號
      function updateCharacterIndices() {
        Array.from(charactersContainer.children).forEach((row, idx) => {
          const indexEl = row.querySelector('.char-index');
          if (indexEl) indexEl.textContent = `人物 ${idx + 1}`;
        });
      }

      // ===== 人物書籤分頁：一次只顯示一位，避免人物多時頁面過長 =====
      function getActiveCharIndex() {
        const rows = Array.from(charactersContainer.children);
        const idx = rows.findIndex(r => r.classList.contains('active'));
        return idx >= 0 ? idx : 0;
      }

      function setActiveCharacter(idx) {
        const rows = Array.from(charactersContainer.children);
        if (rows.length === 0) return;
        idx = Math.max(0, Math.min(idx, rows.length - 1));
        rows.forEach((r, i) => r.classList.toggle('active', i === idx));
        if (characterTabs) {
          Array.from(characterTabs.children).forEach((t, i) => t.classList.toggle('active', i === idx));
        }
      }

      // 依目前人物列重建書籤；標籤顯示姓名（未填則用「人物 N」）
      function renderCharacterTabs() {
        if (!characterTabs) return;
        const rows = Array.from(charactersContainer.children);
        let active = getActiveCharIndex();
        if (active > rows.length - 1) active = rows.length - 1;
        characterTabs.innerHTML = '';
        rows.forEach((row, i) => {
          const nameEl = row.querySelector('.char-name');
          const name = nameEl ? nameEl.value.trim() : '';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'char-tab' + (i === active ? ' active' : '');
          btn.textContent = name ? `${i + 1}. ${name}` : `人物 ${i + 1}`;
          btn.title = btn.textContent;
          btn.addEventListener('click', () => setActiveCharacter(i));
          characterTabs.appendChild(btn);
        });
        characterTabs.style.display = rows.length > 1 ? 'flex' : 'none';
        if (rows.length > 0) setActiveCharacter(active < 0 ? 0 : active);
        if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
      }
      
      // 防抖函數
      function debounce(func, wait) {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), wait);
        };
      }

      // 智能隨機選擇：避免重複（人名絕對不重複，其他盡量不重複）
      function pickRandomUnique(arr, usedSet, allowRepeat = false) {
        // 過濾掉已使用的選項
        const available = arr.filter(item => !usedSet.has(item));
        
        // 如果沒有可用選項
        if (available.length === 0) {
          if (allowRepeat) {
            // 允許重複時，從全部選項中選
            return arr[Math.floor(Math.random() * arr.length)];
          } else {
            // 不允許重複時，返回 null（人名用）
            return null;
          }
        }
        
        const chosen = available[Math.floor(Math.random() * available.length)];
        usedSet.add(chosen);
        return chosen;
      }

      // 用於追蹤已使用的選項
      let usedNames = new Set();
      let usedPersonalities = new Set();
      let usedGoals = new Set();
      let usedWeaknesses = new Set();
      let usedSecrets = new Set();
      let usedRelations = new Set();

      // 重置所有追蹤（當重新隨機全部人物時）
      function resetUsedOptions() {
        usedNames.clear();
        usedPersonalities.clear();
        usedGoals.clear();
        usedWeaknesses.clear();
        usedSecrets.clear();
        usedRelations.clear();
        
        // 把目前已填入的人名加入 usedNames（避免與現有重複）
        Array.from(charactersContainer.children).forEach(row => {
          const name = row.querySelector('.char-name').value.trim();
          if (name) usedNames.add(name);
        });
      }

      // 單行隨機化（用於單個人物的隨機按鈕）
      function randomizeRow(row, isFullRandom = false) {
        // 如果是單獨隨機一行，先收集其他行已用的名字
        if (!isFullRandom) {
          usedNames.clear();
          Array.from(charactersContainer.children).forEach(r => {
            if (r !== row) {
              const name = r.querySelector('.char-name').value.trim();
              if (name) usedNames.add(name);
            }
          });
        }
        
        // 先隨機性別
        const genderSelect = row.querySelector('.char-gender');
        const genders = ['男', '女'];
        genderSelect.value = genders[Math.floor(Math.random() * genders.length)];
        
        // 根據性別選擇名字庫
        const gender = genderSelect.value;
        let namePool;
        if (gender === '男') {
          namePool = maleNames;
        } else if (gender === '女') {
          namePool = femaleNames;
        } else {
          namePool = nameOptions; // 不明性別用全部名字
        }
        
        // 人名：絕對不重複
        const newName = pickRandomUnique(namePool, usedNames, false);
        if (newName) {
          row.querySelector('.char-name').value = newName;
        } else {
          // 如果該性別名字都用完了，從全部名字中選
          const fallbackName = pickRandomUnique(nameOptions, usedNames, false);
          if (fallbackName) {
            row.querySelector('.char-name').value = fallbackName;
          } else {
            // 真的都用完了，加編號
            const baseName = namePool[Math.floor(Math.random() * namePool.length)];
            row.querySelector('.char-name').value = baseName + (Math.floor(Math.random() * 100));
          }
        }
        
        // 其他屬性：盡量不重複，但允許在選項用完時重複
        row.querySelector('.char-personality').value = pickRandomUnique(personalityOptions, usedPersonalities, true);
        row.querySelector('.char-goal').value = pickRandomUnique(goalOptions, usedGoals, true);
        row.querySelector('.char-weakness').value = pickRandomUnique(weaknessOptions, usedWeaknesses, true);
        row.querySelector('.char-secret').value = pickRandomUnique(secretOptions, usedSecrets, true);
        row.querySelector('.char-relation').value = pickRandomUnique(relationOptions, usedRelations, true);
        
        // 年齡隨機（根據故事類型可能有不同範圍，這裡用通用範圍）
        const ageRanges = [
          { min: 6, max: 12, weight: 1 },    // 兒童
          { min: 13, max: 17, weight: 2 },   // 青少年
          { min: 18, max: 25, weight: 4 },   // 青年
          { min: 26, max: 35, weight: 3 },   // 壯年
          { min: 36, max: 50, weight: 2 },   // 中年
          { min: 51, max: 70, weight: 1 },   // 老年
        ];
        const totalWeight = ageRanges.reduce((sum, r) => sum + r.weight, 0);
        let rand = Math.random() * totalWeight;
        let selectedRange = ageRanges[0];
        for (const range of ageRanges) {
          rand -= range.weight;
          if (rand <= 0) {
            selectedRange = range;
            break;
          }
        }
        row.querySelector('.char-age').value = Math.floor(Math.random() * (selectedRange.max - selectedRange.min + 1)) + selectedRange.min;
      }

      // 全部人物隨機化
      function randomizeAllCharacters() {
        // 重置追蹤
        usedNames.clear();
        usedPersonalities.clear();
        usedGoals.clear();
        usedWeaknesses.clear();
        usedSecrets.clear();
        usedRelations.clear();
        
        // 依序隨機化每一行
        Array.from(charactersContainer.children).forEach(row => {
          randomizeRow(row, true);
        });
        renderCharacterTabs();
      }

      // ==================== 本地儲存設定 ====================
      /** @type {{ id: string, name: string, gender: string, selected: boolean }[]} */
      let customNamePool = [];
      const NAME_POOL_STORAGE_KEY = 'novelGeneratorNamePool';

      function normalizeCustomNamePool(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
          .filter(e => e && typeof e === 'object' && String(e.name || '').trim())
          .map(e => ({
            id: String(e.id || ('name_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7))),
            name: String(e.name).trim(),
            gender: ['男', '女', '不明'].includes(e.gender) ? e.gender : '不明',
            selected: e.selected !== false
          }));
      }

      /** 人名清單獨立存 localStorage，避免設定存檔失敗或舊版資料遺失 */
      function saveNamePoolToLocal() {
        try {
          localStorage.setItem(NAME_POOL_STORAGE_KEY, JSON.stringify(customNamePool.map(e => ({ ...e }))));
        } catch (e) {
          console.warn('無法儲存人名清單：', e);
        }
      }

      function loadNamePoolFromLocal() {
        try {
          const raw = localStorage.getItem(NAME_POOL_STORAGE_KEY);
          if (!raw) return false;
          customNamePool = normalizeCustomNamePool(JSON.parse(raw));
          return customNamePool.length > 0;
        } catch (e) {
          console.warn('無法載入人名清單：', e);
          return false;
        }
      }

      /** 多分頁或重新聚焦時，合併 localStorage 與記憶體中的人名清單 */
      function syncNamePoolFromStorage() {
        try {
          const raw = localStorage.getItem(NAME_POOL_STORAGE_KEY);
          if (!raw) return;
          const stored = normalizeCustomNamePool(JSON.parse(raw));
          const byName = new Map();
          stored.forEach(e => byName.set(e.name, e));
          customNamePool.forEach(e => byName.set(e.name, e));
          const merged = Array.from(byName.values());
          if (merged.length !== customNamePool.length) {
            customNamePool = merged;
            updateNamePoolBtnBadge();
            if (typeof renderNamePoolModal === 'function' && namePoolModal && namePoolModal.classList.contains('open')) {
              renderNamePoolModal();
            }
          }
        } catch (e) {
          console.warn('合併人名清單失敗：', e);
        }
      }

      function getSelectedNamePool(genderFilter) {
        let pool = customNamePool.filter(e => e.selected);
        if (genderFilter) {
          const g = String(genderFilter).trim();
          const filtered = pool.filter(e => e.gender === g || e.gender === '不明');
          if (filtered.length) pool = filtered;
        }
        return pool.map(e => ({ name: e.name, gender: e.gender }));
      }

      function shuffleArray(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }

      function getNamePoolPromptBlock(count, genderFilter) {
        const pool = getSelectedNamePool(genderFilter);
        if (!pool.length) return '';
        const byGender = { 男: [], 女: [], 不明: [] };
        pool.forEach(e => {
          const g = byGender[e.gender] ? e.gender : '不明';
          byGender[g].push(e.name);
        });
        const lines = [];
        if (byGender['男'].length) lines.push(`男：${shuffleArray(byGender['男']).join('、')}`);
        if (byGender['女'].length) lines.push(`女：${shuffleArray(byGender['女']).join('、')}`);
        if (byGender['不明'].length) lines.push(`不明：${shuffleArray(byGender['不明']).join('、')}`);
        return `\n使用者指定的「優先姓名清單」（共 ${pool.length} 個，優先於自由取名；清單順序已打亂，僅供參考）：
  ${lines.join('；')}
- 需設計 ${count} 位人物：請「優先」從上述清單挑選姓名（不可改字、不可重複使用同一個名字），依各角色 gender/role 合理對應。
- 不必依清單列出的順序使用；可任意打亂配對，以劇情與性別／定位合適為準。
- 若採用清單中某一姓名，該角色性別須與清單標記一致（男名→男，女名→女）；清單組成不代表整體卡司只能單一性別（除非補充說明另有規定）。
- 清單只有 ${pool.length} 個名字；若人物數多於清單，用完後其餘人物再依上述「姓名硬性規則」自行取合適的真實人名（不要重複清單已用過的名字）。`;
      }

      function getCharacterCastGuidanceBlock(notes) {
        const n = notes != null ? String(notes).trim() : getUserNotesText();
        const c = getCastGenderConstraintFromNotes(n);
        if (c === 'female-only') {
          return `\n【卡司性別（★補充說明強制★）】補充說明明確要求全劇不可有男性 → 所有登場人物必須為女性（全女卡司）；gender 須為「女」，role 使用女主角／女配角等，不可有男角。`;
        }
        if (c === 'male-only') {
          return `\n【卡司性別（★補充說明強制★）】補充說明明確要求全劇不可有女性 → 所有登場人物必須為男性（全男卡司）；gender 須為「男」，role 使用男主角／男配角等，不可有女角。`;
        }
        return `\n【卡司性別】卡司可全男、全女或男女混合，依劇情與補充說明決定；不必強求男女各一。`;
      }

      /** AI 設計角色群／補完人物：僅對「採用清單姓名」的角色綁定性別；整體卡司性別僅依補充說明明確規定 */
      function getNamePoolPromptBlockForCharacters(count, genderFilter) {
        const pool = getSelectedNamePool(genderFilter);
        if (!pool.length) return '';
        const notes = getUserNotesText();
        const bindingLines = shuffleArray(pool).map((e, i) => {
          if (e.gender === '男' || e.gender === '女') {
            return `${i + 1}. 「${e.name}」→ 若 name 使用此姓名，gender 必須為「${e.gender}」`;
          }
          return `${i + 1}. 「${e.name}」→ 性別「不明」（採用此姓名時 gender 須與 role 一致）`;
        }).join('\n');
        return `\n【使用者姓名清單與性別綁定（★必須遵守★）】
以下 ${pool.length} 個姓名供優先選用：
${bindingLines}
- 需設計 ${count} 位人物：可優先從清單挑選 name（不可改字、不可重複）；不必依序使用。
- ★ 僅約束「採用了清單姓名」的角色：該角色的 gender／role 必須與清單標記一致（男名不可配女角，女名不可配男角）。
${getNamePoolCastNoteForCharacters(notes)}
- role 須與 gender 一致（gender=男 不可填「女主角／女配角」；gender=女 不可填「男主角／男配角」）。
- 清單用盡後，其餘人物依姓名規則自行取名。`;
      }

      function findNamePoolEntry(name) {
        const n = String(name || '').trim();
        if (!n) return null;
        return getSelectedNamePool().find(e => e.name === n) || null;
      }

      /** 依人名清單與補充說明校正 gender／role */
      function reconcileCharacterWithNamePool(data) {
        if (!data || typeof data !== 'object') return data;
        const out = { ...data };
        const entry = findNamePoolEntry(out.name);
        if (entry && (entry.gender === '男' || entry.gender === '女')) {
          out.gender = entry.gender;
          out.role = normalizeCharRole(out.role, entry.gender);
          if (entry.gender === '男') {
            if (out.role === '女主角') out.role = '男主角';
            else if (out.role === '女配角') out.role = '男配角';
          } else if (entry.gender === '女') {
            if (out.role === '男主角') out.role = '女主角';
            else if (out.role === '男配角') out.role = '女配角';
          }
        }
        const castConstraint = getCastGenderConstraintFromNotes(getUserNotesText());
        if (castConstraint === 'female-only') {
          out.gender = '女';
          if (out.role === '男主角') out.role = '女主角';
          else if (out.role === '男配角') out.role = '女配角';
        } else if (castConstraint === 'male-only') {
          out.gender = '男';
          if (out.role === '女主角') out.role = '男主角';
          else if (out.role === '女配角') out.role = '男配角';
        }
        return out;
      }

      /** 正文／續寫用：角色姓名優先取自使用者清單池，不足者由 AI 依取名規則自行命名 */
      function getNamePoolStoryBlock(setting = '') {
        const pool = getSelectedNamePool();
        if (!pool.length) return '';
        const notes = getUserNotesText();
        const byGender = { 男: [], 女: [], 不明: [] };
        pool.forEach(e => {
          const g = byGender[e.gender] ? e.gender : '不明';
          byGender[g].push(e.name);
        });
        const lines = [];
        if (byGender['男'].length) lines.push(`男：${shuffleArray(byGender['男']).join('、')}`);
        if (byGender['女'].length) lines.push(`女：${shuffleArray(byGender['女']).join('、')}`);
        if (byGender['不明'].length) lines.push(`不明：${shuffleArray(byGender['不明']).join('、')}`);
        return `【姓名清單與取名規則（★必須遵守★）】
使用者指定的「優先姓名清單」（共 ${pool.length} 個；清單順序已打亂，僅供參考）：
${lines.join('\n')}
• 已在【登場人物】指定姓名的角色，沿用其既有姓名。
• 其餘需要命名的角色，請「優先」依性別從上述清單挑選（不可改字、不可重複使用同一個名字）。
• 不必依清單列出的順序使用；可任意打亂配對，以角色性別、身分與劇情需要為準。
${getNamePoolCastNote(notes)}
• 清單只有 ${pool.length} 個名字；當角色數多於清單時，用完清單後，其餘角色由你依故事背景「自行取合適的真實人名」（不要硬湊、不要重複清單已用過的名字）。
• 自行取名時，務必遵守下列姓名規則：
${getCharacterNamingRules(setting)}

`;
      }

      function validateNamePoolForAi(count) {
        // 清單名少於人物數已是預期行為：勾選的優先使用，不足者由 AI 依取名規則自行補名，
        // 因此不再跳出確認阻擋流程。保留函式以相容既有呼叫點。
        return null;
      }

      function updateNamePoolBtnBadge() {
        const btn = document.getElementById('namePoolBtn');
        if (!btn) return;
        const n = customNamePool.filter(e => e.selected).length;
        btn.textContent = n > 0 ? `📋 人名清單 (${n})` : '📋 人名清單';
      }

      function extractOutlineFromNotes(text) {
        const raw = String(text || '');
        const injectedIdx = raw.search(/【本書書名】|【已生成的故事大綱/);
        if (injectedIdx < 0) return { cleanNotes: raw.trim(), outline: '', title: '' };
        const cleanNotes = raw.slice(0, injectedIdx).trim();
        const injected = raw.slice(injectedIdx);
        let title = '';
        const titleMatch = injected.match(/【本書書名】[\s\S]*?《([^》]+)》/);
        if (titleMatch) title = titleMatch[1].trim();
        let outline = '';
        const outlineMatch = injected.match(/【已生成的故事大綱[^】]*】\s*([\s\S]+)/);
        if (outlineMatch) outline = outlineMatch[1].trim();
        return { cleanNotes, outline, title };
      }

      function stripInjectedOutlineFromNotes(text) {
        return extractOutlineFromNotes(text).cleanNotes;
      }

      function getUserNotesText() {
        return stripInjectedOutlineFromNotes(notesInput?.value || '').trim();
      }

      /** 從補充說明偵測明確的全劇性別限制（僅在使用者寫清楚時才生效，人名清單組成不推斷） */
      function getCastGenderConstraintFromNotes(notes) {
        const text = String(notes || '').replace(/\s+/g, '');
        if (!text) return null;
        const noMale = /全[劇書篇部部作品]?[^。；\n]{0,6}(不能|禁止|不可|勿|勿用)[^。；\n]{0,12}男|不能[^。；\n]{0,8}出現男|不要[^。；\n]{0,6}男[性生性角人]|禁止[^。；\n]{0,6}男|僅[限只]?[^。；\n]{0,4}女[性性]?卡司?|全[是都為]?女[性性]?卡司|全女卡司|整部[都全]?[^。；\n]{0,4}女[性性]|只有女[性性]?|無男[性性]?角色?/.test(text);
        const noFemale = /全[劇書篇部部作品]?[^。；\n]{0,6}(不能|禁止|不可|勿|勿用)[^。；\n]{0,12}女|不能[^。；\n]{0,8}出現女|不要[^。；\n]{0,6}女[性生性角人]|禁止[^。；\n]{0,6}女|僅[限只]?[^。；\n]{0,4}男[性性]?卡司?|全[是都為]?男[性性]?卡司|全男卡司|整部[都全]?[^。；\n]{0,4}男[性性]|只有男[性性]?|無女[性性]?角色?/.test(text);
        if (noMale && !noFemale) return 'female-only';
        if (noFemale && !noMale) return 'male-only';
        return null;
      }

      /** 注入 prompt 的補充說明區塊（使用者可填任意自訂規則） */
      function getSupplementaryNotesBlock(notes) {
        const n = (notes != null ? String(notes) : getUserNotesText()).trim();
        if (!n) return '';
        return `【補充說明與自訂規則（★必須嚴格遵守★）】
使用者指定的額外要求如下；若與預設慣例或推測衝突，一律以本段為準，全文須逐條遵守：
${n}

`;
      }

      function getNamePoolCastNote(notes) {
        const c = getCastGenderConstraintFromNotes(notes);
        if (c === 'female-only') {
          return `• ★ 補充說明清示全劇不可有男性：整套卡司必須全為女性；清單中的男名不可用，劇情中也不得出現男性角色。`;
        }
        if (c === 'male-only') {
          return `• ★ 補充說明清示全劇不可有女性：整套卡司必須全為男性；清單中的女名不可用，劇情中也不得出現女性角色。`;
        }
        return `• 採用清單中某一姓名時，該角色性別須與清單標記一致；清單組成不代表整體卡司只能單一性別，劇情仍可有其他性別的角色（除非補充說明另有規定）。`;
      }

      function getNamePoolCastNoteForCharacters(notes) {
        const c = getCastGenderConstraintFromNotes(notes);
        if (c === 'female-only') {
          return `- ★ 補充說明清示全劇不可有男性：整套卡司必須全為女性；未使用清單名的角色也須為女，清單中的男名不可用。`;
        }
        if (c === 'male-only') {
          return `- ★ 補充說明清示全劇不可有女性：整套卡司必須全為男性；未使用清單名的角色也須為男，清單中的女名不可用。`;
        }
        return `- 清單裡全是男名或女名，不代表整套卡司只能單一性別；未使用清單姓名的角色，gender 依劇情與補充說明自由設定。`;
      }

      function saveSettingsToLocal() {
        try {
          // 收集已選擇的特殊元素
          const selectedElements = [];
          specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
            selectedElements.push(item.dataset.id);
          });
          const validSpecialElements = selectedElements.filter(id =>
            specialElements.some(e => e.id === id)
          );

          const settings = {
            theme: themeSelect.value,
            setting: settingSelect.value,
            style: styleSelect.value,
            chapters: chaptersInput.value,
            length: lengthInput.value,
            notes: stripInjectedOutlineFromNotes(notesInput.value),
            storyOutline: currentOutline || '',
            storyBookTitle: currentBookTitle || '',
            storyOutlineVolumeCount: getOutlineVolumeTotal(),
            // 進階設定
            narrative: narrativeSelect.value,
            era: eraSelect.value,
            pacing: pacingSelect.value,
            rating: ratingSelect.value,
            worldComplexity: worldComplexitySelect.value,
            emotionalTone: emotionalToneSelect.value,
            ending: endingSelect.value,
            specialElements: validSpecialElements,
            customNamePool: customNamePool.map(e => ({ ...e })),
            autoContinue: !!(document.getElementById('autoContinueToggle')?.checked),
            characters: []
          };
          
          Array.from(charactersContainer.children).forEach(row => {
            settings.characters.push({
              gender: row.querySelector('.char-gender').value,
              role: row.querySelector('.char-role') ? row.querySelector('.char-role').value : '',
              age: row.querySelector('.char-age').value,
              name: row.querySelector('.char-name').value,
              personality: row.querySelector('.char-personality').value,
              goal: row.querySelector('.char-goal').value,
              weakness: row.querySelector('.char-weakness').value,
              secret: row.querySelector('.char-secret').value,
              relation: row.querySelector('.char-relation').value
            });
          });
          
          localStorage.setItem('novelGeneratorSettings', JSON.stringify(settings));
          saveNamePoolToLocal();
        } catch (e) {
          console.warn('無法儲存設定：', e);
          saveNamePoolToLocal();
        }
        if (typeof updateStepper === 'function') updateStepper();
      }
      
      // 設定下拉選單的值；若選項不存在則臨時補一個，確保值真的套得進去
      // （快速模板與舊存檔可能含有不在預設清單中的值）
      function setSelectValue(selectEl, value) {
        if (!selectEl || value == null || value === '') return;
        let opt = Array.from(selectEl.options).find(o => o.value === value);
        if (!opt) {
          opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          selectEl.appendChild(opt);
        }
        selectEl.value = value;
      }

      function loadSettingsFromLocal() {
        try {
          const raw = localStorage.getItem('novelGeneratorSettings');
          if (!raw) return false;
          
          const settings = JSON.parse(raw);
          let hasData = false;
          
          // 載入基本設定
          if (settings.theme) { setSelectValue(themeSelect, settings.theme); hasData = true; }
          if (settings.setting) { setSelectValue(settingSelect, settings.setting); hasData = true; }
          if (settings.style) { setSelectValue(styleSelect, settings.style); hasData = true; }
          if (settings.chapters) { chaptersInput.value = settings.chapters; hasData = true; }
          if (settings.length) { lengthInput.value = settings.length; hasData = true; }
          if (settings.storyOutline) {
            currentOutline = settings.storyOutline;
            currentBookTitle = settings.storyBookTitle || '';
            hasData = true;
          }
          if (settings.notes != null) {
            let notesText = String(settings.notes);
            if (!settings.storyOutline && notesText) {
              const migrated = extractOutlineFromNotes(notesText);
              if (migrated.outline) {
                currentOutline = migrated.outline;
                currentBookTitle = migrated.title || '';
                notesText = migrated.cleanNotes;
              } else {
                notesText = stripInjectedOutlineFromNotes(notesText);
              }
            } else {
              notesText = stripInjectedOutlineFromNotes(notesText);
            }
            notesInput.value = notesText;
            if (notesText || settings.notes === '') hasData = true;
          }

          // 載入進階設定
          if (settings.narrative) { setSelectValue(narrativeSelect, settings.narrative); hasData = true; }
          if (settings.era) { setSelectValue(eraSelect, settings.era); hasData = true; }
          if (settings.pacing) { setSelectValue(pacingSelect, settings.pacing); hasData = true; }
          if (settings.rating) { setSelectValue(ratingSelect, settings.rating); hasData = true; }
          if (settings.worldComplexity) { setSelectValue(worldComplexitySelect, settings.worldComplexity); hasData = true; }
          if (settings.emotionalTone) { setSelectValue(emotionalToneSelect, settings.emotionalTone); hasData = true; }
          if (settings.ending) { setSelectValue(endingSelect, settings.ending); hasData = true; }

          // 載入特殊元素
          if (settings.specialElements && settings.specialElements.length > 0) {
            settings.specialElements.forEach(id => {
              const item = specialElementsContainer.querySelector(`[data-id="${id}"]`);
              if (item) {
                item.classList.add('selected');
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = true;
              }
            });
            hasData = true;
          }

          if (settings.customNamePool && Array.isArray(settings.customNamePool) && settings.customNamePool.length) {
            customNamePool = normalizeCustomNamePool(settings.customNamePool);
            hasData = true;
          } else if (loadNamePoolFromLocal()) {
            hasData = true;
          }
          saveNamePoolToLocal();
          const autoContinueEl = document.getElementById('autoContinueToggle');
          if (autoContinueEl) {
            autoContinueEl.checked = settings.autoContinue !== undefined ? !!settings.autoContinue : true;
          }
          updateNamePoolBtnBadge();
          
          // 載入人物設定
          if (settings.characters && settings.characters.length > 0) {
            // 清空現有人物
            charactersContainer.innerHTML = '';
            
            settings.characters.forEach(char => {
              addCharacterRow(false); // 不隨機
              const row = charactersContainer.lastElementChild;
              if (row) {
                const setVal = (sel, val) => {
                  const el = row.querySelector(sel);
                  if (el) { el.value = val || ''; el.title = el.value; }
                };
                setVal('.char-gender', char.gender || '不明');
                setVal('.char-role', normalizeCharRole(char.role, char.gender || '不明'));
                setVal('.char-age', char.age);
                setVal('.char-name', char.name);
                setVal('.char-personality', char.personality);
                setVal('.char-goal', char.goal);
                setVal('.char-weakness', char.weakness);
                setVal('.char-secret', char.secret);
                setVal('.char-relation', char.relation);
              }
            });
            renderCharacterTabs();
            setActiveCharacter(0);
            hasData = true;
          }
          
          console.log('設定已從本地載入', settings);
          return hasData;
        } catch (e) {
          console.warn('無法載入設定：', e);
          return false;
        }
      }
      
      // 監聽基本設定的變更
      [themeSelect, settingSelect, styleSelect, chaptersInput, lengthInput, notesInput,
       narrativeSelect, eraSelect, pacingSelect, ratingSelect, worldComplexitySelect, emotionalToneSelect, endingSelect].forEach(el => {
        el.addEventListener('change', saveSettingsToLocal);
        el.addEventListener('input', debounce(saveSettingsToLocal, 500));
      });
      const autoContinueToggleEl = document.getElementById('autoContinueToggle');
      if (autoContinueToggleEl) autoContinueToggleEl.addEventListener('change', saveSettingsToLocal);
      
      function populateCategorizedSelect(selectEl, categories) {
        const placeholder = selectEl.options[0];
        selectEl.replaceChildren(placeholder);
        categories.forEach(cat => {
          const group = document.createElement('optgroup');
          group.label = cat.name;
          cat.items.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            group.appendChild(option);
          });
          selectEl.appendChild(group);
        });
      }

      // 動態生成下拉選單選項
      function populateSelectOptions() {
        populateCategorizedSelect(themeSelect, themeCategories);
        populateCategorizedSelect(settingSelect, settingCategories);
        populateCategorizedSelect(styleSelect, styleCategories);

        // 敘事視角選項
        narrativeOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          narrativeSelect.appendChild(option);
        });

        // 時代設定選項
        eraOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          eraSelect.appendChild(option);
        });

        // 故事節奏選項
        pacingOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          pacingSelect.appendChild(option);
        });

        // 內容分級選項
        ratingOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          ratingSelect.appendChild(option);
        });

        // 世界觀複雜度選項
        worldComplexityOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          worldComplexitySelect.appendChild(option);
        });

        // 情感基調選項
        emotionalToneOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          emotionalToneSelect.appendChild(option);
        });

        // 結局傾向選項
        endingOptions.forEach(item => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          endingSelect.appendChild(option);
        });

        // 特殊元素多選（分類版）
        const categoryJumpSelect = document.getElementById('categoryJumpSelect');
        const elementSearch = document.getElementById('elementSearch');
        const clearElementsBtn = document.getElementById('clearElementsBtn');
        const selectedCountSpan = document.getElementById('selectedCount');
        let currentCategory = 'all';
        let lastDramaIds = [];

        function syncCategoryJumpSelect() {
          if (!categoryJumpSelect) return;
          categoryJumpSelect.value = currentCategory;
        }
        
        // 更新已選數量
        function updateSelectedCount() {
          const count = specialElementsContainer.querySelectorAll('.special-element-item.selected').length;
          selectedCountSpan.textContent = `已選 ${count} 項`;
          if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
        }
        
        // 渲染分類下拉選單
        function renderCategoryTabs() {
          if (!categoryJumpSelect) return;
          categoryJumpSelect.innerHTML = '';
          const allOpt = document.createElement('option');
          allOpt.value = 'all';
          allOpt.textContent = `全部（${specialElements.length}）`;
          categoryJumpSelect.appendChild(allOpt);

          specialElementCategories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.name;
            opt.textContent = `${cat.icon} ${cat.name}（${cat.items.length}）`;
            categoryJumpSelect.appendChild(opt);
          });
          syncCategoryJumpSelect();
        }

        // 選擇分類
        function selectCategory(category) {
          currentCategory = category;
          syncCategoryJumpSelect();
          filterElements();
        }

        if (categoryJumpSelect) {
          categoryJumpSelect.addEventListener('change', () => {
            selectCategory(categoryJumpSelect.value || 'all');
          });
        }
        
        // 過濾元素（根據分類和搜尋）
        function filterElements() {
          const searchText = elementSearch.value.toLowerCase().trim();
          
          specialElementsContainer.querySelectorAll('.special-element-item').forEach(item => {
            const itemId = item.dataset.id;
            const itemLabel = item.querySelector('.element-label').textContent.toLowerCase();
            
            // 檢查分類
            let inCategory = currentCategory === 'all';
            if (!inCategory) {
              const cat = specialElementCategories.find(c => c.name === currentCategory);
              if (cat) {
                inCategory = cat.items.some(i => i.id === itemId);
              }
            }
            
            // 檢查搜尋
            const matchSearch = !searchText || itemLabel.includes(searchText);
            
            // 顯示/隱藏
            item.style.display = (inCategory && matchSearch) ? '' : 'none';
          });
        }
        
        // 渲染所有元素
        function renderAllElements() {
          specialElementsContainer.innerHTML = '';
          
          specialElements.forEach(item => {
            const div = document.createElement('div');
            div.className = 'special-element-item';
            div.dataset.id = item.id;
            div.innerHTML = `
              <input type="checkbox" id="element-${item.id}" />
              <span class="checkbox-custom"></span>
              <span class="element-icon">${item.icon}</span>
              <span class="element-label">${item.label}</span>
            `;
            div.addEventListener('click', () => {
              div.classList.toggle('selected');
              const checkbox = div.querySelector('input[type="checkbox"]');
              checkbox.checked = !checkbox.checked;
              updateSelectedCount();
              saveSettingsToLocal();
            });
            specialElementsContainer.appendChild(div);
          });
        }
        
        // 清除所有選擇
        clearElementsBtn.addEventListener('click', () => {
          specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
            item.classList.remove('selected');
            item.querySelector('input[type="checkbox"]').checked = false;
          });
          lastDramaIds = [];
          const dr = document.getElementById('dramaResult');
          if (dr) { dr.innerHTML = ''; dr.style.display = 'none'; }
          saveDramaState();
          updateSelectedCount();
          saveSettingsToLocal();
        });
        
        // 搜尋事件
        elementSearch.addEventListener('input', filterElements);

        // ===== 戲劇化組合：開關 + 數量(4~8) + 隨機套用（重擲） =====
        const dramaToggle = document.getElementById('dramaComboToggle');
        const dramaCount = document.getElementById('dramaComboCount');
        const dramaApplyBtn = document.getElementById('dramaApplyBtn');
        const dramaResult = document.getElementById('dramaResult');

        // 取消上一組由本功能隨機勾選的元素
        function clearLastDrama() {
          lastDramaIds.forEach(id => {
            const it = specialElementsContainer.querySelector(`.special-element-item[data-id="${id}"]`);
            if (it && it.classList.contains('selected')) {
              it.classList.remove('selected');
              const cb = it.querySelector('input[type="checkbox"]');
              if (cb) cb.checked = false;
            }
          });
          lastDramaIds = [];
        }

        // 保存戲劇化組合狀態（含本組抽中的 id），讓重新整理後仍能正確重擲
        function saveDramaState() {
          if (dramaToggle && dramaToggle.checked) {
            localStorage.setItem('dramaComboState', JSON.stringify({
              enabled: true,
              count: dramaCount.value || '',
              ids: lastDramaIds
            }));
          } else {
            localStorage.removeItem('dramaComboState');
          }
        }

        if (dramaToggle) {
          dramaToggle.addEventListener('change', () => {
            if (dramaToggle.checked) {
              dramaCount.style.display = '';
            } else {
              dramaCount.style.display = 'none';
              dramaCount.value = '';
              dramaApplyBtn.style.display = 'none';
              dramaResult.style.display = 'none';
              dramaResult.innerHTML = '';
              clearLastDrama();
              updateSelectedCount();
              saveSettingsToLocal();
            }
            saveDramaState();
          });
        }

        if (dramaCount) {
          dramaCount.addEventListener('change', () => {
            const n = parseInt(dramaCount.value, 10);
            dramaApplyBtn.style.display = (n >= 4 && n <= 8) ? '' : 'none';
            saveDramaState();
          });
        }

        if (dramaApplyBtn) {
          dramaApplyBtn.addEventListener('click', () => {
            const n = parseInt(dramaCount.value, 10);
            if (!(n >= 4 && n <= 8)) return;

            // 重擲：先取消上一組
            clearLastDrama();

            // 從「全部特殊元素」中排除使用者目前手選的，再隨機抽不重複 N 個
            const selectedNow = new Set(
              Array.from(specialElementsContainer.querySelectorAll('.special-element-item.selected'))
                .map(it => it.dataset.id)
            );
            const pool = specialElements.filter(e => !selectedNow.has(e.id));
            for (let i = pool.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            const chosen = pool.slice(0, Math.min(n, pool.length));

            const labels = [];
            chosen.forEach(item => {
              const it = specialElementsContainer.querySelector(`.special-element-item[data-id="${item.id}"]`);
              if (it) {
                it.classList.add('selected');
                const cb = it.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
              }
              labels.push(`${item.icon} ${item.label}`);
            });

            lastDramaIds = chosen.map(c => c.id);
            updateSelectedCount();
            saveSettingsToLocal();
            saveDramaState();

            // 顯示本次抽中清單
            dramaResult.innerHTML =
              '<span class="drama-result-label">本次抽中</span>' +
              '<div class="drama-result-chips">' +
              labels.map(l => `<span class="drama-chip">${l}</span>`).join('') +
              '</div>';
            dramaResult.style.display = 'flex';
          });
        }

        // 還原戲劇化組合狀態（頁面重新整理後）
        (function restoreDramaState() {
          if (!dramaToggle) return;
          let st = null;
          try { st = JSON.parse(localStorage.getItem('dramaComboState')); } catch (e) {}
          if (!st || !st.enabled) return;
          dramaToggle.checked = true;
          dramaCount.style.display = '';
          if (st.count) {
            dramaCount.value = st.count;
            const n = parseInt(st.count, 10);
            if (n >= 4 && n <= 8) dramaApplyBtn.style.display = '';
          }
          lastDramaIds = Array.isArray(st.ids) ? st.ids.slice() : [];
          if (lastDramaIds.length) {
            const labels = lastDramaIds
              .map(id => {
                const item = specialElements.find(e => e.id === id);
                return item ? `${item.icon} ${item.label}` : null;
              })
              .filter(Boolean);
            if (labels.length) {
              dramaResult.innerHTML =
                '<span class="drama-result-label">本次抽中</span>' +
                '<div class="drama-result-chips">' +
                labels.map(l => `<span class="drama-chip">${l}</span>`).join('') +
                '</div>';
              dramaResult.style.display = 'flex';
            }
          }
        })();

        // 初始化
        renderCategoryTabs();
        renderAllElements();
        updateSelectedCount();
      }

      // 初始化：載入設定或建立預設人物
      (function initSettings() {
        // 先生成下拉選單選項
        populateSelectOptions();
        
        // 嘗試載入已儲存的設定
        const hasSettings = loadSettingsFromLocal();
        
        // 如果沒有已儲存的設定，才建立預設人物（預設空白，不帶內容）
        if (!hasSettings) {
          addCharacterRow(false);
          addCharacterRow(false);
        }
        // 保底：至少要有一位人物，避免分頁全部隱藏時看不到任何欄位
        if (charactersContainer.children.length === 0) addCharacterRow(false);
        renderCharacterTabs();
        setActiveCharacter(0);
        
        // renderBookmarks 會在 initBookmarks 完成後自動呼叫
        if (!hasSettings) loadNamePoolFromLocal();
        updateNamePoolBtnBadge();
      })();

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncNamePoolFromStorage();
      });
      window.addEventListener('focus', syncNamePoolFromStorage);

      randomAllCharactersBtn.addEventListener('click', () => {
        randomizeAllCharacters();
        saveSettingsToLocal();
      });

      addCharacterBtn.addEventListener('click', () => {
        addCharacterRow(false); // 新增人物預設空白，由使用者自行填寫或用 AI 設計
        saveSettingsToLocal();
      });

      /** 隨機填充主題、背景、風格 */
      function randomizeStoryElements() {
        if (!themeSelect) return;
        themeSelect.value = pickRandom(themes);
        settingSelect.value = pickRandom(settingsData);
        styleSelect.value = pickRandom(stylesArr);
        saveSettingsToLocal();
      }

      // ==================== 智能浮動章節導航 ====================

      // 切換面板顯示
      chapterNavToggle.addEventListener('click', () => {
        isPanelOpen = !isPanelOpen;
        chapterNavPanel.classList.toggle('open', isPanelOpen);
        // 關閉書籤面板
        bookmarkNavPanel.classList.remove('open');
        isBookmarkPanelOpen = false;
      });

      chapterNavClose.addEventListener('click', () => {
        isPanelOpen = false;
        chapterNavPanel.classList.remove('open');
      });

      // ==================== 浮動書籤導航 ====================
      const bookmarkNavContainer = document.getElementById('bookmarkNavContainer');
      const bookmarkNavToggle = document.getElementById('bookmarkNavToggle');
      const bookmarkNavPanel = document.getElementById('bookmarkNavPanel');
      const bookmarkNavClose = document.getElementById('bookmarkNavClose');
      const bookmarkBadge = document.getElementById('bookmarkBadge');
      const bookmarkEmpty = document.getElementById('bookmarkEmpty');
      let isBookmarkPanelOpen = false;

      // 點擊「我的書櫃」開啟書櫃模態
      bookmarkNavToggle.addEventListener('click', () => {
        // 關閉章節面板
        chapterNavPanel.classList.remove('open');
        isPanelOpen = false;
        if (typeof openBookshelf === 'function') openBookshelf();
      });

      bookmarkNavClose.addEventListener('click', () => {
        isBookmarkPanelOpen = false;
        bookmarkNavPanel.classList.remove('open');
      });

      // 點擊面板外部關閉
      document.addEventListener('click', (e) => {
        // 關閉章節面板
        if (isPanelOpen && 
            !chapterNavPanel.contains(e.target) && 
            !chapterNavToggle.contains(e.target)) {
          isPanelOpen = false;
          chapterNavPanel.classList.remove('open');
        }
        // 關閉書籤面板
        if (isBookmarkPanelOpen && 
            !bookmarkNavPanel.contains(e.target) && 
            !bookmarkNavToggle.contains(e.target)) {
          isBookmarkPanelOpen = false;
          bookmarkNavPanel.classList.remove('open');
        }
      });

      // 更新書籤徽章數量
      function updateBookmarkBadge() {
        const count = bookmarksCache.length;
        bookmarkBadge.textContent = count;
        bookmarkBadge.style.display = count > 0 ? 'block' : 'none';
        
        // 更新空狀態顯示
        if (bookmarkEmpty) {
          bookmarkEmpty.style.display = count === 0 ? 'block' : 'none';
        }
        if (bookmarkList) {
          bookmarkList.style.display = count > 0 ? 'flex' : 'none';
        }
      }

      // 閱讀進度追蹤
      window.addEventListener('scroll', () => {
        if (!resultDiv.textContent) return;
        
        const rect = resultDiv.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const docHeight = resultDiv.offsetHeight;
        
        // 計算閱讀進度
        if (rect.top < windowHeight && rect.bottom > 0) {
          const visibleTop = Math.max(0, -rect.top);
          const progress = Math.min(100, (visibleTop / (docHeight - windowHeight)) * 100);
          readingProgress.style.width = Math.max(0, Math.min(100, progress)) + '%';
        }
        
        // 自動更新當前章節高亮
        updateCurrentChapter();
      });

      function updateCurrentChapter() {
        if (chapterMatches.length === 0) return;
        
        const scrollY = window.scrollY;
        const resultRect = resultDiv.getBoundingClientRect();
        const resultTop = resultRect.top + window.scrollY;
        
        let currentChapterIdx = 0;
        
        for (let i = 0; i < chapterMatches.length; i++) {
          const chapterTitle = chapterMatches[i].title;
          const textContent = resultDiv.textContent;
          const chapterIndex = textContent.indexOf(chapterTitle);
          
          // 估算章節在頁面中的位置
          const ratio = chapterIndex / textContent.length;
          const estimatedPos = resultTop + (resultDiv.offsetHeight * ratio);
          
          if (scrollY >= estimatedPos - 100) {
            currentChapterIdx = i;
          }
        }
        
        // 更新按鈕狀態
        const buttons = chapterNavList.querySelectorAll('button');
        buttons.forEach((btn, idx) => {
          btn.classList.toggle('active', idx === currentChapterIdx);
        });
      }

      function parseAndShowChapters(text) {
        chapterMatches = [];
        
        // 策略：只匹配正文中的章節標題
        // 正文章節特徵：以 ## 或 ### 開頭（markdown格式）
        // 目錄章節特徵：以數字編號開頭，如 "1." "2." 或有 ** 粗體標記
        
        // 章節模式：第X章、序章、楔子、尾聲、終章、番外等
        // 支援：一二三...（小寫）、壹貳參...（大寫）、1234...（阿拉伯數字）
        const chapterNumPattern = '[一二三四五六七八九十百零壹貳參肆伍陸柒捌玖拾佰\\d]+';
        const chapterPattern = new RegExp(`(?:第${chapterNumPattern}章|序章|楔子|引子|前言|尾聲|終章|番外|後記|epilogue|prologue)[：:]*[^\\n]*`, 'i');
        
        const lines = text.split('\n');
        // 章節 token：第X章/序章/楔子…，後面可接「：」「:」或空白再帶標題（皆可選）
        const chapterTokenSource = `(?:第${chapterNumPattern}章|序章|楔子|引子|前言|尾聲|終章|番外|後記)(?:[：:\\s].*)?`;
        // 行首 0~4 個 # 標記後接章節 token。
        // 有 # 標記者直接視為正文標題；無標記者需為獨立行（非目錄列表、前一行為空）以排除目錄。
        const headingRegex = new RegExp(`^(#{0,4})\\s*(${chapterTokenSource})$`, 'i');
        
        let charIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const m = line.match(headingRegex);
          if (m) {
            const hashCount = m[1].length;
            const title = m[2].trim();
            const prevLine = i > 0 ? lines[i - 1] : '';
            const isListItem = /^\s*\d+\.\s/.test(line) || /\*\*/.test(line);
            const isAfterBlankLine = i === 0 || prevLine.trim() === '' || prevLine.trim() === '---';
            
            if (hashCount > 0 || (!isListItem && isAfterBlankLine)) {
              chapterMatches.push({ title, fullLine: line, index: charIndex });
            }
          }
          charIndex += line.length + 1; // +1 for \n
        }
        
        // 去除重複（以章節編號或名稱為準）
        const seenChapters = new Set();
        chapterMatches = chapterMatches.filter(m => {
          // 提取章節標識（如「第一章」「第壹章」「序章」「楔子」等）
          const chapterIdRegex = new RegExp(`第${chapterNumPattern}章|序章|楔子|引子|前言|尾聲|終章|番外|後記`, 'i');
          const chapterIdMatch = m.title.match(chapterIdRegex);
          if (chapterIdMatch) {
            const chapterId = chapterIdMatch[0];
            if (!seenChapters.has(chapterId)) {
              seenChapters.add(chapterId);
              return true;
            }
          }
          return false;
        });

        // 只要有章節就顯示（改為 >= 1）
        if (chapterMatches.length >= 1) {
          // 顯示浮動導航
          chapterNavContainer.classList.add('show');
          chapterBadge.textContent = chapterMatches.length;
          
          // 生成章節列表
          chapterNavList.innerHTML = chapterMatches.map((m, i) => 
            `<button type="button" data-chapter="${i}">
              <span class="chapter-num">${i + 1}</span>
              ${m.title.substring(0, 20)}${m.title.length > 20 ? '...' : ''}
            </button>`
          ).join('');
          
          // 綁定點擊事件
          chapterNavList.querySelectorAll('button').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
              const chapter = chapterMatches[idx];
              const fullText = resultDiv.textContent;
              
              // 搜尋完整的章節行（包含 ### 或不含）
              // 因為 textContent 不會保留 ### 符號，需要搜尋標題本身
              const searchTitle = chapter.title;
              
              // 從儲存的 index 附近搜尋（避免找到目錄）
              // 找所有出現位置，選擇最接近儲存 index 的那個
              let bestIndex = -1;
              let searchStart = 0;
              
              while (true) {
                const foundIndex = fullText.indexOf(searchTitle, searchStart);
                if (foundIndex === -1) break;
                
                // 檢查這個位置是否更接近目標
                if (bestIndex === -1 || Math.abs(foundIndex - chapter.index) < Math.abs(bestIndex - chapter.index)) {
                  // 額外檢查：這個位置前面不應該是數字編號（排除目錄）
                  const beforeText = fullText.substring(Math.max(0, foundIndex - 10), foundIndex);
                  const isInTOC = /\d+\.\s*$/.test(beforeText) || /\*\*\s*$/.test(beforeText);
                  
                  if (!isInTOC) {
                    bestIndex = foundIndex;
                  }
                }
                searchStart = foundIndex + 1;
              }
              
              if (bestIndex !== -1) {
                const beforeChapter = fullText.substring(0, bestIndex);
                const chapterText = searchTitle;
                const afterChapter = fullText.substring(bestIndex + searchTitle.length);
                
                resultDiv.innerHTML = 
                  escapeHtml(beforeChapter) + 
                  '<span id="chapter-target" style="scroll-margin-top: 20px;">' + escapeHtml(chapterText) + '</span>' + 
                  escapeHtml(afterChapter);
                
                const target = document.getElementById('chapter-target');
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  
                  // 高亮效果
                  target.style.background = 'linear-gradient(90deg, rgba(233, 69, 96, 0.3), rgba(244, 162, 97, 0.1))';
                  target.style.borderRadius = '4px';
                  target.style.padding = '4px 8px';
                  target.style.marginLeft = '-8px';
                  
                  setTimeout(() => {
                    target.style.transition = 'background 1.5s ease';
                    target.style.background = 'transparent';
                  }, 2000);
                }
              }
              
              // 更新按鈕狀態
              chapterNavList.querySelectorAll('button').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              
              // 行動裝置上自動關閉面板
              if (window.innerWidth <= 768) {
                isPanelOpen = false;
                chapterNavPanel.classList.remove('open');
              }
            });
          });
        } else {
          chapterNavContainer.classList.remove('show');
          chapterMatches = [];
        }
      }

      // HTML 轉義函數
      function escapeHtml(text) {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // ==================== 生成故事 ====================
      generateBtn.addEventListener('click', async () => {
        // 檢查離線狀態
        if (!navigator.onLine) {
          showStatus('error', '📴 目前為離線模式，無法生成故事。請連接網路後再試。');
          settleGenerate();
          return;
        }
        
        hideStatus();
        resultDiv.textContent = '';
        chapterNavContainer.classList.remove('show');
        chapterMatches = [];
        localStorage.removeItem('savedStory');
        latestStory = '';
        // 全新故事（非系列接續下一集）才清空 series 狀態
        if (!generatingNextVolume) {
          storySeries = null;
          seriesAborted = false; // 避免上次停止的旗標殘留導致新一輪自動生成立即中止
          try { localStorage.removeItem('storySeries'); } catch (e) {}
        }
        downloadBtn.disabled = true;
        continueBtn.disabled = true;

        const model = modelSelect.value;
        const theme = themeSelect.value.trim();
        const setting = settingSelect.value.trim();
        
        const { charactersInfo, characterNames, characterCount, mainNames, secondaryNames } = collectCharactersInfo();
        
        const style = styleSelect.value.trim();
        const chapters = chaptersInput.value.trim();
        const length = lengthInput.value.trim();
        const notes = getUserNotesText();
        const hasOutlineForGenerate = !!(currentOutline && currentOutline.trim());
        const lengthPlan = getStoryLengthPlan(chapters, length);
        const chapterWordReq = formatChapterWordRequirement(lengthPlan, { chapterLabel: '每章' });
        const chapter1WordReq = formatChapterWordRequirement(lengthPlan, { chapterLabel: '第1章', emphasize: true });

        // 進階設定
        const narrative = narrativeSelect.value.trim();
        const era = eraSelect.value.trim();
        const pacing = pacingSelect.value.trim();
        const rating = ratingSelect.value.trim();
        const worldComplexity = worldComplexitySelect.value.trim();
        const emotionalTone = emotionalToneSelect.value.trim();
        const ending = endingSelect.value.trim();

        // ===== 結局軌道與系列分集 =====
        const endingKind = getEndingKind(ending);
        let plannedVolumes = getPlannedVolumes();
        if (endingKind === 'series' && plannedVolumes < 2) plannedVolumes = 2;
        // 接續系列下一集時，以既有 storySeries 為準，避免輸入被更動造成判斷錯誤
        const isSeries = (generatingNextVolume && storySeries && storySeries.totalVolumes > 1) || plannedVolumes >= 2;
        // 全新系列：建立 storySeries 骨架（startNextVolume 會自行建立後續集）
        if (!generatingNextVolume && isSeries) {
          storySeries = {
            id: 'series_' + Date.now(),
            seriesTitle: '',
            totalVolumes: plannedVolumes,
            activeVolumeIndex: 0,
            volumes: Array.from({ length: plannedVolumes }, (_, i) => ({
              index: i, label: getVolumeLabel(i, plannedVolumes), title: '', content: '', complete: false
            }))
          };
        }
        const seriesTotal = storySeries ? storySeries.totalVolumes : plannedVolumes;
        const volumeIndex = storySeries ? storySeries.activeVolumeIndex : 0;
        const isFinalVolume = !isSeries || volumeIndex >= seriesTotal - 1;
        const volumeLabel = isSeries ? getVolumeLabel(volumeIndex, seriesTotal) : '';
        const isContinuedVolume = !!(generatingNextVolume && storySeries && volumeIndex > 0);
        let prevVolumeContext = '';
        if (isContinuedVolume) {
          const prev = storySeries.volumes[volumeIndex - 1];
          if (prev && prev.content) {
            prevVolumeContext = buildPrevVolumeContext(prev.content, volumeIndex, seriesTotal);
          }
        }
        
        // 收集特殊元素
        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          const label = item.querySelector('.element-label').textContent;
          selectedElements.push(label);
        });

        const hasAdvanced = narrative || era || pacing || rating || worldComplexity || emotionalTone || ending;
        if (!theme && !setting && !charactersInfo && !style && !chapters && !length && !notes && !hasOutlineForGenerate && selectedElements.length === 0 && !hasAdvanced) {
          // 完全沒有任何設定：提示並標記最常用的主題／背景欄位
          [themeSelect, settingSelect].forEach(el => {
            if (el && !el.value.trim()) {
              el.classList.add('input-error');
              setTimeout(() => el.classList.remove('input-error'), 1000);
            }
          });
          showStatus('warning', '請至少設定一項（主題／背景／人物／特殊元素…），或使用各區塊的「🎲 隨機填充」');
          settleGenerate();
          return;
        }

        // 外層保險：涵蓋 prompt 建構等前置階段，確保任何非預期錯誤都會在 finally 釋放
        // 系列自動流程等待中的 awaitableGenerate（generateDoneResolver），避免整條流程懸空。
        try {
        // 構建結構化的 prompt - 專業作家系統提示詞
        let prompt = `【角色設定：頂尖文學創作大師】

你是一位享譽文壇的資深作家，文筆老練、敘事功力深厚，精通東西方文學傳統與各類敘事結構（三幕式、英雄之旅、起承轉合、懸念鉤子、草蛇灰線），能依題材自如切換筆調。${style ? `\n本次請以「${style}」為主導風格，全篇維持統一的敘事聲音，不要混雜其他流派的腔調。` : ''}

◆ 核心寫作原則 ◆
1.「展示而非講述」(Show, Don't Tell)：用行動、對話、細節展現人物性格，而非直接說明
2. 五感沉浸：視覺、聽覺、嗅覺、味覺、觸覺多維度營造場景
3. 潛文本運用：對話底下的真實意圖，言外之意勝過直白表述
4. 情緒節奏：張弛有度，高潮前的蓄勢，轉折後的留白
5. 人物立體化：賦予角色矛盾、慾望、恐懼、秘密，避免臉譜化
6. 衝突驅動：內心衝突、人際衝突、社會衝突、命運衝突層層遞進
7. 意象經營：以象徵物件、重複意象深化主題
8. 語言風格化：根據故事調性選擇用詞，文白、口語書面、典雅通俗皆能駕馭

═══════════════════════════════════════
【本次創作任務】
═══════════════════════════════════════

`;
        
        // ===== 基本設定區 =====
        let basicSettings = [];
        if (theme) basicSettings.push(`主題：${theme}`);
        if (setting) basicSettings.push(`背景設定：${setting}`);
        if (era) basicSettings.push(`時代背景：${era}`);
        if (style) basicSettings.push(`故事風格：${style}`);
        
        if (basicSettings.length > 0) {
          prompt += `【基本設定】\n${basicSettings.join('\n')}\n\n`;
        }
        
        // ===== 人物設定區 =====
        if (charactersInfo) {
          prompt += `【登場人物（共${characterCount}位）】\n${charactersInfo}`;
          if (mainNames.length > 0) {
            prompt += `★ 主要角色（${mainNames.join('、')}）：故事核心，需深入刻畫、貫穿全篇，給予充分戲份。\n`;
          }
          if (secondaryNames.length > 0) {
            prompt += `○ 次要／配角（${secondaryNames.join('、')}）：服務主線、適時登場即可，不必每章出現，避免喧賓奪主。\n`;
          }
          prompt += '\n';
        }
        
        // ===== 姓名清單池（使用者有勾選時，正文取名須遵守）=====
        prompt += getNamePoolStoryBlock(setting);
        
        // ===== 寫作風格設定區 =====
        let styleSettings = [];
        if (narrative) styleSettings.push(`敘事視角：${narrative}`);
        if (pacing) styleSettings.push(`故事節奏：${pacing}`);
        if (emotionalTone) styleSettings.push(`情感基調：${emotionalTone}`);
        if (worldComplexity) styleSettings.push(`世界觀複雜度：${worldComplexity}`);
        if (rating) styleSettings.push(`內容分級：${rating}`);
        if (ending) styleSettings.push(`結局傾向：${ending}`);
        
        if (styleSettings.length > 0) {
          prompt += `【寫作風格設定（★必須嚴格遵守★）】\n${styleSettings.join('\n')}\n\n`;
        }
        
        // ===== 特殊元素區 =====
        if (selectedElements.length > 0) {
          prompt += `【特殊元素（★必須融入故事★）】\n${selectedElements.join('、')}\n\n`;
        }
        
        // ===== 篇幅設定區 =====
        let lengthSettings = [];
        if (chapters) lengthSettings.push(`章節數：${chapters} 章`);
        if (length) lengthSettings.push(`總字數：約 ${length} 字`);
        if (lengthPlan.targetTotal > 0 && lengthPlan.targetChapters > 0) {
          lengthSettings.push(`平均每章：約 ${lengthPlan.wordsPerChapter.toLocaleString()} 字（必須遵守，勿明顯低於此篇幅）`);
        }
        
        if (lengthSettings.length > 0) {
          prompt += `【篇幅設定】\n${lengthSettings.join('\n')}\n\n`;
        }
        
        // ===== 補充說明與自訂規則 =====
        prompt += getSupplementaryNotesBlock(notes);

        // ===== 故事大綱（獨立於補充說明，僅注入 prompt） =====
        const outlineGenBlock = typeof getOutlineGenerationBlock === 'function' ? getOutlineGenerationBlock() : '';
        if (outlineGenBlock) {
          prompt += outlineGenBlock;
        }
        
        // ===== 生成設定清單（用於最後的強調） =====
        let settingsList = [];
        if (theme) settingsList.push(`主題「${theme}」`);
        if (setting) settingsList.push(`背景「${setting}」`);
        if (era) settingsList.push(`時代「${era}」`);
        if (style) settingsList.push(`風格「${style}」`);
        if (narrative) settingsList.push(`視角「${narrative}」`);
        if (pacing) settingsList.push(`節奏「${pacing}」`);
        if (emotionalTone) settingsList.push(`基調「${emotionalTone}」`);
        if (worldComplexity) settingsList.push(`世界觀「${worldComplexity}」`);
        if (rating) settingsList.push(`分級「${rating}」`);
        if (ending) settingsList.push(`結局「${ending}」`);
        
        // 章節完結提示
        let chapterEndingHint = '';
        const targetChapterCount = parseInt(chapters) || 0;
        const shouldGenerateChapterByChapter = targetChapterCount >= 1; // 有填章節數即逐章生成，避免短篇缺標題與接續重寫

        // 結局指令（與章節數解耦：有選結局就注入，見錯誤6/7）
        // 逐章首章用 setup；未填章節數的一次性整篇產出用 final 兩段式
        const endingPhaseForGenerate = shouldGenerateChapterByChapter ? 'setup' : 'final';
        const endingDirective = getEndingDirective(ending, endingPhaseForGenerate, {
          isSeriesVolume: isSeries,
          isFinalVolume,
          volumeIndex,
          compactStory: isCompactStoryPlan(lengthPlan)
        });

        // 系列書名指令（集數≥2 一開始就把集別寫進書名，見 series-title）
        let seriesTitleDirective = '';
        if (isSeries) {
          const noRepeatTitle = '；全書只在最開頭輸出一次書名行，第2章起及所有續寫禁止再輸出 # 《書名》 行';
          if (volumeIndex === 0) {
            seriesTitleDirective = `\n• ★【系列書名】本作為共 ${seriesTotal} 集的系列；請在全文最開頭獨立一行輸出書名行「# 《書名》（${volumeLabel}）」，書名後務必加上「（${volumeLabel}）」標註${noRepeatTitle}`;
          } else {
            const baseTitle = storySeries && storySeries.seriesTitle ? `《${storySeries.seriesTitle}》` : '《（沿用前集書名）》';
            seriesTitleDirective = `\n• ★【系列書名】本集為系列第 ${volumeIndex + 1} 集；請在全文最開頭獨立一行輸出書名行「# ${baseTitle}（${volumeLabel}）」（沿用前集書名，僅更換集別標註）${noRepeatTitle}`;
          }
        }
        
        if (chapters) {
          if (shouldGenerateChapterByChapter) {
            if (isContinuedVolume) {
              chapterEndingHint = `
• ⚠️【重要】本集為${volumeLabel}（系列第 ${volumeIndex + 1}/${seriesTotal} 集），本集共 ${chapters} 章；本次只寫【第1章】
• ★★★ 本集第1章必須從上方【接續錨點】直接接寫，時間／地點／人物狀態連續；禁止重寫第一集開場、禁止重複已發生過的情節（如重新發現規則書、重走圖書館初遇等）
• 前情最多 1～2 句帶過，立刻推進本集新衝突
• ${chapter1WordReq.replace(/^•\s*/, '')}
• 第1章結尾留懸念；勿寫第2章及之後
• 章節標題格式：### 第1章：標題`;
            } else {
            // 逐章生成模式：只生成第一章
            chapterEndingHint = `
• ⚠️【重要】故事總共 ${chapters} 章，本次只需生成【第1章】（或序章）
• ${chapter1WordReq.replace(/^•\s*/, '')}
• 第1章要有完整的故事開頭，建立世界觀、展開初始情節${mainNames.length > 0 ? `，並讓主要角色（${mainNames.join('、')}）登場` : '，介紹主要角色'}${secondaryNames.length > 0 ? `\n• 配角（${secondaryNames.join('、')}）不必在第1章全部登場，可於後續章節再自然引入` : ''}
• 第1章結尾要有懸念或轉折，為後續章節做鋪墊
• 不要生成第2章及之後的內容，只寫第1章即可
• 章節標題格式：### 第1章：標題（或 ### 序章：標題）`;
            }
          } else {
            // 一次性生成模式：生成所有章節
          chapterEndingHint = `
• 故事總共 ${chapters} 章，第 ${chapters} 章必須是【完結篇】，要妥善收尾所有劇情線
• 在最後一章結束後，加上「（全文完）」或「─ 完 ─」標記`;
          }
        }
        
        // 人物登場強調（依角色定位分主次調度）
        let characterReminder = '';
        if (characterCount > 0) {
          const reminderParts = [];
          if (mainNames.length > 0) {
            reminderParts.push(`主要角色（${mainNames.join('、')}）務必充分發揮、貫穿劇情，給予核心戲份`);
          }
          if (secondaryNames.length > 0) {
            reminderParts.push(`配角（${secondaryNames.join('、')}）可於適當章節自然登場，不必全部擠在開頭`);
          }
          characterReminder = `
• ★★★【人物調度】${reminderParts.join('；')}`;
          if (characterCount >= 5) {
            characterReminder += `\n• 角色較多，請合理分配各角色的出場順序與戲份比重，避免一次堆疊過多人物導致開場混亂`;
          }
        }
        
        // 設定遵守強調
        let settingsReminder = '';
        if (settingsList.length > 0) {
          settingsReminder = `
• ★★★【必須遵守所有設定】${settingsList.join('、')}`;
        }
        
        // 特殊元素強調
        let elementsReminder = '';
        if (selectedElements.length > 0) {
          elementsReminder = `
• 必須將特殊元素「${selectedElements.join('、')}」自然融入故事情節中`;
        }
        
        const openingQualityLine = isContinuedVolume
          ? `• 本集開章即接續：第1章第一句必須緊接【接續錨點】之後，不得閃回、不得重寫系列開場`
          : `• 開篇即入戲：以動作、對話或懸念開場，三句話內抓住讀者`;

        prompt += prevVolumeContext;
        prompt += `
═══════════════════════════════════════
【創作執行指令】
═══════════════════════════════════════

請以上述大師級水準，依循所有設定開始創作。執行要點：

◆ 敘事品質 ◆
${openingQualityLine}
• 「展示而非講述」：用具體行動、表情、細節展現人物特質，而非直接說明
• 五感沉浸：視覺畫面、聲音氛圍、氣味觸感，讓讀者身臨其境
• 對話有潛文本：角色話語背後有情緒、有目的、有個性，避免說明式對白

◆ 結構規範 ◆
${chapterWordReq}
• 章節標題格式：### 第X章：標題（或 ### 序章：標題）
• 使用繁體中文（禁止簡體字與中國大陸慣用詞），文筆流暢優美
• 純敘事文體呈現，禁止大綱、條列、設定說明

◆ 避免事項（重要）◆
• 禁用 AI 套語與陳腔濫調，例如「嘴角勾起一抹弧度」「空氣彷彿凝固」「不知過了多久」「心中五味雜陳」「一絲不易察覺的」等
• 不要直接說明情緒（如「他很憤怒」），改以神態、動作、生理反應與環境烘托來展現
• 避免句式單調與每段同一主詞開頭，長短句交錯、節奏有變化
• 對白要像真人說話，口吻符合各角色身分，避免翻譯腔與成語堆砌

◆ 強制遵守 ◆${elementsReminder}${settingsReminder}${characterReminder}${chapterEndingHint}${endingDirective}${seriesTitleDirective}
${shouldGenerateChapterByChapter ? '\n⚠️ 本次僅需創作第1章，後續章節請使用「繼續生成」。' : ''}

───────────────────────────────────────
以大師之筆，開始揮灑這個故事：
───────────────────────────────────────
`;

        if (shouldGenerateChapterByChapter) {
          showStatus('loading', `故事生成中（逐章模式：將生成第1章，共${targetChapterCount}章）...`);
        } else {
        showStatus('loading', '故事生成中，請稍候...');
        }
        generateBtn.disabled = true;
        
        // 顯示生成進度
        showGenerationProgress();
        const totalChaptersForProgress = shouldGenerateChapterByChapter ? targetChapterCount : (parseInt(chapters) || 1);
        
        if (shouldGenerateChapterByChapter) {
          document.getElementById('progressChapter').textContent = `正在生成第1章（共${targetChapterCount}章）...`;
        } else {
          document.getElementById('progressChapter').textContent = '正在準備生成...';
        }
        
        // 開始模擬進度條動畫
        startSimulatedProgress(totalChaptersForProgress);

        const signal = beginGeneration();
        let wasTruncated = false;
        let finishReasonMeta = null;
        // 直排：比照橫式，生成時跟著最新內容捲動
        streamAnchorStart = false;
        try {
          document.getElementById('progressChapter').textContent = '正在連接 AI 服務...';
          resultDiv.textContent = '';
          if (isVerticalWriting()) {
            verticalScrollStartAtMin = null;
            verticalScrollToStartPending = false;
            unbindVerticalStartScrollObserver();
            requestAnimationFrame(() => scrollVerticalToTextEdge(true));
          } else {
            scrollOutputAreaIntoView();
          }
          
          const story = await callDeepSeek(prompt, null, model, {
            signal,
            maxTokens: tokensForChapterWords(lengthPlan.wordsPerChapter),
            onChunk: (full) => { setResultStreaming(full); },
            onComplete: ({ finishReason }) => { finishReasonMeta = finishReason; }
          });
          wasTruncated = shouldAutoResumeSegment(finishReasonMeta, story, lengthPlan, { isAlreadyComplete: false });
          
          if (story) {
            latestStory = story.trim();
            resultDiv.textContent = latestStory;
            
            persistStory(latestStory);
            
            // 更新字數統計
            updateWordCount(latestStory);
            
            // 更新真實進度（基於實際生成的章節數）
            const generatedChapters = countChapters(latestStory);
            const wordCount = latestStory.replace(/[\s\n#*_\-]/g, '').length;
            
            // 清除模擬進度，更新真實進度
            if (progressInterval) {
              clearInterval(progressInterval);
              progressInterval = null;
            }
            
            if (generatedChapters > 0) {
              updateGenerationProgress(generatedChapters, totalChaptersForProgress, wordCount);
            } else {
              // 如果沒有檢測到章節，至少更新字數和完成狀態
              document.getElementById('progressWords').textContent = `已生成 ${wordCount.toLocaleString()} 字`;
              document.getElementById('progressBarFill').style.width = '100%';
              document.getElementById('progressPercent').textContent = '100%';
              document.getElementById('progressTime').textContent = '已完成';
            }
            
            // 短暫延遲後隱藏進度條，讓用戶看到完成狀態（可被續章取消）
            scheduleHideProgress(1000);

            downloadBtn.disabled = false;
            continueBtn.disabled = false;
            speakBtn.disabled = false; bookReaderBtn.disabled = false;
            parseAndShowChapters(latestStory);

            // 截斷或本章字數不足時自動接續，再顯示完成狀態
            if (wasTruncated || isCurrentChapterUnderTarget(lengthPlan, latestStory)) {
              await doContinueGenerationWithAutoResume({ auto: true, truncatedResume: true });
              updateWordCount(latestStory);
              parseAndShowChapters(latestStory);
              const wc = countStoryWords(latestStory);
              const ch = countChapters(latestStory);
              if (ch > 0) updateGenerationProgress(ch, totalChaptersForProgress, wc);
            }

            const finalChapters = countChapters(latestStory);
            if (shouldGenerateChapterByChapter && finalChapters >= 1) {
              if (isAutoContinueEnabled()) {
                showStatus('loading', `第1章完成（${getLastChapterWordCount(latestStory).toLocaleString()} 字），自動生成後續章節…`);
              } else {
                showStatus('success', `第1章生成完成！目前 ${finalChapters}/${targetChapterCount} 章`);
              }
            } else if (shouldGenerateChapterByChapter && finalChapters === 0) {
              showStatus('warning', '生成完成，但未檢測到章節標題。請檢查內容或使用「繼續生成」按鈕');
            } else {
              showStatus('success', '生成完成！');
            }

            // 系列：擷取並記住基底書名（供後續集沿用）
            if (storySeries && !storySeries.seriesTitle) {
              const t = stripVolumeSuffix(extractBookTitle(latestStory));
              if (t) { storySeries.seriesTitle = t; saveStorySeries(); }
            }
            renderSeriesBar();

            // 自動連續生成：系列 → runAutoSeries；單本逐章 → runAutoContinue
            // （seriesRunning 為真時表示已在系列流程中，勿重複觸發，見錯誤10）
            if (isAutoContinueEnabled() && countChapters(latestStory) >= 1 && !seriesRunning) {
              if (isSeries) {
                setTimeout(() => runAutoSeries(targetChapterCount), 600);
              } else if (shouldGenerateChapterByChapter) {
                setTimeout(() => runAutoContinue(targetChapterCount), 600);
              }
            }
          } else {
            showStatus('error', '沒有獲得內容，請調整設定');
            hideGenerationProgress();
          }
        } catch (err) {
          if (err.name === 'AbortError' || userAborted) {
            const partial = resultDiv.textContent.trim();
            if (partial) {
              latestStory = partial;
              persistStory(latestStory);
              updateWordCount(latestStory);
              parseAndShowChapters(latestStory);
              downloadBtn.disabled = false;
              continueBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
              showStatus('info', '⏹ 已停止，已保留生成的內容');
            } else {
              showStatus('info', '⏹ 已停止生成');
            }
          } else {
            // 非中斷錯誤：若已串流出部分內容，保留下來讓使用者可「繼續生成」接續
            const partial = resultDiv.textContent.trim();
            if (partial) {
              latestStory = partial;
              persistStory(latestStory);
              updateWordCount(latestStory);
              parseAndShowChapters(latestStory);
              downloadBtn.disabled = false;
              continueBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
              showStatus('warning', '⚠️ 生成中斷：' + err.message + '；已保留部分內容，可點「繼續生成」接續');
            } else {
              showStatus('error', '請求失敗：' + err.message);
            }
          }
          hideGenerationProgress();
        } finally {
          endGeneration();
          generateBtn.disabled = false;
          streamAnchorStart = false;
          settleGenerate();
          // 直排：生成結束後停在最新處
          if (isVerticalWriting()) {
            requestAnimationFrame(() => {
              syncVerticalLayout(false);
              scrollVerticalStream();
            });
          }
        }
        } catch (outerErr) {
          // prompt 建構等前置階段的非預期錯誤：回報並清理（內層 try 的錯誤已在其 catch 處理過）
          if (!(outerErr && outerErr.name === 'AbortError')) {
            showStatus('error', '生成失敗：' + (outerErr && outerErr.message ? outerErr.message : '未知錯誤'));
          }
          try { hideGenerationProgress(); } catch (e) {}
          endGeneration();
          generateBtn.disabled = false;
        } finally {
          // 保險：任何路徑都釋放系列自動生成的等待，避免 awaitableGenerate 永久懸空
          settleGenerate();
        }
      });

      // ==================== 繼續生成 ====================
      continueBtn.addEventListener('click', () => doContinueGenerationWithAutoResume());

      const AUTO_TRUNCATE_RESUME_MAX = 15;

      /** 截斷時自動接續，直到完成或達上限（免手動連點「繼續生成」） */
      async function doContinueGenerationWithAutoResume(opts = {}) {
        const maxResume = opts.maxResume ?? AUTO_TRUNCATE_RESUME_MAX;
        const plan = getStoryLengthPlan();
        const targetChapters = parseInt(chaptersInput.value) || 0;
        let result = await doContinueGeneration(opts);
        if (result.aborted || !result.ok) return result;
        if (!result.truncated && !isCurrentChapterUnderTarget(plan, latestStory)) return result;

        showStatus('loading', '📝 篇幅較長，自動接續未完成段落…');
        let remaining = maxResume;
        while (remaining-- > 0 && !userAborted && !seriesAborted) {
          if (!result.truncated && !isCurrentChapterUnderTarget(plan, latestStory)) break;
          const needsEpilogue = targetChapters > 0
            && getRemainingChapterCount(latestStory, targetChapters) <= 0
            && !isActiveStoryComplete(targetChapters);
          if (isStoryOverWordBudget(plan, latestStory) && !needsEpilogue) break;
          await sleep(600);
          result = await doContinueGeneration({
            auto: true,
            truncatedResume: true
          });
          if (result.aborted || !result.ok) break;
        }
        if (result.truncated || isCurrentChapterUnderTarget(plan, latestStory)) {
          showStatus('warning', '⚠️ 已自動接續多次仍不足，可再點「繼續生成」完成本章');
        }
        return result;
      }

      async function doContinueGeneration(opts = {}) {
        const isAuto = opts.auto === true;
        const truncatedResume = opts.truncatedResume === true;
        let genResult = { ok: false };
        // 檢查離線狀態
        if (!navigator.onLine) {
          showStatus('error', '📴 目前為離線模式，無法繼續生成。請連接網路後再試。');
          return { ok: false, reason: 'offline' };
        }
        
        if (!latestStory) {
          showStatus('error', '尚未有故事可繼續，請先生成');
          return { ok: false, reason: 'no_story' };
        }
        
        // 檢查是否已達到設定的章節數上限
        const targetChapters = parseInt(chaptersInput.value) || 0;
        const lengthPlan = getStoryLengthPlan();
        const continueWordReq = formatChapterWordRequirement(lengthPlan, { chapterLabel: '本章', emphasize: lengthPlan.targetTotal > 0 });
        const currentWordCount = countStoryWords(latestStory);

        // 結局／系列脈絡
        const endingForCont = endingSelect.value.trim();
        const isSeriesVol = !!(storySeries && storySeries.totalVolumes > 1);
        const seriesActiveIdx = storySeries ? storySeries.activeVolumeIndex : 0;
        const isFinalVol = !isSeriesVol || (seriesActiveIdx >= storySeries.totalVolumes - 1);
        const volEndOpts = { isSeriesVolume: isSeriesVol, isFinalVolume: isFinalVol };
        const volCompleteMark = (isSeriesVol && !isFinalVol)
          ? `（${getVolumeLabel(seriesActiveIdx, storySeries.totalVolumes)}完）`
          : '（全文完）';

        if (targetChapters > 0 && !isAuto) {
          const currentChapters = countChapters(latestStory);
          // 番外預告且尚未寫番外篇時，續寫是用來補番外，不必跳「超過章數」確認
          const needOmakeNext = endingNeedsOmake(endingSelect.value.trim()) && !OMAKE_RE.test(latestStory);
          if (currentChapters >= targetChapters && !needOmakeNext) {
            const confirmContinue = confirm(`目前已有 ${currentChapters} 章，已達到設定的 ${targetChapters} 章上限。\n\n確定要繼續生成更多章節嗎？`);
            if (!confirmContinue) {
              return { ok: false, reason: 'cancelled' };
            }
          }
        }

        const model = modelSelect.value;

        // 計算還需要生成多少章，並決定是否需要結局
        let remainingChaptersHint = '';
        let isNearEnding = false;
        let isFinalChapter = false;
        let isAlreadyComplete = false;
        const wordProgressHint = lengthPlan.targetTotal > 0
          ? `\n• 全書字數目標 ${lengthPlan.targetTotal.toLocaleString()} 字，目前已約 ${currentWordCount.toLocaleString()} 字`
          : '';

        if (targetChapters > 0) {
          const chState = getContinuationChapterState(latestStory, targetChapters);
          const currentChapters = chState.written;
          const remaining = getRemainingChapterCount(latestStory, targetChapters);

          if (remaining <= 0) {
            // 已達到或超過目標章節數
            isAlreadyComplete = true;
            if (endingNeedsOmake(endingForCont) && !OMAKE_RE.test(latestStory)) {
              // 番外預告：主線已完，這次專門補寫一篇完整番外篇（非編號章節）
              remainingChaptersHint = `
• 主線已完結，這次請接著補寫一篇【完整的番外篇】
• 以「### 番外：標題」為小標另起新段，不要新增「第${currentChapters + 1}章」這類編號章節${wordProgressHint}`;
            } else {
              remainingChaptersHint = `
• ⚠️【極重要】故事已達到 ${targetChapters} 章，不要再新增章節！
• 如果故事尚未有結局，請直接在目前內容後補上結局段落
• 結尾必須加上「${volCompleteMark}」標記
• 禁止新增「第${currentChapters + 1}章」或任何新章節${wordProgressHint}`;
            }
          } else if (remaining === 1) {
            // 只剩最後一章，這章必須包含結局
            isFinalChapter = true;
            remainingChaptersHint = `
• ⚠️【重要】這是最後一章（第 ${targetChapters} 章），必須在本章完成${isSeriesVol && !isFinalVol ? '本集' : '故事'}結局
• 請收束所有伏筆和劇情線，給角色一個明確的結局
• 本章結尾必須加上「${volCompleteMark}」標記${wordProgressHint}`;
          } else if (remaining === 2) {
            // 剩兩章，開始收尾
            isNearEnding = true;
            remainingChaptersHint = `
• 目標總章節數為 ${targetChapters} 章，目前已有 ${currentChapters} 章，還剩 ${remaining} 章
• 故事即將進入尾聲，請開始收束伏筆，為結局做準備${wordProgressHint}`;
          } else if (remaining > 0) {
            remainingChaptersHint = `
• 目標總章節數為 ${targetChapters} 章，目前已有 ${currentChapters} 章，還剩 ${remaining} 章待撰寫${wordProgressHint}`;
          }

          // 注入結局指令（依 phase；series 非最終集走「本集收束+引子」）
          let endingPhase = '';
          if (isAlreadyComplete) endingPhase = 'epilogue';
          else if (isFinalChapter) endingPhase = 'final';
          else if (isNearEnding) endingPhase = 'foreshadow';
          if (endingForCont && endingPhase) {
            remainingChaptersHint += getEndingDirective(endingForCont, endingPhase, {
              ...volEndOpts,
              compactStory: isCompactStoryPlan(lengthPlan) || isStoryOverWordBudget(lengthPlan, latestStory, 0.95)
            });
          }

          // 自動／逐章模式：明確指定下一章編號，降低跳章或重複標題
          if (!isAlreadyComplete && remaining > 0 && !chState.inProgress) {
            const nextCh = currentChapters + 1;
            remainingChaptersHint += `
• ⚠️【本章任務】請接續上一章，撰寫【第 ${nextCh} 章】；章節標題必須為 ### 第${nextCh}章：標題（不可跳號、不可重複上一章標題）`;
          } else if (!isAlreadyComplete && chState.inProgress) {
            remainingChaptersHint += `
• ⚠️【本章任務】上文因輸出上限被截斷，請從最末句直接接續完成【第 ${chState.inProgressChapter} 章】
• 禁止在中途插入章節標題、禁止重述已寫段落、禁止從頭重寫情節`;
            if (isStoryOverWordBudget(lengthPlan, latestStory, 0.92)) {
              remainingChaptersHint += `
• 全書已接近字數上限 ${lengthPlan.targetTotal.toLocaleString()} 字，請盡快收束本章主線，勿再鋪陳新支線`;
            }
          }
        }

        // 收集完整人物設定用於提醒（與初次生成一致，維持角色連貫）
        const { charactersInfo: contCharsInfo, characterNames, mainNames, secondaryNames } = collectCharactersInfo();
        
        // 收集所有設定用於提醒（使用已存在的元素引用）
        const currentTheme = themeSelect.value.trim();
        const currentSetting = settingSelect.value.trim();
        const currentStyle = styleSelect.value.trim();
        const currentNarrative = narrativeSelect.value.trim();
        const currentEra = eraSelect.value.trim();
        const currentPacing = pacingSelect.value.trim();
        const currentEmotionalTone = emotionalToneSelect.value.trim();
        const currentWorldComplexity = worldComplexitySelect.value.trim();
        const currentRating = ratingSelect.value.trim();
        const currentEnding = endingSelect.value.trim();
        
        // 收集特殊元素
        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          const label = item.querySelector('.element-label').textContent;
          selectedElements.push(label);
        });
        
        // 構建設定提醒
        let settingsReminder = '\n\n【必須遵守的設定提醒】\n';
        let hasSettings = false;
        
        if (currentTheme) { settingsReminder += `• 主題：${currentTheme}\n`; hasSettings = true; }
        if (currentSetting) { settingsReminder += `• 背景：${currentSetting}\n`; hasSettings = true; }
        if (currentEra) { settingsReminder += `• 時代：${currentEra}\n`; hasSettings = true; }
        if (currentStyle) { settingsReminder += `• 風格：${currentStyle}\n`; hasSettings = true; }
        if (currentNarrative) { settingsReminder += `• 視角：${currentNarrative}\n`; hasSettings = true; }
        if (currentPacing) { settingsReminder += `• 節奏：${currentPacing}\n`; hasSettings = true; }
        if (currentEmotionalTone) { settingsReminder += `• 基調：${currentEmotionalTone}\n`; hasSettings = true; }
        if (currentWorldComplexity) { settingsReminder += `• 世界觀複雜度：${currentWorldComplexity}\n`; hasSettings = true; }
        if (currentRating) { settingsReminder += `• 分級：${currentRating}\n`; hasSettings = true; }
        if (currentEnding) { settingsReminder += `• 結局傾向：${currentEnding}\n`; hasSettings = true; }
        if (selectedElements.length > 0) { settingsReminder += `• 特殊元素：${selectedElements.join('、')}\n`; hasSettings = true; }
        if (contCharsInfo) { settingsReminder += `• 登場人物設定（性格、口吻、關係須與設定一致；出場輕重見下方人物調度）：\n${contCharsInfo}`; hasSettings = true; }
        const contNotesBlock = getSupplementaryNotesBlock(getUserNotesText());
        if (contNotesBlock) { settingsReminder += contNotesBlock; hasSettings = true; }
        
        if (!hasSettings) settingsReminder = '';
        
        let characterReminder = '';
        if (mainNames.length > 0) {
          characterReminder = `
• ★★★ 確保主要角色（${mainNames.join('、')}）在後續劇情中持續發揮作用，性格與口吻保持一致`;
          if (secondaryNames.length > 0) {
            characterReminder += `\n• 配角（${secondaryNames.join('、')}）可視劇情需要登場或退場，不必每章都出現`;
          }
        }

        // 姓名清單池：續寫若有新登場角色，姓名同樣優先取自使用者清單，不足由 AI 依規則自取
        const namePoolStoryBlock = getNamePoolStoryBlock(currentSetting);
        const namePoolReminder = namePoolStoryBlock ? '\n\n' + namePoolStoryBlock.trim() : '';

        // 如果故事太長，只取最後部分來避免超出 API 限制
        // DeepSeek V4 的 context window 約 1M tokens，中文約 1 token = 1.5 字
        // 保守估計取最後 15000 字 + 設定提醒
        const MAX_CONTEXT_LENGTH = 15000;
        let storyContext = latestStory;
        let truncatedNotice = '';
        
        if (latestStory.length > MAX_CONTEXT_LENGTH) {
          // 找到一個章節的開頭來截斷，避免截在段落中間（與 countChapters 同一套行首規則）
          const chapterPattern = /^\s*#{0,4}\s*(?:第\s*[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+\s*[章節回卷部集篇]|Chapter\s*\d+)/gim;
          const chapters = [...latestStory.matchAll(chapterPattern)];
          
          if (chapters.length > 2) {
            // 從倒數第 3 章開始取
            const startChapterIndex = Math.max(0, chapters.length - 3);
            const startPosition = chapters[startChapterIndex].index;
            storyContext = latestStory.substring(startPosition);
            truncatedNotice = `（前文摘要：故事已進行到第 ${chapters.length} 章，以下是最近的內容）\n\n`;
          } else {
            // 章節太少，直接取最後部分
            storyContext = latestStory.substring(latestStory.length - MAX_CONTEXT_LENGTH);
            // 找到第一個完整段落的開頭
            const firstNewline = storyContext.indexOf('\n');
            if (firstNewline > 0 && firstNewline < 500) {
              storyContext = storyContext.substring(firstNewline + 1);
            }
            truncatedNotice = `（前文省略，以下是最近的內容）\n\n`;
          }
        }

        let truncatedResumeHint = '';
        if (truncatedResume) {
          const chState = getContinuationChapterState(latestStory, targetChapters);
          const chNow = chState.inProgress ? chState.inProgressChapter : Math.max(1, chState.written || 1);
          truncatedResumeHint = `
• ⚠️【截斷接續】上一段因輸出長度上限被截斷，請從上文最末處直接接續
• 禁止重複已寫過的句子或段落，不要重述上一段結尾
• 禁止在文中段插入「第N章」標題；若第 ${chNow} 章尚未寫完，先接續完成本章`;
          if (chState.inProgress) {
            truncatedResumeHint += `
• 上文已寫入正文但可能缺章節標題：請直接接續劇情，勿重開場、勿重寫開頭`;
          }
        }

        const continuePrompt = `【角色延續：頂尖文學創作大師】

你正在延續一部精心打磨的作品。請維持以下創作標準：

◆ 延續要訣 ◆
• 文風一致：維持已建立的敘事聲音、用詞習慣、節奏韻律
• 人物連貫：角色的說話方式、行為邏輯、成長軌跡必須前後呼應
• 伏筆收放：回應前文埋下的線索，同時為後續章節佈局
• 情緒遞進：承接上章情緒，自然過渡或對比反差

═══════════════════════════════════════
【前情回顧】
═══════════════════════════════════════

${truncatedNotice}${storyContext}${settingsReminder}

═══════════════════════════════════════
【續寫指令】
═══════════════════════════════════════

創作要求：
• 如一位資深作家般延續故事，文筆老練、情節流暢
• 運用「展示而非講述」原則，以行動、對話、細節推進劇情
${continueWordReq}
• 五感描寫營造沉浸感：環境氛圍、人物神態、情緒張力
• 對話富有潛文本，角色個性鮮明、口吻一致
• 如上章未完，先妥善收尾；新章節從上一章最末處直接接續，禁止重述已寫內容
• 章節標題格式：### 第X章：標題
• 禁止輸出書名行（# 《書名》（第X集））；正文已有書名，續寫只需章節標題
• 禁止條列說明、大綱規劃，純敘事文體
• 嚴守敘事視角、節奏基調、內容分級

◆ 一致性錨點（重要）◆
• 沿用前文已出現的人名、地名、稱謂、設定與時間線，不可改名或更動既定設定
• 維持各角色既有的性格、說話口吻與人際關係，避免前後矛盾
• 使用繁體中文（禁止簡體字與中國大陸慣用詞）

◆ 避免事項（重要）◆
• 禁用 AI 套語與陳腔濫調（如「嘴角勾起一抹弧度」「空氣彷彿凝固」「不知過了多久」等）
• 不直接說明情緒，改以神態、動作、生理反應展現
• 避免句式單調與重複開頭，長短句交錯${truncatedResumeHint}${characterReminder}${namePoolReminder}${remainingChaptersHint}

以大師級筆觸繼續創作：`;
        
        if (isAlreadyComplete) {
          showStatus('loading', '正在補上故事結局...');
        } else if (isFinalChapter) {
          showStatus('loading', '正在撰寫最終章與結局...');
        } else if (isNearEnding) {
          showStatus('loading', '續篇生成中（即將進入結局）...');
        } else {
          showStatus('loading', '續篇生成中...');
        }
        continueBtn.disabled = true;
        generateBtn.disabled = true;
        
        // 顯示生成進度並開始模擬進度條
        showGenerationProgress();
        const currentChapters = countChapters(latestStory);
        const nextChapter = currentChapters + 1;
        const totalChaptersForContinue = targetChapters > 0 ? targetChapters : (currentChapters + 3); // 預估還會有3章
        
        document.getElementById('progressChapter').textContent = `正在生成第${nextChapter}章...`;
        startSimulatedProgress(totalChaptersForContinue);

        // 手動續寫時捲到寫作區（直排不捲整頁到頁尾，串流會自動跟隨）
        if (!isAuto) {
          scrollOutputAreaIntoView();
        }

        const signal = beginGeneration();
        const baseStory = latestStory;
        let contTruncated = false;
        let contFinishReason = null;
        try {
          const continuation = (await callDeepSeek(continuePrompt, null, model, {
            signal,
            maxTokens: tokensForChapterWords(lengthPlan.wordsPerChapter),
            onChunk: (full) => { setResultStreaming(baseStory + '\n\n' + full); },
            onComplete: ({ finishReason }) => { contFinishReason = finishReason; }
          })).trim();
          
          if (continuation) {
              const cleaned = stripDuplicateBookTitleLines(baseStory, continuation);
              latestStory = baseStory + '\n\n' + cleaned;
              resultDiv.textContent = latestStory;
              persistStory(latestStory);
              
              // 更新真實進度
              const currentChapters = countChapters(latestStory);
              const wordCount = latestStory.replace(/[\s\n#*_\-]/g, '').length;
              
              // 清除模擬進度，更新真實進度
              if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
              }
              
              if (targetChapters > 0 && currentChapters > 0) {
                updateGenerationProgress(currentChapters, targetChapters, wordCount);
              } else if (currentChapters > 0) {
                document.getElementById('progressWords').textContent = `已生成 ${wordCount.toLocaleString()} 字`;
                document.getElementById('progressBarFill').style.width = '100%';
                document.getElementById('progressPercent').textContent = '100%';
              }
              
              // 檢查故事（或本集）是否已完結
              const isCompleted = isActiveStoryComplete(targetChapters);
              const isMidSeriesVol = isSeriesVol && !isFinalVol;
              const volLabelNow = isSeriesVol ? getVolumeLabel(seriesActiveIdx, storySeries.totalVolumes) : '';

              // 檢查是否已達到目標章節數
              let storyCompleted = false;
              if (isMidSeriesVol) {
                // 系列非最終集：本集完成不代表整部完結
                if (isCompleted) {
                  showStatus('success', `✅ ${volLabelNow}完成（共 ${currentChapters} 章）`);
                  storyCompleted = true; // 本集完成（由 runAutoSeries 接續下一集）
                } else if (currentChapters >= targetChapters) {
                  showStatus('success', `✅ ${volLabelNow}已達 ${targetChapters} 章，建議補上本集收束與續集引子`);
                } else {
                  showStatus('success', `${volLabelNow}續寫完成！目前 ${currentChapters}/${targetChapters} 章`);
                }
              } else if (targetChapters > 0) {
                if (isCompleted) {
                  showStatus('success', `🎉 故事完結！共 ${currentChapters} 章`);
                  storyCompleted = true;
                } else if (currentChapters >= targetChapters) {
                  // 已達到章節數但沒有合格結局（可能缺後段）
                  showStatus('success', `✅ 已達 ${targetChapters} 章，建議點擊繼續生成來補上結局`);
                } else {
                  showStatus('success', `續篇完成！目前 ${currentChapters}/${targetChapters} 章`);
                }
              } else {
                if (isCompleted) {
                  showStatus('success', '🎉 故事完結！');
                  storyCompleted = true;
                } else {
                  showStatus('success', '續篇完成！');
                }
              }
              
              // 完結後禁用繼續生成按鈕（系列非最終集：本集完成仍可由系列流程繼續，不永久禁用）
              if (storyCompleted && !isMidSeriesVol) {
                continueBtn.disabled = true;
                continueBtn.title = '故事已完結';
              } else if (storyCompleted && isMidSeriesVol) {
                // 本集完成：標記 volume.complete
                if (storySeries.volumes[seriesActiveIdx]) storySeries.volumes[seriesActiveIdx].complete = true;
                saveStorySeries();
              }
              
              const chaptersBefore = countChapters(baseStory);
              contTruncated = shouldAutoResumeSegment(contFinishReason, latestStory, lengthPlan, { isAlreadyComplete });
              genResult = {
                ok: true,
                chaptersAdded: currentChapters - chaptersBefore,
                truncated: contTruncated,
                wordAdded: latestStory.length - baseStory.length
              };
              
              // 更新字數統計
              updateWordCount(latestStory);
              
              // 短暫延遲後隱藏進度條（可被續章取消）
              scheduleHideProgress(1000);
              
              downloadBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
              parseAndShowChapters(latestStory);
          } else {
            showStatus('error', '沒有獲得續篇內容，可能已完結');
            genResult = { ok: false, reason: 'empty' };
          }
        } catch (err) {
          if (err.name === 'AbortError' || userAborted) {
            // 已停止：保留已串流的續寫內容
            const partial = resultDiv.textContent.trim();
            if (partial && partial.length > baseStory.length) {
              latestStory = partial;
              persistStory(latestStory);
              updateWordCount(latestStory);
              parseAndShowChapters(latestStory);
              downloadBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
              showStatus('info', '⏹ 已停止，已保留生成的內容');
            } else {
              resultDiv.textContent = baseStory;
              showStatus('info', '⏹ 已停止生成');
            }
            hideGenerationProgress();
            genResult = { ok: false, aborted: true };
          } else {
            // 非中斷錯誤：若已串流出比原文更長的續寫內容，先保留下來避免遺失（重試已於 callDeepSeek 停用）
            const partial = resultDiv.textContent.trim();
            const partialAdded = partial && partial.length > baseStory.length;
            if (partialAdded) {
              latestStory = partial;
              persistStory(latestStory);
              updateWordCount(latestStory);
              parseAndShowChapters(latestStory);
              downloadBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
            }
            // 針對不同錯誤給予不同提示
            const errorMsg = err.message || '';
            if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('network')) {
              showStatus('error', '⚠️ 網路連線失敗，請檢查網路後重試');
            } else if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
              showStatus('error', '⚠️ 請求超時，請稍後重試');
            } else {
              showStatus('error', '續寫失敗：' + errorMsg);
            }
            hideGenerationProgress();
            genResult = {
              ok: partialAdded,
              reason: partialAdded ? 'partial' : 'error',
              error: errorMsg,
              wordAdded: partialAdded ? partial.length - baseStory.length : 0
            };
          }
        } finally {
          endGeneration();
          // 如果故事未完結（或為系列非最終集）才重新啟用按鈕
          const finalDone = isActiveStoryComplete(targetChapters) && isFinalVol;
          if (!finalDone) {
            continueBtn.disabled = false;
          }
          generateBtn.disabled = false;
        }
        return genResult;
      }

      // 自動連續生成：依目標章節數，自動接續產生直到完成或達標
      function isAutoContinueEnabled() {
        const el = document.getElementById('autoContinueToggle');
        return !!(el && el.checked);
      }

      let autoContinueRunning = false;
      const AUTO_CHAPTER_DELAY_MS = 1200;
      const AUTO_CONTINUE_MAX_FAILS = 3;

      /** 自動模式單章生成（含短暫重試，應對限流／空回應） */
      async function autoContinueOneChapter() {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (userAborted || seriesAborted) return { ok: false, aborted: true };
          const beforeCh = countChapters(latestStory);
          const beforeLen = latestStory.length;
          const res = await doContinueGenerationWithAutoResume({ auto: true });
          if (userAborted || seriesAborted) return { ok: false, aborted: true };
          if (res.aborted) return res;
          const afterCh = countChapters(latestStory);
          const wordAdded = latestStory.length - beforeLen;
          const progressed = res.ok || afterCh > beforeCh || wordAdded > 150 || res.truncated;
          if (progressed) {
            return {
              ok: true,
              chaptersAdded: afterCh - beforeCh,
              truncated: !!res.truncated,
              wordAdded
            };
          }
          if (attempt < maxRetries) {
            await sleep(1200 * (attempt + 1));
            showStatus('loading', `第 ${beforeCh + 1} 章生成失敗，重試中 (${attempt + 2}/${maxRetries + 1})...`);
          }
        }
        return { ok: false, reason: 'max_retries' };
      }

      // 作用中故事（或系列分集）是否已完成（series 非最終集用 isVolumeComplete，見錯誤3/5）
      function isActiveStoryComplete(targetCount) {
        const seriesVol = !!(storySeries && storySeries.totalVolumes > 1);
        const finalVol = !seriesVol || (storySeries.activeVolumeIndex >= storySeries.totalVolumes - 1);
        const ending = endingSelect ? endingSelect.value.trim() : '';
        if (seriesVol && !finalVol) return isVolumeComplete(latestStory, targetCount);
        // closed/coda/最終集：完結標記為基礎；coda/series 最終集再要求 ② 後段
        if (!STORY_COMPLETE_RE.test(latestStory) && !SERIES_COMPLETE_RE.test(latestStory)) return false;
        return isEndingSatisfied(latestStory, ending, {
          isSeriesVolume: seriesVol,
          isFinalVolume: finalVol,
          compactStory: isCompactStoryPlan(getStoryLengthPlan())
        });
      }

      async function runAutoContinue(targetCount, opts = {}) {
        if (autoContinueRunning) return;
        autoContinueRunning = true;
        try {
          let guard = 0;
          let failStreak = 0;
          // 階段1：逐章生成直到達章數或已完成
          while (guard++ < 200) {
            if (userAborted || seriesAborted) break;
            if (isActiveStoryComplete(targetCount)) break;
            const before = countChapters(latestStory);
            if (targetCount > 0 && getRemainingChapterCount(latestStory, targetCount) <= 0) break;
            const nextCh = before + 1;
            showStatus('loading', `📝 自動生成第 ${nextCh}${targetCount > 0 ? `/${targetCount}` : ''} 章...`);
            await sleep(AUTO_CHAPTER_DELAY_MS);
            const result = await autoContinueOneChapter();
            if (userAborted || seriesAborted) break;
            if (result.aborted) break;
            if (result.ok) {
              failStreak = 0;
              if (result.truncated) continue;
              const after = countChapters(latestStory);
              if (after <= before && (result.wordAdded || 0) < 200) {
                failStreak++;
                if (failStreak >= AUTO_CONTINUE_MAX_FAILS) {
                  showStatus('error', `⚠️ 第 ${nextCh} 章連續無進展，已暫停。可手動點「繼續生成」再接續。`);
                  break;
                }
              }
              continue;
            }
            failStreak++;
            if (failStreak >= AUTO_CONTINUE_MAX_FAILS) {
              showStatus('error', `⚠️ 自動生成連續失敗 ${failStreak} 次，已暫停。可手動點「繼續生成」再接續。`);
              break;
            }
            await sleep(2000);
          }
          // 階段2：達標但尚無合格結局（缺 ② 後段）→ 補結局，最多 3 次
          let epi = 0;
          let epiFails = 0;
          const lengthPlan = getStoryLengthPlan();
          while (!userAborted && !seriesAborted && epi++ < 3 &&
                 targetCount > 0 && getRemainingChapterCount(latestStory, targetCount) <= 0 &&
                 !isActiveStoryComplete(targetCount)) {
            if (isStoryOverWordBudget(lengthPlan, latestStory, 1.15)) break;
            showStatus('loading', '📝 自動補寫結局...');
            await sleep(AUTO_CHAPTER_DELAY_MS);
            const result = await autoContinueOneChapter();
            if (result.aborted) break;
            if (result.ok) epiFails = 0;
            else {
              epiFails++;
              if (epiFails >= 2) break;
            }
          }
          if (!userAborted && !opts.silentFinish) {
            const total = countChapters(latestStory);
            const words = countStoryWords(latestStory);
            const gap = formatWordTargetGap(getStoryLengthPlan(), words);
            if (isActiveStoryComplete(targetCount)) {
              showStatus('success', `🎉 自動生成完成，共 ${total} 章${gap ? ' ' + gap : ''}`);
            } else {
              showStatus('success', `✅ 自動生成結束，共 ${total} 章${gap ? ' ' + gap : ''}（可手動繼續生成補完）`);
            }
          }
        } finally {
          autoContinueRunning = false;
        }
      }

      // ==================== 系列：可 await 的整集生成與自動全系列 ====================
      /** 透過 generateBtn 流程完整生成「本集第1章」（或 1~2 章一次性整集），並等待完成 */
      function awaitableGenerate() {
        return new Promise((resolve) => {
          generateDoneResolver = resolve;
          // 直接呼叫 handler（click 會經過驗證攔截器，這裡用 click 以沿用既有驗證）
          generateBtn.click();
        });
      }

      /** 推進到下一集並全新生成其第1章（前集正文作接續錨點） */
      async function startNextVolume() {
        if (!storySeries) return false;
        const curIdx = storySeries.activeVolumeIndex;
        const nextIdx = curIdx + 1;
        if (nextIdx >= storySeries.totalVolumes) return false;
        if (latestStory && storySeries.volumes[curIdx]) {
          storySeries.volumes[curIdx].content = latestStory;
          storySeries.volumes[curIdx].complete = true;
          if (!storySeries.volumes[curIdx].title) {
            storySeries.volumes[curIdx].title = stripVolumeSuffix(extractBookTitle(latestStory)) || storySeries.volumes[curIdx].title;
          }
          saveStorySeries();
        }
        storySeries.activeVolumeIndex = nextIdx;
        saveStorySeries();
        renderSeriesBar();
        generatingNextVolume = true;
        try {
          await awaitableGenerate();
        } finally {
          generatingNextVolume = false;
        }
        return true;
      }

      /**
       * 自動全系列：把目前集寫完→開下一集→…直到最後一集（錯誤9/10/11/15）。
       * 進入時目前集的第1章（或整集）已由 generateBtn 流程產出。
       */
      async function runAutoSeries(targetCount) {
        if (seriesRunning) return;        // 鎖併發（錯誤10）
        if (!storySeries) return;
        seriesRunning = true;
        seriesAborted = false;            // 系列級旗標於此重置（錯誤11）
        try {
          while (!seriesAborted) {
            const idx = storySeries.activeVolumeIndex;
            const isFinal = idx >= storySeries.totalVolumes - 1;
            const label = getVolumeLabel(idx, storySeries.totalVolumes) || `第${idx + 1}集`;
            // 若本集尚未完成（章數不足或缺收束）→ 用逐章自動接續把本集寫完
            // 1~2 章為一次性生成，多半進來就已完成，isActiveStoryComplete 會直接通過（錯誤9）
            if (!isActiveStoryComplete(targetCount)) {
              showStatus('loading', `📖 自動生成${label}中...`);
              await runAutoContinue(targetCount, { silentFinish: true });
            }
            if (seriesAborted) break;
            // 標記本集完成
            if (storySeries.volumes[idx]) {
              storySeries.volumes[idx].complete = true;
              storySeries.volumes[idx].title = stripVolumeSuffix(extractBookTitle(latestStory)) || storySeries.volumes[idx].title;
            }
            saveStorySeries();
            renderSeriesBar();
            if (isFinal) {
              showStatus('success', `🎉 全系列完成！共 ${storySeries.totalVolumes} 集`);
              break;
            }
            // 開下一集
            showStatus('loading', `✅ ${label}完成，準備生成下一集...`);
            const ok = await startNextVolume();
            if (!ok || seriesAborted) break;
          }
        } catch (err) {
          // 系列級錯誤處理（錯誤15）
          if (err && (err.name === 'AbortError')) {
            showStatus('info', '⏹ 已停止系列生成');
          } else {
            showStatus('error', '系列生成發生錯誤：' + (err && err.message ? err.message : '未知錯誤'));
          }
        } finally {
          seriesRunning = false;
          renderSeriesBar();
        }
      }

      // ==================== 系列分集 UI ====================
      function renderSeriesBar() {
        const bar = document.getElementById('seriesBar');
        if (!bar) return;
        if (!storySeries || !(storySeries.totalVolumes > 1)) {
          bar.style.display = 'none';
          bar.innerHTML = '';
          return;
        }
        const total = storySeries.totalVolumes;
        const active = storySeries.activeVolumeIndex;
        const chips = storySeries.volumes.map((v, i) => {
          const label = v.label || getVolumeLabel(i, total);
          const cls = ['series-chip'];
          if (i === active) cls.push('active');
          if (v.complete) cls.push('done');
          const mark = v.complete ? '✓' : (i === active ? '✎' : '·');
          return `<button type="button" class="${cls.join(' ')}" data-vol="${i}" title="切換到${label}">${mark} ${label}</button>`;
        }).join('');
        const seriesName = storySeries.seriesTitle ? `《${storySeries.seriesTitle}》` : '本系列';
        const activeVol = storySeries.volumes[active];
        const canStartNext = !seriesRunning && !currentAbortController &&
          active < total - 1 && activeVol && activeVol.complete &&
          !(storySeries.volumes[active + 1] && storySeries.volumes[active + 1].content);
        const nextBtn = canStartNext
          ? `<button type="button" id="seriesNextVol" class="series-mini-btn">＋ 生成下一集</button>` : '';
        bar.innerHTML =
          `<div class="series-bar-info">📚 ${seriesName}（共 ${total} 集）</div>` +
          `<div class="series-chips">${chips}</div>` +
          `<div class="series-actions">` +
            nextBtn +
            `<button type="button" id="seriesDownloadVol" class="series-mini-btn">下載本集</button>` +
            `<button type="button" id="seriesDownloadAll" class="series-mini-btn">合併下載全系列</button>` +
          `</div>`;
        bar.style.display = 'flex';

        bar.querySelectorAll('.series-chip').forEach(btn => {
          btn.addEventListener('click', () => switchToVolume(parseInt(btn.dataset.vol, 10)));
        });
        const dN = document.getElementById('seriesNextVol');
        const dV = document.getElementById('seriesDownloadVol');
        const dA = document.getElementById('seriesDownloadAll');
        if (dN) dN.addEventListener('click', () => { startNextVolume(); });
        if (dV) dV.addEventListener('click', downloadActiveVolume);
        if (dA) dA.addEventListener('click', downloadWholeSeries);
      }

      function switchToVolume(idx) {
        if (!storySeries || idx === storySeries.activeVolumeIndex) return;
        if (seriesRunning || currentAbortController) {
          showStatus('warning', '生成進行中，請先停止再切換集數');
          return;
        }
        // 先把目前內容同步回原集
        if (latestStory) persistStory(latestStory);
        storySeries.activeVolumeIndex = idx;
        saveStorySeries();
        const vol = storySeries.volumes[idx];
        latestStory = (vol && vol.content) || '';
        resultDiv.textContent = latestStory;
        try { localStorage.setItem('savedStory', latestStory); } catch (e) {}
        updateWordCount(latestStory);
        parseAndShowChapters(latestStory);
        const has = !!latestStory;
        downloadBtn.disabled = !has;
        continueBtn.disabled = !has;
        speakBtn.disabled = !has; bookReaderBtn.disabled = !has;
        renderSeriesBar();
        const label = getVolumeLabel(idx, storySeries.totalVolumes);
        showStatus('info', `已切換到${label}`);
      }

      function buildSeriesMergedText() {
        if (!storySeries) return latestStory;
        const base = storySeries.seriesTitle ? `《${storySeries.seriesTitle}》` : '';
        const parts = [];
        storySeries.volumes.forEach((v, i) => {
          if (!v.content) return;
          const label = v.label || getVolumeLabel(i, storySeries.totalVolumes);
          parts.push(`\n\n═══════════ ${base}${label} ═══════════\n\n${v.content.trim()}`);
        });
        return parts.join('\n\n').trim();
      }

      /**
       * 將目前系列以單一書籤 upsert 進書櫃（依 storySeries.id 找既有書）。
       * 整個系列＝一本書（內含全部分集）；番外含在所屬集的 content 內。
       */
      function upsertSeriesBookmark() {
        if (!storySeries || !(storySeries.totalVolumes > 1)) return;
        const hasContent = storySeries.volumes.some(v => v.content && v.content.trim());
        if (!hasContent) return;
        try {
          const list = loadBookmarks();
          const merged = buildSeriesMergedText();
          const title = storySeries.seriesTitle
            || stripVolumeSuffix(extractBookTitle(latestStory))
            || '系列小說';
          const base = {
            kind: 'series',
            seriesId: storySeries.id,
            seriesTitle: storySeries.seriesTitle || title,
            totalVolumes: storySeries.totalVolumes,
            activeVolumeIndex: storySeries.activeVolumeIndex,
            volumes: storySeries.volumes.map(v => ({
              index: v.index,
              label: v.label,
              title: v.title || '',
              content: v.content || '',
              complete: !!v.complete
            })),
            content: merged
          };
          const idx = list.findIndex(b => b.seriesId && b.seriesId === storySeries.id);
          if (idx >= 0) {
            const ex = list[idx];
            // 沿用既有 id / tags / notes；title 在使用者編輯前持續跟隨系列書名
            list[idx] = Object.assign({}, ex, base, {
              title: ex.titleEdited ? ex.title : base.seriesTitle
            });
          } else {
            list.push(Object.assign({ id: Date.now(), title: base.seriesTitle, tags: [], notes: '' }, base));
          }
          saveBookmarks(list);
          if (typeof renderBookmarks === 'function') renderBookmarks();
        } catch (e) {
          console.warn('系列自動存書失敗：', e);
        }
      }

      function downloadActiveVolume() {
        const label = getVolumeLabel(storySeries.activeVolumeIndex, storySeries.totalVolumes);
        const base = storySeries.seriesTitle || themeSelect.value || '生成小說';
        const name = `${base}_${label}`.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
        downloadFile(name, latestStory || '');
      }

      function downloadWholeSeries() {
        const base = storySeries.seriesTitle || themeSelect.value || '生成小說';
        const name = `${base}_全系列`.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
        downloadFile(name, buildSeriesMergedText());
      }

      // ==================== 下載功能 ====================
      function downloadFile(filename, text, mimeType = 'text/plain') {
        const link = document.createElement('a');
        link.setAttribute('href', `data:${mimeType};charset=utf-8,` + encodeURIComponent(text));
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      function generateFilename(extension = 'txt') {
        // 取得主題
        const theme = themeSelect.value || '';
        
        // 取得所有人物名字
        const characterRows = Array.from(charactersContainer.querySelectorAll('.character-row'));
        const names = characterRows
          .map(row => row.querySelector('.char-name').value.trim())
          .filter(name => name !== '');
        
        // 嘗試從故事內容中提取標題（通常在開頭有 ## 標題 格式）
        let storyTitle = '';
        if (latestStory) {
          // 優先使用開頭的書名行「# 《書名》」，其次退回首個 ## 標題（通常為第一章標題）
          const bookTitleMatch = latestStory.match(/^#\s+(.+)$/m);
          const titleMatch = bookTitleMatch || latestStory.match(/##\s*([^\n#]+)/);
          if (titleMatch) {
            storyTitle = titleMatch[1].replace(/[《》【】]/g, '').trim();
          }
        }
        
        // 組合檔名
        let filename = '';
        
        // 優先使用故事標題
        if (storyTitle) {
          filename = storyTitle;
        } else if (theme) {
          filename = theme;
        } else {
          filename = '生成小說';
        }
        
        // 加入人物名字（最多3個）
        if (names.length > 0) {
          const displayNames = names.slice(0, 3).join('、');
          filename += `_${displayNames}`;
          if (names.length > 3) {
            filename += '等';
          }
        }
        
        // 移除不適合檔名的字元
        filename = filename.replace(/[\\/:*?"<>|]/g, '_');
        
        return filename + '.' + extension;
      }

      // 生成手機閱讀版 HTML（完全離線可用）
      function generateMobileHTML(text) {
        // 提取標題：優先開頭書名行「# 《書名》」，其次退回首個 ## 標題
        let title = '小說閱讀';
        const bookTitleMatch = text.match(/^#\s+(.+)$/m);
        const titleMatch = bookTitleMatch || text.match(/##\s*([^\n#]+)/);
        if (titleMatch) {
          title = titleMatch[1].replace(/[《》【】]/g, '').trim();
        }
        
        // 處理文字內容
        // 1. 將 ### 標題轉為 HTML 標籤
        // 2. 將段落轉為 <p> 標籤
        // 3. 保留空行作為段落分隔
        
        let processedContent = text
          // 章節標題 (### 第X章：標題)
          .replace(/^###\s*(.+)$/gm, '<h2 class="chapter-title">$1</h2>')
          // 主標題 (## 標題)
          .replace(/^##\s*(.+)$/gm, '<h1 class="main-title">$1</h1>')
          // 分隔線
          .replace(/^[-—]{3,}$/gm, '<hr class="divider">')
          // 粗體
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          // 斜體
          .replace(/\*(.+?)\*/g, '<em>$1</em>');
        
        // 將連續文字轉為段落
        const lines = processedContent.split('\n');
        let htmlContent = '';
        let currentParagraph = '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          if (trimmed === '') {
            // 空行：結束當前段落
            if (currentParagraph) {
              htmlContent += `<p>${currentParagraph}</p>\n`;
              currentParagraph = '';
            }
          } else if (trimmed.startsWith('<h1') || trimmed.startsWith('<h2') || trimmed.startsWith('<hr')) {
            // 已處理的 HTML 標籤：先結束當前段落，再添加標籤
            if (currentParagraph) {
              htmlContent += `<p>${currentParagraph}</p>\n`;
              currentParagraph = '';
            }
            htmlContent += trimmed + '\n';
          } else {
            // 普通文字：累加到當前段落
            currentParagraph += (currentParagraph ? '' : '') + trimmed;
          }
        }
        
        // 處理最後一個段落
        if (currentParagraph) {
          htmlContent += `<p>${currentParagraph}</p>\n`;
        }
        
        // 計算字數
        const wordCount = text.replace(/[\\s\\n#*_\\-]/g, '').length;
        const wordCountDisplay = wordCount >= 10000 
          ? (wordCount / 10000).toFixed(1) + ' 萬字'
          : wordCount >= 1000 
            ? (wordCount / 1000).toFixed(1) + ' 千字'
            : wordCount + ' 字';
        
        // 生成完整的離線 HTML
        return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="theme-color" content="#faf8f5">
  <title>${title}</title>
  <style>
    /* ===== 基礎重置 ===== */
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    
    /* ===== CSS 變數（支援深色模式）===== */
    :root {
      --bg: #faf8f5;
      --bg-card: #ffffff;
      --text: #2c2c2c;
      --text-light: #666666;
      --accent: #d4a574;
      --border: #e8e4e0;
      --shadow: rgba(0, 0, 0, 0.06);
    }
    
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --bg-card: #242424;
        --text: #e8e4e0;
        --text-light: #999999;
        --accent: #d4a574;
        --border: #333333;
        --shadow: rgba(0, 0, 0, 0.3);
      }
    }
    
    /* ===== 主體樣式 ===== */
    html {
      scroll-behavior: smooth;
    }
    
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 
        "Noto Serif TC", 
        "Source Han Serif TC", 
        "PingFang TC", 
        "Microsoft JhengHei", 
        "微軟正黑體",
        "Apple LiGothic",
        serif;
      font-size: 18px;
      line-height: 1.9;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    /* ===== 頂部資訊欄 ===== */
    .header {
      position: sticky;
      top: 0;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
      box-shadow: 0 2px 8px var(--shadow);
    }
    
    .header-title {
      font-size: 14px;
      color: var(--text-light);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 60%;
    }
    
    .header-info {
      font-size: 12px;
      color: var(--text-light);
    }
    
    /* ===== 控制面板 ===== */
    .controls {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 100;
    }
    
    .control-btn {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: var(--bg-card);
      color: var(--text);
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px var(--shadow);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .control-btn:active {
      transform: scale(0.95);
    }
    
    /* ===== 設定面板 ===== */
    .settings-panel {
      display: none;
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: var(--bg-card);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 8px 32px var(--shadow);
      z-index: 101;
      min-width: 200px;
    }
    
    .settings-panel.show {
      display: block;
      animation: slideUp 0.3s ease;
    }
    
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .setting-item {
      margin-bottom: 16px;
    }
    
    .setting-item:last-child {
      margin-bottom: 0;
    }
    
    .setting-label {
      display: block;
      font-size: 13px;
      color: var(--text-light);
      margin-bottom: 8px;
    }
    
    .setting-buttons {
      display: flex;
      gap: 8px;
    }
    
    .setting-btn {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .setting-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    
    /* ===== 內容區域 ===== */
    .content {
      max-width: 700px;
      margin: 0 auto;
      padding: 30px 24px 100px;
    }
    
    /* ===== 標題樣式 ===== */
    .main-title {
      font-size: 1.6em;
      font-weight: 700;
      text-align: center;
      margin: 0 0 30px 0;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--accent);
      color: var(--text);
      line-height: 1.4;
    }
    
    .chapter-title {
      font-size: 1.25em;
      font-weight: 600;
      margin: 50px 0 25px 0;
      padding: 15px 0;
      color: var(--text);
      border-left: 4px solid var(--accent);
      padding-left: 16px;
      background: linear-gradient(90deg, var(--bg-card), transparent);
    }
    
    /* ===== 段落樣式 ===== */
    p {
      margin: 0 0 1.5em 0;
      text-align: justify;
      text-indent: 2em;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    
    /* ===== 分隔線 ===== */
    .divider {
      border: none;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--border), transparent);
      margin: 40px 0;
    }
    
    /* ===== 強調樣式 ===== */
    strong {
      color: var(--accent);
      font-weight: 600;
    }
    
    em {
      font-style: italic;
      color: var(--text-light);
    }
    
    /* ===== 回到頂部按鈕 ===== */
    .back-to-top {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }
    
    .back-to-top.show {
      opacity: 1;
      pointer-events: auto;
    }
    
    /* ===== 字體大小變化 ===== */
    body.font-small {
      font-size: 16px;
    }
    
    body.font-medium {
      font-size: 18px;
    }
    
    body.font-large {
      font-size: 21px;
    }
    
    body.font-xlarge {
      font-size: 24px;
    }
    
    /* ===== 行距變化 ===== */
    body.line-compact {
      line-height: 1.6;
    }
    
    body.line-normal {
      line-height: 1.9;
    }
    
    body.line-loose {
      line-height: 2.2;
    }
    
    /* ===== 響應式調整 ===== */
    @media (max-width: 480px) {
      body {
        font-size: 17px;
      }
      
      .content {
        padding: 20px 18px 100px;
      }
      
      .main-title {
        font-size: 1.4em;
      }
      
      .chapter-title {
        font-size: 1.15em;
      }
    }
    
    /* ===== 閱讀進度條 ===== */
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--accent);
      width: 0%;
      z-index: 1000;
      transition: width 0.1s;
    }
  </style>
</head>
<body class="font-medium line-normal">
  <!-- 閱讀進度條 -->
  <div class="progress-bar" id="progressBar"></div>
  
  <!-- 頂部資訊欄 -->
  <header class="header">
    <h1 class="header-title">${title}</h1>
    <span class="header-info">${wordCountDisplay}</span>
  </header>
  
  <!-- 主要內容 -->
  <main class="content">
    ${htmlContent}
  </main>
  
  <!-- 控制按鈕 -->
  <div class="controls">
    <button class="control-btn back-to-top" id="backToTop" title="回到頂部">↑</button>
    <button class="control-btn" id="settingsBtn" title="閱讀設定">⚙</button>
  </div>
  
  <!-- 設定面板 -->
  <div class="settings-panel" id="settingsPanel">
    <div class="setting-item">
      <span class="setting-label">字體大小</span>
      <div class="setting-buttons">
        <button class="setting-btn" data-font="small">小</button>
        <button class="setting-btn active" data-font="medium">中</button>
        <button class="setting-btn" data-font="large">大</button>
        <button class="setting-btn" data-font="xlarge">特大</button>
      </div>
    </div>
    <div class="setting-item">
      <span class="setting-label">行距</span>
      <div class="setting-buttons">
        <button class="setting-btn" data-line="compact">緊湊</button>
        <button class="setting-btn active" data-line="normal">標準</button>
        <button class="setting-btn" data-line="loose">寬鬆</button>
      </div>
    </div>
  </div>
  
  <` + `script>
    // 閱讀進度
    const progressBar = document.getElementById('progressBar');
    const backToTop = document.getElementById('backToTop');
    
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = (scrollTop / docHeight) * 100;
      progressBar.style.width = progress + '%';
      
      // 顯示/隱藏回到頂部按鈕
      if (scrollTop > 500) {
        backToTop.classList.add('show');
      } else {
        backToTop.classList.remove('show');
      }
    });
    
    // 回到頂部
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // 設定面板
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    
    settingsBtn.addEventListener('click', () => {
      settingsPanel.classList.toggle('show');
    });
    
    // 點擊外部關閉設定面板
    document.addEventListener('click', (e) => {
      if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        settingsPanel.classList.remove('show');
      }
    });
    
    // 字體大小設定
    document.querySelectorAll('[data-font]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-font]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
        document.body.classList.add('font-' + btn.dataset.font);
        
        // 儲存設定
        localStorage.setItem('reader-font', btn.dataset.font);
      });
    });
    
    // 行距設定
    document.querySelectorAll('[data-line]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-line]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.body.classList.remove('line-compact', 'line-normal', 'line-loose');
        document.body.classList.add('line-' + btn.dataset.line);
        
        // 儲存設定
        localStorage.setItem('reader-line', btn.dataset.line);
      });
    });
    
    // 載入已儲存的設定
    const savedFont = localStorage.getItem('reader-font');
    const savedLine = localStorage.getItem('reader-line');
    
    if (savedFont) {
      document.querySelectorAll('[data-font]').forEach(b => b.classList.remove('active'));
      const fontBtn = document.querySelector('[data-font="' + savedFont + '"]');
      if (fontBtn) {
        fontBtn.classList.add('active');
        document.body.classList.remove('font-small', 'font-medium', 'font-large', 'font-xlarge');
        document.body.classList.add('font-' + savedFont);
      }
    }
    
    if (savedLine) {
      document.querySelectorAll('[data-line]').forEach(b => b.classList.remove('active'));
      const lineBtn = document.querySelector('[data-line="' + savedLine + '"]');
      if (lineBtn) {
        lineBtn.classList.add('active');
        document.body.classList.remove('line-compact', 'line-normal', 'line-loose');
        document.body.classList.add('line-' + savedLine);
      }
    }
  <` + `/script>
</body>
</html>`;
      }

      // 下載功能函數
      function downloadAsTxt() {
        if (!latestStory) return;
        const optimizedTxt = optimizeTxtForMobile(latestStory);
        const filename = generateFilename('txt');
        downloadFile(filename, optimizedTxt, 'text/plain');
        showStatus('success', `📄 已下載 ${filename}`);
      }

      function downloadAsHtml() {
        if (!latestStory) return;
        const htmlContent = generateMobileHTML(latestStory);
        const filename = generateFilename('html');
        downloadFile(filename, htmlContent, 'text/html');
        showStatus('success', `📱 已下載 ${filename}（手機閱讀版）`);
      }

      function generateSingleNovelFilename(bookmark, extension = 'txt') {
        const content = bookmark.content || '';
        const headingMatch = content.match(/^\s*#{1,4}\s*([^\n#]+)/m);
        let title = (bookmark.title || (headingMatch && headingMatch[1]) || '單部小說').trim();
        title = title.replace(/\s+/g, ' ').replace(/[\\/:*?"<>|]/g, '_').substring(0, 80);
        return `${title || '單部小說'}.${extension}`;
      }

      function downloadSingleNovel(bookmark) {
        const content = (bookmark.content || '').replace(/\uFFFD/g, '');
        if (!content.trim()) {
          showStatus('error', '這部小說沒有可下載的內容');
          return;
        }
        const optimizedTxt = optimizeTxtForMobile(content);
        const filename = generateSingleNovelFilename(bookmark, 'txt');
        downloadFile(filename, optimizedTxt, 'text/plain');
        showStatus('success', `📄 已下載單部小說：${filename}`);
      }

      // 將小說正文整理為適合 TXT 閱讀／朗讀器的格式：段落分明、段間空行、段內不強制斷行
      function splitLongTextIntoParagraphs(text) {
        text = text.trim();
        if (!text) return [];
        if (text.length <= 120) return [text];

        const sentences = text.split(/(?<=[。！？…」』】）])/).map(s => s.trim()).filter(Boolean);
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

      function isChapterHeadingLine(line) {
        return /^(?:第[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+[章節回卷部集篇]|序章|楔子|引子|前言|尾聲|終章|番外|後記)/.test(line);
      }

      function optimizeTxtForMobile(text) {
        if (!text) return '';

        text = text.replace(/\uFFFD/g, '').replace(/\r\n/g, '\n').trim();
        const outputParts = [];

        const pushBody = (raw) => {
          const cleaned = raw.trim();
          if (!cleaned || /^[-—=─━═]{3,}$/.test(cleaned)) return;
          if (cleaned.length > 150) {
            splitLongTextIntoParagraphs(cleaned).forEach(p => outputParts.push({ kind: 'body', text: p }));
          } else {
            outputParts.push({ kind: 'body', text: cleaned });
          }
        };

        // 先依空行分大段，再依單行拆段；長段無換行時改依句號切分
        const coarseBlocks = text.split(/\n{2,}/);
        for (const block of coarseBlocks) {
          const trimmedBlock = block.trim();
          if (!trimmedBlock || /^[-—=─━═]{3,}$/.test(trimmedBlock)) continue;

          const lines = trimmedBlock.split('\n')
            .map(line => line.trim().replace(/^#{1,4}\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim())
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

        // 全文完全沒有換行時的保底處理
        if (outputParts.length === 0) {
          const plain = text.replace(/^#{1,4}\s*/gm, '').replace(/\n+/g, '');
          splitLongTextIntoParagraphs(plain).forEach(p => outputParts.push({ kind: 'body', text: p }));
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

      // ==================== 書籤功能 (大幅優化) ====================
      // ==================== IndexedDB 書籤儲存 ====================
      const DB_NAME = 'NovelGeneratorDB';
      const DB_VERSION = 3;  // v3：新增故事儲存區
      const STORE_NAME = 'bookmarks';
      const STORY_STORE_NAME = 'stories';  // 故事正文儲存區（避免 localStorage 容量上限）
      let db = null;

      // 初始化 IndexedDB
      function initDB() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          
          request.onerror = () => {
            console.error('IndexedDB 開啟失敗，嘗試使用 localStorage');
            resolve(false);
          };
          
          request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB 初始化成功');
            resolve(true);
          };
          
          request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
              database.createObjectStore(STORE_NAME, { keyPath: 'id' });
              console.log('建立書籤儲存區');
            }
            if (!database.objectStoreNames.contains(STORY_STORE_NAME)) {
              database.createObjectStore(STORY_STORE_NAME, { keyPath: 'id' });
              console.log('建立故事儲存區');
            }
          };
        });
      }

      // ==================== 故事持久化（IndexedDB + localStorage 後備）====================
      // 將目前故事存入 IndexedDB（容量大，避免 localStorage 上限）
      function saveStoryToDB(text) {
        if (!db) return;
        try {
          const tx = db.transaction([STORY_STORE_NAME], 'readwrite');
          tx.objectStore(STORY_STORE_NAME).put({ id: 'current_story', text: text, savedAt: new Date().toISOString() });
        } catch (e) {
          console.warn('故事寫入 IndexedDB 失敗：', e);
        }
      }

      // 從 IndexedDB 載入故事
      function loadStoryFromDB() {
        return new Promise((resolve) => {
          if (!db) { resolve(null); return; }
          try {
            const tx = db.transaction([STORY_STORE_NAME], 'readonly');
            const req = tx.objectStore(STORY_STORE_NAME).get('current_story');
            req.onsuccess = () => resolve(req.result ? req.result.text : null);
            req.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      }

      // 同時寫入 localStorage（快速載入用）與 IndexedDB（durable）
      function persistStory(text) {
        // IndexedDB：主要的耐久儲存，容量大
        saveStoryToDB(text);
        // localStorage：快速載入用；過大時可能失敗，失敗不影響 IndexedDB
        try {
          localStorage.setItem('savedStory', text);
        } catch (e) {
          console.warn('故事過長，localStorage 已略過（IndexedDB 仍會保留）');
        }
        // 系列：唯一同步點 — 把目前內容寫回作用中的集（見錯誤8）
        if (storySeries && Array.isArray(storySeries.volumes)) {
          const vol = storySeries.volumes[storySeries.activeVolumeIndex];
          if (vol) {
            vol.content = text;
            if (!storySeries.seriesTitle) {
              const t = stripVolumeSuffix(extractBookTitle(text));
              if (t) storySeries.seriesTitle = t;
            }
          }
          saveStorySeries();
          // 系列自動存書：整個系列存成書櫃裡的一本，隨進度更新（per-chapter 觸發）
          if (storySeries.totalVolumes > 1) upsertSeriesBookmark();
        }
      }

      // 從 IndexedDB 載入所有書籤
      function loadBookmarksFromDB() {
        return new Promise((resolve) => {
          if (!db) {
            resolve([]);
            return;
          }
          
          const transaction = db.transaction([STORE_NAME], 'readonly');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.getAll();
          
          request.onsuccess = () => {
            console.log('從 IndexedDB 載入書籤數量：', request.result.length);
            resolve(request.result || []);
          };
          
          request.onerror = () => {
            console.error('載入書籤失敗');
            resolve([]);
          };
        });
      }

      // 儲存書籤到 IndexedDB
      function saveBookmarksToDB(bookmarks) {
        return new Promise((resolve) => {
          if (!db) {
            resolve(false);
            return;
          }
          
          const transaction = db.transaction([STORE_NAME], 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          
          // 先清空再寫入
          const clearRequest = store.clear();
          
          clearRequest.onsuccess = () => {
            let addedCount = 0;
            bookmarks.forEach(bm => {
              const addRequest = store.add(bm);
              addRequest.onsuccess = () => addedCount++;
            });
            
            transaction.oncomplete = () => {
              console.log(`IndexedDB 儲存完成，共 ${addedCount} 個書籤`);
              resolve(true);
            };
            
            transaction.onerror = () => {
              console.error('IndexedDB 儲存失敗');
              resolve(false);
            };
          };
          
          clearRequest.onerror = () => {
            resolve(false);
          };
        });
      }

      // 相容層：優先使用 IndexedDB，備用 localStorage
      let bookmarksCache = [];
      let useIndexedDB = false;

      function loadBookmarks() {
        return bookmarksCache;
      }

      function saveBookmarks(bookmarks) {
        bookmarksCache = bookmarks;
        
        if (useIndexedDB && db) {
          saveBookmarksToDB(bookmarks).then(success => {
            if (!success) {
              console.warn('IndexedDB 儲存失敗，嘗試 localStorage');
              saveToLocalStorage(bookmarks);
            }
          });
          return true;
        } else {
          return saveToLocalStorage(bookmarks);
        }
      }

      function saveToLocalStorage(bookmarks) {
        try {
          const json = JSON.stringify(bookmarks);
          const sizeInMB = (json.length / 1024 / 1024).toFixed(2);
          console.log(`localStorage 儲存 ${bookmarks.length} 個書籤，大小: ${sizeInMB} MB`);
          localStorage.setItem('bookmarks', json);
          return true;
        } catch (e) {
          console.error('localStorage 儲存失敗：', e);
          if (e.name === 'QuotaExceededError') {
            showStatus('error', '書籤太大，超出瀏覽器儲存限制。建議定期匯出備份。');
          }
          return false;
        }
      }

      function loadFromLocalStorage() {
        try {
          const raw = localStorage.getItem('bookmarks');
          if (!raw) return [];
          return JSON.parse(raw);
        } catch (e) {
          return [];
        }
      }

      // 初始化書籤系統
      async function initBookmarks() {
        // 嘗試使用 IndexedDB
        useIndexedDB = await initDB();
        
        if (useIndexedDB) {
          // 從 IndexedDB 載入
          bookmarksCache = await loadBookmarksFromDB();
          
          // 如果 IndexedDB 是空的，嘗試從 localStorage 遷移
          if (bookmarksCache.length === 0) {
            const localData = loadFromLocalStorage();
            if (localData.length > 0) {
              console.log('從 localStorage 遷移書籤到 IndexedDB...');
              bookmarksCache = localData;
              await saveBookmarksToDB(localData);
              // 遷移成功後清除 localStorage
              try {
                localStorage.removeItem('bookmarks');
                console.log('遷移完成，已清除 localStorage');
              } catch (e) {}
            }
          }
          
        } else {
          // 退回使用 localStorage
          bookmarksCache = loadFromLocalStorage();
        }
        
        // 若 localStorage 沒有故事（可能因過長而未存成功），改從 IndexedDB 還原
        if (!latestStory && useIndexedDB) {
          const dbStory = ((await loadStoryFromDB()) || '').replace(/\uFFFD/g, '');
          if (dbStory) {
            latestStory = dbStory;
            resultDiv.textContent = dbStory;
            parseAndShowChapters(dbStory);
            updateWordCount(dbStory);
            console.log('已從 IndexedDB 還原故事');
          }
        }
        
        // 確保如果有儲存的故事，按鈕都會啟用
        if (latestStory) {
          downloadBtn.disabled = false;
          continueBtn.disabled = false;
          speakBtn.disabled = false; bookReaderBtn.disabled = false;
        }
        
        console.log(`書籤系統初始化完成，使用 ${useIndexedDB ? 'IndexedDB' : 'localStorage'}，共 ${bookmarksCache.length} 個書籤`);
        renderBookmarks();
      }

      // 頁面載入時初始化
      initBookmarks();

      function formatDate(timestamp) {
        const date = new Date(timestamp);
        return `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
      }

      function formatWordCount(text) {
        const count = text.length;
        if (count >= 10000) return (count / 10000).toFixed(1) + ' 萬字';
        if (count >= 1000) return (count / 1000).toFixed(1) + ' 千字';
        return count + ' 字';
      }

      function getFilteredAndSortedBookmarks() {
        let bookmarks = loadBookmarks();
        const searchTerm = bookmarkSearch.value.trim().toLowerCase();
        const sortBy = bookmarkSort.value;

        // 搜尋過濾
        if (searchTerm) {
          bookmarks = bookmarks.filter(bm => 
            (bm.title && bm.title.toLowerCase().includes(searchTerm)) ||
            (bm.tags && bm.tags.some(t => t.toLowerCase().includes(searchTerm))) ||
            (bm.notes && bm.notes.toLowerCase().includes(searchTerm))
          );
        }

        // 排序
        switch (sortBy) {
          case 'newest':
            bookmarks.sort((a, b) => b.id - a.id);
            break;
          case 'oldest':
            bookmarks.sort((a, b) => a.id - b.id);
            break;
          case 'name':
            bookmarks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
          case 'length':
            bookmarks.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0));
            break;
        }

        return bookmarks;
      }

      function renderBookmarks() {
        const allBookmarks = loadBookmarks();
        const bookmarks = getFilteredAndSortedBookmarks();
        
        // 更新徽章
        updateBookmarkBadge();
        
        // 同步更新書櫃
        if (typeof renderBookshelf === 'function') renderBookshelf();
        
        bookmarkList.innerHTML = '';

        if (bookmarks.length === 0) {
          // 空狀態由 bookmarkEmpty 元素顯示
          return;
        }

        bookmarks.forEach(bm => {
          const li = document.createElement('li');
          li.innerHTML = `
            <div class="bookmark-item-title">${bm.title || '未命名書籤'}</div>
            <div class="bookmark-item-meta">
              <span>📅 ${formatDate(bm.id)}</span>
              <span>📝 ${formatWordCount(bm.content || '')}</span>
            </div>
            <div class="bookmark-item-preview">${(bm.content || '').substring(0, 80).replace(/\n/g, ' ')}...</div>
            <div class="bookmark-item-actions">
              <button type="button" data-action="load">📖 載入</button>
              <button type="button" class="download-btn" data-action="download">⬇️ 下載</button>
              <button type="button" data-action="edit">✏️ 編輯</button>
              <button type="button" class="delete-btn" data-action="delete">🗑️</button>
            </div>
          `;

          // 點擊整個項目載入（除了按鈕區域）
          li.addEventListener('click', (e) => {
            // 檢查是否點擊了按鈕或按鈕區域
            if (e.target.closest('button') || e.target.closest('.bookmark-item-actions')) return;
            loadBookmarkContent(bm);
          });

          // 載入
          li.querySelector('[data-action="load"]').addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            loadBookmarkContent(bm);
          });

          // 下載單部小說
          li.querySelector('[data-action="download"]').addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            downloadSingleNovel(bm);
          });

          // 編輯
          li.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            editingBookmarkId = bm.id;
            editBookmarkTitle.value = bm.title || '';
            editBookmarkTags.value = (bm.tags || []).join(', ');
            editBookmarkNotes.value = bm.notes || '';
            editModal.classList.add('show');
          });

          // 刪除
          li.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (confirm('確定要刪除此書籤嗎？')) {
              const list = loadBookmarks().filter(b => b.id !== bm.id);
              saveBookmarks(list);
              renderBookmarks();
              showStatus('success', '書籤已刪除');
            }
          });

          bookmarkList.appendChild(li);
        });
      }
      
      // 載入書籤內容
      function loadBookmarkContent(bm) {
        // 系列書：還原 storySeries 與作用中集（番外含在所屬集 content 內）
        if (bm && bm.kind === 'series' && Array.isArray(bm.volumes) && bm.volumes.length) {
          seriesAborted = false;
          storySeries = {
            id: bm.seriesId || ('series_' + Date.now()),
            seriesTitle: bm.seriesTitle || stripVolumeSuffix(bm.title || ''),
            totalVolumes: bm.totalVolumes || bm.volumes.length,
            activeVolumeIndex: Math.min(bm.activeVolumeIndex || 0, bm.volumes.length - 1),
            volumes: bm.volumes.map((v, i) => ({
              index: typeof v.index === 'number' ? v.index : i,
              label: v.label || getVolumeLabel(i, bm.totalVolumes || bm.volumes.length),
              title: v.title || '',
              content: (v.content || '').replace(/\uFFFD/g, ''),
              complete: !!v.complete
            }))
          };
          try { localStorage.setItem('storySeries', JSON.stringify(storySeries)); } catch (e) {}
          const volEl = document.getElementById('volumes');
          if (volEl) volEl.value = storySeries.totalVolumes;
          const activeVol = storySeries.volumes[storySeries.activeVolumeIndex];
          latestStory = (activeVol && activeVol.content) || '';
          resultDiv.textContent = latestStory;
          try { localStorage.setItem('savedStory', latestStory); } catch (e) {}
          saveStoryToDB(latestStory);
          const has = !!latestStory;
          downloadBtn.disabled = !has;
          continueBtn.disabled = !has;
          speakBtn.disabled = !has;
          bookReaderBtn.disabled = !has;
          updateWordCount(latestStory);
          parseAndShowChapters(latestStory);
          if (typeof renderSeriesBar === 'function') renderSeriesBar();
          showStatus('success', `已載入系列：${bm.title || bm.seriesTitle || '系列小說'}（共 ${storySeries.totalVolumes} 集）`);
          isBookmarkPanelOpen = false;
          bookmarkNavPanel.classList.remove('open');
          scrollOutputAreaIntoView();
          return;
        }
        // 一般單本（番外已含在 content 內）
        storySeries = null;
        try { localStorage.removeItem('storySeries'); } catch (e) {}
        if (typeof renderSeriesBar === 'function') renderSeriesBar();
        latestStory = (bm.content || '').replace(/\uFFFD/g, '');
        resultDiv.textContent = latestStory;
        downloadBtn.disabled = !latestStory;
        continueBtn.disabled = !latestStory;
        speakBtn.disabled = !latestStory;
        bookReaderBtn.disabled = !latestStory;
        persistStory(latestStory);
        showStatus('success', `已載入：${bm.title || '書籤'}`);
        parseAndShowChapters(latestStory);
        
        // 關閉書籤面板
        isBookmarkPanelOpen = false;
        bookmarkNavPanel.classList.remove('open');
        
        // 捲動到結果區
        scrollOutputAreaIntoView();
      }

      // ==================== 我的書櫃 ====================
      const SHELF_COLORS = [
        ['#9e2a2b', '#7a1d1e'], ['#1f4e5f', '#143842'], ['#2f6b3f', '#1e4a2b'],
        ['#5a3e85', '#412c63'], ['#b5651d', '#8a4a13'], ['#2c3e7a', '#1f2c59'],
        ['#a23e5c', '#7c2b43'], ['#556b2f', '#3d4d22'], ['#8a5a2b', '#684119'],
        ['#2f6b5e', '#1f4a40'], ['#7b4397', '#5a2f70'], ['#c0392b', '#96281b'],
        ['#16697a', '#0f4a57'], ['#a0522d', '#7a3d20'], ['#34495e', '#243443'],
        ['#6d214f', '#4f1638'], ['#3d5a4c', '#2a4035'], ['#925e26', '#6e451a']
      ];

      function shelfHash(id) {
        let h = 0;
        const s = String(id);
        for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) >>> 0;
        return h;
      }

      function shelfColor(id) {
        return SHELF_COLORS[shelfHash(id) % SHELF_COLORS.length];
      }

      // 書本造型（裝幀）與粗細，依 ID 穩定分配，讓書櫃有多種類書本
      const SHELF_STYLE_CLASSES = ['bk-classic', 'bk-leather', 'bk-cloth', 'bk-stripe', 'bk-modern', 'bk-vintage'];
      // 粗細權重：一般較多，偶爾薄/厚，模擬真實書架
      const SHELF_WIDTH_CLASSES = ['bk-w-thin', 'bk-w-std', 'bk-w-std', 'bk-w-std', 'bk-w-thick'];

      function shelfVariant(id) {
        const h = shelfHash(id);
        return {
          style: SHELF_STYLE_CLASSES[h % SHELF_STYLE_CLASSES.length],
          width: SHELF_WIDTH_CLASSES[Math.floor(h / 7) % SHELF_WIDTH_CLASSES.length]
        };
      }

      function shelfColorIndex(id) { return shelfHash(id) % SHELF_COLORS.length; }
      function shelfStyleIndex(id) { return shelfHash(id) % SHELF_STYLE_CLASSES.length; }

      // 套用書本配色（CSS 變數）讓各造型可在其上疊加裝飾
      function applyShelfColors(el, c1, c2) {
        el.style.setProperty('--c1', c1);
        el.style.setProperty('--c2', c2);
      }

      // 從書籤抽出乾淨的「書名」
      // 故事開頭通常是「### 第1章：標題」，因此優先取「第一章的標題描述」當書名；
      // 其次取非章節的 Markdown 主標題；最後退回第一句正文。
      function getBookName(bm) {
        const strip = (s) => (s || '')
          .replace(/\uFFFD/g, '')
          .replace(/^#{1,6}\s*/, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/[#*_`>]/g, '')
          .replace(/^[《【\[]\s*/, '')
          .replace(/\s*[》】\]]$/, '')
          .trim();

        // 若書籤 title 已是乾淨的 AI 書名（非舊版「章節+正文截斷」），直接採用
        const stored = strip(bm.title || '');
        const looksLikeOldTruncated =
          /第\s*[一二三四五六七八九十百千萬零\d]+\s*[章節回卷]/.test(stored) ||
          stored.length > 24 ||
          /^好的[，,]/.test(stored);
        if (stored && !looksLikeOldTruncated) return stored.substring(0, 30);

        // 章節標題（含可選 # 標記），並擷取「：」之後的標題描述
        const chapRe = /^#{0,4}\s*(?:第\s*[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+\s*[章節回卷部集篇]|序章|楔子|引子|前言|尾聲|終章|番外|後記)\s*[：:、.\-－—\s]*(.*)$/;
        const isSep = (l) => /^[-—=─━═~·.\s]{2,}$/.test(l);
        const isEnd = (l) => /^(全文完|完|—\s*完\s*—|the\s*end|fin)$/i.test(l);

        const source = (bm.content && bm.content.trim()) ? bm.content : (bm.title || '');
        const lines = source.replace(/\r\n/g, '\n').slice(0, 4000).split('\n');

        let scanned = 0;
        for (const raw of lines) {
          if (!raw.trim()) continue;
          if (++scanned > 20) break;
          const line = strip(raw);
          if (!line || isSep(line) || isEnd(line)) continue;

          const cm = raw.trim().match(chapRe);
          if (cm) {
            // 章節標題描述當書名；遇空白或句讀即截斷（避免舊書籤標題與正文黏在一起）
            const t = strip(cm[1]).split(/[\s。！？!?，,、；;：:]/)[0];
            if (t) return t.substring(0, 30);
            continue;                            // 「第1章」無標題 → 繼續往下找
          }

          // 非章節行：可能是主標題或第一句正文，取到首個句末標點為止
          const sentence = line.match(/^[^。！？!?\n]{2,30}/);
          return (sentence ? sentence[0] : line).substring(0, 30);
        }
        return '未命名';
      }

      function getShelfBooks() {
        let books = loadBookmarks().slice();
        const sEl = document.getElementById('bookshelfSearch');
        const sortEl = document.getElementById('bookshelfSort');
        const term = (sEl && sEl.value.trim().toLowerCase()) || '';
        const sortBy = (sortEl && sortEl.value) || 'newest';
        if (term) {
          books = books.filter(b =>
            (b.title && b.title.toLowerCase().includes(term)) ||
            (b.tags && b.tags.some(t => t.toLowerCase().includes(term)))
          );
        }
        // 以顯示書名（字首）排序，繁中依筆畫／注音；同組時用書名當次序
        const byName = (a, b) => getBookName(a).localeCompare(getBookName(b), 'zh-Hant');
        switch (sortBy) {
          case 'oldest': books.sort((a, b) => a.id - b.id); break;
          case 'name': books.sort(byName); break;
          case 'length': books.sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0)); break;
          case 'color': books.sort((a, b) => shelfColorIndex(a.id) - shelfColorIndex(b.id) || byName(a, b)); break;
          case 'style': books.sort((a, b) => shelfStyleIndex(a.id) - shelfStyleIndex(b.id) || byName(a, b)); break;
          default: books.sort((a, b) => b.id - a.id);
        }
        return books;
      }

      function renderBookshelf() {
        const body = document.getElementById('bookshelfBody');
        const empty = document.getElementById('bookshelfEmpty');
        if (!body) return;
        const books = getShelfBooks();
        body.innerHTML = '';
        if (!books.length) {
          if (empty) empty.style.display = 'block';
          body.style.display = 'none';
          return;
        }
        if (empty) empty.style.display = 'none';
        body.style.display = 'flex';
        books.forEach(bm => {
          const [c1, c2] = shelfColor(bm.id);
          const { style, width } = shelfVariant(bm.id);
          const div = document.createElement('div');
          div.className = `book-spine ${style} ${width}`;
          applyShelfColors(div, c1, c2);
          const name = getBookName(bm);
          const isSeries = bm.kind === 'series' && Array.isArray(bm.volumes) && bm.volumes.length;
          const vcount = isSeries ? (bm.totalVolumes || bm.volumes.length) : 0;
          div.innerHTML = `<span class="book-spine-title">${escapeHtml(name.substring(0, 14))}</span>`
            + (isSeries ? `<span class="book-spine-series">全${vcount}集</span>` : '');
          div.title = isSeries ? `${name}（全 ${vcount} 集）` : name;
          div.addEventListener('click', () => openBookDetail(bm));
          body.appendChild(div);
        });
      }

      function openBookshelf() {
        const modal = document.getElementById('bookshelfModal');
        if (!modal) return;
        // 還原上次選用的排列方式
        const sortEl = document.getElementById('bookshelfSort');
        if (sortEl) {
          const saved = localStorage.getItem('bookshelfSort');
          if (saved && [...sortEl.options].some(o => o.value === saved)) sortEl.value = saved;
        }
        renderBookshelf();
        modal.classList.add('open');
      }

      function closeBookshelf() {
        const modal = document.getElementById('bookshelfModal');
        if (modal) modal.classList.remove('open');
        closeBookDetail();
      }

      let shelfCurrentBm = null;

      function openBookDetail(bm) {
        shelfCurrentBm = bm;
        const [c1, c2] = shelfColor(bm.id);
        const cover = document.getElementById('bookDetailCover');
        const name = getBookName(bm);
        const isSeries = bm.kind === 'series' && Array.isArray(bm.volumes) && bm.volumes.length;
        cover.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
        cover.textContent = name.charAt(0) || '書';
        document.getElementById('bookDetailTitle').textContent =
          isSeries ? `${name}（全 ${bm.totalVolumes || bm.volumes.length} 集）` : name;
        const metaEl = document.getElementById('bookDetailMeta');
        metaEl.innerHTML =
          `<span>📅 ${formatDate(bm.id)}</span><span>📝 ${formatWordCount(bm.content || '')}</span>`
          + (isSeries ? `<span>📚 ${bm.totalVolumes || bm.volumes.length} 集</span>` : '');
        const previewEl = document.getElementById('bookDetailPreview');
        if (isSeries) {
          const volLines = bm.volumes.map((v, i) => {
            const label = v.label || getVolumeLabel(i, bm.totalVolumes || bm.volumes.length);
            const words = formatWordCount(v.content || '');
            const mark = v.complete ? '✓' : '…';
            return `${mark} ${label}（${words}）`;
          }).join('　');
          previewEl.textContent = volLines;
        } else {
          previewEl.textContent =
            (bm.content || '').replace(/[#*]/g, '').replace(/\n+/g, ' ').substring(0, 140) + '…';
        }
        document.getElementById('bookDetail').classList.add('open');
      }

      function closeBookDetail() {
        const d = document.getElementById('bookDetail');
        if (d) d.classList.remove('open');
        shelfCurrentBm = null;
      }

      // 書櫃事件接線
      document.getElementById('bookshelfCloseBtn').addEventListener('click', closeBookshelf);
      document.getElementById('bookshelfSearch').addEventListener('input', renderBookshelf);
      document.getElementById('bookshelfSort').addEventListener('change', (e) => {
        try { localStorage.setItem('bookshelfSort', e.target.value); } catch (err) {}
        renderBookshelf();
      });
      document.getElementById('bookshelfSaveBtn').addEventListener('click', () => addBookmarkBtn.click());
      document.getElementById('bookshelfExportBtn').addEventListener('click', () => exportBookmarksBtn.click());
      document.getElementById('bookshelfImportBtn').addEventListener('click', () => importBookmarksBtn.click());
      document.getElementById('bookDetailClose').addEventListener('click', closeBookDetail);
      document.getElementById('bookDetail').addEventListener('click', (e) => {
        if (e.target.id === 'bookDetail') closeBookDetail();
      });

      document.getElementById('bookDetailRead').addEventListener('click', () => {
        if (!shelfCurrentBm) return;
        loadBookmarkContent(shelfCurrentBm);
        closeBookshelf();
      });
      document.getElementById('bookDetailFlip').addEventListener('click', () => {
        if (!shelfCurrentBm) return;
        loadBookmarkContent(shelfCurrentBm);
        closeBookshelf();
        setTimeout(() => { if (!bookReaderBtn.disabled) bookReaderBtn.click(); }, 220);
      });
      document.getElementById('bookDetailDownload').addEventListener('click', () => {
        if (shelfCurrentBm) downloadSingleNovel(shelfCurrentBm);
      });
      document.getElementById('bookDetailEdit').addEventListener('click', () => {
        if (!shelfCurrentBm) return;
        editingBookmarkId = shelfCurrentBm.id;
        editBookmarkTitle.value = shelfCurrentBm.title || '';
        editBookmarkTags.value = (shelfCurrentBm.tags || []).join(', ');
        editBookmarkNotes.value = shelfCurrentBm.notes || '';
        editModal.classList.add('show');
        closeBookDetail();
      });
      document.getElementById('bookDetailDelete').addEventListener('click', () => {
        if (!shelfCurrentBm) return;
        if (confirm('確定要從書櫃刪除這本嗎？此操作無法復原。')) {
          const list = loadBookmarks().filter(b => b.id !== shelfCurrentBm.id);
          saveBookmarks(list);
          renderBookmarks();
          closeBookDetail();
          showStatus('success', '已從書櫃刪除');
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const d = document.getElementById('bookDetail');
        const m = document.getElementById('bookshelfModal');
        if (d && d.classList.contains('open')) closeBookDetail();
        else if (m && m.classList.contains('open')) closeBookshelf();
      });

      // 新增書籤
      addBookmarkBtn.addEventListener('click', () => {
        if (!latestStory || latestStory.trim() === '') {
          showStatus('error', '沒有可儲存的內容');
          return;
        }
        // 系列：整個系列存成一本（upsert，避免與自動存書產生重複）
        if (storySeries && storySeries.totalVolumes > 1) {
          upsertSeriesBookmark();
          showStatus('success', `系列已存入書櫃（共 ${storySeries.totalVolumes} 集）`);
          return;
        }
        const bookmarks = loadBookmarks();
        let title = latestStory.trim().replace(/\s+/g, ' ').substring(0, 50);
        if (title.length < latestStory.trim().length) title += '...';
        
        const newBookmark = {
          id: Date.now(),
          title,
          content: latestStory,
          tags: [],
          notes: '',
        };
        bookmarks.push(newBookmark);
        saveBookmarks(bookmarks);
        renderBookmarks();
        showStatus('success', '書籤已儲存！');
      });

      // 搜尋和排序
      bookmarkSearch.addEventListener('input', renderBookmarks);
      bookmarkSort.addEventListener('change', renderBookmarks);

      // 編輯彈窗
      cancelEditBtn.addEventListener('click', () => {
        editModal.classList.remove('show');
        editingBookmarkId = null;
      });

      saveEditBtn.addEventListener('click', () => {
        if (!editingBookmarkId) return;
        const bookmarks = loadBookmarks();
        const bm = bookmarks.find(b => b.id === editingBookmarkId);
        if (bm) {
          const newTitle = editBookmarkTitle.value.trim();
          if (newTitle) {
            bm.title = newTitle;
            // 系列書：標記為使用者編輯，避免自動存書覆寫書名
            if (bm.kind === 'series') bm.titleEdited = true;
          }
          bm.tags = editBookmarkTags.value.split(',').map(t => t.trim()).filter(t => t);
          bm.notes = editBookmarkNotes.value.trim();
          saveBookmarks(bookmarks);
          renderBookmarks();
          showStatus('success', '書籤已更新');
        }
        editModal.classList.remove('show');
        editingBookmarkId = null;
      });

      editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
          editModal.classList.remove('show');
          editingBookmarkId = null;
        }
      });

      // 匯出書籤
      exportBookmarksBtn.addEventListener('click', () => {
        const bookmarks = loadBookmarks();
        if (bookmarks.length === 0) {
          showStatus('error', '沒有書籤可匯出');
          return;
        }
        const dataStr = JSON.stringify(bookmarks, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `小說書籤_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
        showStatus('success', '書籤已匯出');
      });

      // 匯入書籤
      importBookmarksBtn.addEventListener('click', () => {
        importFileInput.click();
      });

      importFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            console.log('開始匯入書籤...');
            const imported = JSON.parse(event.target.result);
            console.log('解析 JSON 成功，書籤數量：', imported.length);
            
            if (!Array.isArray(imported)) throw new Error('格式錯誤：不是陣列');
            
            if (imported.length === 0) {
              showStatus('error', '匯入失敗：檔案中沒有書籤');
              return;
            }
            
            const existing = loadBookmarks();
            console.log('現有書籤數量：', existing.length);
            const existingIds = new Set(existing.map(b => b.id));
            let added = 0;
            let skipped = 0;
            
            imported.forEach(bm => {
              // 確保書籤有必要的欄位
              if (bm.content) {
                // 如果沒有 id，生成一個新的
                if (!bm.id) {
                  bm.id = Date.now() + Math.random();
                }
                
                // 檢查是否已存在
                if (!existingIds.has(bm.id)) {
                  existing.push(bm);
                  existingIds.add(bm.id);
                  added++;
                } else {
                  skipped++;
                }
              }
            });
            
            console.log('新增：', added, '跳過：', skipped);
            
            if (added > 0) {
              const saveSuccess = saveBookmarks(existing);
              
              if (saveSuccess) {
                // 驗證儲存結果
                const verification = loadBookmarks();
                console.log('驗證儲存結果，數量：', verification.length);
                
                renderBookmarks();
                
                if (skipped > 0) {
                  showStatus('success', `已匯入 ${added} 筆書籤（${skipped} 筆重複已跳過）`);
                } else {
                  showStatus('success', `已匯入 ${added} 筆書籤`);
                }
              } else {
                showStatus('error', '匯入失敗：無法儲存到本地');
              }
            } else if (skipped > 0) {
              showStatus('warning', `所有 ${skipped} 筆書籤都已存在，沒有新增`);
            } else {
              showStatus('error', '匯入失敗：檔案中沒有有效的書籤（需要有 content 欄位）');
            }
            
            // 強制重新渲染
            setTimeout(() => {
              renderBookmarks();
            }, 100);
            
          } catch (err) {
            console.error('匯入錯誤：', err);
            showStatus('error', '匯入失敗：' + (err.message || '檔案格式錯誤'));
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });

      // ==================== Edge 情緒朗讀功能 ====================
      let edgeCurrentAudio = null;
      let edgeAudioUrl = null;
      let edgeSynthAbort = null;
      let edgeSpeechSession = 0;
      let audioCtx = null;
      let edgeSource = null;
      let edgeSegCache = {};
      let edgeTtsReady = false;
      let isSpeaking = false;
      let isPaused = false;
      let speechSegments = [];
      let currentSegmentIndex = 0;
      let segmentRanges = [];
      let speechPlayQueue = [];
      let speechHighlightSegments = [];
      let speechHighlightRanges = [];
      let speechInitialized = false;

      const roleVoiceEnabled = document.getElementById('roleVoiceEnabled');
      const roleVoiceRow = document.getElementById('roleVoiceRow');
      const narratorVoice = document.getElementById('narratorVoice');
      const maleVoice = document.getElementById('maleVoice');
      const femaleVoice = document.getElementById('femaleVoice');

      // 朗讀控制元素
      const prevSegmentBtn = document.getElementById('prevSegmentBtn');
      const nextSegmentBtn = document.getElementById('nextSegmentBtn');
      const currentSegmentDisplay = document.getElementById('currentSegmentDisplay');
      const speechProgressBar = document.getElementById('speechProgressBar');
      const roleAnalyzePanel = document.getElementById('roleAnalyzePanel');
      const roleAnalyzeStatus = document.getElementById('roleAnalyzeStatus');
      const roleAnalyzeFill = document.getElementById('roleAnalyzeFill');
      const roleAnalyzeBar = document.getElementById('roleAnalyzeBar');
      const roleAnalyzeBlocks = document.getElementById('roleAnalyzeBlocks');
      const autoScrollCheck = document.getElementById('autoScrollCheck');
      const highlightCheck = document.getElementById('highlightCheck');
      
      function showRoleAnalyzeUI(total) {
        if (!roleAnalyzePanel) return;
        roleAnalyzePanel.hidden = false;
        if (roleAnalyzeBlocks) {
          roleAnalyzeBlocks.innerHTML = '';
          const count = Math.max(1, total || 1);
          for (let i = 0; i < count; i++) {
            const el = document.createElement('span');
            el.className = 'role-analyze-block pending';
            el.title = `區塊 ${i + 1}`;
            el.textContent = String(i + 1);
            roleAnalyzeBlocks.appendChild(el);
          }
        }
        updateRoleAnalyzeUI(0, total || 1);
      }

      function updateRoleAnalyzeUI(done, total) {
        const safeTotal = Math.max(1, total || 1);
        const safeDone = Math.min(Math.max(0, done || 0), safeTotal);
        const pct = Math.round((safeDone / safeTotal) * 100);

        if (roleAnalyzeFill) roleAnalyzeFill.style.width = `${pct}%`;
        if (roleAnalyzeBar) {
          roleAnalyzeBar.setAttribute('aria-valuenow', String(pct));
          roleAnalyzeBar.setAttribute('aria-valuemax', '100');
        }
        if (roleAnalyzeStatus) {
          roleAnalyzeStatus.textContent = safeDone === 0
            ? `DeepSeek 分析角色與情緒中…（共 ${safeTotal} 區塊）`
            : `DeepSeek 分析中 ${safeDone}/${safeTotal} 區塊（${pct}%）`;
        }
        if (roleAnalyzeBlocks && roleAnalyzeBlocks.children.length !== safeTotal) {
          showRoleAnalyzeUI(safeTotal);
        }
        if (roleAnalyzeBlocks) {
          for (let i = 0; i < roleAnalyzeBlocks.children.length; i++) {
            const el = roleAnalyzeBlocks.children[i];
            let state = 'pending';
            if (i < safeDone) state = 'done';
            else if (i === safeDone && safeDone < safeTotal) state = 'active';
            el.className = `role-analyze-block ${state}`;
          }
        }
        if (speechProgressText) {
          speechProgressText.textContent = safeDone === 0
            ? `DeepSeek 分析角色與情緒中…（${safeTotal} 區塊）`
            : `DeepSeek 分析中 ${safeDone}/${safeTotal} 區塊…`;
        }
        if (speechProgressFill) speechProgressFill.style.width = `${pct}%`;
      }

      function hideRoleAnalyzeUI() {
        if (roleAnalyzePanel) roleAnalyzePanel.hidden = true;
        if (roleAnalyzeBlocks) roleAnalyzeBlocks.innerHTML = '';
        if (roleAnalyzeFill) roleAnalyzeFill.style.width = '0%';
        if (roleAnalyzeBar) roleAnalyzeBar.setAttribute('aria-valuenow', '0');
      }

      // 檢查 Edge TTS 是否可用（需透過本機伺服器 /api/tts）
      EdgeTtsSpeech.checkAvailable().then((ok) => {
        edgeTtsReady = ok;
        if (!ok) {
          speakBtn.title = '朗讀需啟動 npm start 伺服器';
        }
      });
      
      function stopEdgeAudio() {
        if (edgeSource) {
          try { edgeSource.onended = null; } catch (e) { /* ignore */ }
          try { edgeSource.stop(0); } catch (e) { /* ignore */ }
          try { edgeSource.disconnect(); } catch (e) { /* ignore */ }
          edgeSource = null;
        }
        if (edgeCurrentAudio) {
          edgeCurrentAudio.onended = null;
          edgeCurrentAudio.onerror = null;
          try { edgeCurrentAudio.pause(); } catch (e) { /* ignore */ }
        }
        if (edgeAudioUrl) {
          URL.revokeObjectURL(edgeAudioUrl);
          edgeAudioUrl = null;
        }
        if (edgeSynthAbort) {
          edgeSynthAbort.abort();
          edgeSynthAbort = null;
        }
      }

      // 行動裝置（iOS/Android）對非手勢觸發的連續 HTMLAudio 播放限制嚴格，
      // 改用 Web Audio：在使用者手勢中解鎖一次 AudioContext，之後即可連續播放解碼後的 buffer。
      function ensureAudioCtx() {
        try {
          if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
          }
          if (audioCtx && audioCtx.state === 'suspended' && audioCtx.resume) {
            audioCtx.resume();
          }
        } catch (e) { /* ignore */ }
        return audioCtx;
      }

      function decodeAudio(ctx, arrbuf) {
        return new Promise((resolve, reject) => {
          let p;
          try { p = ctx.decodeAudioData(arrbuf, resolve, reject); }
          catch (e) { reject(e); return; }
          if (p && p.then) p.then(resolve, reject);
        });
      }

      // 取得（並快取）某段已合成、已解碼的音訊；用於邊播邊預取下一段，消除段間停頓
      function getSegmentAudio(index) {
        if (edgeSegCache[index]) return edgeSegCache[index];
        const queueItem = speechPlayQueue[index];
        if (!queueItem) return Promise.reject(new Error('no segment'));
        const processedText = EdgeTtsSpeech.sanitizeTtsText(queueItem.text || '');
        if (!processedText || !processedText.trim()) return Promise.reject(new Error('empty segment'));
        const voice = queueItem.voice || voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
        const style = queueItem.style || 'general';
        const rate = queueItem.rate ?? 1;
        const pitch = queueItem.pitch ?? 1;
        const p = EdgeTtsSpeech.synthesize({ text: processedText, voice, style, rate, pitch })
          .then((buf) => {
            const result = { buf, decoded: null };
            const ctx = ensureAudioCtx();
            if (ctx) {
              return decodeAudio(ctx, buf.slice(0)).then((d) => { result.decoded = d; return result; }, () => result);
            }
            return result;
          });
        edgeSegCache[index] = p;
        return p;
      }

      function prefetchNext(index) {
        const n = index + 1;
        Object.keys(edgeSegCache).forEach((k) => { if (+k !== n) delete edgeSegCache[k]; });
        if (n < speechPlayQueue.length && !edgeSegCache[n]) {
          getSegmentAudio(n).catch(() => { /* 預取失敗忽略，播放時再重試 */ });
        }
      }

      function clearSegmentCache() {
        edgeSegCache = {};
      }

      // 儲存朗讀進度
      function saveSpeechProgress() {
        try {
          const progress = {
            segmentIndex: currentSegmentIndex,
            rate: speechRate.value,
            pitch: speechPitch.value,
            voice: voiceSelect.value,
            emotion: emotionMode.value,
            timestamp: Date.now()
          };
          localStorage.setItem('speechProgress', JSON.stringify(progress));
        } catch (e) {
          console.warn('無法儲存朗讀進度：', e);
        }
      }

      // 載入朗讀進度
      function loadSpeechProgress() {
        try {
          const raw = localStorage.getItem('speechProgress');
          if (!raw) return null;
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }

      // 清除朗讀進度
      function clearSpeechProgress() {
        try {
          localStorage.removeItem('speechProgress');
        } catch (e) {}
      }

      // 載入 Edge 語音清單
      async function loadVoices() {
        await EdgeTtsSpeech.fetchVoices();
        EdgeTtsSpeech.populateVoiceSelect(voiceSelect);
        EdgeTtsSpeech.populateRoleSelects(narratorVoice, maleVoice, femaleVoice, {
          narratorVoice: localStorage.getItem('speechNarratorVoice') || EdgeTtsSpeech.DEFAULT_VOICE,
          maleVoice: localStorage.getItem('speechMaleVoice') || 'zh-CN-YunxiNeural',
          femaleVoice: localStorage.getItem('speechFemaleVoice') || 'zh-CN-XiaoxiaoNeural'
        });
        speechInitialized = true;
      }

      if (roleVoiceEnabled && roleVoiceRow) {
        roleVoiceEnabled.addEventListener('change', () => {
          roleVoiceRow.hidden = !roleVoiceEnabled.checked;
        });
        roleVoiceEnabled.checked = localStorage.getItem('speechRoleEnabled') === '1';
        roleVoiceRow.hidden = !roleVoiceEnabled.checked;
      }
      for (const sel of [narratorVoice, maleVoice, femaleVoice]) {
        if (sel) {
          sel.addEventListener('change', () => {
            try {
              if (narratorVoice?.value) localStorage.setItem('speechNarratorVoice', narratorVoice.value);
              if (maleVoice?.value) localStorage.setItem('speechMaleVoice', maleVoice.value);
              if (femaleVoice?.value) localStorage.setItem('speechFemaleVoice', femaleVoice.value);
            } catch { /* ignore */ }
          });
        }
      }

      loadVoices();

      function analyzeEmotion(text) {
        const mode = emotionMode.value;
        const voiceId = voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
        const baseRate = parseFloat(speechRate.value);
        const basePitch = parseFloat(speechPitch.value);
        const emotion = mode === 'auto'
          ? EdgeTtsSpeech.detectEmotionFromText(text)
          : mode;
        return EdgeTtsSpeech.buildEmotionParams(emotion, baseRate, basePitch, voiceId);
      }

      function getEmotionParams(emotion) {
        const voiceId = voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
        const baseRate = parseFloat(speechRate.value);
        const basePitch = parseFloat(speechPitch.value);
        return EdgeTtsSpeech.buildEmotionParams(emotion, baseRate, basePitch, voiceId);
      }
      
      // 處理文字以改善朗讀效果
      function preprocessTextForSpeech(text) {
        if (!text || text.trim().length === 0) return '';
        
        let processed = EdgeTtsSpeech.sanitizeTtsText(text.trim());
        
        // 移除 Markdown 標記
        processed = processed.replace(/^#+\s*/gm, '');
        processed = processed.replace(/\*+/g, '');
        
        // 引號改逗號停頓，保留語意連貫（勿整段刪除以免詞被拆散）
        processed = processed.replace(/[「」『』【】〈〉《》（）()\[\]{}""'']/g, '，');
        processed = processed.replace(/[：:；;]/g, '，');
        processed = processed.replace(/[⋯…]+/g, '，');
        processed = processed.replace(/[——–—−]+/g, '，');
        processed = processed.replace(/[～~]+/g, '');
        processed = processed.replace(/[★☆●○◆◇■□▲△▼▽※＊\*#＃@＠&＆]/g, '');
        processed = processed.replace(/[─━┃│┄┅┆┇]+/g, '');
        
        processed = processed.replace(/，+/g, '，');
        processed = processed.replace(/。+/g, '。');
        processed = processed.replace(/\s+/g, ' ');
        processed = processed.trim();
        
        if (!processed || processed.length === 0) {
          return '';
        }
        
        return processed;
      }

      // 分割文字為段落（保持情緒連貫），同時記錄原文中的精確位置
      function splitTextToSegments(text) {
        const segments = [];
        segmentRanges = [];
        if (!text) return segments;

        let searchFrom = 0;
        const paragraphs = text.split(/\n\n+/);

        for (const para of paragraphs) {
          const trimmed = para.trim();
          if (!trimmed) continue;

          const paraStart = text.indexOf(trimmed, searchFrom);
          if (paraStart === -1) continue;

          if (trimmed.length > 200) {
            const sentences = trimmed.split(/(?<=[。！？])/);
            let chunk = '';
            let chunkSearch = paraStart;

            for (const sentence of sentences) {
              const combined = chunk + sentence;
              const chunkFull = chunk.trim() && combined.length > 150;
              const unsafeSplit = chunk.trim() && EdgeTtsSpeech.isUnsafeHanSplit
                && EdgeTtsSpeech.isUnsafeHanSplit(combined, chunk.trim().length);
              if (chunkFull && !unsafeSplit) {
                const chunkTrim = chunk.trim();
                const chunkStart = text.indexOf(chunkTrim, chunkSearch);
                if (chunkStart !== -1) {
                  segments.push(chunkTrim);
                  segmentRanges.push({
                    start: chunkStart,
                    end: chunkStart + chunkTrim.length,
                    text: chunkTrim
                  });
                  chunkSearch = chunkStart + chunkTrim.length;
                }
                chunk = sentence;
              } else {
                chunk = combined;
              }
            }

            if (chunk.trim()) {
              const chunkTrim = chunk.trim();
              const chunkStart = text.indexOf(chunkTrim, chunkSearch);
              if (chunkStart !== -1) {
                segments.push(chunkTrim);
                segmentRanges.push({
                  start: chunkStart,
                  end: chunkStart + chunkTrim.length,
                  text: chunkTrim
                });
              }
            }
          } else {
            segments.push(trimmed);
            segmentRanges.push({
              start: paraStart,
              end: paraStart + trimmed.length,
              text: trimmed
            });
          }

          searchFrom = paraStart + trimmed.length;
        }

        const merged = EdgeTtsSpeech.mergeSpeechSegments
          ? EdgeTtsSpeech.mergeSpeechSegments(segments, segmentRanges)
          : { segments, ranges: segmentRanges };
        segmentRanges = merged.ranges;
        return merged.segments.filter((s) => s.length > 0);
      }

      function escapeHighlightHtml(text) {
        return String(text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
      }

      function getHighlightSearchText(item) {
        if (!item) return '';
        if (item.sourceSegmentIndex != null && speechHighlightSegments[item.sourceSegmentIndex]) {
          return speechHighlightSegments[item.sourceSegmentIndex];
        }
        return item.sourceText || item.highlightText || '';
      }

      function getHighlightRangeForQueueIndex(queueIndex) {
        const item = speechPlayQueue[queueIndex];
        const fullText = latestStory || '';
        if (!item || !fullText) return null;

        if (Number.isInteger(item.highlightStart) && item.highlightEnd > item.highlightStart) {
          const text = fullText.substring(item.highlightStart, item.highlightEnd);
          if (text) {
            return { start: item.highlightStart, end: item.highlightEnd, text };
          }
        }

        if (item.sourceSegmentIndex != null && speechHighlightRanges[item.sourceSegmentIndex]) {
          const r = speechHighlightRanges[item.sourceSegmentIndex];
          return { start: r.start, end: r.end, text: r.text };
        }

        const segmentText = getHighlightSearchText(item);
        if (!segmentText) return null;

        let searchStart = 0;
        for (let i = 0; i < queueIndex; i++) {
          const prevText = getHighlightSearchText(speechPlayQueue[i]);
          if (!prevText) continue;
          const foundPos = fullText.indexOf(prevText, searchStart);
          if (foundPos !== -1) searchStart = foundPos + prevText.length;
        }

        const segmentStart = fullText.indexOf(segmentText, searchStart);
        if (segmentStart === -1) return null;

        return {
          start: segmentStart,
          end: segmentStart + segmentText.length,
          text: segmentText
        };
      }

      // 高亮目前朗讀的段落（沿用 Edge 改版前 innerHTML 方式，直排可用）
      function highlightCurrentSegment(index) {
        clearHighlight();

        if (!highlightCheck || !highlightCheck.checked) return;
        if (index < 0 || index >= speechPlayQueue.length) return;

        const range = getHighlightRangeForQueueIndex(index);
        if (!range) return;

        const fullText = latestStory || '';
        resultDiv.innerHTML =
          escapeHighlightHtml(fullText.substring(0, range.start)) +
          '<span class="speaking-segment" id="currentSpeakingSegment">' + escapeHighlightHtml(range.text) + '</span>' +
          escapeHighlightHtml(fullText.substring(range.end));

        if (isVerticalWriting()) syncVerticalLayout();

        if (autoScrollCheck && autoScrollCheck.checked) {
          setTimeout(() => {
            const highlightedEl = document.getElementById('currentSpeakingSegment');
            if (!highlightedEl) return;

            if (isVerticalWriting()) {
              const scroller = getVerticalScroller();
              if (!scroller) return;
              const rect = highlightedEl.getBoundingClientRect();
              const viewRect = scroller.getBoundingClientRect();
              if (rect.right > viewRect.right - 80) {
                scroller.scrollLeft += rect.right - viewRect.right + 80;
              } else if (rect.left < viewRect.left + 80) {
                scroller.scrollLeft -= viewRect.left + 80 - rect.left;
              }
              return;
            }

            const rect = highlightedEl.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            if (rect.top < 100 || rect.bottom > viewportHeight - 100) {
              highlightedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 50);
        }
      }

      function clearHighlight() {
        const highlightedEl = document.getElementById('currentSpeakingSegment');
        if (highlightedEl || resultDiv.innerHTML.includes('speaking-segment')) {
          resultDiv.textContent = latestStory || '';
          if (isVerticalWriting()) syncVerticalLayout();
        }
      }
      
      // 更新段落控制按鈕狀態
      function updateNavButtons() {
        prevSegmentBtn.disabled = !isSpeaking || currentSegmentIndex <= 0;
        nextSegmentBtn.disabled = !isSpeaking || currentSegmentIndex >= speechPlayQueue.length - 1;
        
        if (isSpeaking && speechPlayQueue.length > 0) {
          currentSegmentDisplay.textContent = `${currentSegmentIndex + 1} / ${speechPlayQueue.length}`;
        } else {
          currentSegmentDisplay.textContent = '- / -';
        }
      }

      // 朗讀單一段落（Edge 神經語音）
      function speakSegment(index) {
        if (!isSpeaking) return;

        if (index >= speechPlayQueue.length) {
          stopSpeech();
          clearSpeechProgress();
          clearHighlight();
          speechProgressText.textContent = '✅ 朗讀完成';
          return;
        }

        currentSegmentIndex = index;
        saveSpeechProgress();
        updateNavButtons();
        highlightCurrentSegment(index);

        const queueItem = speechPlayQueue[index] || {};
        const rawText = queueItem.text || '';
        const params = speechPlayQueue.length
          ? { rate: queueItem.rate, pitch: queueItem.pitch, style: queueItem.style, pause: queueItem.pause || 300 }
          : analyzeEmotion(rawText);

        const processedText = EdgeTtsSpeech.sanitizeTtsText(
          queueItem.text || preprocessTextForSpeech(rawText)
        );

        if (!processedText || !processedText.trim()) {
          if (isSpeaking && !isPaused) setTimeout(() => speakSegment(index + 1), 100);
          return;
        }

        const progress = ((index + 1) / speechPlayQueue.length) * 100;
        speechProgressFill.style.width = progress + '%';
        speechProgressText.textContent = `正在合成 ${index + 1}/${speechPlayQueue.length} 段…`;
        currentSegmentDisplay.textContent = `${index + 1} / ${speechPlayQueue.length}`;

        speakWithEdge(processedText, params, index, queueItem);
      }
      
      async function speakWithEdge(processedText, params, index, queueItem = {}) {
        if (!isSpeaking) return;
        const session = edgeSpeechSession;
        stopEdgeAudio();
        edgeSynthAbort = new AbortController();

        const voice = queueItem.voice || voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
        const style = queueItem.style || params.style || 'general';
        const rate = queueItem.rate ?? params.rate ?? 1;
        const pitch = queueItem.pitch ?? params.pitch ?? 1;
        const pause = queueItem.pause ?? params.pause ?? 300;

        try {
          const audio = await getSegmentAudio(index);
          if (!isSpeaking || session !== edgeSpeechSession) return;
          delete edgeSegCache[index];

          // 背景預取下一段，消除段與段之間的合成等待
          prefetchNext(index);

          // 優先使用 Web Audio（行動裝置上 HTMLAudio 連續播放常被自動播放政策阻擋）
          const ctx = ensureAudioCtx();
          if (ctx && audio.decoded) {
            if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* ignore */ } }
            if (!isSpeaking || session !== edgeSpeechSession) return;
            if (ctx.state === 'suspended') {
              isPaused = true;
              playPauseBtn.textContent = '▶️ 繼續朗讀';
              speechProgressText.textContent = '⚠️ 請點「繼續朗讀」以開始播放';
              return;
            }
            const src = ctx.createBufferSource();
            src.buffer = audio.decoded;
            src.connect(ctx.destination);
            edgeSource = src;
            src.onended = () => {
              if (edgeSource !== src) return;
              edgeSource = null;
              if (isSpeaking && !isPaused) {
                setTimeout(() => speakSegment(index + 1), pause);
              }
            };
            speechProgressText.textContent = `正在朗讀 ${index + 1}/${speechPlayQueue.length} 段…`;
            try { src.start(0); } catch (startErr) { edgeSource = null; throw startErr; }
            return;
          }

          // 後備：HTMLAudioElement（重用同一個已解鎖的元素）
          edgeAudioUrl = URL.createObjectURL(new Blob([audio.buf], { type: 'audio/mpeg' }));
          if (!edgeCurrentAudio) edgeCurrentAudio = new Audio();

          edgeCurrentAudio.onended = () => {
            stopEdgeAudio();
            if (isSpeaking && !isPaused) {
              setTimeout(() => speakSegment(index + 1), pause);
            }
          };
          edgeCurrentAudio.onerror = () => {
            stopEdgeAudio();
            if (isSpeaking && !isPaused) setTimeout(() => speakSegment(index + 1), 100);
          };
          edgeCurrentAudio.src = edgeAudioUrl;

          speechProgressText.textContent = `正在朗讀 ${index + 1}/${speechPlayQueue.length} 段…`;
          try {
            await edgeCurrentAudio.play();
          } catch (playErr) {
            if (playErr?.name === 'AbortError') return;
            if (playErr?.name === 'NotAllowedError') {
              isPaused = true;
              playPauseBtn.textContent = '▶️ 繼續朗讀';
              speechProgressText.textContent = '⚠️ 瀏覽器阻擋自動播放，請點「繼續朗讀」';
              return;
            }
            throw playErr;
          }
        } catch (err) {
          if (err?.name === 'AbortError') return;
          console.warn('Edge 朗讀失敗:', err);
          speechProgressText.textContent = `第 ${index + 1} 段合成失敗，跳過…`;
          if (isSpeaking && !isPaused) {
            setTimeout(() => speakSegment(index + 1), 200);
          }
        }
      }

      function stopEdgePlaybackOnly() {
        edgeSpeechSession++;
        clearSegmentCache();
        stopEdgeAudio();
      }

      // 更新段落範圍輸入的最大值
      function updateSegmentInputs() {
        const text = latestStory || resultDiv.textContent || '';
        const segments = splitTextToSegments(text);
        const total = segments.length;
        
        const startInput = document.getElementById('startSegment');
        const endInput = document.getElementById('endSegment');
        const segmentInfo = document.getElementById('segmentInfo');
        
        startInput.max = total || 1;
        endInput.max = total || 1;
        endInput.value = total || 1;
        
        segmentInfo.textContent = `共 ${total} 段`;
        
        return segments;
      }

      // 開始/暫停朗讀（Edge 神經語音）
      async function toggleSpeech() {
        ensureAudioCtx();
        if (!edgeTtsReady) {
          const ok = await EdgeTtsSpeech.checkAvailable();
          edgeTtsReady = ok;
          if (!ok) {
            showStatus('error', 'Edge 朗讀需啟動本機伺服器（npm start）');
            return;
          }
        }

        if (!latestStory) {
          showStatus('error', '沒有可朗讀的內容，請先生成故事');
          return;
        }

        if (isSpeaking) {
          if (!isPaused) {
            isPaused = true;
            if (audioCtx && audioCtx.suspend) { try { audioCtx.suspend(); } catch (e) { /* ignore */ } }
            if (edgeCurrentAudio) { try { edgeCurrentAudio.pause(); } catch (e) { /* ignore */ } }
            saveSpeechProgress();
            playPauseBtn.textContent = '▶️ 繼續朗讀';
            speechProgressText.textContent = '⏸️ 已暫停';
          } else {
            isPaused = false;
            playPauseBtn.textContent = '⏸️ 暫停';
            speechProgressText.textContent = `正在朗讀 ${currentSegmentIndex + 1}/${speechPlayQueue.length} 段…`;
            if (edgeSource && audioCtx) {
              if (audioCtx.state === 'suspended') audioCtx.resume();
            } else if (edgeCurrentAudio && edgeCurrentAudio.src && !edgeCurrentAudio.ended) {
              edgeCurrentAudio.play().catch(() => speakSegment(currentSegmentIndex));
            } else {
              speakSegment(currentSegmentIndex);
            }
          }
          return;
        }

        const text = latestStory || resultDiv.textContent || '';
        const allSegments = splitTextToSegments(text);

        if (allSegments.length === 0) {
          showStatus('error', '沒有可朗讀的內容');
          return;
        }

        const startInput = document.getElementById('startSegment');
        const endInput = document.getElementById('endSegment');
        let startIdx = parseInt(startInput.value, 10) - 1 || 0;
        let endIdx = parseInt(endInput.value, 10) || allSegments.length;
        startIdx = Math.max(0, Math.min(startIdx, allSegments.length - 1));
        endIdx = Math.max(startIdx + 1, Math.min(endIdx, allSegments.length));

        const rangeText = allSegments.slice(startIdx, endIdx).join('\n\n');
        const baseRate = parseFloat(speechRate.value) || 1;
        const basePitch = parseFloat(speechPitch.value) || 1;
        const voiceId = voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
        const useRole = roleVoiceEnabled?.checked;

        try {
          localStorage.setItem('speechRoleEnabled', useRole ? '1' : '0');
        } catch { /* ignore */ }

        speechProgressText.textContent = useRole
          ? 'DeepSeek 分析角色與情緒中…'
          : '準備 Edge 語音…';
        playPauseBtn.disabled = true;
        if (useRole) showRoleAnalyzeUI(1);
        else hideRoleAnalyzeUI();

        let queue;
        try {
          if (useRole) {
            queue = await EdgeTtsSpeech.buildRolePlayQueue(rangeText, {
              narratorVoice: narratorVoice?.value || voiceId,
              maleVoice: maleVoice?.value || 'zh-CN-YunxiNeural',
              femaleVoice: femaleVoice?.value || 'zh-CN-XiaoxiaoNeural',
              baseRate,
              basePitch,
              dramaMode: true,
              onProgress: (phase, done, total) => {
                if (phase === 'start') {
                  showRoleAnalyzeUI(1);
                } else if (phase === 'progress') {
                  updateRoleAnalyzeUI(done, total);
                } else if (phase === 'done') {
                  updateRoleAnalyzeUI(total || 1, total || 1);
                }
              }
            });
          } else {
            queue = EdgeTtsSpeech.buildSimplePlayQueue(
              allSegments.slice(startIdx, endIdx),
              voiceId,
              emotionMode.value,
              baseRate,
              basePitch
            );
          }
        } catch (err) {
          hideRoleAnalyzeUI();
          playPauseBtn.disabled = false;
          showStatus('error', err.message || '建立朗讀佇列失敗');
          speechProgressText.textContent = '準備就緒';
          speechProgressFill.style.width = '0%';
          return;
        }

        hideRoleAnalyzeUI();

        if (!queue.length) {
          playPauseBtn.disabled = false;
          showStatus('error', '沒有可朗讀的內容');
          speechProgressFill.style.width = '0%';
          return;
        }

        speechHighlightSegments = allSegments.slice(startIdx, endIdx);
        speechHighlightRanges = segmentRanges.slice(startIdx, endIdx);

        speechPlayQueue = queue.map((item) => {
          if (item.sourceSegmentIndex != null) {
            const range = speechHighlightRanges[item.sourceSegmentIndex];
            if (range) {
              return {
                ...item,
                highlightStart: range.start,
                highlightEnd: range.end,
                highlightText: range.text
              };
            }
          }
          return { ...item };
        });
        speechSegments = speechHighlightSegments;

        let startIndex = 0;
        const savedProgress = loadSpeechProgress();
        const isReadingAll = startIdx === 0 && endIdx === allSegments.length;

        if (isReadingAll && savedProgress?.segmentIndex > 0 && savedProgress.segmentIndex < speechPlayQueue.length) {
          const resumeFromSaved = confirm(
            `發現上次朗讀進度（第 ${savedProgress.segmentIndex + 1}/${speechPlayQueue.length} 段）\n\n` +
            `確定 = 從這裡繼續\n取消 = 從頭開始`
          );
          if (resumeFromSaved) {
            startIndex = savedProgress.segmentIndex;
            if (savedProgress.rate) speechRate.value = savedProgress.rate;
            if (savedProgress.pitch) speechPitch.value = savedProgress.pitch;
            if (savedProgress.emotion) emotionMode.value = savedProgress.emotion;
            rateValue.textContent = parseFloat(speechRate.value).toFixed(1) + 'x';
            pitchValue.textContent = parseFloat(speechPitch.value).toFixed(1);
            if (savedProgress.voice) voiceSelect.value = savedProgress.voice;
          } else {
            clearSpeechProgress();
          }
        }

        stopEdgePlaybackOnly();
        isSpeaking = true;
        isPaused = false;
        playPauseBtn.disabled = false;
        playPauseBtn.textContent = '⏸️ 暫停';
        speakBtn.classList.add('active-task');

        if (!isReadingAll) {
          speechProgressText.textContent = `朗讀範圍：第 ${startIdx + 1} - ${endIdx} 段`;
        }

        setTimeout(() => {
          if (isSpeaking && !isPaused) speakSegment(startIndex);
        }, 10);
      }

      function stopSpeech() {
        stopEdgePlaybackOnly();
        isSpeaking = false;
        isPaused = false;
        speechPlayQueue = [];
        saveSpeechProgress();
        speakBtn.classList.remove('active-task');
        playPauseBtn.textContent = '▶️ 開始朗讀';
        playPauseBtn.disabled = false;
        speechProgressFill.style.width = '0%';
        speechProgressText.textContent = '準備就緒';
        currentSegmentDisplay.textContent = '- / -';
        clearHighlight();
        hideRoleAnalyzeUI();
        updateNavButtons();
      }
      
      // 重置朗讀（從頭開始）
      function resetSpeech() {
        stopSpeech();
        clearSpeechProgress();
        currentSegmentIndex = 0;
        speechProgressText.textContent = '已重置，準備從頭開始';
        clearHighlight();
        updateNavButtons();
        
        // 重置段落範圍
        const startInput = document.getElementById('startSegment');
        startInput.value = 1;
        updateSegmentInputs();
      }
      
      function prevSegment() {
        if (!isSpeaking || currentSegmentIndex <= 0) return;
        ensureAudioCtx();
        stopEdgePlaybackOnly();
        isPaused = false;
        speakSegment(currentSegmentIndex - 1);
      }

      function nextSegment() {
        if (!isSpeaking || currentSegmentIndex >= speechPlayQueue.length - 1) return;
        ensureAudioCtx();
        stopEdgePlaybackOnly();
        isPaused = false;
        speakSegment(currentSegmentIndex + 1);
      }

      function jumpToSegment(segmentIndex) {
        if (!isSpeaking || segmentIndex < 0 || segmentIndex >= speechPlayQueue.length) return;
        ensureAudioCtx();
        stopEdgePlaybackOnly();
        isPaused = false;
        speakSegment(segmentIndex);
      }

      // 複製全文
      function copyAllText() {
        const text = resultDiv.textContent || latestStory || '';
        if (!text) {
          showStatus('error', '沒有可複製的內容');
          return;
        }
        
        navigator.clipboard.writeText(text).then(() => {
          showStatus('success', '📋 已複製全文！可貼到其他 App 進行朗讀');
        }).catch(err => {
          // 備用方案：使用 textarea
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            showStatus('success', '📋 已複製全文！');
          } catch (e) {
            showStatus('error', '複製失敗，請手動選取複製');
          }
          document.body.removeChild(textarea);
        });
      }

      // 事件綁定
      speakBtn.addEventListener('click', async () => {
        speechModal.classList.add('open');
        if (!speechInitialized) await loadVoices();
        updateSegmentInputs();
        updateNavButtons();
        const savedProgress = loadSpeechProgress();
        if (savedProgress?.segmentIndex > 0 && !isSpeaking) {
          speechProgressText.textContent = `📍 上次進度：第 ${savedProgress.segmentIndex + 1} 段`;
        }
        if (!edgeTtsReady) {
          edgeTtsReady = await EdgeTtsSpeech.checkAvailable();
          if (!edgeTtsReady) {
            speechProgressText.textContent = '⚠️ 請先執行 npm start 啟動伺服器以使用 Edge 朗讀';
          }
        }
      });

      closeSpeechModal.addEventListener('click', () => {
        // 關閉視窗但不停止朗讀
        speechModal.classList.remove('open');
        if (isSpeaking) {
          showStatus('info', '🔊 朗讀繼續中... 點擊朗讀按鈕可返回控制面板');
        }
      });

      // 點擊背景關閉模態視窗
      speechModal.addEventListener('click', (e) => {
        if (e.target === speechModal) {
          // 關閉視窗但不停止朗讀
          speechModal.classList.remove('open');
          if (isSpeaking) {
            showStatus('info', '🔊 朗讀繼續中... 點擊朗讀按鈕可返回控制面板');
          }
        }
      });

      playPauseBtn.addEventListener('click', toggleSpeech);
      stopSpeechBtn.addEventListener('click', stopSpeech);
      resetSpeechBtn.addEventListener('click', resetSpeech);
      
      // 上一段/下一段按鈕
      prevSegmentBtn.addEventListener('click', prevSegment);
      nextSegmentBtn.addEventListener('click', nextSegment);
      
      // 進度條點擊跳轉
      speechProgressBar.addEventListener('click', (e) => {
        if (!isSpeaking || speechPlayQueue.length === 0) return;
        
        const rect = speechProgressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const targetIndex = Math.floor(percentage * speechPlayQueue.length);
        
        jumpToSegment(Math.max(0, Math.min(targetIndex, speechPlayQueue.length - 1)));
      });
      
      // 語速微調按鈕
      document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
        btn.addEventListener('click', () => {
          const delta = parseFloat(btn.dataset.speed);
          let newValue = parseFloat(speechRate.value) + delta;
          newValue = Math.max(0.25, Math.min(3, newValue));
          speechRate.value = newValue.toFixed(2);
          rateValue.textContent = newValue.toFixed(1) + 'x';
        });
      });
      
      // 音調微調按鈕
      document.querySelectorAll('.speed-btn[data-pitch]').forEach(btn => {
        btn.addEventListener('click', () => {
          const delta = parseFloat(btn.dataset.pitch);
          let newValue = parseFloat(speechPitch.value) + delta;
          newValue = Math.max(0.5, Math.min(2, newValue));
          speechPitch.value = newValue.toFixed(2);
          pitchValue.textContent = newValue.toFixed(1);
        });
      });
      
      // 複製全文按鈕
      document.getElementById('copyAllBtn').addEventListener('click', copyAllText);
      
      // 朗讀全部按鈕
      document.getElementById('readAllBtn').addEventListener('click', () => {
        const startInput = document.getElementById('startSegment');
        const endInput = document.getElementById('endSegment');
        startInput.value = 1;
        updateSegmentInputs();
      });
      
      // 段落輸入驗證
      document.getElementById('startSegment').addEventListener('change', function() {
        const endInput = document.getElementById('endSegment');
        if (parseInt(this.value) > parseInt(endInput.value)) {
          endInput.value = this.value;
        }
        if (parseInt(this.value) < 1) this.value = 1;
      });
      
      document.getElementById('endSegment').addEventListener('change', function() {
        const startInput = document.getElementById('startSegment');
        if (parseInt(this.value) < parseInt(startInput.value)) {
          this.value = startInput.value;
        }
        if (parseInt(this.value) < 1) this.value = 1;
      });

      speechRate.addEventListener('input', () => {
        rateValue.textContent = parseFloat(speechRate.value).toFixed(1) + 'x';
      });

      speechPitch.addEventListener('input', () => {
        pitchValue.textContent = parseFloat(speechPitch.value).toFixed(1);
      });

      // 頁面離開時儲存進度
      window.addEventListener('beforeunload', () => {
        if (isSpeaking || currentSegmentIndex > 0) {
          saveSpeechProgress();
        }
        stopEdgeAudio();
      });

      // 頁面完全載入後，確保按鈕狀態正確
      window.addEventListener('load', () => {
        setTimeout(() => {
          // 如果有故事內容，確保按鈕啟用
          if (latestStory && latestStory.length > 0) {
            document.getElementById('downloadBtn').disabled = false;
            document.getElementById('continueBtn').disabled = false;
            document.getElementById('speakBtn').disabled = false;
            updateWordCount(latestStory);
          }
        }, 500);
      });

      // ==================== 設定面板功能 ====================
      const settingsToggle = document.getElementById('settingsToggle');
      const settingsDropdown = document.getElementById('settingsDropdown');
      const settingsClose = document.getElementById('settingsClose');
      const lightThemeBtn = document.getElementById('lightThemeBtn');
      const darkThemeBtn = document.getElementById('darkThemeBtn');
      const fontSizeSlider = document.getElementById('fontSizeSlider');
      const fontSizeValue = document.getElementById('fontSizeValue');

      // 設定面板開關
      function syncSettingsToolbarState() {
        document.body.classList.toggle('settings-open', settingsDropdown.classList.contains('open'));
      }

      settingsToggle.addEventListener('click', () => {
        settingsDropdown.classList.toggle('open');
        syncSettingsToolbarState();
      });

      settingsClose.addEventListener('click', () => {
        settingsDropdown.classList.remove('open');
        syncSettingsToolbarState();
      });

      // 點擊外部關閉設定面板
      document.addEventListener('click', (e) => {
        if (!settingsDropdown.contains(e.target) && !settingsToggle.contains(e.target)) {
          settingsDropdown.classList.remove('open');
          syncSettingsToolbarState();
        }
      });

      // ==================== 主題切換功能 ====================
      function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        if (theme === 'dark') {
          darkThemeBtn.classList.add('active');
          lightThemeBtn.classList.remove('active');
        } else {
          lightThemeBtn.classList.add('active');
          darkThemeBtn.classList.remove('active');
        }
      }

      // 載入儲存的主題
      const savedTheme = localStorage.getItem('theme') || 'light';
      setTheme(savedTheme);

      lightThemeBtn.addEventListener('click', () => setTheme('light'));
      darkThemeBtn.addEventListener('click', () => setTheme('dark'));

      // ==================== 書桌檯燈：點擊切換明暗 ====================
      const deskLamp = document.getElementById('deskLamp');
      if (deskLamp) {
        deskLamp.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'light';
          setTheme(current === 'dark' ? 'light' : 'dark');
        });
      }

      // ==================== 閱讀區氛圍 ====================
      const READING_AMBIANCES = [
        { id: 'library', label: '📚 圖書館' },
        { id: 'cafe', label: '☕ 咖啡廳' },
        { id: 'moon', label: '🌙 月夜' },
        { id: 'rain', label: '🌧️ 雨夜' },
        { id: 'study', label: '🏮 書齋' },
        { id: 'bamboo', label: '🎋 竹林' },
        { id: 'sea', label: '🌊 海邊' },
        { id: 'hearth', label: '🔥 壁爐' },
        { id: 'sakura', label: '🌸 櫻花' },
        { id: 'mountain', label: '🏔️ 雲山' },
      ];
      const VALID_AMBIANCE_IDS = new Set(READING_AMBIANCES.map((a) => a.id));

      const readingScene = document.getElementById('readingScene');
      const ambianceSelect = document.getElementById('ambianceSelect');
      const settingsAmbianceSelect = document.getElementById('settingsAmbianceSelect');

      function buildAmbianceOptions() {
        return READING_AMBIANCES.map((a) =>
          `<option value="${a.id}">${a.label}</option>`
        ).join('');
      }

      function applyAmbiance(mode) {
        const value = VALID_AMBIANCE_IDS.has(mode) ? mode : 'library';
        if (readingScene) readingScene.dataset.ambiance = value;
        if (ambianceSelect) ambianceSelect.value = value;
        if (settingsAmbianceSelect) settingsAmbianceSelect.value = value;
        try { localStorage.setItem('readingAmbiance', value); } catch (e) {}
      }

      if (readingScene) {
        const optionsHtml = buildAmbianceOptions();
        if (ambianceSelect) ambianceSelect.innerHTML = optionsHtml;
        if (settingsAmbianceSelect) settingsAmbianceSelect.innerHTML = optionsHtml;
        if (ambianceSelect) {
          ambianceSelect.addEventListener('change', () => applyAmbiance(ambianceSelect.value));
        }
        if (settingsAmbianceSelect) {
          settingsAmbianceSelect.addEventListener('change', () => applyAmbiance(settingsAmbianceSelect.value));
        }
        applyAmbiance(localStorage.getItem('readingAmbiance') || 'library');
      }

      // ==================== 字體大小調整 ====================
      function setFontSize(size) {
        let px = Number(size);
        if (isMobileReadingLayout() && isVerticalWriting()) {
          px = Math.max(px, 21);
        }
        document.getElementById('result').style.fontSize = px + 'px';
        document.getElementById('result').style.lineHeight = (px * 0.11 + 1.1).toFixed(2);
        fontSizeValue.textContent = px + 'px';
        localStorage.setItem('readingFontSize', size);
      }

      // 載入儲存的字體大小（手機直排預設略大，方便閱讀）
      const savedFontSize = localStorage.getItem('readingFontSize')
        || (isMobileReadingLayout() ? 21 : 18);
      fontSizeSlider.value = savedFontSize;
      setFontSize(savedFontSize);

      fontSizeSlider.addEventListener('input', () => {
        setFontSize(fontSizeSlider.value);
      });

      // ==================== 排版方向（橫排 / 直排）====================
      const horizontalWritingBtn = document.getElementById('horizontalWritingBtn');
      const verticalWritingBtn = document.getElementById('verticalWritingBtn');

      function setWritingMode(mode) {
        const vertical = mode === 'vertical';
        resultDiv.classList.toggle('vertical-writing', vertical);
        if (outputWrap) {
          outputWrap.classList.toggle('vertical-scroll', vertical);
          outputWrap.classList.toggle('horizontal-scroll', !vertical);
        }
        if (horizontalWritingBtn) horizontalWritingBtn.classList.toggle('active', !vertical);
        if (verticalWritingBtn) verticalWritingBtn.classList.toggle('active', vertical);
        try { localStorage.setItem('writingMode', mode); } catch (e) {}
        if (vertical) {
          verticalScrollStartAtMin = null;
          document.body.classList.add('vertical-writing-mode');
          syncVerticalLayout();
          scrollVerticalToStart(true);
        } else if (resultDiv) {
          verticalScrollStartAtMin = null;
          document.body.classList.remove('vertical-writing-mode');
          document.body.classList.remove('vertical-reading-mobile');
          verticalScrollToStartPending = false;
          unbindVerticalStartScrollObserver();
          if (verticalViewport) verticalViewport.style.height = '';
          resultDiv.style.height = '';
          resultDiv.style.width = '';
          resultDiv.style.minWidth = '';
          resultDiv.style.display = '';
        }
        setFontSize(fontSizeSlider.value);
      }

      if (horizontalWritingBtn && verticalWritingBtn) {
        horizontalWritingBtn.addEventListener('click', () => setWritingMode('horizontal'));
        verticalWritingBtn.addEventListener('click', () => setWritingMode('vertical'));
        setWritingMode(localStorage.getItem('writingMode') || 'horizontal');
      }

      // ==================== 章節計算（全域統一）====================
      // 只計算「行首」的章節標題（可含 # 標記），避免內文提到「第N章」被誤算，
      // 讓自動生成、繼續生成與結果面板的章節數一致。
      // 將 AI 回傳的各種定位說法正規化成下拉的標準選項；無法判斷時回 ''
      function normalizeCharRole(raw, gender) {
        if (!raw) return '';
        const s = String(raw).trim();
        if (!s) return '';
        const VALID = ['男主角', '女主角', '男配角', '女配角', '反派', '路人'];
        if (s === '配角') {
          if (gender === '女') return '女配角';
          if (gender === '男') return '男配角';
          return '男配角';
        }
        if (VALID.includes(s)) return s;
        const lower = s.toLowerCase();
        // 反派類
        if (/反派|反一|反二|大?boss|魔王|反角|對手|敵人|宿敵/i.test(s) || lower.includes('villain') || lower.includes('antagonist')) {
          return '反派';
        }
        // 路人/龍套
        if (/路人|龍套|跑龍套|背景|群眾/.test(s) || lower.includes('extra') || lower.includes('passerby')) {
          return '路人';
        }
        const isMain = /主角|主人公|主役|男一|女一|男主|女主|主线|主線/.test(s) || lower.includes('protagonist') || lower.includes('lead') || lower.includes('main');
        const isSub = /配角|配|男二|女二|男三|女三|次要|support/i.test(s);
        const femaleHint = /女/.test(s) || gender === '女';
        const maleHint = /男/.test(s) || gender === '男';
        if (isMain) {
          if (femaleHint && !maleHint) return '女主角';
          if (maleHint && !femaleHint) return '男主角';
          return gender === '女' ? '女主角' : '男主角';
        }
        if (isSub) {
          if (femaleHint && !maleHint) return '女配角';
          if (maleHint && !femaleHint) return '男配角';
          return gender === '女' ? '女配角' : '男配角';
        }
        return '';
      }

      // 收集人物設定（generate 與 continue 共用，確保一致）
      // 角色定位：男主角/女主角/反派 視為「主要」，其餘（男配/女配/路人）視為「次要」。
      const MAIN_ROLE_SET = new Set(['男主角', '女主角', '主角', '反派']);
      function collectCharactersInfo() {
        const rows = Array.from(charactersContainer.querySelectorAll('.character-row'));
        let charactersInfo = '';
        const characterNames = [];
        const mainNames = [];
        const secondaryNames = [];
        let characterCount = 0;
        let anyRole = false;
        rows.forEach((row, idx) => {
          const fields = [];
          const gender = row.querySelector('.char-gender').value;
          const roleEl = row.querySelector('.char-role');
          const role = roleEl ? roleEl.value.trim() : '';
          const age = row.querySelector('.char-age').value.trim();
          const name = row.querySelector('.char-name').value.trim();
          const personality = row.querySelector('.char-personality').value.trim();
          const goal = row.querySelector('.char-goal').value.trim();
          const weakness = row.querySelector('.char-weakness').value.trim();
          const secret = row.querySelector('.char-secret').value.trim();
          const relation = row.querySelector('.char-relation').value.trim();
          if (role) anyRole = true;
          if (name) { fields.push(`【${name}】`); characterNames.push(name); }
          if (role) fields.push(`定位：${role}`);
          if (gender && gender !== '不明') fields.push(`性別：${gender}`);
          if (age) fields.push(`年齡：${/^\d+$/.test(age) ? age + '歲' : age}`);
          if (personality) fields.push(`個性：${personality}`);
          if (goal) fields.push(`目標：${goal}`);
          if (weakness) fields.push(`弱點：${weakness}`);
          if (secret) fields.push(`秘密：${secret}`);
          if (relation) fields.push(`人際關係：${relation}`);
          if (fields.length > 0) {
            charactersInfo += `角色${idx + 1}：${fields.join('，')}。\n`;
            characterCount++;
          }
          if (name) {
            if (role && MAIN_ROLE_SET.has(role)) mainNames.push(name);
            else secondaryNames.push(name);
          }
        });
        // 完全沒有人設定定位時，沿用舊行為：全部視為主要角色
        if (!anyRole) {
          mainNames.length = 0;
          secondaryNames.length = 0;
          characterNames.forEach(n => mainNames.push(n));
        }
        return { charactersInfo, characterNames, characterCount, mainNames, secondaryNames };
      }

      function countChapters(text) {
        if (!text) return 0;
        const re = /^\s*#{0,4}\s*(?:第\s*[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+\s*[章節回卷部集篇]|Chapter\s*\d+)/gim;
        return (text.match(re) || []).length;
      }

      /** 續寫時判斷章節進度（含「正文已寫但缺章節標題」的進行中狀態） */
      function getContinuationChapterState(story, targetChapters) {
        const written = countChapters(story);
        if (written > 0) return { written, inProgress: false, inProgressChapter: 0 };
        if (targetChapters > 0 && countStoryWords(story) > 200) {
          return { written: 0, inProgress: true, inProgressChapter: 1 };
        }
        return { written: 0, inProgress: false, inProgressChapter: 0 };
      }

      function getRemainingChapterCount(story, targetChapters) {
        if (targetChapters <= 0) return 0;
        const state = getContinuationChapterState(story, targetChapters);
        if (state.inProgress) return Math.max(1, targetChapters - state.inProgressChapter + 1);
        return Math.max(0, targetChapters - state.written);
      }

      function isStoryOverWordBudget(plan, story, tolerance = 1.08) {
        if (!plan?.targetTotal || plan.targetTotal <= 0) return false;
        return countStoryWords(story) >= Math.round(plan.targetTotal * tolerance);
      }

      function isCompactStoryPlan(plan) {
        if (!plan) return false;
        return (plan.targetTotal > 0 && plan.targetTotal <= 8000)
          || (plan.wordsPerChapter > 0 && plan.wordsPerChapter <= 6000);
      }

      function countStoryWords(text) {
        if (!text) return 0;
        return text.replace(/[\s\n#*_\-]/g, '').length;
      }

      /** 單次 API 輸出可安全容納的漢字量（對應 max_tokens 16384，保守估計） */
      function getMaxWordsPerApiSegment() {
        return 4200;
      }

      /** 單次請求請 AI 寫的字數上限（長章節分段接續） */
      function getWordsPerApiCall(wordsPerChapter) {
        const cap = getMaxWordsPerApiSegment();
        const wpc = wordsPerChapter || 2500;
        return wpc > cap ? cap : wpc;
      }

      function getLastChapterText(story) {
        if (!story) return '';
        const re = /^\s*#{0,4}\s*(?:第\s*[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+\s*[章節回卷部集篇]|Chapter\s*\d+)/gim;
        const matches = [...story.matchAll(re)];
        if (!matches.length) return story;
        return story.substring(matches[matches.length - 1].index);
      }

      function getLastChapterWordCount(story) {
        return countStoryWords(getLastChapterText(story));
      }

      /** 文本是否在句中被截斷（finish_reason 遺失時的備援） */
      function isLikelyTruncated(text, finishReason) {
        if (finishReason === 'length') return true;
        const t = (text || '').trim();
        if (t.length < 1200) return false;
        if (/（全文完）|（完）|（全文完結）/.test(t.slice(-30))) return false;
        const tail = t.slice(-120);
        if (/[。！？…」』」\n]$/.test(tail.trimEnd())) return false;
        return !/[。！？…」』」]/.test(tail.slice(-60));
      }

      /** 本章是否尚未寫足（用於分段自動接續） */
      function isCurrentChapterUnderTarget(plan, story) {
        if (!plan || !plan.wordsPerChapter || plan.wordsPerChapter <= 0) return false;
        const lastW = getLastChapterWordCount(story);
        if (lastW < 800) return false;
        const floor = Math.round(plan.minPerChapter * 0.88);
        return lastW < floor;
      }

      function shouldAutoResumeSegment(finishReason, story, plan, ctx = {}) {
        if (ctx.isAlreadyComplete) {
          return finishReason === 'length' || isLikelyTruncated(story.trim(), finishReason);
        }
        const lastCh = getLastChapterText(story);
        if (finishReason === 'length') return true;
        if (isLikelyTruncated(lastCh, finishReason)) return true;
        return isCurrentChapterUnderTarget(plan, story);
      }

      /** 依「預計總字數 ÷ 章節數」推算每章篇幅，供 prompt 與 max_tokens 使用 */
      function getStoryLengthPlan(chaptersOverride, lengthOverride) {
        const targetChapters = parseInt(chaptersOverride ?? chaptersInput?.value, 10) || 0;
        const targetTotal = parseInt(lengthOverride ?? lengthInput?.value, 10) || 0;
        const defaultPerChapter = 2500;
        let wordsPerChapter = 0;
        if (targetTotal > 0 && targetChapters > 0) {
          wordsPerChapter = Math.round(targetTotal / targetChapters);
        } else if (targetTotal > 0) {
          wordsPerChapter = targetTotal;
        }
        const effective = wordsPerChapter || defaultPerChapter;
        const minPerChapter = Math.max(1500, Math.round(effective * 0.88));
        const maxPerChapter = Math.round(effective * 1.12);
        return { targetChapters, targetTotal, wordsPerChapter: effective, minPerChapter, maxPerChapter };
      }

      function tokensForChapterWords(wordsPerChapter) {
        const callWords = getWordsPerApiCall(wordsPerChapter);
        const need = Math.ceil(callWords * 1.75);
        if (callWords >= 3200) return 16384;
        return Math.min(16384, Math.max(6144, need));
      }

      function formatChapterWordRequirement(plan, { chapterLabel = '每章', emphasize = false } = {}) {
        const { wordsPerChapter, minPerChapter, maxPerChapter, targetTotal, targetChapters } = plan;
        const apiCallWords = getWordsPerApiCall(wordsPerChapter);
        const segmented = wordsPerChapter > apiCallWords;
        let line;
        if (targetTotal > 0 && targetChapters > 0) {
          if (segmented) {
            line = `• ${chapterLabel}全章字數目標：約 ${wordsPerChapter.toLocaleString()} 字（全書 ${targetTotal.toLocaleString()} 字 ÷ ${targetChapters} 章）`;
            line += `\n• ⚠️【本次輸出】單次請寫約 ${apiCallWords.toLocaleString()} 字，在完整句子處自然停下即可，其餘由系統自動接續`;
            line += `\n• 禁止一次寫完全章；允許篇幅 ${minPerChapter.toLocaleString()}～${maxPerChapter.toLocaleString()} 字`;
          } else {
            line = `• ${chapterLabel}字數目標：約 ${wordsPerChapter.toLocaleString()} 字（全書 ${targetTotal.toLocaleString()} 字 ÷ ${targetChapters} 章，允許 ${minPerChapter.toLocaleString()}～${maxPerChapter.toLocaleString()} 字）`;
          }
        } else if (targetTotal > 0) {
          line = `• 本篇字數目標：約 ${targetTotal.toLocaleString()} 字（允許 ${minPerChapter.toLocaleString()}～${maxPerChapter.toLocaleString()} 字）`;
          if (segmented) {
            line += `\n• ⚠️【本次輸出】單次請寫約 ${apiCallWords.toLocaleString()} 字，其餘由系統自動接續`;
          }
        } else {
          line = `• ${chapterLabel}至少 ${minPerChapter.toLocaleString()} 字紮實內容`;
        }
        if (segmented) {
          line += '\n• 若單次未寫完，系統會自動接續補完（無需手動點擊）';
        }
        if (emphasize && targetTotal > 0) {
          line += '\n• ⚠️ 字數明顯不足會導致全書篇幅未達標，請務必寫足上述目標';
        }
        return line;
      }

      function formatWordTargetGap(plan, currentWords) {
        if (!plan.targetTotal || plan.targetTotal <= 0) return '';
        const gap = plan.targetTotal - currentWords;
        if (gap <= plan.targetTotal * 0.1) return '';
        return `（已 ${currentWords.toLocaleString()} 字，距目標 ${plan.targetTotal.toLocaleString()} 字尚差 ${gap.toLocaleString()} 字）`;
      }

      // ==================== 結局傾向：後日談／預告段（三軌） ====================
      // series（A 級）：適合寫成完整續集／分集
      const ENDING_SERIES = new Set(['續集鋪墊', '伏筆結局']);
      // coda（番外 + B 級開放留白）：主線收束後加一段短後段，不分集
      const ENDING_CODA = new Set([
        '番外預告', 'OE', '半開放', '開放暗示HE', '讀者選擇', '多結局',
        '遺憾HE', '神隱結局', '第三方結局', '反派勝利', 'TE', '犧牲換新生',
        '覺醒結局', '昇華結局'
      ]);

      /** 回傳結局軌道：'series' | 'coda' | 'closed' */
      function getEndingKind(ending) {
        if (!ending) return 'closed';
        if (ENDING_SERIES.has(ending)) return 'series';
        if (ENDING_CODA.has(ending)) return 'coda';
        return 'closed';
      }

      // 各結局的 ② 後段具體寫法（coda/series 共用；series 在最終集才用使用者所選，非最終集用續集引子）
      const ENDING_CODA_SPEC = {
        '續集鋪墊': '本書主線衝突完全解決、世界進入新平衡後，另起一段（約 300～600 字）以「數月後／數年後」時間跳接，明確點出新的威脅或新的旅程即將展開。禁止把本書未解的主線丟給續集。',
        '伏筆結局': '本書主線有明確結論後，另起一段（約 300～500 字）埋下 1～2 個全新或未完全解釋的細節，指向下一部作品。禁止主線核心問題未答、禁止超過 2 個伏筆。',
        '番外預告': '本書主線完整大結局後，另起新段並以「### 番外：標題」為小標，實際寫出一篇完整、獨立的番外故事（聚焦支線、日常或配角，約 800～1500 字，要有起承轉合的小情節）。不可只寫「敬請期待」式的一句預告，而是真的把番外篇寫出來。',
        'OE': '主線衝突須有明確結果後，在結尾留 1～2 個開放問題或象徵性畫面，不給定論（約 150～400 字）。',
        '半開放': '主線完整收束後，刻意保留一條支線留白，作為餘韻（約 150～400 字）。',
        '開放暗示HE': '主線收束、整體傾向圓滿，但結尾以留白方式暗示而非寫死美好（約 150～400 字）。',
        '讀者選擇': '主線收束後，以略帶歧義的畫面收尾，讓讀者自行詮釋走向（約 150～400 字）。',
        '多結局': '主線收束後，含蓄暗示另一條平行的可能性／IF 線（約 150～400 字），語氣不確定。',
        '遺憾HE': '主線達成但帶代價，結尾以一段餘韻寫出未能彌補的遺憾（約 150～450 字）。',
        '神隱結局': '主線收束後，讓某要角悄然消失、去向成謎，留下追尋的餘地（約 150～450 字）。',
        '第三方結局': '主線收束後，暗示螳螂捕蟬、另一股勢力在暗處得利（約 150～450 字）。',
        '反派勝利': '主線在本書視角內收束後，暗示黑暗統治下仍有未熄的反抗火種（約 150～450 字）。',
        'TE': '主線收束後，揭露一個隱藏真相，並暗示其後續餘波（約 150～450 字）。',
        '犧牲換新生': '主線以犧牲達成後，結尾寫出由此開啟的新時代，並帶一絲不安或代價（約 150～450 字）。',
        '覺醒結局': '主線收束後，以打破第四面牆／meta 的餘韻作結（約 150～400 字）。',
        '昇華結局': '主線收束後，以角色境界提升、超脫的餘韻作結，不寫明確續集預告（約 150～400 字）。'
      };

      /**
       * 產生結局指令。
       * @param {string} ending 結局 value
       * @param {'setup'|'foreshadow'|'final'|'epilogue'} phase
       * @param {object} opts { isSeriesVolume, isFinalVolume }
       */
      function getEndingDirective(ending, phase, opts = {}) {
        const kind = getEndingKind(ending);
        const { isSeriesVolume = false, isFinalVolume = true, volumeIndex = 0, compactStory = false } = opts;
        if (!ending) return '';

        // 分集（非最終集）：本集主線收束 + 續集引子，不論使用者所選結局
        if (isSeriesVolume && !isFinalVolume) {
          if (phase === 'setup') {
            if (volumeIndex > 0) {
              return `\n• 本集為系列第 ${volumeIndex + 1} 集（接續前集）：第1章須從【接續錨點】直接接寫，禁止當全新開場、禁止重複第一集已寫情節`;
            }
            return `\n• 本集為系列的其中一集，會有後續集數；請正常開篇，勿在開頭就收尾`;
          }
          if (phase === 'foreshadow') {
            return `\n• 本集即將收尾：請收束「本集」的主線衝突，並為下一集輕埋線索`;
          }
          if (phase === 'final' || phase === 'epilogue') {
            return `\n◆ 本集結尾（兩段式，務必遵守）◆\n• 先完整收束「本集」的主線衝突與角色階段性去向（約佔本章 70～85%）\n• 再另起一段（約 300～500 字）作為「續集引子」：承先啟後，點出下一集的新衝突或新目標\n• 本集結尾標記為「（本集完）」，不要用「（全文完）」\n• 禁止只寫普通結尾就收場；禁止把本集主線留到下一集`;
          }
          return '';
        }

        // closed：單段收束
        if (kind === 'closed') {
          if (phase === 'final') {
            return `\n• 結局類型「${ending}」：在最後一章完整收束主線，給角色明確結局，結尾標「（全文完）」`;
          }
          return '';
        }

        // coda / series 最終集：兩段式（① 主線收束 + ② 後段）
        let spec = ENDING_CODA_SPEC[ending] || '主線收束後，補一段呼應結局傾向的後日談。';
        if (compactStory && !endingNeedsOmake(ending)) {
          spec = '主線收束後，以 80～200 字呼應結局傾向即可；勿另起「② 後段」標題，勿重述主線';
        }

        // 番外預告：主線完結後，實際寫出一篇完整番外篇（### 番外：標題）
        if (endingNeedsOmake(ending)) {
          if (phase === 'setup') {
            return `\n• 全書結局傾向「番外預告」：主線完結後需「另寫一篇完整番外篇」，但現在是開頭，請先正常鋪陳，不要提前寫番外`;
          }
          if (phase === 'foreshadow') {
            return `\n• 全書結局傾向「番外預告」：故事即將收尾，請先把主線伏筆收齊；主線完結後會再加一篇番外篇`;
          }
          if (phase === 'final') {
            return `\n◆ 最終章＋番外篇（結局傾向「番外預告」，務必遵守）◆\n• 先在本章完整收束主線（核心衝突有結果、主要角色弧線有交代）\n• 主線收束後，另起新段並以「### 番外：標題」為小標，實際寫出一篇完整、獨立的番外故事：${spec}\n• 全文最後再標「（全文完）」\n• ⚠️ 不可只寫主線結尾就（全文完）而漏掉番外篇，也不可只寫一句「敬請期待番外」`;
          }
          if (phase === 'epilogue') {
            return `\n◆ 補寫番外篇（結局傾向「番外預告」）◆\n• 主線已完結，請接著另起新段並以「### 番外：標題」為小標，補寫一篇完整、獨立的番外故事：${spec}\n• 不要重述主線、不要新增「第N章」編號章節\n• 番外篇結尾標「（全文完）」`;
          }
        }

        if (phase === 'setup') {
          return `\n• 全書結局傾向為「${ending}」：請記住最終章需「主線收束 + 後段」兩段式，但**現在是開頭，先正常鋪陳，不要提前寫結局或後段**`;
        }
        if (phase === 'foreshadow') {
          return `\n• 全書結局傾向「${ending}」：故事即將進入尾聲，請開始收束主線伏筆，為最終章的後段做準備（現在還不要寫後段）`;
        }
        if (phase === 'final') {
          return `\n◆ 最終章結局（結局傾向「${ending}」，兩段式，務必遵守）◆\n• 先完整收束本書主線：核心衝突有明確結果、主要角色弧線有交代、開頭提出的主問題有答案（約佔本章 70～85%）\n• 再另起一段作為「② 後段」：${spec}\n• 「（全文完）」必須放在 ② 後段之後\n• ⚠️ 禁止只寫普通結尾就標（全文完）而漏掉 ② 後段`;
        }
        if (phase === 'epilogue') {
          return `\n◆ 補寫後段（結局傾向「${ending}」）◆\n• 本書主線已完成，請**只補上缺少的「② 後段」**：${spec}\n• 不要重述或改寫已完成的結局、不要新增章節\n• 補完後在最後標「（全文完）」`;
        }
        return '';
      }

      // ② 後段特徵（用於判斷 coda/series 後段是否已寫出）
      const CODA_FEATURE_RE = /數日後|數月後|數年後|多年後|數週後|不久之後|與此同時|另一(處|端|邊)|新的旅程|新的篇章|新的征程|敬請期待|番外|續集|尚未(結束|落幕)|序幕|拉開帷幕|（本集完）|（全文完）/;
      // 實際的番外篇段落（行首小標「番外」），而非只是內文提到「番外」二字
      const OMAKE_RE = /(?:^|\n)\s*#{0,4}\s*番外/;
      function endingNeedsOmake(ending) { return ending === '番外預告'; }
      // 一般完結標記（沿用既有）
      const STORY_COMPLETE_RE = /[（(](?:全文完|完結|全書完|終|The End)[）)]|【完】|—完—|～完～|（END）|─\s*完\s*─/i;
      // 系列完結標記（含分集）
      const SERIES_COMPLETE_RE = /[（(](?:上集完|中集完|下集完|本集完|第.{1,3}集完|全文完|完結|全書完)[）)]/;

      /**
       * 判斷結局是否「合格」（取代純完結標記判斷，修正 epilogue 不可達）。
       * closed：有完結標記即可；coda/series 最終集：完結標記 + ② 後段特徵。
       */
      function isEndingSatisfied(text, ending, opts = {}) {
        if (!text) return false;
        const kind = getEndingKind(ending);
        const { isSeriesVolume = false, isFinalVolume = true, compactStory = false } = opts;
        const hasComplete = STORY_COMPLETE_RE.test(text) || SERIES_COMPLETE_RE.test(text);
        if (!hasComplete) return false;
        // 非最終集：本集完標記 + 後段特徵
        if (isSeriesVolume && !isFinalVolume) {
          return SERIES_COMPLETE_RE.test(text) && CODA_FEATURE_RE.test(text);
        }
        if (kind === 'closed') return true;
        // 短篇：有完結標記即可，不強制②後段特徵
        if (compactStory && kind === 'coda' && !endingNeedsOmake(ending)) return true;
        // 番外預告：必須真的有一篇番外段落（行首小標）
        if (endingNeedsOmake(ending)) return OMAKE_RE.test(text);
        // coda / 最終集：需偵測到 ② 後段
        return CODA_FEATURE_RE.test(text);
      }

      // ==================== 系列分集：資料模型與工具 ====================
      function buildPrevVolumeContext(prevContent, volumeIndex, seriesTotal) {
        if (!prevContent || volumeIndex <= 0) return '';
        const prevLabel = getVolumeLabel(volumeIndex - 1, seriesTotal);
        const tail = prevContent.slice(-12000);
        const anchor = prevContent.slice(-900).trim();
        return `\n\n═══════════════════════════════════════
【前集正文結尾（${prevLabel}，★本集必須從此處接續★）】
═══════════════════════════════════════

${tail}

【接續錨點（本集第1章開頭必須緊接以下文字之後；時間／地點／情緒連續，禁止跳回重寫第一集開場）】
${anchor}
`;
      }

      function stripDuplicateBookTitleLines(existingStory, newChunk) {
        if (!existingStory || !newChunk) return newChunk || '';
        if (!/^#\s*《.+》/m.test(existingStory)) return newChunk;
        return String(newChunk).replace(/^\s*#\s*《[^》]+》[^\n]*\n+/gm, '').trim();
      }

      const OUTLINE_VOL_MARKER = (label) => `═══════════ ${label}大綱 ═══════════`;

      function getOutlineVolumeTotal() {
        if (storySeries && storySeries.totalVolumes > 1) return storySeries.totalVolumes;
        return getPlannedVolumes();
      }

      function getOutlineForVolumeIndex(volumeIndex, totalVolumes) {
        if (!currentOutline) return '';
        const total = totalVolumes || getOutlineVolumeTotal();
        if (total <= 1) return currentOutline;
        const label = getVolumeLabel(volumeIndex, total);
        const marker = OUTLINE_VOL_MARKER(label);
        const idx = currentOutline.indexOf(marker);
        if (idx < 0) return volumeIndex === 0 ? currentOutline : '';
        const start = idx + marker.length;
        let end = currentOutline.length;
        for (let i = 0; i < total; i++) {
          if (i === volumeIndex) continue;
          const otherMarker = OUTLINE_VOL_MARKER(getVolumeLabel(i, total));
          const otherIdx = currentOutline.indexOf(otherMarker, start);
          if (otherIdx >= 0 && otherIdx < end) end = otherIdx;
        }
        return currentOutline.slice(start, end).trim();
      }

      function buildOutlineStructureSection(chapterCount) {
        if (chapterCount === 1) {
          return `【敘事結構】
這是一篇【單章短篇】，請在這唯一的一章內安排完整的起承轉合（開場鉤子 → 衝突發展 → 高潮 → 結局），不要拆分成多章。`;
        }
        if (chapterCount <= 3) {
          return `【敘事結構】
請在僅有的 ${chapterCount} 章篇幅內安排起承轉合，逐一說明這 ${chapterCount} 章分別負責哪個階段。`;
        }
        return `【敘事結構】
• 第一幕（建置）：哪幾章？建立什麼世界觀與角色？
• 第二幕（對抗）：哪幾章？核心衝突如何升級？
• 第三幕（解決）：哪幾章？高潮與結局如何收束？`;
      }

      function buildOutlineChapterListTemplate(chapterCount) {
        if (chapterCount === 1) {
          return `第1章：標題
（120-200字）這是【唯一的一章】，需在本章內完成完整故事：開場鉤子、衝突發展、高潮、結局。`;
        }
        const maxShown = Math.min(chapterCount, 30);
        const lines = [];
        for (let i = 1; i <= maxShown; i++) {
          lines.push(`第${i}章：標題\n（80-120字）本章的核心情節、衝突推進，以及結尾的懸念或轉折。`);
        }
        let tpl = lines.join('\n\n');
        if (chapterCount > maxShown) {
          tpl += `\n\n...請依相同格式繼續，直到第${chapterCount}章為止。`;
        }
        return tpl;
      }

      function buildVolumeOutlinePrompt(ctx) {
        const {
          volumeIndex, totalVolumes, volumeLabel, isFinalVolume,
          chapterCount, chapters, theme, setting, era, style,
          narrative, pacing, emotionalTone, worldComplexity, rating, ending,
          charactersInfo, selectedElements, outlineEndingNote, prevVolumeOutline
        } = ctx;
        const structureSection = buildOutlineStructureSection(chapterCount);
        const chapterListTemplate = buildOutlineChapterListTemplate(chapterCount);
        const notesBlock = getSupplementaryNotesBlock(getUserNotesText());
        let seriesBlock = '';
        if (totalVolumes >= 2) {
          seriesBlock = `\n系列規模：共 ${totalVolumes} 集；本次只規劃【${volumeLabel}】（每集 ${chapters} 章，各集章節獨立從第1章編號）`;
          if (volumeIndex === 0) {
            seriesBlock += `\n★ 請先輸出【系列總覽】（2～4 句話概括全系列主線與各集分工），再輸出本集大綱各區塊`;
          } else {
            seriesBlock += `\n★ 本集須承接前集結尾，禁止重寫第一集開場、禁止重複已發生過的情節`;
            if (prevVolumeOutline) {
              seriesBlock += `\n\n【前集大綱（僅供銜接，勿複製進本集正文規劃）】\n${prevVolumeOutline.slice(-6000)}`;
            }
          }
          if (!isFinalVolume) {
            seriesBlock += `\n★ 本集非最終集：最後一章大綱須含「續集引子」，標註本集收束與下一集新衝突`;
          }
        }
        return `【角色設定：資深故事架構師】

你是一位精通敘事結構的故事架構師，擅長系列分集與長篇連載規劃。

═══════════════════════════════════════
【本次任務：設計${totalVolumes >= 2 ? `「${volumeLabel}」` : '故事'}藍圖】
═══════════════════════════════════════

【故事設定】
${theme ? `主題：${theme}` : ''}
${setting ? `背景：${setting}` : ''}
${era ? `時代：${era}` : ''}
${style ? `風格：${style}` : ''}
${narrative ? `敘事視角：${narrative}` : ''}
${pacing ? `節奏：${pacing}` : ''}
${emotionalTone ? `基調：${emotionalTone}` : ''}
${worldComplexity ? `世界觀複雜度：${worldComplexity}` : ''}
${rating ? `內容分級：${rating}` : ''}
${ending ? `結局傾向：${ending}` : ''}
${totalVolumes >= 2 ? `本集章節數：${chapters} 章` : `章節數：${chapters} 章`}
★★★ 嚴格限制：「各章節大綱」必須剛好 ${chapters} 章，不可多也不可少！ ★★★
${charactersInfo ? `\n【主要人物】\n${charactersInfo}` : ''}
${selectedElements.length > 0 ? `\n【特殊元素】\n${selectedElements.join('、')}` : ''}
${notesBlock}${seriesBlock}

═══════════════════════════════════════
【輸出格式要求】
═══════════════════════════════════════

${volumeIndex === 0 && totalVolumes >= 2 ? '【系列總覽】\n（2～4 句全系列主線）\n\n' : ''}請設計本${totalVolumes >= 2 ? '集' : '書'}大綱，包含：

【故事概述】
用 2-3 句話勾勒本${totalVolumes >= 2 ? '集' : '書'}核心

${structureSection}${isFinalVolume ? outlineEndingNote : (totalVolumes >= 2 && !isFinalVolume ? '\n\n【本集結局】最後一章須含續集引子' : '')}

【各章節大綱】（必須剛好 ${chapters} 章）
${chapterListTemplate}

【核心衝突設計】
• 外在衝突 / 內在衝突 / 關係衝突

【角色弧線】
• 起點 / 轉折 / 終點

【伏筆與懸念清單】
3-5 個伏筆，標註章節

請使用繁體中文；「各章節大綱」必須剛好 ${chapters} 章。`;
      }

      /** 依集數與總集數取得標籤：2 集→上集/下集；3+ 集→第N集 */
      function getVolumeLabel(index, total) {
        if (total <= 1) return '';
        const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        if (total === 2) return index === 0 ? '上集' : '下集';
        return `第${cn[index] || (index + 1)}集`;
      }

      /** 取「預計集數」欄位值（預設 1） */
      function getPlannedVolumes() {
        const el = document.getElementById('volumes');
        const v = el ? parseInt(el.value, 10) : 1;
        return Math.max(1, Math.min(5, v || 1));
      }

      /** 去掉書名的集別後綴 → 基底書名 */
      function stripVolumeSuffix(title) {
        return (title || '').replace(/[（(](?:上集|中集|下集|第.{1,3}集)[）)]\s*$/,'').trim();
      }

      /** 從文字擷取書名行《…》 */
      function extractBookTitle(text) {
        if (!text) return '';
        const m = text.match(/^#\s*《\s*(.+?)\s*》/m) || text.match(/^#\s+(.+)$/m);
        return m ? m[1].replace(/[《》【】]/g, '').trim() : '';
      }

      /** 判斷單一集是否完成：章數達標 + 含系列完結字樣 */
      function isVolumeComplete(content, targetChapters) {
        if (!content) return false;
        const chaptersOk = targetChapters > 0 ? countChapters(content) >= targetChapters : true;
        return chaptersOk && SERIES_COMPLETE_RE.test(content);
      }

      function saveStorySeries() {
        try {
          if (storySeries) localStorage.setItem('storySeries', JSON.stringify(storySeries));
        } catch (e) {
          console.warn('storySeries 過大，localStorage 已略過');
        }
      }

      function loadStorySeries() {
        try {
          const raw = localStorage.getItem('storySeries');
          const s = raw ? JSON.parse(raw) : null;
          if (s && !s.id) s.id = 'series_' + Date.now();
          return s;
        } catch (e) { return null; }
      }

      /** 取得目前作用中的集（無 series 時回傳 null） */
      function getActiveVolume() {
        if (!storySeries || !Array.isArray(storySeries.volumes)) return null;
        return storySeries.volumes[storySeries.activeVolumeIndex] || null;
      }

      // ==================== 字數統計功能 ====================
      function updateWordCount(text) {
        if (!text) {
          document.getElementById('wordCountDisplay').style.display = 'none';
          return;
        }
        
        // 計算中文字數（包括標點）
        const chineseChars = text.replace(/[\s\n]/g, '').length;
        
        // 計算章節數（與生成邏輯共用同一套規則）
        const chapterCount = countChapters(text);
        
        // 計算段落數
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
        
        document.getElementById('totalWordCount').textContent = chineseChars.toLocaleString();
        document.getElementById('totalChapterCount').textContent = chapterCount;
        document.getElementById('totalParagraphCount').textContent = paragraphs.length;
        document.getElementById('wordCountDisplay').style.display = 'flex';
        if (typeof updateStepper === 'function') updateStepper();
      }

      // ==================== 快速模板功能 ====================
      const templates = {
        // ═══════ 玄幻仙俠 ═══════
        fantasy: {
          name: '玄幻修仙',
          theme: '玄幻修真',
          setting: '九州大陸，靈氣復蘇，宗門林立',
          style: '熱血',
          narrative: '第三人稱限知',
          era: '玄幻大陸',
          pacing: '爽文節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 20,
          length: 100000
        },
        cultivation: {
          name: '傳統仙俠',
          theme: '仙俠修道',
          setting: '蒼穹之下，萬劍宗位於青雲山脈',
          style: '細膩',
          narrative: '第三人稱限知',
          era: '仙俠世界',
          pacing: '慢熱鋪陳',
          rating: '輕度曖昧',
          worldComplexity: '複雜',
          emotionalTone: '超脫世俗',
          ending: '昇華結局',
          chapters: 25,
          length: 120000
        },
        martial: {
          name: '武俠江湖',
          theme: '武俠江湖',
          setting: '江湖紛爭，正邪對立，恩怨情仇',
          style: '豪邁',
          narrative: '第三人稱全知',
          era: '明清時代',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '蒼涼悲壯',
          ending: '遺憾HE',
          chapters: 18,
          length: 90000
        },
        'xuanhuan-harem': {
          name: '玄幻後宮',
          theme: '玄幻後宮',
          setting: '天元大陸，美女如雲，強者為尊',
          style: '輕鬆',
          narrative: '第三人稱限知',
          era: '玄幻大陸',
          pacing: '爽文節奏',
          rating: '中度情感',
          worldComplexity: '複雜',
          emotionalTone: '爽快解壓',
          ending: '圓滿HE',
          chapters: 30,
          length: 150000
        },
        'system-novel': {
          name: '系統流',
          theme: '系統流',
          setting: '綁定逆天系統，開啟逆襲人生',
          style: '爽快',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '爽文節奏',
          rating: '15+',
          worldComplexity: '中等',
          emotionalTone: '爽快解壓',
          ending: 'HE',
          chapters: 20,
          length: 100000
        },
        reincarnation: {
          name: '重生復仇',
          theme: '重生復仇',
          setting: '重回十年前，這一世不再任人宰割',
          style: '緊張',
          narrative: '第一人稱',
          era: '現代',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '複雜糾葛',
          ending: '反殺結局',
          chapters: 15,
          length: 75000
        },
        // ═══════ 言情浪漫 ═══════
        romance: {
          name: '現代言情',
          theme: '浪漫愛情',
          setting: '繁華都市，兩個靈魂的相遇',
          style: '溫馨',
          narrative: '第一人稱',
          era: '現代',
          pacing: '慢熱鋪陳',
          rating: '純愛向',
          worldComplexity: '簡單',
          emotionalTone: '浪漫甜蜜',
          ending: '雙向奔赴HE',
          chapters: 12,
          length: 60000
        },
        'ceo-romance': {
          name: '霸總虐愛',
          theme: '都市總裁',
          setting: '頂級豪門，億萬總裁的禁忌戀情',
          style: '虐心',
          narrative: '多視角切換',
          era: '現代',
          pacing: '波浪節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '虐心糾結',
          ending: '苦盡甘來HE',
          chapters: 18,
          length: 90000
        },
        'campus-romance': {
          name: '校園純愛',
          theme: '校園戀愛',
          setting: '青春校園，最美好的年華遇見你',
          style: '清新',
          narrative: '第一人稱',
          era: '現代',
          pacing: '慢熱鋪陳',
          rating: '純愛向',
          worldComplexity: '極簡',
          emotionalTone: '青春活力',
          ending: 'HE',
          chapters: 10,
          length: 50000
        },
        'historical-romance': {
          name: '古代宮廷',
          theme: '宮廷後宮',
          setting: '深宮之中，后妃爭寵，步步為營',
          style: '華麗',
          narrative: '第三人稱限知',
          era: '清朝',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '複雜',
          emotionalTone: '複雜糾葛',
          ending: '遺憾HE',
          chapters: 25,
          length: 120000
        },
        'transmig-romance': {
          name: '穿書女主',
          theme: '穿書逆襲',
          setting: '穿進虐文，改寫炮灰命運',
          style: '輕鬆',
          narrative: '第一人稱',
          era: '架空歷史',
          pacing: '快節奏',
          rating: '輕度曖昧',
          worldComplexity: '中等',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 15,
          length: 75000
        },
        'rebirth-romance': {
          name: '重生復甜',
          theme: '重生戀愛',
          setting: '重生回到遇見他之前，這次不再錯過',
          style: '甜蜜',
          narrative: '第一人稱',
          era: '現代',
          pacing: '標準節奏',
          rating: '純愛向',
          worldComplexity: '簡單',
          emotionalTone: '浪漫甜蜜',
          ending: '圓滿HE',
          chapters: 12,
          length: 60000
        },
        'contract-marriage': {
          name: '契約婚姻',
          theme: '契約婚姻',
          setting: '一紙合約，兩顆心逐漸靠近',
          style: '輕鬆',
          narrative: '多視角切換',
          era: '現代',
          pacing: '慢熱鋪陳',
          rating: '輕度曖昧',
          worldComplexity: '簡單',
          emotionalTone: '浪漫甜蜜',
          ending: '雙向奔赴HE',
          chapters: 14,
          length: 70000
        },
        'enemies-lovers': {
          name: '歡喜冤家',
          theme: '歡喜冤家',
          setting: '冤家路窄，鬥嘴日常，愛上了怎麼辦',
          style: '搞笑',
          narrative: '多視角切換',
          era: '現代',
          pacing: '標準節奏',
          rating: '純愛向',
          worldComplexity: '極簡',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 10,
          length: 50000
        },
        // ═══════ 懸疑驚悚 ═══════
        mystery: {
          name: '懸疑推理',
          theme: '懸疑推理',
          setting: '迷霧重重，真相只有一個',
          style: '緊張',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '懸疑節奏',
          rating: '15+',
          worldComplexity: '中等',
          emotionalTone: '懸疑緊張',
          ending: '逆轉結局',
          chapters: 12,
          length: 60000
        },
        detective: {
          name: '偵探破案',
          theme: '偵探推理',
          setting: '名偵探登場，每個細節都是線索',
          style: '細膩',
          narrative: '第一人稱',
          era: '現代',
          pacing: '懸疑節奏',
          rating: '15+',
          worldComplexity: '中等',
          emotionalTone: '懸疑緊張',
          ending: '逆轉結局',
          chapters: 10,
          length: 50000
        },
        thriller: {
          name: '驚悚恐怖',
          theme: '恐怖驚悚',
          setting: '黑暗角落，恐懼如影隨形',
          style: '陰森',
          narrative: '第一人稱',
          era: '現代',
          pacing: '驚悚節奏',
          rating: '驚悚向',
          worldComplexity: '簡單',
          emotionalTone: '詭異驚悚',
          ending: 'OE',
          chapters: 10,
          length: 45000
        },
        psychological: {
          name: '心理驚悚',
          theme: '心理懸疑',
          setting: '人心最深處，藏著最可怕的秘密',
          style: '壓抑',
          narrative: '不可靠敘述者',
          era: '現代',
          pacing: '懸疑節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '神秘詭譎',
          ending: '逆轉結局',
          chapters: 12,
          length: 55000
        },
        crime: {
          name: '犯罪懸疑',
          theme: '犯罪懸疑',
          setting: '罪惡之城，追蹤獵物的遊戲開始',
          style: '黑暗',
          narrative: '多視角切換',
          era: '現代',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '複雜',
          emotionalTone: '灰色地帶',
          ending: '反派勝利',
          chapters: 15,
          length: 70000
        },
        'supernatural-mystery': {
          name: '靈異懸疑',
          theme: '靈異懸疑',
          setting: '陰陽兩界，鬼影重重，真假難辨',
          style: '詭異',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '懸疑節奏',
          rating: '驚悚向',
          worldComplexity: '中等',
          emotionalTone: '詭異驚悚',
          ending: 'OE',
          chapters: 12,
          length: 55000
        },
        // ═══════ 科幻未來 ═══════
        scifi: {
          name: '太空歌劇',
          theme: '星際冒險',
          setting: '銀河系邊緣，人類殖民地的冒險',
          style: '史詩',
          narrative: '多視角切換',
          era: '遠未來',
          pacing: '史詩節奏',
          rating: '15+',
          worldComplexity: '史詩級',
          emotionalTone: '史詩壯闘',
          ending: 'OE',
          chapters: 20,
          length: 100000
        },
        cyberpunk: {
          name: '賽博龐克',
          theme: '賽博龐克',
          setting: '霓虹夜雨，高科技低生活的暗黑都市',
          style: '黑暗',
          narrative: '第一人稱',
          era: '賽博龐克',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '複雜',
          emotionalTone: '灰色地帶',
          ending: 'OE',
          chapters: 15,
          length: 70000
        },
        apocalypse: {
          name: '末日廢土',
          theme: '末日生存',
          setting: '核戰之後，人類在廢墟中掙扎求存',
          style: '沉重',
          narrative: '第三人稱限知',
          era: '末日後',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '絕望窒息',
          ending: '遺憾HE',
          chapters: 18,
          length: 85000
        },
        'ai-story': {
          name: '人工智能',
          theme: 'AI覺醒',
          setting: '當AI產生自我意識，人類何去何從',
          style: '哲思',
          narrative: '多視角切換',
          era: '近未來',
          pacing: '標準節奏',
          rating: '正劇向',
          worldComplexity: '複雜',
          emotionalTone: '哲理深沉',
          ending: 'OE',
          chapters: 15,
          length: 75000
        },
        'virtual-reality': {
          name: '虛擬現實',
          theme: '虛擬遊戲',
          setting: '全息網遊，現實與虛擬的邊界模糊',
          style: '刺激',
          narrative: '第一人稱',
          era: '近未來',
          pacing: '快節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '驚險刺激',
          ending: 'HE',
          chapters: 20,
          length: 90000
        },
        'time-travel': {
          name: '時間旅行',
          theme: '時間穿越',
          setting: '穿梭時空，每個選擇都改變歷史',
          style: '燒腦',
          narrative: '碎片式',
          era: '時間穿越',
          pacing: '碎片節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '神秘詭譎',
          ending: '輪迴結局',
          chapters: 15,
          length: 70000
        },
        // ═══════ 西方奇幻 ═══════
        'western-fantasy': {
          name: '劍與魔法',
          theme: '西方奇幻',
          setting: '艾爾維亞大陸，勇者的冒險啟程',
          style: '冒險',
          narrative: '第三人稱限知',
          era: '西方中世紀',
          pacing: '標準節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 20,
          length: 100000
        },
        'dark-fantasy': {
          name: '黑暗奇幻',
          theme: '黑暗奇幻',
          setting: '殘酷世界，沒有絕對的善與惡',
          style: '黑暗',
          narrative: '多視角切換',
          era: '西方中世紀',
          pacing: '標準節奏',
          rating: '暗黑向',
          worldComplexity: '複雜',
          emotionalTone: '灰色地帶',
          ending: 'BE',
          chapters: 18,
          length: 90000
        },
        'dragon-knight': {
          name: '龍騎士',
          theme: '龍騎士',
          setting: '與龍締結契約，翱翔天際',
          style: '史詩',
          narrative: '第三人稱限知',
          era: '西方中世紀',
          pacing: '史詩節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '史詩壯闘',
          ending: 'HE',
          chapters: 22,
          length: 110000
        },
        'magic-academy': {
          name: '魔法學院',
          theme: '魔法學院',
          setting: '神秘的魔法學院，天才少年的成長',
          style: '輕鬆',
          narrative: '第三人稱限知',
          era: '西幻大陸',
          pacing: '標準節奏',
          rating: '輕度曖昧',
          worldComplexity: '中等',
          emotionalTone: '青春活力',
          ending: 'HE',
          chapters: 18,
          length: 85000
        },
        vampire: {
          name: '吸血鬼',
          theme: '吸血鬼傳說',
          setting: '黑夜是他們的國度，永生的詛咒',
          style: '哥特',
          narrative: '第一人稱',
          era: '維多利亞時代',
          pacing: '慢熱鋪陳',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '黑暗沉重',
          ending: 'OE',
          chapters: 15,
          length: 70000
        },
        werewolf: {
          name: '狼人傳說',
          theme: '狼人故事',
          setting: '滿月之夜，野性的呼喚無法抗拒',
          style: '野性',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '快節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '驚險刺激',
          ending: 'HE',
          chapters: 14,
          length: 65000
        },
        // ═══════ 遊戲競技 ═══════
        'game-world': {
          name: '遊戲世界',
          theme: '穿越遊戲',
          setting: '穿越到遊戲世界，用玩家思維求生',
          style: '輕鬆',
          narrative: '第一人稱',
          era: '架空歷史',
          pacing: '快節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 20,
          length: 95000
        },
        esports: {
          name: '電競熱血',
          theme: '電競競技',
          setting: '職業電競，劍指世界冠軍',
          style: '熱血',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '熱血節奏',
          rating: '輕度曖昧',
          worldComplexity: '中等',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 18,
          length: 85000
        },
        'infinite-flow': {
          name: '無限流',
          theme: '無限流',
          setting: '一個又一個副本，生存才是唯一目標',
          style: '緊張',
          narrative: '第三人稱限知',
          era: '多元宇宙',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '史詩級',
          emotionalTone: '驚險刺激',
          ending: 'OE',
          chapters: 25,
          length: 120000
        },
        'death-game': {
          name: '死亡遊戲',
          theme: '死亡遊戲',
          setting: '遊戲開始，失敗者將付出生命',
          style: '殘酷',
          narrative: '多視角切換',
          era: '現代',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '壓迫窒息',
          ending: 'BE',
          chapters: 15,
          length: 70000
        },
        'card-master': {
          name: '卡牌大師',
          theme: '卡牌對決',
          setting: '卡牌即是力量，決鬥吧！',
          style: '熱血',
          narrative: '第三人稱限知',
          era: '架空歷史',
          pacing: '熱血節奏',
          rating: '全年齡',
          worldComplexity: '中等',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 18,
          length: 85000
        },
        // ═══════ 歷史傳奇 ═══════
        historical: {
          name: '架空歷史',
          theme: '權謀爭霸',
          setting: '亂世之中，誰主沉浮',
          style: '厚重',
          narrative: '第三人稱全知',
          era: '架空歷史',
          pacing: '史詩節奏',
          rating: '正劇向',
          worldComplexity: '史詩級',
          emotionalTone: '史詩壯闘',
          ending: 'OE',
          chapters: 30,
          length: 150000
        },
        'three-kingdoms': {
          name: '三國風雲',
          theme: '三國演義',
          setting: '東漢末年，群雄並起，逐鹿中原',
          style: '史詩',
          narrative: '第三人稱全知',
          era: '三國',
          pacing: '史詩節奏',
          rating: '正劇向',
          worldComplexity: '史詩級',
          emotionalTone: '史詩壯闘',
          ending: '蒼涼悲壯',
          chapters: 35,
          length: 180000
        },
        'tang-dynasty': {
          name: '大唐盛世',
          theme: '大唐風華',
          setting: '盛唐長安，萬國來朝的繁華盛世',
          style: '華麗',
          narrative: '第三人稱限知',
          era: '隋唐時代',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '複雜',
          emotionalTone: '復古懷舊',
          ending: 'HE',
          chapters: 22,
          length: 110000
        },
        'ming-dynasty': {
          name: '明朝錦衣',
          theme: '明朝風雲',
          setting: '錦衣衛、東廠、朝堂風雲',
          style: '緊張',
          narrative: '第三人稱限知',
          era: '明朝',
          pacing: '懸疑節奏',
          rating: '暗黑向',
          worldComplexity: '複雜',
          emotionalTone: '灰色地帶',
          ending: '逆轉結局',
          chapters: 20,
          length: 100000
        },
        'warring-states': {
          name: '戰國策士',
          theme: '戰國縱橫',
          setting: '七國爭雄，縱橫捭闔，智謀天下',
          style: '智謀',
          narrative: '第三人稱全知',
          era: '先秦時代',
          pacing: '標準節奏',
          rating: '正劇向',
          worldComplexity: '複雜',
          emotionalTone: '史詩壯闘',
          ending: 'OE',
          chapters: 25,
          length: 120000
        },
        'republic-era': {
          name: '民國風雲',
          theme: '民國傳奇',
          setting: '上海灘，亂世浮沉，兒女情長',
          style: '懷舊',
          narrative: '第三人稱限知',
          era: '民國時代',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '復古懷舊',
          ending: '遺憾HE',
          chapters: 18,
          length: 90000
        },
        // ═══════ 特殊題材 ═══════
        'slice-of-life': {
          name: '日常治癒',
          theme: '日常治癒',
          setting: '平凡生活中的小確幸',
          style: '溫馨',
          narrative: '第一人稱',
          era: '現代',
          pacing: '日常節奏',
          rating: '治癒向',
          worldComplexity: '極簡',
          emotionalTone: '慢生活',
          ending: 'HE',
          chapters: 10,
          length: 45000
        },
        farming: {
          name: '種田經營',
          theme: '種田生活',
          setting: '遠離塵囂，打造屬於自己的田園',
          style: '悠閒',
          narrative: '第一人稱',
          era: '架空歷史',
          pacing: '日常節奏',
          rating: '治癒向',
          worldComplexity: '簡單',
          emotionalTone: '慢生活',
          ending: 'HE',
          chapters: 15,
          length: 70000
        },
        cooking: {
          name: '美食江湖',
          theme: '美食傳奇',
          setting: '以廚藝為劍，征服天下味蕾',
          style: '輕鬆',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '標準節奏',
          rating: '治癒向',
          worldComplexity: '簡單',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 15,
          length: 70000
        },
        showbiz: {
          name: '娛樂圈',
          theme: '娛樂圈',
          setting: '星光璀璨背後的明爭暗鬥',
          style: '華麗',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '快節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '複雜糾葛',
          ending: 'HE',
          chapters: 18,
          length: 85000
        },
        sports: {
          name: '熱血運動',
          theme: '體育競技',
          setting: '汗水與淚水，追逐冠軍的夢',
          style: '熱血',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '熱血節奏',
          rating: '全年齡',
          worldComplexity: '簡單',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 18,
          length: 80000
        },
        military: {
          name: '軍旅榮光',
          theme: '軍事題材',
          setting: '鐵血軍魂，保家衛國',
          style: '硬派',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '標準節奏',
          rating: '正劇向',
          worldComplexity: '中等',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 20,
          length: 95000
        },
        medical: {
          name: '醫療懸壺',
          theme: '醫療題材',
          setting: '白衣天使，生死之間的抉擇',
          style: '專業',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '標準節奏',
          rating: '正劇向',
          worldComplexity: '中等',
          emotionalTone: '溫馨治癒',
          ending: 'HE',
          chapters: 18,
          length: 85000
        },
        legal: {
          name: '法律正義',
          theme: '法律題材',
          setting: '法庭之上，正義終將到來',
          style: '緊湊',
          narrative: '第三人稱限知',
          era: '現代',
          pacing: '懸疑節奏',
          rating: '正劇向',
          worldComplexity: '中等',
          emotionalTone: '懸疑緊張',
          ending: '逆轉結局',
          chapters: 15,
          length: 70000
        },
        // ═══════ 反派視角 ═══════
        'villain-mc': {
          name: '反派主角',
          theme: '反派視角',
          setting: '誰說反派不能贏？這次我要改寫結局',
          style: '黑暗',
          narrative: '第一人稱',
          era: '架空歷史',
          pacing: '快節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '灰色地帶',
          ending: '反派勝利',
          chapters: 18,
          length: 85000
        },
        'demon-lord': {
          name: '魔王崛起',
          theme: '魔王故事',
          setting: '我是魔王，統御黑暗，毀滅光明',
          style: '霸氣',
          narrative: '第三人稱限知',
          era: '西幻大陸',
          pacing: '爽文節奏',
          rating: '暗黑向',
          worldComplexity: '複雜',
          emotionalTone: '黑暗沉重',
          ending: 'OE',
          chapters: 22,
          length: 110000
        },
        'villain-redemption': {
          name: '反派救贖',
          theme: '反派洗白',
          setting: '曾經的惡人，能否獲得救贖',
          style: '糾結',
          narrative: '第三人稱限知',
          era: '架空歷史',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '中等',
          emotionalTone: '複雜糾葛',
          ending: '遺憾HE',
          chapters: 16,
          length: 75000
        },
        misunderstood: {
          name: '被誤解的惡人',
          theme: '真相反轉',
          setting: '所有人都認為他是惡人，直到真相揭曉',
          style: '虐心',
          narrative: '多視角切換',
          era: '架空歷史',
          pacing: '懸疑節奏',
          rating: '虐心向',
          worldComplexity: '中等',
          emotionalTone: '虐心糾結',
          ending: '逆轉結局',
          chapters: 15,
          length: 70000
        },
        // ═══════ 年代懷舊 ═══════
        'nostalgia-era': {
          name: '年代生活',
          theme: '年代生活',
          setting: '物資匱乏的年代，憑雙手把日子過成詩',
          style: '溫馨治癒',
          narrative: '第一人稱',
          era: '八零九零年代',
          pacing: '慢綜治癒',
          rating: '全年齡',
          worldComplexity: '簡單',
          emotionalTone: '復古懷舊',
          ending: '圓滿HE',
          chapters: 18,
          length: 85000
        },
        'old-shanghai': {
          name: '老上海往事',
          theme: '老上海往事',
          setting: '十里洋場，旗袍與槍聲交織的亂世',
          style: '華麗繁複',
          narrative: '多視角切換',
          era: '民國時代',
          pacing: '標準節奏',
          rating: '中度情感',
          worldComplexity: '複雜',
          emotionalTone: '蒼涼悲壯',
          ending: '遺憾HE',
          chapters: 22,
          length: 110000
        },
        // ═══════ 諜戰特工 ═══════
        'spy-war': {
          name: '諜戰風雲',
          theme: '諜戰風雲',
          setting: '潛伏敵營，每一句話都是生死博弈',
          style: '緊湊',
          narrative: '雙線敘事',
          era: '抗戰時期',
          pacing: '懸疑節奏',
          rating: '正劇向',
          worldComplexity: '複雜',
          emotionalTone: '懸疑緊張',
          ending: '壯烈犧牲BE',
          chapters: 20,
          length: 100000
        },
        'cold-war-spy': {
          name: '冷戰諜影',
          theme: '冷戰諜影',
          setting: '鐵幕兩端，雙面間諜的危險遊戲',
          style: '黑色電影風',
          narrative: '第一人稱',
          era: '冷戰時期',
          pacing: '快節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '神秘詭譎',
          ending: 'OE',
          chapters: 16,
          length: 78000
        },
        // ═══════ 機甲星際 ═══════
        'mecha-pilot': {
          name: '機甲駕駛員',
          theme: '機甲格鬥',
          setting: '駕駛鋼鐵巨獸，守護人類最後的防線',
          style: '熱血燃情',
          narrative: '第三人稱限知',
          era: '遠未來',
          pacing: '熱血節奏',
          rating: '15+',
          worldComplexity: '史詩級',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 22,
          length: 105000
        },
        'star-pioneer': {
          name: '銀河開拓者',
          theme: '銀河開拓',
          setting: '駕駛星艦駛向未知星域，開拓人類新疆界',
          style: '群像史詩',
          narrative: '多視角切換',
          era: '星際大航海',
          pacing: '史詩節奏',
          rating: '15+',
          worldComplexity: '宇宙級',
          emotionalTone: '史詩壯闘',
          ending: 'OE',
          chapters: 24,
          length: 120000
        },
        // ═══════ 末世求生 ═══════
        'zombie-survival': {
          name: '喪屍末日',
          theme: '喪屍危機',
          setting: '末日降臨，在屍潮中尋找一線生機',
          style: '廢土荒涼',
          narrative: '第三人稱限知',
          era: '喪屍末日',
          pacing: '驚悚節奏',
          rating: '暗黑向',
          worldComplexity: '中等',
          emotionalTone: '壓迫窒息',
          ending: '遺憾HE',
          chapters: 20,
          length: 95000
        },
        'wasteland-farming': {
          name: '廢土種田',
          theme: '末世種田',
          setting: '在輻射廢土上建起綠洲，重建文明',
          style: '種田慢綜',
          narrative: '第一人稱',
          era: '末日後',
          pacing: '養成漸進',
          rating: '15+',
          worldComplexity: '中等',
          emotionalTone: '希望光明',
          ending: 'HE',
          chapters: 22,
          length: 100000
        },
        // ═══════ 種田經營 ═══════
        'farming-life': {
          name: '悠閒種田',
          theme: '空間種田',
          setting: '隨身空間在手，鄉間悠閒度日，發家致富',
          style: '溫馨治癒',
          narrative: '第一人稱',
          era: '現代',
          pacing: '慢綜治癒',
          rating: '全年齡',
          worldComplexity: '簡單',
          emotionalTone: '慢生活',
          ending: '圓滿HE',
          chapters: 18,
          length: 85000
        },
        'shop-management': {
          name: '餐廳經營',
          theme: '餐廳經營',
          setting: '一間小店，一道道料理，溫暖每位客人',
          style: '日常流水帳治癒',
          narrative: '第一人稱',
          era: '現代',
          pacing: '單元劇節奏',
          rating: '全年齡',
          worldComplexity: '極簡',
          emotionalTone: '溫馨治癒',
          ending: 'HE',
          chapters: 15,
          length: 70000
        },
        // ═══════ 異世界轉生 ═══════
        'isekai-reborn': {
          name: '異世界轉生',
          theme: '異世界轉生',
          setting: '魂穿異世界，帶著前世記憶重新開始',
          style: '輕小說風',
          narrative: '第一人稱',
          era: '西幻大陸',
          pacing: '標準節奏',
          rating: '15+',
          worldComplexity: '複雜',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 20,
          length: 95000
        },
        'slime-reborn': {
          name: '轉生史萊姆',
          theme: '轉生史萊姆',
          setting: '轉生成最弱魔物，卻一步步建立魔物樂園',
          style: '宅向吐槽',
          narrative: '第一人稱',
          era: '西幻大陸',
          pacing: '養成漸進',
          rating: '輕度曖昧',
          worldComplexity: '複雜',
          emotionalTone: '歡樂輕鬆',
          ending: 'HE',
          chapters: 22,
          length: 100000
        },
        // ═══════ 規則詭異 ═══════
        'rule-horror': {
          name: '規則怪談',
          theme: '規則怪談',
          setting: '只要遵守詭異的規則，就能在怪談中活下去',
          style: '規則驚悚',
          narrative: '第一人稱',
          era: '現代',
          pacing: '懸念鉤子連發',
          rating: '驚悚向',
          worldComplexity: '規則驅動',
          emotionalTone: '詭異驚悚',
          ending: '逆轉結局',
          chapters: 16,
          length: 78000
        },
        'cthulhu-mythos': {
          name: '克蘇魯神話',
          theme: '克蘇魯神話',
          setting: '當人類窺見宇宙的真相，理智便開始崩塌',
          style: '克系冷硬',
          narrative: '不可靠敘述者',
          era: '克蘇魯',
          pacing: '慢熱鋪陳',
          rating: '暗黑向',
          worldComplexity: '克系不可知',
          emotionalTone: '絕望窒息',
          ending: 'BE',
          chapters: 14,
          length: 68000
        },
        // ═══════ 海賊冒險 ═══════
        'pirate-adventure': {
          name: '大海賊時代',
          theme: '大海賊時代',
          setting: '揚帆遠航，在無垠大海上追尋傳說寶藏',
          style: '群像史詩',
          narrative: '第三人稱限知',
          era: '大航海時代',
          pacing: '史詩節奏',
          rating: '15+',
          worldComplexity: '史詩級',
          emotionalTone: '熱血燃向',
          ending: 'HE',
          chapters: 24,
          length: 115000
        }
      };

      // 模板選擇器事件
      const quickTemplateSelect = document.getElementById('quickTemplateSelect');
      const applyTemplateBtn = document.getElementById('applyTemplateBtn');

      applyTemplateBtn.addEventListener('click', () => {
        const templateName = quickTemplateSelect.value;
        if (!templateName) {
          showStatus('warning', '請先選擇一個模板');
          setTimeout(hideStatus, 2000);
          return;
        }

        const template = templates[templateName];
        if (!template) return;

        // 套用模板設定（用 setSelectValue 確保不在清單中的值也能套入）
        setSelectValue(themeSelect, template.theme);
        setSelectValue(settingSelect, template.setting);
        setSelectValue(styleSelect, template.style);
        setSelectValue(narrativeSelect, template.narrative);
        setSelectValue(eraSelect, template.era);
        setSelectValue(pacingSelect, template.pacing);
        setSelectValue(ratingSelect, template.rating);
        setSelectValue(worldComplexitySelect, template.worldComplexity);
        setSelectValue(emotionalToneSelect, template.emotionalTone);
        setSelectValue(endingSelect, template.ending);
        chaptersInput.value = template.chapters;
        lengthInput.value = template.length;

        // 隨機生成人物
        randomizeAllCharacters();
        
        // 儲存設定
        saveSettingsToLocal();
        
        // 關閉設定面板
        settingsDropdown.classList.remove('open');
        syncSettingsToolbarState();
        
        // 重置選擇器
        quickTemplateSelect.value = '';
        
        showStatus('success', `已套用「${template.name}」模板！`);
        setTimeout(hideStatus, 2000);
      });

      // 雙擊快速套用
      quickTemplateSelect.addEventListener('dblclick', () => {
        if (quickTemplateSelect.value) {
          applyTemplateBtn.click();
        }
      });

      // 清除當前模組：重置所有設定（保留已生成的小說正文）
      const clearTemplateBtn = document.getElementById('clearTemplateBtn');
      if (clearTemplateBtn) {
        clearTemplateBtn.addEventListener('click', () => {
          const volEl = document.getElementById('volumes');
          const fields = [
            themeSelect, settingSelect, styleSelect,
            narrativeSelect, eraSelect, pacingSelect, ratingSelect,
            worldComplexitySelect, emotionalToneSelect, endingSelect,
            chaptersInput, lengthInput, notesInput
          ];
          const hasFieldData = fields.some(el => el && el.value)
            || (volEl && String(volEl.value).trim() !== '' && String(volEl.value).trim() !== '1');
          const hasCharData = Array.from(charactersContainer.querySelectorAll('.character-row')).some(r =>
            Array.from(r.querySelectorAll('input, select')).some(el => el.value && el.value.trim() && el.value !== '不明')
          );
          const hasOutline = !!(currentOutline || currentBookTitle);
          const hasSpecial = specialElementsContainer
            && specialElementsContainer.querySelectorAll('.special-element-item.selected').length > 0;
          const hasSeries = !!(storySeries && storySeries.totalVolumes > 1);
          if (!hasFieldData && !hasCharData && !hasOutline && !hasSpecial && !hasSeries) {
            showStatus('info', '目前沒有可清除的模組設定');
            setTimeout(hideStatus, 2000);
            return;
          }
          if (!confirm('確定要清除目前的模組設定嗎？\n\n將重置主題、背景、風格、進階、篇幅、自訂規則、大綱預覽與特殊元素，並把人物清空為一位空白人物。\n\n人名清單不受影響（請至「📋 人名清單」手動刪除）。已生成的小說正文會保留。')) return;
          fields.forEach(el => { if (el) el.value = ''; });
          if (volEl) volEl.value = '1';
          quickTemplateSelect.value = '';
          if (specialElementsContainer) {
            specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
              item.classList.remove('selected');
              const cb = item.querySelector('input[type="checkbox"]');
              if (cb) cb.checked = false;
            });
          }
          resetOutlineState();
          storySeries = null;
          seriesAborted = false;
          try { localStorage.removeItem('storySeries'); } catch (e) {}
          if (typeof renderSeriesBar === 'function') renderSeriesBar();
          charactersContainer.innerHTML = '';
          addCharacterRow(false);
          renderCharacterTabs();
          setActiveCharacter(0);
          saveSettingsToLocal();
          if (typeof updateStepper === 'function') updateStepper();
          showStatus('success', '已清除模組設定與大綱預覽（小說正文已保留）');
          setTimeout(hideStatus, 2000);
        });
      }


      // ==================== 生成進度追蹤 ====================
      let generationStartTime = null;
      let lastProgressUpdate = null;

      let progressInterval = null;
      let progressHideTimer = null;
      let estimatedTotalChapters = 1;
      let simulatedProgress = 0;

      function showGenerationProgress() {
        // 取消上一章排定的「延遲隱藏」，避免續章進度條被前一章的計時器藏掉
        if (progressHideTimer) {
          clearTimeout(progressHideTimer);
          progressHideTimer = null;
        }
        document.getElementById('generationProgress').classList.add('show');
        document.body.classList.add('is-generating');
        generationStartTime = Date.now();
        lastProgressUpdate = Date.now();
        simulatedProgress = 0;
        
        // 重置進度條
        document.getElementById('progressBarFill').style.width = '0%';
        document.getElementById('progressPercent').textContent = '0%';
        document.getElementById('progressWords').textContent = '已生成 0 字';
        document.getElementById('progressTime').textContent = '預估剩餘 --:--';
      }

      function hideGenerationProgress() {
        if (progressHideTimer) {
          clearTimeout(progressHideTimer);
          progressHideTimer = null;
        }
        document.getElementById('generationProgress').classList.remove('show');
        document.body.classList.remove('is-generating');
        releaseVerticalPageLock();
        generationStartTime = null;
        simulatedProgress = 0;
        
        // 清除進度更新定時器
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      }

      // 延遲隱藏進度條（可被下一章的 showGenerationProgress 取消）
      function scheduleHideProgress(delay = 1000) {
        if (progressHideTimer) clearTimeout(progressHideTimer);
        progressHideTimer = setTimeout(() => {
          progressHideTimer = null;
          hideGenerationProgress();
        }, delay);
      }

      function startSimulatedProgress(totalChapters = 1) {
        estimatedTotalChapters = totalChapters;
        simulatedProgress = 0;
        
        // 清除舊的定時器
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        
        // 開始模擬進度更新
        progressInterval = setInterval(() => {
          if (!generationStartTime) return;
          
          const elapsed = Date.now() - generationStartTime;
          const elapsedSeconds = elapsed / 1000;
          
          // 基於時間的進度估算
          // 前30秒：快速增長到30%（連接和準備階段）
          // 30-120秒：緩慢增長到85%（實際生成階段）
          // 120秒後：緩慢增長到95%（等待完成）
          
          if (elapsedSeconds < 30) {
            // 前30秒：快速增長
            simulatedProgress = Math.min(30, (elapsedSeconds / 30) * 30);
          } else if (elapsedSeconds < 120) {
            // 30-120秒：緩慢增長
            simulatedProgress = 30 + ((elapsedSeconds - 30) / 90) * 55;
          } else {
            // 120秒後：非常緩慢增長，最高到95%
            simulatedProgress = Math.min(95, 85 + ((elapsedSeconds - 120) / 60) * 10);
          }
          
          // 更新進度條顯示
          const progressBarFill = document.getElementById('progressBarFill');
          const progressPercent = document.getElementById('progressPercent');
          const progressTime = document.getElementById('progressTime');
          
          progressBarFill.style.width = `${simulatedProgress}%`;
          progressPercent.textContent = `${Math.round(simulatedProgress)}%`;
          
          // 估算剩餘時間（基於平均生成速度）
          // 假設每章需要約30-60秒
          const avgTimePerChapter = 45; // 秒
          const estimatedTotalTime = avgTimePerChapter * totalChapters;
          const remainingSeconds = Math.max(0, estimatedTotalTime - elapsedSeconds);
          
          if (remainingSeconds > 0) {
            const remainingMins = Math.floor(remainingSeconds / 60);
            const remainingSecs = Math.floor(remainingSeconds % 60);
            progressTime.textContent = `預估剩餘 ${remainingMins}:${remainingSecs.toString().padStart(2, '0')}`;
          } else {
            progressTime.textContent = '即將完成...';
          }
        }, 500); // 每0.5秒更新一次
      }

      function updateGenerationProgress(currentChapter, totalChapters, currentWords) {
        // 清除模擬進度
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
        
        const progressPercent = Math.round((currentChapter / totalChapters) * 100);
        document.getElementById('progressChapter').textContent = `正在生成第 ${currentChapter}/${totalChapters} 章`;
        document.getElementById('progressPercent').textContent = `${progressPercent}%`;
        document.getElementById('progressBarFill').style.width = `${progressPercent}%`;
        document.getElementById('progressWords').textContent = `已生成 ${currentWords.toLocaleString()} 字`;
        
        // 預估剩餘時間
        if (generationStartTime && currentChapter > 0) {
          const elapsed = Date.now() - generationStartTime;
          const avgTimePerChapter = elapsed / currentChapter;
          const remainingChapters = totalChapters - currentChapter;
          const remainingMs = avgTimePerChapter * remainingChapters;
          
          const remainingMins = Math.floor(remainingMs / 60000);
          const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
          document.getElementById('progressTime').textContent = 
            `預估剩餘 ${remainingMins}:${remainingSecs.toString().padStart(2, '0')}`;
        }
      }

      // ==================== 系統偏好深色模式檢測 ====================
      if (window.matchMedia && !localStorage.getItem('theme')) {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          setTheme('dark');
        }
      }

      // 監聽系統主題變化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
          setTheme(e.matches ? 'dark' : 'light');
        }
      });

      // ==================== 故事大綱預覽功能 ====================
      const outlineBtn = document.getElementById('outlineBtn');
      const outlineModal = document.getElementById('outlineModal');
      const closeOutlineModal = document.getElementById('closeOutlineModal');
      const generateOutlineBtn = document.getElementById('generateOutlineBtn');
      const generateFromOutlineBtn = document.getElementById('generateFromOutlineBtn');
      const regenerateOutlineBtn = document.getElementById('regenerateOutlineBtn');
      const outlineLoading = document.getElementById('outlineLoading');
      const outlineContent = document.getElementById('outlineContent');
      const outlineTitleBox = document.getElementById('outlineTitleBox');
      const outlineTitleText = document.getElementById('outlineTitleText');
      const retitleBtn = document.getElementById('retitleBtn');
      
      const outlineAttachPanel = document.getElementById('outlineAttachPanel');
      const outlineAttachPreview = document.getElementById('outlineAttachPreview');
      const outlineAttachTitle = document.getElementById('outlineAttachTitle');
      const outlineAttachOpenBtn = document.getElementById('outlineAttachOpenBtn');
      const outlineAttachClearBtn = document.getElementById('outlineAttachClearBtn');

      function getOutlineGenerationBlock() {
        const parts = [];
        const totalVol = getOutlineVolumeTotal();
        const volIdx = (storySeries && storySeries.totalVolumes > 1)
          ? storySeries.activeVolumeIndex
          : 0;
        const outlineBody = getOutlineForVolumeIndex(volIdx, totalVol) || currentOutline;
        if (currentBookTitle) {
          parts.push(`【本書書名】\n《${currentBookTitle}》\n請在全文最開頭，獨立一行輸出「# 《${currentBookTitle}》」作為書名，空一行後再開始第1章；後續章節沿用此書名，不要重複輸出書名行。`);
        }
        if (outlineBody) {
          const volLabel = totalVol > 1 ? getVolumeLabel(volIdx, totalVol) : '';
          const header = totalVol > 1
            ? `【${volLabel}故事大綱（請嚴格按照此大綱展開本集）】`
            : `【已生成的故事大綱，請嚴格按照此大綱展開故事】`;
          parts.push(`${header}\n${outlineBody}`);
          if (totalVol > 1) {
            parts.push(`【系列大綱約束】全系列共 ${totalVol} 集；本次只寫${volLabel}，須承接前集結尾（若有），禁止重寫已寫過的開場情節`);
          }
        }
        return parts.length ? parts.join('\n\n') + '\n\n' : '';
      }

      function updateOutlineAttachPanel() {
        if (!outlineAttachPanel) return;
        const hasOutline = !!(currentOutline && String(currentOutline).trim());
        if (outlineAttachClearBtn) outlineAttachClearBtn.disabled = !hasOutline;
        if (outlineAttachOpenBtn) outlineAttachOpenBtn.disabled = !hasOutline;
        if (!hasOutline) {
          if (outlineAttachPreview) {
            outlineAttachPreview.innerHTML = '<p class="outline-attach-empty">尚未生成大綱。請點右側工具列「預覽大綱」，或創作進度列的「大綱」步驟。「預計集數」請在「故事元素」中設定；若為 2 集以上，將依集數分別生成各集大綱，結果顯示於此（不會寫入自訂規則）。</p>';
          }
          if (outlineAttachTitle) outlineAttachTitle.textContent = '';
          return;
        }
        if (outlineAttachTitle) {
          outlineAttachTitle.textContent = currentBookTitle ? `《${currentBookTitle}》` : '';
        }
        displayOutline(currentOutline, outlineAttachPreview);
      }

      function restoreOutlineUiFromState() {
        updateOutlineAttachPanel();
        if (!currentOutline) return;
        displayOutline(currentOutline);
        showOutlineTitle(currentBookTitle);
        if (outlineContent) outlineContent.style.display = 'block';
        if (generateFromOutlineBtn) generateFromOutlineBtn.style.display = 'flex';
        if (regenerateOutlineBtn) regenerateOutlineBtn.style.display = 'flex';
        if (generateOutlineBtn) generateOutlineBtn.style.display = 'none';
      }

      // 清理 AI 回傳的書名：去除引號、書名號、說明字樣、標點，限制長度
      function cleanBookTitle(raw) {
        let t = (raw || '').replace(/\uFFFD/g, '').trim();
        // 只取第一行非空內容
        t = (t.split('\n').map(s => s.trim()).find(Boolean)) || '';
        t = t
          .replace(/^(書名|片名|標題|title)\s*[:：]\s*/i, '')
          .replace(/^[《【「『\[\("'`]+/, '')
          .replace(/[》】」』\]\)"'`]+$/, '')
          .replace(/[。！？!?．.]+$/, '')
          .trim();
        return t.slice(0, 20);
      }

      // 依大綱與設定，請 AI 取一個貼合內容的書名
      async function generateBookTitle(signal) {
        if (!currentOutline) return '';
        const model = modelSelect.value;
        const theme = (themeSelect.value || '').trim();
        const setting = (settingSelect.value || '').trim();
        const era = (eraSelect.value || '').trim();
        const style = (styleSelect.value || '').trim();
        const emotionalTone = (emotionalToneSelect.value || '').trim();
        const settingLines = [
          theme ? `主題：${theme}` : '',
          setting ? `背景：${setting}` : '',
          era ? `時代：${era}` : '',
          style ? `風格：${style}` : '',
          emotionalTone ? `基調：${emotionalTone}` : ''
        ].filter(Boolean).join('\n');

        const titlePrompt = `你是專業的小說命名編輯。請根據下方「故事設定與大綱」，為這部繁體中文小說取一個吸引人、貼合內容的書名。

【嚴格要求】
1. 只輸出書名本身，不要任何解釋、引號、書名號、標點符號或多餘文字
2. 長度 4～12 個字，必須具體呼應故事內容與氛圍，避免空泛、避免英文與簡體字
3. 不要出現「書名」「以下」「這是」等字樣

${settingLines ? `【故事設定】\n${settingLines}\n\n` : ''}【故事大綱】
${currentOutline.slice(0, 1600)}

請直接輸出書名：`;

        const raw = await callDeepSeek(titlePrompt, null, model, { signal, retries: 1 });
        return cleanBookTitle(raw);
      }

      function showOutlineTitle(title) {
        if (!outlineTitleBox) return;
        if (title) {
          outlineTitleText.textContent = title;
          outlineTitleBox.style.display = 'flex';
        } else {
          outlineTitleText.textContent = '';
          outlineTitleBox.style.display = 'none';
        }
      }

      function resetOutlineState() {
        currentOutline = null;
        currentBookTitle = '';
        showOutlineTitle('');
        updateOutlineAttachPanel();
        if (outlineLoading) outlineLoading.style.display = 'none';
        if (outlineContent) {
          outlineContent.innerHTML = '';
          outlineContent.textContent = '';
          outlineContent.style.display = 'none';
        }
        if (generateOutlineBtn) generateOutlineBtn.style.display = 'flex';
        if (generateFromOutlineBtn) generateFromOutlineBtn.style.display = 'none';
        if (regenerateOutlineBtn) regenerateOutlineBtn.style.display = 'none';
      }

      if (outlineAttachOpenBtn && outlineModal) {
        outlineAttachOpenBtn.addEventListener('click', () => {
          outlineModal.classList.add('open');
        });
      }
      if (outlineAttachClearBtn) {
        outlineAttachClearBtn.addEventListener('click', () => {
          resetOutlineState();
          saveSettingsToLocal();
          if (typeof updateStepper === 'function') updateStepper();
          showStatus('info', '已清除大綱');
        });
      }

      // 「換一個」：重新取名
      if (retitleBtn) {
        retitleBtn.addEventListener('click', async () => {
          if (!currentOutline) { showStatus('error', '請先生成大綱'); return; }
          retitleBtn.disabled = true;
          const signal = beginGeneration();
          try {
            showStatus('loading', '正在重新命名...');
            const title = await generateBookTitle(signal);
            if (title) {
              currentBookTitle = title;
              showOutlineTitle(title);
              updateOutlineAttachPanel();
              saveSettingsToLocal();
              showStatus('success', `已擬定新書名《${title}》`);
            } else {
              showStatus('warning', '未能取得書名，請再試一次');
            }
          } catch (err) {
            if (err.name === 'AbortError' || userAborted) {
              showStatus('info', '⏹ 已停止');
            } else {
              showStatus('error', '取書名失敗：' + err.message);
            }
          } finally {
            endGeneration();
            retitleBtn.disabled = false;
          }
        });
      }

      // 打開大綱模態視窗
      outlineBtn.addEventListener('click', () => {
        outlineModal.classList.add('open');
        // 重置狀態
        if (!currentOutline) {
          generateOutlineBtn.style.display = 'flex';
          generateFromOutlineBtn.style.display = 'none';
          regenerateOutlineBtn.style.display = 'none';
          outlineContent.style.display = 'none';
        }
      });

      closeOutlineModal.addEventListener('click', () => {
        outlineModal.classList.remove('open');
      });

      outlineModal.addEventListener('click', (e) => {
        if (e.target === outlineModal) {
          outlineModal.classList.remove('open');
        }
      });

      // 生成大綱
      generateOutlineBtn.addEventListener('click', generateOutline);
      regenerateOutlineBtn.addEventListener('click', generateOutline);

      async function generateOutline() {
        const model = modelSelect.value;

        const theme = themeSelect.value.trim();
        const setting = settingSelect.value.trim();
        const style = styleSelect.value.trim();
        const chapterCount = Math.max(1, parseInt(chaptersInput.value.trim(), 10) || 10);
        const chapters = String(chapterCount);
        const narrative = narrativeSelect.value.trim();
        const era = eraSelect.value.trim();
        const pacing = pacingSelect.value.trim();
        const emotionalTone = emotionalToneSelect.value.trim();
        const rating = ratingSelect.value.trim();
        const worldComplexity = worldComplexitySelect.value.trim();
        const ending = endingSelect.value.trim();
        const totalVolumes = getPlannedVolumes();

        const outlineEndingKind = getEndingKind(ending);
        let outlineEndingNote = '';
        if (ending && outlineEndingKind !== 'closed') {
          const spec = ENDING_CODA_SPEC[ending] || '主線收束後補一段後日談';
          outlineEndingNote = `\n\n【結局結構（重要）】\n本作結局傾向為「${ending}」，最後一章需採「兩段式」：先完整收束本書主線（核心衝突有結果、開頭主問題有答案），再另起一段作為「② 後段」——${spec}\n請在「各章節大綱」最後一章明確標出這兩段內容。`;
        }

        const characterRows = Array.from(charactersContainer.querySelectorAll('.character-row'));
        let charactersInfo = '';
        characterRows.forEach((row) => {
          const name = row.querySelector('.char-name').value.trim();
          const personality = row.querySelector('.char-personality').value.trim();
          const goal = row.querySelector('.char-goal').value.trim();
          if (name) {
            charactersInfo += `• ${name}`;
            if (personality) charactersInfo += `（${personality}）`;
            if (goal) charactersInfo += `：${goal}`;
            charactersInfo += '\n';
          }
        });

        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          selectedElements.push(item.querySelector('.element-label').textContent);
        });

        outlineLoading.style.display = 'flex';
        outlineContent.style.display = 'none';
        generateOutlineBtn.style.display = 'none';
        generateFromOutlineBtn.style.display = 'none';
        regenerateOutlineBtn.style.display = 'none';

        const signal = beginGeneration();
        try {
          outlineContent.style.display = 'block';
          outlineContent.textContent = '';

          const outlineParts = [];

          const runOneOutline = async (prompt, labelForStream) => {
            return (await callDeepSeek(prompt, null, model, {
              signal,
              onChunk: (full) => {
                const prefix = outlineParts.length
                  ? outlineParts.join('\n\n') + '\n\n' + OUTLINE_VOL_MARKER(labelForStream) + '\n\n'
                  : (totalVolumes >= 2 ? OUTLINE_VOL_MARKER(labelForStream) + '\n\n' : '');
                const combined = prefix + full;
                const stick = outlineContent.scrollTop + outlineContent.clientHeight
                  >= outlineContent.scrollHeight - 24;
                outlineContent.textContent = combined;
                if (stick) outlineContent.scrollTop = outlineContent.scrollHeight;
              }
            })).trim();
          };

          if (totalVolumes >= 2) {
            for (let vi = 0; vi < totalVolumes; vi++) {
              const volumeLabel = getVolumeLabel(vi, totalVolumes);
              const isFinalVolume = vi >= totalVolumes - 1;
              showStatus('loading', `正在生成${volumeLabel}大綱（${vi + 1}/${totalVolumes}）…`);
              const prompt = buildVolumeOutlinePrompt({
                volumeIndex: vi,
                totalVolumes,
                volumeLabel,
                isFinalVolume,
                chapterCount,
                chapters,
                theme, setting, era, style, narrative, pacing, emotionalTone,
                worldComplexity, rating, ending,
                charactersInfo,
                selectedElements,
                outlineEndingNote: isFinalVolume ? outlineEndingNote : '',
                prevVolumeOutline: vi > 0 ? outlineParts[vi - 1] : ''
              });
              const volOutline = await runOneOutline(prompt, volumeLabel);
              if (!volOutline) throw new Error(`${volumeLabel}大綱生成失敗`);
              outlineParts.push(OUTLINE_VOL_MARKER(volumeLabel) + '\n\n' + volOutline);
              currentOutline = outlineParts.join('\n\n');
              displayOutline(currentOutline);
              updateOutlineAttachPanel();
            }
          } else {
            const prompt = buildVolumeOutlinePrompt({
              volumeIndex: 0,
              totalVolumes: 1,
              volumeLabel: '',
              isFinalVolume: true,
              chapterCount,
              chapters,
              theme, setting, era, style, narrative, pacing, emotionalTone,
              worldComplexity, rating, ending,
              charactersInfo,
              selectedElements,
              outlineEndingNote,
              prevVolumeOutline: ''
            });
            const outlineText = await runOneOutline(prompt, '');
            if (!outlineText) throw new Error('沒有獲得內容');
            currentOutline = outlineText;
          }

          if (currentOutline) {
            currentBookTitle = '';
            showOutlineTitle('');
            if (typeof updateStepper === 'function') updateStepper();
            displayOutline(currentOutline);
            updateOutlineAttachPanel();
            saveSettingsToLocal();
            outlineLoading.style.display = 'none';
            outlineContent.style.display = 'block';
            generateFromOutlineBtn.style.display = 'flex';
            regenerateOutlineBtn.style.display = 'flex';
            const volHint = totalVolumes >= 2 ? `（共 ${totalVolumes} 集）` : '';
            showStatus('success', `大綱生成完成${volHint}`);
          } else {
            throw new Error('沒有獲得內容');
          }
        } catch (err) {
          outlineLoading.style.display = 'none';
          generateOutlineBtn.style.display = 'flex';
          if (err.name === 'AbortError' || userAborted) {
            showStatus('info', '⏹ 已停止生成大綱');
          } else {
            showStatus('error', '大綱生成失敗：' + err.message);
          }
        } finally {
          endGeneration();
        }
      }

      // 格式化顯示大綱
      function renderOutlineSectionsHtml(outlineText) {
        let html = '';
        const sections = outlineText.split(/【(.+?)】/g).filter(s => s.trim());
        for (let i = 0; i < sections.length; i += 2) {
          const title = sections[i];
          const content = sections[i + 1] || '';
          if (title === '系列總覽' || title === '故事概述' || title === '核心衝突' || title === '角色弧線' || title === '核心衝突設計' || title === '本集結局') {
            html += `<div style="margin-bottom: 16px;">
              <h4 style="color: var(--accent); margin-bottom: 8px;">📌 ${title}</h4>
              <p style="color: var(--text); line-height: 1.6;">${content.trim().replace(/\n/g, '<br>')}</p>
            </div>`;
          } else if (title === '各章節大綱') {
            html += `<div style="margin-bottom: 16px;">
              <h4 style="color: var(--accent); margin-bottom: 12px;">📖 ${title}</h4>`;
            const chapters = content.split(/第(\d+)章[：:]?\s*/).filter(s => s.trim());
            for (let j = 0; j < chapters.length; j += 2) {
              const chapterNum = chapters[j];
              const chapterContent = chapters[j + 1] || '';
              if (chapterNum && chapterContent) {
                const lines = chapterContent.trim().split('\n');
                const chapterTitle = lines[0] || '';
                const chapterSummary = lines.slice(1).join(' ').trim();
                html += `<div class="outline-chapter">
                  <div class="outline-chapter-title">第 ${chapterNum} 章：${chapterTitle}</div>
                  <div class="outline-chapter-summary">${chapterSummary}</div>
                </div>`;
              }
            }
            html += `</div>`;
          }
        }
        return html;
      }

      function displayOutline(outline, targetEl) {
        const el = targetEl || outlineContent;
        if (!el) return;
        let html = '';
        const volParts = outline.split(/═══════════\s*(.+?大綱)\s*═══════════/);
        if (volParts.length > 2) {
          for (let i = 1; i < volParts.length; i += 2) {
            const volTitle = volParts[i].trim();
            const volBody = volParts[i + 1] || '';
            html += `<div class="outline-volume-block">
              <h3 class="outline-volume-title">📚 ${volTitle}</h3>`;
            const inner = renderOutlineSectionsHtml(volBody);
            html += inner || `<div style="white-space: pre-wrap; line-height: 1.8;">${volBody.trim()}</div>`;
            html += `</div>`;
          }
        } else {
          html = renderOutlineSectionsHtml(outline);
          if (!html) {
            html = `<div style="white-space: pre-wrap; line-height: 1.8;">${outline}</div>`;
          }
        }
        el.innerHTML = html;
      }

      restoreOutlineUiFromState();

      // 基於大綱生成小說
      generateFromOutlineBtn.addEventListener('click', async () => {
        if (!currentOutline) {
          showStatus('error', '請先生成大綱');
          return;
        }

        // 先依大綱請 AI 取書名（若尚未有書名）；命名失敗不阻擋後續生成
        if (!currentBookTitle) {
          generateFromOutlineBtn.disabled = true;
          const signal = beginGeneration();
          try {
            showStatus('loading', '正在依大綱為作品命名...');
            const title = await generateBookTitle(signal);
            if (title) {
              currentBookTitle = title;
              showOutlineTitle(title);
              updateOutlineAttachPanel();
              saveSettingsToLocal();
            }
          } catch (err) {
            if (err.name === 'AbortError' || userAborted) {
              showStatus('info', '⏹ 已停止');
              endGeneration();
              generateFromOutlineBtn.disabled = false;
              return; // 使用者主動中止 → 不接著生成
            }
            // 其他錯誤：略過命名，仍照常生成
          } finally {
            endGeneration();
            generateFromOutlineBtn.disabled = false;
          }
        }

        // 關閉模態視窗
        outlineModal.classList.remove('open');

        // 清除補充說明中可能殘留的舊版大綱注入
        notesInput.value = stripInjectedOutlineFromNotes(notesInput.value);
        saveSettingsToLocal();

        // 觸發生成（大綱與書名由 getOutlineGenerationBlock 獨立注入 prompt）
        showStatus('success', currentBookTitle ? `書名《${currentBookTitle}》已擬定，開始生成...` : '已依大綱開始生成...');
        setTimeout(() => {
          generateBtn.click();
        }, 500);
      });

      // ==================== 自動保存指示器 ====================
      const autoSaveIndicator = document.getElementById('autoSaveIndicator');
      let autoSaveTimeout = null;

      function showAutoSaveIndicator() {
        autoSaveIndicator.classList.add('show');
        
        if (autoSaveTimeout) {
          clearTimeout(autoSaveTimeout);
        }
        
        autoSaveTimeout = setTimeout(() => {
          autoSaveIndicator.classList.remove('show');
        }, 2000);
      }

      // 監聽設定變更來顯示自動保存指示器
      const originalSaveSettings = saveSettingsToLocal;
      saveSettingsToLocal = function() {
        originalSaveSettings();
        showAutoSaveIndicator();
      };


      // ==================== 首次使用引導 ====================
      const onboardingOverlay = document.getElementById('onboardingOverlay');
      const onboardingSkip = document.getElementById('onboardingSkip');
      const onboardingStart = document.getElementById('onboardingStart');

      // 檢查是否首次使用
      if (!localStorage.getItem('novelWorkshopOnboarded')) {
        setTimeout(() => {
          onboardingOverlay.classList.add('show');
        }, 1000);
      }

      onboardingSkip.addEventListener('click', () => {
        onboardingOverlay.classList.remove('show');
        localStorage.setItem('novelWorkshopOnboarded', 'true');
      });

      onboardingStart.addEventListener('click', () => {
        onboardingOverlay.classList.remove('show');
        localStorage.setItem('novelWorkshopOnboarded', 'true');
      });

      // 註：輸入驗證已整併進主生成流程（generateBtn 的主要點擊處理），
      // 不再需要獨立的 capture 攔截器（對 target 自身的監聽器，capture 旗標不保證先執行，
      // 故無法可靠攔截主流程；主流程內部已自行驗證並提示）。


      // ==================== 翻書閱讀模式 ====================
      (function initBookReader() {
        const overlay = document.getElementById('bookReaderOverlay');
        const openBtn = document.getElementById('bookReaderBtn');
        const closeBtn = document.getElementById('bookReaderClose');
        const bookEl = document.getElementById('bookBook');
        const leftInner = document.getElementById('bookPageLeft');
        const rightInner = document.getElementById('bookPageRight');
        const numLeft = document.getElementById('bookPageNumLeft');
        const numRight = document.getElementById('bookPageNumRight');
        const flipEl = document.getElementById('bookFlip');
        const flipFront = flipEl.querySelector('.book-flip-front');
        const flipBack = flipEl.querySelector('.book-flip-back');
        const prevBtn = document.getElementById('bookPrev');
        const nextBtn = document.getElementById('bookNext');
        const indicator = document.getElementById('bookIndicator');
        const progressFill = document.getElementById('bookProgressFill');
        const titleEl = document.getElementById('bookReaderTitle');
        const fontDec = document.getElementById('bookFontDec');
        const fontInc = document.getElementById('bookFontInc');
        const resetProgressBtn = document.getElementById('bookResetProgress');
        const bookmarkStatusEl = document.getElementById('bookBookmarkStatus');
        const measure = document.getElementById('bookMeasure');

        const BOOK_PROGRESS_KEY = 'bookReaderProgress';
        let saveProgressTimer = null;

        let pages = [];      // 每頁的 HTML 字串
        let pos = 0;         // 桌面：左頁索引；手機：當前頁索引
        let fontSize = parseInt(localStorage.getItem('bookFontSize'), 10) || 19;
        if (isNaN(fontSize)) fontSize = 19;
        let animating = false;

        const isSingle = () => window.matchMedia('(max-width: 820px)').matches;
        const step = () => (isSingle() ? 1 : 2);

        function getStoryTitle() {
          const m = (latestStory || '').match(/^\s*#{1,4}\s*([^\n#]+)/m);
          return m ? m[1].trim() : '翻書閱讀';
        }

        function getBookReaderStoryKey() {
          const story = latestStory || '';
          const title = getStoryTitle();
          const prefix = story.slice(0, 800);
          let hash = 0;
          for (let i = 0; i < prefix.length; i++) {
            hash = ((hash << 5) - hash + prefix.charCodeAt(i)) | 0;
          }
          return `${title}|${(hash >>> 0).toString(36)}`;
        }

        function loadBookProgress() {
          try {
            const raw = localStorage.getItem(BOOK_PROGRESS_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || data.storyKey !== getBookReaderStoryKey()) return null;
            return data;
          } catch {
            return null;
          }
        }

        function saveBookProgress() {
          if (!pages.length || !overlay.classList.contains('open')) return;
          try {
            localStorage.setItem(BOOK_PROGRESS_KEY, JSON.stringify({
              storyKey: getBookReaderStoryKey(),
              title: getStoryTitle(),
              pos,
              totalPages: pages.length,
              fontSize,
              updatedAt: Date.now()
            }));
          } catch { /* ignore */ }
          updateBookmarkStatus();
        }

        function scheduleSaveBookProgress() {
          clearTimeout(saveProgressTimer);
          saveProgressTimer = setTimeout(saveBookProgress, 280);
        }

        function clearBookProgress() {
          try { localStorage.removeItem(BOOK_PROGRESS_KEY); } catch { /* ignore */ }
          if (bookmarkStatusEl) bookmarkStatusEl.textContent = '';
        }

        function restorePosFromProgress(saved) {
          if (!saved || !pages.length) return 0;
          if (saved.totalPages && saved.totalPages > 0) {
            const ratio = (saved.pos || 0) / saved.totalPages;
            return Math.round(ratio * pages.length);
          }
          return Math.min(saved.pos || 0, pages.length - 1);
        }

        function updateBookmarkStatus(resumed = false) {
          if (!bookmarkStatusEl) return;
          const pageNum = pos + 1;
          const total = pages.length;
          if (resumed && pos > 0) {
            bookmarkStatusEl.textContent = `🔖 已從第 ${pageNum} 頁繼續（共 ${total} 頁）`;
            return;
          }
          if (total > 0 && loadBookProgress()) {
            bookmarkStatusEl.textContent = `🔖 閱讀位置已記錄 · 第 ${pageNum} / ${total} 頁`;
          } else if (pos === 0) {
            bookmarkStatusEl.textContent = total > 1 ? '🔖 翻頁時會自動記錄閱讀位置' : '';
          }
        }

        // 將故事解析為區塊（標題 / 段落）
        function parseBlocks(text) {
          const blocks = [];
          const norm = (text || '').replace(/\uFFFD/g, '').replace(/\r\n/g, '\n');
          for (let raw of norm.split('\n')) {
            let line = raw.trim();
            if (!line) continue;
            line = line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
            const h = line.match(/^#{1,4}\s*(.+)$/);
            if (h) { blocks.push({ type: 'title', text: h[1].trim() }); continue; }
            if (/^(?:第[一二三四五六七八九十百千萬零壹貳參肆伍陸柒捌玖拾佰仟\d]+[章節回卷部集篇]|序章|楔子|引子|前言|尾聲|終章|番外|後記)(?:[：:\s]|$)/.test(line)) {
              blocks.push({ type: 'title', text: line }); continue;
            }
            if (/^[-—=─━═]{3,}$/.test(line)) continue;
            blocks.push({ type: 'p', text: line });
          }
          return blocks;
        }

        const titleHtml = (t) => `<h3 class="book-chapter">${escapeHtml(t)}</h3>`;
        const pHtml = (t) => `<p>${escapeHtml(t)}</p>`;

        // 量測分頁
        function paginate() {
          const blocks = parseBlocks(latestStory);
          const ratio = pages.length ? pos / pages.length : 0;
          pages = [];

          const rect = rightInner.getBoundingClientRect();
          measure.style.width = rect.width + 'px';
          measure.style.height = rect.height + 'px';
          measure.style.fontSize = fontSize + 'px';

          const fits = (html) => { measure.innerHTML = html; return measure.scrollHeight <= measure.clientHeight + 1; };
          let current = '';
          const pushPage = () => { if (current.trim()) { pages.push(current); current = ''; } };

          for (const b of blocks) {
            if (b.type === 'title') {
              const html = titleHtml(b.text);
              if (current && !fits(current + html)) pushPage();
              current += html;
              continue;
            }
            const whole = pHtml(b.text);
            if (fits(current + whole)) { current += whole; continue; }
            // 段落過長：依句切分跨頁
            const sentences = b.text.split(/(?<=[。！？…」』）])/).filter(s => s.length);
            let buf = '';
            for (const s of sentences) {
              if (current && !fits(current + pHtml(buf + s))) {
                if (buf) { current += pHtml(buf); buf = ''; }
                pushPage();
              }
              if (!current && !buf && !fits(pHtml(s))) {
                // 單句長於整頁：硬放一頁
                current += pHtml(s);
                pushPage();
              } else {
                buf += s;
              }
            }
            if (buf) {
              if (current && !fits(current + pHtml(buf))) pushPage();
              current += pHtml(buf);
            }
          }
          pushPage();
          if (pages.length === 0) pages.push('<p class="book-empty">（沒有內容）</p>');

          // 還原大致閱讀位置
          pos = Math.round(ratio * pages.length);
          clampPos();
        }

        function clampPos() {
          if (pos < 0) pos = 0;
          if (pos >= pages.length) pos = pages.length - 1;
          if (!isSingle() && pos % 2 !== 0) pos -= 1; // 桌面左頁須為偶數
          if (pos < 0) pos = 0;
        }

        function pageContent(i) {
          return (i >= 0 && i < pages.length) ? pages[i] : '';
        }

        function applyFontSize() {
          [leftInner.parentElement, rightInner.parentElement, flipFront, flipBack].forEach(el => {
            el.style.fontSize = fontSize + 'px';
          });
        }

        function render() {
          bookEl.classList.toggle('single', isSingle());
          applyFontSize();
          clampPos();
          const total = pages.length;
          if (isSingle()) {
            rightInner.innerHTML = pageContent(pos);
            numRight.textContent = (pos + 1) + ' / ' + total;
            numLeft.textContent = '';
          } else {
            leftInner.innerHTML = pageContent(pos);
            rightInner.innerHTML = pageContent(pos + 1);
            numLeft.textContent = pos + 1 <= total ? String(pos + 1) : '';
            numRight.textContent = (pos + 2) <= total ? String(pos + 2) : '';
          }
          // 指示與進度
          const shownEnd = isSingle() ? pos + 1 : Math.min(pos + 2, total);
          indicator.textContent = `第 ${pos + 1}${(!isSingle() && shownEnd > pos + 1) ? '–' + shownEnd : ''} 頁 / 共 ${total} 頁`;
          progressFill.style.width = (total <= 1 ? 100 : (shownEnd / total) * 100) + '%';
          prevBtn.disabled = pos <= 0;
          nextBtn.disabled = pos + step() >= total;
          scheduleSaveBookProgress();
        }

        function go(dir) {
          if (animating) return;
          const total = pages.length;
          const s = step();
          if (dir > 0 && pos + s >= total) return;
          if (dir < 0 && pos <= 0) return;

          const single = isSingle();
          flipEl.className = 'book-flip active ' + (dir > 0 ? 'forward' : 'backward');
          if (single) flipEl.style.width = '100%'; else flipEl.style.width = '50%';

          if (dir > 0) {
            // 前進：翻走的頁（front）→ 新頁（back）
            if (single) {
              flipFront.innerHTML = pageContent(pos);
              flipBack.innerHTML = pageContent(pos + 1);
              rightInner.innerHTML = pageContent(pos + 1);
            } else {
              flipFront.innerHTML = pageContent(pos + 1);
              flipBack.innerHTML = pageContent(pos + 2);
              rightInner.innerHTML = pageContent(pos + 3); // 翻頁後新右頁，先墊在底下
            }
          } else {
            if (single) {
              flipFront.innerHTML = pageContent(pos);
              flipBack.innerHTML = pageContent(pos - 1);
              rightInner.innerHTML = pageContent(pos - 1);
            } else {
              flipFront.innerHTML = pageContent(pos);
              flipBack.innerHTML = pageContent(pos - 1);
              leftInner.innerHTML = pageContent(pos - 2); // 翻頁後新左頁，先墊在底下
            }
          }
          applyFontSize();

          animating = true;
          // 強制 reflow 後加上 run 觸發動畫
          void flipEl.offsetWidth;
          flipEl.classList.add('run');

          const onEnd = () => {
            flipEl.removeEventListener('animationend', onEnd);
            pos += dir > 0 ? s : -s;
            clampPos();
            flipEl.className = 'book-flip';
            flipFront.innerHTML = '';
            flipBack.innerHTML = '';
            animating = false;
            render();
          };
          flipEl.addEventListener('animationend', onEnd);
        }

        function open() {
          if (!latestStory || !latestStory.trim()) {
            showStatus('error', '目前沒有可閱讀的內容');
            return;
          }
          titleEl.textContent = '📖 ' + getStoryTitle();
          overlay.classList.add('open');
          const saved = loadBookProgress();
          // 等版面就緒再分頁
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              pos = 0;
              if (saved?.fontSize) {
                fontSize = Math.max(14, Math.min(28, saved.fontSize));
                localStorage.setItem('bookFontSize', fontSize);
              }
              paginate();
              let resumed = false;
              if (saved) {
                const restored = restorePosFromProgress(saved);
                if (restored > 0) {
                  pos = restored;
                  clampPos();
                  resumed = true;
                }
              }
              render();
              updateBookmarkStatus(resumed);
              if (resumed) saveBookProgress();
            });
          });
        }

        function close() {
          saveBookProgress();
          overlay.classList.remove('open');
        }

        function resetToStart() {
          pos = 0;
          clearBookProgress();
          clampPos();
          render();
          updateBookmarkStatus();
        }

        let resizeTimer = null;
        window.addEventListener('resize', () => {
          if (!overlay.classList.contains('open')) return;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => { paginate(); render(); }, 200);
        });

        openBtn.addEventListener('click', () => { if (!openBtn.disabled) open(); });
        closeBtn.addEventListener('click', close);
        if (resetProgressBtn) resetProgressBtn.addEventListener('click', resetToStart);
        prevBtn.addEventListener('click', () => go(-1));
        nextBtn.addEventListener('click', () => go(1));

        // 點擊書本左右半邊翻頁
        bookEl.addEventListener('click', (e) => {
          if (animating) return;
          const r = bookEl.getBoundingClientRect();
          if ((e.clientX - r.left) < r.width / 2) go(-1); else go(1);
        });

        fontInc.addEventListener('click', () => {
          fontSize = Math.min(28, fontSize + 1);
          localStorage.setItem('bookFontSize', fontSize);
          paginate(); render();
        });
        fontDec.addEventListener('click', () => {
          fontSize = Math.max(14, fontSize - 1);
          localStorage.setItem('bookFontSize', fontSize);
          paginate(); render();
        });

        document.addEventListener('keydown', (e) => {
          if (!overlay.classList.contains('open')) return;
          if (e.key === 'Escape') { close(); }
          else if (e.key === 'ArrowLeft') { go(-1); }
          else if (e.key === 'ArrowRight') { go(1); }
        });
      })();

      /* ============================================================
         小說創作流程列（Pipeline Stepper）
         ============================================================ */
      const pipelineEl = document.getElementById('pipeline');

      function updateStepper() {
        if (!pipelineEl) return;
        const chips = Array.from(pipelineEl.querySelectorAll('.step-chip'));
        const links = Array.from(pipelineEl.querySelectorAll('.step-link'));

        // 蒐集狀態
        const hasTheme = !!(themeSelect.value && themeSelect.value.trim());
        const hasSetting = !!(settingSelect.value && settingSelect.value.trim());
        const setupDone = hasTheme && hasSetting;

        let castCount = 0;
        Array.from(charactersContainer.querySelectorAll('.character-row')).forEach(row => {
          const name = row.querySelector('.char-name');
          if (name && name.value.trim()) castCount++;
        });

        let outlineDone = false;
        try { outlineDone = !!currentOutline; } catch (e) { outlineDone = false; }

        const story = latestStory || '';
        const wordCount = story.replace(/[\s\n]/g, '').length;
        const chapterCount = countChapters(story);
        const draftStarted = wordCount > 0;
        const readReady = chapterCount > 0 || wordCount > 0;

        // 更新數字
        const setMetric = (key, val) => {
          const el = pipelineEl.querySelector(`.step-num[data-metric="${key}"]`);
          if (el) el.textContent = val;
        };
        setMetric('setup', setupDone ? '已完成' : (hasTheme || hasSetting ? '進行中' : '待設定'));
        setMetric('cast', castCount + ' 位');
        setMetric('outline', outlineDone ? '已生成' : '未生成');
        setMetric('draft', wordCount.toLocaleString() + ' 字');
        setMetric('read', chapterCount + ' 章');

        // 計算狀態：done / active / pending
        const states = [setupDone, castCount > 0, outlineDone, draftStarted, readReady];
        // active = 第一個尚未完成的步驟（或全部完成則最後一步 active）
        let activeIndex = states.findIndex(s => !s);
        if (activeIndex === -1) activeIndex = states.length - 1;

        chips.forEach((chip, idx) => {
          chip.classList.remove('done', 'active');
          if (states[idx]) chip.classList.add('done');
          if (idx === activeIndex) {
            chip.classList.remove('done');
            chip.classList.add('active');
          }
        });
        links.forEach((link, idx) => {
          link.style.background = states[idx] ? 'var(--gold)' : 'var(--border)';
        });

        if (typeof refreshPrimaryUI === 'function') refreshPrimaryUI();
        if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
      }

      // ==================== 主要動作列 / 即時防呆 / 章節推算 ====================
      // 是否已有任何可生成的設定
      function hasAnyStorySetting() {
        const basics = [themeSelect, settingSelect, styleSelect, chaptersInput, lengthInput, notesInput,
          narrativeSelect, eraSelect, pacingSelect, ratingSelect, worldComplexitySelect, emotionalToneSelect, endingSelect]
          .some(el => el && el.value && String(el.value).trim());
        if (basics) return true;
        try { if (collectCharactersInfo().charactersInfo) return true; } catch (e) {}
        if (specialElementsContainer && specialElementsContainer.querySelector('.special-element-item.selected')) return true;
        return false;
      }

      // 章節數 × 字數 即時推算
      function updatePerChapterHint() {
        if (!perChapterHint) return;
        const c = parseInt(chaptersInput.value, 10);
        const l = parseInt(lengthInput.value, 10);
        if (c > 0 && l > 0) {
          const per = Math.round(l / c);
          perChapterHint.textContent = `📐 約每章 ${per.toLocaleString()} 字（共 ${c} 章 ／ 總 ${l.toLocaleString()} 字）— 生成時會要求 AI 每章寫約此篇幅`;
          perChapterHint.classList.toggle('warn', per < 800 || per > 6000);
          perChapterHint.style.display = 'block';
        } else {
          perChapterHint.style.display = 'none';
        }
      }

      function refreshPrimaryUI() {
        updatePerChapterHint();
        if (!primaryGenerateBtn) return;
        const valid = hasAnyStorySetting();
        primaryGenerateBtn.disabled = generateBtn.disabled || !valid;
        primaryContinueBtn.disabled = continueBtn.disabled;
        if (generateBtn.disabled && !navigator.onLine) {
          primaryActionHint.textContent = '📴 目前離線，恢復網路連線後即可生成。';
          primaryActionHint.classList.add('warn');
        } else if (!valid) {
          primaryActionHint.textContent = '請至少設定一項（主題／背景／人物／特殊元素…），或使用各區塊的「🎲 隨機填充」。';
          primaryActionHint.classList.remove('warn');
        } else {
          primaryActionHint.textContent = '';
          primaryActionHint.classList.remove('warn');
        }
        if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
      }

      function resetWorkspace() {
        if (!latestStory && !(resultDiv && resultDiv.textContent.trim())) {
          showStatus('info', '目前沒有可清除的生成結果');
          return;
        }
        if (latestStory && !confirm('確定要清除目前生成的小說內容嗎？（故事設定與人物會保留）')) return;
        resultDiv.textContent = '';
        latestStory = '';
        chapterMatches = [];
        if (chapterNavContainer) chapterNavContainer.classList.remove('show');
        try { localStorage.removeItem('savedStory'); } catch (e) {}
        // 一併清除系列分集狀態
        storySeries = null;
        seriesAborted = false;
        try { localStorage.removeItem('storySeries'); } catch (e) {}
        if (typeof renderSeriesBar === 'function') renderSeriesBar();
        downloadBtn.disabled = true;
        continueBtn.disabled = true;
        if (speakBtn) speakBtn.disabled = true;
        if (bookReaderBtn) bookReaderBtn.disabled = true;
        hideStatus();
        if (typeof updateStepper === 'function') updateStepper();
        showStatus('success', '🧹 已清除生成結果，可重新開始');
      }

      if (primaryGenerateBtn) {
        primaryGenerateBtn.addEventListener('click', () => { if (!primaryGenerateBtn.disabled) generateBtn.click(); });
        primaryContinueBtn.addEventListener('click', () => { if (!primaryContinueBtn.disabled) continueBtn.click(); });
        resetWorkspaceBtn.addEventListener('click', resetWorkspace);

        // 即時更新：字數推算與特殊元素勾選
        chaptersInput.addEventListener('input', refreshPrimaryUI);
        lengthInput.addEventListener('input', refreshPrimaryUI);
        if (specialElementsContainer) {
          specialElementsContainer.addEventListener('click', () => setTimeout(refreshPrimaryUI, 0));
        }

        // 觀察工具列生成 / 繼續按鈕的 disabled 狀態（含離線、生成中、達標等），同步鏡像按鈕
        const mirrorObserver = new MutationObserver(() => refreshPrimaryUI());
        mirrorObserver.observe(generateBtn, { attributes: true, attributeFilter: ['disabled'] });
        mirrorObserver.observe(continueBtn, { attributes: true, attributeFilter: ['disabled'] });
      }

      // ==================== 三模態設定工作台 ====================
      let openStoryElementsModal = null;
      let openAdvancedSettingsModal = null;
      let openSpecialElementsModal = null;

      function getSelectLabel(sel) {
        if (!sel || !sel.value) return '';
        const opt = sel.options[sel.selectedIndex];
        return opt ? opt.textContent.trim() : String(sel.value).trim();
      }

      function pickSummaryTooltip(chipText, tooltip) {
        if (!tooltip || !String(tooltip).trim()) return undefined;
        const t = String(tooltip).trim();
        let visible = String(chipText).trim();
        const colonIdx = visible.indexOf('：');
        if (colonIdx > 0) visible = visible.slice(colonIdx + 1).trim();
        // 下拉選項常為「圖示 名稱 - 簡述」，只拿名稱與簡述比對
        visible = visible.replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, '').trim();
        const dashIdx = visible.indexOf(' - ');
        const shortLabel = (dashIdx > 0 ? visible.slice(0, dashIdx) : visible).trim();
        const descPart = dashIdx > 0 ? visible.slice(dashIdx + 3).trim() : '';
        if (t === visible || t === shortLabel || (descPart && t === descPart)) return undefined;
        if (visible.includes(t)) return undefined;
        if (descPart && (descPart.includes(t) || t.includes(descPart))) return undefined;
        return t;
      }

      let summaryTipEl = null;
      let summaryTipHideTimer = null;
      let summaryTipScrollBound = false;

      function getSummaryTipEl() {
        if (!summaryTipEl) {
          summaryTipEl = document.createElement('div');
          summaryTipEl.id = 'configSummaryTip';
          summaryTipEl.className = 'config-summary-tip';
          summaryTipEl.setAttribute('role', 'tooltip');
          summaryTipEl.hidden = true;
          document.body.appendChild(summaryTipEl);
          if (!summaryTipScrollBound) {
            window.addEventListener('scroll', hideSummaryTip, true);
            window.addEventListener('resize', hideSummaryTip);
            summaryTipScrollBound = true;
          }
        }
        return summaryTipEl;
      }

      function positionSummaryTip(chip, tipEl) {
        const rect = chip.getBoundingClientRect();
        const block = chip.closest('.config-summary-block');
        const blockType = block ? block.dataset.block : '';
        tipEl.dataset.block = blockType;
        tipEl.hidden = false;
        tipEl.style.left = '-9999px';
        tipEl.style.top = '0';
        const tipRect = tipEl.getBoundingClientRect();
        const showBelow = blockType === 'advanced';
        let top = showBelow ? rect.bottom + 8 : rect.top - tipRect.height - 8;
        if (!showBelow && top < 8) top = rect.bottom + 8;
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        tipEl.style.left = left + 'px';
        tipEl.style.top = top + 'px';
      }

      function showSummaryTip(chip, text) {
        clearTimeout(summaryTipHideTimer);
        const tipEl = getSummaryTipEl();
        tipEl.textContent = text;
        positionSummaryTip(chip, tipEl);
      }

      function hideSummaryTip() {
        summaryTipHideTimer = setTimeout(() => {
          if (summaryTipEl) summaryTipEl.hidden = true;
        }, 60);
      }

      function bindSummaryChipTip(chip, text) {
        chip.addEventListener('mouseenter', () => showSummaryTip(chip, text));
        chip.addEventListener('mouseleave', hideSummaryTip);
      }

      function summaryChipText(chip) {
        if (typeof chip === 'string') return chip;
        return chip && chip.text ? chip.text : '';
      }

      function createSummaryChip(text, tooltip) {
        const span = document.createElement('span');
        span.className = 'config-summary-chip';
        const colon = text.indexOf('：');
        if (colon > 0) {
          const label = document.createElement('span');
          label.className = 'config-summary-chip-label';
          label.textContent = text.slice(0, colon + 1);
          const value = document.createElement('span');
          value.className = 'config-summary-chip-value';
          value.textContent = text.slice(colon + 1);
          span.appendChild(label);
          span.appendChild(value);
        } else {
          const value = document.createElement('span');
          value.className = 'config-summary-chip-value';
          value.textContent = text;
          span.appendChild(value);
        }
        if (tooltip) {
          const tip = pickSummaryTooltip(text, tooltip);
          if (tip) {
            span.classList.add('config-summary-chip--has-tip');
            bindSummaryChipTip(span, tip);
          }
        }
        return span;
      }

      function renderSummaryChips(container, chips) {
        if (!container) return;
        container.innerHTML = '';
        if (!chips.length) {
          container.innerHTML = '<p class="config-summary-empty">尚未設定</p>';
          return;
        }
        chips.forEach((chip) => {
          const text = summaryChipText(chip);
          const tooltip = chip && typeof chip === 'object' ? chip.tooltip : undefined;
          container.appendChild(createSummaryChip(text, tooltip));
        });
      }

      function collectStoryCharacterSummaries() {
        if (!charactersContainer) return [];
        return Array.from(charactersContainer.querySelectorAll('.character-row'))
          .map((row, idx) => {
            const val = (sel) => {
              const el = row.querySelector(sel);
              return el ? el.value.trim() : '';
            };
            const gender = val('.char-gender');
            const role = val('.char-role');
            const age = val('.char-age');
            const name = val('.char-name');
            const personality = val('.char-personality');
            const goal = val('.char-goal');
            const weakness = val('.char-weakness');
            const secret = val('.char-secret');
            const relation = val('.char-relation');
            const hasContent = [gender, role, age, name, personality, goal, weakness, secret, relation]
              .some((v) => v && v !== '不明');
            if (!hasContent) return null;
            return {
              index: idx + 1,
              displayName: name || `人物 ${idx + 1}`,
              initial: (name || String(idx + 1)).charAt(0),
              gender: gender && gender !== '不明' ? gender : '',
              role,
              age: age ? (/^\d+$/.test(age) ? age + ' 歲' : age) : '',
              personality,
              goal,
              weakness,
              secret,
              relation
            };
          })
          .filter(Boolean);
      }

      function collectStorySummaryChips() {
        const chips = [];
        if (themeSelect && themeSelect.value.trim()) {
          const value = getSelectLabel(themeSelect);
          const catHint = findCategoryHint(themeSelect.value, themeCategories);
          chips.push({
            text: '主題：' + value,
            tooltip: themeOptionImpacts[themeSelect.value.trim()] || catHint || storyFieldHints['主題']
          });
        }
        if (settingSelect && settingSelect.value.trim()) {
          const value = getSelectLabel(settingSelect);
          const catHint = findCategoryHint(settingSelect.value, settingCategories);
          chips.push({
            text: '背景：' + value,
            tooltip: settingOptionImpacts[settingSelect.value.trim()] || catHint || storyFieldHints['背景']
          });
        }
        if (styleSelect && styleSelect.value.trim()) {
          const value = getSelectLabel(styleSelect);
          const catHint = findCategoryHint(styleSelect.value, styleCategories);
          chips.push({
            text: '風格：' + value,
            tooltip: styleOptionImpacts[styleSelect.value.trim()] || catHint || storyFieldHints['風格']
          });
        }
        const chapters = chaptersInput && parseInt(chaptersInput.value, 10);
        const length = lengthInput && parseInt(lengthInput.value, 10);
        if (chapters > 0) chips.push({ text: chapters + ' 章' });
        if (length > 0) chips.push({ text: length.toLocaleString() + ' 字' });
        const volEl = document.getElementById('volumes');
        const volumes = volEl ? parseInt(volEl.value, 10) : 1;
        if (volumes > 1) chips.push({ text: volumes + ' 集' });
        const autoToggle = document.getElementById('autoContinueToggle');
        if (autoToggle && !autoToggle.checked) chips.push({ text: '手動續寫' });
        return chips;
      }

      function renderStorySummary(container, metaChips, characters) {
        if (!container) return;
        container.innerHTML = '';
        if (!metaChips.length && !characters.length) {
          container.innerHTML = '<p class="config-summary-empty">尚未設定</p>';
          return;
        }

        if (metaChips.length) {
          const meta = document.createElement('div');
          meta.className = 'config-summary-meta';
          metaChips.forEach((chip) => {
            const text = summaryChipText(chip);
            const tooltip = chip && typeof chip === 'object' ? chip.tooltip : undefined;
            meta.appendChild(createSummaryChip(text, tooltip));
          });
          container.appendChild(meta);
        }

        if (!characters.length) return;

        const heading = document.createElement('p');
        heading.className = 'config-summary-char-heading';
        heading.textContent = `主要人物（${characters.length} 位）`;
        container.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'config-summary-char-grid';

        characters.forEach((ch) => {
          const card = document.createElement('article');
          card.className = 'config-summary-char-card';

          const head = document.createElement('div');
          head.className = 'config-summary-char-head';

          const avatar = document.createElement('span');
          avatar.className = 'config-summary-char-avatar';
          avatar.textContent = ch.initial;
          avatar.setAttribute('aria-hidden', 'true');

          const metaWrap = document.createElement('div');
          metaWrap.className = 'config-summary-char-meta';

          const nameEl = document.createElement('span');
          nameEl.className = 'config-summary-char-name';
          nameEl.textContent = ch.displayName;

          const badges = document.createElement('div');
          badges.className = 'config-summary-char-badges';
          if (ch.role) {
            const roleBadge = document.createElement('span');
            roleBadge.className = 'config-summary-char-badge config-summary-char-badge--role';
            roleBadge.textContent = ch.role;
            badges.appendChild(roleBadge);
          }
          const demo = [ch.gender, ch.age].filter(Boolean).join(' · ');
          if (demo) {
            const demoBadge = document.createElement('span');
            demoBadge.className = 'config-summary-char-badge';
            demoBadge.textContent = demo;
            badges.appendChild(demoBadge);
          }

          metaWrap.appendChild(nameEl);
          if (badges.childElementCount) metaWrap.appendChild(badges);
          head.appendChild(avatar);
          head.appendChild(metaWrap);
          card.appendChild(head);

          const details = [
            ['個性', ch.personality],
            ['目標', ch.goal],
            ['弱點', ch.weakness],
            ['祕密', ch.secret],
            ['人際', ch.relation]
          ].filter(([, v]) => v);

          if (details.length) {
            const dl = document.createElement('dl');
            dl.className = 'config-summary-char-details';
            details.forEach(([label, value]) => {
              const row = document.createElement('div');
              row.className = 'config-summary-char-detail';
              const dt = document.createElement('dt');
              dt.textContent = label;
              const dd = document.createElement('dd');
              dd.textContent = value;
              row.appendChild(dt);
              row.appendChild(dd);
              dl.appendChild(row);
            });
            card.appendChild(dl);
          }

          grid.appendChild(card);
        });

        container.appendChild(grid);
      }

      function collectAdvancedSummaryChips() {
        const fields = [
          ['敘事視角', narrativeSelect],
          ['時代設定', eraSelect],
          ['故事節奏', pacingSelect],
          ['內容分級', ratingSelect],
          ['世界觀複雜度', worldComplexitySelect],
          ['情感基調', emotionalToneSelect],
          ['結局傾向', endingSelect]
        ];
        return fields
          .filter(([, sel]) => sel && sel.value.trim())
          .map(([label, sel]) => ({
            text: label + '：' + getSelectLabel(sel),
            tooltip: advancedOptionImpacts[sel.value.trim()] || advancedFieldHints[label]
          }));
      }

      function collectSpecialSummaryChips() {
        const chips = [];
        if (!specialElementsContainer) return chips;
        const selected = specialElementsContainer.querySelectorAll('.special-element-item.selected');
        selected.forEach((item) => {
          const id = item.dataset.id;
          const meta = id ? specialElementMeta.get(id) : null;
          const label = meta ? meta.label : (item.querySelector('.element-label')?.textContent.trim() || '');
          if (!label) return;
          const hint = meta && meta.hint ? meta.hint : '';
          chips.push({
            text: label,
            tooltip: pickSummaryTooltip(label, hint)
          });
        });
        return chips;
      }

      function updateWorkspaceSummary() {
        const summaryRoot = document.getElementById('workspaceConfigSummary');
        if (!summaryRoot) return;

        const storyChips = collectStorySummaryChips();
        const storyCharacters = collectStoryCharacterSummaries();
        const advancedChips = collectAdvancedSummaryChips();
        const specialChips = collectSpecialSummaryChips();

        const hasStory = storyChips.length > 0 || storyCharacters.length > 0;
        const hasAdvanced = advancedChips.length > 0;
        const hasSpecial = specialChips.length > 0;

        const storyBlock = summaryRoot.querySelector('[data-block="story"]');
        const advancedBlock = summaryRoot.querySelector('[data-block="advanced"]');
        const specialBlock = summaryRoot.querySelector('[data-block="special"]');
        if (storyBlock) storyBlock.hidden = !hasStory;
        if (advancedBlock) advancedBlock.hidden = !hasAdvanced;
        if (specialBlock) specialBlock.hidden = !hasSpecial;

        renderStorySummary(document.getElementById('summaryStory'), storyChips, storyCharacters);
        renderSummaryChips(document.getElementById('summaryAdvanced'), advancedChips);
        renderSummaryChips(document.getElementById('summarySpecial'), specialChips);

        const launcherStorySub = document.getElementById('launcherStorySub');
        const launcherAdvancedSub = document.getElementById('launcherAdvancedSub');
        const launcherSpecialSub = document.getElementById('launcherSpecialSub');
        if (launcherStorySub) {
          if (!hasStory) {
            launcherStorySub.textContent = '尚未設定';
          } else {
            const parts = [];
            if (storyChips.length) parts.push(summaryChipText(storyChips[0]));
            if (storyCharacters.length) {
              const names = storyCharacters
                .map((c) => c.displayName)
                .slice(0, 2)
                .join('、');
              parts.push(storyCharacters.length + ' 位角色' + (names ? '：' + names : ''));
            }
            launcherStorySub.textContent = parts.join(' · ') + (storyChips.length > 1 || storyCharacters.length > 2 ? ' …' : '');
          }
        }
        if (launcherAdvancedSub) {
          launcherAdvancedSub.textContent = hasAdvanced
            ? '已選 ' + advancedChips.length + ' 項'
            : '尚未設定';
        }
        if (launcherSpecialSub) {
          launcherSpecialSub.textContent = hasSpecial
            ? '已選 ' + specialChips.length + ' 項'
            : '尚未設定';
        }

        summaryRoot.hidden = !(hasStory || hasAdvanced || hasSpecial);
      }

      function initWorkspaceModal({ overlay, openBtn, closeBtns, onClose }) {
        if (!overlay) return () => {};
        const open = () => {
          overlay.classList.add('open');
          document.body.classList.add('modal-open');
        };
        const close = () => {
          overlay.classList.remove('open');
          if (!document.querySelector('.modal-overlay.open')) {
            document.body.classList.remove('modal-open');
          }
          if (typeof onClose === 'function') onClose();
          updateWorkspaceSummary();
          if (typeof updateStepper === 'function') updateStepper();
        };
        if (openBtn) openBtn.addEventListener('click', open);
        (closeBtns || []).forEach((btn) => {
          if (btn) btn.addEventListener('click', close);
        });
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) close();
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && overlay.classList.contains('open')) close();
        });
        return open;
      }

      const storyElementsModal = document.getElementById('storyElementsModal');
      const advancedSettingsModal = document.getElementById('advancedSettingsModal');
      const specialElementsModal = document.getElementById('specialElementsModal');

      openStoryElementsModal = initWorkspaceModal({
        overlay: storyElementsModal,
        openBtn: document.getElementById('openStoryModalBtn'),
        closeBtns: storyElementsModal
          ? storyElementsModal.querySelectorAll('[data-modal-close="story"], [data-modal-done="story"]')
          : []
      });

      openAdvancedSettingsModal = initWorkspaceModal({
        overlay: advancedSettingsModal,
        openBtn: document.getElementById('openAdvancedModalBtn'),
        closeBtns: advancedSettingsModal
          ? advancedSettingsModal.querySelectorAll('[data-modal-close="advanced"], [data-modal-done="advanced"]')
          : []
      });

      openSpecialElementsModal = initWorkspaceModal({
        overlay: specialElementsModal,
        openBtn: document.getElementById('openSpecialModalBtn'),
        closeBtns: specialElementsModal
          ? specialElementsModal.querySelectorAll('[data-modal-close="special"], [data-modal-done="special"]')
          : []
      });

      document.querySelectorAll('.config-summary-edit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const which = btn.dataset.openModal;
          if (which === 'story' && openStoryElementsModal) openStoryElementsModal();
          else if (which === 'advanced' && openAdvancedSettingsModal) openAdvancedSettingsModal();
          else if (which === 'special' && openSpecialElementsModal) openSpecialElementsModal();
        });
      });

      [
        themeSelect, settingSelect, styleSelect, chaptersInput, lengthInput,
        narrativeSelect, eraSelect, pacingSelect, ratingSelect,
        worldComplexitySelect, emotionalToneSelect, endingSelect
      ].forEach((el) => {
        if (el) el.addEventListener('change', updateWorkspaceSummary);
      });
      const volumesEl = document.getElementById('volumes');
      const autoContinueEl = document.getElementById('autoContinueToggle');
      if (volumesEl) volumesEl.addEventListener('input', updateWorkspaceSummary);
      if (autoContinueEl) autoContinueEl.addEventListener('change', updateWorkspaceSummary);
      if (charactersContainer) {
        charactersContainer.addEventListener('input', () => {
          if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
        });
        charactersContainer.addEventListener('change', () => {
          if (typeof updateWorkspaceSummary === 'function') updateWorkspaceSummary();
        });
      }

      const randomAdvancedBtn = document.getElementById('randomAdvancedBtn');
      if (randomAdvancedBtn) {
        randomAdvancedBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          randomizeAdvancedSettings();
          showStatus('success', '已隨機設定進階選項');
          updateWorkspaceSummary();
        });
      }

      const randomStoryElementsBtn = document.getElementById('randomStoryElementsBtn');
      if (randomStoryElementsBtn) {
        randomStoryElementsBtn.addEventListener('click', () => {
          randomizeStoryElements();
          showStatus('success', '已隨機填充主題、背景與風格');
          updateWorkspaceSummary();
        });
      }

      // 流程列點擊：跳轉到對應區塊或觸發大綱
      if (pipelineEl) {
        pipelineEl.addEventListener('click', (e) => {
          const chip = e.target.closest('.step-chip');
          if (!chip) return;
          const action = chip.dataset.action;
          if (action === 'outline') {
            const ob = document.getElementById('outlineBtn');
            if (ob) ob.click();
            return;
          }
          const target = chip.dataset.target;
          if (target === '#stepCast') {
            if (openStoryElementsModal) openStoryElementsModal();
            return;
          }
          if (target) {
            const node = document.querySelector(target);
            if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }

      /* ============================================================
         右側工具 dock 收合
         ============================================================ */
      const dockToggle = document.getElementById('dockToggle');
      function setDockCollapsed(collapsed) {
        document.body.classList.toggle('dock-collapsed', collapsed);
        try { localStorage.setItem('dockCollapsed', collapsed ? '1' : '0'); } catch (e) {}
        if (collapsed) {
          // 收合時一併關閉展開的面板
          apiPanel.classList.remove('open');
          if (toolbarDownloadMenu) toolbarDownloadMenu.classList.remove('open');
          const cn = document.getElementById('chapterNavPanel');
          const bn = document.getElementById('bookmarkNavPanel');
          if (cn) cn.classList.remove('open');
          if (bn) bn.classList.remove('open');
        }
      }
      if (dockToggle) {
        dockToggle.addEventListener('click', () => {
          setDockCollapsed(!document.body.classList.contains('dock-collapsed'));
        });
        setDockCollapsed(localStorage.getItem('dockCollapsed') === '1');
      }

      /* ============================================================
         人名清單模態 + AI 生成人物
         ============================================================ */
      const namePoolModal = document.getElementById('namePoolModal');
      const namePoolBtn = document.getElementById('namePoolBtn');
      const namePoolInput = document.getElementById('namePoolInput');
      const namePoolGender = document.getElementById('namePoolGender');
      const namePoolAddBtn = document.getElementById('namePoolAddBtn');
      const namePoolList = document.getElementById('namePoolList');
      const namePoolSelectedCount = document.getElementById('namePoolSelectedCount');
      const closeNamePoolModal = document.getElementById('closeNamePoolModal');
      const namePoolClearSelectedBtn = document.getElementById('namePoolClearSelectedBtn');
      const namePoolDeleteAllBtn = document.getElementById('namePoolDeleteAllBtn');
      const aiGenerateCharactersBtn = document.getElementById('aiGenerateCharactersBtn');

      function addCustomName(name, gender) {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
          showStatus('info', '請輸入姓名');
          return false;
        }
        if (customNamePool.some(e => e.name === trimmed)) {
          showStatus('info', `「${trimmed}」已在清單中`);
          return false;
        }
        customNamePool.push({
          id: 'name_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          name: trimmed,
          gender: ['男', '女', '不明'].includes(gender) ? gender : '不明',
          selected: true
        });
        saveSettingsToLocal();
        updateNamePoolBtnBadge();
        renderNamePoolModal();
        return true;
      }

      function removeCustomName(id) {
        customNamePool = customNamePool.filter(e => e.id !== id);
        saveSettingsToLocal();
        updateNamePoolBtnBadge();
        renderNamePoolModal();
      }

      function toggleNameSelected(id, selected) {
        const item = customNamePool.find(e => e.id === id);
        if (!item) return;
        item.selected = selected;
        saveSettingsToLocal();
        updateNamePoolBtnBadge();
        renderNamePoolModal();
      }

      function renderNamePoolModal() {
        if (!namePoolList) return;
        if (!customNamePool.length) {
          namePoolList.innerHTML = '<div class="name-pool-empty">尚未新增人名</div>';
        } else {
          namePoolList.innerHTML = customNamePool.map(e => `
            <div class="name-pool-row${e.selected ? ' selected' : ''}" data-id="${escapeHtml(e.id)}">
              <label class="name-pool-label">
                <input type="checkbox" class="name-pool-check" data-id="${escapeHtml(e.id)}" ${e.selected ? 'checked' : ''} />
                <span class="name-pool-name" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>
              </label>
              <div class="name-pool-meta">
                <span class="name-pool-gender">${escapeHtml(e.gender)}</span>
                <button type="button" class="name-pool-remove" data-id="${escapeHtml(e.id)}" title="刪除">✕</button>
              </div>
            </div>
          `).join('');
          namePoolList.querySelectorAll('.name-pool-check').forEach(cb => {
            cb.addEventListener('change', () => toggleNameSelected(cb.dataset.id, cb.checked));
          });
          namePoolList.querySelectorAll('.name-pool-remove').forEach(btn => {
            btn.addEventListener('click', () => removeCustomName(btn.dataset.id));
          });
        }
        const n = customNamePool.filter(e => e.selected).length;
        if (namePoolSelectedCount) namePoolSelectedCount.textContent = `已勾選 ${n} 個`;
      }

      function openNamePoolModal() {
        if (!namePoolModal) return;
        renderNamePoolModal();
        namePoolModal.classList.add('open');
        if (namePoolInput) {
          namePoolInput.value = '';
          setTimeout(() => namePoolInput.focus(), 80);
        }
      }

      function closeNamePoolModalFn() {
        if (namePoolModal) namePoolModal.classList.remove('open');
      }

      if (namePoolBtn) namePoolBtn.addEventListener('click', openNamePoolModal);
      if (closeNamePoolModal) closeNamePoolModal.addEventListener('click', closeNamePoolModalFn);
      if (namePoolModal) {
        namePoolModal.addEventListener('click', (e) => {
          if (e.target === namePoolModal) closeNamePoolModalFn();
        });
      }
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && namePoolModal && namePoolModal.classList.contains('open')) {
          closeNamePoolModalFn();
        }
      });
      if (namePoolAddBtn) {
        namePoolAddBtn.addEventListener('click', () => {
          if (addCustomName(namePoolInput && namePoolInput.value, namePoolGender && namePoolGender.value)) {
            if (namePoolInput) namePoolInput.value = '';
            if (namePoolInput) namePoolInput.focus();
          }
        });
      }
      if (namePoolInput) {
        namePoolInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (namePoolAddBtn) namePoolAddBtn.click();
          }
        });
      }
      if (namePoolClearSelectedBtn) {
        namePoolClearSelectedBtn.addEventListener('click', () => {
          customNamePool.forEach(e => { e.selected = false; });
          saveSettingsToLocal();
          updateNamePoolBtnBadge();
          renderNamePoolModal();
        });
      }
      if (namePoolDeleteAllBtn) {
        namePoolDeleteAllBtn.addEventListener('click', () => {
          if (!customNamePool.length) return;
          if (!confirm('確定要刪除全部人名嗎？')) return;
          customNamePool = [];
          saveSettingsToLocal();
          updateNamePoolBtnBadge();
          renderNamePoolModal();
        });
      }

      updateNamePoolBtnBadge();

      // 將一個物件填入指定的人物列
      function fillCharacterRow(row, data) {
        if (!row || !data) return;
        data = reconcileCharacterWithNamePool(data);
        const set = (sel, val) => {
          const el = row.querySelector(sel);
          if (el && val != null && String(val).trim()) {
            el.value = String(val).trim();
            el.title = el.value; // 懸停顯示完整內容
          }
        };
        set('.char-gender', data.gender);
        set('.char-role', normalizeCharRole(data.role, data.gender));
        set('.char-age', data.age);
        set('.char-name', data.name);
        set('.char-personality', data.personality);
        set('.char-goal', data.goal);
        set('.char-weakness', data.weakness);
        set('.char-secret', data.secret);
        set('.char-relation', data.relation);
      }

      // 從 AI 回應中盡力擷取 JSON
      function parseJsonFromText(text) {
        if (!text) return null;
        let t = text.trim();
        // 去除 ```json ... ``` 圍欄
        t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        try { return JSON.parse(t); } catch (e) {}
        // 嘗試擷取第一個陣列或物件
        const arr = t.match(/\[[\s\S]*\]/);
        if (arr) { try { return JSON.parse(arr[0]); } catch (e) {} }
        const obj = t.match(/\{[\s\S]*\}/);
        if (obj) { try { return JSON.parse(obj[0]); } catch (e) {} }
        return null;
      }

      /** AI 人物「姓名」規則：依背景類型補充提示，避免意象化／符號化取名 */
      function getCharacterNamingRules(setting = '') {
        const base = `「姓名」硬性規則（必遵守）：
- 必須是符合「背景設定」所屬時代、地域、文化的真實人名（真名或該時代常見姓名）；各角色姓名不可重複。
- 禁止用礦物、寶石、金屬、自然景物、天象、抽象意象、職業、地名、種族名、法寶／功法名當姓名。
- 禁止「琥珀·金砂」「鐵鏽·河床」「霓虹·零號」這類符號化、意象化或「A·B」「A·B·C」組合。
- 綽號、外號、代號、編號不可當全名；若故事需要，寫在個性或關係欄，不要放在 name。`;

        const s = String(setting || '').trim();
        if (!s) return base;

        const hints = [];
        // 自然／地貌類（高風險：AI 易用地名、礦物、景物當名）
        if (/沙漠|綠洲|火山|冰川|雨林|海溝|極地|島嶼|森林|洞穴|雪山|草原|沼澤|海洋|河流|裂谷|荒原|浮島|冰原|凍土|礁|懸崖|瀑布|溫泉|農場|莊園|民宿|小木屋/.test(s)) {
          hints.push('背景含自然或地理環境：姓名仍須是當地居民會用的真實人名，不可用地貌、氣候、動植物、礦產作為姓名。');
        }
        // 奇幻／仙俠／神魔
        if (/精靈|矮人|龍族|獸人|妖族|魔教|魔獸|仙人|神仙|神[殿明]|魔[教王]|亡靈|元素|吸血鬼|半獸|修仙|修真|靈山|洞天|劍冢|丹|符|陣|天庭|地府|龍宮|崑崙|蓬萊|武當|峨眉|少林|江湖|武林|鏢局|古武/.test(s)) {
          hints.push('奇幻／仙俠／武俠背景：用符合世界觀的人名（如中文「李慕白」「林婉清」、西方「Elena」「Roland」、日式「藤原」等），不可用種族名、門派名、法寶名、劍招名、地名當姓名。');
        }
        // 科幻／賽博／末世
        if (/科幻|賽博|霓虹|義體|黑客|人工智慧|AI|虛擬|基因|克隆|太空|殖民|軌道|星際|銀河|蟲洞|小行星|廢土|末世|輻射|喪屍|外星|量子|機械|蒸汽龐克/.test(s)) {
          hints.push('科幻／賽博／末世背景：用該時代合理的真實人名或音譯名（如「陳默」「Jack Morrison」「Yuki Tanaka」）；代號、型號只可作綽號，不可當 name 全名。');
        }
        // 歷史／近現代地域
        if (/民國|上海|租界|抗戰|延安|維多利亞|倫敦|工業革命|西部|淘金|二戰|冷戰|柏林|香港|台灣|唐朝|長安|汴京|明朝|清朝|戰國|三國|羅馬|埃及|希臘|維京|日本戰國|中世紀|騎士|蒙古|奧斯曼|拜占庭|波斯|印加|瑪雅|塞外|邊關|漕運|碼頭|拓荒/.test(s)) {
          hints.push('歷史／近現代背景：姓名須符合該時代、該地區的命名習慣（如民國上海可用「顧明遠」「蘇曼麗」；淘金熱可用「Jack O\'Brien」「陳大勇」；唐朝可用「李承乾」「王韞秀」）。');
        }
        // 現代都市／職場
        if (/都市|大都會|金融|企業|公司|學校|大學|醫院|律師|警察|法院|消防|軍事|監獄|診所|博物館|電競|直播|MCN|餐廳|咖啡|書店|便利|捷運|辦公|刑偵|法醫|急診|飛行|遠洋|消防/.test(s)) {
          hints.push('現代背景：用當代常見中文名、英文名或音譯名即可，避免把公司名、職稱、場所名直接當姓名。');
        }
        // 恐怖／怪談／異空間
        if (/詭異|怪談|鬧鬼|靈異|地獄|深淵|夢境|靈界|冥府|混沌|副本|輪迴|詛咒|無限樓層|異常|便利商店.*深夜|沒有出口/.test(s)) {
          hints.push('恐怖／怪談背景：角色仍須有真實姓名（如「張唯」「林曉安」）；恐怖感來自情節，不可把「幽魂」「裂口」等當正式姓名。');
        }
        // 海洋／航海
        if (/海賊|海妖|鯨船|浮城|貨輪|甲板|航海|海域|港口|碼頭/.test(s)) {
          hints.push('海洋／航海背景：可用水手、移民、港口居民常見人名；不可用「潮汐」「暗礁」「暴風」等當姓名。');
        }

        if (!hints.length) {
          hints.push('不論背景多奇幻，name 欄一律填真實人名，不可把背景關鍵詞拆字組合作為姓名。');
        }
        return base + '\n' + hints.map(h => '- ' + h).join('\n');
      }

      // 蒐集目前的故事脈絡，給角色生成提示用
      function collectStoryContext() {
        const theme = (themeSelect.value || '').trim();
        const setting = (settingSelect.value || '').trim();
        const style = (styleSelect.value || '').trim();
        const parts = [];
        if (theme) parts.push(`主題：${theme}`);
        if (setting) parts.push(`背景：${setting}`);
        if (style) parts.push(`風格：${style}`);
        // 帶入現有角色名單與定位，讓 AI 設計／補完時能與全體卡司協調分工
        const roster = [];
        charactersContainer.querySelectorAll('.character-row').forEach(row => {
          const name = (row.querySelector('.char-name').value || '').trim();
          const roleEl = row.querySelector('.char-role');
          const role = roleEl ? roleEl.value.trim() : '';
          if (name) roster.push(role ? `${name}（${role}）` : name);
        });
        if (roster.length) parts.push(`現有角色：${roster.join('、')}`);
        return parts.join('；') || '一般通俗小說';
      }

      // AI 生成整組人物
      if (aiGenerateCharactersBtn) {
        aiGenerateCharactersBtn.addEventListener('click', async () => {
          if (aiGenerateCharactersBtn.classList.contains('ai-loading')) return;
          // AI 設計依賴故事設定；若主題與背景都未填，先提醒會生成「通用」角色
          const hasTheme = !!(themeSelect.value && themeSelect.value.trim());
          const hasSetting = !!(settingSelect.value && settingSelect.value.trim());
          if (!hasTheme && !hasSetting) {
            const go = confirm('尚未設定「主題」與「背景設定」，AI 只能生成較通用、不一定貼合劇情的角色。\n\n建議先選好主題／背景再生成，效果會好很多。\n\n仍要直接生成通用角色嗎？');
            if (!go) {
              showStatus('info', '已取消；請先設定主題與背景，再用 ✨ AI 設計角色群');
              return;
            }
          }
          // 完整生成屬「覆蓋式」；若已有內容先確認，避免覆蓋使用者心血
          const rowsNow = Array.from(charactersContainer.children);
          const hasUserData = rowsNow.some(r =>
            (r.querySelector('.char-name') && r.querySelector('.char-name').value.trim()) ||
            (r.querySelector('.char-age') && r.querySelector('.char-age').value.trim()) ||
            (r.querySelector('.char-personality') && r.querySelector('.char-personality').value.trim()) ||
            (r.querySelector('.char-goal') && r.querySelector('.char-goal').value.trim()) ||
            (r.querySelector('.char-weakness') && r.querySelector('.char-weakness').value.trim()) ||
            (r.querySelector('.char-secret') && r.querySelector('.char-secret').value.trim()) ||
            (r.querySelector('.char-relation') && r.querySelector('.char-relation').value.trim())
          );
          if (hasUserData) {
            const ok = confirm(`「AI 設計角色群」會依劇情重新設計目前這 ${rowsNow.length} 位人物，並「覆蓋」已填寫的內容（生成後可再自行微調）。\n\n確定要覆蓋嗎？`);
            if (!ok) { showStatus('info', '已取消 AI 設計'); return; }
          }
          if (charactersContainer.children.length === 0) addCharacterRow(false);
          const countForPool = charactersContainer.children.length;
          const poolWarn = validateNamePoolForAi(countForPool);
          if (poolWarn && !confirm(poolWarn)) {
            showStatus('info', '已取消 AI 設計');
            return;
          }
          aiGenerateCharactersBtn.classList.add('ai-loading');
          aiGenerateCharactersBtn.disabled = true;
          // 立即給可見回饋（狀態列在頁面下方，捲動帶到視野中）
          showStatusInView('loading', '✨ AI 正在設計人物…');
          try {
            // 依「目前的人物列」數量，完整設計一組貼合劇情的角色（覆蓋式，供使用者微調）
            if (charactersContainer.children.length === 0) addCharacterRow(false);
            const rows = Array.from(charactersContainer.children);
            const count = rows.length;
            const existing = rows.map((row, i) => ({
              編號: i + 1,
              gender: row.querySelector('.char-gender').value,
              role: row.querySelector('.char-role') ? row.querySelector('.char-role').value.trim() : '',
              age: row.querySelector('.char-age').value.trim(),
              name: row.querySelector('.char-name').value.trim(),
              personality: row.querySelector('.char-personality').value.trim(),
              goal: row.querySelector('.char-goal').value.trim(),
              weakness: row.querySelector('.char-weakness').value.trim(),
              secret: row.querySelector('.char-secret').value.trim(),
              relation: row.querySelector('.char-relation').value.trim()
            }));
            // 已填內容只作為「設計方向」參考，不要求保留
            const hints = existing.filter(e => e.name || e.role || e.age || e.personality || e.goal || e.weakness || e.secret || e.relation);

            if (!navigator.onLine) { showStatusInView('error', '📴 離線模式下無法使用 AI 生成人物，請連接網路後再試'); return; }
            const ctx = collectStoryContext();
            const notes = getUserNotesText();
            const namePoolBlock = getNamePoolPromptBlockForCharacters(count);
            const castGuidance = getCharacterCastGuidanceBlock(notes);
            const notesBlock = getSupplementaryNotesBlock(notes);
            // 取名規則一律提供：清單名優先用，不足時 AI 依此規則自行取名
            const nameRules = getCharacterNamingRules(settingSelect.value);
            const hintBlock = hints.length
              ? `\n\n可參考使用者已提供的方向（盡量融入、保持協調，但以劇情合理為優先；可自由調整）：\n${JSON.stringify(hints, null, 0)}`
              : '';
            const prompt = `你是專業小說人物設計師。請依以下故事設定，「完整設計」剛好 ${count} 位人物，要彼此關聯、有戲劇張力且貼合劇情。請為角色群安排合理的「角色定位」：
- 至少要有 1 位主角（男主角或女主角），依劇情與補充說明而定，也可多位主角。
- 卡司性別依劇情與補充說明決定；若補充說明有明確限制（如全劇不可有某性別），必須嚴格遵守。
- 避免所有人都是主角，但配角／反派數量不限。
每位的所有欄位都要填寫完整、具體、避免空泛，讓使用者可直接使用並微調。
${castGuidance}
${notesBlock}
${nameRules}${namePoolBlock}${ctx}${hintBlock}

只回傳 JSON 陣列，長度必須剛好為 ${count}，不要任何說明文字。每個元素格式如下：
{"gender":"男/女/不明","role":"男主角/女主角/男配角/女配角/反派/路人 擇一","age":"數字或描述","name":"姓名（真實人名）","personality":"個性（具體，10~20字）","goal":"核心目標（具體）","weakness":"弱點/罩門","secret":"不可告人的祕密","relation":"與其他角色的關係（請點名其他角色）"}`;
            const resp = await callDeepSeek(prompt, null, modelSelect.value, { retries: 1 });
            const list = parseJsonFromText(resp);
            if (!Array.isArray(list) || list.length === 0) {
              showStatusInView('error', 'AI 回應格式無法解析，請再試一次');
              return;
            }
            // 覆蓋式套用：完整填入 AI 的設計（保留人物列數量），讓使用者在此基礎上微調
            rows.forEach((row, i) => {
              const item = list[i];
              if (item && typeof item === 'object') fillCharacterRow(row, item);
            });
            updateCharacterIndices();
            renderCharacterTabs();
            saveSettingsToLocal();
            showStatusInView('success', `✨ 已完整設計 ${count} 位貼合劇情的人物，可自由微調`);
          } catch (err) {
            const msg = (err && err.message ? err.message : String(err));
            const hint = /尚未設定|DEEPSEEK_API_KEY|金鑰/.test(msg)
              ? '；請管理員於後端 .env 設定 DEEPSEEK_API_KEY'
              : '';
            showStatusInView('error', 'AI 生成人物失敗：' + msg + hint);
          } finally {
            aiGenerateCharactersBtn.classList.remove('ai-loading');
            aiGenerateCharactersBtn.disabled = false;
          }
        });
      }

      // AI 補完單一人物列（保留已填欄位，只補空白）
      async function aiCompleteCharacterRow(row, btn) {
        if (!row) return;
        if (btn && btn.disabled) return;
        if (btn) { btn.disabled = true; btn.classList.add('ai-loading'); }
        showStatusInView('loading', '✨ AI 正在補完此人物…');
        try {
          if (!navigator.onLine) { showStatusInView('error', '📴 離線模式下無法使用 AI，請連接網路後再試'); return; }
          const ctx = collectStoryContext();
          const notes = getUserNotesText();
          const rowGender = row.querySelector('.char-gender').value;
          const needName = !row.querySelector('.char-name').value.trim();
          const namePoolBlock = needName ? getNamePoolPromptBlockForCharacters(1, rowGender) : '';
          const castGuidance = getCharacterCastGuidanceBlock(notes);
          const notesBlock = getSupplementaryNotesBlock(notes);
          // 取名規則一律提供：清單名優先用，不足或清單無合適名時 AI 依此規則自行取名
          const nameRules = getCharacterNamingRules(settingSelect.value);
          const cur = {
            gender: row.querySelector('.char-gender').value,
            role: row.querySelector('.char-role') ? row.querySelector('.char-role').value.trim() : '',
            age: row.querySelector('.char-age').value.trim(),
            name: row.querySelector('.char-name').value.trim(),
            personality: row.querySelector('.char-personality').value.trim(),
            goal: row.querySelector('.char-goal').value.trim(),
            weakness: row.querySelector('.char-weakness').value.trim(),
            secret: row.querySelector('.char-secret').value.trim(),
            relation: row.querySelector('.char-relation').value.trim()
          };
          const prompt = `你是小說人物設計師。故事設定：${ctx}。\n以下是一位人物目前的部分資料（空白欄位需要你補完，已有內容請盡量保留並使其協調）：\n${JSON.stringify(cur)}${castGuidance}\n${notesBlock}\n\n${nameRules}${namePoolBlock}\n\n只回傳單一 JSON 物件，格式：{"gender":"","role":"男主角/女主角/男配角/女配角/反派/路人 擇一","age":"","name":"姓名（真實人名）","personality":"","goal":"","weakness":"","secret":"","relation":""}`;
          const resp = await callDeepSeek(prompt, null, modelSelect.value, { retries: 1 });
          const data = parseJsonFromText(resp);
          if (!data || typeof data !== 'object') {
            showStatusInView('error', 'AI 回應無法解析，請再試一次');
            return;
          }
          const reconciled = reconcileCharacterWithNamePool(data);
          // 只補空白欄位
          const fillIfEmpty = (sel, val) => {
            const el = row.querySelector(sel);
            if (el && !el.value.trim() && val != null && String(val).trim()) {
              el.value = String(val).trim();
              el.title = el.value;
            }
          };
          fillIfEmpty('.char-gender', reconciled.gender);
          fillIfEmpty('.char-role', normalizeCharRole(reconciled.role, reconciled.gender || (row.querySelector('.char-gender') && row.querySelector('.char-gender').value)));
          fillIfEmpty('.char-age', reconciled.age);
          fillIfEmpty('.char-name', reconciled.name);
          fillIfEmpty('.char-personality', reconciled.personality);
          fillIfEmpty('.char-goal', reconciled.goal);
          fillIfEmpty('.char-weakness', reconciled.weakness);
          fillIfEmpty('.char-secret', reconciled.secret);
          fillIfEmpty('.char-relation', reconciled.relation);
          renderCharacterTabs();
          saveSettingsToLocal();
          showStatusInView('success', '✨ 已用 AI 補完此人物');
        } catch (err) {
          const msg = (err && err.message ? err.message : String(err));
          const hint = /尚未設定|DEEPSEEK_API_KEY|金鑰/.test(msg)
            ? '；請管理員設定 DEEPSEEK_API_KEY'
            : '';
          showStatusInView('error', 'AI 補完失敗：' + msg + hint);
        } finally {
          if (btn) { btn.disabled = false; btn.classList.remove('ai-loading'); }
        }
      }

      // 初次計算流程列狀態
      updateStepper();
      updateWorkspaceSummary();

      console.log('🎨 AI 小說工坊已載入完成！');
      console.log('💡 新功能：流程列、右側工具收合、AI 人物設計');
