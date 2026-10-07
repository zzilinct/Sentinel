'use strict';
/**
 * Tech-support scam shield: the two moments of a tech-support scam that Sentinel can see from outside the browser.
 *
 * 1. A fake virus alert holds the browser full screen ("your computer is blocked, call Microsoft"). main.js offers
 *    a way out: Sentinel asks Windows to close that browser window (see watch.js, the reader's "close").
 * 2. The "agent" on the phone has the person install a remote-control program and connects. A remote-control
 *    program that starts soon after a flagged page, or soon after it was downloaded, gets a plain question.
 *
 * What it looks at: process names (the running-browsers helper's list in browsers.js, so no new polling) and the
 * file names download protection already lists. It reads no screen, window, page or file, and it never stops a
 * program by itself: only the person's "End the connection" does that.
 */
const { BRANDS } = require('../shared/brands');

// The programs these scams ask people to install. Process names as Windows reports them, without ".exe", lower case.
// `service`: the Windows service an installed copy runs as (a name pattern), which only an administrator can stop.
const TOOLS = [
  { id: 'anydesk', name: 'AnyDesk', processes: ['anydesk'], file: /anydesk/i, service: 'AnyDesk*' },
  { id: 'teamviewer', name: 'TeamViewer', processes: ['teamviewer', 'teamviewerqs', 'teamviewer_desktop'], file: /teamviewer/i, service: 'TeamViewer*' },
  { id: 'ultraviewer', name: 'UltraViewer', processes: ['ultraviewer_desktop', 'ultraviewer'], file: /ultra[ _-]?viewer/i, service: 'UltraView*' },
  { id: 'rustdesk', name: 'RustDesk', processes: ['rustdesk'], file: /rustdesk/i, service: 'RustDesk*' },
  { id: 'screenconnect', name: 'ScreenConnect', processes: ['screenconnect.windowsclient', 'screenconnect.clientservice'], file: /screenconnect|connectwise/i, service: 'ScreenConnect*' },
  { id: 'supremo', name: 'Supremo', processes: ['supremo', 'supremoservice'], file: /^supremo/i, service: 'Supremo*' },
  { id: 'aeroadmin', name: 'AeroAdmin', processes: ['aeroadmin'], file: /aeroadmin/i },
  { id: 'quickassist', name: 'Quick Assist', processes: ['quickassist'], file: /quick[ _-]?assist/i }
];
const PROCESS_NAMES = TOOLS.flatMap((t) => t.processes);
const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// How close together the steps of the scam have to be for Sentinel to ask.
const PAGE_WINDOW_MS = 30 * 60 * 1000;
const DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;

/** The tools running, by id, from the process names the helper reported. */
function toolsRunning(names) {
  const set = names instanceof Set ? names : new Set(names || []);
  return new Set(TOOLS.filter((t) => t.processes.some((p) => set.has(p))).map((t) => t.id));
}

/** Why a tool that has just started is worth a question, or null when it is not. */
function reasonFor(tool, { flaggedAt = 0, downloads = [], now = Date.now() } = {}) {
  if (flaggedAt && now - flaggedAt >= 0 && now - flaggedAt <= PAGE_WINDOW_MS) return 'page';
  const fresh = (downloads || []).some((d) => d && tool.file.test(String(d.name || '')) && now - Number(d.scannedAt || 0) <= DOWNLOAD_WINDOW_MS);
  return fresh ? 'download' : null;
}

// Banks, payment services and exchanges, from the brands Sentinel already knows. A remote-control program running
// while one of these is open is the moment the money moves.
const MONEY = new Set(['paypal', 'venmo', 'zelle', 'cashapp', 'wise', 'revolut', 'chase', 'wellsfargo', 'bankofamerica', 'citibank',
  'capitalone', 'americanexpress', 'usaa', 'truist', 'santander', 'hsbc', 'barclays', 'natwest', 'lloyds', 'interac', 'mercadopago',
  'navyfederal', 'monzo', 'desjardins', 'scotiabank', 'tdbank', 'commbank', 'westpac', 'schwab', 'etrade', 'axisbank', 'coinbase', 'binance', 'kraken']);
const MONEY_DOMAINS = BRANDS.filter((b) => MONEY.has(b.token)).flatMap((b) => b.domains);

/** Is this address a bank's or a payment service's own site? */
function moneySite(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/\.$/, ''); } catch { return false; }
  if (MONEY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  // Banks Sentinel has no list for: "bank" in the site's own name (usbank.com, onlinebanking.example-cu.org).
  return /bank|creditunion/.test(host);
}

/**
 * The PowerShell that ends an installed copy, after the person said yes to Windows' administrator prompt: stop its
 * service, then end its programs. Prints "cancelled" when the prompt was refused. Names come from TOOLS only.
 */
function adminStopScript(tool) {
  const steps = [
    ...(tool.service ? [`Get-Service -Name '${tool.service}' -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue`] : []),
    ...tool.processes.map((p) => `taskkill.exe /IM '${p}.exe' /T /F`)
  ].join('; ');
  const encoded = Buffer.from(steps, 'utf16le').toString('base64');
  return `try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}' -ErrorAction Stop } catch { 'cancelled' }`;
}

/** The process names in `tasklist /FO CSV /NH` output, lower case and without ".exe", for toolsRunning. */
function namesFromTasklist(out) {
  return String(out || '').split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((n) => n.toLowerCase().replace(/\.exe$/, ''));
}

/**
 * One per app. `update` is given the process names each time the helper reports; it answers with the tools that
 * have just started and deserve a question. The first report is only a starting point: a program that was already
 * running when Sentinel started is someone's own setup, not a new connection.
 */
function create() {
  let prev = null;
  let flaggedAt = 0;
  return {
    flaggedPage(at = Date.now()) { flaggedAt = at; },
    update(names, { downloads = [], trusted = [], now = Date.now() } = {}) {
      const running = toolsRunning(names);
      const fresh = prev ? [...running].filter((id) => !prev.has(id)) : [];
      prev = running;
      return fresh
        .filter((id) => !trusted.includes(id))
        .map((id) => ({ tool: byId[id], reason: reasonFor(byId[id], { flaggedAt, downloads, now }) }))
        .filter((a) => a.reason);
    },
    /** Tools running now that the person has not said they use themselves. */
    running(trusted = []) { return prev ? [...prev].filter((id) => !trusted.includes(id)).map((id) => byId[id]) : []; }
  };
}

module.exports = { TOOLS, PROCESS_NAMES, byId, create, moneySite, reasonFor, toolsRunning, adminStopScript, namesFromTasklist, PAGE_WINDOW_MS, DOWNLOAD_WINDOW_MS };
