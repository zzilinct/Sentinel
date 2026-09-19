'use strict';
/**
 * Page watch: protection with no browser add-on at all.
 *
 * Windows exposes every browser's current page through UI Automation, the
 * same accessibility layer screen readers use. Sentinel asks it, about once a
 * second, which page the browser in front is showing, and checks that address
 * with the scanner. A dangerous page gets a notification and a warning window.
 *
 * What this can and cannot do:
 *   - It sees the address of the page in the browser window you are looking at,
 *     in Chrome, Edge, Brave and Firefox. It never reads page content, form
 *     fields or anything you type.
 *   - It cannot draw masks inside search results or your inbox; only the
 *     companion add-on can do that.
 *   - Windows only for now. Other platforms report "not available".
 *
 * The reader is a small PowerShell loop, started hidden and handed the script
 * inline, so nothing is written to disk. It prints one JSON line whenever the
 * page in front changes; this module does the rest.
 */
const { spawn } = require('child_process');

const BROWSER_PROCESSES = ['chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'duckduckgo', 'firefox', 'librewolf'];
const RECHECK_MS = 10 * 60 * 1000;     // same host warned again after this long
const SETTLE_MS = 700;                 // a page must stay in front this long before it is checked

// Foreground window -> owning process -> the page's document element -> its URL.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class SW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static uint IdleMs() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
}
"@
$A = [System.Windows.Automation.AutomationElement]
$docCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$browsers = @('chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'duckduckgo', 'firefox', 'librewolf')
$last = ''
$lastFront = ''
while ($true) {
  Start-Sleep -Milliseconds 900
  $h = [SW]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { continue }
  $fp = 0
  [void][SW]::GetWindowThreadProcessId($h, [ref]$fp)
  $fname = (Get-Process -Id $fp).ProcessName
  if ($fname -and $fname -ne $lastFront) { $lastFront = $fname; Write-Output (@{ front = $fname; isBrowser = ($browsers -contains $fname) } | ConvertTo-Json -Compress) }
  # Nobody at the keyboard, or the window is minimised: the browser is not "in use".
  if ([SW]::IdleMs() -gt 120000 -or [SW]::IsIconic($h)) { if ($last -ne '') { $last = ''; Write-Output '{"url":null,"idle":true}' } ; continue }
  $pid2 = 0
  [void][SW]::GetWindowThreadProcessId($h, [ref]$pid2)
  $p = Get-Process -Id $pid2
  if (-not $p -or ($browsers -notcontains $p.ProcessName)) { if ($last -ne '') { $last = ''; Write-Output '{"url":null}' } ; continue }
  $url = $null
  try {
    $root = $A::FromHandle($h)
    $doc = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
    if ($doc) { $url = $doc.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
  } catch { $url = $null }
  if (-not $url) { continue }
  $key = $p.ProcessName + '|' + $url
  if ($key -eq $last) { continue }
  $last = $key
  $o = @{ browser = $p.ProcessName; url = $url } | ConvertTo-Json -Compress
  Write-Output $o
}
`;

let child = null;
let opts = null;
let state = { active: false, reason: 'Starting', supported: process.platform === 'win32', current: null };
const warned = new Map();
let settleTimer = null;
let restartTimer = null;

function status() { return { ...state }; }
function log(text) { if (opts && opts.onLog) opts.onLog(text); }

function setState(active, reason) {
  state = { ...state, active, reason };
  if (opts && opts.onChange) opts.onChange(status());
}

function init(options) {
  opts = options;
  restart();
}

async function restart() {
  stop(null, true);
  if (!state.supported) return setState(false, 'Page watch is available on Windows');
  if (!opts.enabled()) return setState(false, 'Page watch: off');
  if (!opts.getToken()) return setState(false, 'Sign in to turn on page watch');
  try {
    const me = await opts.api('/api/v1/auth/me');
    if (!me.plan.features.liveScanning) return setState(false, 'Page watch needs Pro or Max');
  } catch (err) {
    return setState(false, err.status === 401 ? 'Sign in to turn on page watch' : 'Sentinel is offline - will retry');
  }
  start();
}

function start() {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    log(`could not start the reader: ${err.message}`);
    return setState(false, `Page watch could not start (${err.message})`);
  }
  log('reader started');
  let errText = '';
  child.stderr.on('data', (c) => { if (errText.length < 600) { errText += c.toString('utf8'); } });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  child.on('exit', (code) => {
    log(`reader exited (${code})${errText ? `: ${errText.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
    child = null;
    if (!state.active) return;
    // Keep watching: the reader is cheap to bring back.
    setState(false, 'Page watch stopped - restarting');
    restartTimer = setTimeout(() => restart(), 3000);
  });
  setState(true, null);
}

function stop(reason, silent) {
  clearTimeout(settleTimer);
  clearTimeout(restartTimer);
  if (child) { try { child.kill(); } catch { /* gone */ } child = null; }
  state.current = null;
  if (!silent) setState(false, reason ? `Page watch: ${reason.toLowerCase()}` : 'Page watch: off');
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.front) { if (msg.isBrowser) log(`${msg.front} is in front`); return; }
  clearTimeout(settleTimer);
  if (msg.idle) { if (!state.idle) log('nobody at the keyboard or window minimised: paused'); state.current = null; state.idle = true; return; }
  if (state.idle) log('in use again');
  state.idle = false;
  if (!msg.url || !/^https?:\/\//i.test(msg.url)) { state.current = null; return; }
  // Sentinel's own pages and the app's server are not "sites".
  if (opts.origin && msg.url.startsWith(opts.origin)) { state.current = null; return; }
  state.current = { browser: msg.browser, url: msg.url, at: Date.now() };
  settleTimer = setTimeout(() => check(msg.browser, msg.url).catch(() => {}), SETTLE_MS);
}

async function check(browser, url) {
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  const last = warned.get(host);
  if (last && Date.now() - last < RECHECK_MS) return;

  let verdict;
  try {
    ({ verdict } = await opts.api('/api/v1/live/visit', { url }));
  } catch (err) {
    log(`check failed for ${host}: ${err.status || ''} ${err.code || err.message}`);
    if (err.status === 401) setState(false, 'Sign in to turn on page watch');
    else if (err.status === 403) setState(false, 'Page watch needs Pro or Max');
    else if (err.code === 'live_hours_exhausted') setState(false, 'Live hours for this week are used up');
    return;
  }
  if (opts.onChecked) opts.onChecked({ browser, url, host, badge: (verdict && verdict.overall && verdict.overall.badge) || null, label: verdict && verdict.overall ? verdict.overall.label : 'Checked', at: Date.now() });
  if (!verdict || !verdict.overall || !verdict.overall.badge) return;
  const severe = verdict.overall.badge === 'red' || verdict.overall.badge === 'orange';
  if (!severe) return;
  warned.set(host, Date.now());
  if (warned.size > 500) warned.clear();
  opts.onThreat({ browser, url, host, verdict });
}

module.exports = { init, restart, stop, status };
