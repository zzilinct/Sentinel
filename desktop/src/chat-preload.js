'use strict';
// The chat safety window's only doorway: it can be told what to show, and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelChat', {
  onState: (callback) => ipcRenderer.on('chat:state', (_event, state) => callback(state)),
  // Motion (Full, Calm or Off) and the scan effect: told when the page has loaded and on every change (pages/motion.js).
  onMotion: (callback) => ipcRenderer.on('sentinel:motion-level', (_event, m) => callback(m))
});
