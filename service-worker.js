/**
 * service-worker.js
 *
 * Provides offline support via a versioned cache. All cached URLs are
 * relative so this works correctly when the app is served from a
 * GitHub Pages subpath (https://username.github.io/reponame/).
 *
 * RELEASE PROCESS: bump CACHE_NAME's version suffix on every deploy
 * that changes any cached file. The activate handler deletes old
 * caches, so returning users won't get stuck on stale assets.
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `calculator-cache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/calculatorState.js',
  './js/expressionParser.js',
  './js/formatUtils.js',
  './js/historyManager.js',
  './js/inputController.js',
  './js/pwaBootstrap.js',
  './js/storageManager.js',
  './js/uiRenderer.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-152.png',
  './icons/apple-touch-icon-167.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('calculator-cache-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Cache-first for precached app shell assets, falling back to network
// (and caching the response) for anything else same-origin.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
