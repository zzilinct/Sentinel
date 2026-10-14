# Helpers shared by the desktop runs on a GitHub-hosted Windows desktop (scripts/desktop-e2e.ps1, desktop-qa.ps1, desktop-core-qa.ps1),
# dot-sourced after $Out is set. Never run on a person's computer.
# To the host, not the pipeline: functions below return values, and a line said inside one must not join them.
# Windows, their sizes and the display's scaling, read and set the way the Settings app does. Measured in real pixels
# (per-monitor aware), so screenshots and window sizes stay true at 125% and 150%.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class Qa {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public struct RECT { public int L, T, R, B; }
  // Visible top-level windows of these processes, one per line: "front|title|left,top,width,height".
  public static string Windows(int[] pids) {
    var set = new HashSet<int>(pids); var lines = new List<string>(); IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      int pid; GetWindowThreadProcessId(h, out pid);
      if (set.Contains(pid) && IsWindowVisible(h)) {
        var sb = new StringBuilder(256); GetWindowText(h, sb, 256); RECT r; GetWindowRect(h, out r);
        if (r.R - r.L > 40 && r.B - r.T > 40) lines.Add((h == fg ? "front" : "back") + "|" + sb + "|" + r.L + "," + r.T + "," + (r.R - r.L) + "," + (r.B - r.T));
      }
      return true;
    }, IntPtr.Zero);
    return string.Join("\n", lines);
  }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint paths, byte[] pathArr, ref uint modes, byte[] modeArr, IntPtr topo);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(byte[] packet);
  [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(byte[] packet);
  static readonly int[] Steps = { 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500 };
  static byte[] Packet(int type, int size) {
    uint p, m; GetDisplayConfigBufferSizes(2, out p, out m);
    var pa = new byte[p * 72]; var ma = new byte[m * 64];
    int r = QueryDisplayConfig(2, ref p, pa, ref m, ma, IntPtr.Zero);
    if (r != 0) throw new Exception("QueryDisplayConfig " + r);
    var k = new byte[size]; BitConverter.GetBytes(type).CopyTo(k, 0); BitConverter.GetBytes(size).CopyTo(k, 4); Array.Copy(pa, 0, k, 8, 12);
    return k;
  }
  // The primary display's scaling in percent: "current|recommended|largest allowed".
  public static string Scale() {
    var k = Packet(-3, 32); int r = DisplayConfigGetDeviceInfo(k); if (r != 0) return "unreadable " + r;
    int min = BitConverter.ToInt32(k, 20), cur = BitConverter.ToInt32(k, 24), max = BitConverter.ToInt32(k, 28), rec = Math.Abs(min);
    return Steps[rec + cur] + "|" + Steps[rec] + "|" + Steps[Math.Min(Steps.Length - 1, rec + max)];
  }
  public static int SetScale(int percent) {
    var g = Packet(-3, 32); int r = DisplayConfigGetDeviceInfo(g); if (r != 0) return r;
    int rec = Math.Abs(BitConverter.ToInt32(g, 20));
    var k = Packet(-4, 24); BitConverter.GetBytes(Array.IndexOf(Steps, percent) - rec).CopyTo(k, 20);
    return DisplayConfigSetDeviceInfo(k);
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettings(ref DEVMODE dm, int flags);
  public static string Modes() {
    var seen = new List<string>(); var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    for (int i = 0; EnumDisplaySettings(null, i, ref dm); i++) { var s = dm.dmPelsWidth + "x" + dm.dmPelsHeight; if (!seen.Contains(s)) seen.Add(s); }
    return string.Join(",", seen);
  }
  public static int Resolution(int w, int h) {
    var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); EnumDisplaySettings(null, -1, ref dm);
    dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmFields = 0x80000 | 0x100000;
    return ChangeDisplaySettings(ref dm, 0);
  }
}
"@
$aware = [Qa]::SetProcessDpiAwarenessContext([IntPtr](-4))
function Say($s) { $l = "$(Get-Date -Format HH:mm:ss) $s"; Add-Content "$Out\run.txt" $l; Write-Host $l }
$failed = 0
function Check($name, $ok, $detail) {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) ${name}: $detail"
  if (-not $ok) { $script:failed++ }
  Say $line; Add-Content "$Out\results.txt" $line
}
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);
  public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
$shot = 0
# The whole screen as it is now: Windows Forms keeps the size it saw first, and the screen changes size below.
function Shot($name) {
  $w = [Qa]::GetSystemMetrics(0); $h = [Qa]::GetSystemMetrics(1)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $script:shot++
  $script:lastShot = "{0}\{1:D2}-{2}.png" -f $Out, $script:shot, $name
  $bmp.Save($script:lastShot, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
# Ask one of Sentinel's windows (by part of its address) to evaluate an expression. Single quotes only inside it.
function Cdp($part, $expr) { $j = node (Join-Path $PSScriptRoot 'e2e-cdp.js') $(if ($part -eq 'main') { 9334 } else { 9333 }) $part $expr; Say "  cdp $part -> $(([string]$j).Substring(0, [Math]::Min(400, ([string]$j).Length)))"; return ($j | ConvertFrom-Json) }
# Press a button in the shield's window by its words.
# The click waits for the answer to be sent: a button that closes the window (Yes, I did) would take the reply with it.
function Press($label) { return (Cdp 'guard.html' "(() => { const b = [...document.querySelectorAll('#row button')].find((x) => x.textContent === '$label'); if (b) setTimeout(() => b.click(), 50); return Boolean(b); })()").value }
# Motion, photographed mid-animation. The runner's Windows asks for reduced motion, so the window is asked for full
# motion while connected (E2E_MOTION_HOLD_MS, scripts/e2e-cdp.js). $setup starts what is to be seen (single quotes
# only); then every animation in the window is paused $ms in, and the screen is photographed while it holds there.
# Returns how many animations were paused: 0 means there was no motion to see.
function Frame($part, $setup, $ms, $name, [switch]$Layer) {
  # -Layer: a window left out of screen copies (the chat overlay) is photographed on its own and laid over the screen.
  $expr = "(async () => { $setup; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const a = document.getAnimations(); a.forEach((x) => { x.pause(); x.currentTime = $ms; }); return a.length + '|' + window.screenX + '|' + window.screenY; })()"
  $layerPng = $(if ($Layer) { Join-Path $env:RUNNER_TEMP 'layer.png' } else { '' })
  if ($layerPng) { Remove-Item $layerPng -ErrorAction SilentlyContinue }
  $job = Start-Job -ScriptBlock { param($js, $part, $expr, $shot) $env:E2E_MOTION_HOLD_MS = '4000'; $env:E2E_SHOT = $shot; node $js 9333 $part $expr } -ArgumentList (Join-Path $PSScriptRoot 'e2e-cdp.js'), $part, $expr, $layerPng
  $first = $null
  for ($i = 0; $i -lt 150 -and -not $first -and $job.State -in 'NotStarted', 'Running'; $i++) { Start-Sleep -Milliseconds 100; $first = @(Receive-Job $job -Keep) | Select-Object -First 1 }
  Start-Sleep -Milliseconds 250
  Shot $name
  [void](Wait-Job $job -Timeout 20); if (-not $first) { $first = @(Receive-Job $job) | Select-Object -First 1 }; Remove-Job $job -Force
  Say "  frame $name ($part at $ms ms): $first"
  $v = ''; try { $v = [string](([string]$first | ConvertFrom-Json).value) } catch {}
  $f = $v -split '\|'
  if ($layerPng -and (Test-Path $layerPng)) {
    # Where the window is, from the main process (the page's own screenX is 0 in a frameless tool window).
    $at = ([string](Cdp 'main' "(() => { const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('$part')); const b = w.getBounds(); return b.x + '|' + b.y; })()").value) -split '\|'
    if ($at.Count -eq 2) { $f = @($f[0], $at[0], $at[1]) }
  }
  if ($layerPng -and (Test-Path $layerPng) -and $f.Count -eq 3) {
    $screen = [System.Drawing.Image]::FromFile($script:lastShot); $bmp = New-Object System.Drawing.Bitmap $screen; $screen.Dispose()
    $over = [System.Drawing.Image]::FromFile($layerPng); $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($over, [int]$f[1], [int]$f[2], $over.Width, $over.Height); $g.Dispose(); $over.Dispose()
    $bmp.Save($script:lastShot, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  }
  # Let go: everything paused plays to its end, so nothing is left frozen half open.
  [void](Cdp $part "document.getAnimations().forEach((x) => { try { x.finish(); } catch (e) {} }), 1")
  try { return [int]$f[0] } catch { return 0 }
}
function Info($expr) { return (Cdp '127.0.0.1:4782' "window.sentinelDesktop.$expr").value }
function Until($seconds, [scriptblock]$test) { $end = (Get-Date).AddSeconds($seconds); while ((Get-Date) -lt $end) { if (& $test) { return $true }; Start-Sleep 2 }; return [bool](& $test) }
$data = "$env:APPDATA\Sentinel"
function AppLog { return (Get-Content "$data\logs\app.log" -Raw -ErrorAction SilentlyContinue) + '' }
# A window of this process to the front, maximised (Windows lets the program in front hand it over after an Alt tap).
function Front($proc) {
  $script:p = $null
  [void](Until 40 { $script:p = Get-Process $proc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; [bool]$script:p })
  if (-not $script:p) { Say "no window for $proc"; return $false }
  [K]::Tap(0x12); [K]::ShowWindow($script:p.MainWindowHandle, 3) | Out-Null; [K]::SetForegroundWindow($script:p.MainWindowHandle) | Out-Null
  Start-Sleep 1
  return [K]::GetForegroundWindow() -eq $script:p.MainWindowHandle
}
# Edge on its own, in front. Started while the last Edge is still closing, the new one hands its page to the dying one
# and no window comes (my-sites-real-site, and the screen check reading the last section's shop): so every Edge is gone
# first, and a start that shows no window is tried once more.
function FreshEdge([string[]]$a) {
  for ($try = 1; $try -le 2; $try++) {
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    [void](Until 20 { -not (Get-Process msedge -ErrorAction SilentlyContinue) })
    # A fresh Edge after a forced close offers its first-run page or "Restore pages" over the page unless told not to.
    Start-Process msedge -ArgumentList (@('--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble') + ($a | Where-Object { $_ -notin '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble' }))
    Start-Sleep 8
    if (Front 'msedge') { return $true }
    Say "  Edge did not come to the front (try $try)"
  }
  return $false
}
function WaitUp { $up = $false; for ($i = 0; $i -lt 90 -and -not $up; $i++) { Start-Sleep 2; try { $up = (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {} }; return $up }
# Its scanner may come up on the next port when the last one's is not yet free: the window says where.
function StartSentinel { Start-Process $exe -ArgumentList '--remote-debugging-port=9333', '--inspect=9334'; return (Until 120 { (Cdp '127.0.0.1:4782' '1').value -eq 1 }) }
# Sentinel's own main processes (not its helpers): one, however many times the right-click menu starts it.
function MainProcs { return @(Get-CimInstance Win32_Process -Filter "Name='Sentinel.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' }) }
function SentinelWindows { $ids = @(Get-Process Sentinel -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); if (-not $ids.Count) { return @() }; return @(([Qa]::Windows([int[]]$ids)) -split "`n" | Where-Object { $_ }) }
function Starts { return ([regex]::Matches((AppLog), 'starting Sentinel')).Count }
function StopSentinel { Get-Process Sentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; [void](Until 20 { -not (Get-Process Sentinel -ErrorAction SilentlyContinue) }); Start-Sleep 2 }
# How a window fits its words and the screen: its inside, the words' own height, buttons out of view, and wider than itself.
$fitExpr = "(() => { const r = document.documentElement, b = document.body; const out = [...document.querySelectorAll('button')].filter((x) => x.offsetParent).filter((x) => { const q = x.getBoundingClientRect(); return q.bottom > innerHeight + 1 || q.right > innerWidth + 1 || q.top < 0 || q.left < 0; }).map((x) => x.textContent).join('/'); r.style.height = b.style.height = 'auto'; const h = Math.ceil(b.getBoundingClientRect().height); r.style.height = b.style.height = ''; return [innerWidth, innerHeight, h, out, r.scrollWidth > innerWidth + 1 ? 'wide' : 'ok'].join('|'); })()"
$boundsExpr = "(() => { const e = process.mainModule.require('electron'); const d = e.screen.getPrimaryDisplay(); return JSON.stringify({ scale: d.scaleFactor, work: d.workArea, wins: e.BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => ({ page: w.webContents.getURL().split('?')[0], b: w.getBounds() })) }); })()"
# One window, by part of its address: on screen in full, its buttons in view, and how much empty space it has.
function Fit($part, $name) {
  $f = ([string](Cdp $part $fitExpr).value) -split '\|'
  $j = $null; try { $j = (Cdp 'main' $boundsExpr).value | ConvertFrom-Json } catch {}
  $w = $null; if ($j) { $w = @($j.wins | Where-Object { $_.page -like "*$part*" }) | Select-Object -First 1 }
  $a = $(if ($j) { $j.work } else { $null })
  $on = $w -and $a -and $w.b.x -ge $a.x - 1 -and $w.b.y -ge $a.y - 1 -and ($w.b.x + $w.b.width) -le ($a.x + $a.width + 1) -and ($w.b.y + $w.b.height) -le ($a.y + $a.height + 1)
  $r = @{ ok = ($f.Count -eq 5 -and -not $f[3] -and $f[4] -eq 'ok' -and $on); view = "$($f[0])x$($f[1])"; words = $f[2]; outOfView = $f[3]; wide = $f[4]; onScreen = [bool]$on; gap = $(if ($f.Count -eq 5) { [int]$f[1] - [int]$f[2] } else { 0 }); bounds = $(if ($w) { "$($w.b.x),$($w.b.y) $($w.b.width)x$($w.b.height)" }); work = $(if ($a) { "$($a.x),$($a.y) $($a.width)x$($a.height) at $($j.scale)x" }) }
  Say "  fit ${name}: inside $($r.view), words $($r.words) px tall (empty $($r.gap) px), buttons out of view '$($r.outOfView)', $($r.wide), window $($r.bounds) in work area $($r.work): on screen $($r.onScreen)"
  return $r
}
# Something drawn on screen below the title bar: a stand-in Chrome sometimes shows its window and never paints the page
# (Roblox read nothing from a blank white window), so a blank one is started again.
function Painted {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $colours = @{}
  for ($y = 60; $y -lt $b.Height - 60; $y += 6) { for ($x = 0; $x -lt $b.Width; $x += 6) { $colours[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
  $g.Dispose(); $bmp.Dispose()
  return $colours.Count -gt 1
}
function Fake($name, $page) {
  for ($try = 1; $try -le 2; $try++) {
    $fp = Start-Process "$chromeDir\$name.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\$name-profile", '--start-maximized', "--app=http://127.0.0.1:47910/$page" -PassThru
    Start-Sleep 8
    $r = Front $name
    if ($r -and (Until 15 { Painted })) { return $true }
    if ($r) { Say "  $name's window stayed blank (try $try)"; Shot "blank-$name" } else { FakeDiag $name $fp $page }
    if ($try -lt 2) { Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep 3 }
  }
  return $false
}
# When a stand-in has no window: what there is instead, so the log says why.
function FakeDiag($name, $fp, $page) {
  Say "  diag: started pid $($fp.Id), exited: $($fp.HasExited) $(if ($fp.HasExited) { "code $($fp.ExitCode)" })"
  Get-Process $name -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag: $name $($_.Id) hwnd $($_.MainWindowHandle) title '$($_.MainWindowTitle)' cpu $($_.CPU) start $($_.StartTime.ToString('HH:mm:ss'))" }
  Get-Process chrome, updater, setup, GoogleUpdate*, MsMpEng, TiWorker, TrustedInstaller -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag: other $($_.ProcessName) $($_.Id) cpu $($_.CPU) start $(try { $_.StartTime.ToString('HH:mm:ss') } catch { '?' })" }
  Say "  diag: chrome dir: $((Get-ChildItem $chromeDir | ForEach-Object { "$($_.Name)@$($_.LastWriteTime.ToString('HH:mm:ss'))" }) -join ', ')"
  Say "  diag: chrome.exe $((Get-Item "$chromeDir\chrome.exe").VersionInfo.ProductVersion), $name.exe $((Get-Item "$chromeDir\$name.exe").VersionInfo.ProductVersion)"
  PagesDiag $page
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  Say "  diag: cpu load $cpu%"
  Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 | ForEach-Object { Say "  diag: top $($_.ProcessName) $($_.Id) cpu $([int]$_.CPU)" }
  Shot "diag-$name"
}
