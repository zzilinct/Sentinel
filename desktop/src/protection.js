'use strict';
/**
 * The one answer to "am I protected right now?". The tray's icon, its tooltip, the first line of its menu, the tray
 * card and the start window all read it, so they cannot disagree. It is made from the statuses main.js already has
 * (downloads, Defense, live scanning, chat and texts), never from the switches alone: a protection counts as on only
 * while it is really running. Pure: no Electron, no clock, no disk.
 *
 * Each protection is one of:
 *   on           switched on and running
 *   off          switched off by the person
 *   unavailable  switched on, but not part of this plan or this computer (sign in, Pro, Windows only): not a fault
 *   starting     switched on and coming up
 *   trouble      switched on and not running (offline, a folder that cannot be watched, a reader that stopped)
 * and the whole is one level: starting, on, partly (something switched on is in trouble) or off (nothing runs).
 */

const UNAVAILABLE = /sign in|part of|available on windows/i;

function item(id, name, { enabled, active, reason, onNote }) {
  if (!enabled) return { id, name, enabled: false, state: 'off', note: 'Off' };
  if (active) return { id, name, enabled: true, state: 'on', note: onNote };
  const why = String(reason || '').replace(/^(Download protection|Defense|Live scanning):\s*/i, '');
  if (!why || /^starting/i.test(why)) return { id, name, enabled: true, state: 'starting', note: 'Starting' };
  return { id, name, enabled: true, state: UNAVAILABLE.test(why) ? 'unavailable' : 'trouble', note: why.charAt(0).toUpperCase() + why.slice(1) };
}

/**
 * s: { booting, down, windows, downloads: { enabled, active, reason }, defense: { enabled, active, reason },
 *      live: { enabled, active, reason, window }, chat: { enabled, running }, texts: { enabled, running } }
 */
function protectionState(s) {
  const items = [
    item('downloads', 'Downloads', { ...s.downloads, onNote: 'Every new file is checked' }),
    ...(s.windows ? [item('defense', 'Defense', { ...s.defense, onNote: 'Startup programs are watched' })] : []),
    item('live', 'Live scanning', { ...s.live, onNote: s.live.window ? 'Watching the browser in front' : 'Ready for your browser' }),
    ...(s.windows ? [
      item('chat', 'Chat safety', { enabled: s.chat.enabled, active: s.chat.running, reason: 'Cannot read chat right now', onNote: 'Roblox and Discord chats are read here' }),
      item('texts', 'Texts', { enabled: s.texts.enabled, active: s.texts.running, reason: 'Cannot read texts right now', onNote: 'Phone Link texts are read here' })
    ] : [])
  ];
  const on = items.filter((i) => i.state === 'on');
  const trouble = items.filter((i) => i.state === 'trouble');
  if (s.down) {
    return { level: 'off', items, headline: 'Sentinel\'s scanner stopped', sub: 'It starts again by itself. Until then, new files and pages are not checked.' };
  }
  if (s.booting || (!trouble.length && items.some((i) => i.state === 'starting'))) {
    return { level: 'starting', items, headline: 'Sentinel is starting', sub: 'Your protection comes on in a moment.' };
  }
  if (trouble.length) {
    // The why is on the protection's own line in the card; the headline says which, in plain words.
    return { level: 'partly', items, headline: 'Partly protected', sub: `${trouble.map((i) => i.name).join(' and ')} ${trouble.length > 1 ? 'are' : 'is'} not working right now.` };
  }
  if (!on.length) {
    return { level: 'off', items, headline: 'Protection is off', sub: 'Nothing is being watched right now.' };
  }
  // Counted as they are: one that is switched on but not part of this plan is not running, and is not left out.
  return {
    level: 'on',
    items,
    headline: 'Protection is on',
    sub: on.length === items.length ? `All ${on.length} protections are running.` : `${on.length} of ${items.length} protections are running.`
  };
}

/** The tray icon for a level: the full mask, the mask with a dot, or an empty mask. */
function trayIcon(level) {
  return level === 'on' ? 'tray-on' : level === 'partly' ? 'tray-partly' : 'tray-off';
}

/** Windows cuts a tray tooltip at 127 characters. */
function trayTooltip(p) {
  const text = `Sentinel: ${p.headline}. ${p.sub}`;
  return text.length <= 127 ? text : `${text.slice(0, 124).replace(/\s+\S*$/, '')}...`;
}

module.exports = { protectionState, trayIcon, trayTooltip };
