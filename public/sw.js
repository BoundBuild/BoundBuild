/* BoundBuild MVP — service worker.
   Network-first for app assets: every load checks the server for the latest
   JS/CSS, falling back to the cache only when offline. This is what lets app
   updates (like recorder fixes) actually reach installed phones.
   v2 — switched from cache-first to network-first. */

const CACHE = 'boundbuild-v10';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/util.js', '/js/api.js', '/js/recorder.js', '/js/app.js', '/icons/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API or uploaded media — always hit the network.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache a copy for offline use, but serve the fresh response.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match('/index.html'))
      )
  );
});
