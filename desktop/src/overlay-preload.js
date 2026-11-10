'use strict';
/** The overlay page listens. It can ask the main process for two things only: to take the pointer while the island's
 * panel is under it, and one of the panel's few actions (overlay.js checks who is asking and which action). */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['overlay:watching', 'overlay:sweep', 'overlay:verdict', 'overlay:marks', 'overlay:shift', 'overlay:wheel', 'overlay:px', 'overlay:pay', 'overlay:clear',
  'overlay:page', 'overlay:paused', 'overlay:open', 'overlay:close'];

contextBridge.exposeInMainWorld('sentinelOverlay', {
  on(channel, callback) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
  // Motion (Full, Calm or Off) and the scan effect: told when the page has loaded and on every change (pages/motion.js).
  onMotion: (callback) => ipcRenderer.on('sentinel:motion-level', (_event, m) => callback(m)),
  interact: (on) => ipcRenderer.send('overlay:interact', Boolean(on)),
  act: (action) => ipcRenderer.send('overlay:act', String(action))
});
