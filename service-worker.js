importScripts('./scripts/version.js');

const CACHE_VERSION = self.APP_VERSION;
const CACHE_NAME = `weight-logger-cache-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './stock-out.html',
  './stock-out-records.html',
  './menu.html',
  './login.html',
  './admin.html',
  './manifest.json',
  './service-worker.js',
  './scripts/sw-register.js',
  './scripts/app.js',
  './scripts/stock-out.js',
  './scripts/stock-out-records.js',
  './scripts/menu.js',
  './scripts/admin.js',
  './scripts/version.js'
];

const REMOTE_ASSETS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...REMOTE_ASSETS]))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith('weight-logger-cache-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return caches.match(request, { ignoreSearch: true });
        });
    })
  );
});
