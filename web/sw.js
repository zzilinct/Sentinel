/* Sentinel service worker: makes the web app installable and usable offline-first
 * for static files, without ever serving stale code after a release.
 *
 *   fonts & images   cache first (they never change under the same name)
 *   CSS & scripts    network first, cache only as an offline fallback
 *   pages & API      never touched - always live
 */
const VERSION = 'sentinel-v3';
const PRECACHE = [
  '/assets/fonts/fonts.css',
  '/assets/fonts/atkinson-hyperlegible-next-normal-400-700.woff2',
  '/assets/fonts/bricolage-grotesque-normal-400-800.woff2',
  '/assets/fonts/jetbrains-mono-normal-400-600.woff2',
  '/assets/img/favicon.svg',
  '/assets/img/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/assets/')) return;

  if (/\.(woff2|png|svg|jpg|webp)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // Clone now: by the time caches.open resolves, the page may have read the body.
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
