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
      const randomBtn = document.getElementById('randomBtn');
      const generateBtn = document.getElementById('generateBtn');
      const downloadBtn = document.getElementById('downloadBtn');
      const continueBtn = document.getElementById('continueBtn');
      const statusDiv = document.getElementById('status');
      const resultDiv = document.getElementById('result');
      const outputWrap = document.getElementById('outputWrap');
      const verticalViewport = document.getElementById('verticalViewport');

      const VERTICAL_BLOCK_HEIGHT = () => Math.min(window.innerHeight * 0.72, 680);

      function getContentScroller() {
        return verticalViewport || outputWrap;
      }

      // 生成時自動跟隨最新段落：橫排往下捲、直排往左捲（右→左書寫）
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
      function syncVerticalLayout() {
        if (!isVerticalWriting() || !resultDiv || !verticalViewport) return;
        const blockHeight = VERTICAL_BLOCK_HEIGHT();
        resultDiv.style.height = blockHeight + 'px';
        resultDiv.style.width = 'max-content';
        resultDiv.style.display = 'inline-block';
        void resultDiv.offsetWidth;
        const contentWidth = resultDiv.scrollWidth;
        const minWidth = Math.max(contentWidth, verticalViewport.clientWidth);
        resultDiv.style.minWidth = minWidth + 'px';
      }
      function isNearPageBottom(threshold = 140) {
        const scrollPos = window.innerHeight + window.scrollY;
        const docHeight = document.documentElement.scrollHeight;
        return scrollPos >= docHeight - threshold;
      }
      let verticalScrollToStartPending = false;
      let verticalStartResizeObserver = null;

      function isNearOutputEnd(threshold = 140) {
        if (isVerticalWriting()) {
          return getVerticalScroller().scrollLeft <= threshold;
        }
        if (!outputWrap) return isNearPageBottom(threshold);
        if (outputWrap.classList.contains('horizontal-scroll')) {
          const scroller = getContentScroller();
          const scrollPos = scroller.scrollTop + scroller.clientHeight;
          return scrollPos >= scroller.scrollHeight - threshold;
        }
        return isNearPageBottom(threshold);
      }
      function alignVerticalScrollToStart() {
        const scroller = getVerticalScroller();
        if (!scroller || !resultDiv) return false;
        syncVerticalLayout();
        const max = getVerticalScrollMax();
        if (max > 0) {
          scroller.scrollLeft = max;
          return true;
        }
        const textNode = resultDiv.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE && textNode.length > 0) {
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(1, textNode.length));
          const startRect = range.getBoundingClientRect();
          const viewRect = scroller.getBoundingClientRect();
          if (startRect.width > 0 || startRect.height > 0) {
            scroller.scrollLeft += startRect.right - viewRect.right;
            return true;
          }
        }
        return false;
      }
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
          getVerticalScroller().scrollLeft = 0;
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
        // 滾輪往下（deltaY > 0）→ 文字區往右滑
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        e.preventDefault();
        e.stopPropagation();
        scrollOutputHorizontal(-delta);
      }
      function setResultStreaming(text) {
        const generating = document.body.classList.contains('is-generating');
        const stick = generating || isNearOutputEnd();
        resultDiv.textContent = text;
        if (isVerticalWriting()) syncVerticalLayout();
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
      if (resultDiv) {
        new MutationObserver(() => {
          if (!isVerticalWriting()) return;
          syncVerticalLayout();
          if (verticalScrollToStartPending) alignVerticalScrollToStart();
        }).observe(resultDiv, { childList: true, characterData: true, subtree: true });
      }
      window.addEventListener('load', () => {
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
          requestBody.max_tokens = 8192;
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
        if (typeof options.onComplete === 'function') options.onComplete({ finishReason });
        return { text: fullText.trim(), gotContent, finishReason };
      }

      // 呼叫 DeepSeek，含失敗自動重試（僅在尚未輸出內容時重試）；回傳生成文字
      async function callDeepSeek(prompt, apiKey, model, options = {}) {
        const maxRetries = typeof options.retries === 'number' ? options.retries : 2;
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await doDeepSeekRequest(prompt, apiKey, model, options);
            return result.text;
          } catch (err) {
            lastErr = err;
            // 不重試：使用者中斷、餘額不足、金鑰錯誤
            if (isNonRetryable(err)) throw err;
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

      randomBtn.addEventListener('click', () => {
        themeSelect.value = pickRandom(themes);
        settingSelect.value = pickRandom(settingsData);
        styleSelect.value = pickRandom(stylesArr);
        chaptersInput.value = pickRandom(chapterOpts);
        lengthInput.value = pickRandom(lengthOpts);
        
        // 進階設定隨機
        narrativeSelect.value = pickRandom(narrativeOptions).value;
        eraSelect.value = pickRandom(eraOptions).value;
        pacingSelect.value = pickRandom(pacingOptions).value;
        ratingSelect.value = pickRandom(ratingOptions).value;
        worldComplexitySelect.value = pickRandom(worldComplexityOptions).value;
        emotionalToneSelect.value = pickRandom(emotionalToneOptions).value;
        endingSelect.value = pickRandom(endingOptions).value;
        
        // 隨機選擇 2-5 個特殊元素
        const allItems = specialElementsContainer.querySelectorAll('.special-element-item');
        allItems.forEach(item => {
          item.classList.remove('selected');
          const checkbox = item.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.checked = false;
        });
        
        const shuffled = Array.from(allItems).sort(() => Math.random() - 0.5);
        const numToSelect = Math.floor(Math.random() * 4) + 2; // 2-5 個
        shuffled.slice(0, numToSelect).forEach(item => {
          item.classList.add('selected');
          const checkbox = item.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.checked = true;
        });
        
        randomizeAllCharacters();
        saveSettingsToLocal();
      });

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
          return;
        }
        
        hideStatus();
        resultDiv.textContent = '';
        chapterNavContainer.classList.remove('show');
        chapterMatches = [];
        localStorage.removeItem('savedStory');
        latestStory = '';
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

        // 進階設定
        const narrative = narrativeSelect.value.trim();
        const era = eraSelect.value.trim();
        const pacing = pacingSelect.value.trim();
        const rating = ratingSelect.value.trim();
        const worldComplexity = worldComplexitySelect.value.trim();
        const emotionalTone = emotionalToneSelect.value.trim();
        const ending = endingSelect.value.trim();
        
        // 收集特殊元素
        const selectedElements = [];
        specialElementsContainer.querySelectorAll('.special-element-item.selected').forEach(item => {
          const label = item.querySelector('.element-label').textContent;
          selectedElements.push(label);
        });

        const hasAdvanced = narrative || era || pacing || rating || worldComplexity || emotionalTone || ending;
        if (!theme && !setting && !charactersInfo && !style && !chapters && !length && !notes && selectedElements.length === 0 && !hasAdvanced) {
          showStatus('error', '請至少填寫一項設定或使用隨機填充');
          return;
        }

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
        
        if (chapters) {
          if (shouldGenerateChapterByChapter) {
            // 逐章生成模式：只生成第一章
            chapterEndingHint = `
• ⚠️【重要】故事總共 ${chapters} 章，本次只需生成【第1章】（或序章）
• 第1章要有完整的故事開頭（至少2000-3000字），建立世界觀、展開初始情節${mainNames.length > 0 ? `，並讓主要角色（${mainNames.join('、')}）登場` : '，介紹主要角色'}${secondaryNames.length > 0 ? `\n• 配角（${secondaryNames.join('、')}）不必在第1章全部登場，可於後續章節再自然引入` : ''}
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
• 每章至少 2000-3000 字紮實內容，起承轉合完整
• 章節標題格式：### 第X章：標題（或 ### 序章：標題）
• 使用繁體中文（禁止簡體字與中國大陸慣用詞），文筆流暢優美
• 純敘事文體呈現，禁止大綱、條列、設定說明

◆ 避免事項（重要）◆
• 禁用 AI 套語與陳腔濫調，例如「嘴角勾起一抹弧度」「空氣彷彿凝固」「不知過了多久」「心中五味雜陳」「一絲不易察覺的」等
• 不要直接說明情緒（如「他很憤怒」），改以神態、動作、生理反應與環境烘托來展現
• 避免句式單調與每段同一主詞開頭，長短句交錯、節奏有變化
• 對白要像真人說話，口吻符合各角色身分，避免翻譯腔與成語堆砌

◆ 強制遵守 ◆${elementsReminder}${settingsReminder}${characterReminder}${chapterEndingHint}
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
        try {
          document.getElementById('progressChapter').textContent = '正在連接 AI 服務...';
          resultDiv.textContent = '';
          // 捲到寫作區，讓使用者一開始就看到內容生成（之後串流會自動跟隨）
          resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
          
          const story = await callDeepSeek(prompt, null, model, {
            signal,
            onChunk: (full) => { setResultStreaming(full); },
            onComplete: ({ finishReason }) => { wasTruncated = finishReason === 'length'; }
          });
          
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
            
            if (shouldGenerateChapterByChapter && generatedChapters >= 1) {
              showStatus('success', `第1章生成完成！目前 ${generatedChapters}/${targetChapterCount} 章，請點擊「繼續生成」按鈕來生成後續章節`);
            } else if (shouldGenerateChapterByChapter && generatedChapters === 0) {
              showStatus('warning', '生成完成，但未檢測到章節標題。請檢查內容或使用「繼續生成」按鈕');
            } else {
            showStatus('success', '生成完成！');
            }
            // 若被單次輸出長度上限截斷，提示使用者接續
            if (wasTruncated && !shouldGenerateChapterByChapter) {
              showStatus('warning', '⚠️ 內容已達單次長度上限被截斷，請點「繼續生成」接續未完成的部分');
            }
            downloadBtn.disabled = false;
            continueBtn.disabled = false;
            speakBtn.disabled = false; bookReaderBtn.disabled = false;
            parseAndShowChapters(latestStory);

            // 逐章模式 + 自動連續生成：待本次流程結束後，自動接續產生後續章節
            if (shouldGenerateChapterByChapter && isAutoContinueEnabled() && generatedChapters >= 1) {
              setTimeout(() => runAutoContinue(targetChapterCount), 600);
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
            showStatus('error', '請求失敗：' + err.message);
          }
          hideGenerationProgress();
        } finally {
          endGeneration();
          generateBtn.disabled = false;
        }
      });

      // ==================== 繼續生成 ====================
      continueBtn.addEventListener('click', () => doContinueGeneration());

      async function doContinueGeneration(opts = {}) {
        const isAuto = opts.auto === true;
        // 檢查離線狀態
        if (!navigator.onLine) {
          showStatus('error', '📴 目前為離線模式，無法繼續生成。請連接網路後再試。');
          return;
        }
        
        if (!latestStory) {
          showStatus('error', '尚未有故事可繼續，請先生成');
          return;
        }
        
        // 檢查是否已達到設定的章節數上限
        const targetChapters = parseInt(chaptersInput.value) || 0;
        if (targetChapters > 0 && !isAuto) {
          // 計算目前已有的章節數
          const currentChapters = countChapters(latestStory);
          
          if (currentChapters >= targetChapters) {
            const confirmContinue = confirm(`目前已有 ${currentChapters} 章，已達到設定的 ${targetChapters} 章上限。\n\n確定要繼續生成更多章節嗎？`);
            if (!confirmContinue) {
              return;
            }
          }
        }
        
        const model = modelSelect.value;

        // 計算還需要生成多少章，並決定是否需要結局
        let remainingChaptersHint = '';
        let isNearEnding = false;
        let isFinalChapter = false;
        let isAlreadyComplete = false;
        
        if (targetChapters > 0) {
          const currentChapters = countChapters(latestStory);
          const remaining = targetChapters - currentChapters;
          
          if (remaining <= 0) {
            // 已達到或超過目標章節數，這次生成應該只補結局（不增加新章節）
            isAlreadyComplete = true;
            remainingChaptersHint = `
• ⚠️【極重要】故事已達到 ${targetChapters} 章，不要再新增章節！
• 如果故事尚未有結局，請直接在目前內容後補上簡短的結局段落
• 結尾必須加上「（全文完）」標記
• 禁止新增「第${currentChapters + 1}章」或任何新章節`;
          } else if (remaining === 1) {
            // 只剩最後一章，這章必須包含結局
            isFinalChapter = true;
            remainingChaptersHint = `
• ⚠️【重要】這是最後一章（第 ${targetChapters} 章），必須在本章完成故事結局
• 請收束所有伏筆和劇情線，給角色一個明確的結局
• 本章結尾必須加上「（全文完）」或「（完結）」標記`;
          } else if (remaining === 2) {
            // 剩兩章，開始收尾
            isNearEnding = true;
            remainingChaptersHint = `
• 目標總章節數為 ${targetChapters} 章，目前已有 ${currentChapters} 章，還剩 ${remaining} 章
• 故事即將進入尾聲，請開始收束伏筆，為結局做準備`;
          } else if (remaining > 0) {
            remainingChaptersHint = `
• 目標總章節數為 ${targetChapters} 章，目前已有 ${currentChapters} 章，還剩 ${remaining} 章待撰寫`;
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
        if (currentStyle) { settingsReminder += `• 風格：${currentStyle}\n`; hasSettings = true; }
        if (currentNarrative) { settingsReminder += `• 視角：${currentNarrative}\n`; hasSettings = true; }
        if (currentPacing) { settingsReminder += `• 節奏：${currentPacing}\n`; hasSettings = true; }
        if (currentEmotionalTone) { settingsReminder += `• 基調：${currentEmotionalTone}\n`; hasSettings = true; }
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
• 每章至少 2000-3000 字的紮實內容，場景細膩、情感飽滿
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
• 避免句式單調與重複開頭，長短句交錯${characterReminder}${remainingChaptersHint}

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

        // 手動續寫時捲到底部，讓使用者看到新內容生成（串流會自動跟隨）
        if (!isAuto) {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        }

        const signal = beginGeneration();
        const baseStory = latestStory;
        let contTruncated = false;
        try {
          const continuation = (await callDeepSeek(continuePrompt, null, model, {
            signal,
            onChunk: (full) => { setResultStreaming(baseStory + '\n\n' + full); },
            onComplete: ({ finishReason }) => { contTruncated = finishReason === 'length'; }
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
              
              // 檢查故事是否已完結
              const isCompleted = /[（(](?:全文完|完結|全書完|終|The End)[）)]|【完】|—完—|～完～|（END）|─\s*完\s*─/i.test(latestStory);
              
              // 檢查是否已達到目標章節數
              let storyCompleted = false;
              if (targetChapters > 0) {
                
                if (isCompleted) {
                  showStatus('success', `🎉 故事完結！共 ${currentChapters} 章`);
                  storyCompleted = true;
                } else if (currentChapters >= targetChapters) {
                  // 已達到章節數但沒有結局標記
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
              
              // 完結後禁用繼續生成按鈕
              if (storyCompleted) {
                continueBtn.disabled = true;
                continueBtn.title = '故事已完結';
              } else if (contTruncated && !isAuto) {
                showStatus('warning', '⚠️ 本段已達單次長度上限被截斷，請再次點「繼續生成」接續');
              }
              
              // 更新字數統計
              updateWordCount(latestStory);
              
              // 短暫延遲後隱藏進度條（可被續章取消）
              scheduleHideProgress(1000);
              
              downloadBtn.disabled = false;
              speakBtn.disabled = false; bookReaderBtn.disabled = false;
              parseAndShowChapters(latestStory);
          } else {
            showStatus('error', '沒有獲得續篇內容，可能已完結');
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
          } else {
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
          }
        } finally {
          endGeneration();
          // 如果故事未完結才重新啟用按鈕
          const isCompleted = /[（(](?:全文完|完結|全書完|終|The End)[）)]|【完】|—完—|～完～|（END）|─\s*完\s*─/i.test(latestStory);
          if (!isCompleted) {
            continueBtn.disabled = false;
          }
          generateBtn.disabled = false;
        }
      }

      // 自動連續生成：依目標章節數，自動接續產生直到完成或達標
      function isAutoContinueEnabled() {
        const el = document.getElementById('autoContinueToggle');
        return !!(el && el.checked);
      }

      async function runAutoContinue(targetCount) {
        const completeRe = /[（(](?:全文完|完結|全書完|終|The End)[）)]|【完】|—完—|～完～|（END）|─\s*完\s*─/i;
        let guard = 0;
        while (guard++ < 200) {
          if (userAborted) break;
          if (completeRe.test(latestStory)) break;
          const cur = countChapters(latestStory);
          if (targetCount > 0 && cur >= targetCount) break;
          const before = cur;
          await doContinueGeneration({ auto: true });
          if (userAborted) break;
          // 若這一輪沒有新增章節，避免無限迴圈
          const after = countChapters(latestStory);
          if (after <= before) break;
        }
        // 已達目標章節數但尚無結局標記：補一次結局（不新增章節）
        if (!userAborted && targetCount > 0 &&
            countChapters(latestStory) >= targetCount && !completeRe.test(latestStory)) {
          await doContinueGeneration({ auto: true });
        }
        if (!userAborted) {
          const total = countChapters(latestStory);
          showStatus('success', `✅ 自動生成結束，共 ${total} 章`);
        }
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
        resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
          div.innerHTML = `<span class="book-spine-title">${escapeHtml(name.substring(0, 14))}</span>`;
          div.title = name;
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
        cover.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
        cover.textContent = name.charAt(0) || '書';
        document.getElementById('bookDetailTitle').textContent = name;
        document.getElementById('bookDetailMeta').innerHTML =
          `<span>📅 ${formatDate(bm.id)}</span><span>📝 ${formatWordCount(bm.content || '')}</span>`;
        document.getElementById('bookDetailPreview').textContent =
          (bm.content || '').replace(/[#*]/g, '').replace(/\n+/g, ' ').substring(0, 140) + '…';
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
          bm.title = editBookmarkTitle.value.trim() || bm.title;
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

      // ==================== 情緒朗讀功能 ====================
      let speechSynth = window.speechSynthesis;
      let currentUtterance = null;
      let isSpeaking = false;
      let isPaused = false;
      let speechSegments = [];
      let currentSegmentIndex = 0;
      let availableVoices = [];
      let segmentRanges = []; // 儲存每個段落在原文中的位置
      let speechInitialized = false; // 追蹤語音是否已初始化

      // 朗讀控制元素
      const prevSegmentBtn = document.getElementById('prevSegmentBtn');
      const nextSegmentBtn = document.getElementById('nextSegmentBtn');
      const currentSegmentDisplay = document.getElementById('currentSegmentDisplay');
      const speechProgressBar = document.getElementById('speechProgressBar');
      const autoScrollCheck = document.getElementById('autoScrollCheck');
      const highlightCheck = document.getElementById('highlightCheck');
      
      // 檢查瀏覽器是否支援語音合成
      if (!speechSynth) {
        console.warn('此瀏覽器不支援語音合成');
        speakBtn.title = '您的瀏覽器不支援朗讀功能';
      }
      
      // Chrome bug workaround: 防止長時間朗讀自動暫停
      let speechKeepAliveInterval = null;
      
      function startSpeechKeepAlive() {
        if (speechKeepAliveInterval) return;
        speechKeepAliveInterval = setInterval(() => {
          if (isSpeaking && !isPaused && speechSynth.speaking) {
            speechSynth.pause();
            speechSynth.resume();
          }
        }, 10000); // 每 10 秒
      }
      
      function stopSpeechKeepAlive() {
        if (speechKeepAliveInterval) {
          clearInterval(speechKeepAliveInterval);
          speechKeepAliveInterval = null;
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

      // 載入語音列表（只顯示中文語音）
      function loadVoices() {
        if (!speechSynth) {
          console.warn('語音合成不可用');
          return;
        }
        
        availableVoices = speechSynth.getVoices();
        console.log('載入語音列表，找到', availableVoices.length, '個語音');
        voiceSelect.innerHTML = '';
        
        // 篩選中文語音（放寬條件）
        const zhVoices = availableVoices.filter(v => 
          v.lang.includes('zh') || 
          v.lang.includes('TW') || 
          v.lang.includes('CN') ||
          v.lang.includes('HK') ||
          v.lang.includes('cmn') ||  // 普通話
          v.lang.includes('yue') ||  // 粵語
          v.lang.includes('wuu') ||  // 吳語
          v.name.includes('中文') ||
          v.name.includes('Chinese') ||
          v.name.includes('Mandarin') ||
          v.name.includes('Cantonese') ||
          v.name.includes('Taiwan') ||
          v.name.includes('Hong Kong') ||
          v.name.includes('Taiwanese') ||
          v.name.toLowerCase().includes('xiaoxiao') ||
          v.name.toLowerCase().includes('yunyang') ||
          v.name.toLowerCase().includes('xiaoyi')
        );
        
        // 取得所有非中文語音（備用）
        const otherVoices = availableVoices.filter(v => !zhVoices.includes(v));
        
        // 按語言分類
        const twVoices = zhVoices.filter(v => 
          v.lang.includes('TW') || 
          v.lang.includes('zh-Hant') || 
          v.name.includes('台') ||
          v.name.includes('Taiwan')
        );
        const cnVoices = zhVoices.filter(v => 
          (v.lang.includes('CN') || v.lang.includes('zh-Hans') || v.lang === 'zh' || v.lang.includes('cmn')) && 
          !twVoices.includes(v)
        );
        const hkVoices = zhVoices.filter(v => 
          v.lang.includes('HK') || 
          v.lang.includes('yue') ||
          v.name.includes('粵') || 
          v.name.includes('Cantonese') ||
          v.name.includes('Hong Kong')
        );
        const otherZhVoices = zhVoices.filter(v => 
          !twVoices.includes(v) && !cnVoices.includes(v) && !hkVoices.includes(v)
        );
        
        // 簡化語音名稱顯示
        function formatVoiceName(voice, showLang = false) {
          let name = voice.name;
          // 移除常見的冗長前綴
          name = name.replace(/Microsoft /gi, '');
          name = name.replace(/Google /gi, '');
          name = name.replace(/Apple /gi, '');
          name = name.replace(/ Online \(Natural\)/gi, '');
          name = name.replace(/ - Chinese \(.*\)/gi, '');
          name = name.replace(/ - .*$/gi, ''); // 移除最後的語言標記
          
          // 添加語言標記
          if (voice.lang.includes('TW') || voice.lang.includes('zh-Hant')) {
            return `🇹🇼 ${name}`;
          } else if (voice.lang.includes('HK') || voice.lang.includes('yue')) {
            return `🇭🇰 ${name}`;
          } else if (voice.lang.includes('CN') || voice.lang.includes('zh-Hans') || voice.lang === 'zh' || voice.lang.includes('cmn')) {
            return `🇨🇳 ${name}`;
          }
          
          if (showLang) {
            return `${name} (${voice.lang})`;
          }
          return name;
        }
        
        // 繁體中文（台灣）
        if (twVoices.length > 0) {
          const group = document.createElement('optgroup');
          group.label = '🇹🇼 繁體中文（台灣）';
          twVoices.forEach((voice, i) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = formatVoiceName(voice);
            if (i === 0) option.selected = true;
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        }
        
        // 簡體中文（中國）
        if (cnVoices.length > 0) {
          const group = document.createElement('optgroup');
          group.label = '🇨🇳 簡體中文（中國）';
          cnVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = formatVoiceName(voice);
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        }
        
        // 粵語（香港）
        if (hkVoices.length > 0) {
          const group = document.createElement('optgroup');
          group.label = '🇭🇰 粵語（香港）';
          hkVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = formatVoiceName(voice);
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        }
        
        // 其他中文
        if (otherZhVoices.length > 0) {
          const group = document.createElement('optgroup');
          group.label = '🌏 其他中文';
          otherZhVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = formatVoiceName(voice);
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        }
        
        // 如果完全沒有中文語音，顯示所有可用語音
        if (zhVoices.length === 0 && otherVoices.length > 0) {
          const group = document.createElement('optgroup');
          group.label = '🌐 其他語音（無中文語音可用）';
          otherVoices.slice(0, 20).forEach((voice, i) => { // 最多顯示 20 個
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = formatVoiceName(voice, true);
            if (i === 0) option.selected = true;
            group.appendChild(option);
          });
          voiceSelect.appendChild(group);
        }
        
        // 如果完全沒有語音
        if (availableVoices.length === 0) {
          const option = document.createElement('option');
          option.textContent = '⚠️ 未找到任何語音';
          option.disabled = true;
          voiceSelect.appendChild(option);
          
          // 顯示提示
          const hint = document.createElement('option');
          hint.textContent = '請在系統設定中安裝中文語音';
          hint.disabled = true;
          voiceSelect.appendChild(hint);
        }
      }

      // 初始化語音 - 增加延遲重試機制（Windows 系統可能需要更長時間）
      loadVoices();
      if (speechSynth && speechSynth.onvoiceschanged !== undefined) {
        speechSynth.onvoiceschanged = loadVoices;
      }
      
      // Windows/Edge 可能需要延遲載入語音
      setTimeout(() => {
        if (availableVoices.length === 0) {
          console.log('延遲重試載入語音...');
          loadVoices();
        }
      }, 100);
      
      setTimeout(() => {
        if (availableVoices.length === 0) {
          console.log('再次重試載入語音...');
          loadVoices();
        }
        speechInitialized = true;
      }, 500);

      // 情緒分析與參數調整
      function analyzeEmotion(text) {
        const mode = emotionMode.value;
        if (mode !== 'auto') {
          return getEmotionParams(mode);
        }
        
        // 自動偵測情緒
        const sadKeywords = ['悲傷', '哭泣', '淚水', '死亡', '離別', '痛苦', '絕望', '心碎', '哀傷', '悼念', '嘆息', '憂愁'];
        const excitedKeywords = ['激動', '興奮', '勝利', '衝刺', '爆發', '熱血', '燃燒', '戰鬥', '吶喊', '奮起', '怒吼', '突破'];
        const mysteriousKeywords = ['神秘', '陰森', '詭異', '黑暗', '未知', '秘密', '隱藏', '恐怖', '懸疑', '謎團', '幽暗', '詛咒'];
        const gentleKeywords = ['溫柔', '輕聲', '微笑', '愛情', '甜蜜', '擁抱', '親吻', '溫暖', '呢喃', '柔情', '浪漫', '心動'];
        const dramaticKeywords = ['震驚', '揭露', '轉折', '意外', '真相', '背叛', '復仇', '命運', '對決', '高潮', '決戰'];
        
        let sadScore = sadKeywords.filter(k => text.includes(k)).length;
        let excitedScore = excitedKeywords.filter(k => text.includes(k)).length;
        let mysteriousScore = mysteriousKeywords.filter(k => text.includes(k)).length;
        let gentleScore = gentleKeywords.filter(k => text.includes(k)).length;
        let dramaticScore = dramaticKeywords.filter(k => text.includes(k)).length;
        
        // 檢查標點符號
        if ((text.match(/！/g) || []).length > 2) excitedScore += 2;
        if ((text.match(/？/g) || []).length > 2) mysteriousScore += 1;
        if ((text.match(/⋯|…/g) || []).length > 1) sadScore += 1;
        
        const maxScore = Math.max(sadScore, excitedScore, mysteriousScore, gentleScore, dramaticScore);
        
        if (maxScore === 0) return getEmotionParams('narration');
        if (sadScore === maxScore) return getEmotionParams('sad');
        if (excitedScore === maxScore) return getEmotionParams('excited');
        if (mysteriousScore === maxScore) return getEmotionParams('mysterious');
        if (gentleScore === maxScore) return getEmotionParams('gentle');
        if (dramaticScore === maxScore) return getEmotionParams('dramatic');
        
        return getEmotionParams('narration');
      }

      function getEmotionParams(emotion) {
        const baseRate = parseFloat(speechRate.value);
        const basePitch = parseFloat(speechPitch.value);
        
        switch (emotion) {
          case 'sad':
            return { rate: baseRate * 0.8, pitch: basePitch * 0.85, volume: 0.85, pause: 500 };
          case 'excited':
            return { rate: baseRate * 1.15, pitch: basePitch * 1.1, volume: 1.0, pause: 200 };
          case 'mysterious':
            return { rate: baseRate * 0.85, pitch: basePitch * 0.9, volume: 0.9, pause: 450 };
          case 'gentle':
            return { rate: baseRate * 0.9, pitch: basePitch * 1.05, volume: 0.85, pause: 350 };
          case 'dramatic':
            return { rate: baseRate * 1.0, pitch: basePitch * 1.0, volume: 1.0, pause: 400 };
          case 'narration':
          default:
            return { rate: baseRate, pitch: basePitch, volume: 0.95, pause: 300 };
        }
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

      // 分割文字為段落（保持情緒連貫），同時記錄位置
      function splitTextToSegments(text) {
        // 按段落和句號分割
        const paragraphs = text.split(/\n\n+/);
        const segments = [];
        segmentRanges = []; // 重置位置記錄
        
        let currentPos = 0;
        
        paragraphs.forEach(para => {
          if (!para.trim()) {
            currentPos += para.length + 2; // +2 for \n\n
            return;
          }
          
          const paraStart = text.indexOf(para, currentPos);
          
          // 較長段落再細分
          if (para.length > 200) {
            const sentences = para.split(/(?<=[。！？])/);
            let chunk = '';
            let chunkStart = paraStart;
            
            sentences.forEach(s => {
              if ((chunk + s).length > 150) {
                if (chunk) {
                  segments.push(chunk.trim());
                  segmentRanges.push({ start: chunkStart, end: chunkStart + chunk.length, text: chunk.trim() });
                }
                chunkStart = chunkStart + chunk.length;
                chunk = s;
              } else {
                chunk += s;
              }
            });
            if (chunk) {
              segments.push(chunk.trim());
              segmentRanges.push({ start: chunkStart, end: chunkStart + chunk.length, text: chunk.trim() });
            }
          } else {
            segments.push(para.trim());
            segmentRanges.push({ start: paraStart, end: paraStart + para.length, text: para.trim() });
          }
          
          currentPos = paraStart + para.length;
        });
        
        return segments.filter(s => s.length > 0);
      }

      // 高亮目前朗讀的段落
      function highlightCurrentSegment(index) {
        // 移除舊的高亮
        clearHighlight();
        
        if (!highlightCheck || !highlightCheck.checked) return;
        if (index < 0 || index >= speechSegments.length) return;
        
        const segmentText = speechSegments[index];
        if (!segmentText) return;
        
        // 在 resultDiv 中找到對應的文字
        const fullText = latestStory || '';
        
        // 找到這個段落在原文中的位置
        // 由於段落可能重複，我們需要追蹤已經處理過的位置
        let searchStart = 0;
        for (let i = 0; i < index; i++) {
          const prevSegment = speechSegments[i];
          const foundPos = fullText.indexOf(prevSegment, searchStart);
          if (foundPos !== -1) {
            searchStart = foundPos + prevSegment.length;
          }
        }
        
        const segmentStart = fullText.indexOf(segmentText, searchStart);
        if (segmentStart === -1) return;
        
        const beforeText = fullText.substring(0, segmentStart);
        const afterText = fullText.substring(segmentStart + segmentText.length);
        
        // 使用 innerHTML 來高亮（需要轉義 HTML）
        const escapeHtml = (text) => {
          return text.replace(/&/g, '&amp;')
                     .replace(/</g, '&lt;')
                     .replace(/>/g, '&gt;')
                     .replace(/\n/g, '<br>');
        };
        
        resultDiv.innerHTML = escapeHtml(beforeText) + 
          '<span class="speaking-segment" id="currentSpeakingSegment">' + escapeHtml(segmentText) + '</span>' + 
          escapeHtml(afterText);
        
        // 自動捲動到高亮的段落
        if (autoScrollCheck && autoScrollCheck.checked) {
          // 使用 setTimeout 確保 DOM 已更新
          setTimeout(() => {
            const highlightedEl = document.getElementById('currentSpeakingSegment');
            if (highlightedEl) {
              // 計算元素位置並捲動
              const rect = highlightedEl.getBoundingClientRect();
              const viewportHeight = window.innerHeight;
              
              // 如果元素不在可視範圍內，才捲動
              if (rect.top < 100 || rect.bottom > viewportHeight - 100) {
                highlightedEl.scrollIntoView({ 
                  behavior: 'smooth', 
                  block: 'center' 
                });
              }
            }
          }, 50);
        }
      }
      
      // 清除高亮
      function clearHighlight() {
        const highlightedEl = document.getElementById('currentSpeakingSegment');
        if (highlightedEl || resultDiv.innerHTML.includes('speaking-segment')) {
          // 恢復純文字
          resultDiv.textContent = latestStory || '';
        }
      }
      
      // 更新段落控制按鈕狀態
      function updateNavButtons() {
        prevSegmentBtn.disabled = !isSpeaking || currentSegmentIndex <= 0;
        nextSegmentBtn.disabled = !isSpeaking || currentSegmentIndex >= speechSegments.length - 1;
        
        if (isSpeaking && speechSegments.length > 0) {
          currentSegmentDisplay.textContent = `${currentSegmentIndex + 1} / ${speechSegments.length}`;
        } else {
          currentSegmentDisplay.textContent = '- / -';
        }
      }

      // 朗讀單一段落
      function speakSegment(index) {
        // 🔧 修復：檢查是否仍在朗讀狀態
        if (!isSpeaking) {
          return;
        }
        
        if (index >= speechSegments.length) {
          // 朗讀完成
          stopSpeech();
          clearSpeechProgress();
          clearHighlight();
          speechProgressText.textContent = '✅ 朗讀完成';
          return;
        }
        
        currentSegmentIndex = index;
        saveSpeechProgress(); // 儲存當前進度
        updateNavButtons();
        
        // 高亮目前段落
        highlightCurrentSegment(index);
        
        const text = speechSegments[index];
        const params = analyzeEmotion(text);
        
        // 前處理文字以改善朗讀效果
        const processedText = preprocessTextForSpeech(text);
        
        // 如果處理後文字為空，跳到下一段
        if (!processedText || processedText.trim().length === 0) {
          if (isSpeaking && !isPaused) {
            setTimeout(() => speakSegment(index + 1), 100);
          }
          return;
        }
        
        // 更新進度
        const progress = ((index + 1) / speechSegments.length) * 100;
        speechProgressFill.style.width = progress + '%';
        speechProgressText.textContent = `正在朗讀 ${index + 1}/${speechSegments.length} 段...`;
        currentSegmentDisplay.textContent = `${index + 1} / ${speechSegments.length}`;
        
        // 使用瀏覽器內建語音
        speakWithBrowser(processedText, params, index);
      }
      
      // 使用瀏覽器內建語音朗讀
      // 追蹤是否已經預熱過語音引擎
      let speechEngineWarmedUp = false;
      let lastSpeechTime = 0;
      
      function speakWithBrowser(processedText, params, index) {
        // 🔧 修復：確保在開始前檢查狀態
        if (!isSpeaking) {
          return;
        }
        
        // 設定語音（如果找不到選定的語音，使用第一個可用語音）
        let selectedVoice = availableVoices.find(v => v.name === voiceSelect.value);
        if (!selectedVoice && availableVoices.length > 0) {
          selectedVoice = availableVoices[0];
          console.log('使用預設語音：', selectedVoice.name);
        }
        
        // 🔧 修復首字被吃掉的多重策略
        // 策略1: 在文本前加入不可見的前導字符（零寬空格 + 逗號）
        // 策略2: 確保語音引擎已預熱
        // 策略3: 添加微小延遲讓引擎準備好
        
        const now = Date.now();
        const timeSinceLastSpeech = now - lastSpeechTime;
        
        // 如果距離上次朗讀超過 3 秒，需要重新預熱
        const needsWarmup = !speechEngineWarmedUp || timeSinceLastSpeech > 3000;
        
        // 在文本前加入緩衝字符
        // 使用空格作為緩衝，不會被朗讀出聲音但能保護首字
        // 多個零寬空格 + 普通空格組合效果最佳
        const bufferedText = '\u200B\u200B \u200B' + processedText;
        
        function createAndPlayUtterance(text, isMain = true) {
          const utterance = new SpeechSynthesisUtterance(text);
          if (selectedVoice) utterance.voice = selectedVoice;
          
          utterance.rate = params.rate;
          utterance.pitch = params.pitch;
          utterance.volume = isMain ? params.volume : 0.01;
          
          if (isMain) {
            utterance.onstart = () => {
              lastSpeechTime = Date.now();
              speechEngineWarmedUp = true;
            };
            
            utterance.onend = () => {
              lastSpeechTime = Date.now();
              // 🔧 修復：確保在停止後不會繼續播放
              if (!isSpeaking) {
                return;
              }
              // 段落間停頓
              setTimeout(() => {
                if (isSpeaking && !isPaused) {
                  speakSegment(index + 1);
                }
              }, params.pause);
            };
            
            utterance.onerror = (e) => {
              // 忽略 interrupted 錯誤（使用者主動停止）
              if (e.error === 'interrupted' || e.error === 'canceled') {
                return;
              }
              console.warn('朗讀警告：', e.error, '段落：', index);
              // 🔧 修復：確保在停止後不會繼續播放
              if (!isSpeaking) {
                return;
              }
              // 嘗試繼續下一段
              if (isSpeaking && !isPaused) {
                setTimeout(() => speakSegment(index + 1), 100);
              }
            };
            
            currentUtterance = utterance;
          }
          
          return utterance;
        }
        
        // 🔧 修復：簡化預熱機制，確保第一次播放更可靠
        if (needsWarmup) {
          // 預熱策略：先播放一個靜音的短句
          const warmupUtterance = new SpeechSynthesisUtterance(' ');
          if (selectedVoice) warmupUtterance.voice = selectedVoice;
          warmupUtterance.rate = 10; // 最快速度
          warmupUtterance.volume = 0; // 完全靜音
          
          let mainUtterancePlayed = false;
          const playMain = () => {
            // 🔧 修復：確保只播放一次，並且檢查狀態
            if (mainUtterancePlayed || !isSpeaking) return;
            mainUtterancePlayed = true;
            speechEngineWarmedUp = true;
            
            const mainUtterance = createAndPlayUtterance(bufferedText, true);
            if (isSpeaking && !isPaused) {
              speechSynth.speak(mainUtterance);
            }
          };
          
          warmupUtterance.onstart = () => {
            // 預熱開始後立即播放實際內容（不等待結束）
            setTimeout(playMain, 10);
          };
          
          warmupUtterance.onend = () => {
            playMain();
          };
          
          warmupUtterance.onerror = () => {
            // 預熱失敗也繼續播放
            playMain();
          };
          
          // 設置超時保護，確保即使預熱失敗也能播放
          setTimeout(() => {
            playMain();
          }, 100);
          
          // 開始預熱
          try {
            speechSynth.speak(warmupUtterance);
          } catch (e) {
            console.warn('預熱失敗，直接播放：', e);
            playMain();
          }
        } else {
          // 已預熱，直接播放（仍然使用緩衝文本）
          const mainUtterance = createAndPlayUtterance(bufferedText, true);
          if (isSpeaking && !isPaused) {
            speechSynth.speak(mainUtterance);
          }
        }
      }
      

      // 更新段落範圍輸入的最大值
      function updateSegmentInputs() {
        const text = resultDiv.textContent || latestStory || '';
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

      // 開始/暫停朗讀
      function toggleSpeech() {
        // 檢查瀏覽器支援
        if (!speechSynth) {
          showStatus('error', '您的瀏覽器不支援朗讀功能');
          return;
        }
        
        if (!latestStory) {
          showStatus('error', '沒有可朗讀的內容，請先生成故事');
          return;
        }
        
        // 檢查是否有可用語音
        if (availableVoices.length === 0) {
          // 嘗試重新載入語音
          loadVoices();
          if (availableVoices.length === 0) {
            showStatus('error', '未找到可用語音，請檢查系統語音設定或重新整理頁面');
            console.warn('無可用語音。請確認：1) 系統已安裝中文語音 2) 瀏覽器允許語音合成');
            return;
          }
        }
        
        // 🔧 修復：更清晰的狀態判斷
        if (isSpeaking) {
          if (!isPaused) {
            // 正在朗讀 → 暫停
            if (speechSynth.speaking) {
              speechSynth.pause();
            }
            isPaused = true;
            saveSpeechProgress(); // 暫停時儲存進度
            playPauseBtn.textContent = '▶️ 繼續朗讀';
            speechProgressText.textContent = '⏸️ 已暫停';
          } else {
            // 已暫停 → 繼續
            if (speechSynth.paused) {
              speechSynth.resume();
            }
            isPaused = false;
            playPauseBtn.textContent = '⏸️ 暫停';
            speechProgressText.textContent = `正在朗讀 ${currentSegmentIndex + 1}/${speechSegments.length} 段...`;
          }
          return;
        }
        
        // 未在朗讀 → 開始新朗讀
        {
          // 開始新朗讀
          const text = resultDiv.textContent || latestStory;
          const allSegments = splitTextToSegments(text);
          
          if (allSegments.length === 0) {
            showStatus('error', '沒有可朗讀的內容');
            return;
          }
          
          // 獲取段落範圍
          const startInput = document.getElementById('startSegment');
          const endInput = document.getElementById('endSegment');
          let startIdx = parseInt(startInput.value) - 1 || 0;
          let endIdx = parseInt(endInput.value) || allSegments.length;
          
          // 驗證範圍
          startIdx = Math.max(0, Math.min(startIdx, allSegments.length - 1));
          endIdx = Math.max(startIdx + 1, Math.min(endIdx, allSegments.length));
          
          // 只選取指定範圍的段落
          speechSegments = allSegments.slice(startIdx, endIdx);
          
          if (speechSegments.length === 0) {
            showStatus('error', '沒有可朗讀的內容');
            return;
          }
          
          // 檢查是否有儲存的進度（只在朗讀全部時檢查）
          const savedProgress = loadSpeechProgress();
          let startIndex = 0;
          
          const isReadingAll = startIdx === 0 && endIdx === allSegments.length;
          
          if (isReadingAll && savedProgress && savedProgress.segmentIndex > 0 && savedProgress.segmentIndex < speechSegments.length) {
            // 詢問是否從上次位置繼續
            const resumeFromSaved = confirm(`發現上次朗讀進度（第 ${savedProgress.segmentIndex + 1}/${speechSegments.length} 段）\n\n點擊「確定」從上次位置繼續\n點擊「取消」從頭開始`);
            
            if (resumeFromSaved) {
              startIndex = savedProgress.segmentIndex;
              // 恢復設定
              if (savedProgress.rate) speechRate.value = savedProgress.rate;
              if (savedProgress.pitch) speechPitch.value = savedProgress.pitch;
              if (savedProgress.emotion) emotionMode.value = savedProgress.emotion;
              rateValue.textContent = speechRate.value + 'x';
              pitchValue.textContent = speechPitch.value;
              // 語音需要在語音列表載入後設定
              setTimeout(() => {
                if (savedProgress.voice && availableVoices.find(v => v.name === savedProgress.voice)) {
                  voiceSelect.value = savedProgress.voice;
                }
              }, 100);
            } else {
              clearSpeechProgress();
            }
          }
          
          // 🔧 修復：確保在開始前清除任何殘留狀態
          if (speechSynth.speaking || speechSynth.paused) {
            speechSynth.cancel();
          }
          
          isSpeaking = true;
          isPaused = false;
          playPauseBtn.textContent = '⏸️ 暫停';
          startSpeechKeepAlive(); // 啟動 Chrome bug workaround
          
          // 給朗讀按鈕添加視覺提示
          speakBtn.classList.add('active-task');
          
          // 顯示朗讀範圍
          if (!isReadingAll) {
            speechProgressText.textContent = `朗讀範圍：第 ${startIdx + 1} - ${endIdx} 段`;
          } else {
            speechProgressText.textContent = `準備開始朗讀...`;
          }
          
          // 🔧 修復：使用 setTimeout 確保狀態已設置完成
          setTimeout(() => {
            if (isSpeaking && !isPaused) {
              speakSegment(startIndex);
            }
          }, 10);
        }
      }

      // 停止朗讀
      function stopSpeech() {
        // 🔧 修復：先恢復再取消，確保語音引擎狀態正確
        if (isPaused && speechSynth.paused) {
          speechSynth.resume();
        }
        speechSynth.cancel();
        
        // 重置所有狀態
        isSpeaking = false;
        isPaused = false;
        speechEngineWarmedUp = false; // 重置預熱狀態
        currentUtterance = null;
        stopSpeechKeepAlive(); // 停止 Chrome bug workaround
        saveSpeechProgress(); // 停止時也儲存進度
        
        // 移除朗讀按鈕視覺提示
        speakBtn.classList.remove('active-task');
        playPauseBtn.textContent = '▶️ 開始朗讀';
        speechProgressFill.style.width = '0%';
        speechProgressText.textContent = '準備就緒';
        currentSegmentDisplay.textContent = '- / -';
        clearHighlight();
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
      
      // 跳到上一段
      function prevSegment() {
        if (!isSpeaking || currentSegmentIndex <= 0) return;
        // 🔧 修復：確保正確停止當前播放
        if (speechSynth.speaking || speechSynth.paused) {
          speechSynth.cancel();
        }
        isPaused = false;
        currentUtterance = null;
        speakSegment(currentSegmentIndex - 1);
      }
      
      // 跳到下一段
      function nextSegment() {
        if (!isSpeaking || currentSegmentIndex >= speechSegments.length - 1) return;
        // 🔧 修復：確保正確停止當前播放
        if (speechSynth.speaking || speechSynth.paused) {
          speechSynth.cancel();
        }
        isPaused = false;
        currentUtterance = null;
        speakSegment(currentSegmentIndex + 1);
      }
      
      // 跳轉到指定段落（透過進度條點擊）
      function jumpToSegment(segmentIndex) {
        if (!isSpeaking || segmentIndex < 0 || segmentIndex >= speechSegments.length) return;
        // 🔧 修復：確保正確停止當前播放
        if (speechSynth.speaking || speechSynth.paused) {
          speechSynth.cancel();
        }
        isPaused = false;
        currentUtterance = null;
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
      speakBtn.addEventListener('click', () => {
        speechModal.classList.add('open');
        
        // 調試：檢查語音狀態
        console.log('🎙️ 朗讀面板開啟');
        console.log('  - 可用語音數量:', availableVoices.length);
        console.log('  - 語音合成支援:', !!speechSynth);
        console.log('  - 故事內容長度:', (latestStory || '').length);
        
        // 如果沒有語音，嘗試重新載入
        if (availableVoices.length === 0) {
          console.log('  - 嘗試重新載入語音...');
          loadVoices();
        }
        
        // 更新段落資訊
        updateSegmentInputs();
        updateNavButtons();
        
        // 檢查是否有儲存的進度，顯示提示
        const savedProgress = loadSpeechProgress();
        if (savedProgress && savedProgress.segmentIndex > 0 && !isSpeaking) {
          speechProgressText.textContent = `📍 上次進度：第 ${savedProgress.segmentIndex + 1} 段`;
        }
        
        // 如果沒有可用語音，顯示提示
        if (availableVoices.length === 0) {
          speechProgressText.textContent = '⚠️ 未偵測到語音，請重新整理頁面或檢查系統語音設定';
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
        if (!isSpeaking || speechSegments.length === 0) return;
        
        const rect = speechProgressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const targetIndex = Math.floor(percentage * speechSegments.length);
        
        jumpToSegment(Math.max(0, Math.min(targetIndex, speechSegments.length - 1)));
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
        speechSynth.cancel();
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

      // ==================== 閱讀區氛圍切換（圖書館 / 咖啡廳） ====================
      const readingScene = document.getElementById('readingScene');
      if (readingScene) {
        const ambianceBtns = readingScene.querySelectorAll('.ambiance-btn');
        const applyAmbiance = (mode) => {
          const value = (mode === 'cafe') ? 'cafe' : 'library';
          readingScene.dataset.ambiance = value;
          ambianceBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.ambiance === value);
          });
          try { localStorage.setItem('readingAmbiance', value); } catch (e) {}
        };
        ambianceBtns.forEach(btn => {
          btn.addEventListener('click', () => applyAmbiance(btn.dataset.ambiance));
        });
        applyAmbiance(localStorage.getItem('readingAmbiance') || 'library');
      }

      // ==================== 字體大小調整 ====================
      function setFontSize(size) {
        document.getElementById('result').style.fontSize = size + 'px';
        document.getElementById('result').style.lineHeight = (size * 0.11 + 1.1).toFixed(2);
        fontSizeValue.textContent = size + 'px';
        localStorage.setItem('readingFontSize', size);
      }

      // 載入儲存的字體大小
      const savedFontSize = localStorage.getItem('readingFontSize') || 18;
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
          scrollVerticalToStart(true);
        } else if (resultDiv) {
          verticalScrollToStartPending = false;
          unbindVerticalStartScrollObserver();
          resultDiv.style.height = '';
          resultDiv.style.width = '';
          resultDiv.style.minWidth = '';
          resultDiv.style.display = '';
        }
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
        const ending = endingSelect.value.trim();
        
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
${pacing ? `節奏：${pacing}` : ''}
${emotionalTone ? `基調：${emotionalTone}` : ''}
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

${structureSection}

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
          // 串流即時顯示大綱
          outlineContent.style.display = 'block';
          outlineContent.textContent = '';
          const outlineText = (await callDeepSeek(prompt, null, model, {
            signal,
            onChunk: (full) => { outlineContent.textContent = full; }
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
        const existingNotes = notesInput.value.trim();
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

      // ==================== 輸入驗證增強 ====================
      function validateInputs() {
        let isValid = true;
        const requiredFields = [
          { element: themeSelect, name: '主題' },
          { element: settingSelect, name: '背景設定' }
        ];

        requiredFields.forEach(field => {
          if (!field.element.value.trim()) {
            field.element.classList.add('input-error');
            setTimeout(() => field.element.classList.remove('input-error'), 1000);
            isValid = false;
          }
        });

        return isValid;
      }

      // 在生成按鈕添加驗證
      const originalGenerateClick = generateBtn.onclick;
      generateBtn.addEventListener('click', (e) => {
        if (!validateInputs()) {
          e.stopPropagation();
          showStatus('warning', '請填寫必要欄位（主題和背景設定）');
          setTimeout(hideStatus, 3000);
        }
      }, true);


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
        const measure = document.getElementById('bookMeasure');

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
          // 等版面就緒再分頁
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              pos = 0;
              paginate();
              render();
            });
          });
        }

        function close() {
          overlay.classList.remove('open');
        }

        let resizeTimer = null;
        window.addEventListener('resize', () => {
          if (!overlay.classList.contains('open')) return;
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => { paginate(); render(); }, 200);
        });

        openBtn.addEventListener('click', () => { if (!openBtn.disabled) open(); });
        closeBtn.addEventListener('click', close);
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
          perChapterHint.textContent = `📐 約每章 ${per.toLocaleString()} 字（共 ${c} 章 ／ 總 ${l.toLocaleString()} 字）`;
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
          primaryActionHint.textContent = '請至少設定一項（主題／背景／人物／特殊元素…），或先按右側「隨機填充」。';
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
         角色原型模板 + AI 生成人物
         ============================================================ */
      const characterArchetypes = [
        { id: 'hero',     label: '熱血主角',   gender: '男',   age: '18', personality: '正直衝動、永不放棄', goal: '守護重要的人並變強', weakness: '容易為情緒所驅', secret: '身上流著被詛咒的血脈', relation: '與宿敵有血緣牽連' },
        { id: 'heroine',  label: '堅毅女主',   gender: '女',   age: '20', personality: '聰慧冷靜、外冷內熱', goal: '查明家族滅門的真相', weakness: '不擅長表達情感', secret: '其實是失落王室的後裔', relation: '與主角亦敵亦友' },
        { id: 'mentor',   label: '睿智導師',   gender: '男',   age: '58', personality: '溫和深沉、洞悉世事', goal: '引導後輩完成自己未竟之志', weakness: '舊傷使其無法再戰', secret: '曾是當年釀成大禍的關鍵人物', relation: '主角已故師父的舊識' },
        { id: 'rival',    label: '宿敵勁敵',   gender: '男',   age: '22', personality: '高傲自負、實力超群', goal: '證明自己才是最強', weakness: '輸不起、過度執著勝負', secret: '童年曾受主角一家恩惠', relation: '與主角互為鏡像' },
        { id: 'villain',  label: '魅力反派',   gender: '不明', age: '40', personality: '優雅殘酷、深謀遠慮', goal: '重塑秩序、登上權力頂點', weakness: '無法原諒背叛', secret: '其惡行源自一場無法挽回的悲劇', relation: '與導師有不可告人的過往' },
        { id: 'sidekick', label: '搞笑夥伴',   gender: '男',   age: '19', personality: '樂觀貧嘴、義氣深重', goal: '陪主角闖出一片天', weakness: '膽小、關鍵時刻易慌', secret: '默默暗戀著隊伍中的某人', relation: '主角青梅竹馬般的死黨' },
        { id: 'mystery',  label: '神祕少女',   gender: '女',   age: '16', personality: '沉默寡言、難以捉摸', goal: '尋找失去的記憶', weakness: '力量失控時會傷及無辜', secret: '她並非真正的人類', relation: '命運與主角緊緊相繫' }
      ];

      const characterTemplateSelect = document.getElementById('characterTemplateSelect');
      const applyCharacterTemplateBtn = document.getElementById('applyCharacterTemplateBtn');
      const aiGenerateCharactersBtn = document.getElementById('aiGenerateCharactersBtn');

      if (characterTemplateSelect) {
        characterArchetypes.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.label;
          characterTemplateSelect.appendChild(opt);
        });
      }

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

      // 套用人物模板（新增一列並填入原型）
      if (applyCharacterTemplateBtn) {
        applyCharacterTemplateBtn.addEventListener('click', () => {
          const id = characterTemplateSelect.value;
          if (!id) { showStatus('info', '請先選擇一個角色原型模板'); return; }
          const arch = characterArchetypes.find(a => a.id === id);
          if (!arch) return;
          addCharacterRow(false);
          const row = charactersContainer.lastElementChild;
          fillCharacterRow(row, arch);
          updateCharacterIndices();
          saveSettingsToLocal();
          showStatus('success', `已套用「${arch.label}」模板`);
        });
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
            const hintBlock = hints.length
              ? `\n\n可參考使用者已提供的方向（盡量融入、保持協調，但以劇情合理為優先；可自由調整）：\n${JSON.stringify(hints, null, 0)}`
              : '';
            const prompt = `你是專業小說人物設計師。請依以下故事設定，「完整設計」剛好 ${count} 位人物，要彼此關聯、有戲劇張力且貼合劇情。請為角色群安排合理的「角色定位」：通常含 1 位男主角或女主角（視劇情可有雙主角），其餘搭配男配角、女配角、反派或配角，分工分明、避免全部都是主角。每位的所有欄位都要填寫完整、具體、避免空泛，讓使用者可直接使用並微調。\n${ctx}${hintBlock}\n\n只回傳 JSON 陣列，長度必須剛好為 ${count}，不要任何說明文字。每個元素格式如下：\n{"gender":"男/女/不明","role":"男主角/女主角/男配角/女配角/反派/配角 擇一","age":"數字或描述","name":"姓名","personality":"個性（具體，10~20字）","goal":"核心目標（具體）","weakness":"弱點/罩門","secret":"不可告人的祕密","relation":"與其他角色的關係（請點名其他角色）"}`;
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
          const prompt = `你是小說人物設計師。故事設定：${ctx}。\n以下是一位人物目前的部分資料（空白欄位需要你補完，已有內容請盡量保留並使其協調）：\n${JSON.stringify(cur)}\n\n只回傳單一 JSON 物件，格式：{"gender":"","role":"男主角/女主角/男配角/女配角/反派/配角 擇一","age":"","name":"","personality":"","goal":"","weakness":"","secret":"","relation":""}`;
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
