'use strict';
/**
 * Parent lock: a PIN that stands between a child (or a stranger talking to one) and switching protection off.
 *
 * While it is set, anything that would weaken protection (chat safety, live scanning, auto scanning, defense,
 * download protection, checking copied links or starting with the computer switched off, switching to another
 * Sentinel version, and quitting Sentinel) needs the PIN first. Turning things on never does. The PIN opens a
 * short window of five minutes, then locks again by itself.
 *
 * Only a salted scrypt hash of the PIN is kept, in the settings file. A short record for the parent says when
 * protection was changed with the PIN, when someone tried without it, and when Sentinel stopped without it (ended
 * from Task Manager, or a crash): times and switch names only, never anything about a chat or a page.
 *
 * It is a lock, not a wall: someone with a Windows administrator account, or who edits Sentinel's settings file,
 * can still remove Sentinel. The app says so.
 */
const crypto = require('crypto');

const PIN = /^\d{4,8}$/;
const UNLOCK_MS = 5 * 60 * 1000;   // how long one PIN entry keeps the lock open
const TRIES = 5;                   // wrong PINs in a row before a wait
const WAIT_MS = 60 * 1000;         // the wait after them
const RECORD_MAX = 30;

function hash(pin, salt) {
  return crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

/** `store` is desktop/src/store.js (or anything with get and set); `now` is replaceable for tests. */
function create(store, now = Date.now) {
  let unlockedUntil = 0;

  const saved = () => store.get('parentLock', null);
  const isSet = () => Boolean(saved() && saved().hash);
  const locked = () => isSet() && now() >= unlockedUntil;

  function note(text, at = now()) {
    const list = [{ at, text: String(text) }, ...store.get('parentLockRecord', [])].sort((a, b) => b.at - a.at).slice(0, RECORD_MAX);
    store.set('parentLockRecord', list);
  }

  function waitLeft() {
    const f = store.get('parentLockFails', null);
    return f && f.until && f.until > now() ? f.until - now() : 0;
  }

  function set(pin) {
    if (isSet() && locked()) throw new Error('Enter the current PIN first.');
    if (!PIN.test(String(pin))) throw new Error('The PIN must be 4 to 8 digits.');
    const salt = crypto.randomBytes(16).toString('hex');
    const changing = isSet();
    store.set('parentLock', { salt, hash: hash(pin, salt) });
    store.set('parentLockFails', undefined);
    unlockedUntil = 0;
    note(changing ? 'The PIN was changed' : 'Parent lock was turned on');
    return status();
  }

  function unlock(pin) {
    if (!isSet()) return status();
    const wait = waitLeft();
    if (wait) throw new Error(`Too many wrong PINs. Try again in ${Math.ceil(wait / 1000)} seconds.`);
    const s = saved();
    const given = Buffer.from(hash(PIN.test(String(pin)) ? pin : '', s.salt), 'hex');
    if (!crypto.timingSafeEqual(given, Buffer.from(s.hash, 'hex'))) {
      const f = store.get('parentLockFails', null) || { count: 0 };
      const count = (f.until ? 0 : f.count) + 1;
      store.set('parentLockFails', count >= TRIES ? { count, until: now() + WAIT_MS } : { count });
      if (count >= TRIES) note('Wrong PIN entered 5 times');
      throw new Error(count >= TRIES ? 'Wrong PIN. Try again in a minute.' : 'Wrong PIN.');
    }
    store.set('parentLockFails', undefined);
    unlockedUntil = now() + UNLOCK_MS;
    return status();
  }

  function relock() { unlockedUntil = 0; return status(); }

  function remove() {
    if (locked()) throw new Error('Enter the PIN first.');
    store.set('parentLock', undefined);
    store.set('parentLockFails', undefined);
    unlockedUntil = 0;
    note('Parent lock was turned off');
    return status();
  }

  /** The PIN was forgotten and a Windows administrator approved removing it (main.js asks Windows). */
  function reset() {
    store.set('parentLock', undefined);
    store.set('parentLockFails', undefined);
    unlockedUntil = 0;
    note('The PIN was removed with a Windows administrator\'s approval');
    return status();
  }

  /**
   * Called before a change. `what` names it ("chat safety off"); `weakens` is true when it switches protection
   * off. Locked: the attempt is written down and an Error says what to do. Open: the change is written down.
   */
  function guard(what, weakens) {
    if (!weakens || !isSet()) return;
    if (locked()) {
      note(`Tried to switch ${what} without the PIN`);
      throw new Error('Locked by a parent. Unlock it with the PIN under Parent lock, in Live protection.');
    }
    note(`Switched ${what} with the PIN`);
  }

  /** The record is only shown while the lock is open: it is the parent's. */
  function status() {
    return {
      set: isSet(),
      locked: locked(),
      unlockedUntil: isSet() && !locked() ? unlockedUntil : 0,
      waitSeconds: Math.ceil(waitLeft() / 1000),
      record: isSet() && !locked() ? store.get('parentLockRecord', []) : null
    };
  }

  return { isSet, locked, set, unlock, relock, remove, reset, guard, note, status };
}

/**
 * Did Sentinel stop without the PIN since it last ran? `last` is what the heartbeat file held ({ at, clean }),
 * `bootAt` when Windows last started, `systemStopAfter(at)` whether Windows recorded a shutdown, restart or sleep
 * after that moment (both of which end Sentinel without its quitting). Returns the time to record, or null.
 */
async function stoppedWithoutPin(last, bootAt, systemStopAfter) {
  if (!last || last.clean || !Number.isFinite(last.at)) return null;
  if (last.at < bootAt) return null;              // Windows restarted since: a shutdown, not Task Manager
  try { if (await systemStopAfter(last.at)) return null; } catch { /* unknown: recorded; its wording allows for a crash */ }
  return last.at;
}

module.exports = { create, stoppedWithoutPin, PIN, UNLOCK_MS };
