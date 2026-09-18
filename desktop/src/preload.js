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
  recentDownloads: () => ipcRenderer.invoke('sentinel:recent-downloads'),
  quarantine: (id) => ipcRenderer.invoke('sentinel:quarantine', String(id)),
  openCompanionFolder: (browser) => ipcRenderer.invoke('sentinel:open-companion-folder', browser == null ? null : String(browser)),
  browsers: () => ipcRenderer.invoke('sentinel:browsers'),
  openExtensionsPage: (browser) => ipcRenderer.invoke('sentinel:open-extensions-page', String(browser)),
  setPageWatch: (enabled) => ipcRenderer.invoke('sentinel:set-page-watch', Boolean(enabled)),
  checkUpdates: () => ipcRenderer.invoke('sentinel:check-updates'),
  installUpdate: () => ipcRenderer.invoke('sentinel:install-update'),
  onDownloadThreat: (callback) => on('sentinel:download-threat', callback),
  onPageThreat: (callback) => on('sentinel:page-threat', callback),
  onPageWatch: (callback) => on('sentinel:page-watch', callback),
  onBrowsers: (callback) => on('sentinel:browsers', callback),
  onUpdate: (callback) => on('sentinel:update', callback),
  // Answered only for the app's own warning page.
  warnAction: (action, url) => ipcRenderer.invoke('sentinel:warn-action', String(action), url == null ? '' : String(url)),
  // Answered only for the app's own error page; the main process checks the caller.
  retryServer: () => ipcRenderer.invoke('sentinel:retry-server'),
  openLogs: () => ipcRenderer.invoke('sentinel:open-logs'),
  quit: () => ipcRenderer.invoke('sentinel:quit')
});
