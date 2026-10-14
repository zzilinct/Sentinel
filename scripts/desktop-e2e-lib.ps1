# Helpers shared by the desktop runs on a GitHub-hosted Windows desktop (scripts/desktop-e2e.ps1, scripts/desktop-qa.ps1),
# dot-sourced after $Out is set. Never run on a person's computer.
# To the host, not the pipeline: functions below return values, and a line said inside one must not join them.
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
function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
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
