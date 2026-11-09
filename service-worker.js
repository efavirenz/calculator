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

const CACHE_VERSION = 'v7.12';
const CACHE_NAME = `calculator-cache-${CACHE_VERSION}`;

// App-shell files: install fails hard if any of these are unavailable.
const CORE_URLS = [
  './',
  './index.html',
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
];

// Non-essential assets: a missing icon/manifest must not block the install
// (AUD-011). Successful entries are still cached for offline use.
const OPTIONAL_URLS = [
  './manifest.json',
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
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_URLS);
      await Promise.allSettled(OPTIONAL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })
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
    (async () => {
      // Match only within this app's cache so sibling apps cannot influence it.
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response && response.status === 200 && response.type === 'basic') {
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        if (event.request.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline', {
          status: 504,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

// Allows the page to ask a waiting worker to activate immediately (used by the
// consentful update flow in pwaBootstrap.js).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
