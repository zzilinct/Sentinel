'use strict';
/** The overlay page only listens. It can ask the main process for nothing. */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['overlay:watching', 'overlay:sweep', 'overlay:verdict', 'overlay:marks', 'overlay:clear'];

contextBridge.exposeInMainWorld('sentinelOverlay', {
  on(channel, callback) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  }
});
