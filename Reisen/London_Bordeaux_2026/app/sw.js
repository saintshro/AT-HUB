const CACHE_NAME = 'at-hub-reisemodul-v005';

const STATIC_ASSETS = [
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icon-192.svg',
  './assets/icon-512.svg',
  '../daten/app-version.json',
  '../daten/reiseplan.json',
  '../daten/verbindungen.json',
  '../daten/orte.json',
  '../daten/kosten.json',
  '../daten/checklisten.json',
  '../daten/morning-runs.json',
  '../daten/live-pruefen.json',
  '../daten/wissen.json',
  '../daten/updates.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
