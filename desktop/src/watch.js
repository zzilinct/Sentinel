'use strict';
/**
 * Live scanning: protection inside any browser with no add-on at all.
 *
 * Windows exposes every browser's current page through UI Automation, the
 * same accessibility layer screen readers use. While live scanning is on and a
 * browser is the window in front, Sentinel asks it, about twice a second:
 *
 *   - which page is showing          -> the address is checked; a dangerous page
 *                                       gets a warning
 *   - where the page sits on screen  -> so the overlay (overlay.js) can put the
 *                                       gold line, the corner mask and the marks
 *                                       exactly over it
 *   - on a search results page, which links are on screen and where
 *                                    -> each one is checked and gets its mark
 *
 * What this can and cannot do:
 *   - It reads addresses: of the page, and of the links on a results page. It
 *     never reads page text, form fields or anything typed.
 *   - It only works on the window in front. A browser that is minimised, behind
 *     another program, or left alone for two minutes is not "in use": nothing is
 *     read, nothing is checked, and no live time is spent.
 *   - Private windows (InPrivate, Incognito, Private Browsing) are protected the
 *     same way, and nothing about them is kept: no history, no log line, no
 *     entry in the app's live feed.
 *   - Windows only for now. Other platforms report "not available".
 *
 * The reader is a small PowerShell loop, started hidden and handed the script
 * inline, so nothing is written to disk. It prints one JSON line when something
 * changes; this module does the rest.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RECHECK_MS = 10 * 60 * 1000;     // same host warned again after this long
const SETTLE_MS = 350;                 // a page must stay in front this long before it is checked (long enough to skip pages flicked past)
const VERDICT_TTL_MS = 10 * 60 * 1000; // a link's verdict is reused this long (scrolling re-reads the same links)
const MAX_LINKS = 40;

// Foreground window -> owning process -> the page's document element -> its URL, its rectangle, its links.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
# Compiling this takes a second or more of CPU on every start. Compile it once into the app's data folder and load it from there afterwards.
$dll = '__HELPER_DLL__'
$src = @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class SW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public static uint IdleMs() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Restore if minimised, maximise, and bring to the front. Windows only lets the program in front hand over the
  // foreground, so Alt is tapped first (the documented way to be allowed).
  public static void Raise(IntPtr h) { ShowWindow(h, 3); keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); }
}
"@
$loaded = $false
if ($dll -and (Test-Path $dll)) { try { Add-Type -Path $dll; $loaded = $true } catch { $loaded = $false } }
if (-not $loaded) {
  if ($dll) { try { Add-Type -TypeDefinition $src -OutputAssembly $dll; Add-Type -Path $dll; $loaded = $true } catch { $loaded = $false } }
  if (-not $loaded) { Add-Type -TypeDefinition $src }
}
Write-Output '{"ready":true}'
$A = [System.Windows.Automation.AutomationElement]
$VP = [System.Windows.Automation.ValuePattern]
$docCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$linkCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Hyperlink)
# Message rows in a webmail inbox: Gmail lists them as table rows (DataItem), Outlook on the web as list items.
$rowCond = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::DataItem)),
  (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
$rowCache = New-Object System.Windows.Automation.CacheRequest
$rowCache.Add($A::BoundingRectangleProperty); $rowCache.Add($A::IsOffscreenProperty); $rowCache.Add($A::NameProperty)
$rowCache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
$mail = '^https://(mail\.google\.com/mail/|outlook\.live\.com/mail/|outlook\.office(365)?\.com/mail/)'
$cache = New-Object System.Windows.Automation.CacheRequest
$cache.Add($A::BoundingRectangleProperty); $cache.Add($A::IsOffscreenProperty); $cache.Add($VP::ValueProperty)
$cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::Full
$docCache = New-Object System.Windows.Automation.CacheRequest
$docCache.Add($A::BoundingRectangleProperty); $docCache.Add($A::IsOffscreenProperty)
# The anchor: one result link whose position is followed between full reads, so marks move WITH the page.
$anchor = $null; $anchorX = 0; $anchorY = 0; $lastDx = 0; $lastDy = 0; $moved = $false
$browsers = @('chrome', 'msedge', 'brave', 'opera', 'vivaldi', 'duckduckgo', 'firefox', 'librewolf')
$private = '\b(InPrivate|Incognito|Private Browsing|Private Window|Privates Fenster|Navigation priv|Navegaci.n privada|Inc.gnito)\b|\(Private\)'
$search = '^https?://([a-z0-9-]+\.)*(google\.[a-z.]{2,6}/search|bing\.com/search|duckduckgo\.com/(\?|html)|search\.brave\.com/search|search\.yahoo\.com/search|ecosia\.org/search|startpage\.com/(do|sp)/|yandex\.[a-z.]{2,6}/search|mojeek\.com/search)'
$last = ''; $lastFront = ''; $lastWin = ''; $lastLinks = ''; $wasIdle = $false; $noDoc = ''; $pause = 450
$stdin = [Console]::In
$pendingLine = $stdin.ReadLineAsync()
function Off($why) { $script:anchor = $null; if ($script:lastWin -ne '') { $script:lastWin = ''; $script:last = ''; $script:lastLinks = ''; Write-Output ('{"win":null,"why":"' + $why + '"}') } }
while ($true) {
  # Between full looks: follow the anchor about 60 times a second and report how far the page has moved, so the
  # marks move while the page scrolls instead of jumping after it. Wake at once for a command.
  $gotCmd = $false
  $until = [Environment]::TickCount + $pause
  $moved = $false
  while ([Environment]::TickCount -lt $until) {
    if ($pendingLine.Wait(15)) { $gotCmd = $true; break }
    if ($anchor) {
      try {
        $ar = $anchor.Current.BoundingRectangle
        if (-not [double]::IsInfinity($ar.Y)) {
          $dx = [int]$ar.X - $anchorX; $dy = [int]$ar.Y - $anchorY
          if ($dx -ne $lastDx -or $dy -ne $lastDy) { $lastDx = $dx; $lastDy = $dy; $moved = $true; Write-Output ('{"shift":{"dx":' + $dx + ',"dy":' + $dy + '}}') }
        }
      } catch { $anchor = $null }
    }
  }
  # After movement, look again soon: the full read puts every mark exactly where its link now is.
  if ($moved) { $pause = 120 }
  if ($gotCmd) {
    $cmd = $pendingLine.Result
    if ($null -eq $cmd) { exit }   # the app closed the pipe: it is gone
    $pendingLine = $stdin.ReadLineAsync()
    if ($cmd -match '^raise ([a-z]{2,20})$') {
      $rp = Get-Process -Name $Matches[1] | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
      if ($rp) { [SW]::Raise($rp.MainWindowHandle); Write-Output ('{"raised":"' + $Matches[1] + '"}') } else { Write-Output ('{"noWindow":"' + $Matches[1] + '"}') }
    }
    continue
  }
  $pause = 300
  $h = [SW]::GetForegroundWindow()
  # Development builds only (see start()): look at a named browser wherever it is, so the whole chain can be
  # exercised against a window nobody is looking at. In a released build this name is always empty.
  $testName = '__TEST_PROCESS__'
  if ($testName) { $tp = Get-Process -Name $testName | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; if ($tp) { $h = $tp.MainWindowHandle } }
  if ($h -eq [IntPtr]::Zero) { continue }
  $fp = 0
  [void][SW]::GetWindowThreadProcessId($h, [ref]$fp)
  $p = Get-Process -Id $fp
  $fname = $p.ProcessName
  if ($fname -and $fname -ne $lastFront) { $lastFront = $fname; Write-Output (@{ front = $fname; isBrowser = ($browsers -contains $fname) } | ConvertTo-Json -Compress) }
  # Behind another program, minimised, or nobody at the keyboard: the browser is not "in use".
  if (-not $p -or ($browsers -notcontains $fname)) { Off 'not in front'; continue }
  if ([SW]::IsIconic($h)) { Off 'minimised'; continue }
  if (-not $testName -and [SW]::IdleMs() -gt 120000) { if (-not $wasIdle) { $wasIdle = $true; Write-Output '{"idle":true}' }; Off 'idle'; continue }
  if ($wasIdle) { $wasIdle = $false; Write-Output '{"awake":true}' }

  $url = $null; $r = $null; $doc = $null
  try {
    $root = $A::FromHandle($h)
    # A browser keeps a page for every tab. The one in front is the document that is on screen, with the largest
    # area: the first one found is often a background tab, which kept Sentinel on the first tab.
    $best = $null; $bestArea = 0
    $dscope = $docCache.Activate()
    try { $docs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond) } finally { $dscope.Dispose() }
    foreach ($d in $docs) {
      if ($d.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
      $dr = $d.GetCachedPropertyValue($A::BoundingRectangleProperty)
      if ([double]::IsInfinity($dr.Width) -or $dr.Width -lt 1) { continue }
      $area = $dr.Width * $dr.Height
      if ($area -gt $bestArea) { $bestArea = $area; $best = $d }
    }
    $doc = $best
    if ($doc) { $url = $doc.GetCurrentPattern($VP::Pattern).Current.Value; $r = $doc.Current.BoundingRectangle }
  } catch { $url = $null }
  if (-not $url -or -not $r -or [double]::IsInfinity($r.Width) -or $r.Width -lt 200) {
    if ($noDoc -ne $fname) { $noDoc = $fname; Write-Output (@{ browser = $fname; nodoc = $true } | ConvertTo-Json -Compress) }
    Off 'no page'; continue
  }
  $noDoc = ''
  $isPrivate = [SW]::Title($h) -match $private

  $winKey = "$h|$([int]$r.X)|$([int]$r.Y)|$([int]$r.Width)|$([int]$r.Height)|$isPrivate"
  if ($winKey -ne $lastWin) {
    $lastWin = $winKey
    Write-Output (@{ win = @{ browser = $fname; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; private = [bool]$isPrivate } } | ConvertTo-Json -Compress)
  }

  $key = $fname + '|' + $url
  if ($key -ne $last) {
    $last = $key; $lastLinks = ''
    Write-Output (@{ browser = $fname; url = $url; private = [bool]$isPrivate; search = [bool]($url -match $search) } | ConvertTo-Json -Compress)
  }

  # On a results page: every link on screen, with where it is. Addresses and rectangles only.
  if ($url -match $search) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $found = $null
    $scope = $cache.Activate()
    try { $found = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $linkCond) } catch { $found = $null } finally { $scope.Dispose() }
    $list = New-Object System.Collections.ArrayList
    $firstEl = $null
    if ($found) {
      foreach ($l in $found) {
        if ($list.Count -ge 60) { break }
        $u = $l.GetCachedPropertyValue($VP::ValueProperty)
        if (-not ($u -is [string]) -or $u -notmatch '^https?://') { continue }
        if ($l.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
        $b = $l.GetCachedPropertyValue($A::BoundingRectangleProperty)
        if ([double]::IsInfinity($b.Width) -or $b.Width -lt 40 -or $b.Height -lt 10) { continue }
        if ($b.Bottom -lt $r.Top -or $b.Top -gt $r.Bottom) { continue }
        if (-not $firstEl) { $firstEl = $l; $fx = [int]$b.X; $fy = [int]$b.Y }
        [void]$list.Add(@{ u = $u; x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height })
      }
    }
    $sw.Stop()
    $sig = ($list | ForEach-Object { "$($_.u)|$($_.x)|$($_.y)" }) -join ';'
    if ($sig -ne $lastLinks) {
      $lastLinks = $sig
      Write-Output (@{ links = @($list); for = $url; ms = [int]$sw.ElapsedMilliseconds } | ConvertTo-Json -Compress -Depth 4)
      # New positions: the anchor starts again from here, and the marks from zero movement.
      $anchor = $firstEl; $anchorX = $fx; $anchorY = $fy; $lastDx = 0; $lastDy = 0
    }
    # A heavy page must not make the reader spin: rest at least twice as long as the read took.
    if ($sw.ElapsedMilliseconds * 2 -gt $pause) { $pause = [int][Math]::Min(3000, $sw.ElapsedMilliseconds * 2) }
    # A light page is read more often, so marks arrive sooner and keep up with scrolling.
    elseif ($sw.ElapsedMilliseconds -lt 70) { $pause = 180 }
  }

  # In a webmail inbox: the message rows on screen, as the inbox shows them (sender, subject, preview) and where
  # they are. The words are what the inbox already displays; nothing is opened, clicked or marked as read.
  if ($url -match $mail) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $rows = $null
    $scope = $rowCache.Activate()
    try { $rows = $doc.FindAll([System.Windows.Automation.TreeScope]::Descendants, $rowCond) } catch { $rows = $null } finally { $scope.Dispose() }
    $list = New-Object System.Collections.ArrayList
    $firstEl = $null
    if ($rows) {
      foreach ($row in $rows) {
        if ($list.Count -ge 40) { break }
        if ($row.GetCachedPropertyValue($A::IsOffscreenProperty)) { continue }
        $t = [string]$row.GetCachedPropertyValue($A::NameProperty)
        if ($t.Length -lt 20) { continue }
        $b = $row.GetCachedPropertyValue($A::BoundingRectangleProperty)
        if ([double]::IsInfinity($b.Width) -or $b.Width -lt 300 -or $b.Height -lt 16 -or $b.Height -gt 220) { continue }
        if ($b.Bottom -lt $r.Top -or $b.Top -gt $r.Bottom) { continue }
        if (-not $firstEl) { $firstEl = $row; $fx = [int]$b.X; $fy = [int]$b.Y }
        [void]$list.Add(@{ t = $t.Substring(0, [Math]::Min(600, $t.Length)); x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height })
      }
    }
    $sw.Stop()
    $sig = ($list | ForEach-Object { "$($_.t.Length)|$($_.x)|$($_.y)" }) -join ';'
    if ($sig -ne $lastLinks) {
      $lastLinks = $sig
      Write-Output (@{ mail = @($list); for = $url; ms = [int]$sw.ElapsedMilliseconds } | ConvertTo-Json -Compress -Depth 4)
      $anchor = $firstEl; $anchorX = $fx; $anchorY = $fy; $lastDx = 0; $lastDy = 0
    }
    if ($sw.ElapsedMilliseconds * 2 -gt $pause) { $pause = [int][Math]::Min(3000, $sw.ElapsedMilliseconds * 2) }
  }
}
`;

let child = null;
let opts = null;
let state = { active: false, reason: 'Starting', supported: process.platform === 'win32', current: null, window: null, counts: { checked: 0, flagged: 0 } };
const warned = new Map();
const verdicts = new Map();   // url -> { at, fast, mark }
let settleTimer = null;
let restartTimer = null;
let latestLinks = null;       // the last list of on-screen links, so late verdicts land where the links are now
let pending = new Set();
let linkEpoch = 0;          // one per full read of the links; page movement is reported relative to it

let readerReady = false;
const queued = [];
const raiseWaiters = [];
function send(line) {
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  if (!readerReady) { queued.push(line); return true; }
  try { child.stdin.write(`${line}\n`); return true; } catch { return false; }
}

/**
 * Bring a browser's window to the front, maximised, using the reader that is already running: no second
 * PowerShell to start, so it happens at once. Resolves true when a window was raised, false when that browser has
 * no window (the caller then opens it), null when there is no reader to ask.
 */
function raise(processName) {
  if (!child || !/^[a-z]{2,20}$/.test(processName)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { const i = raiseWaiters.indexOf(done); if (i >= 0) raiseWaiters.splice(i, 1); resolve(null); }, 6000);
    const done = (ok) => { clearTimeout(timer); resolve(ok); };
    raiseWaiters.push(done);
    if (!send(`raise ${processName}`)) { raiseWaiters.pop(); clearTimeout(timer); resolve(null); }
  });
}

function status() { return { ...state, mode: currentMode() }; }
function currentMode() { return opts && opts.mode && opts.mode() === 'delicate' ? 'delicate' : 'fast'; }
function log(text) { if (opts && opts.onLog) opts.onLog(text); }

function setState(active, reason) {
  // Why live scanning is off belongs in the log: "nothing was checked" must always have a reason on file.
  if (!active && reason && reason !== state.reason) log(`not watching: ${reason}`);
  state = { ...state, active, reason };
  if (opts && opts.onChange) opts.onChange(status());
}

function init(options) {
  opts = options;
  restart();
}

let generation = 0;
async function restart() {
  stop(null, true);
  // Two restarts can overlap (the tray and the app, or two clicks). Only the newest may start a reader,
  // or the older reader would be orphaned: never stopped, and still feeding this module.
  const mine = ++generation;
  if (!state.supported) return setState(false, 'Live scanning is available on Windows');
  if (!opts.enabled()) return setState(false, 'Live scanning is off');
  if (!opts.getToken()) return setState(false, 'Sign in to start live scanning');
  try {
    const me = await opts.api('/api/v1/auth/me');
    if (mine !== generation) return;
    if (!me.plan.features.liveScanning && !me.plan.features.liveFast) return setState(false, 'Live scanning is not part of this plan');
  } catch (err) {
    if (mine !== generation) return;
    if (err.status === 401) return setState(false, 'Sign in to start live scanning');
    // "Will retry" has to be true: a scanner that is still starting answers a minute later.
    restartTimer = setTimeout(() => restart(), 30000);
    return setState(false, 'Sentinel is offline - will retry');
  }
  if (mine !== generation) return;
  start();
}

/**
 * The reader is too long for a command line (Windows allows 32,767 characters, and -EncodedCommand more than
 * doubles its size), so it is written to a file and a short loader runs it. The loader carries the file's SHA-256
 * and refuses to run a file that changed after it was written.
 */
function readerLaunch(body, dir) {
  const hash = crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex').toUpperCase();
  const file = path.join(dir, `sentinel-reader-${hash.slice(0, 12)}.ps1`);
  const q = (t) => t.replace(/'/g, "''");
  const loader = [
    `$f = '${q(file)}'`,
    '$s = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)',
    '$h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($s))).Replace(\'-\', \'\')',
    `if ($h -ne '${hash}') { [Console]::Error.WriteLine('the reader file changed after it was written'); exit 3 }`,
    'Invoke-Expression $s'
  ].join('\n');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(loader, 'utf16le').toString('base64')];
  return { file, args };
}

function start() {
  const testProcess = opts.testProcess && /^[a-z]{2,20}$/.test(opts.testProcess) ? opts.testProcess : '';
  if (testProcess) log(`TEST MODE: reading ${testProcess} wherever it is, not the window in front`);
  const helper = opts.helperDll ? String(opts.helperDll).replace(/'/g, "''") : '';
  const body = SCRIPT.replace('__TEST_PROCESS__', () => testProcess).replace('__HELPER_DLL__', () => helper);
  try {
    const { file, args } = readerLaunch(body, opts.helperDll ? path.dirname(String(opts.helperDll)) : os.tmpdir());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    // Below normal priority: reading the browser must never compete with the browser.
    try { require('os').setPriority(child.pid, require('os').constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
  } catch (err) {
    log(`could not start the reader: ${err.message}`);
    return setState(false, `Live scanning could not start (${err.message})`);
  }
  log('reader started');
  const mine = child;
  let errText = '';
  child.on('error', (err) => {
    if (child !== mine) return;
    log(`reader failed: ${err.message}`);
  });
  child.stdin.on('error', () => { /* the reader exited; its exit handler takes it from here */ });
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
    if (child !== mine) return;   // stopped on purpose, or already replaced
    log(`reader exited (${code})${errText ? `: ${errText.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
    child = null;
    setWindow(null);
    if (!state.active) return;
    // Keep watching: the reader is cheap to bring back.
    setState(false, 'Live scanning stopped - restarting');
    restartTimer = setTimeout(() => restart(), 3000);
  });
  setState(true, null);
}

function stop(reason, silent) {
  clearTimeout(settleTimer);
  clearTimeout(restartTimer);
  const old = child;
  child = null;
  readerReady = false;
  queued.length = 0;
  for (const r of raiseWaiters.splice(0)) r(null);
  if (old) { try { old.kill(); } catch { /* gone */ } }
  state.current = null;
  latestLinks = null;
  setWindow(null);
  generation++;
  if (!silent) setState(false, reason || 'Live scanning is off');
}

function setWindow(win) {
  // One line when a browser starts or stops being watched (never for a private window), so the log can answer "is it working?".
  const was = state.window;
  if (win && !win.private && (!was || was.browser !== win.browser)) log(`watching ${win.browser}: page area ${win.w}x${win.h} at ${win.x},${win.y}`);
  if (!win && was && !was.private) log('no browser in front: resting');
  state.window = win;
  if (opts && opts.onWindow) opts.onWindow(win);
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.ready) { readerReady = true; for (const line of queued.splice(0)) send(line); return; }
  if (msg.raised || msg.noWindow) { const r = raiseWaiters.shift(); if (r) r(Boolean(msg.raised)); return; }
  if (msg.front) { if (msg.isBrowser) log(`${msg.front} is in front`); return; }
  if (msg.nodoc) { log(`${msg.browser} is in front, but Windows gave no page address (a start page, a dialog over the page, or the browser's accessibility is off)`); return; }
  if (msg.idle) { log('nobody at the keyboard: paused'); return; }
  if (msg.awake) { log('in use again'); return; }
  if ('win' in msg) {
    if (!msg.win) { clearTimeout(settleTimer); state.current = null; latestLinks = null; }
    setWindow(msg.win || null);
    return;
  }
  if (msg.shift) { if (opts.onShift && latestLinks) opts.onShift({ epoch: latestLinks.epoch, dx: msg.shift.dx, dy: msg.shift.dy }); return; }
  if (msg.links) return onLinks(msg);
  if (msg.mail) return onMail(msg);
  if (!msg.url) return;

  clearTimeout(settleTimer);
  latestLinks = null;
  if (!/^https?:\/\//i.test(msg.url)) { state.current = null; if (opts.onPage) opts.onPage(null); return; }
  // Sentinel's own pages and the app's server are not "sites".
  if (opts.origin && msg.url.startsWith(opts.origin)) { state.current = null; if (opts.onPage) opts.onPage(null); return; }
  const page = { browser: msg.browser, url: msg.url, private: Boolean(msg.private), search: Boolean(msg.search), at: Date.now() };
  // What a private window shows is never kept, not even in memory the app's window can read.
  state.current = page.private ? { browser: page.browser, url: null, private: true, at: page.at } : page;
  if (opts.onPage) opts.onPage(page);
  settleTimer = setTimeout(() => check(page).catch(() => {}), SETTLE_MS);
}

async function check(page) {
  let host;
  try { host = new URL(page.url).hostname; } catch { return; }
  // A results page is the search engine's own; its links are what matter, and they are checked one by one.
  if (page.search) { if (opts.onVerdict) opts.onVerdict({ page, badge: null, label: 'Search results' }); return; }

  let verdict;
  try {
    let answer;
    ({ verdict, ...answer } = await opts.api('/api/v1/live/visit', { url: page.url, private: page.private, mode: currentMode() }));
    noteMode(answer);
  } catch (err) {
    log(`check failed${page.private ? '' : ` for ${host}`}: ${err.status || ''} ${err.code || err.message}`);
    // Refused, not a hiccup: stop reading the browser altogether. A reader left running would keep asking, and the
    // gold mask would keep saying "scanning" while nothing is checked.
    if (err.status === 401) stop('Sign in to start live scanning');
    else if (err.status === 403) stop('Live scanning is not part of this plan');
    else if (err.code === 'live_hours_exhausted') stop('Live hours for this week are used up');
    return;
  }
  const badge = (verdict && verdict.overall && verdict.overall.badge) || null;
  const label = verdict && verdict.overall ? verdict.overall.label : 'Checked';
  const stillThere = Boolean(state.current) && state.current.at === page.at;
  if (opts.onVerdict && stillThere) opts.onVerdict({ page, badge, label, kind: worstKind(verdict) });
  count(page.private, badge);
  if (opts.onChecked && !page.private) opts.onChecked({ browser: page.browser, url: page.url, host, badge, label, at: Date.now() });
  if (badge !== 'red' && badge !== 'orange') return;
  const last = warned.get(host);
  if (last && Date.now() - last < RECHECK_MS) return;
  warned.set(host, Date.now());
  if (warned.size > 500) warned.clear();
  opts.onThreat({ browser: page.browser, url: page.url, host, verdict, private: page.private });
}

/** What the server actually used. Delicate that is used up (or not in the plan) carries on as fast, and the person is told once. */
function noteMode(answer) {
  const used = answer && answer.mode;
  const fellBack = (answer && answer.fellBack) || null;
  if (!used || (state.usedMode === used && state.fellBack === fellBack)) return;
  state = { ...state, usedMode: used, fellBack, live: answer.live || state.live };
  if (fellBack) log(`delicate scanning is not available (${fellBack}); carrying on in fast mode`);
  if (opts.onChange) opts.onChange(status());
}

/** A running total for the app's Live panel. Numbers only, and a private window adds nothing to them. */
let countTimer = null;
function count(isPrivate, badge) {
  if (isPrivate) return;
  state.counts = { checked: state.counts.checked + 1, flagged: state.counts.flagged + (badge ? 1 : 0) };
  if (countTimer) return;
  countTimer = setTimeout(() => { countTimer = null; if (opts && opts.onChange) opts.onChange(status()); }, 1500);
}

/** Which mask a verdict wears: the threat with the worst badge. */
function worstKind(verdict) {
  const rank = { red: 3, orange: 2, yellow: 1 };
  let best = 'scam';
  let top = 0;
  for (const [kind, t] of Object.entries((verdict && verdict.threats) || {})) {
    const r = rank[t && t.badge] || 0;
    if (r > top) { top = r; best = kind; }
  }
  return best;
}

const ENGINE_HOSTS = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube\.com|bing\.com|microsoft\.com|msn\.com|live\.com|duckduckgo\.com|brave\.com|yahoo\.com|ecosia\.org|startpage\.com|yandex\.[a-z.]+|mojeek\.com)$/i;

/** One entry per result: the first on-screen link to each outside address. */
function resultLinks(links, pageUrl) {
  let pageHost = '';
  try { pageHost = new URL(pageUrl).hostname; } catch { /* keep all */ }
  const seen = new Set();
  const out = [];
  for (const l of links) {
    let u;
    try { u = new URL(l.u); } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (u.hostname === pageHost || ENGINE_HOSTS.test(u.hostname)) continue;
    const key = `${u.hostname}${u.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...l, u: u.href });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function markFor(url) {
  const hit = verdicts.get(url);
  if (!hit || Date.now() - hit.at >= VERDICT_TTL_MS) return null;
  // Delicate that fell back to fast (used up, or not in the plan) takes fast answers; otherwise they are asked again.
  if (hit.fast && currentMode() === 'delicate' && !state.fellBack) return null;
  return hit.mark;
}

function publishMarks() {
  if (!latestLinks || !opts.onMarks) return;
  opts.onMarks({
    for: latestLinks.for,
    epoch: latestLinks.epoch,
    checking: latestLinks.links.filter((l) => !markFor(l.u)).length,
    marks: latestLinks.links.map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, row: l.u.startsWith('mail:'), ...(markFor(l.u) || { pending: true }) }))
  });
}

async function onLinks(msg) {
  const page = state.window ? { private: Boolean(state.window.private) } : { private: false };
  const links = resultLinks(Array.isArray(msg.links) ? msg.links : [], msg.for);
  const fresh = !latestLinks || latestLinks.for !== msg.for;
  latestLinks = { for: msg.for, links, epoch: ++linkEpoch };
  if (fresh && !page.private) {
    log(`results page: ${links.length} results on screen, read in ${msg.ms} ms`);
    state.lastResults = { count: links.length, ms: msg.ms, at: Date.now() };
  }
  publishMarks();   // positions first: marks already known move at once

  const missing = links.map((l) => l.u).filter((u) => !markFor(u) && !pending.has(u));
  if (!missing.length) return;
  missing.forEach((u) => pending.add(u));
  const store = (byUrl, final, fast) => {
    for (const u of missing) {
      const v = byUrl && byUrl[u];
      if (!v) continue;
      const badge = (v.overall && v.overall.badge) || null;
      const first = v.reasons && v.reasons[0];
      verdicts.set(u, { at: Date.now(), fast, mark: { badge, kind: worstKind(v), label: v.overall ? v.overall.label : 'Checked', reason: first ? first.text : '' } });
      if (final) count(page.private, badge);
    }
  };
  try {
    const started = Date.now();
    const mode = currentMode();
    // Delicate is shown in two steps: the quick answer (lists and checklist, a few ms) goes on screen at once, and
    // the researched answer replaces it when it lands. Nobody waits five seconds for a mark.
    if (mode === 'delicate' && !page.private) {
      const quick = await opts.api('/api/v1/live/batch', { urls: missing, private: false, mode, quick: true });
      store(quick.byUrl, false, false);   // shown until the researched answer replaces it
      publishMarks();
      log(`results marked: ${missing.length} in ${Date.now() - started} ms (quick pass)`);
    }
    const { byUrl, ...answer } = await opts.api('/api/v1/live/batch', { urls: missing, private: page.private, mode });
    noteMode(answer);
    if (!page.private) log(`results checked: ${missing.length} in ${Date.now() - started} ms (${answer.mode || 'fast'})`);
    store(byUrl, true, (answer.mode || mode) !== 'delicate');
    if (verdicts.size > 2000) { for (const k of [...verdicts.keys()].slice(0, 1000)) verdicts.delete(k); }
  } catch (err) {
    log(`results check failed: ${err.status || ''} ${err.code || err.message}`);
    if (err.code === 'live_hours_exhausted') stop('Live hours for this week are used up');
  } finally {
    missing.forEach((u) => pending.delete(u));
  }
  publishMarks();
}

/**
 * One inbox row as the inbox shows it: "unread, PayPal, Your account is limited, 3:45 PM, Dear customer...".
 * The first short part is usually the sender, the next the subject; everything goes in the body as well, so the
 * checks that read wording see all of it.
 */
function mailFromRow(text) {
  const parts = String(text).split(/,\s+/).map((p) => p.trim()).filter((p) => p && !/^(unread|read|starred|important|has attachment|flagged|pinned)$/i.test(p));
  const from = (parts[0] || '').slice(0, 120);
  const subject = (parts[1] || '').slice(0, 300);
  return { from, fromName: from, subject, body: parts.slice(2).join(' ').slice(0, 1500) };
}

const rowKey = (text) => `mail:${require('crypto').createHash('sha1').update(String(text)).digest('hex').slice(0, 20)}`;

async function onMail(msg) {
  const isPrivate = Boolean(state.window && state.window.private);
  const rows = (Array.isArray(msg.mail) ? msg.mail : []).map((r) => ({ u: rowKey(r.t), x: r.x, y: r.y, w: r.w, h: r.h, text: r.t }));
  const fresh = !latestLinks || latestLinks.for !== msg.for;
  latestLinks = { for: msg.for, links: rows, epoch: ++linkEpoch };
  if (fresh && !isPrivate) log(`inbox: ${rows.length} messages on screen, read in ${msg.ms} ms`);
  publishMarks();
  const missing = rows.filter((r) => !markFor(r.u) && !pending.has(r.u));
  if (!missing.length) return;
  missing.forEach((r) => pending.add(r.u));
  try {
    const { results } = await opts.api('/api/v1/live/email', { emails: missing.map((r) => ({ key: r.u, ...mailFromRow(r.text) })) });
    for (const item of results || []) {
      const v = item.verdict;
      if (!v || !item.key) continue;
      const badge = (v.overall && v.overall.badge) || null;
      const first = v.reasons && v.reasons[0];
      verdicts.set(item.key, { at: Date.now(), mark: { badge, kind: worstKind(v), label: v.overall ? v.overall.label : 'Checked', reason: first ? first.text : '' } });
      count(isPrivate, badge);
    }
  } catch (err) {
    // Email checks are part of Pro and up: on another plan the inbox is simply left unmarked.
    if (err.status !== 403) log(`inbox check failed: ${err.status || ''} ${err.code || err.message}`);
  } finally {
    missing.forEach((r) => pending.delete(r.u));
  }
  publishMarks();
}

module.exports = { init, restart, stop, status, raise, _test: { resultLinks, worstKind, mailFromRow, readerLaunch, SCRIPT } };
