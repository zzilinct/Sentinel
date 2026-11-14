/*
 * Where the companion's settings live: storage.sync, so they follow the person's browser sign-in, or storage.local
 * when sync will not answer (Firefox with sync switched off throws, a browser without it has none). One helper for
 * every reader and writer: the worker and the settings page (lib/api.js imports it), and the scripts on pages (the
 * manifest loads it before them). While sync is away, settings are saved and read in local.
 * ponytail: per call, no memory of which place answered; a sync that fails once then recovers reads its older copy.
 * Remember the place (or copy local into sync on recovery) if a browser is seen doing that.
 */
(function (root) {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  root.SentinelStore = {
    async get(keys) {
      try { return await ext.storage.sync.get(keys); } catch { return ext.storage.local.get(keys); }
    },
    async set(items) {
      try { await ext.storage.sync.set(items); } catch { await ext.storage.local.set(items); }
    },
    async remove(keys) {
      try { await ext.storage.sync.remove(keys); } catch { await ext.storage.local.remove(keys); }
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
