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
  recentDownloads: () => ipcRenderer.invoke('sentinel:recent-downloads'),
  quarantine: (id) => ipcRenderer.invoke('sentinel:quarantine', String(id)),
  // Live scanning: one switch, and "Scan with <browser>".
  liveStart: () => ipcRenderer.invoke('sentinel:live-start'),
  liveStop: () => ipcRenderer.invoke('sentinel:live-stop'),
  // Chat safety (Roblox and the Discord app): one switch.
  setChatSafety: (enabled) => ipcRenderer.invoke('sentinel:chat-safety', Boolean(enabled)),
  onChatSafety: (callback) => on('sentinel:chat-safety', callback),
  setLiveMode: (mode) => ipcRenderer.invoke('sentinel:live-mode', mode === 'delicate' ? 'delicate' : 'fast'),
  setAutoScan: (enabled) => ipcRenderer.invoke('sentinel:auto-scan', Boolean(enabled)),
  scanWith: (browser) => ipcRenderer.invoke('sentinel:scan-with', String(browser)),
  checkUpdates: () => ipcRenderer.invoke('sentinel:check-updates'),
  installUpdate: () => ipcRenderer.invoke('sentinel:install-update'),
  installModel: (version) => ipcRenderer.invoke('sentinel:install-model', String(version)),
  // PNG slices of one screenshot, as Uint8Arrays; resolves to the text of each.
  readScreenshot: (images) => ipcRenderer.invoke('sentinel:read-screenshot', [...images].map((b) => new Uint8Array(b))),
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
  // Answered only for the app's own error page; the main process checks the caller.
  retryServer: () => ipcRenderer.invoke('sentinel:retry-server'),
  openLogs: () => ipcRenderer.invoke('sentinel:open-logs'),
  quit: () => ipcRenderer.invoke('sentinel:quit')
});
