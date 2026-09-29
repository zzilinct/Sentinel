# Live scanning, end to end, on a real Windows desktop (a GitHub-hosted runner, never a person's computer):
# install Sentinel (-Installer: a build of this commit; otherwise the released -Version, or the latest release),
# switch live scanning on, search in Edge, scroll and photograph the whole screen along the way. Screenshots and
# Sentinel's logs go to $Out for review.
param([string]$Version = '', [string]$Installer = '', [string]$Out = 'e2e')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
function Say($s) { "$(Get-Date -Format HH:mm:ss) $s" | Tee-Object -FilePath "$Out\run.txt" -Append }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class K {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  // One notch of the mouse wheel: what a person scrolling a results page does, smooth-scrolled by the browser.
  public static void Wheel(int notches) { mouse_event(0x0800, 0, 0, -120 * notches, UIntPtr.Zero); }
  public static void Combo(byte mod, byte vk) { keybd_event(mod, 0, 0, UIntPtr.Zero); Tap(vk); keybd_event(mod, 0, 2, UIntPtr.Zero); }
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(0x2, 0, 0, 0, UIntPtr.Zero); mouse_event(0x4, 0, 0, 0, UIntPtr.Zero); }
  public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
$shot = 0
function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $script:shot++
  $bmp.Save(("{0}\{1:D2}-{2}.png" -f $Out, $script:shot, $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)"
# 1. The installer: built from this commit, or a released one exactly as people get it.
if ($Installer) { $setup = $Installer; $tag = 'this commit' }
else {
  $tag = if ($Version) { "v$Version" } else { (Invoke-RestMethod 'https://api.github.com/repos/zzilinct/Sentinel/releases/latest').tag_name }
  $setup = "$env:RUNNER_TEMP\Sentinel-Setup.exe"
  Invoke-WebRequest "https://github.com/zzilinct/Sentinel/releases/download/$tag/Sentinel-Setup.exe" -OutFile $setup -UseBasicParsing
}
Start-Process $setup -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed $tag -> $((Get-Item $exe).VersionInfo.ProductVersion)"

# 2. Live scanning on, auto scanning on, before the first start.
$data = "$env:APPDATA\Sentinel"; New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"autoScan":true,"openAtLogin":false}')
$env:SENTINEL_LINK_DUMP = "$Out\links.jsonl"   # what the reader saw on each results page, for review
$env:SENTINEL_OVERLAY_TRACE = "$Out\frames.txt" # every frame of the marks moving, to measure smoothness
# A stand-in webmail inbox served on this desktop (it cannot sign in to real webmail): scripts/e2e-inbox/mail/.
$env:SENTINEL_TEST_INBOX = '47900'
$inboxServer = Start-Process python -ArgumentList '-m', 'http.server', '47900', '--bind', '127.0.0.1', '--directory', (Join-Path $PSScriptRoot 'e2e-inbox') -PassThru -WindowStyle Hidden
Start-Process $exe -ArgumentList '--hidden'
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) { Start-Sleep 2; try { $up = (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {} }
Say "scanner up: $up"
Start-Sleep 20
# Pro for this test desktop's account (inbox and download protection are Pro features), then a fresh start so
# download protection sees the plan.
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue; Start-Sleep 3
Start-Process $exe -ArgumentList '--hidden'
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) { Start-Sleep 2; try { $up = (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {} }
Say "scanner up again: $up"
Start-Sleep 15
# What Sentinel costs the computer: every process it runs, its memory and the processor time it has used so far.
function Footprint($when) {
  $ps = @(Get-Process Sentinel, powershell -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Sentinel' -or ($_.CommandLine -and $_.CommandLine -match 'EncodedCommand') })
  $mb = [math]::Round((($ps | Measure-Object WorkingSet64 -Sum).Sum) / 1MB)
  $priv = [math]::Round((($ps | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB)
  $cpu = [math]::Round((($ps | Measure-Object CPU -Sum).Sum), 1)
  Say "footprint ${when}: $($ps.Count) processes, $mb MB in memory ($priv MB private), $cpu s of processor time so far"
  foreach ($p in $ps) { Say ("  {0,-11} {1,6} MB  {2,7} s  {3}" -f $p.ProcessName, [math]::Round($p.WorkingSet64 / 1MB), [math]::Round($p.CPU, 1), $p.PriorityClass) }
}
Footprint 'after start'

# 3. A search in Edge, maximised.
function Search($url, $name, $menuAt) {
  Start-Process msedge -ArgumentList '--no-first-run', '--start-maximized', '--hide-crash-restore-bubble', $url
  Start-Sleep 12
  $p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) { [K]::ShowWindow($p.MainWindowHandle, 3) | Out-Null; [K]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
  # Someone is at the keyboard (a runner has had no input for minutes, and Sentinel rests when nobody is there).
  [K]::Tap(0x11); [K]::SetCursorPos(500, 420) | Out-Null
  Start-Sleep 10
  Shot "$name-results"
  # Scroll in small steps, photographing between them: marks should travel with their results.
  for ($s = 1; $s -le 10; $s++) { if ($s -le 4) { [K]::Wheel(1) }; Start-Sleep -Milliseconds 70; Shot "$name-wheel$s" }
  Start-Sleep 3; Shot "$name-settled"
  for ($s = 1; $s -le 3; $s++) { [K]::Tap(0x22); Start-Sleep -Milliseconds 150; Shot "$name-page$s" }
  Start-Sleep 3; Shot "$name-page-settled"
  # One long, smooth scroll with nothing else going on (no screenshots in the middle): frames.txt records how the
  # marks followed it.
  [K]::Tap(0x24); Start-Sleep 4; Shot "$name-top"
  Add-Content "$Out\frames.txt" "# $name long scroll"
  for ($s = 1; $s -le 14; $s++) { [K]::Wheel(1); Start-Sleep -Milliseconds 45 }
  Start-Sleep 3; Shot "$name-long-scroll-settled"
  # The browser's own menu opens over the page: it must cover the marks, not the other way round.
  [K]::Combo(0x12, 0x46); Start-Sleep 2; Shot "$name-edge-menu"; [K]::Tap(0x1B); Start-Sleep 1
  # A menu the page itself opens (DuckDuckGo's, like Google's apps grid): marks under it go away while it is open.
  if ($menuAt) { [K]::Tap(0x24); Start-Sleep 3; [K]::Click($menuAt[0], $menuAt[1]); Start-Sleep 2; Shot "$name-page-menu"; [K]::Tap(0x1B); Start-Sleep 2; Shot "$name-page-menu-closed" }
}
Search 'https://duckduckgo.com/?q=paypal+login+help' 'ddg' @(978, 119)
Search 'https://www.bing.com/search?q=cheap+airpods+pro+outlet' 'bing'
Search 'https://www.google.com/search?q=paypal+login+help&hl=en' 'google' @(871, 131)

# 4. An inbox (a Pro feature, given above). Everyday mail and scams side by side: the scams should get a mask, the
# rest a tick, and marks must stay inside the message list while it scrolls.
Search 'http://127.0.0.1:47900/mail/' 'inbox'
if ($inboxServer) { Stop-Process -Id $inboxServer.Id -Force -ErrorAction SilentlyContinue }

# 5. Download protection: everyday files arrive in Downloads (a program, a text file, an archive). Each should be
# scanned (app.log says "download scanned"), and none of them flagged.
$dl = Join-Path $env:USERPROFILE 'Downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
Copy-Item "$env:WINDIR\System32\notepad.exe" (Join-Path $dl 'notepad-copy.exe')
Set-Content -Path (Join-Path $dl 'shopping-list.txt') -Value 'eggs, milk, bread' -Encoding ascii
Compress-Archive -Path (Join-Path $dl 'shopping-list.txt') -DestinationPath (Join-Path $dl 'list.zip') -Force
# Real installers people download every day: none of them may be flagged (best effort: a moved link is skipped).
$popular = @(
  'https://www.7-zip.org/a/7z2409-x64.exe',
  'https://the.earth.li/~sgtatham/putty/latest/w64/putty.exe',
  'https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.7/npp.8.7.Installer.x64.exe',
  'https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip'
)
foreach ($u in $popular) {
  try { Invoke-WebRequest $u -OutFile (Join-Path $dl ([IO.Path]::GetFileName($u))) -UseBasicParsing -TimeoutSec 60; Say "downloaded $u" } catch { Say "could not download $u" }
}
Start-Sleep 30

Footprint 'after browsing'
# A minute with nothing in front but the desktop: what Sentinel uses while someone plays a game or works.
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$before = @(Get-Process Sentinel, powershell -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
Start-Sleep 60
$after = @(Get-Process Sentinel, powershell -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
Say ("idle minute: Sentinel used {0:N1} s of processor time in 60 s ({1:N1}% of one core)" -f ($after - $before), (($after - $before) / 60 * 100))
Footprint 'after an idle minute'

# 6. What Sentinel saw.
Copy-Item "$data\logs\*.log" $Out -ErrorAction SilentlyContinue
Say '--- watch.log'; Get-Content "$data\logs\watch.log" -ErrorAction SilentlyContinue | Select-Object -Last 40 | ForEach-Object { Say "  $_" }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 30 | ForEach-Object { Say "  $_" }
