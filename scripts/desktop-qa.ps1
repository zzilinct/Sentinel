# Real-use QA of the Windows app's newest features (round 1.17.4) on a GitHub-hosted Windows desktop, never a person's
# computer: "Scan with Sentinel" from the right-click menu as Explorer runs it (started cold, signed out and signed in,
# awkward file names and awkward files), and the shield's windows (the warning's real-site button, the way out of a
# full-screen page, "Did you type anything?", the pay pause, the remote-control question) at display scaling above 100%.
# Everything that looks dangerous is a harmless stand-in. Results go to $Out\results.txt; exits 1 when a check failed.
param([string]$Installer = '', [string]$Out = 'e2e-desktop-qa')
$ErrorActionPreference = 'Continue'
# Node prints UTF-8: file names with accents and emoji must come back whole.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
# Windows, their sizes and the display's scaling, read and set the way the Settings app does. Measured in real pixels
# (per-monitor aware), so screenshots and window sizes stay true at 125% and 150%.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class Qa {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
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
. (Join-Path $PSScriptRoot 'desktop-e2e-lib.ps1')
Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds); per-monitor aware: $aware; scaling (now|recommended|largest): $([Qa]::Scale()); modes: $([Qa]::Modes())"

# Sentinel's own main processes (not its helpers): one, however many times the right-click menu starts it.
function MainProcs { return @(Get-CimInstance Win32_Process -Filter "Name='Sentinel.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' }) }
function SentinelWindows { $ids = @(Get-Process Sentinel -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); if (-not $ids.Count) { return @() }; return @(([Qa]::Windows([int[]]$ids)) -split "`n" | Where-Object { $_ }) }
function Starts { return ([regex]::Matches((AppLog), 'starting Sentinel')).Count }
function StopSentinel { Get-Process Sentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; [void](Until 20 { -not (Get-Process Sentinel -ErrorAction SilentlyContinue) }); Start-Sleep 2 }
# "Scan with Sentinel" as Explorer runs it: the shell's own verb on the file. A file Explorer could not hand over this
# way (gone, or a path too long for the shell) gets the registered command line itself.
function RightClick($file) {
  try { Start-Process -FilePath $file -Verb SentinelScan -ErrorAction Stop; return 'verb' } catch {
    Start-Process -FilePath $exe -ArgumentList "`"--scan-file=$file`""; return "command ($($_.Exception.Message))"
  }
}
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
$scanExpr = "[document.getElementById('label').textContent, document.getElementById('name').textContent, document.getElementById('lead').textContent, document.getElementById('found').innerText.replace(/\s+/g, ' ')].join('|')"

# 1. Install, signed out, live scanning on. A first start puts "Scan with Sentinel" in the right-click menu.
Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"openAtLogin":false}')
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 giftshop.test`r`n127.0.0.1 paypal-account-verify-login.test`r`n127.0.0.1 defender-virusalert-helpline.test"
$pages = Start-Process python -ArgumentList '-u', '-m', 'http.server', '47910', '--directory', (Join-Path $PSScriptRoot 'e2e-chat') -PassThru -NoNewWindow -RedirectStandardError (Join-Path $Out 'pages.log') -RedirectStandardOutput (Join-Path $Out 'pages.out.log')
Start-Process $exe -ArgumentList '--hidden'
Check 'start' (WaitUp) 'the installed app started and its scanner answers'
Start-Sleep 10
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
$menuCmd = [string](Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\*\shell\SentinelScan\command' -ErrorAction SilentlyContinue).'(default)'
Check 'menu-registered' ($menuCmd -match 'scan-file=%1') "command '$menuCmd'"
StopSentinel

# 2. Started cold from the right-click menu, signed out: the answer in its own small window, in front, within seconds.
$home2 = Join-Path $env:USERPROFILE 'Documents\QA files'
New-Item -ItemType Directory -Force $home2 | Out-Null
$cold = Join-Path $home2 'Recipe card.txt'
[IO.File]::WriteAllText($cold, "Flour`r`nSugar`r`nEggs`r`n")
$t0 = Get-Date
Say "right-click, cold: $(RightClick $cold)"
$first = $null
[void](Until 30 { $script:first = SentinelWindows | Where-Object { $_ -match '\|\d+,\d+,(4\d\d|5\d\d|6\d\d|7\d\d),' } | Select-Object -First 1; [bool]$script:first })
$took = [int]((Get-Date) - $t0).TotalSeconds
Start-Sleep 20
$ws = SentinelWindows
Shot 'cold-signed-out'
Say "  windows 20 s later: $($ws -join ' / ')"
Check 'cold-result-shown' ([bool]$first -and $took -le 15) "the result window appeared after $took s: $first"
$front = $ws | Where-Object { $_ -match '^front\|' }
Check 'cold-result-in-front' ([bool]$front -and $front -notmatch '\|\d+,\d+,(8\d\d|9\d\d|\d{4}),') "in front once Sentinel finished starting: $front"
Check 'cold-no-app-window' (@($ws).Count -eq 1) "Sentinel's windows on screen: $(@($ws).Count) (a scan asked for from the right-click needs only its answer)"
Check 'cold-one-process' (@(MainProcs).Count -eq 1) "Sentinel main processes: $(@(MainProcs).Count)"
StopSentinel

# 3. Right-click scans while Sentinel runs, signed out: awkward names and awkward files, each as a person would meet it.
Check 'restart' (StartSentinel) 'started with its debugging port'
Start-Sleep 8
$emoji = [char]::ConvertFromUtf32(0x1F384)
$uni = "R$([char]0xE9)sum$([char]0xE9) $([char]0x5C65)$([char]0x6B74)$([char]0x66F8) $([char]0x444)$([char]0x430)$([char]0x439)$([char]0x43B)"
$deep = $home2
while ($deep.Length -lt 240) { $deep = Join-Path $deep 'Archive of family paperwork 2019 to 2026' }
New-Item -ItemType Directory -Force "\\?\$deep" | Out-Null
$rand = New-Object Random 7
function RandomFile($path, $mb) { $b = New-Object byte[] ($mb * 1MB); $rand.NextBytes($b); [IO.File]::WriteAllBytes($path, $b) }
$cases = @(
  @{ id = 'spaces'; name = 'Tax return 2026 (final copy).txt'; make = { param($p) [IO.File]::WriteAllText($p, 'Income and expenses') }; want = '^No threats found' },
  @{ id = 'unicode'; name = "$uni.txt"; make = { param($p) [IO.File]::WriteAllText($p, 'Curriculum vitae') }; want = '^No threats found' },
  @{ id = 'emoji'; name = "Holiday $emoji photos list.txt"; make = { param($p) [IO.File]::WriteAllText($p, 'Beach, mountains') }; want = '^No threats found' },
  @{ id = 'ampersand'; name = 'Tom & Jerry 100% done.txt'; make = { param($p) [IO.File]::WriteAllText($p, 'Notes') }; want = '^No threats found' },
  @{ id = 'long-name'; name = ('Minutes of the residents association meeting about the new parking rules and the garden ' * 2).Trim() + '.txt'; make = { param($p) [IO.File]::WriteAllText($p, 'Minutes') }; want = '^No threats found' },
  @{ id = 'long-path'; dir = $deep; name = 'Long path letter.txt'; make = { param($p) [IO.File]::WriteAllText("\\?\$p", 'Dear Sir') }; want = '^No threats found' },
  @{ id = 'empty'; name = 'Empty notes.txt'; make = { param($p) [IO.File]::WriteAllBytes($p, [byte[]]@()) }; want = '^No threats found' },
  @{ id = 'zip'; name = 'Holiday photos.zip'; make = { param($p) $s = Join-Path $env:RUNNER_TEMP 'zipsrc'; New-Item -ItemType Directory -Force $s | Out-Null; [IO.File]::WriteAllText("$s\a.txt", 'one'); [IO.File]::WriteAllText("$s\b.txt", 'two'); Compress-Archive -Path "$s\*" -DestinationPath $p -Force }; want = '^No threats found' },
  @{ id = 'exe-signed'; name = 'chrome.exe'; make = { param($p) Copy-Item "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" $p }; want = '^No threats found' },
  @{ id = 'exe-windows'; name = 'whoami copy.exe'; make = { param($p) Copy-Item "$env:WINDIR\System32\whoami.exe" $p }; want = '^No threats found' },
  @{ id = 'video-24mb'; name = 'Birthday video.mp4'; make = { param($p) RandomFile $p 24 }; want = '^No threats found' },
  @{ id = 'video-30mb'; name = 'Wedding video.mp4'; make = { param($p) RandomFile $p 30 }; want = '^Not checked\|.*over 25 MB' },
  @{ id = 'locked'; name = 'Budget.xlsx'; make = { param($p) [IO.File]::WriteAllText($p, 'Rent,Food') }; lock = $true; want = '^Not checked\|.*another program' },
  @{ id = 'deleted'; name = 'Gone soon.txt'; make = { param($p) [IO.File]::WriteAllText($p, 'bye') }; gone = $true; want = '^Not checked\|.*moved' }
)
$logNames = @()
foreach ($c in $cases) {
  $dir = $(if ($c.dir) { $c.dir } else { $home2 })
  $p = Join-Path $dir $c.name
  & $c.make $p
  if ($c.id -ne 'exe-signed') { $logNames += [IO.Path]::GetFileNameWithoutExtension($c.name) }
  $h = $null
  if ($c.lock) { $h = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None') }
  if ($c.gone) { Remove-Item -LiteralPath $p -Force }
  $starts = Starts
  $t0 = Get-Date
  $how = $(if ($c.gone) { Start-Process -FilePath $exe -ArgumentList "`"--scan-file=$p`""; 'command' } else { RightClick $p })
  $v = ''
  $ok = Until 45 { $script:v = [string](Cdp 'filescan.html' $scanExpr).value; $script:v.Split('|').Count -ge 2 -and $script:v.Split('|')[1].StartsWith($c.name) }
  $took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  if ($h) { $h.Close() }
  Start-Sleep 6
  Shot "menu-$($c.id)"
  Check "menu-$($c.id)" ($ok -and $v -match $c.want) "by $how, after $took s: $(([string]$v).Substring(0, [Math]::Min(400, ([string]$v).Length)))"
  if ($c.id -eq 'empty') { Check 'menu-empty-size' ($v -notmatch '1 KB') "an empty file's size: $(([string]$v).Split('|')[1])" }
  if ($c.id -in 'video-24mb', 'exe-signed') { Check "menu-$($c.id)-quick" ($took -le 15) "answered in $took s" }
  if ($c.id -in 'spaces', 'long-name', 'exe-windows') {
    $f = Fit 'filescan.html' $c.id
    Check "menu-$($c.id)-fits" ($f.ok -and $f.gap -le 80) "inside $($f.view), words $($f.words) px, empty $($f.gap) px, out of view '$($f.outOfView)', on screen $($f.onScreen)"
  }
  Check "menu-$($c.id)-one-start" ((Starts) -eq $starts -and @(MainProcs).Count -eq 1) "Sentinel started again for it: $((Starts) - $starts) time(s); main processes now: $(@(MainProcs).Count)"
}
$log = AppLog
$leak = @($logNames + 'QA files', 'Archive of family' | Where-Object { $log -match [regex]::Escape($_) })
Check 'menu-log-private' (-not $leak.Count) "app.log names none of the files or folders: $($leak -join ', ')"
[void](Cdp 'filescan.html' "(document.getElementById('close').click(), 1)")

# 4. The shield's windows and the right-click answer at display scaling above 100%, as people's laptops have it:
# 1366x768 at 125% and 1920x1080 at 150% (the screen made bigger first when the runner allows it).
$ping = "$env:WINDIR\System32\PING.EXE"
$standin = Join-Path $env:TEMP 'qa-standins'; New-Item -ItemType Directory -Force $standin | Out-Null
Copy-Item $ping (Join-Path $standin 'AnyDesk.exe')
function CloseEdge { Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() } }
function GuardMode { return [string](Cdp 'guard.html' 'location.search').value }
function Dismiss { [void](Cdp 'guard.html' "window.sentinelDesktop.guardAction('dismiss'), 1"); [void](Until 10 { [string](Cdp 'guard.html' '1').error -match 'no window' }) }
$modes = [Qa]::Modes()
foreach ($s in @(@{ pct = 125; w = 1366; h = 768 }, @{ pct = 150; w = 1920; h = 1080 })) {
  $tag = "$($s.pct)"
  if ($modes -match "(^|,)$($s.w)x$($s.h)(,|$)") { Say "resolution $($s.w)x$($s.h): $([Qa]::Resolution($s.w, $s.h))" } else { Say "resolution $($s.w)x$($s.h) is not offered here; kept $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)" }
  Start-Sleep 3
  $r = [Qa]::SetScale($s.pct)
  Start-Sleep 5
  $now = [Qa]::Scale()
  Say "scaling ${tag}%: set -> $r, now|recommended|largest: $now; screen $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)"
  Check "scale-$tag-set" ($now -match "^$($s.pct)\|") "the display is at $now"
  StopSentinel
  [void](StartSentinel); Start-Sleep 10
  $f = Fit '127.0.0.1:4782' "app-$tag"
  Shot "scale-$tag-app"
  Check "scale-$tag-app-window" $f.onScreen "the app's own window $($f.bounds) in the work area $($f.work)"
  # The right-click answer with things found (a long name too).
  $p = Join-Path $home2 (('Minutes of the residents association meeting about the new parking rules and the garden ' * 2).Trim() + '.txt')
  [void](RightClick $p)
  [void](Until 30 { ([string](Cdp 'filescan.html' $scanExpr).value) -match 'Minutes' })
  Start-Sleep 2
  $f = Fit 'filescan.html' "menu-$tag"
  Shot "scale-$tag-menu"
  Check "scale-$tag-menu" $f.ok "the right-click answer: inside $($f.view), out of view '$($f.outOfView)', $($f.wide), on screen $($f.onScreen)"
  [void](Cdp 'filescan.html' "(document.getElementById('close').click(), 1)")
  # The way out of a full-screen fake virus alert, placed in the middle of the screen the page is on.
  Say "Edge in front: $(FreshEdge 'http://defender-virusalert-helpline.test:47910/alert.html')"
  [K]::Tap(0x7A)
  $ok = Until 45 { [K]::Tap(0x11); (GuardMode) -match 'mode=escape' }
  Start-Sleep 2
  $f = Fit 'guard.html' "escape-$tag"
  Shot "scale-$tag-escape"
  Check "scale-$tag-escape" ($ok -and $f.ok) "the way out: shown $ok, inside $($f.view), out of view '$($f.outOfView)', window $($f.bounds) in $($f.work)"
  [K]::Tap(0x1B); Start-Sleep 1; [K]::Tap(0x7A)
  Dismiss
  # The warning on a PayPal look-alike sign-in page, with "Go to the real paypal.com".
  Say "Edge in front: $(FreshEdge 'http://paypal-account-verify-login.test:47910/signin.html')"
  $rb = ''
  $ok = Until 60 { [K]::Tap(0x11); $script:rb = [string](Cdp 'warn.html' "document.getElementById('real').textContent").value; $script:rb -ne '' }
  Start-Sleep 2
  $f = Fit 'warn.html' "warn-$tag"
  Shot "scale-$tag-warning"
  Check "scale-$tag-warning" ($ok -and $f.ok) "the warning ('$rb'): inside $($f.view), out of view '$($f.outOfView)', $($f.wide), window $($f.bounds) in $($f.work)"
  # Closed: "Did you type anything?"
  [void](Cdp 'warn.html' 'window.close(), 1')
  CloseEdge
  $ok = Until 40 { (GuardMode) -match 'mode=typed' }
  Start-Sleep 2
  $f = Fit 'guard.html' "typed-$tag"
  Shot "scale-$tag-typed"
  Check "scale-$tag-typed" ($ok -and $f.ok -and $f.gap -le 80) "did you type anything: shown $ok, inside $($f.view), words $($f.words) px, out of view '$($f.outOfView)', window $($f.bounds) in $($f.work)"
  Dismiss
  # The pay pause after the call check said hang up.
  [void](Info 'callHangUp()')
  Say "Edge in front: $(FreshEdge 'http://giftshop.test:47910/gift-cards/')"
  $ok = Until 45 { [K]::Tap(0x11); (GuardMode) -match 'mode=pause' }
  Start-Sleep 2
  $f = Fit 'guard.html' "pause-$tag"
  Shot "scale-$tag-pause"
  Check "scale-$tag-pause" ($ok -and $f.ok -and $f.gap -le 80) "the pay pause: shown $ok, inside $($f.view), words $($f.words) px, out of view '$($f.outOfView)', window $($f.bounds) in $($f.work)"
  Dismiss
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # A remote-control program soon after the flagged page (a harmless stand-in named like AnyDesk).
  $ad = Start-Process (Join-Path $standin 'AnyDesk.exe') -ArgumentList '-n', '600', '127.0.0.1' -WindowStyle Hidden -PassThru
  $ok = Until 60 { (GuardMode) -match 'mode=remote' }
  Start-Sleep 2
  $f = Fit 'guard.html' "remote-$tag"
  Shot "scale-$tag-remote"
  Check "scale-$tag-remote" ($ok -and $f.ok) "the remote-control question: shown $ok, inside $($f.view), out of view '$($f.outOfView)', window $($f.bounds) in $($f.work)"
  Dismiss
  if ($ad) { Stop-Process -Id $ad.Id -Force -ErrorAction SilentlyContinue }
}
[void][Qa]::SetScale(100)
Say "scaling back: $([Qa]::Scale())"

# 5. Signed in: the right-click hands the file to the app's own scan, with the window brought forward from the tray.
StopSentinel
[void](StartSentinel); Start-Sleep 10
$r = Cdp '127.0.0.1:4782' "(async () => { const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (x) => x.status + (x.ok ? '' : ' ' + (await x.text()).slice(0, 160))); const a = { email: 'qa-desktop-$(Get-Random)@example.com', password: 'Amber-kettle-river-58Tq' }; return [await post('/api/v1/auth/signup', Object.assign({ firstName: 'Sam', ageConfirmed: true, termsAccepted: true }, a)), await post('/api/v1/auth/login', a)].join(','); })()"
[void](Cdp '127.0.0.1:4782' "(location.href = '/app', 1)")
$paired = Until 40 { [bool](Info 'info()').pairedUserId }
Check 'signed-in' $paired "sign-up, sign-in: $($r.value)"
if (-not $paired) { Say "  diag: $(Cdp '127.0.0.1:4782' 'location.href')" }
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
$inCases = @(
  @{ id = 'in-emoji'; name = "Holiday $emoji photos list.txt"; want = 'No threats found' },
  @{ id = 'in-30mb'; name = 'Wedding video.mp4'; want = 'too big' },
  @{ id = 'in-deleted'; name = 'Gone again.txt'; gone = $true; want = 'could not be opened' }
)
$readApp = "location.pathname + '|' + ((document.querySelector('[data-out] [data-result]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 200) + '|' + [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ')"
foreach ($c in $inCases) {
  $p = Join-Path $home2 $c.name
  if ($c.gone) { [IO.File]::WriteAllText($p, 'bye'); Remove-Item -LiteralPath $p -Force }
  # Tucked away in the tray first, as it usually is.
  [void](Cdp 'main' "(process.mainModule.require('electron').BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('127.0.0.1:4782')).forEach((w) => w.hide()), 1)")
  [void](Cdp '127.0.0.1:4782' "(location.href = '/app', 1)")
  Start-Sleep 3
  $starts = Starts
  $t0 = Get-Date
  $how = $(if ($c.gone) { Start-Process -FilePath $exe -ArgumentList "`"--scan-file=$p`""; 'command' } else { RightClick $p })
  $v = ''
  $ok = Until 45 { $script:v = [string](Cdp '127.0.0.1:4782' $readApp).value; $script:v -match $c.want }
  $took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Start-Sleep 2
  $front = (SentinelWindows | Where-Object { $_ -match '^front\|' }) -join ''
  Shot "menu-$($c.id)"
  Check "menu-$($c.id)" ($ok -and $front) "by $how, after $took s, in front '$front': $v"
  Check "menu-$($c.id)-one-start" ((Starts) -eq $starts -and @(MainProcs).Count -eq 1) "Sentinel started again for it: $((Starts) - $starts) time(s); main processes now: $(@(MainProcs).Count)"
}
# Signed in and started cold from the right-click: the app opens on the file's answer.
StopSentinel
$p = Join-Path $home2 'Tax return 2026 (final copy).txt'
Say "right-click, cold and signed in: $(RightClick $p)"
$title = ''
$ok = Until 60 { $script:title = (SentinelWindows | Where-Object { $_ -match '^front\|' }) -join ''; $script:title -match 'Virus & malware' }
Start-Sleep 5
Shot 'cold-signed-in'
Check 'cold-signed-in' $ok "in front: $title; all: $((SentinelWindows) -join ' / ')"
Check 'cold-signed-in-one-process' (@(MainProcs).Count -eq 1) "Sentinel main processes: $(@(MainProcs).Count)"

if ($pages) { Stop-Process -Id $pages.Id -Force -ErrorAction SilentlyContinue }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 80 | ForEach-Object { Say "  $_" }
StopSentinel
Say "checks failed: $failed"
exit [int]($failed -gt 0)
