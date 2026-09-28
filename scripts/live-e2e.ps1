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
Start-Process $exe -ArgumentList '--hidden'
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) { Start-Sleep 2; try { $up = (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {} }
Say "scanner up: $up"
Start-Sleep 20

# 3. A search in Edge, maximised.
function Search($url, $name) {
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
}
Search 'https://duckduckgo.com/?q=paypal+login+help' 'ddg'
Search 'https://www.bing.com/search?q=cheap+airpods+pro+outlet' 'bing'

# 4. What Sentinel saw.
Copy-Item "$data\logs\*.log" $Out -ErrorAction SilentlyContinue
Say '--- watch.log'; Get-Content "$data\logs\watch.log" -ErrorAction SilentlyContinue | Select-Object -Last 40 | ForEach-Object { Say "  $_" }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 15 | ForEach-Object { Say "  $_" }
