/* ============================================================
   AI 小說工坊 — 應用程式邏輯
   （由 index.html 內嵌 <script> 抽離，採傳統 script 全域作用域）
   ============================================================ */

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
          navigator.serviceWorker.register('sw.js')
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
      const themes = [
        // ═══════ 【奇幻類】═══════
        '史詩奇幻','高等奇幻','黑暗奇幻','都市奇幻','輕奇幻','童話改編','神話傳說',
        '精靈與矮人','龍與魔法','魔法世界','勇者與魔王','魔王轉生','騎士傳說',
        '神獸契約','魔法少女','奇幻冒險','尋龍之旅','魔法師之路','王國興衰',
        // ═══════ 【仙俠武俠類】═══════
        '仙俠修真','玄幻修真','古裝武俠','現代修仙','洪荒流','神話修真',
        '江湖俠客','門派爭鬥','劍與情仇','飛升成仙','道法自然','武林至尊',
        '妖魔鬼怪','陰陽師','捉妖記','修魔大道','逆天改命','氣運之子',
        // ═══════ 【科幻類】═══════
        '硬科幻','軟科幻','太空歌劇','賽博龐克','蒸汽龐克','柴油龐克',
        '後啟示錄','人工智慧','時間旅行','外星文明','基因改造','虛擬實境',
        '機甲戰爭','星際戰爭','殖民星球','克隆人','意識上傳','量子世界',
        '近未來都市','反烏托邦','生化危機','納米科技','太空探索','第一次接觸',
        // ═══════ 【愛情類】═══════
        '浪漫愛情','甜蜜寵愛','虐戀情深','禁忌之戀','破鏡重圓','先婚後愛',
        '青梅竹馬','一見鍾情','日久生情','暗戀成真','歡喜冤家','辦公室戀情',
        '豪門恩怨','灰姑娘','霸道總裁','跨越時空的愛','異族之戀','人妖之戀',
        '婚後生活','甜蜜日常','雙向暗戀','契約戀愛','重生追愛','娛樂圈戀愛',
        // ═══════ 【懸疑推理類】═══════
        '本格推理','社會派推理','密室殺人','連環殺手','法庭攻防','警匪對決',
        '間諜諜戰','犯罪心理','冷案重啟','復仇計畫','完美犯罪','懸疑推理',
        '心理懸疑','反轉劇情','尋找真兇','神探破案','暗黑偵探','無罪推定',
        // ═══════ 【恐怖驚悚類】═══════
        '心理恐怖','靈異鬼怪','克蘇魯神話','都市怪談','詛咒傳說','鬼屋探險',
        '喪屍危機','邪教儀式','恐怖驚悚','民俗恐怖','校園怪談','醫院驚魂',
        '怪物獵人','深海恐懼','太空驚魂','末日求生','異形入侵','寄生獸',
        // ═══════ 【歷史類】═══════
        '歷史傳奇','宮廷鬥爭','後宮爭寵','戰國風雲','三國演義','楚漢爭霸',
        '民國風華','古代商戰','帝王將相','亂世英雄','歷史穿越','架空歷史',
        '抗戰風雲','諜戰風雲','科舉之路','盛世繁華','王朝覆滅','開國大業',
        // ═══════ 【現代都市類】═══════
        '現代都市','職場風雲','娛樂圈','體育競技','電競熱血','創業奮鬥',
        '校園青春','家庭倫理','社會寫實','網紅生活','直播人生','都市異能',
        '重生都市','商戰風雲','醫療職人','法律正義','教師人生','記者追蹤',
        // ═══════ 【軍事戰爭類】═══════
        '軍事戰爭','戰爭史詩','特種兵','傭兵生涯','軍旅生活','海軍艦隊',
        '空戰英雄','狙擊手','諜報人員','戰地醫護','戰爭與和平','未來戰爭',
        // ═══════ 【冒險探索類】═══════
        '海洋冒險','西部拓荒','北歐維京','探險尋寶','荒野求生','登山探險',
        '叢林探險','沙漠之旅','極地冒險','地心探索','空島冒險','異世界探險',
        // ═══════ 【生活職業類】═══════
        '美食料理','甜點烘焙','音樂夢想','繪畫人生','舞蹈青春','攝影故事',
        '寵物情緣','園藝生活','手工藝人','書店日常','咖啡廳物語','花店故事',
        // ═══════ 【特殊題材類】═══════
        '末世廢土','異能覺醒','系統流','無限流','副本遊戲','直播求生',
        '規則怪談','詭異遊戲','靈氣復甦','諸天萬界','快穿系統','綜漫同人',
        '異世界轉生','重生復仇','重生經商','重生娛樂圈','空間種田','隨身老爺爺',
        // ═══════ 【年代/懷舊類】═══════
        '年代生活','八零年代','九零年代','千禧校園','老上海往事','眷村歲月',
        '改革開放浪潮','下海經商','知青歲月','工廠青春','票證年代','大院子弟',
        // ═══════ 【諜戰/特工類】═══════
        '冷戰諜影','反間諜戰','地下情報網','潛伏敵營','密碼破譯','雙面間諜',
        '特工歸來','情報販子','叛逃與追緝','黑色行動',
        // ═══════ 【機甲/星際細分】═══════
        '機甲格鬥','駕駛員之魂','星艦艦長','星際傭兵','銀河開拓','戴森球建造',
        '宇宙文明','蟲族戰爭','星海殖民','曲速遠征',
        // ═══════ 【克蘇魯/詭秘類】═══════
        '舊日支配者','瘋狂山脈','深潛者傳說','非歐幾何','污染與瘋狂','禁忌知識',
        'SCP收容','異常檔案','詭秘規則','怪奇調查局',
        // ═══════ 【轉生變身類】═══════
        '轉生史萊姆','轉生成劍','轉生成龍','轉生成魔王','轉生成幽靈','轉生成NPC',
        '最弱職業逆襲','被廢除的勇者','解雇後封神','轉生反派千金',
        // ═══════ 【地下城/迷宮類】═══════
        '地下城經營','迷宮主','成為迷宮BOSS','探索者公會','地城討伐','深層攻略',
        // ═══════ 【經營建設類】═══════
        '基地建設','王國經營','商業帝國','餐廳經營','旅館經營','莊園領主',
        '科技樹點滿','資源帝國','城邦崛起',
        // ═══════ 【特殊融合類】═══════
        '料理修仙','賽博修真','機械飛升','靈氣復甦現代','末世種田','廢土綠洲',
        '大海賊時代','海賊王座','聊齋志異','山海奇譚','神怪志異','劍與魔法',
        // ═══════ 【無限/輪迴類】═══════
        '無限恐怖','輪迴樂園','主神空間','副本輪迴','死亡輪迴','詛咒輪迴',
        // ═══════ 【現代職人細分】═══════
        '刑偵重案','法醫筆記','消防英雄','急診風雲','飛行員之路','遠洋船員',
        '荒野直播','靈異直播','寵物醫生','米其林之路'
      ];
      
      const settingsData = [
        // ═══════ 【奇幻世界】═══════
        '虛構的中世紀王國','精靈族的森林國度','矮人的地底城市','龍族盤據的火山島',
        '魔法師的浮空塔','被詛咒的黑暗森林','神聖的光明神殿','亡靈橫行的荒原',
        '海妖出沒的神秘海域','隱藏在迷霧中的仙境','魔法公會總部','冒險者協會',
        '魔獸橫行的危險地帶','古老的魔法遺跡','封印邪神的聖地','龍騎士的訓練場',
        '精靈女王的宮殿','獸人部落的營地','半獸人的邊境要塞','魔法結界保護的學院',
        // ═══════ 【仙俠修真世界】═══════
        '修仙門派的靈山','洞天福地','魔教總壇','妖族領地','靈獸森林',
        '仙人洞府','煉丹閣','藏經閣','劍冢','雷劫渡劫之地',
        '凡人修仙界','上古戰場遺跡','秘境入口','仙魔戰場','輪迴之地',
        '天庭凌霄殿','地府閻羅殿','龍宮','蓬萊仙島','崑崙仙境',
        // ═══════ 【古代中國】═══════
        '皇宮紫禁城','王府深宅','江南水鄉','邊塞關隘','絲路古道',
        '唐朝長安城','宋代繁華汴京','明朝江南','清朝京城','戰國時代的城池',
        '三國時期的戰場','科舉考場','青樓楚館','客棧茶樓','鏢局總部',
        '武林盟主的莊園','隱世村落','少林寺','武當山','峨眉金頂',
        // ═══════ 【古代其他】═══════
        '古羅馬競技場','埃及法老王宮','希臘神殿','維京海盜船','日本戰國城堡',
        '中世紀歐洲城堡','騎士團要塞','阿拉伯宮殿','瑪雅神廟','印加帝國',
        '波斯帝國','拜占庭皇宮','蒙古大草原','奧斯曼帝國','中世紀修道院',
        // ═══════ 【近現代歷史】═══════
        '民國時期的上海灘','十里洋場','租界區','抗戰時期的重慶','延安窯洞',
        '維多利亞時代的倫敦','工業革命的工廠','美國西部荒野','淘金熱時代',
        '二戰時期的歐洲戰場','冷戰時期的柏林','六七十年代的香港','八九十年代的台灣',
        // ═══════ 【現代都市】═══════
        '繁華的現代大都會','國際金融中心','頂級跨國企業總部','創業孵化器',
        '時尚雜誌社','電視台演播廳','電影拍攝現場','娛樂公司練習室',
        '高級私人會所','地下拳場','酒吧夜店','高檔餐廳','米其林廚房',
        '私立貴族學校','普通高中校園','大學城','研究所實驗室','醫學院附屬醫院',
        // ═══════ 【職業場所】═══════
        '忙碌的三甲醫院','律師事務所','警察局刑偵隊','法院審判庭','檢察院',
        '消防局','軍事基地','特種部隊訓練營','情報機構總部','監獄',
        '精神病院','心理診所','殯儀館','考古現場','博物館',
        // ═══════ 【科幻世界】═══════
        '近未來的高科技城市','賽博龐克的霓虹都市','人工智慧統治的城市',
        '遙遠的太空殖民地','宇宙戰艦內部','太空站','火星殖民基地','月球基地',
        '海底都市','虛擬實境世界','量子電腦核心','基因改造實驗室',
        '反烏托邦的監控城市','廢土末世','喪屍肆虐的城市','外星人飛船內部',
        '環形世界','戴森球','星際貿易站','銀河聯邦議會','克隆人培育中心',
        // ═══════ 【異世界/異空間】═══════
        '平行宇宙','異次元空間','夢境世界','靈界與冥府','天界與仙境',
        '地獄深淵','時間裂縫之中','量子疊加的世界','遊戲副本空間','諸神的領域',
        '意識空間','虛數空間','混沌之海','創世之初','世界盡頭',
        // ═══════ 【自然環境】═══════
        '與世隔絕的孤島','永夜的極地','沙漠中的綠洲','漂浮在空中的島嶼',
        '地下深處的洞穴','活火山口','冰封的古城','被遺忘的古文明遺跡',
        '熱帶雨林深處','神秘的百慕達','馬里亞納海溝','喜馬拉雅之巔',
        '亞馬遜叢林','撒哈拉沙漠','南極冰原','北極凍土','大堡礁',
        // ═══════ 【日常溫馨場所】═══════
        '溫馨的咖啡廳','老舊的書店','神秘的古董店','熱鬧的遊樂園',
        '安靜的圖書館','溫暖的麵包店','文藝的花店','治癒的寵物店',
        '復古的唱片行','手作工作室','社區活動中心','屋頂天台',
        '海邊小木屋','山間民宿','鄉村農場','葡萄酒莊園','溫泉旅館',
        // ═══════ 【特殊建築】═══════
        '魔法學院','蒸汽龐克城市','空中花園','海底宮殿','樹屋村落',
        '移動城堡','機械巨獸內部','諾亞方舟','通天塔','地下城市',
        '廢棄的主題樂園','鬧鬼的老宅','廢棄的精神病院','地下實驗室','祕密基地',
        // ═══════ 【電競/直播】═══════
        '電競戰隊基地','職業選手宿舍','大型電競館','個人直播間','MCN經紀公司','遊戲開發工作室',
        // ═══════ 【深空/軌道】═══════
        '軌道都市','太空電梯','深空殖民艦','曲速戰艦','星際蟲洞站','小行星礦場','軌道環居住區',
        // ═══════ 【賽博空間】═══════
        '賽博貧民窟','義體改造診所','黑客地下室','巨型企業摩天樓','霓虹紅燈區','地下黑市',
        // ═══════ 【現代修真】═══════
        '靈氣復甦的現代都市','都市修真坊市','隱世宗門入口','地脈龍穴','古武世家祖宅',
        // ═══════ 【末世廢土】═══════
        '廢土綠洲城邦','地下輻射避難所','末世安全屋','喪屍圍城的商場','末世資源回收站',
        // ═══════ 【海上/空中】═══════
        '海上浮城','移動的鯨船','雲端浮島都市','深海實驗艙','空中纜車列車',
        // ═══════ 【規則怪談】═══════
        '詭異的無限樓層','循環的末班捷運','沒有出口的旅館','深夜的便利商店','異常的老舊公寓',
        // ═══════ 【職人場所】═══════
        '刑警重案隊辦公室','法醫解剖室','消防分隊','急診搶救室','遠洋貨輪甲板','飛機駕駛艙',
        // ═══════ 【日常經營】═══════
        '街角小餐館','轉角咖啡店','獨立二手書店','深夜食堂','鄉間民宿小院','邊境拓荒村',
        // ═══════ 【古代細分】═══════
        '塞外草原王庭','江湖客棧','漕運碼頭','邊關軍鎮','清修道觀','深山佛寺禪院',
        // ═══════ 【奇幻細分】═══════
        '冒險者酒館','地下城入口','巨龍的巢穴','世界樹之下','元素交匯位面','亡靈墓園'
      ];
      
      const stylesArr = [
        // ═══════ 【情感基調】═══════
        '溫馨治癒','甜蜜浪漫','輕鬆幽默','青春活力','熱血燃情',
        '感人催淚','虐心糾結','悲傷哀婉','沉重壓抑','黑暗絕望',
        '溫柔細膩','清新淡雅','詩意唯美','勵志向上','正能量',
        // ═══════ 【氛圍風格】═══════
        '神秘詭異','懸疑緊張','驚悚恐怖','陰森詭譎','荒誕離奇',
        '史詩壯闘','大氣磅礴','恢弘壯麗','莊嚴肅穆','蒼涼悲壯',
        '明亮歡快','俏皮可愛','夢幻迷離','空靈縹緲','禪意悠遠',
        // ═══════ 【敘事風格】═══════
        '細膩描寫','白描手法','意識流','蒙太奇','碎片化敘事',
        '多線並進','雙線交織','環形敘事','倒敘插敘','非線性敘事',
        '第一人稱','第三人稱限知','全知視角','多視角切換','書信體',
        // ═══════ 【節奏風格】═══════
        '快節奏爽文','緊湊刺激','高潮迭起','一氣呵成',
        '慢熱鋪陳','娓娓道來','循序漸進','細水長流',
        '張弛有度','跌宕起伏','平鋪直敘','留白想像',
        // ═══════ 【文學風格】═══════
        '古典優雅','華麗繁複','簡約留白','粗獷豪放',
        '現實主義','魔幻現實','超現實主義','象徵主義',
        '黑色幽默','辛辣諷刺','批判現實','哲理思辨',
        '抒情散文','詩化語言','口語化','文白夾雜',
        // ═══════ 【類型風格】═══════
        '輕小說風','網文爽文','純文學','嚴肅文學',
        '文藝清新','都市輕熟','職場精英','校園純愛',
        '古言典雅','現言都市','甜寵溺愛','BE美學',
        '硬核寫實','軟糯治癒','中二熱血','腹黑搞笑',
        // ═══════ 【特殊風格】═══════
        '新武俠','傳統武俠','仙俠飄逸','玄幻熱血',
        '硬科幻','軟科幻','賽博龐克','蒸汽龐克',
        '哥特風','暗黑系','克蘇魯','民俗風',
        '日系輕小說','韓式甜劇','美劇節奏','英劇質感',
        // ═══════ 【情緒導向】═══════
        '爽點密集','打臉爽文','逆襲翻盤','裝逼打臉',
        '細膩情感','慢熱暗戀','情感糾葛','人性探討',
        '腦洞大開','無厘頭','鬼畜搞笑','溫馨日常',
        // ═══════ 【結構與筆法】═══════
        '群像史詩','偽紀錄片風','新聞報導體','設定流硬核','志怪筆記體','史官紀傳體',
        '寓言體','實驗文體','多媒體拼貼','彈幕吐槽風','遊戲化敘述','單元劇式',
        // ═══════ 【類型筆觸】═══════
        '克系冷硬','軍武硬核','廢土荒涼','規則驚悚','SCP檔案風','賽博冷硬',
        '蒸汽復古','黑色電影風','公路電影感','偵探冷硬派',
        // ═══════ 【東方美學】═══════
        '武俠寫意','東方水墨','古韻雅緻','禪意留白','江湖快意',
        // ═══════ 【輕鬆向】═══════
        '宅向吐槽','日常流水帳治癒','種田慢綜','爽感無敵流','沙雕歡樂'
      ];
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

      // 特殊元素（分類）
      const specialElementCategories = [
        {
          name: '系統機制',
          icon: '⚙️',
          items: [
            { id: 'system', icon: '📊', label: '系統/面板' },
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
            { id: 'transmigration', icon: '🔄', label: '穿越異世界' },
            { id: 'rebirth', icon: '🌅', label: '重生回溯' },
            { id: 'timeLoop', icon: '⏰', label: '時間輪迴' },
            { id: 'gameWorld', icon: '🎮', label: '穿越遊戲' },
            { id: 'bookWorld', icon: '📖', label: '穿書/穿劇' },
            { id: 'soulSwap', icon: '👻', label: '靈魂互換' },
            { id: 'regression', icon: '⏪', label: '回檔重來' },
            { id: 'parallel', icon: '🌐', label: '平行世界' },
            { id: 'dream', icon: '💭', label: '夢境穿越' },
            { id: 'death', icon: '💀', label: '死後轉生' },
            { id: 'summon', icon: '🌀', label: '被召喚' },
            { id: 'possession', icon: '👤', label: '奪舍附身' },
            { id: 'infant', icon: '👒', label: '胎穿/幼年' },
            { id: 'npc', icon: '🤖', label: '穿成NPC' },
            { id: 'mob', icon: '👾', label: '穿成炮灰' },
            { id: 'future', icon: '🚀', label: '未來穿越' },
            { id: 'villain-cross', icon: '😈', label: '穿成反派' },
            { id: 'cannon-fodder', icon: '💥', label: '穿成炮灰女配' },
            { id: 'quick-transmig', icon: '⚡', label: '快穿任務' },
            { id: 'world-hopping', icon: '🌍', label: '無限流' },
          ]
        },
        {
          name: '感情線',
          icon: '💕',
          items: [
            { id: 'romance', icon: '💕', label: '戀愛線' },
            { id: 'harem', icon: '👥', label: '後宮/逆後宮' },
            { id: 'slowBurn', icon: '🔥', label: '慢熱戀愛' },
            { id: 'enemies', icon: '⚔️💕', label: '歡喜冤家' },
            { id: 'arranged', icon: '💍', label: '契約婚姻' },
            { id: 'unrequited', icon: '💔', label: '暗戀/單戀' },
            { id: 'reunion', icon: '🤝', label: '破鏡重圓' },
            { id: 'forbidden', icon: '🚫💕', label: '禁忌之戀' },
            { id: 'childhood', icon: '💒', label: '青梅竹馬' },
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
            { id: 'invincible', icon: '💪', label: '無敵流' },
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
            { id: 'revenge', icon: '🗡️', label: '復仇主線' },
            { id: 'conspiracy', icon: '🕸️', label: '陰謀詭計' },
            { id: 'puzzle', icon: '🧩', label: '解謎探險' },
            { id: 'mystery', icon: '🔮', label: '神秘力量' },
            { id: 'prophecy', icon: '📜', label: '預言/天命' },
            { id: 'secret', icon: '🤫', label: '身世之謎' },
            { id: 'betrayal', icon: '🗡️', label: '背叛反轉' },
            { id: 'redemption', icon: '🕊️', label: '救贖' },
            { id: 'faceSlap', icon: '👋', label: '打臉爽文' },
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
            { id: 'martial', icon: '🥋', label: '武功修煉' },
            { id: 'cultivation', icon: '☯️', label: '仙俠修真' },
            { id: 'technology', icon: '🤖', label: '科技未來' },
            { id: 'steampunk', icon: '⚙️', label: '蒸汽龐克' },
            { id: 'cyberpunk', icon: '🌃', label: '賽博龐克' },
            { id: 'apocalypse', icon: '☠️', label: '末日廢土' },
            { id: 'zombie', icon: '🧟', label: '喪屍末日' },
            { id: 'multiverse', icon: '🌌', label: '多元宇宙' },
            { id: 'virtual', icon: '🥽', label: '虛擬實境' },
            { id: 'western', icon: '🏰', label: '西方奇幻' },
            { id: 'eastern', icon: '🏯', label: '東方玄幻' },
            { id: 'urban', icon: '🌃', label: '都市異能' },
            { id: 'prehistoric', icon: '🦕', label: '洪荒遠古' },
            { id: 'myth', icon: '⚡', label: '神話體系' },
            { id: 'demon', icon: '👹', label: '妖魔鬼怪' },
            { id: 'mecha', icon: '🤖', label: '機甲科幻' },
            { id: 'hybrid', icon: '🔀', label: '混合世界觀' },
            { id: 'cthulhu', icon: '🐙', label: '克蘇魯神話' },
            { id: 'gothic', icon: '🦇', label: '哥特式黑暗' },
            { id: 'fairy', icon: '🧚', label: '童話世界' },
            { id: 'spirit', icon: '👻', label: '靈異世界' },
          ]
        },
        {
          name: '場景設定',
          icon: '🏛️',
          items: [
            { id: 'school', icon: '🏫', label: '學院/門派' },
            { id: 'dungeon', icon: '🏰', label: '副本/迷宮' },
            { id: 'kingdom', icon: '👑', label: '王國建設' },
            { id: 'tower', icon: '🗼', label: '爬塔/登頂' },
            { id: 'guild', icon: '🏠', label: '公會經營' },
            { id: 'arena', icon: '🏟️', label: '競技場' },
            { id: 'auction', icon: '🔨', label: '拍賣會' },
            { id: 'secretRealm', icon: '🌀', label: '秘境探索' },
            { id: 'palace', icon: '🏯', label: '皇宮後宮' },
            { id: 'sect', icon: '⛩️', label: '宗門大派' },
            { id: 'city', icon: '🌆', label: '都市叢林' },
            { id: 'village', icon: '🏘️', label: '鄉村小鎮' },
            { id: 'forest', icon: '🌲', label: '森林荒野' },
            { id: 'ocean', icon: '🌊', label: '海洋冒險' },
            { id: 'sky', icon: '☁️', label: '天空浮島' },
            { id: 'underground', icon: '🕳️', label: '地下世界' },
            { id: 'space-station', icon: '🛸', label: '太空站' },
            { id: 'ancient-ruins', icon: '🏚️', label: '古代遺跡' },
            { id: 'military-base', icon: '🎖️', label: '軍事基地' },
            { id: 'hospital', icon: '🏥', label: '醫院診所' },
            { id: 'prison', icon: '🔒', label: '監獄囚籠' },
            { id: 'casino', icon: '🎰', label: '賭場娛樂城' },
          ]
        },
        {
          name: '生活元素',
          icon: '🏡',
          items: [
            { id: 'farming', icon: '🌾', label: '種田/經營' },
            { id: 'food', icon: '🍜', label: '美食描寫' },
            { id: 'pet', icon: '🐾', label: '寵物/靈獸' },
            { id: 'craft', icon: '🔨', label: '鍛造/煉丹' },
            { id: 'healing', icon: '🌿', label: '治癒日常' },
            { id: 'travel', icon: '🗺️', label: '旅行冒險' },
            { id: 'collection', icon: '📦', label: '收集癖' },
            { id: 'decoration', icon: '🏠', label: '裝飾佈置' },
            { id: 'music', icon: '🎵', label: '音樂藝術' },
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
            { id: 'streaming', icon: '📺', label: '直播/網紅' },
          ]
        },
        {
          name: '競爭對抗',
          icon: '⚔️',
          items: [
            { id: 'faction', icon: '⚔️', label: '陣營對立' },
            { id: 'competition', icon: '🏆', label: '比賽競技' },
            { id: 'military', icon: '🎖️', label: '軍事戰爭' },
            { id: 'politics', icon: '🏛️', label: '權謀政治' },
            { id: 'family', icon: '👨‍👩‍👧', label: '家族興衰' },
            { id: 'trade', icon: '💰', label: '商戰經商' },
            { id: 'heist', icon: '🎭', label: '盜賊詐騙' },
            { id: 'survival', icon: '🏕️', label: '生存淘汰' },
            { id: 'ranking', icon: '📊', label: '排行榜戰' },
            { id: 'territory', icon: '🗺️', label: '地盤爭奪' },
            { id: 'resources', icon: '⛏️', label: '資源掠奪' },
            { id: 'throne', icon: '👑', label: '奪嫡爭位' },
            { id: 'exam', icon: '📝', label: '考試科舉' },
            { id: 'spy', icon: '🕵️', label: '間諜潛伏' },
            { id: 'assassination', icon: '🗡️', label: '刺殺暗殺' },
            { id: 'rebellion', icon: '✊', label: '起義造反' },
            { id: 'court-intrigue', icon: '🏯', label: '宮廷鬥爭' },
            { id: 'gang-war', icon: '🔫', label: '黑幫火拼' },
            { id: 'esports', icon: '🎮', label: '電競對決' },
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
            { id: 'ai', icon: '🤖', label: 'AI/人工智慧' },
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
          ]
        },
        {
          name: '現代職場',
          icon: '🏢',
          items: [
            { id: 'ceo', icon: '👔', label: '霸道總裁' },
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
            { id: 'death-game', icon: '☠️', label: '死亡遊戲' },
            { id: 'battle-royale', icon: '🏆', label: '大逃殺' },
            { id: 'deserted-island', icon: '🏝️', label: '荒島求生' },
            { id: 'haunted-house', icon: '👻', label: '鬼屋探險' },
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
            { id: 'apocalypse-survival', icon: '🌋', label: '末日生存' },
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
          ]
        },
        {
          name: '經營養成',
          icon: '🏗️',
          items: [
            { id: 'base-building', icon: '🏰', label: '基地建設' },
            { id: 'recruit', icon: '🤝', label: '招募人才' },
            { id: 'tech-tree', icon: '🌳', label: '科技樹' },
            { id: 'internal-affairs', icon: '📜', label: '內政經營' },
            { id: 'diplomacy', icon: '🕊️', label: '外交結盟' },
            { id: 'reputation', icon: '⭐', label: '聲望系統' },
            { id: 'territory-expand', icon: '🗺️', label: '領土擴張' },
            { id: 'resource-mgmt', icon: '⛏️', label: '資源管理' },
            { id: 'train-successor', icon: '🎓', label: '培養接班' },
            { id: 'gather-talent', icon: '🌟', label: '廣納賢才' },
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
          ]
        }
      ];
      
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
              <option value="配角">配角</option>
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
- 清單只有 ${pool.length} 個名字；若人物數多於清單，用完後其餘人物再依上述「姓名硬性規則」自行取合適的真實人名（不要重複清單已用過的名字）。`;
      }

      /** 正文／續寫用：角色姓名優先取自使用者清單池，不足者由 AI 依取名規則自行命名 */
      function getNamePoolStoryBlock(setting = '') {
        const pool = getSelectedNamePool();
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
        return `【姓名清單與取名規則（★必須遵守★）】
使用者指定的「優先姓名清單」（共 ${pool.length} 個；清單順序已打亂，僅供參考）：
${lines.join('\n')}
• 已在【登場人物】指定姓名的角色，沿用其既有姓名。
• 其餘需要命名的角色，請「優先」依性別從上述清單挑選（不可改字、不可重複使用同一個名字）。
• 不必依清單列出的順序使用；可任意打亂配對，以角色性別、身分與劇情需要為準。
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

      function saveSettingsToLocal() {
        try {
          // 收集已選擇的特殊元素
          const selectedElements = [];
          specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
            selectedElements.push(item.dataset.id);
          });

          const settings = {
            theme: themeSelect.value,
            setting: settingSelect.value,
            style: styleSelect.value,
            chapters: chaptersInput.value,
            length: lengthInput.value,
            notes: notesInput.value,
            // 進階設定
            narrative: narrativeSelect.value,
            era: eraSelect.value,
            pacing: pacingSelect.value,
            rating: ratingSelect.value,
            worldComplexity: worldComplexitySelect.value,
            emotionalTone: emotionalToneSelect.value,
            ending: endingSelect.value,
            specialElements: selectedElements,
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
        } catch (e) {
          console.warn('無法儲存設定：', e);
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
          if (settings.notes) { notesInput.value = settings.notes; hasData = true; }

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

          if (settings.customNamePool && Array.isArray(settings.customNamePool)) {
            customNamePool = normalizeCustomNamePool(settings.customNamePool);
            hasData = true;
          }
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
                setVal('.char-role', char.role);
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
      
      // 動態生成下拉選單選項
      function populateSelectOptions() {
        // 主題選項
        themes.forEach(theme => {
          const option = document.createElement('option');
          option.value = theme;
          option.textContent = theme;
          themeSelect.appendChild(option);
        });
        
        // 背景設定選項
        settingsData.forEach(setting => {
          const option = document.createElement('option');
          option.value = setting;
          option.textContent = setting;
          settingSelect.appendChild(option);
        });
        
        // 風格選項
        stylesArr.forEach(style => {
          const option = document.createElement('option');
          option.value = style;
          option.textContent = style;
          styleSelect.appendChild(option);
        });

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
        const categoryTabs = document.getElementById('elementCategoryTabs');
        const elementSearch = document.getElementById('elementSearch');
        const clearElementsBtn = document.getElementById('clearElementsBtn');
        const selectedCountSpan = document.getElementById('selectedCount');
        let currentCategory = 'all';
        let lastDramaIds = [];
        
        // 更新已選數量
        function updateSelectedCount() {
          const count = specialElementsContainer.querySelectorAll('.special-element-item.selected').length;
          selectedCountSpan.textContent = `已選 ${count} 項`;
        }
        
        // 渲染分類標籤
        function renderCategoryTabs() {
          categoryTabs.innerHTML = '';
          
          // 全部標籤
          const allTab = document.createElement('button');
          allTab.type = 'button';
          allTab.className = 'category-tab active';
          allTab.dataset.category = 'all';
          allTab.innerHTML = `<span>📋</span> 全部 <span class="tab-count">${specialElements.length}</span>`;
          allTab.addEventListener('click', () => selectCategory('all'));
          categoryTabs.appendChild(allTab);
          
          // 各分類標籤
          specialElementCategories.forEach(cat => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'category-tab';
            tab.dataset.category = cat.name;
            tab.innerHTML = `<span>${cat.icon}</span> ${cat.name} <span class="tab-count">${cat.items.length}</span>`;
            tab.addEventListener('click', () => selectCategory(cat.name));
            categoryTabs.appendChild(tab);
          });
        }
        
        // 選擇分類
        function selectCategory(category) {
          currentCategory = category;
          
          // 更新標籤樣式
          categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
          });
          
          // 過濾顯示
          filterElements();
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
            dramaResult.innerHTML = '<span class="drama-result-label">本次抽中：</span>' +
              labels.map(l => `<span class="drama-chip">${l}</span>`).join('');
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
              dramaResult.innerHTML = '<span class="drama-result-label">本次抽中：</span>' +
                labels.map(l => `<span class="drama-chip">${l}</span>`).join('');
              dramaResult.style.display = 'flex';
            }
          }
        })();

        // ===== 特殊元素面板收合 =====
        const sePanel = document.getElementById('specialElementsPanel');
        const seToggle = document.getElementById('specialElementsToggle');
        if (sePanel && seToggle) {
          const collapsed = localStorage.getItem('specialElementsCollapsed') === '1';
          if (collapsed) {
            sePanel.classList.add('collapsed');
            seToggle.setAttribute('aria-expanded', 'false');
          }
          seToggle.addEventListener('click', () => {
            const isCollapsed = sePanel.classList.toggle('collapsed');
            seToggle.setAttribute('aria-expanded', String(!isCollapsed));
            localStorage.setItem('specialElementsCollapsed', isCollapsed ? '1' : '0');
          });
        }
        
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
      })();

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
        const notes = notesInput.value.trim();
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
        // 前集摘要（第 2 集起作為 context，本集正文不接前集，見錯誤4）
        let prevVolumeContext = '';
        if (generatingNextVolume && storySeries && volumeIndex > 0) {
          const prev = storySeries.volumes[volumeIndex - 1];
          if (prev && prev.content) {
            const summary = prev.content.slice(-15000);
            prevVolumeContext = `\n\n═══════════════════════════════════════\n【前集劇情回顧（${getVolumeLabel(volumeIndex - 1, seriesTotal)}，僅供銜接，勿複製進本集正文）】\n═══════════════════════════════════════\n\n${summary}\n`;
          }
        }
        
        // 收集特殊元素
        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          const label = item.querySelector('.element-label').textContent;
          selectedElements.push(label);
        });

        const hasAdvanced = narrative || era || pacing || rating || worldComplexity || emotionalTone || ending;
        if (!theme && !setting && !charactersInfo && !style && !chapters && !length && !notes && selectedElements.length === 0 && !hasAdvanced) {
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
        
        // ===== 補充說明區 =====
        if (notes) {
          prompt += `【補充說明】\n${notes}\n\n`;
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
        const shouldGenerateChapterByChapter = targetChapterCount >= 3; // 3章以上採用逐章生成

        // 結局指令（與章節數解耦：有選結局就注入，見錯誤6/7）
        // 逐章（≥3）首章用 setup；一次性（≤2 或未填）整篇產出用 final 兩段式
        const endingPhaseForGenerate = shouldGenerateChapterByChapter ? 'setup' : 'final';
        const endingDirective = getEndingDirective(ending, endingPhaseForGenerate, { isSeriesVolume: isSeries, isFinalVolume });

        // 系列書名指令（集數≥2 一開始就把集別寫進書名，見 series-title）
        let seriesTitleDirective = '';
        if (isSeries) {
          if (volumeIndex === 0) {
            seriesTitleDirective = `\n• ★【系列書名】本作為共 ${seriesTotal} 集的系列；請在全文最開頭獨立一行輸出書名行「# 《書名》（${volumeLabel}）」，書名後務必加上「（${volumeLabel}）」標註；之後章節請勿重複輸出書名行`;
          } else {
            const baseTitle = storySeries && storySeries.seriesTitle ? `《${storySeries.seriesTitle}》` : '《（沿用前集書名）》';
            seriesTitleDirective = `\n• ★【系列書名】本集為系列第 ${volumeIndex + 1} 集；請在全文最開頭獨立一行輸出書名行「# ${baseTitle}（${volumeLabel}）」（沿用前集書名，僅更換集別標註）；之後章節請勿重複輸出書名行`;
          }
        }
        
        if (chapters) {
          if (shouldGenerateChapterByChapter) {
            // 逐章生成模式：只生成第一章
            chapterEndingHint = `
• ⚠️【重要】故事總共 ${chapters} 章，本次只需生成【第1章】（或序章）
• ${chapter1WordReq.replace(/^•\s*/, '')}
• 第1章要有完整的故事開頭，建立世界觀、展開初始情節${mainNames.length > 0 ? `，並讓主要角色（${mainNames.join('、')}）登場` : '，介紹主要角色'}${secondaryNames.length > 0 ? `\n• 配角（${secondaryNames.join('、')}）不必在第1章全部登場，可於後續章節再自然引入` : ''}
• 第1章結尾要有懸念或轉折，為後續章節做鋪墊
• 不要生成第2章及之後的內容，只寫第1章即可
• 章節標題格式：### 第1章：標題（或 ### 序章：標題）`;
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
        
        prompt += prevVolumeContext;
        prompt += `
═══════════════════════════════════════
【創作執行指令】
═══════════════════════════════════════

請以上述大師級水準，依循所有設定開始創作。執行要點：

◆ 敘事品質 ◆
• 開篇即入戲：以動作、對話或懸念開場，三句話內抓住讀者
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
        let result = await doContinueGeneration(opts);
        if (result.aborted || !result.ok) return result;
        if (!result.truncated && !isCurrentChapterUnderTarget(plan, latestStory)) return result;

        showStatus('loading', '📝 篇幅較長，自動接續未完成段落…');
        let remaining = maxResume;
        while (remaining-- > 0 && !userAborted && !seriesAborted) {
          if (!result.truncated && !isCurrentChapterUnderTarget(plan, latestStory)) break;
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
          const currentChapters = countChapters(latestStory);
          const remaining = targetChapters - currentChapters;

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
            remainingChaptersHint += getEndingDirective(endingForCont, endingPhase, volEndOpts);
          }

          // 自動／逐章模式：明確指定下一章編號，降低跳章或重複標題
          if (!isAlreadyComplete && remaining > 0) {
            const nextCh = currentChapters + 1;
            remainingChaptersHint += `
• ⚠️【本章任務】請接續上一章，撰寫【第 ${nextCh} 章】；章節標題必須為 ### 第${nextCh}章：標題（不可跳號、不可重複上一章標題）`;
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
          const chNow = Math.max(1, countChapters(latestStory));
          truncatedResumeHint = `
• ⚠️【截斷接續】上一段因輸出長度上限被截斷，請從上文最末處直接接續
• 禁止重複已寫過的句子或段落，不要重述上一段結尾
• 若第 ${chNow} 章尚未寫完，先接續完成本章；本章已完整才可開始下一章`;
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
• 如上章未完，先妥善收尾；新章節需有引人入勝的開場
• 章節標題格式：### 第X章：標題
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
              latestStory = baseStory + '\n\n' + continuation;
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
        return isEndingSatisfied(latestStory, ending, { isSeriesVolume: seriesVol, isFinalVolume: finalVol });
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
            if (targetCount > 0 && before >= targetCount) break;
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
          while (!userAborted && !seriesAborted && epi++ < 3 &&
                 targetCount > 0 && countChapters(latestStory) >= targetCount &&
                 !isActiveStoryComplete(targetCount)) {
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

      /** 推進到下一集並全新生成其第1章（前集僅作 context，見錯誤4） */
      async function startNextVolume() {
        if (!storySeries) return false;
        const nextIdx = storySeries.activeVolumeIndex + 1;
        if (nextIdx >= storySeries.totalVolumes) return false;
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
        if (edgeCurrentAudio) {
          edgeCurrentAudio.onended = null;
          edgeCurrentAudio.onerror = null;
          edgeCurrentAudio.pause();
          edgeCurrentAudio.src = '';
          edgeCurrentAudio = null;
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
        
        let processed = text.trim();
        
        // 移除 Markdown 標記
        processed = processed.replace(/^#+\s*/gm, '');
        processed = processed.replace(/\*+/g, '');
        
        // 移除所有不需要唸的符號
        processed = processed.replace(/[「」『』【】〈〉《》（）()\[\]{}""'']/g, '');
        processed = processed.replace(/[：:；;]/g, '，'); // 冒號分號轉逗號停頓
        processed = processed.replace(/[⋯…]+/g, '，'); // 省略號轉停頓
        processed = processed.replace(/[——–—−]+/g, '，'); // 破折號轉停頓
        processed = processed.replace(/[～~]+/g, ''); // 移除波浪號
        processed = processed.replace(/[★☆●○◆◇■□▲△▼▽※＊\*#＃@＠&＆]/g, ''); // 移除特殊符號
        processed = processed.replace(/[─━┃│┄┅┆┇]+/g, ''); // 移除線條符號
        
        // 清理多餘的標點和空格
        processed = processed.replace(/，+/g, '，');
        processed = processed.replace(/。+/g, '。');
        processed = processed.replace(/\s+/g, ' ');
        processed = processed.trim();
        
        // 確保文字不為空
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
              if ((chunk + sentence).length > 150 && chunk.trim()) {
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
                chunk += sentence;
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

        return segments.filter((s) => s.length > 0);
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
          const buf = await EdgeTtsSpeech.synthesize({
            text: processedText,
            voice,
            style,
            rate,
            pitch,
            signal: edgeSynthAbort.signal
          });
          if (!isSpeaking || session !== edgeSpeechSession) return;

          edgeAudioUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
          edgeCurrentAudio = new Audio(edgeAudioUrl);

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

          speechProgressText.textContent = `正在朗讀 ${index + 1}/${speechPlayQueue.length} 段…`;
          await edgeCurrentAudio.play();
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
            edgeCurrentAudio?.pause();
            isPaused = true;
            saveSpeechProgress();
            playPauseBtn.textContent = '▶️ 繼續朗讀';
            speechProgressText.textContent = '⏸️ 已暫停';
          } else {
            isPaused = false;
            playPauseBtn.textContent = '⏸️ 暫停';
            speechProgressText.textContent = `正在朗讀 ${currentSegmentIndex + 1}/${speechPlayQueue.length} 段…`;
            if (edgeCurrentAudio) {
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
        stopEdgePlaybackOnly();
        isPaused = false;
        speakSegment(currentSegmentIndex - 1);
      }

      function nextSegment() {
        if (!isSpeaking || currentSegmentIndex >= speechPlayQueue.length - 1) return;
        stopEdgePlaybackOnly();
        isPaused = false;
        speakSegment(currentSegmentIndex + 1);
      }

      function jumpToSegment(segmentIndex) {
        if (!isSpeaking || segmentIndex < 0 || segmentIndex >= speechPlayQueue.length) return;
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
        const VALID = ['男主角', '女主角', '男配角', '女配角', '反派', '配角', '路人'];
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
          return '配角';
        }
        return '';
      }

      // 收集人物設定（generate 與 continue 共用，確保一致）
      // 角色定位：男主角/女主角/反派 視為「主要」，其餘（男配/女配/配角/路人）視為「次要」。
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
        const { isSeriesVolume = false, isFinalVolume = true } = opts;
        if (!ending) return '';

        // 分集（非最終集）：本集主線收束 + 續集引子，不論使用者所選結局
        if (isSeriesVolume && !isFinalVolume) {
          if (phase === 'setup') {
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
        const spec = ENDING_CODA_SPEC[ending] || '主線收束後，補一段呼應結局傾向的後日談。';

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
        const { isSeriesVolume = false, isFinalVolume = true } = opts;
        const hasComplete = STORY_COMPLETE_RE.test(text) || SERIES_COMPLETE_RE.test(text);
        if (!hasComplete) return false;
        // 非最終集：本集完標記 + 後段特徵
        if (isSeriesVolume && !isFinalVolume) {
          return SERIES_COMPLETE_RE.test(text) && CODA_FEATURE_RE.test(text);
        }
        if (kind === 'closed') return true;
        // 番外預告：必須真的有一篇番外段落（行首小標）
        if (endingNeedsOmake(ending)) return OMAKE_RE.test(text);
        // coda / 最終集：需偵測到 ② 後段
        return CODA_FEATURE_RE.test(text);
      }

      // ==================== 系列分集：資料模型與工具 ====================
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

      // 清除當前模組：重置模板會填入的主題／背景／風格／進階／篇幅設定
      const clearTemplateBtn = document.getElementById('clearTemplateBtn');
      if (clearTemplateBtn) {
        clearTemplateBtn.addEventListener('click', () => {
          const fields = [
            themeSelect, settingSelect, styleSelect,
            narrativeSelect, eraSelect, pacingSelect, ratingSelect,
            worldComplexitySelect, emotionalToneSelect, endingSelect,
            chaptersInput, lengthInput
          ];
          const hasFieldData = fields.some(el => el && el.value);
          const hasCharData = Array.from(charactersContainer.querySelectorAll('.character-row')).some(r =>
            Array.from(r.querySelectorAll('input, select')).some(el => el.value && el.value.trim() && el.value !== '不明')
          );
          if (!hasFieldData && !hasCharData) {
            showStatus('info', '目前沒有可清除的模組設定');
            setTimeout(hideStatus, 2000);
            return;
          }
          if (!confirm('確定要清除目前的模組設定嗎？\n\n將重置主題、背景、風格、進階設定與篇幅，並把人物清空為一位空白人物（特殊元素不受影響）。')) return;
          fields.forEach(el => { if (el) el.value = ''; });
          quickTemplateSelect.value = '';
          // 清空人物，只保留一位空白人物
          charactersContainer.innerHTML = '';
          addCharacterRow(false);
          renderCharacterTabs();
          setActiveCharacter(0);
          saveSettingsToLocal();
          showStatus('success', '已清除當前模組設定');
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
      
      let currentOutline = null;
      let currentBookTitle = '';

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

        // 收集設定
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

        // 兩段式結局說明（coda/series 軌）
        const outlineEndingKind = getEndingKind(ending);
        let outlineEndingNote = '';
        if (ending && outlineEndingKind !== 'closed') {
          const spec = ENDING_CODA_SPEC[ending] || '主線收束後補一段後日談';
          outlineEndingNote = `\n\n【結局結構（重要）】\n本作結局傾向為「${ending}」，最後一章需採「兩段式」：先完整收束本書主線（核心衝突有結果、開頭主問題有答案），再另起一段作為「② 後段」——${spec}\n請在「各章節大綱」最後一章明確標出這兩段內容。`;
        }
        
        // 收集人物
        const characterRows = Array.from(charactersContainer.querySelectorAll('.character-row'));
        let charactersInfo = '';
        characterRows.forEach((row, idx) => {
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

        // 收集特殊元素
        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          selectedElements.push(item.querySelector('.element-label').textContent);
        });

        // 依章節數動態建立「敘事結構」說明
        let structureSection;
        if (chapterCount === 1) {
          structureSection = `【敘事結構】
這是一篇【單章短篇】，請在這唯一的一章內安排完整的起承轉合（開場鉤子 → 衝突發展 → 高潮 → 結局），不要拆分成多章。`;
        } else if (chapterCount <= 3) {
          structureSection = `【敘事結構】
請在僅有的 ${chapterCount} 章篇幅內安排起承轉合，逐一說明這 ${chapterCount} 章分別負責哪個階段。`;
        } else {
          structureSection = `【敘事結構】
• 第一幕（建置）：哪幾章？建立什麼世界觀與角色？
• 第二幕（對抗）：哪幾章？核心衝突如何升級？
• 第三幕（解決）：哪幾章？高潮與結局如何收束？`;
        }

        // 依章節數動態建立「各章節大綱」模板
        let chapterListTemplate;
        if (chapterCount === 1) {
          chapterListTemplate = `第1章：標題
（120-200字）這是【唯一的一章】，需在本章內完成完整故事：開場鉤子、衝突發展、高潮、結局。`;
        } else {
          const maxShown = Math.min(chapterCount, 30); // 章節過多時避免 prompt 過長
          const lines = [];
          for (let i = 1; i <= maxShown; i++) {
            lines.push(`第${i}章：標題\n（80-120字）本章的核心情節、衝突推進，以及結尾的懸念或轉折。`);
          }
          chapterListTemplate = lines.join('\n\n');
          if (chapterCount > maxShown) {
            chapterListTemplate += `\n\n...請依相同格式繼續，直到第${chapterCount}章為止。`;
          }
        }

        // 構建大綱生成 prompt - 專業劇作結構
        let prompt = `【角色設定：資深故事架構師】

你是一位精通敘事結構的故事架構師，擁有以下專業能力：
• 熟稔三幕式結構、英雄之旅、起承轉合等經典敘事框架
• 善於設計「鉤子」開場、「轉折點」推進、「高潮」爆發、「餘韻」收尾
• 精於佈局伏筆、設計懸念、安排情節反轉
• 深諳角色弧線設計：慾望、阻礙、成長、轉變

═══════════════════════════════════════
【本次任務：設計故事藍圖】
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
章節數：${chapters} 章
★★★ 嚴格限制：本故事總共且僅有 ${chapters} 章，「各章節大綱」必須剛好 ${chapters} 章，不可多也不可少！${chapterCount === 1 ? '（只有 1 章，請勿規劃第 2 章以後的內容）' : ''} ★★★
${charactersInfo ? `\n【主要人物】\n${charactersInfo}` : ''}
${selectedElements.length > 0 ? `\n【特殊元素】\n${selectedElements.join('、')}` : ''}

═══════════════════════════════════════
【輸出格式要求】
═══════════════════════════════════════

請設計一份專業的故事大綱，包含以下部分：

【故事概述】
用 2-3 句話勾勒故事核心：主角是誰？他想要什麼？他將面對什麼阻礙？最終走向何方？
（如同電影 logline，精準而有吸引力）

${structureSection}${outlineEndingNote}

【各章節大綱】（必須剛好 ${chapters} 章）
${chapterListTemplate}

【核心衝突設計】
• 外在衝突：主角與什麼力量對抗？（人 vs 人 / 人 vs 環境 / 人 vs 社會）
• 內在衝突：主角內心的矛盾是什麼？需要克服什麼心魔？
• 關係衝突：角色之間有什麼張力？

【角色弧線】
為每位主要角色設計成長軌跡：
• 起點：角色的初始狀態（缺陷、慾望、恐懼）
• 轉折：什麼事件觸發改變？
• 終點：角色最終成為什麼樣的人？

【伏筆與懸念清單】
列出 3-5 個需要在故事中埋設的伏筆，標註在哪章埋設、哪章揭曉

請使用繁體中文，以專業編劇的眼光設計這份大綱，確保情節環環相扣、張力十足。
再次強調：「各章節大綱」必須剛好 ${chapters} 章，不可自行增加章節數量。`;

        // 顯示載入狀態
        outlineLoading.style.display = 'flex';
        outlineContent.style.display = 'none';
        generateOutlineBtn.style.display = 'none';
        generateFromOutlineBtn.style.display = 'none';
        regenerateOutlineBtn.style.display = 'none';

        const signal = beginGeneration();
        try {
          // 串流即時顯示大綱（自動跟著捲到最新內容；使用者往上捲時暫停跟隨）
          outlineContent.style.display = 'block';
          outlineContent.textContent = '';
          const outlineText = (await callDeepSeek(prompt, null, model, {
            signal,
            onChunk: (full) => {
              const stick = outlineContent.scrollTop + outlineContent.clientHeight
                >= outlineContent.scrollHeight - 24;
              outlineContent.textContent = full;
              if (stick) outlineContent.scrollTop = outlineContent.scrollHeight;
            }
          })).trim();
          
          if (outlineText) {
            currentOutline = outlineText;
            // 大綱換新 → 舊書名失效，待使用者生成時再依新大綱命名
            currentBookTitle = '';
            showOutlineTitle('');
            if (typeof updateStepper === 'function') updateStepper();
            
            // 格式化顯示大綱
            displayOutline(currentOutline);
            
            outlineLoading.style.display = 'none';
            outlineContent.style.display = 'block';
            generateFromOutlineBtn.style.display = 'flex';
            regenerateOutlineBtn.style.display = 'flex';
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
      function displayOutline(outline) {
        // 解析大綱並美化顯示
        let html = '';
        
        // 分段處理
        const sections = outline.split(/【(.+?)】/g).filter(s => s.trim());
        
        for (let i = 0; i < sections.length; i += 2) {
          const title = sections[i];
          const content = sections[i + 1] || '';
          
          if (title === '故事概述' || title === '核心衝突' || title === '角色弧線') {
            html += `<div style="margin-bottom: 16px;">
              <h4 style="color: var(--accent); margin-bottom: 8px;">📌 ${title}</h4>
              <p style="color: var(--text); line-height: 1.6;">${content.trim().replace(/\n/g, '<br>')}</p>
            </div>`;
          } else if (title === '各章節大綱') {
            html += `<div style="margin-bottom: 16px;">
              <h4 style="color: var(--accent); margin-bottom: 12px;">📖 ${title}</h4>`;
            
            // 解析各章節
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
        
        // 如果解析失敗，直接顯示原文
        if (!html) {
          html = `<div style="white-space: pre-wrap; line-height: 1.8;">${outline}</div>`;
        }
        
        outlineContent.innerHTML = html;
      }

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

        // 將書名指示與大綱添加到補充說明中
        // 先移除先前已注入的「書名／大綱」區塊，避免重複生成時不斷堆疊（兩者皆固定追加在 notes 結尾）
        let baseNotes = notesInput.value;
        const injectedIdx = baseNotes.search(/【本書書名】|【已生成的故事大綱/);
        if (injectedIdx >= 0) {
          baseNotes = baseNotes.slice(0, injectedIdx);
        }
        const existingNotes = baseNotes.trim();
        const noteParts = [];
        if (currentBookTitle) {
          noteParts.push(`【本書書名】《${currentBookTitle}》\n請在全文最開頭，獨立一行輸出「# 《${currentBookTitle}》」作為書名，空一行後再開始第1章；後續章節沿用此書名，不要重複輸出書名行。`);
        }
        noteParts.push(`【已生成的故事大綱，請嚴格按照此大綱展開故事】\n${currentOutline}`);
        const outlineNote = noteParts.join('\n\n');

        if (existingNotes) {
          notesInput.value = existingNotes + '\n\n' + outlineNote;
        } else {
          notesInput.value = outlineNote;
        }

        // 觸發生成
        showStatus('success', currentBookTitle ? `書名《${currentBookTitle}》已擬定，開始生成...` : '大綱已加入補充說明，正在開始生成...');
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

      // ==================== 進階設定收合（預設收合） ====================
      (function initAdvancedCollapse() {
        const advToggle = document.getElementById('advancedToggle');
        const advSection = document.getElementById('advancedSection');
        if (!advToggle || !advSection) return;
        const saved = localStorage.getItem('advancedCollapsed');
        const startCollapsed = saved === null ? true : saved === '1';
        if (startCollapsed) {
          advSection.classList.add('collapsed');
          advToggle.setAttribute('aria-expanded', 'false');
        } else {
          advToggle.setAttribute('aria-expanded', 'true');
        }
        const toggleAdv = () => {
          const isC = advSection.classList.toggle('collapsed');
          advToggle.setAttribute('aria-expanded', String(!isC));
          try { localStorage.setItem('advancedCollapsed', isC ? '1' : '0'); } catch (e) {}
        };
        advToggle.addEventListener('click', toggleAdv);
        advToggle.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAdv(); }
        });
      })();

      const randomAdvancedBtn = document.getElementById('randomAdvancedBtn');
      if (randomAdvancedBtn) {
        randomAdvancedBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          randomizeAdvancedSettings();
          showStatus('success', '已隨機設定進階選項');
        });
      }

      const randomStoryElementsBtn = document.getElementById('randomStoryElementsBtn');
      if (randomStoryElementsBtn) {
        randomStoryElementsBtn.addEventListener('click', () => {
          randomizeStoryElements();
          showStatus('success', '已隨機填充主題、背景與風格');
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
            const namePoolBlock = getNamePoolPromptBlock(count);
            // 取名規則一律提供：清單名優先用，不足時 AI 依此規則自行取名
            const nameRules = getCharacterNamingRules(settingSelect.value);
            const hintBlock = hints.length
              ? `\n\n可參考使用者已提供的方向（盡量融入、保持協調，但以劇情合理為優先；可自由調整）：\n${JSON.stringify(hints, null, 0)}`
              : '';
            const prompt = `你是專業小說人物設計師。請依以下故事設定，「完整設計」剛好 ${count} 位人物，要彼此關聯、有戲劇張力且貼合劇情。請為角色群安排合理的「角色定位」：\n- 至少要有 1 位主角（男主角或女主角），這是硬性規定；主角不一定男女各 1，可只有 1 位、也可雙主角或多主角，依劇情而定。\n- 其餘配置完全依劇情自由分配，數量不限定各 1：例如可以有 2 位反派、2 配角加 1 反派、2 位男配角、3 位女配角等任意組合，避免所有人都是主角。\n每位的所有欄位都要填寫完整、具體、避免空泛，讓使用者可直接使用並微調。\n\n${nameRules}${namePoolBlock}\n${ctx}${hintBlock}\n\n只回傳 JSON 陣列，長度必須剛好為 ${count}，不要任何說明文字。每個元素格式如下：\n{"gender":"男/女/不明","role":"男主角/女主角/男配角/女配角/反派/配角 擇一","age":"數字或描述","name":"姓名（真實人名）","personality":"個性（具體，10~20字）","goal":"核心目標（具體）","weakness":"弱點/罩門","secret":"不可告人的祕密","relation":"與其他角色的關係（請點名其他角色）"}`;
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
          const rowGender = row.querySelector('.char-gender').value;
          const needName = !row.querySelector('.char-name').value.trim();
          const namePoolBlock = needName ? getNamePoolPromptBlock(1, rowGender) : '';
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
          const prompt = `你是小說人物設計師。故事設定：${ctx}。\n以下是一位人物目前的部分資料（空白欄位需要你補完，已有內容請盡量保留並使其協調）：\n${JSON.stringify(cur)}\n\n${nameRules}${namePoolBlock}\n\n只回傳單一 JSON 物件，格式：{"gender":"","role":"男主角/女主角/男配角/女配角/反派/配角 擇一","age":"","name":"姓名（真實人名）","personality":"","goal":"","weakness":"","secret":"","relation":""}`;
          const resp = await callDeepSeek(prompt, null, modelSelect.value, { retries: 1 });
          const data = parseJsonFromText(resp);
          if (!data || typeof data !== 'object') {
            showStatusInView('error', 'AI 回應無法解析，請再試一次');
            return;
          }
          // 只補空白欄位
          const fillIfEmpty = (sel, val) => {
            const el = row.querySelector(sel);
            if (el && !el.value.trim() && val != null && String(val).trim()) {
              el.value = String(val).trim();
              el.title = el.value;
            }
          };
          fillIfEmpty('.char-gender', data.gender);
          fillIfEmpty('.char-role', normalizeCharRole(data.role, data.gender || (row.querySelector('.char-gender') && row.querySelector('.char-gender').value)));
          fillIfEmpty('.char-age', data.age);
          fillIfEmpty('.char-name', data.name);
          fillIfEmpty('.char-personality', data.personality);
          fillIfEmpty('.char-goal', data.goal);
          fillIfEmpty('.char-weakness', data.weakness);
          fillIfEmpty('.char-secret', data.secret);
          fillIfEmpty('.char-relation', data.relation);
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

      console.log('🎨 AI 小說工坊已載入完成！');
      console.log('💡 新功能：流程列、右側工具收合、AI 人物設計');
