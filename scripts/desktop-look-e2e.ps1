# The colour chosen in the app, photographed on a real Windows desktop (a GitHub-hosted runner, never a person's computer):
# the installed Sentinel's own window (the title bar the page draws, and the page inside), the tray icon, and the taskbar
# button, in gold and in other colours. A part left gold in a colour that is not gold fails. Until 1.21.5 the window's own
# parts were checked only by wiring tests and a page drawn in a browser.
#   What a photograph reads: the pixels of a part (its box from the page, or from UI Automation for the taskbar and the
#   tray), the ones that carry a colour (saturated, not near black or white), and how many of those are gold's hue.
#   Gold: nearly all of them. Another colour: almost none, and some of its own.
#   The taskbar's button is drawn by Windows from Sentinel's window icon (live) and its shortcut (which the app re-casts
#   for the new colour): read live, and again after the app is started once more.
#   Signed in as a person would be (a new free account on the app's own server), the colour is pressed on the Overview's colour coins,
#   the way a person presses it; the page, the app and the window follow.
# Results go to $Out\results.txt; the script exits 1 when a check failed.
param([string]$Installer = '', [string]$Out = 'e2e-look')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
. (Join-Path $PSScriptRoot 'desktop-e2e-lib.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing;
public static class Tint {
  // { pixels that carry a colour, of those how many are gold's hue (25 to 65 degrees) } inside a box of a picture.
  static int[] Count(Func<int, int, Color> at, int w, int h, int x0, int y0, int bw, int bh, float minS, float minL, int minA) {
    int coloured = 0, gold = 0;
    for (int y = Math.Max(0, y0); y < Math.Min(h, y0 + bh); y++) for (int x = Math.Max(0, x0); x < Math.Min(w, x0 + bw); x++) {
      Color c = at(x, y);
      if (c.A < minA) continue;
      float s = c.GetSaturation(), l = c.GetBrightness();
      if (s < minS || l < minL || l > 0.92f) continue;
      coloured++;
      float hue = c.GetHue();
      if (hue >= 25 && hue <= 65) gold++;
    }
    return new[] { coloured, gold };
  }
  public static int[] Box(Bitmap b, int x, int y, int w, int h) { return Count((px, py) => b.GetPixel(px, py), b.Width, b.Height, x, y, w, h, 0.3f, 0.15f, 128); }
  // A dimmed icon (the tray's, at 40%) over a dark flyout: paler and darker than the same icon at full strength.
  public static int[] Soft(Bitmap b, int x, int y, int w, int h) { return Count((px, py) => b.GetPixel(px, py), b.Width, b.Height, x, y, w, h, 0.15f, 0.08f, 128); }
  // Electron's own bitmap of an icon: BGRA, colour already multiplied by alpha.
  public static int[] Bgra(byte[] d, int side) {
    return Count((px, py) => { int i = (py * side + px) * 4; int a = d[i + 3]; if (a == 0) return Color.FromArgb(0, 0, 0, 0); return Color.FromArgb(a, Math.Min(255, d[i + 2] * 255 / a), Math.Min(255, d[i + 1] * 255 / a), Math.Min(255, d[i] * 255 / a)); }, side, side, 0, 0, side, side, 0.3f, 0.15f, 60);
  }
}
"@

# Said and judged the same way for every part: gold wants nearly all gold, anything else almost none (and some colour of its own).
function Judge($name, $accent, $r) {
  $c = [int]$r[0]; $g = [int]$r[1]
  $frac = $(if ($c) { [math]::Round($g / $c, 3) } else { 1 })
  $ok = $c -ge 20 -and $(if ($accent -eq 'gold') { $frac -ge 0.8 } else { $frac -le 0.05 })
  Check "$name-$accent" $ok "$c pixels carry a colour, $g of them gold's hue ($frac)"
}

function Geometry {
  $o = ([string](Cdp 'main' @'
(() => { const e = process.mainModule.require('electron'); const w = e.BrowserWindow.getAllWindows().find((x) => x.isVisible() && x.webContents.getURL().includes('127.0.0.1:4782')); if (!w) return ''; const r = e.screen.dipToScreenRect(w, w.getContentBounds()); return r.x + '|' + r.y; })()
'@).value) -split '\|'
  $p = (Cdp '127.0.0.1:4782' @'
(() => { const q = ['.frame__mark svg', '.side .logo__mark svg', '.scanbox .btn--gold']; return JSON.stringify({ d: devicePixelRatio, r: q.map((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }) }); })()
'@).value
  if ($o.Count -ne 2 -or -not $p) { return $null }
  return @{ x = [double]$o[0]; y = [double]$o[1]; page = ($p | ConvertFrom-Json) }
}
$parts = @('title bar mark', 'side bar mark', 'Check button')

# The window and its page, photographed, then each part read where the page says it is.
function PhotographWindow($accent) {
  Shot "window-$accent"
  $g = Geometry
  if (-not $g) { Check "window-geometry-$accent" $false 'the window or its page did not answer'; return }
  $bmp = [System.Drawing.Bitmap]::FromFile($script:lastShot)
  for ($i = 0; $i -lt 3; $i++) {
    $b = $g.page.r[$i]
    if (-not $b) { Check "window-$($parts[$i])-$accent" $false "not on the page (the window shows: $((Cdp '127.0.0.1:4782' 'location.pathname').value))"; continue }
    $d = [double]$g.page.d
    $r = [Tint]::Box($bmp, [int]($g.x + $b[0] * $d), [int]($g.y + $b[1] * $d), [int]($b[2] * $d), [int]($b[3] * $d))
    Judge "window-$($parts[$i])" $accent $r
  }
  $bmp.Dispose()
}

# Pressed as a person presses it: the colour coin on the Overview (look-app.js draws it and tells the app, which recasts the
# tray icon, the window's mark, the shortcuts and Windows' own buttons).
function Choose($accent) {
  $r = (Cdp '127.0.0.1:4782' "(() => { const c = document.querySelector('.look__coin:has(input[value=$accent])'); if (!c) return 'no coin'; c.click(); return 'pressed'; })()").value
  [void](Until 20 { (Cdp '127.0.0.1:4782' "document.documentElement.dataset.accent || 'gold'").value -eq $accent })
  Start-Sleep 3
  $said = (Cdp '127.0.0.1:4782' "document.documentElement.dataset.accent || 'gold'").value
  Say "chosen $accent ($r) -> the page says $said"
  return $said
}

# The tray's icon as the app hands it to Windows (its own pixels), read from the main process.
$trayHook = @'
(() => { const e = process.mainModule.require('electron'); if (!global.qaTrayHooked) { global.qaTrayHooked = true; const o = e.Tray.prototype.setImage; e.Tray.prototype.setImage = function (img) { try { global.qaTrayImg = { side: img.getSize().width, bmp: img.toBitmap({ scaleFactor: 1 }).toString('base64') }; } catch (x) { global.qaTrayImg = { err: String(x) }; } return o.apply(this, arguments); }; } return true; })()
'@
function TrayImage($accent) {
  $j = (Cdp 'main' 'JSON.stringify(global.qaTrayImg || null)').value
  if (-not $j -or $j -eq 'null') { Check "tray-image-$accent" $false 'the app did not give Windows a new tray icon'; return }
  $t = $j | ConvertFrom-Json
  if ($t.err) { Check "tray-image-$accent" $false $t.err; return }
  Judge 'tray-image' $accent ([Tint]::Bgra([Convert]::FromBase64String($t.bmp), [int]$t.side))
}

# Buttons of the taskbar and the tray by UI Automation: where each is on the screen.
$A = [Windows.Automation.AutomationElement]
function Buttons($class) {
  $out = @()
  foreach ($w in @($A::RootElement.FindAll([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty, $class))))) {
    $out += @($w.FindAll([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button))))
  }
  return $out
}
# The taskbar's button is named 'Sentinel - 1 running window'; the tray's is its tooltip, 'Sentinel 1.21.4: live scanning off'.
function SentinelButton($classes, $pattern = 'Sentinel - *') {
  foreach ($c in $classes) {
    $hit = @(Buttons $c | Where-Object { $_.Current.Name -like $pattern }) | Select-Object -First 1
    if ($hit -and -not $hit.Current.IsOffscreen) { return $hit }
  }
  return $null
}
# The button's picture, read from a photograph of the screen: its middle part (the icon), not the highlight round it.
function ReadButton($el, $name, $accent, [switch]$Dim) {
  $r = $el.Current.BoundingRectangle
  Shot $name
  $bmp = [System.Drawing.Bitmap]::FromFile($script:lastShot)
  $x = [int]($r.X + $r.Width * 0.2); $y = [int]($r.Y + $r.Height * 0.1); $w = [int]($r.Width * 0.6); $h = [int]($r.Height * 0.7)
  $res = $(if ($Dim) { [Tint]::Soft($bmp, $x, $y, $w, $h) } else { [Tint]::Box($bmp, $x, $y, $w, $h) })
  $crop = $bmp.Clone((New-Object System.Drawing.Rectangle ([math]::Max(0, $x)), ([math]::Max(0, $y)), ([math]::Max(4, [math]::Min($w, $bmp.Width - $x))), ([math]::Max(4, [math]::Min($h, $bmp.Height - $y)))), $bmp.PixelFormat)
  $crop.Save((Join-Path $Out "$name-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose(); $bmp.Dispose()
  Say "  $name button '$($el.Current.Name)' at $([int]$r.X),$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height)"
  return $res
}
function DumpTaskbar {
  foreach ($c in 'Shell_TrayWnd', 'TopLevelWindowForOverflowXamlIsland', 'NotifyIconOverflowWindow') { foreach ($b in (Buttons $c)) { Say "  ui $c : '$($b.Current.Name)' offscreen $($b.Current.IsOffscreen)" } }
}
# The tray: in the notification area, or behind its chevron (a new icon starts hidden there).
function TrayButton {
  $b = SentinelButton @('Shell_TrayWnd') '*Sentinel [0-9]*'
  if ($b) { return $b }
  $chev = @(Buttons 'Shell_TrayWnd' | Where-Object { $_.Current.Name -like '*hidden icons*' -or $_.Current.Name -like '*Notification Chevron*' }) | Select-Object -First 1
  if ($chev) {
    try { ($chev.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke() } catch { Say "  chevron: $($_.Exception.Message)" }
    Start-Sleep 2
    return (SentinelButton @('TopLevelWindowForOverflowXamlIsland', 'NotifyIconOverflowWindow', 'Shell_TrayWnd') '*Sentinel [0-9]*')
  }
  return $null
}

# 1. Install, and start the way a person's Start menu does, window shown, no account.
Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)"
Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"openAtLogin":false}')
$started = StartSentinel
Check 'start' $started 'the installed app started and its window answers'
if (-not $started) { Shot 'not-started'; exit 1 }
Check 'window-in-front' (Front 'Sentinel') 'the app window is in front, maximised'
Start-Sleep 4
[void](Cdp 'main' $trayHook)
Say "the window shows: $((Cdp '127.0.0.1:4782' 'location.pathname').value)"
# A new free account on the app's own server (signing up signs in), then the Overview, where the colour coins are.
$made = (Cdp '127.0.0.1:4782' "(async () => { const r = await fetch('/api/v1/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'look-$(Get-Random)@example.com', password: 'Lantern-orchard-62Wb', firstName: 'Robin', ageConfirmed: true, termsAccepted: true }) }); location.href = '/app'; return r.status; })()").value
Say "an account made: $made"
Check 'overview-open' (Until 40 { (Cdp '127.0.0.1:4782' "location.pathname + '|' + Boolean(document.querySelector('.look__coin')) + '|' + Boolean(document.querySelector('.scanbox .btn--gold'))").value -eq '/app|True|True' }) "the Overview with its colour coins is in the window: $((Cdp '127.0.0.1:4782' 'location.pathname').value)"
Start-Sleep 3
DumpTaskbar

# 2. The window and its page, and the tray, in gold (as installed), then in three other colours, then gold again: the
# reading finds gold when it is there (the first and last), and the others show none of it.
PhotographWindow 'gold'
foreach ($accent in 'sapphire', 'rose', 'teal', 'gold') {
  $said = Choose $accent
  Check "chosen-$accent" ($said -eq $accent) "the page's colour is $said"
  PhotographWindow $accent
  TrayImage $accent
  $tb = TrayButton
  if ($tb) { Judge 'tray-on-screen' $accent (ReadButton $tb "tray-$accent" $accent -Dim); [K]::Tap(0x1B) } else { Say "  the tray icon is not reachable on this screen (UI Automation); its image above is what stands for it"; DumpTaskbar }
  $live = SentinelButton @('Shell_TrayWnd')
  if ($live) { Judge 'taskbar-live' $accent (ReadButton $live "taskbar-live-$accent" $accent) } else { Check "taskbar-live-$accent" $false 'no Sentinel button on the taskbar' }
}

# 3. The taskbar's button after the app is started again in a colour: Windows draws it from the shortcut, which was re-cast.
[void](Choose 'sapphire')
Start-Sleep 3
StopSentinel
$started = StartSentinel
Check 'restart' $started 'the app started again in the colour it was left in'
[void](Front 'Sentinel')
Start-Sleep 6
$tb = SentinelButton @('Shell_TrayWnd')
if ($tb) { Judge 'taskbar-after-restart' 'sapphire' (ReadButton $tb 'taskbar-restart-sapphire' 'sapphire') } else { Check 'taskbar-after-restart-sapphire' $false 'no Sentinel button on the taskbar'; DumpTaskbar; Shot 'taskbar-missing' }
Say "failed: $failed"
exit $(if ($failed) { 1 } else { 0 })
