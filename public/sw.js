/* ============================================================
   AI 小說工坊 — Service Worker
   - 預快取 App Shell，支援離線開啟與閱讀
   - 靜態資源：Cache First；頁面導航：離線時回退快取的 index.html
   - /api/* 一律走網路，不快取（生成需即時呼叫後端）
   ============================================================ */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `novel-workshop-${CACHE_VERSION}`;

// App Shell：首次安裝時預快取
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只處理 GET；其餘（POST /api/chat 等）直接放行給網路
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API 一律走網路，不介入、不快取
  if (url.pathname.startsWith('/api/')) return;

  // 頁面導航：網路優先，失敗時回退快取的 index.html（支援離線開啟）
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其餘靜態資源（同源與字型 CDN）：Cache First，並在背景補快取
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // 只快取成功的同源或可快取的回應
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
    })
  );
});
