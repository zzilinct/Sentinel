'use strict';
// The sheet for checking something on screen: it can hand over the box drawn, close itself, and be told what was found.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelSnip', {
  pick: (rect) => ipcRenderer.invoke('snip:pick', { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) }),
  close: () => ipcRenderer.invoke('snip:close'),
  onState: (callback) => ipcRenderer.on('snip:state', (_event, state) => callback(state))
});
