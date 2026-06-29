/* 小說閱讀站 — Service Worker（離線閱讀殼層） */
const CACHE_VERSION = 'reader-v18';
const CACHE_NAME = 'novel-reader-' + CACHE_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './gh-sync.js',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

function isMutable(pathname) {
  if (pathname === '/' || pathname.endsWith('/')) return true;
  if (pathname.endsWith('.html')) return true;
  if (pathname.endsWith('.webmanifest')) return true;
  if (pathname.endsWith('/sw.js')) return true;
  if (pathname.endsWith('/gh-sync.js')) return true;
  if (pathname.endsWith('/novels/manifest.json')) return true;
  return false;
}

function isStatic(pathname) {
  if (pathname.includes('/reader/icons/') || pathname.includes('/icons/')) return true;
  if (pathname.endsWith('.png') || pathname.endsWith('.webp')) return true;
  return false;
}

function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.status === 200) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
    }
    return response;
  }).catch(function () { return caches.match(request); });
}

function cacheFirst(request, url) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response && response.status === 200 &&
        (url.origin === self.location.origin ||
          url.hostname.endsWith('gstatic.com') ||
          url.hostname.endsWith('googleapis.com'))) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () { return cached; });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.startsWith('novel-reader-') && k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  if (isMutable(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (isStatic(url.pathname) || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    event.respondWith(cacheFirst(event.request, url));
    return;
  }
  event.respondWith(networkFirst(event.request));
});
