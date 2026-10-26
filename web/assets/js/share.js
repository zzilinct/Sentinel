/**
 * Something shared to Sentinel from a phone's Share menu (the web app's share target, manifest.webmanifest): which
 * check it goes to, and where it waits on this device until that check opens. Android sends a share as
 * /app/share?title=&text=&url= or, with a picture, as a form POST that sw.js receives and puts in the share box.
 *
 *   SentinelShare.route({ title, text, url, image }) -> { kind: 'link', url } | { kind: 'text', text } | { kind: 'image' } | { kind: 'empty' }
 *   SentinelShare.put(share) / take() / waiting() / clear()   the share box, on this device only (Cache Storage, read once)
 */
(() => {
  'use strict';

  // The share box: one entry, read once. sw.js writes the same two keys for a shared picture.
  const BOX = 'sentinel-share';
  const DATA = '/share/data';
  const IMAGE = '/share/image';
  // A share left waiting (sign-in never finished) is not kept for later.
  const FRESH_MS = 30 * 60 * 1000;
  // The most of a shared text kept: the text scan reads its start and its newest part (TEXT_MAX in app.js), so a long
  // share is kept whole up to this, and past it by its start and its end, where the newest messages are.
  const MAX = 400000;
  const HEAD = 10000;
  const fit = (s) => (s.length > MAX ? `${s.slice(0, HEAD)}\n${s.slice(-(MAX - HEAD - 1))}` : s);

  // A link and nothing else: "https://x.example/a" or "x.example/a", one word.
  const LINK = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z][a-z0-9-]+(:\d{1,5})?([/?#]\S*)?$/i;
  const onlyLink = (s) => Boolean(s) && !/\s/.test(s) && LINK.test(s);

  /** Which check a share opens. A link alone gets the link scan; words get the text scan, links and all. */
  function route({ title, text, url, image } = {}) {
    if (image) return { kind: 'image' };
    const t = String(title || '').trim();
    const x = fit(String(text || '').trim());
    const u = String(url || '').trim().slice(0, 2000);
    // A browser shares a page as its title and address; some apps put the address in text instead of url.
    if (!x && onlyLink(u)) return { kind: 'link', url: u };
    if (onlyLink(x) && (!u || u === x)) return { kind: 'link', url: x };
    if (onlyLink(u) && x === t) return { kind: 'link', url: u };
    // Words: the title only when it adds something (an email's subject), the address only when the words lack it.
    const parts = [t && !x.includes(t) && t !== u ? t : '', x, u && !x.includes(u) ? u : ''].filter(Boolean);
    const all = fit(parts.join('\n'));
    return all ? { kind: 'text', text: all } : { kind: 'empty' };
  }

  const box = () => (typeof caches === 'object' ? caches.open(BOX) : Promise.reject(new Error('no share box here')));

  /** Keeps a share on this device until the check opens (signed out, that is after signing in). */
  async function put({ title = '', text = '', url = '' } = {}) {
    const c = await box();
    await c.delete(IMAGE);
    await c.put(DATA, new Response(JSON.stringify({ title, text, url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  }

  /** The waiting share, if any, taken out of the box: { title, text, url, image: File|null } or null. */
  async function take() {
    let c;
    try { c = await box(); } catch { return null; }
    const [d, i] = await Promise.all([c.match(DATA), c.match(IMAGE)]);
    const data = d ? await d.json().catch(() => null) : null;
    const blob = i ? await i.blob() : null;
    await clear();
    if (!data || !(Date.now() - data.at < FRESH_MS)) return null;
    const image = blob ? new File([blob], 'shared-picture', { type: blob.type || i.headers.get('Content-Type') || '' }) : null;
    return { title: data.title || '', text: data.text || '', url: data.url || '', image };
  }

  /** Whether a share made in the last FRESH_MS is waiting; an older one is emptied out. Nothing is taken. */
  async function waiting() {
    let c;
    try { c = await box(); } catch { return false; }
    const d = await c.match(DATA);
    const data = d ? await d.json().catch(() => null) : null;
    if (data && Date.now() - data.at < FRESH_MS) return true;
    await clear();
    return false;
  }

  async function clear() {
    try { await caches.delete(BOX); } catch { /* nothing waiting */ }
  }

  const api = { route, put, take, waiting, clear, BOX, DATA, IMAGE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelShare = api;
})();
