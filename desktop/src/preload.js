'use strict';
/**
 * The only doorway between the Sentinel web app and the desktop. Exposes a
 * handful of narrow functions - no Node, no file system, no arbitrary IPC.
 * The main process re-checks the calling page's origin on every call.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelDesktop', {
  info: () => ipcRenderer.invoke('sentinel:info'),
  setToken: (token, userId) => ipcRenderer.invoke('sentinel:set-token', token, userId),
  clearToken: () => ipcRenderer.invoke('sentinel:clear-token'),
  setDownloadProtection: (enabled) => ipcRenderer.invoke('sentinel:set-download-protection', Boolean(enabled)),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('sentinel:set-open-at-login', Boolean(enabled)),
  recentDownloads: () => ipcRenderer.invoke('sentinel:recent-downloads'),
  quarantine: (id) => ipcRenderer.invoke('sentinel:quarantine', String(id)),
  openCompanionFolder: () => ipcRenderer.invoke('sentinel:open-companion-folder'),
  onDownloadThreat: (callback) => {
    const listener = (_event, item) => callback(item);
    ipcRenderer.on('sentinel:download-threat', listener);
    return () => ipcRenderer.removeListener('sentinel:download-threat', listener);
  }
});
