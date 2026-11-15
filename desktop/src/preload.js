'use strict';
/**
 * The only doorway between the Sentinel web app and the desktop. Exposes a
 * handful of narrow functions - no Node, no file system, no arbitrary IPC.
 * The main process re-checks the calling page's origin on every call.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Subscribe to a main-process event; returns the unsubscribe function. */
function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sentinelDesktop', {
  // Motion (Full, Calm or Off) and the scan effect: told when the page has loaded and on every change (pages/motion.js).
  onMotion: (callback) => ipcRenderer.on('sentinel:motion-level', (_event, m) => callback(m)),
  info: () => ipcRenderer.invoke('sentinel:info'),
  // The look (light, dark or Auto, and the accent), one setting for the app, live scanning, its cards and the companion.
  look: () => ipcRenderer.invoke('sentinel:look'),
  // Text size and spacing ride along (look.js KEYS), so the companion on this computer follows them too.
  setLook: (look) => {
    const l = look || {}, at = l.at || {}, out = { at: {} };
    for (const k of ['mode', 'accent', 'text', 'density']) { out[k] = String(l[k] || ''); out.at[k] = Number(at[k]) || 0; }
    return ipcRenderer.invoke('sentinel:set-look', out);
  },
  setToken: (token, userId) => ipcRenderer.invoke('sentinel:set-token', token, userId),
  clearToken: () => ipcRenderer.invoke('sentinel:clear-token'),
  setDownloadProtection: (enabled) => ipcRenderer.invoke('sentinel:set-download-protection', Boolean(enabled)),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('sentinel:set-open-at-login', Boolean(enabled)),
  setClipboardCheck: (enabled) => ipcRenderer.invoke('sentinel:set-clipboard-check', Boolean(enabled)),
  setCommandShield: (enabled) => ipcRenderer.invoke('sentinel:set-command-shield', Boolean(enabled)),
  // Wallet guard: a copied wallet address swapped by malware is put back.
  setWalletGuard: (enabled) => ipcRenderer.invoke('sentinel:set-wallet-guard', Boolean(enabled)),
  // "Check something on screen": the switch and the shortcut (one of info().snip.keys).
  setSnip: (enabled, key) => ipcRenderer.invoke('sentinel:set-snip', Boolean(enabled), String(key || '')),
  // "Scan with Sentinel" in the right-click menu for files: the switch, and the file it handed over ({ name, size, data }), once.
  setScanMenu: (enabled) => ipcRenderer.invoke('sentinel:set-scan-menu', Boolean(enabled)),
  takeMenuFile: () => ipcRenderer.invoke('sentinel:take-menu-file'),
  // Its result window when signed out (pages/filescan.html): 'close', or 'signin' for the account's deeper check.
  menuResultAction: (action) => ipcRenderer.invoke('sentinel:menu-result-action', String(action)),
  // "Put it back": the command "Stop pasted commands" took off the clipboard. Its text never reaches the page.
  commandPutBack: () => ipcRenderer.invoke('sentinel:command-put-back'),
  onCommand: (callback) => on('sentinel:command', callback),
  // Exposure alerts: sites visited that a threat list named afterwards.
  setExposureAlerts: (enabled) => ipcRenderer.invoke('sentinel:set-exposure-alerts', Boolean(enabled)),
  exposures: () => ipcRenderer.invoke('sentinel:exposures'),
  dismissExposure: (host) => ipcRenderer.invoke('sentinel:exposure-dismiss', String(host)),
  checkDownloadsFrom: (day) => ipcRenderer.invoke('sentinel:exposure-downloads', Number(day)),
  onExposures: (callback) => on('sentinel:exposures', callback),
  // Your sites: look-alikes of the sites the person uses. Kept by the app's own server on this computer.
  setMySites: (enabled) => ipcRenderer.invoke('sentinel:set-my-sites', Boolean(enabled)),
  mySites: () => ipcRenderer.invoke('sentinel:my-sites'),
  addMySite: (host) => ipcRenderer.invoke('sentinel:my-sites-add', String(host)),
  removeMySite: (host) => ipcRenderer.invoke('sentinel:my-sites-remove', String(host)),
  forgetMySites: () => ipcRenderer.invoke('sentinel:my-sites-forget'),
  // Your week with Sentinel: a note once a week, off until turned on.
  setWeekRecap: (enabled) => ipcRenderer.invoke('sentinel:set-week-recap', Boolean(enabled)),
  week: () => ipcRenderer.invoke('sentinel:week'),
  recentDownloads:() => ipcRenderer.invoke('sentinel:recent-downloads'),
  quarantine: (id) => ipcRenderer.invoke('sentinel:quarantine', String(id)),
  // Live scanning: one switch, and "Scan with <browser>".
  liveStart: () => ipcRenderer.invoke('sentinel:live-start'),
  liveStop: () => ipcRenderer.invoke('sentinel:live-stop'),
  // Chat safety (Roblox and the Discord app): one switch.
  setChatSafety: (enabled) => ipcRenderer.invoke('sentinel:chat-safety', Boolean(enabled)),
  onChatSafety: (callback) => on('sentinel:chat-safety', callback),
  // Parent lock: a PIN before protection can be switched off. The PIN is checked in the main process.
  lockStatus: () => ipcRenderer.invoke('sentinel:lock-status'),
  lockSet: (pin) => ipcRenderer.invoke('sentinel:lock-set', String(pin)),
  lockUnlock: (pin) => ipcRenderer.invoke('sentinel:lock-unlock', String(pin)),
  lockRelock: () => ipcRenderer.invoke('sentinel:lock-relock'),
  lockRemove: () => ipcRenderer.invoke('sentinel:lock-remove'),
  lockReset: () => ipcRenderer.invoke('sentinel:lock-reset'),
  setLiveMode:(mode) => ipcRenderer.invoke('sentinel:live-mode', mode === 'delicate' ? 'delicate' : 'fast'),
  // Marks beside links and pop-up warnings: three words each, checked again by the app (masks.js level).
  setMarksLevel: (level) => ipcRenderer.invoke('sentinel:marks-level', String(level)),
  setWarningsLevel: (level) => ipcRenderer.invoke('sentinel:warnings-level', String(level)),
  // Text size and spacing (boot.js sends them), for Sentinel's own windows; they hear them back (pages/type.js).
  setType: (t) => ipcRenderer.invoke('sentinel:type', { text: String(t && t.text), density: String(t && t.density) }),
  onType: (callback) => ipcRenderer.on('sentinel:type-level', (_event, t) => callback(t)),
  // Motion (full, calm or off) and the scan effect, for the live scanning overlay (boot.js sends it).
  setMotion: (m) => ipcRenderer.invoke('sentinel:motion', { motion: String(m && m.motion), scanEffect: !(m && m.scanEffect === false) }),
  // Texts in Phone Link: one switch.
  setTextSafety: (enabled) => ipcRenderer.invoke('sentinel:text-safety', Boolean(enabled)),
  onTextSafety: (callback) => on('sentinel:text-safety', callback),
  setAutoScan: (enabled) => ipcRenderer.invoke('sentinel:auto-scan', Boolean(enabled)),
  scanWith: (browser) => ipcRenderer.invoke('sentinel:scan-with', String(browser)),
  checkUpdates: () => ipcRenderer.invoke('sentinel:check-updates'),
  installUpdate: () => ipcRenderer.invoke('sentinel:install-update'),
  installModel: (version) => ipcRenderer.invoke('sentinel:install-model', String(version)),
  // PNG slices of one screenshot, as Uint8Arrays; resolves to the text of each.
  readScreenshot: (images) => ipcRenderer.invoke('sentinel:read-screenshot', [...images].map((b) => new Uint8Array(b))),
  // Browser checkup: read only; the result lists what was found, judged.
  browserCheckup: () => ipcRenderer.invoke('sentinel:checkup'),
  openBrowser: (id) => ipcRenderer.invoke('sentinel:checkup-open', String(id)),
  defense: () => ipcRenderer.invoke('sentinel:defense'),
  setDefense: (enabled) => ipcRenderer.invoke('sentinel:set-defense', Boolean(enabled)),
  restoreQuarantined: (id) => ipcRenderer.invoke('sentinel:defense-restore', String(id)),
  quarantineSuspect: (id) => ipcRenderer.invoke('sentinel:defense-act', String(id)),
  onDefense: (callback) => on('sentinel:defense', callback),
  onDefenseThreat: (callback) => on('sentinel:defense-threat', callback),
  onPageChecked: (callback) => on('sentinel:page-checked', callback),
  onDownloadThreat: (callback) => on('sentinel:download-threat', callback),
  onPageThreat: (callback) => on('sentinel:page-threat', callback),
  onLive: (callback) => on('sentinel:live', callback),
  onBrowsers: (callback) => on('sentinel:browsers', callback),
  onUpdate: (callback) => on('sentinel:update', callback),
  // A setting changed outside the app's window (the tray): its switches are drawn again.
  onSettings: (callback) => on('sentinel:settings', callback),
  // Answered only for the app's own warning page.
  warnAction: (action, url) => ipcRenderer.invoke('sentinel:warn-action', String(action), url == null ? '' : String(url)),
  // A warning card's words changed (pages/card.js): its window is sized to them again.
  cardFit: () => ipcRenderer.invoke('sentinel:card-fit'),
  // Tech-support scam shield: one switch in the app, and the answers of its own warning page (guard.html).
  setRemoteGuard: (enabled) => ipcRenderer.invoke('sentinel:set-remote-guard', Boolean(enabled)),
  forgetTrustedRemote: () => ipcRenderer.invoke('sentinel:forget-trusted-remote'),
  guardAction: (action, arg) => ipcRenderer.invoke('sentinel:guard-action', String(action), arg == null ? '' : String(arg)),
  // The call check said "Hang up": only that, for the pay pause (paypause.js). Nothing ticked is passed.
  callHangUp: () => ipcRenderer.invoke('sentinel:call-hangup'),
  // Answered only for the app's own error page; the main process checks the caller.
  retryServer: () => ipcRenderer.invoke('sentinel:retry-server'),
  openLogs: () => ipcRenderer.invoke('sentinel:open-logs'),
  quit: () => ipcRenderer.invoke('sentinel:quit')
});
