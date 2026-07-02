/* ============================================================
   AI 小說工坊 — Service Worker
   - 可變資源（HTML / JS / CSS）：Network First，部署後自動取得新版
   - 圖示 / 字型：Cache First，離線仍可用
   - /api/* 不走 SW
   ============================================================ */

const CACHE_VERSION = 'v76';
const CACHE_NAME = `novel-workshop-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/layout-polish.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/** 會隨部署變更的資源 → 永遠先問網路 */
function isMutableAsset(pathname) {
  if (pathname === '/' || pathname.endsWith('/')) return true;
  if (pathname.endsWith('.html')) return true;
  if (pathname.endsWith('.webmanifest')) return true;
  if (pathname.endsWith('/sw.js') || pathname.endsWith('sw.js')) return true;
  if (pathname.includes('/js/') && pathname.endsWith('.js')) return true;
  if (pathname.includes('/css/') && pathname.endsWith('.css')) return true;
  return false;
}

/** 圖示、字型等較少變動的資源 */
function isStaticAsset(pathname) {
  if (pathname.includes('/icons/')) return true;
  if (pathname.includes('/assets/')) return true;
  return false;
}

/** 體積大但可快取的程式碼資源（JS / CSS）→ 適合 Stale-While-Revalidate */
function isCodeAsset(pathname) {
  if (pathname.includes('/js/') && pathname.endsWith('.js')) return true;
  if (pathname.includes('/css/') && pathname.endsWith('.css')) return true;
  return false;
}

/**
 * Stale-While-Revalidate：有快取就「立即」回傳（重複載入秒開），
 * 同時在背景抓最新版寫回快取，下次載入即為新版。
 */
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((cached) => {
      const fetching = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetching;
    })
  );
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function cacheFirst(request, url) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request)
      .then((response) => {
        if (
          response &&
          response.status === 200 &&
          (url.origin === self.location.origin ||
            url.hostname.endsWith('gstatic.com') ||
            url.hostname.endsWith('googleapis.com'))
        ) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => cached);
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (/\/reader(\/|$)/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 大型程式碼資源（JS / CSS）：快取優先、背景更新 → 重複載入秒開
  if (isCodeAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 其餘可變資源（HTML / manifest / sw.js）：維持先問網路，確保即時為新版
  if (isMutableAsset(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url.pathname) || url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, url));
    return;
  }

  // 外部字型等
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    event.respondWith(cacheFirst(request, url));
  }
});
