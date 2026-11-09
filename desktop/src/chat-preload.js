'use strict';
// The chat safety window's only doorway: it is told what to show, says where its cards are (the only part of the
// window that takes a click), and passes on a card's answer: hide it, or "This is wrong".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentinelChat', {
  onState: (callback) => ipcRenderer.on('chat:state', (_event, state) => callback(state)),
  shape: (rects) => ipcRenderer.send('chat:shape', rects),
  answer: (n, action) => ipcRenderer.invoke('chat:answer', Number(n), String(action))
});
