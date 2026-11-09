/**
 * Every guard the Sentinel app runs, as one board: grouped by what it guards, one line each, and each line's state
 * read from what is really running (the app's desktop.info()), never from its switch alone. The Live protection page
 * (app.js protectionView) draws it; nothing else decides what the page says.
 *
 *   SentinelGuards.board(info, { exposures, sites, held }) -> { level, headline, sub, groups: [{ id, title, rows }] }
 *
 * The headline and the five main protections follow the same rules and words as the Windows tray
 * (desktop/src/protection.js), so the tray, its card and this page cannot disagree. A row is one of:
 *   on           switched on and running
 *   off          switched off by the person
 *   starting     switched on and coming up
 *   trouble      switched on and not running, with the reason
 *   unavailable  not part of this plan or this computer: not a fault, and its switch is not offered
 *   waiting      switched on, but it works only while live scanning runs, and live scanning does not (its switch is the
 *                row above)
 * Only the five main protections count in the headline; the others are listed beside the one they help.
 */
(function (root) {
  'use strict';

  const UNAVAILABLE = /sign in|part of|available on windows/i;
  const WORDS = { on: 'On', off: 'Off', starting: 'Starting', trouble: 'Not working', unavailable: 'Not available', waiting: 'Waiting' };

  // As protection.js item(): the state from enabled, active and the reason the app gives.
  function item(id, name, { enabled, active, reason, onNote }) {
    if (!enabled) return { id, name, enabled: false, state: 'off', note: 'Off' };
    if (active) return { id, name, enabled: true, state: 'on', note: onNote };
    const why = String(reason || '').replace(/^(Download protection|Defense|Live scanning):\s*/i, '');
    if (!why || /^starting/i.test(why)) return { id, name, enabled: true, state: 'starting', note: 'Starting' };
    return { id, name, enabled: true, state: UNAVAILABLE.test(why) ? 'unavailable' : 'trouble', note: why.charAt(0).toUpperCase() + why.slice(1) };
  }

  // As protection.js protectionState(): one level, a headline and a sentence, from the main protections.
  function summary(items, { booting = false, down = false } = {}) {
    const on = items.filter((i) => i.state === 'on');
    const trouble = items.filter((i) => i.state === 'trouble');
    if (down) return { level: 'off', headline: 'Sentinel\'s scanner stopped', sub: 'It starts again by itself. Until then, new files and pages are not checked.' };
    if (booting || (!trouble.length && items.some((i) => i.state === 'starting'))) return { level: 'starting', headline: 'Sentinel is starting', sub: 'Your protection comes on in a moment.' };
    if (trouble.length) return { level: 'partly', headline: 'Partly protected', sub: `${trouble.map((i) => i.name).join(' and ')} ${trouble.length > 1 ? 'are' : 'is'} not working right now.` };
    if (!on.length) return { level: 'off', headline: 'Protection is off', sub: 'Nothing is being watched right now.' };
    return { level: 'on', headline: 'Protection is on', sub: on.length === items.length ? `All ${on.length} protections are running.` : `${on.length} of ${items.length} protections are running.` };
  }

  // Before 1.19.2 the app did not send whether download protection is switched on; its reason said so.
  const downloadsOn = (d) => (typeof d.enabled === 'boolean' ? d.enabled : !/(^|:\s*)(turned )?off\.?$/i.test(String(d.reason || '')));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function board(info, extra = {}) {
    const windows = info.platform === 'win32';
    const live = info.live || {};
    const dl = info.downloads || {};
    const df = info.defense || {};
    const cs = info.chatSafety || {};
    const ts = info.textSafety || {};

    // The five the tray counts, built exactly as it builds them.
    const core = {
      live: item('live', 'Live scanning', { enabled: Boolean(live.enabled), active: Boolean(live.active), reason: live.reason, onNote: live.window ? 'Watching the browser in front' : 'Ready for your browser' }),
      downloads: item('downloads', 'Downloads', { enabled: downloadsOn(dl), active: Boolean(dl.active), reason: dl.reason, onNote: 'Every new file is checked' }),
      defense: windows ? item('defense', 'Defense', { enabled: df.enabled !== false, active: Boolean(df.active), reason: df.reason, onNote: 'Startup programs are watched' }) : null,
      chat: windows ? item('chat', 'Chat safety', { enabled: Boolean(cs.enabled), active: Boolean(cs.running), reason: 'Cannot read chat right now', onNote: 'Roblox and Discord chats are read here' }) : null,
      texts: windows ? item('texts', 'Texts', { enabled: Boolean(ts.enabled), active: Boolean(ts.running), reason: 'Cannot read texts right now', onNote: 'Phone Link texts are read here' }) : null
    };
    const main = ['downloads', 'defense', 'live', 'chat', 'texts'].map((k) => core[k]).filter(Boolean);
    const head = summary(main, { booting: Boolean(extra.booting) });

    // A row: what the board draws. `line` is what it is doing now, or, while off, what it would guard.
    const row = (base, { name, what, offLine, main: isMain = false, fix = null }) => {
      const line = base.state === 'off' ? offLine || what : base.state === 'starting' ? 'Coming on now' : base.note;
      return { id: base.id, name: name || base.name, line, what, state: base.state, word: WORDS[base.state], enabled: base.enabled, main: isMain,
        switchable: base.state !== 'unavailable', fix: fix || (base.state === 'unavailable' && /part of/i.test(base.note) ? { label: 'See plans', href: '/app/plan' } : null) };
    };
    const plain = (id, name, enabled, onNote) => ({ id, name, enabled: Boolean(enabled), state: enabled ? 'on' : 'off', note: enabled ? onNote : 'Off' });
    // Works only while live scanning runs: on when it does, waiting (with the one fix) when it does not.
    const helper = (id, name, enabled, onNote) => {
      if (!enabled) return plain(id, name, false);
      if (core.live.state === 'on') return plain(id, name, true, onNote);
      if (core.live.state === 'starting') return { id, name, enabled: true, state: 'starting', note: 'Starting' };
      return { id, name, enabled: true, state: 'waiting', note: 'Works while live scanning is on' };
    };

    const groups = [];
    const web = [row(core.live, { name: 'Live scanning', main: true, what: 'Marks search results and Gmail or Outlook inboxes, and warns before a dangerous page gets your details' })];
    const rg = info.remoteGuard;
    if (rg && rg.supported) web.push(row(helper('remote', 'Tech-support scam shield', rg.enabled, 'Ready if a scam page takes over the screen'), { what: 'Offers a way out of a full-screen scam page, and asks before a remote-control program runs' }));
    if (live.supported) {
      const n = extra.exposures || 0;
      web.push(row(helper('exposure', 'Exposure alerts', info.exposureAlerts, n ? `${plural(n, 'site', 'sites')} you visited ${n === 1 ? 'was' : 'were'} listed later` : 'None of the sites you visited has been listed since'),
        { what: 'Tells you if a site you visited is named as a scam later' }));
    }
    if (info.mySites !== undefined) {
      const n = extra.sites || 0;
      const base = !info.embeddedServer ? { id: 'mysites', name: 'Your sites', enabled: false, state: 'unavailable', note: 'Works when the app uses its own scanner on this computer' }
        : plain('mysites', 'Your sites', info.mySites !== false, n ? `Look-alikes of ${plural(n, 'site', 'sites')} you use get a warning` : 'Learning the sites you use');
      web.push(row(base, { what: 'Warns about look-alikes of your bank, school or work sign-in' }));
    }
    groups.push({ id: 'web', title: 'Pages, searches and email', rows: web });

    const files = [row(core.downloads, { name: 'Download protection', main: true, what: 'Checks every new file in your Downloads folder' })];
    if (core.defense) files.push(row(core.defense, { main: true, what: 'Stops a dangerous program and removes what it set to run at startup' }));
    if (info.scanMenu && info.scanMenu.supported) files.push(row(plain('scanMenu', 'Scan in the right-click menu', info.scanMenu.enabled, 'Right-click a file, Show more options, Scan with Sentinel'), { what: 'Adds Scan with Sentinel to the menu when you right-click a file' }));
    groups.push({ id: 'files', title: 'Downloads and programs', rows: files });

    const copy = [];
    if (info.clipboardCheck !== undefined) copy.push(row(plain('clip', 'Check links I copy', info.clipboardCheck, 'A link you copy is checked, and you hear only if it is dangerous'), { what: 'Checks a link you copy from a text, a chat or a PDF' }));
    if (windows) {
      const held = extra.held;
      copy.push(row(plain('cmd', 'Stop pasted commands', info.commandShield, held ? `Stopped a command ${held}` : 'A command a fake "I am not a robot" page copies is taken off the clipboard'), { what: 'Stops the command a fake "I am not a robot" page asks you to paste into Windows' }));
      copy.push(row(plain('wallet', 'Wallet guard', info.walletGuard, 'A wallet address or IBAN swapped on your clipboard is put back'), { what: 'Puts back a wallet address or IBAN that malware swaps on your clipboard' }));
    }
    if (copy.length) groups.push({ id: 'copy', title: 'What you copy', rows: copy });

    if (core.chat) {
      groups.push({ id: 'chats', title: 'Chats and texts', rows: [
        row(core.chat, { main: true, what: 'Points out scams and unsafe strangers in Roblox and Discord chats' }),
        row(core.texts, { name: 'Check my texts', main: true, what: 'Points out English scam texts in Phone Link' })
      ] });
    }

    const pc = [row(plain('login', 'Start with my computer', info.openAtLogin !== false, 'Starts when you sign in to Windows'), { what: 'Starts Sentinel when you sign in to Windows', offLine: 'After a restart nothing is watched until you open Sentinel' })];
    const sn = info.snip;
    if (sn && sn.supported) {
      const key = ((sn.keys || []).find((k) => k.id === sn.key) || {}).label || '';
      const base = sn.enabled && !sn.registered ? { id: 'snip', name: 'Check something on screen', enabled: true, state: 'trouble', note: 'Another program uses this shortcut. Choose another one' }
        : plain('snip', 'Check something on screen', sn.enabled, key ? `Press ${key}, then draw a box around it` : 'On');
      pc.push(row(base, { what: 'A shortcut to draw a box around a pop-up, an ad or a message and check it' }));
    }
    groups.push({ id: 'pc', title: 'This computer', rows: pc });

    // Every main protection running: the medallion is cast in full gold only then.
    return { ...head, all: main.every((i) => i.state === 'on'), groups };
  }

  // Outside the app, the same groups without any state: what the app guards, never a guess at what it is doing.
  function outline() {
    const info = { platform: 'win32', live: { supported: true }, downloads: {}, defense: {}, remoteGuard: { supported: true }, mySites: true, embeddedServer: true,
      scanMenu: { supported: true }, clipboardCheck: false, chatSafety: {}, textSafety: {}, snip: { supported: true } };
    return board(info).groups.map((g) => ({ id: g.id, title: g.title, rows: g.rows.map((r) => ({ id: r.id, name: r.name, line: r.what, main: r.main })) }));
  }

  const api = { board, outline, item, summary, WORDS };
  root.SentinelGuards = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
