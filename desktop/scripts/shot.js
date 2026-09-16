'use strict';
/**
 * Design QA helper: renders pages in a hidden window and saves PNG screenshots.
 *
 *   electron scripts/shot.js --batch <jobs.json>
 *   jobs.json: { "outDir": "...", "jobs": [{ "url", "width", "height", "scrollY", "wait", "name", "js" }] }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const LOG = path.join(os.tmpdir(), 'sentinel-shot.log');
const log = (...parts) => fs.appendFileSync(LOG, `${parts.join(' ')}\n`);
process.on('uncaughtException', (err) => { log('uncaught', err.stack); app.exit(1); });

log('loaded', process.argv.join(' | '));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Closing each capture window must not quit the app before the next job.
app.on('window-all-closed', () => {});

async function capture(job, outDir) {
  const { url, width = 1440, height = 900, scrollY = 0, wait = 3500, name = 'shot', js } = job;
  const win = new BrowserWindow({ show: false, width, height, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
  try {
    await win.loadURL(url);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await win.loadURL(url);
  }
  if (scrollY) await win.webContents.executeJavaScript(`window.scrollTo(0, ${Number(scrollY)}); 0`);
  if (js) await win.webContents.executeJavaScript(`${js}; 0`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  win.destroy();
  return file;
}

app.whenReady().then(async () => {
  log('ready');
  try {
    const i = process.argv.indexOf('--batch');
    const spec = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
    fs.mkdirSync(spec.outDir, { recursive: true });
    for (const job of spec.jobs) log('saved', await capture(job, spec.outDir));
  } catch (err) {
    log('error', err.stack);
  }
  app.exit(0);
});
