'use strict';
/**
 * Parent lock: a PIN that stands between a child (or a stranger talking to one) and switching protection off.
 *
 * While it is set, anything that would weaken protection needs the PIN first: switching off any of Sentinel's
 * protection in the app or the tray, telling the tech-support scam shield to stop asking about a program, putting a
 * quarantined file back, signing out or switching to another account, switching to another Sentinel version, and
 * quitting Sentinel. Turning things on never does. The PIN opens a short window of five minutes, then locks again
 * by itself. Wrong PINs make the wait longer each time.
 *
 * Only a salted scrypt hash of the PIN is kept, in the settings file. A short record for the parent says when
 * protection was changed with the PIN, when someone tried without it, and when Sentinel stopped without it (ended
 * from Task Manager, or a crash): times and switch names only, never anything about a chat or a page.
 *
 * It is a lock, not a wall: Sentinel is installed for one Windows account, so whoever uses that account can still
 * uninstall it from Windows Settings, and the browser companion has no lock at all. The app says so.
 */
const crypto = require('crypto');

const PIN = /^\d{4,8}$/;
const UNLOCK_MS = 5 * 60 * 1000;   // how long one PIN entry keeps the lock open
const TRIES = 5;                   // wrong PINs in a row before a wait
const WAIT_MS = 60 * 1000;         // the first wait after them; it doubles with each wait after that
const WAIT_MAX_MS = 60 * 60 * 1000;
const RECORD_MAX = 30;
const MERGE_MS = 60 * 60 * 1000;   // the same line again within this is counted on the one already there
// Lines that are never pushed out by newer ones: the ones a parent most needs to see.
const KEEP = /^(Sentinel stopped without the PIN|The PIN was removed)/;

/** "45 seconds", "a minute", "8 minutes". */
function inWords(ms) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return m === 1 ? 'a minute' : `${m} minutes`;
}

function hash(pin, salt) {
  return crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

/** `store` is desktop/src/store.js (or anything with get and set); `now` is replaceable for tests. */
function create(store, now = Date.now) {
  let unlockedUntil = 0;

  const saved = () => store.get('parentLock', null);
  const isSet = () => Boolean(saved() && saved().hash);
  const locked = () => isSet() && now() >= unlockedUntil;

  /**
   * Write a line in the parent's record. The same line again within an hour is counted on the one already there, so
   * someone pressing a locked switch over and over cannot push older lines out; "stopped without the PIN" and an
   * administrator's removal are always kept.
   */
  function note(text, at = now()) {
    text = String(text);
    let list = store.get('parentLockRecord', []);
    const same = list.find((e) => e.text === text && Math.abs(at - e.at) < MERGE_MS);
    if (same) list = list.map((e) => (e === same ? { ...e, at: Math.max(e.at, at), times: (e.times || 1) + 1 } : e));
    else list = [{ at, text }, ...list];
    list.sort((a, b) => b.at - a.at);
    const kept = list.filter((e) => KEEP.test(e.text)).slice(0, RECORD_MAX);
    const rest = list.filter((e) => !KEEP.test(e.text)).slice(0, Math.max(0, RECORD_MAX - kept.length));
    store.set('parentLockRecord', [...kept, ...rest].sort((a, b) => b.at - a.at));
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
    if (wait) throw new Error(`Too many wrong PINs. Try again in ${inWords(wait)}.`);
    const s = saved();
    const given = Buffer.from(hash(PIN.test(String(pin)) ? pin : '', s.salt), 'hex');
    if (!crypto.timingSafeEqual(given, Buffer.from(s.hash, 'hex'))) {
      // `waits` counts the waits so far: each one is twice the last (1, 2, 4 minutes and so on, an hour at most),
      // so guessing all 10,000 four-digit PINs takes months, not a weekend. A right PIN starts it again.
      const f = store.get('parentLockFails', null) || { count: 0 };
      const waits = f.waits || 0;
      const count = (f.until ? 0 : f.count) + 1;
      if (count < TRIES) { store.set('parentLockFails', { count, waits }); throw new Error('Wrong PIN.'); }
      const ms = Math.min(WAIT_MAX_MS, WAIT_MS * 2 ** waits);
      store.set('parentLockFails', { count, waits: waits + 1, until: now() + ms });
      note('Wrong PIN entered 5 times');
      throw new Error(`Wrong PIN. Try again in ${inWords(ms)}.`);
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
  function guard(what, weakens, [verb, did] = ['switch', 'Switched']) {
    if (!weakens || !isSet()) return;
    if (locked()) {
      note(`Tried to ${verb} ${what} without the PIN`);
      throw new Error('Locked by a parent. Unlock it with the PIN under Parent lock, in Live protection.');
    }
    note(`${did} ${what} with the PIN`);
  }

  /**
   * The record is the parent's: hidden while the lock is locked, shown while it is open. With no PIN at all it is
   * shown too, so a PIN removed with an administrator's approval is not hidden from the parent who set it.
   */
  function status() {
    return {
      set: isSet(),
      locked: locked(),
      unlockedUntil: isSet() && !locked() ? unlockedUntil : 0,
      waitSeconds: Math.ceil(waitLeft() / 1000),
      record: !locked() ? store.get('parentLockRecord', []) : null
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
