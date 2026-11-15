/*
 * Where the companion's settings live: storage.sync, so they follow the person's browser sign-in, or storage.local
 * when sync will not answer (Firefox with sync switched off throws, a browser without it has none). One helper for
 * every reader and writer: the worker and the settings page (lib/api.js imports it), and the scripts on pages (the
 * manifest loads it before them).
 *
 * Each place also keeps when each setting was saved there (`settingsAt`, ms). A read asks both places and takes each
 * setting from whichever saved it last, so a choice made while sync was away is not undone by sync's older copy once
 * sync answers again. A setting saved before these times were kept counts as 0; a tie goes to sync.
 */
(function (root) {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const AT = 'settingsAt';
  const keysOf = (k) => (Array.isArray(k) ? k : typeof k === 'string' ? [k] : Object.keys(k || {}));
  // One place's settings and their times, or null when that place throws.
  async function read(name, keys) {
    try { return (await ext.storage[name].get([...keys, AT])) || {}; } catch { return null; }
  }
  root.SentinelStore = {
    /** Like storage.get: `defaults` as an object (missing settings take its values) or a list of names. */
    async get(defaults) {
      const keys = keysOf(defaults);
      const [s, l] = await Promise.all([read('sync', keys), read('local', keys)]);
      const sAt = (s && s[AT]) || {}, lAt = (l && l[AT]) || {};
      const out = Array.isArray(defaults) || typeof defaults === 'string' ? {} : { ...defaults };
      for (const k of keys) {
        const fromLocal = l && k in l && !(s && k in s && (sAt[k] || 0) >= (lAt[k] || 0));
        const from = fromLocal ? l : s;
        if (from && k in from) out[k] = from[k];
      }
      return out;
    },
    /** Saved in sync, or in local when sync throws, with the time of the choice. Throws only when neither takes it. */
    async set(items) {
      const now = Date.now();
      for (const name of ['sync', 'local']) {
        try {
          const at = { ...(((await ext.storage[name].get(AT)) || {})[AT] || {}) };
          for (const k of Object.keys(items)) at[k] = now;
          await ext.storage[name].set({ ...items, [AT]: at });
          return;
        } catch (e) { if (name === 'local') throw e; }
      }
    },
    /** Gone from both places. */
    async remove(keys) {
      for (const name of ['sync', 'local']) { try { await ext.storage[name].remove(keys); } catch { /* that place is away */ } }
    },
    /** A storage change to any of `defaults`' keys, from either place, as { key: newValue }; null when none is a setting. */
    changed(changes, area, defaults) {
      if (area !== 'sync' && area !== 'local') return null;
      let out = null;
      for (const k of Object.keys(defaults)) if (k in changes) (out = out || {})[k] = changes[k].newValue;
      return out;
    }
  };
})(globalThis);
