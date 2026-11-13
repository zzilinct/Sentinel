'use strict';
// The sheet for checking something on screen: it can hand over the box drawn, close itself, and be told what was found.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelSnip', {
  pick: (rect) => ipcRenderer.invoke('snip:pick', { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) }),
  close: () => ipcRenderer.invoke('snip:close'),
  onState: (callback) => ipcRenderer.on('snip:state', (_event, state) => callback(state)),
  // Motion (Full, Calm or Off) and the scan effect: told when the page has loaded and on every change (pages/motion.js).
  onMotion: (callback) => ipcRenderer.on('sentinel:motion-level', (_event, m) => callback(m))
});
