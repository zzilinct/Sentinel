/* Sentinel service worker: makes the web app installable and usable offline-first
 * for static files, without ever serving stale code after a release.
 *
 *   fonts & images   cache first (they never change under the same name)
 *   CSS & scripts    network first, cache only as an offline fallback
 *   pages & API      never touched - always live
 *   a share          a picture or words shared from the phone's Share menu (manifest.webmanifest share_target) arrive
 *                    as a form POST to /app/share: put in the share box on this device (share.js reads it once and
 *                    deletes it), then the page opens. Nothing is sent anywhere from here.
 */
const VERSION = 'sentinel-v5';
const SHARE = 'sentinel-share';
const PRECACHE = [
  '/assets/fonts/fonts.css',
  '/assets/fonts/geist-normal-300-700.woff2',
  '/assets/fonts/geist-mono-normal-400-600.woff2',
  '/assets/fonts/instrument-serif-normal-400.woff2',
  '/assets/fonts/instrument-serif-italic-400.woff2',
  '/assets/img/favicon.svg',
  '/assets/img/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/app/share') {
    event.respondWith(receiveShare(req));
    return;
  }
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

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const word = (k) => String(form.get(k) || '');
    const file = form.getAll('image').find((f) => f && typeof f === 'object' && f.size);
    const box = await caches.open(SHARE);
    await box.delete('/share/image');
    if (file) await box.put('/share/image', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } }));
    await box.put('/share/data', new Response(JSON.stringify({ title: word('title'), text: word('text'), url: word('url'), at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* the page says nothing arrived */ }
  return Response.redirect('/app/share', 303);
}
