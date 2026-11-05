'use strict';
/**
 * Every Windows notification Sentinel shows goes through here, and nothing goes over a game, a film or a slideshow.
 * A note waits in one queue while Windows says the person is busy (a full-screen program in front, see main.js
 * fullscreenInFront) or while its own `ready()` says not yet (an offer about Roblox waits until Roblox is not in
 * front). It is shown once that passes, or dropped when it has waited too long to still be news.
 *
 * Asking Windows costs a short helper process, so it is asked only when a note is waiting: once when the note
 * arrives, then after 1, 2, 5 and every 10 minutes while the person stays busy. An empty queue keeps no timer.
 */
const RETRY_MS = [60e3, 120e3, 300e3, 600e3];
const KEEP_MS = 30 * 60e3;   // a note older than this is not news any more (a threat note is kept longer by its caller)

function createNotes({ show, busy, log = () => {}, now = Date.now, later = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; }, cancel = clearTimeout }) {
  let queue = [];
  let timer = null;
  let tries = 0;
  let checking = false;

  function wait() {
    if (timer || !queue.length) return;
    timer = later(() => { timer = null; flush(); }, RETRY_MS[Math.min(tries, RETRY_MS.length - 1)]);
    tries++;
  }

  async function flush() {
    if (checking) return;
    queue = queue.filter((n) => now() - n.at < n.keepMs);
    const due = queue.filter((n) => !n.ready || n.ready());
    if (!due.length) { wait(); return; }
    checking = true;
    let held = true;
    try { held = await busy(); } catch { held = false; } finally { checking = false; }
    if (held) { log(`notifications: ${due.length} waiting until the full-screen program is closed`); wait(); return; }
    if (timer) { cancel(timer); timer = null; }
    tries = 0;
    for (const n of due) {
      queue = queue.filter((x) => x !== n);
      show(n);
      if (n.onShown) n.onShown();
    }
    // A note that arrived while Windows was being asked: its own turn now.
    if (queue.some((n) => !n.ready || n.ready())) return flush();
    wait();
  }

  /** A note: { title, body, onClick, ready, onShown, keepMs }. The same title again replaces the one waiting. */
  function push(note) {
    queue = queue.filter((n) => n.title !== note.title);
    queue.push({ keepMs: KEEP_MS, ...note, at: now() });
    return flush();
  }

  return { push, flush, waiting: () => queue.length };
}

module.exports = { createNotes, RETRY_MS, KEEP_MS };
