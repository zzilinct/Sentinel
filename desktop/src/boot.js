'use strict';
/**
 * Where Sentinel starts. The crash log is set up here, before main.js and its many requires load, so a start that
 * breaks inside a require still leaves its reason in logs/app.log, and the person sees a message instead of nothing.
 */
const path = require('path');
const fs = require('fs');
const { app, dialog } = require('electron');

/**
 * The app's own log (logs/app.log, beside the server's). Every startup stage
 * and every error lands here, so a start that goes wrong always leaves a trace.
 */
function appLog(text) {
  try {
    const file = path.join(app.getPath('userData'), 'logs', 'app.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file.replace(/\.log$/, '.previous.log')); } catch { /* no log yet */ }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${text}\n`);
  } catch { /* logging must never break the app */ }
}
// Set before main.js loads: it takes appLog from here.
module.exports = { appLog };

process.on('uncaughtException', (err) => appLog(`uncaught exception: ${err && err.stack || err}`));
process.on('unhandledRejection', (err) => appLog(`unhandled rejection: ${err && err.stack || err}`));

try {
  require('./main');
} catch (err) {
  appLog(`could not start: ${err && err.stack || err}`);
  app.whenReady().then(() => {
    dialog.showErrorBox('Sentinel could not start', `Something went wrong while Sentinel was starting. The reason is saved in ${path.join(app.getPath('userData'), 'logs', 'app.log')}.\n\n${err && err.message || err}`);
    app.exit(1);
  });
}
