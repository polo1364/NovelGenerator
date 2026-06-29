/**
 * 小說閱讀站 — Edge 神經語音朗讀（不含 DeepSeek 角色分析）
 */
(function (global) {
  'use strict';

  var api = null;
  var edgeReady = false;
  var speechInit = false;
  var isSpeaking = false;
  var isPaused = false;
  var speechQueue = [];
  var segmentParaMap = [];
  var currentIdx = 0;
  var edgeAudio = null;
  var edgeAudioUrl = null;
  var edgeAbort = null;
  var edgeSession = 0;
  var speechStartOffset = 0;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function preprocessTextForSpeech(text) {
    if (!text || !text.trim()) return '';
    var s = text.trim();
    s = s.replace(/^#+\s*/gm, '').replace(/\*+/g, '');
    s = s.replace(/[「」『』【】〈〉《》（）()\[\]{}""'']/g, '');
    s = s.replace(/[：:；;]/g, '，');
    s = s.replace(/[⋯…]+/g, '，');
    s = s.replace(/[——–—−]+/g, '，');
    s = s.replace(/[～~★☆●○◆◇■□▲△▼▽※＊*#＃@＠&＆─━┃│]+/g, '');
    s = s.replace(/，+/g, '，').replace(/。+/g, '。').replace(/\s+/g, ' ').trim();
    return s;
  }

  function splitLongText(text) {
    if (text.length <= 200) return [text];
    var out = [];
    var sentences = text.match(/[^。！？.!?\n]+[。！？.!?\n]?/g) || [text];
    var chunk = '';
    for (var i = 0; i < sentences.length; i++) {
      if ((chunk + sentences[i]).length > 150 && chunk.trim()) {
        out.push(chunk.trim());
        chunk = sentences[i];
      } else {
        chunk += sentences[i];
      }
    }
    if (chunk.trim()) out.push(chunk.trim());
    return out;
  }

  function splitTextToSegments(text) {
    var segments = [];
    if (!text) return segments;
    var paragraphs = text.split(/\n\n+/);
    paragraphs.forEach(function (para) {
      var trimmed = para.trim();
      if (!trimmed) return;
      if (trimmed.length > 200) {
        var sentences = trimmed.split(/(?<=[。！？!?])/);
        var chunk = '';
        for (var i = 0; i < sentences.length; i++) {
          if ((chunk + sentences[i]).length > 150 && chunk.trim()) {
            segments.push(chunk.trim());
            chunk = sentences[i];
          } else {
            chunk += sentences[i];
          }
        }
        if (chunk.trim()) segments.push(chunk.trim());
      } else {
        segments.push(trimmed);
      }
    });
    return segments.filter(function (s) { return s.length > 0; });
  }

  function buildChapterSegments() {
    var ch = api.getChapterContent && api.getChapterContent();
    if (!ch || !ch.length) return { segments: [], paraMap: [] };
    var segments = [];
    var paraMap = [];
    ch.forEach(function (para, pi) {
      var processed = preprocessTextForSpeech(para);
      if (!processed) return;
      var pieces = processed.length > 200 ? splitLongText(processed) : [processed];
      pieces.forEach(function (p) {
        segments.push(p);
        paraMap.push(pi);
      });
    });
    return { segments: segments, paraMap: paraMap };
  }

  function progressKey() {
    return api.getProgressKey ? api.getProgressKey() : 'default';
  }

  function saveSpeechProgress() {
    try {
      localStorage.setItem('novelReader.speech.' + progressKey(), JSON.stringify({
        segmentIndex: currentIdx,
        rate: els.speechRate.value,
        pitch: els.speechPitch.value,
        voice: els.voiceSelect.value,
        emotion: els.emotionMode.value
      }));
    } catch (e) { /* ignore */ }
  }

  function loadSpeechProgress() {
    try {
      var raw = localStorage.getItem('novelReader.speech.' + progressKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSpeechProgress() {
    try { localStorage.removeItem('novelReader.speech.' + progressKey()); } catch (e) { /* ignore */ }
  }

  function stopEdgeAudio() {
    if (edgeAudio) {
      edgeAudio.onended = null;
      edgeAudio.onerror = null;
      edgeAudio.pause();
      edgeAudio.src = '';
      edgeAudio = null;
    }
    if (edgeAudioUrl) {
      URL.revokeObjectURL(edgeAudioUrl);
      edgeAudioUrl = null;
    }
    if (edgeAbort) {
      edgeAbort.abort();
      edgeAbort = null;
    }
  }

  function stopEdgePlaybackOnly() {
    edgeSession++;
    stopEdgeAudio();
  }

  function clearHighlight() {
    if (api.clearHighlight) api.clearHighlight();
  }

  function highlightForQueueIndex(queueIdx) {
    if (!els.highlightCheck || !els.highlightCheck.checked) return;
    var item = speechQueue[queueIdx];
    if (!item || item.sourceSegmentIndex == null) return;
    var segIdx = item.sourceSegmentIndex + speechStartOffset;
    var pi = segmentParaMap[segIdx];
    if (pi == null) return;
    if (api.highlightParagraph) api.highlightParagraph(pi);
    if (els.autoScrollCheck && els.autoScrollCheck.checked && api.scrollToParagraph) {
      setTimeout(function () { api.scrollToParagraph(pi); }, 50);
    }
  }

  function updateSpeechNav() {
    els.prevSegmentBtn.disabled = !isSpeaking || currentIdx <= 0;
    els.nextSegmentBtn.disabled = !isSpeaking || currentIdx >= speechQueue.length - 1;
    if (isSpeaking && speechQueue.length) {
      els.currentSegmentDisplay.textContent = (currentIdx + 1) + ' / ' + speechQueue.length;
    } else {
      els.currentSegmentDisplay.textContent = '- / -';
    }
  }

  function updateSegmentInputs() {
    var built = buildChapterSegments();
    var total = built.segments.length;
    els.startSegment.max = total || 1;
    els.endSegment.max = total || 1;
    if (parseInt(els.endSegment.value, 10) > total || !els.endSegment.value) {
      els.endSegment.value = total || 1;
    }
    els.segmentInfo.textContent = '本章共 ' + total + ' 段';
    return built.segments;
  }

  function updateProgressUI(idx) {
    if (!speechQueue.length) return;
    var pct = ((idx + 1) / speechQueue.length) * 100;
    els.speechProgressFill.style.width = pct + '%';
    els.speechProgressText.textContent = isPaused
      ? '⏸️ 已暫停'
      : '正在朗讀 ' + (idx + 1) + '/' + speechQueue.length + ' 段…';
  }

  function speakSegment(index) {
    if (!isSpeaking) return;

    if (index >= speechQueue.length) {
      stopSpeech(true);
      els.speechProgressText.textContent = '✅ 朗讀完成';
      return;
    }

    currentIdx = index;
    saveSpeechProgress();
    updateSpeechNav();
    highlightForQueueIndex(index);

    var item = speechQueue[index] || {};
    var processed = EdgeTtsSpeech.sanitizeTtsText(
      item.text || preprocessTextForSpeech(item.text || '')
    );
    if (!processed || !processed.trim()) {
      if (isSpeaking && !isPaused) setTimeout(function () { speakSegment(index + 1); }, 100);
      return;
    }

    updateProgressUI(index);
    speakWithEdge(processed, item, index);
  }

  async function speakWithEdge(processedText, queueItem, index) {
    var session = ++edgeSession;
    stopEdgeAudio();
    edgeAbort = new AbortController();

    var voice = queueItem.voice || els.voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
    var style = queueItem.style || 'general';
    var rate = queueItem.rate != null ? queueItem.rate : parseFloat(els.speechRate.value) || 1;
    var pitch = queueItem.pitch != null ? queueItem.pitch : parseFloat(els.speechPitch.value) || 1;
    var pause = queueItem.pause || 300;

    try {
      els.speechProgressText.textContent = '正在合成 ' + (index + 1) + '/' + speechQueue.length + ' 段…';
      var buf = await EdgeTtsSpeech.synthesize({
        text: processedText,
        voice: voice,
        style: style,
        rate: rate,
        pitch: pitch,
        signal: edgeAbort.signal
      });
      if (!isSpeaking || session !== edgeSession) return;

      edgeAudioUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
      edgeAudio = new Audio(edgeAudioUrl);
      edgeAudio.onended = function () {
        stopEdgeAudio();
        if (isSpeaking && !isPaused) setTimeout(function () { speakSegment(index + 1); }, pause);
      };
      edgeAudio.onerror = function () {
        stopEdgeAudio();
        if (isSpeaking && !isPaused) setTimeout(function () { speakSegment(index + 1); }, 100);
      };
      els.speechProgressText.textContent = '正在朗讀 ' + (index + 1) + '/' + speechQueue.length + ' 段…';
      await edgeAudio.play();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('Edge 朗讀失敗:', err);
      els.speechProgressText.textContent = '第 ' + (index + 1) + ' 段合成失敗，跳過…';
      if (isSpeaking && !isPaused) setTimeout(function () { speakSegment(index + 1); }, 200);
    }
  }

  function stopSpeech(silent) {
    isSpeaking = false;
    isPaused = false;
    stopEdgePlaybackOnly();
    els.playPauseBtn.textContent = '▶️ 開始朗讀';
    els.playPauseBtn.disabled = false;
    els.speakBtn.classList.remove('active-task');
    if (!silent) {
      els.speechProgressFill.style.width = '0%';
      els.speechProgressText.textContent = '準備就緒';
      els.currentSegmentDisplay.textContent = '- / -';
    }
    clearHighlight();
    updateSpeechNav();
  }

  function resetSpeech() {
    stopSpeech();
    clearSpeechProgress();
    currentIdx = 0;
    els.startSegment.value = 1;
    updateSegmentInputs();
    els.speechProgressText.textContent = '已重置，準備從頭開始';
  }

  async function toggleSpeech() {
    if (!edgeReady) {
      edgeReady = await EdgeTtsSpeech.checkAvailable();
      if (!edgeReady) {
        if (api.toast) api.toast(location.protocol === 'file:' ? '單檔模式無法 Edge 朗讀，請 npm start 後用 localhost 開啟' : 'Edge 朗讀需啟動本機伺服器（npm start）');
        els.speechProgressText.textContent = '⚠️ 請先執行 npm start';
        return;
      }
    }

    var chapterText = api.getChapterPlainText ? api.getChapterPlainText() : '';
    if (!chapterText.trim()) {
      if (api.toast) api.toast('本章沒有可朗讀的內容');
      return;
    }

    if (isSpeaking) {
      if (!isPaused) {
        edgeAudio && edgeAudio.pause();
        isPaused = true;
        saveSpeechProgress();
        els.playPauseBtn.textContent = '▶️ 繼續朗讀';
        els.speechProgressText.textContent = '⏸️ 已暫停';
      } else {
        isPaused = false;
        els.playPauseBtn.textContent = '⏸️ 暫停';
        els.speechProgressText.textContent = '正在朗讀 ' + (currentIdx + 1) + '/' + speechQueue.length + ' 段…';
        if (edgeAudio) {
          edgeAudio.play().catch(function () { speakSegment(currentIdx); });
        } else {
          speakSegment(currentIdx);
        }
      }
      return;
    }

    var built = buildChapterSegments();
    var allSegments = built.segments;
    segmentParaMap = built.paraMap;
    if (!allSegments.length) {
      if (api.toast) api.toast('沒有可朗讀的內容');
      return;
    }

    var startIdx = parseInt(els.startSegment.value, 10) - 1 || 0;
    var endIdx = parseInt(els.endSegment.value, 10) || allSegments.length;
    startIdx = Math.max(0, Math.min(startIdx, allSegments.length - 1));
    endIdx = Math.max(startIdx + 1, Math.min(endIdx, allSegments.length));
    speechStartOffset = startIdx;

    var voiceId = els.voiceSelect.value || EdgeTtsSpeech.DEFAULT_VOICE;
    var baseRate = parseFloat(els.speechRate.value) || 1;
    var basePitch = parseFloat(els.speechPitch.value) || 1;
    var emotionMode = els.emotionMode.value;

    speechQueue = EdgeTtsSpeech.buildSimplePlayQueue(
      allSegments.slice(startIdx, endIdx),
      voiceId,
      emotionMode,
      baseRate,
      basePitch
    );

    if (!speechQueue.length) {
      if (api.toast) api.toast('沒有可朗讀的內容');
      return;
    }

    var saved = loadSpeechProgress();
    if (saved && saved.segmentIndex > 0 && saved.segmentIndex < speechQueue.length) {
      var resume = confirm(
        '發現上次朗讀進度（第 ' + (saved.segmentIndex + 1) + '/' + speechQueue.length + ' 段）\n\n要從上次位置繼續嗎？'
      );
      if (resume) {
        currentIdx = saved.segmentIndex;
        if (saved.rate) els.speechRate.value = saved.rate;
        if (saved.pitch) els.speechPitch.value = saved.pitch;
        if (saved.voice && els.voiceSelect.querySelector('option[value="' + saved.voice + '"]')) {
          els.voiceSelect.value = saved.voice;
        }
        if (saved.emotion) els.emotionMode.value = saved.emotion;
        els.rateValue.textContent = parseFloat(els.speechRate.value).toFixed(1) + 'x';
        els.pitchValue.textContent = parseFloat(els.speechPitch.value).toFixed(1);
      } else {
        currentIdx = 0;
        clearSpeechProgress();
      }
    } else {
      currentIdx = 0;
    }

    isSpeaking = true;
    isPaused = false;
    els.playPauseBtn.textContent = '⏸️ 暫停';
    els.speakBtn.classList.add('active-task');
    els.speechProgressText.textContent = '朗讀範圍：第 ' + (startIdx + 1) + ' - ' + endIdx + ' 段';
    updateSpeechNav();
    speakSegment(currentIdx);
  }

  function prevSegment() {
    if (!isSpeaking || currentIdx <= 0) return;
    stopEdgePlaybackOnly();
    isPaused = false;
    speakSegment(currentIdx - 1);
  }

  function nextSegment() {
    if (!isSpeaking || currentIdx >= speechQueue.length - 1) return;
    stopEdgePlaybackOnly();
    isPaused = false;
    speakSegment(currentIdx + 1);
  }

  function jumpToSegment(idx) {
    if (!isSpeaking || idx < 0 || idx >= speechQueue.length) return;
    stopEdgePlaybackOnly();
    isPaused = false;
    speakSegment(idx);
  }

  async function loadVoices() {
    await EdgeTtsSpeech.fetchVoices();
    EdgeTtsSpeech.populateVoiceSelect(els.voiceSelect);
    speechInit = true;
  }

  function bindEvents() {
    els.speakBtn.addEventListener('click', async function () {
      els.speechModal.classList.add('open');
      if (!speechInit) await loadVoices();
      updateSegmentInputs();
      updateSpeechNav();
      if (!edgeReady) {
        edgeReady = await EdgeTtsSpeech.checkAvailable();
        if (!edgeReady) {
          els.speechProgressText.textContent = '⚠️ 請先執行 npm start 以使用 Edge 朗讀';
        }
      }
    });

    els.closeSpeechModal.addEventListener('click', function () {
      els.speechModal.classList.remove('open');
      if (isSpeaking && api.toast) api.toast('🔊 朗讀繼續中…');
    });

    els.speechModal.addEventListener('click', function (e) {
      if (e.target === els.speechModal) {
        els.speechModal.classList.remove('open');
        if (isSpeaking && api.toast) api.toast('🔊 朗讀繼續中…');
      }
    });

    els.playPauseBtn.addEventListener('click', toggleSpeech);
    els.stopSpeechBtn.addEventListener('click', function () { stopSpeech(); });
    els.resetSpeechBtn.addEventListener('click', resetSpeech);
    els.prevSegmentBtn.addEventListener('click', prevSegment);
    els.nextSegmentBtn.addEventListener('click', nextSegment);

    els.speechProgressBar.addEventListener('click', function (e) {
      if (!isSpeaking || !speechQueue.length) return;
      var rect = els.speechProgressBar.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      jumpToSegment(Math.max(0, Math.min(Math.floor(pct * speechQueue.length), speechQueue.length - 1)));
    });

    els.readAllBtn.addEventListener('click', function () {
      els.startSegment.value = 1;
      updateSegmentInputs();
    });

    els.startSegment.addEventListener('change', function () {
      if (parseInt(this.value, 10) > parseInt(els.endSegment.value, 10)) {
        els.endSegment.value = this.value;
      }
      if (parseInt(this.value, 10) < 1) this.value = 1;
    });

    els.endSegment.addEventListener('change', function () {
      if (parseInt(this.value, 10) < parseInt(els.startSegment.value, 10)) {
        this.value = els.startSegment.value;
      }
    });

    els.speechRate.addEventListener('input', function () {
      els.rateValue.textContent = parseFloat(els.speechRate.value).toFixed(1) + 'x';
    });

    els.speechPitch.addEventListener('input', function () {
      els.pitchValue.textContent = parseFloat(els.speechPitch.value).toFixed(1);
    });

    document.querySelectorAll('.speed-btn[data-speed]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = parseFloat(els.speechRate.value) + parseFloat(btn.dataset.speed);
        v = Math.max(0.25, Math.min(3, v));
        els.speechRate.value = v.toFixed(2);
        els.rateValue.textContent = v.toFixed(1) + 'x';
      });
    });

    document.querySelectorAll('.speed-btn[data-pitch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = parseFloat(els.speechPitch.value) + parseFloat(btn.dataset.pitch);
        v = Math.max(0.5, Math.min(2, v));
        els.speechPitch.value = v.toFixed(2);
        els.pitchValue.textContent = v.toFixed(1);
      });
    });

    els.voiceSelect.addEventListener('change', function () {
      try { localStorage.setItem('edgeSpeechVoice', els.voiceSelect.value); } catch (e) { /* ignore */ }
    });

    els.copyChapterBtn.addEventListener('click', function () {
      var text = api.getChapterPlainText ? api.getChapterPlainText() : '';
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        if (api.toast) api.toast('📋 已複製本章全文');
      }).catch(function () {
        if (api.toast) api.toast('複製失敗');
      });
    });

    window.addEventListener('beforeunload', function () {
      if (isSpeaking || currentIdx > 0) saveSpeechProgress();
      stopEdgeAudio();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.speechModal.classList.contains('open')) {
        els.speechModal.classList.remove('open');
      }
    });
  }

  function cacheElements() {
    els.speakBtn = $('speakBtn');
    els.speechModal = $('speechModal');
    els.closeSpeechModal = $('closeSpeechModal');
    els.voiceSelect = $('voiceSelect');
    els.speechRate = $('speechRate');
    els.speechPitch = $('speechPitch');
    els.rateValue = $('rateValue');
    els.pitchValue = $('pitchValue');
    els.emotionMode = $('emotionMode');
    els.startSegment = $('startSegment');
    els.endSegment = $('endSegment');
    els.segmentInfo = $('segmentInfo');
    els.playPauseBtn = $('playPauseBtn');
    els.stopSpeechBtn = $('stopSpeechBtn');
    els.resetSpeechBtn = $('resetSpeechBtn');
    els.prevSegmentBtn = $('prevSegmentBtn');
    els.nextSegmentBtn = $('nextSegmentBtn');
    els.currentSegmentDisplay = $('currentSegmentDisplay');
    els.speechProgressBar = $('speechProgressBar');
    els.speechProgressFill = $('speechProgressFill');
    els.speechProgressText = $('speechProgressText');
    els.autoScrollCheck = $('autoScrollCheck');
    els.highlightCheck = $('highlightCheck');
    els.readAllBtn = $('readAllBtn');
    els.copyChapterBtn = $('copyChapterBtn');
  }

  global.initReaderSpeech = function (readerApi) {
    api = readerApi;
    cacheElements();
    if (!els.speakBtn) return;

    bindEvents();
    EdgeTtsSpeech.checkAvailable().then(function (ok) {
      edgeReady = ok;
      if (!ok) els.speakBtn.title = '朗讀需啟動 npm start 伺服器';
    });
  };

  global.readerSpeechOnChapterChange = function () {
    if (isSpeaking) stopSpeech(true);
    clearHighlight();
  };

  global.readerSpeechOnLeaveReader = function () {
    if (isSpeaking) stopSpeech(true);
    els.speechModal && els.speechModal.classList.remove('open');
  };

  global.readerSpeechSetVisible = function (visible) {
    if (els.speakBtn) els.speakBtn.hidden = !visible;
  };

})(window);
