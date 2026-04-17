const CACHE_NAME = 'elefartor-v16';

// Assets that never change → cache-first (images, audio, icons)
// Game code → network-first (always try fresh, fall back to cache if offline)

const CORE_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for HTML and JS — always get fresh code
// Cache-first for static assets — instant load
function isCode(url) {
  return url.endsWith('.html') || url.endsWith('.js') || url.endsWith('/') ||
         url.endsWith('.css') || url.endsWith('/sw.js');
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  if (isCode(url)) {
    // Network-first for code
    e.respondWith(
      fetch(e.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request).then((cached) =>
        cached || (e.request.mode === 'navigate' ? caches.match('/index.html') : null)
      ))
    );
    return;
  }

  // Cache-first for assets (images, audio)
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        if (response.ok && (url.includes('/Assets/') || url.includes('/icons/'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
