/**
 * Something shared to Sentinel from a phone's Share menu (the web app's share target, manifest.webmanifest): which
 * check it goes to, and where it waits on this device until that check opens. Android sends a share as
 * /app/share?title=&text=&url= or, with a picture, as a form POST that sw.js receives and puts in the share box.
 *
 *   SentinelShare.route({ title, text, url, image }) -> { kind: 'link', url } | { kind: 'text', text } | { kind: 'image' } | { kind: 'empty' }
 *   SentinelShare.put(share) / take() / waiting()   the share box, on this device only (Cache Storage, read once)
 */
(() => {
  'use strict';

  // The share box, read once. Each share is its own pair of keys, named by its time (/share/data/<ms>, and
  // /share/image/<ms> for a picture; sw.js writes the same). Until 1.21.2 there was one pair, and the box was emptied by
  // deleting it whole: a second share written meanwhile went with it, and its page found nothing (verify-web run
  // 44948767446, two shares a moment apart).
  const BOX = 'sentinel-share';
  const DATA = '/share/data';
  // A share left waiting (sign-in never finished) is not kept for later.
  const FRESH_MS = 30 * 60 * 1000;
  // The most of a shared text kept: the Check page reads its start and its newest part (TEXT_MAX in app.js), so a long
  // share is kept whole up to this, and past it by its start and its end, where the newest messages are.
  const MAX = 400000;
  const HEAD = 10000;
  const fit = (s) => (s.length > MAX ? `${s.slice(0, HEAD)}\n${s.slice(-(MAX - HEAD - 1))}` : s);

  // A link and nothing else: "https://x.example/a" or "x.example/a", one word.
  const LINK = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z][a-z0-9-]+(:\d{1,5})?([/?#]\S*)?$/i;
  const onlyLink = (s) => Boolean(s) && !/\s/.test(s) && LINK.test(s);

  /** Which check a share opens. The Check page takes all three: a link alone is checked as a link, words as a message, links and all. */
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
    const at = Date.now();
    await c.put(`${DATA}/${at}`, new Response(JSON.stringify({ title, text, url, at }), { headers: { 'Content-Type': 'application/json' } }));
  }

  /** The box's keys as { key, kind: 'data'|'image', at }. A share from before 1.21.2 (no time in its name) is the oldest. */
  async function entries(c) {
    return (await c.keys()).map((key) => {
      const m = /\/share\/(data|image)(?:\/(\d+))?$/.exec(key.url);
      return m && { key, kind: m[1], at: Number(m[2] || 0) };
    }).filter(Boolean);
  }

  /** Removes these entries, and only these: a share written while they were read has keys of its own and stays. */
  const drop = (c, list) => Promise.all(list.map((e) => c.delete(e.key)));

  /**
   * The waiting share, if any, taken out of the box: { title, text, url, image: File|null } or null. `mine` is the
   * share this page was opened for (sw.js puts its time in the address): a newer one is another share's, whose own page
   * is on its way, so it is left there and { newer: true } comes back.
   */
  async function take(mine) {
    let c;
    try { c = await box(); } catch { return null; }
    const all = await entries(c);
    const newest = all.filter((e) => e.kind === 'data').reduce((a, e) => (!a || e.at > a.at ? e : a), null);
    if (!newest) { await drop(c, all); return null; }
    if (mine && newest.at > mine) return { newer: true };
    const i = all.find((e) => e.kind === 'image' && e.at === newest.at);
    const [d, p] = await Promise.all([c.match(newest.key), i ? c.match(i.key) : null]);
    const data = d ? await d.json().catch(() => null) : null;
    const blob = p ? await p.blob() : null;
    // This share and every older one: they were superseded.
    await drop(c, all.filter((e) => e.at <= newest.at));
    if (!data || !(Date.now() - data.at < FRESH_MS)) return null;
    const image = blob ? new File([blob], 'shared-picture', { type: blob.type || p.headers.get('Content-Type') || '' }) : null;
    return { title: data.title || '', text: data.text || '', url: data.url || '', image };
  }

  /** Whether a share made in the last FRESH_MS is waiting; an older one is emptied out. Nothing is taken. */
  async function waiting() {
    let c;
    try { c = await box(); } catch { return false; }
    const all = await entries(c);
    for (const e of all.filter((x) => x.kind === 'data')) {
      const d = await c.match(e.key);
      const data = d ? await d.json().catch(() => null) : null;
      if (data && Date.now() - data.at < FRESH_MS) return true;
    }
    // Only what was read, all of it old, is emptied out: a share arriving this moment (the service worker writing it
    // while this page starts) has keys of its own and waits for its page.
    await drop(c, all);
    return false;
  }

  const api = { route, put, take, waiting, BOX, DATA };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.SentinelShare = api;
})();
