/**
 * GitHub Pages 書庫同步 — 透過 GitHub Contents API 讀寫 novels/
 * Token 仅存 localStorage，需 repo 權限（Contents: Read and write）
 */
(function (global) {
  'use strict';

  var REPO = 'polo1364/NovelGenerator';
  var BRANCH = 'main';
  var TOKEN_KEY = 'novelReader.ghToken';
  var AUTO_SYNC_KEY = 'novelReader.ghAutoSync';
  var REMOTE_VER_KEY = 'novelReader.remoteVer.';

  function isLocalEnvironment() {
    if (location.protocol === 'file:') return true;
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1';
  }

  /** 上傳 UI 僅本機顯示；GitHub Pages 訪客只讀拉取 */
  if (!isLocalEnvironment()) {
    document.documentElement.classList.add('no-gh-sync');
  }

  function getBasePath() {
    var path = location.pathname.replace(/\\/g, '/');
    var low = path.toLowerCase();
    var idx = low.indexOf('/novelgenerator');
    if (idx >= 0) {
      var base = path.substring(0, idx + '/NovelGenerator'.length);
      return base.endsWith('/') ? base : base + '/';
    }
    if (location.protocol === 'file:') {
      var dir = path.replace(/\/[^/]*$/, '/');
      return dir;
    }
    return '/';
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(v) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function getAutoSync() {
    return localStorage.getItem(AUTO_SYNC_KEY) === '1';
  }

  function setAutoSync(v) {
    localStorage.setItem(AUTO_SYNC_KEY, v ? '1' : '0');
  }

  function encodeRepoPath(repoPath) {
    return String(repoPath).split('/').map(function (p) { return encodeURIComponent(p); }).join('/');
  }

  /** 從輸入框讀取並儲存 Token（貼上後不必再點其他地方） */
  function saveTokenFromInput(tokenEl) {
    if (!tokenEl) return getToken();
    var v = tokenEl.value.trim();
    if (v && v.indexOf('•') !== 0) {
      setToken(v);
      tokenEl.value = '••••••••••••••••';
      return v;
    }
    return getToken();
  }

  async function ghApi(path, opts) {
    var token = getToken();
    if (!token) throw new Error('請先設定 GitHub Token');
    var res = await fetch('https://api.github.com' + path, Object.assign({}, opts || {}, {
      headers: Object.assign({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28'
      }, opts && opts.headers ? opts.headers : {})
    }));
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var msg = data.message || 'GitHub API ' + res.status;
      if (data.errors && data.errors[0] && data.errors[0].message) msg = data.errors[0].message;
      throw new Error(msg);
    }
    return data;
  }

  async function getFileSha(repoPath) {
    try {
      var data = await ghApi('/repos/' + REPO + '/contents/' + encodeRepoPath(repoPath) + '?ref=' + BRANCH);
      return data.sha;
    } catch (e) {
      return null;
    }
  }

  async function putContent(repoPath, content, message) {
    var sha = await getFileSha(repoPath);
    var body = {
      message: message,
      content: utf8ToBase64(content),
      branch: BRANCH
    };
    if (sha) body.sha = sha;
    return ghApi('/repos/' + REPO + '/contents/' + repoPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function fetchManifest() {
    var url = getBasePath() + 'novels/manifest.json?t=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) return { novels: [] };
      return res.json();
    });
  }

  function fetchNovelText(file) {
    var url = getBasePath() + 'novels/' + encodeURIComponent(file) + '?t=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('無法載入 ' + file);
      return res.text();
    });
  }

  function sanitizeFilename(title, multiVol) {
    var name = String(title || 'novel').replace(/[\\/:*?"<>|]/g, '_').trim() || 'novel';
    return multiVol ? name + '_全系列.txt' : name + '.txt';
  }

  function buildManifestEntry(series, sortVolumes, seriesToTxt) {
    var vols = sortVolumes(series.volumes);
    var file = sanitizeFilename(series.title, vols.length > 1);
    return {
      id: series.id,
      title: series.title,
      file: file,
      updatedAt: Date.now(),
      volumes: vols.length
    };
  }

  async function pushAllSeries(seriesList, sortVolumes, seriesToTxt) {
    if (!seriesList.length) throw new Error('書櫃是空的');
    var entries = [];
    for (var i = 0; i < seriesList.length; i++) {
      var s = seriesList[i];
      var entry = buildManifestEntry(s, sortVolumes, seriesToTxt);
      var content = seriesToTxt(s);
      await putContent('novels/' + entry.file, content, 'Sync: ' + s.title);
      entries.push(entry);
      try {
        localStorage.setItem(REMOTE_VER_KEY + entry.id, String(entry.updatedAt));
      } catch (e) { /* ignore */ }
    }
    var manifest = JSON.stringify({ novels: entries }, null, 2) + '\n';
    await putContent('novels/manifest.json', manifest, 'Update novels manifest');
    return entries.length;
  }

  async function pullRemote(importFn, sortVolumes) {
    var manifest = await fetchManifest();
    var list = manifest.novels || [];
    var count = 0;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n || !n.file || n.id === 'sample') continue;
      var remoteVer = n.updatedAt || 0;
      var localVer = parseInt(localStorage.getItem(REMOTE_VER_KEY + n.id) || '0', 10);
      if (remoteVer > 0 && remoteVer <= localVer) continue;
      var text = await fetchNovelText(n.file);
      await importFn(text, { filename: n.file, seriesTitle: n.title, remoteId: n.id, remoteVer: remoteVer });
      try {
        localStorage.setItem(REMOTE_VER_KEY + n.id, String(remoteVer || Date.now()));
      } catch (e) { /* ignore */ }
      count++;
    }
    return count;
  }

  function bindUi(api) {
    var panel = document.querySelector('.gh-sync-panel');
    if (!isLocalEnvironment()) {
      if (panel) panel.hidden = true;
      return;
    }
    var tokenEl = document.getElementById('ghToken');
    var autoEl = document.getElementById('ghAutoSync');
    var pullBtn = document.getElementById('ghPullBtn');
    var pushBtn = document.getElementById('ghPushBtn');
    var statusEl = document.getElementById('ghSyncStatus');
    if (!tokenEl) return;

    if (getToken()) tokenEl.value = '••••••••••••••••';
    autoEl.checked = getAutoSync();

    tokenEl.addEventListener('focus', function () {
      if (tokenEl.value.indexOf('•') === 0) tokenEl.value = getToken();
    });

    tokenEl.addEventListener('blur', function () {
      if (saveTokenFromInput(tokenEl)) setStatus('Token 已儲存（僅本機）');
    });

    tokenEl.addEventListener('paste', function () {
      setTimeout(function () {
        if (saveTokenFromInput(tokenEl)) setStatus('Token 已儲存（僅本機）');
      }, 0);
    });

    tokenEl.addEventListener('change', function () {
      if (saveTokenFromInput(tokenEl)) setStatus('Token 已儲存（僅本機）');
      else if (!tokenEl.value.trim()) { setToken(''); setStatus('Token 已清除'); }
    });

    autoEl.addEventListener('change', function () {
      setAutoSync(autoEl.checked);
    });

    pullBtn.addEventListener('click', function () {
      pullBtn.disabled = true;
      setStatus('正在從 GitHub 拉取…');
      pullRemote(api.importRemote, api.sortVolumes).then(function (n) {
        setStatus(n ? '已拉取 ' + n + ' 本' : '已是最新');
        api.onPullDone && api.onPullDone();
      }).catch(function (e) {
        setStatus('拉取失敗：' + e.message);
        api.toast && api.toast('拉取失敗：' + e.message);
      }).finally(function () { pullBtn.disabled = false; });
    });

    pushBtn.addEventListener('click', function () {
      var token = saveTokenFromInput(tokenEl);
      if (!token) {
        api.toast && api.toast('請先貼上 GitHub Token');
        tokenEl.focus();
        return;
      }
      if (!api.getSeriesList().length) {
        api.toast && api.toast('書櫃是空的，請先匯入小說');
        return;
      }
      pushBtn.disabled = true;
      setStatus('正在上傳到 GitHub…');
      var list = api.getSeriesList();
      pushAllSeries(list, api.sortVolumes, api.seriesToTxt).then(function (n) {
        setStatus('已同步 ' + n + ' 本到 GitHub Pages');
        api.toast && api.toast('☁️ 已同步 ' + n + ' 本（約 1–2 分鐘後網站更新）');
      }).catch(function (e) {
        setStatus('上傳失敗：' + e.message);
        api.toast && api.toast('同步失敗：' + e.message);
      }).finally(function () { pushBtn.disabled = false; });
    });

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg;
    }
  }

  global.NovelGhSync = {
    isLocalEnvironment: isLocalEnvironment,
    getBasePath: getBasePath,
    getToken: getToken,
    setToken: setToken,
    getAutoSync: getAutoSync,
    setAutoSync: setAutoSync,
    hasToken: function () { return !!getToken(); },
    fetchManifest: fetchManifest,
    fetchNovelText: fetchNovelText,
    pushAllSeries: pushAllSeries,
    pullRemote: pullRemote,
    bindUi: bindUi,
    maybeAutoSync: function (api) {
      if (!isLocalEnvironment()) return Promise.resolve();
      var tokenEl = document.getElementById('ghToken');
      saveTokenFromInput(tokenEl);
      if (!getAutoSync() || !getToken()) return Promise.resolve();
      return pushAllSeries(api.getSeriesList(), api.sortVolumes, api.seriesToTxt).then(function (n) {
        api.toast && api.toast('☁️ 已自動同步 ' + n + ' 本到 GitHub');
      }).catch(function (e) {
        api.toast && api.toast('自動同步失敗：' + e.message);
      });
    }
  };
})(window);
