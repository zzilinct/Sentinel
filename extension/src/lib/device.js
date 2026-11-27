/**
 * What the companion knows on this device alone: the public threat list (a file of hosts, see lib/engine.js) and the
 * scanner's own look-alike rule. Both answer with no server. The list is one public file, downloaded on the hourly
 * alarm that already exists and kept in the browser's cache; the file is the same for everybody and nothing about the
 * person goes with the request (docs/privacy-map.md, the companion).
 */
import { ext } from './api.js';
import { loadList } from './engine.js';

const LIST_URL = 'https://raw.githubusercontent.com/zzilinct/Sentinel/threat-list/threats.bin';
const KEPT = 'https://sentinel.invalid/threats.bin';   // the name the file is kept under in the cache; never asked for

/** What this worker knew before it was stopped: the list, from the cache. A binary file read once, no parsing. */
export async function recallList() {
  try {
    const hit = await caches.match(KEPT);
    if (hit) loadList(await hit.arrayBuffer());
  } catch { /* no list yet */ }
}

/** The newest list, when there is one: a conditional request, so an unchanged file costs a short answer. */
export async function refreshList() {
  try {
    const { listEtag, listUrl } = await ext.storage.local.get(['listEtag', 'listUrl']);
    const res = await fetch(listUrl || LIST_URL, { credentials: 'omit', headers: listEtag ? { 'If-None-Match': listEtag } : {}, signal: AbortSignal.timeout(60000) });
    if (!res.ok) return;   // 304: nothing new
    const bytes = await res.arrayBuffer();
    loadList(bytes);       // a file that is not a list throws here, and the list kept stays as it was
    await (await caches.open('sentinel-device')).put(KEPT, new Response(bytes.slice(0)));
    await ext.storage.local.set({ listEtag: res.headers.get('etag') || '' });
  } catch { /* the list kept stays; tried again at the next alarm */ }
}
