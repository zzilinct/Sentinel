'use strict';
// The chat safety window's only doorway: it can be told what to show, and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelChat', {
  onState: (callback) => ipcRenderer.on('chat:state', (_event, state) => callback(state))
});
