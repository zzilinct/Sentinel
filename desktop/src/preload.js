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
  info: () => ipcRenderer.invoke('sentinel:info'),
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
  // Answered only for the app's own warning page.
  warnAction: (action, url) => ipcRenderer.invoke('sentinel:warn-action', String(action), url == null ? '' : String(url)),
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
