# The desktop protections, end to end, on a real Windows desktop (a GitHub-hosted runner, never a person's computer):
# install Sentinel built from this commit, then prove in the installed app that chat safety reads Discord and Roblox
# and flags messages, that "Check my texts" reads a Phone Link-shaped window and judges only received texts, that "Stop pasted commands" swaps a ClickFix-shaped command on the clipboard, that the
# tech-support scam shield notices AnyDesk (and offers a way out of a full-screen flagged page), and that the parent
# lock guards switching protection off. Everything that looks dangerous here is a harmless stand-in.
# Sentinel is started with a debugging port so this script can ask its own windows what they show (scripts/e2e-cdp.js).
# Results go to $Out\results.txt; the script exits 1 when a check failed.
param([string]$Installer = '', [string]$Out = 'e2e-desktop')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
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

Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)"
# 1. Install, as live-e2e.ps1 does, with chat safety on.
Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
# 1a. A start that breaks inside a require (boot.js): a copy of the installed app whose code is this commit's, as a
# folder instead of app.asar, with one module broken on purpose and its own name, so it never touches the real app's
# data. It must log why and show a message, not vanish.
$broken = Join-Path $env:RUNNER_TEMP 'sentinel-broken'
$brokenData = "$env:APPDATA\SentinelBrokenStart"
Remove-Item -Recurse -Force $broken, $brokenData -ErrorAction SilentlyContinue
Copy-Item -Recurse (Split-Path $exe) $broken
Remove-Item -Force "$broken\resources\app.asar"
Copy-Item -Recurse (Join-Path $PSScriptRoot '..\desktop\src') "$broken\resources\app\src"
[IO.File]::WriteAllText("$broken\resources\app\src\downloads.js", "throw new Error('broken on purpose by desktop-e2e');")
[IO.File]::WriteAllText("$broken\resources\app\package.json", '{"name":"sentinel-broken-start","productName":"SentinelBrokenStart","main":"src/boot.js"}')
$bp = Start-Process "$broken\Sentinel.exe" -PassThru
$logged = Until 40 { (Get-Content "$brokenData\logs\app.log" -Raw -ErrorAction SilentlyContinue) -match 'could not start: Error: broken on purpose' }
# Windows titles the box "Error"; the words inside it are read through UI Automation.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function WindowWords($procId) {
  $A = [Windows.Automation.AutomationElement]
  $w = $A::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, (New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, $procId)))
  if (-not $w) { return '' }
  return (@($w.Current.Name) + @($w.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })) -join ' | '
}
$told = Until 20 { (WindowWords $bp.Id) -match 'Sentinel could not start' }
Say "  the box: $(WindowWords $bp.Id)"
Check 'broken-start-logged' $logged 'a require that throws at start is in app.log'
Check 'broken-start-told' $told "the person sees 'Sentinel could not start'"
if (-not $told) { Shot 'broken-start' }
Stop-Process -Id $bp.Id -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"autoScan":true,"openAtLogin":false,"chatSafety":true,"textSafety":true}')
# Chrome's first start on a fresh runner once took minutes (no window for the Discord stand-in, a blank Roblox one),
# while every later start took a second. It is paid here, while Sentinel starts, and how long it took is written down.
$warm = Get-Date
Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\warm-profile", 'about:blank'
$warmed = Until 180 { [bool](Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) }
Say "Chrome's first window: $warmed after $([int]((Get-Date) - $warm).TotalSeconds) s; Defender real-time: $(try { (Get-MpComputerStatus).RealTimeProtectionEnabled } catch { '?' })"
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# Its log (every request, on stderr) is kept, so a stand-in whose page never came can be told apart from a page never asked for.
$pagesLog = Join-Path $Out 'pages.log'
$pages = Start-Process python -ArgumentList '-u', '-m', 'http.server', '47910', '--directory', (Join-Path $PSScriptRoot 'e2e-chat') -PassThru -NoNewWindow -RedirectStandardError $pagesLog -RedirectStandardOutput "$pagesLog.out"
function PagesDiag($page) {
  try { Say "  diag: page answers $((Invoke-WebRequest "http://127.0.0.1:47910/$page" -UseBasicParsing -TimeoutSec 5).StatusCode)" } catch { Say "  diag: page does not answer: $($_.Exception.Message)" }
  Get-Content $pagesLog -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag pages.log: $_" }
}
Start-Process $exe -ArgumentList '--hidden'
$up = WaitUp
Check 'start' $up 'the installed app started and its scanner answers'
if (-not $up) { Shot 'not-started'; Get-Process | Where-Object { $_.ProcessName -match 'Sentinel' } | ForEach-Object { Say "  process $($_.ProcessName) $($_.Id)" }; exit 1 }
Start-Sleep 15
# Pro (download protection is a Pro feature, and the AnyDesk check starts from a download), then a fresh start with
# the debugging port.
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue; Start-Sleep 3
Check 'restart' (StartSentinel) 'started again with its debugging port'
Start-Sleep 10
$i = Info 'info()'
Say "chat safety: $($i.chatSafety | ConvertTo-Json -Compress -Depth 4)"
Say "command shield: $($i.commandShield), browsers running: $($i.browsers.running -join ',')"
if (-not $i.chatSafety.running) {
  # The chat reader is not running: start the same script the same way, and keep what it said on the way out.
  $diag = Join-Path $env:RUNNER_TEMP 'reader-diag.js'
  @'
const { spawn } = require('child_process');
const { SCRIPT } = require(process.argv[2])._test;
const child = spawn('powershell.exe', require(process.argv[2])._test.LAUNCH, { windowsHide: true });
let out = '', err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });
child.stdin.write(`${Buffer.from(SCRIPT, 'utf8').toString('base64')}\napps discord,roblox\n`);
child.on('exit', (code) => { console.log(`reader exited ${code}\nstdout: ${out.slice(0, 600)}\nstderr: ${err.slice(0, 3000)}`); process.exit(0); });
setTimeout(() => { console.log(`reader still running after 15 s\nstdout: ${out.slice(0, 600)}\nstderr: ${err.slice(0, 3000)}`); child.kill(); process.exit(0); }, 15000);
'@ | Set-Content -Path $diag -Encoding utf8
  node $diag (Resolve-Path (Join-Path $PSScriptRoot '..\desktop\src\chatwatch.js')).Path | ForEach-Object { Say "  $_" }
}

# 1b. Pay pause, before anything scam-shaped happened on this computer: a page that sells gift cards (a harmless local
# page behind a hosts mapping, known by its address /gift-cards/) is noticed, and nothing is shown. 5e2 comes back.
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 giftshop.test`r`n127.0.0.1 coinshop.test`r`n127.0.0.1 walletapp.test"
function PauseLines($what) { return ([regex]::Matches((AppLog), "pay pause: $what")).Count }
Say "Edge in front: $(FreshEdge 'http://giftshop.test:47910/gift-cards/')"
$ok = Until 45 { [K]::Tap(0x11); (PauseLines 'a gift card page, no recent sign; nothing shown') -gt 0 }
Check 'pay-pause-no-sign' ($ok -and [string](Cdp 'guard.html' '1').error -match 'no window') "a gift card page before any sign: noticed $ok, and no window"
if (-not $ok) { Get-Content "$data\logs\watch.log" -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag watch.log: $_" } }
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Chat safety in "Discord": Chrome under the name Discord.exe, showing a page with Discord's message list.
$chromeDir = "$env:ProgramFiles\Google\Chrome\Application"
New-Item -ItemType HardLink -Path "$chromeDir\Discord.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
New-Item -ItemType HardLink -Path "$chromeDir\RobloxPlayerBeta.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
New-Item -ItemType HardLink -Path "$chromeDir\PhoneExperienceHost.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
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
Say "Discord in front: $(Fake 'Discord' 'discord.html')"
$seen = $null
$ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.discord.flagged -ge 2 }
Shot 'discord'
Check 'chat-discord-read' ($seen.discord.checked -ge 3) "messages checked in Discord: $($seen.discord.checked) (3 on screen)"
Check 'chat-discord-flagged' $ok "messages flagged in Discord: $($seen.discord.flagged) (the phone number and the secret)"
$o = (Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + getComputedStyle(document.getElementById('badge')).display + '|' + document.body.className").value
Check 'chat-discord-overlay' ($o -match '^[1-9]\d*\|(?!none)') "chat overlay over Discord (warnings|badge|app): $o"
# The island in chat: the badge springs open from its mask tile, and each card opens out of its tile beside the message.
$replay = "const b = document.getElementById('badge'); b.classList.remove('is-on'); b.getAnimations({ subtree: true }).forEach((x) => { try { x.finish(); } catch (e) {} }); b.classList.add('is-on')"
$n = @(80, 180, 700 | ForEach-Object { Frame 'chat.html' $replay $_ "motion-chat-$($_)ms" -Layer })
Check 'motion-chat' (($n | Measure-Object -Minimum).Minimum -gt 0) "animations paused mid-spring in the chat overlay, per frame: $($n -join ', ')"
Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# 3. Chat safety in "Roblox": in a game (its log says so), the chat box read with the text recogniser.
$rlogs = "$env:LOCALAPPDATA\Roblox\logs"; New-Item -ItemType Directory -Force $rlogs | Out-Null
Set-Content -Path "$rlogs\0.0.1_e2e_Player_last.log" -Value "2026-10-07T12:00:00.000Z,0.0,1,6 [FLog::Output] ! Joining game 'x' place 123 at 10.0.0.1" -Encoding ascii
Say "  the Roblox log, as Sentinel follows it: $((Cdp 'main' "JSON.stringify(process.mainModule.require('./chatwatch')._test.state())").value)"
Say "Roblox in front: $(Fake 'RobloxPlayerBeta' 'roblox.html')"
$ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.roblox.flagged -ge 1 }
Shot 'roblox'
Check 'chat-roblox-read' ($seen.roblox.checked -ge 1) "messages checked in Roblox: $($seen.roblox.checked) (2 on screen)"
Check 'chat-roblox-flagged' $ok "messages flagged in Roblox: $($seen.roblox.flagged) (the free Robux offer)"
# The game is known from Roblox's log, followed every 2 s; the overlay changes when it is (not only at the next message).
$o = ''
[void](Until 10 { $script:o = (Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + document.body.className").value; $script:o -match '^[1-9]\d*\|roblox in-game' })
Check 'chat-roblox-overlay' ($o -match '^[1-9]\d*\|roblox in-game') "chat overlay over Roblox (warnings|app): $o"
# When the overlay does not say in-game: the Roblox log as Sentinel reads it.
if (-not ($o -match '^[1-9]\d*\|roblox in-game')) {
  PagesDiag 'roblox.html'
  Shot 'diag-roblox'
  Get-ChildItem $rlogs | ForEach-Object { Say "  diag: roblox log $($_.Name) $($_.Length) bytes, written $($_.LastWriteTime.ToString('HH:mm:ss.fff'))" }
  $d = (Cdp 'main' "(() => { const fs = process.mainModule.require('fs'); const c = process.mainModule.require('./chatwatch'); const d = process.env.LOCALAPPDATA + '\\Roblox\\logs'; return JSON.stringify(fs.readdirSync(d).map((f) => [f, c._test.readLog(fs.readFileSync(d + '\\' + f, 'utf8'))])) + ' ' + JSON.stringify(c.stats().roblox) + ' ' + JSON.stringify(c._test.state()) + ' now ' + new Date().toISOString(); })()")
  Say "  diag: $($d.value)$($d.error)"
  Start-Sleep 5
  [void](Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + document.body.className")
}
Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
# 3b. "Check my texts" in "Phone Link": Chrome under the name PhoneExperienceHost.exe, showing a page shaped like its
# Messages tab (scripts/e2e-chat/phonelink.html). This proves the reader and the judging; the real Phone Link's
# layout has not been checked against it.
function Texts { return (Info 'info()').textSafety.seen }
# When a check fails: what the reader itself writes for the stand-in in front (its texts are harmless stand-ins), and
# the tabs Windows describes in it.
function PlDiag {
  $diag = Join-Path $env:RUNNER_TEMP 'pl-diag.js'
  @'
const { spawn } = require('child_process');
const t = require(process.argv[2])._test;
const child = spawn('powershell.exe', t.LAUNCH, { windowsHide: true });
let out = '', err = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { err += d; });
child.stdin.write(`${Buffer.from(t.SCRIPT, 'utf8').toString('base64')}\napps phonelink\n`);
setTimeout(() => { console.log(`stdout: ${out.slice(0, 4000)}\nstderr: ${err.slice(0, 2000)}`); child.kill(); process.exit(0); }, 8000);
'@ | Set-Content -Path $diag -Encoding utf8
  node $diag (Resolve-Path (Join-Path $PSScriptRoot '..\desktop\src\chatwatch.js')).Path | ForEach-Object { Say "  reader: $_" }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $p = Get-Process PhoneExperienceHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $all = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($e in $all) {
      $c = $e.Current
      if ($c.Name -match '^(Messages|Calls)' -or $c.ControlType.ProgrammaticName -match 'Tab|List\b') { Say "  uia: $($c.ControlType.ProgrammaticName) '$($c.Name)' $($c.BoundingRectangle) patterns: $(($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ',')" }
    }
  }
}
$t0 = Texts
Say "texts before: $($t0 | ConvertTo-Json -Compress)"
Say "Phone Link in front (a scam text): $(Fake 'PhoneExperienceHost' 'phonelink.html?c=scam')"
$ok = Until 40 { $script:ts = Texts; $script:ts.flagged -ge 1 -and $script:ts.checked -ge 2 }
Start-Sleep 6; $ts = Texts
Shot 'phonelink-scam'
Check 'texts-read' ($ts.checked -eq 2) "texts checked: $($ts.checked) (2 received on screen, 1 sent)"
Check 'texts-scam-flagged' ($ok -and $ts.flagged -eq 1) "texts flagged: $($ts.flagged) (the USPS fee; the sent message would be a second if it were judged)"
Check 'texts-links-checked' ($ts.unchecked -eq 0) "links that could not be checked: $($ts.unchecked) $($ts.why)"
$o = (Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + document.body.className + '|' + document.getElementById('badgeText').textContent").value
Check 'texts-overlay' ($o -match '^1\|phonelink\|') "chat overlay over Phone Link (warnings|app|badge): $o"
if (-not ($ts.checked -eq 2 -and $ts.flagged -eq 1)) { PlDiag }
Get-Process PhoneExperienceHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3
Say "Phone Link in front (a short code): $(Fake 'PhoneExperienceHost' 'phonelink.html?c=code')"
$ok = Until 40 { $script:ts = Texts; $script:ts.checked -ge 3 }
Start-Sleep 4; $ts = Texts
Check 'texts-shortcode-ordinary' ($ok -and $ts.checked -eq 3 -and $ts.flagged -eq 1) "after 'Reply Y to activate text alerts' from 72166: $($ts.checked) checked, $($ts.flagged) flagged (expected 3 and 1)"
Get-Process PhoneExperienceHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3
Say "Phone Link in front (its Calls tab): $(Fake 'PhoneExperienceHost' 'phonelink.html?c=calls')"
$ok = Until 20 { (Texts).otherTab -eq $true }
Start-Sleep 4; $ts = Texts
Shot 'phonelink-calls'
Check 'texts-other-tab' ($ok -and $ts.checked -eq 3 -and $ts.flagged -eq 1) "with the Calls tab open: $($ts.checked) checked, $($ts.flagged) flagged (nothing new read)"
if (-not ($ts.checked -eq 3)) { PlDiag }
Get-Process PhoneExperienceHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$log = AppLog
Check 'chat-log-private' (-not ($log -match '876-555|robux-gen|our secret|Player1|Stranger|555-0199|usps-redeliver|72166|Hi Mum')) 'app.log holds no message, name or number'
Start-Sleep 2

# 4. "Stop pasted commands": a browser in front, a ClickFix-shaped command copied (harmless: it would only print hi).
Start-Process msedge -ArgumentList '--no-first-run', '--start-maximized', 'http://127.0.0.1:47910/plain.html'
Start-Sleep 10
Say "Edge in front: $(Front 'msedge')"
$command = 'powershell -w hidden -enc ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Write-Output hi'))
Set-Clipboard -Value $command
$clip = ''
$ok = Until 10 { $script:clip = Get-Clipboard -Raw; $script:clip -like 'Sentinel stopped a command*' }
if (-not $ok) {
  $i = Info 'info()'; Say "  command shield: $($i.commandShield), browsers running: $($i.browsers.running -join ',')"
  [void](Cdp 'main' "(() => { const m = process.mainModule; const e = m.require('electron'); const t = e.clipboard.readText(); return JSON.stringify({ main: m.filename, electron: typeof e, type: typeof t, seen: String(t).slice(0, 40), found: m.require('../shared/clickfix').classify(String(t)) }); })()")
}
Check 'clickfix-stopped' $ok "clipboard after copying the command: $clip"
Check 'clickfix-log' ((AppLog) -match 'copied command stopped') 'app.log: copied command stopped'
Set-Clipboard -Value 'eggs, milk, bread'
Start-Sleep 4
$clip = Get-Clipboard -Raw
Check 'clickfix-ordinary' ($clip.Trim() -eq 'eggs, milk, bread') "clipboard after copying ordinary text: $clip"
# A developer's snippet copied with the browser in front is left alone: a shell prompt, a "human-readable" or
# "verify the checksum" comment is not a fake check.
Say "Edge in front: $(Front 'msedge')"
$flaggedBefore = ([regex]::Matches((AppLog), 'copied command (stopped|flagged)')).Count
foreach ($snippet in @('$ df -h  # human-readable', 'curl -LO https://downloads.test/tool.tar.gz  # then verify the checksum')) {
  Set-Clipboard -Value $snippet
  Start-Sleep 4
  $clip = (Get-Clipboard -Raw) + ''
  Check 'clickfix-snippet' ($clip.Trim() -eq $snippet) "clipboard after copying a developer snippet in the browser: $clip"
}
Check 'clickfix-snippet-log' (([regex]::Matches((AppLog), 'copied command (stopped|flagged)')).Count -eq $flaggedBefore) 'app.log: no copied command stopped or flagged for the snippets'
# The clipboard is read every half second only while a browser is in front; with another program in front, every 1.5 s.
function ClipStatus { return (Cdp 'main' "process.mainModule.require('./clipwatch').status()").value }
[void](Until 10 { (ClipStatus).every -eq 500 })
$a = ClipStatus; Start-Sleep 6; $b = ClipStatus
Check 'clickfix-fast-in-browser' ($b.every -eq 500 -and ($b.reads - $a.reads) -ge 6) "browser in front: every $($b.every) ms, $($b.reads - $a.reads) reads in 6 s"
Start-Process notepad
Start-Sleep 3
Say "Notepad in front: $(Front 'notepad')"
Start-Sleep 3
# Measured once Sentinel has seen the change of program (its helper looks twice a second, at low priority, and a
# copy just after a browser left still counts as the browser's for 2 s), so the 6 s are all spent in one mode.
[void](Until 10 { (ClipStatus).every -eq 1500 })
$a = ClipStatus; Start-Sleep 6; $b = ClipStatus
Check 'clickfix-slow-elsewhere' ($b.every -eq 1500 -and ($b.reads - $a.reads) -le 5) "another program in front: every $($b.every) ms, $($b.reads - $a.reads) reads in 6 s"
# The same kind of command copied in another program is the person's own: told about, never taken off the clipboard.
$command2 = 'powershell -w hidden -enc ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Write-Output there'))
Set-Clipboard -Value $command2
$ok = Until 10 { (AppLog) -match 'copied command flagged \(copied in a program\)' }
$clip = (Get-Clipboard -Raw) + ''
Check 'clickfix-program-told' ($ok -and $clip.Trim() -eq $command2) "copied in Notepad: told ($ok), clipboard left alone: $($clip.Substring(0, [Math]::Min(40, $clip.Length)))"
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 4a. Wallet guard: a small helper standing in for a clipboard hijacker (harmless: it only sets the clipboard) copies a
# test Bitcoin address and, straight after, with no pause and no key pressed, puts a different one in its place, as
# real hijackers do within milliseconds. Sentinel hears both changes as they happen and puts the first back.
$btcA = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; $btcB = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
$swapper = Join-Path $env:RUNNER_TEMP 'swapper.ps1'
$gapFile = Join-Path $env:RUNNER_TEMP 'swap-gap.txt'
# It writes the clipboard the way hijackers do, straight through Windows' own calls, the second address 10 ms after the first.
@'
Add-Type -Namespace W -Name C -MemberDefinition '[DllImport("user32.dll")] public static extern bool OpenClipboard(System.IntPtr h); [DllImport("user32.dll")] public static extern bool EmptyClipboard(); [DllImport("user32.dll")] public static extern System.IntPtr SetClipboardData(uint f, System.IntPtr d); [DllImport("user32.dll")] public static extern bool CloseClipboard();'
function Put($s) {
  $p = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($s)
  for ($i = 0; $i -lt 200 -and -not [W.C]::OpenClipboard([IntPtr]::Zero); $i++) { Start-Sleep -Milliseconds 1 }
  [void][W.C]::EmptyClipboard(); [void][W.C]::SetClipboardData(13, $p); [void][W.C]::CloseClipboard()
}
Put '__A__'
$t = [Diagnostics.Stopwatch]::StartNew()
while ($t.ElapsedMilliseconds -lt 10) { }
Put '__B__'
$t.ElapsedMilliseconds | Set-Content '__GAP__'
Start-Sleep 8
'@.Replace('__A__', $btcA).Replace('__B__', $btcB).Replace('__GAP__', $gapFile) | Set-Content -Path $swapper -Encoding utf8
$hearing = (ClipStatus).hearing
Check 'wallet-hearing' ($hearing -eq $true) "clipboard changes heard as they happen (not only read on a timer): $hearing"
$catches = { ([regex]::Matches((AppLog), 'wallet address swap caught')).Count }
Set-Clipboard -Value 'a shopping list'
Start-Sleep 2
$sw = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $swapper -WindowStyle Hidden -PassThru
$ok = Until 20 { (& $catches) -ge 1 }
Start-Sleep 1
$clip = (Get-Clipboard -Raw) + ''
Shot 'wallet-swap'
Say "  the swap came $((Get-Content $gapFile -ErrorAction SilentlyContinue) -join '') ms after the copy"
Check 'wallet-swap-restored' ($ok -and $clip.Trim() -eq $btcA) "caught ($ok); clipboard after the swap is the copied address: $($clip.Trim() -eq $btcA)"
Check 'wallet-swap-log' $ok "app.log: $(([regex]::Match((AppLog), 'wallet address swap caught[^\r\n]*')).Value)"
[void]$sw.WaitForExit(15000)
# Two different addresses the person copies, less than a second apart, with Ctrl+C pressed between them: left alone.
Start-Sleep 11
Start-Process notepad
Start-Sleep 3
Say "Notepad in front: $(Front 'notepad')"
Set-Clipboard -Value $btcB
Start-Sleep -Milliseconds 800
[K]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [K]::Tap(0x43); [K]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
Set-Clipboard -Value $btcA
Start-Sleep 5
$clip = (Get-Clipboard -Raw) + ''
Check 'wallet-own-copy' ($clip.Trim() -eq $btcA -and (& $catches) -eq 1) "after copying two addresses with Ctrl+C between: clipboard is the second ($($clip.Trim() -eq $btcA)), swaps caught still 1 ($(& $catches))"
Check 'wallet-log-private' (-not ((AppLog) -match '1A1zP1|1BvBMS')) 'app.log holds no wallet address'
Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 4b. The live-scanning corner as an island, over Edge: the mask springs open into a card with the words, a new
# message morphs the card, and it closes back into the mask. Photographed mid-spring (bottom right of each frame).
Say "Edge in front: $(Front 'msedge')"
Start-Sleep 7   # past the corner's own timers (its words leave at 4.2 s, the mask rests at 5 s)
$isl = "const c = document.getElementById('corner'); c.classList.add('is-on'); c.classList.remove('is-rested', 'is-quiet', 'is-shy'); const I = window.sentinelIsland; const settle = () => document.getAnimations().forEach((x) => { try { x.finish(); } catch (e) {} })"
$scan = "I.say('<b>Sentinel is scanning</b> this browser.', '#e2c47f', true)"
$n = @()
$n += @(70, 160, 320, 800 | ForEach-Object { Frame 'overlay.html' "$isl; I.hush(); settle(); $scan" $_ "motion-island-open-$($_)ms" })
$n += Frame 'overlay.html' "$isl; $scan; settle(); I.say('<b>Phishing.</b> Do not enter anything here.', '#e5484d', true)" 160 'motion-island-morph-160ms'
$n += Frame 'overlay.html' "$isl; $scan; settle(); I.hush()" 140 'motion-island-close-140ms'
Check 'motion-island' (($n | Measure-Object -Minimum).Minimum -gt 0) "animations paused mid-spring in the corner island, per frame: $($n -join ', ')"

# 4c. Hover a link: Edge in front on a forum-shaped page. The pointer rests on a link to a listed scam, then on an
# honest one, then on nothing; live scanning puts one mark beside the link it rests on, and takes it away after.
Start-Process msedge -ArgumentList '--no-first-run', '--start-maximized', 'http://127.0.0.1:47910/hover.html'
Start-Sleep 8
Say "Edge in front: $(Front 'msedge')"
Start-Sleep 3
# Where a link is on screen, as Windows describes it to screen readers (the same way the app finds it).
function LinkAt($name) {
  $A = [Windows.Automation.AutomationElement]
  $l = $A::FromHandle([K]::GetForegroundWindow()).FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.AndCondition(
    (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Hyperlink)),
    (New-Object Windows.Automation.PropertyCondition($A::NameProperty, $name)))))
  if (-not $l) { return $null }
  $b = $l.Current.BoundingRectangle
  return @([int]($b.X + $b.Width / 2), [int]($b.Y + $b.Height / 2))
}
function HoverMarks { return [string](Cdp 'overlay.html' "[...document.querySelectorAll('#marks .mark')].map((n) => n.dataset.state || 'pending').join(',')").value }
function HoverLog($badge) { return ([regex]::Matches((Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) + '', "link under the pointer: $badge")).Count }
$scamAt = LinkAt 'PayPal account review'; $safeAt = LinkAt 'Wikipedia'
Say "links on screen: scam at $($scamAt -join ','), safe at $($safeAt -join ',')"
if ($scamAt -and $safeAt) {
  [void][K]::SetCursorPos($scamAt[0] - 300, $scamAt[1] + 200); Start-Sleep 1
  $before = HoverLog 'red'
  [void][K]::SetCursorPos($scamAt[0], $scamAt[1])
  $marks = ''
  $ok = Until 20 { $script:marks = HoverMarks; (HoverLog 'red') -gt $before -and $script:marks -eq 'red:scam' }
  Shot 'hover-scam'
  Check 'hover-scam' $ok "resting on a link to a listed scam: overlay marks '$marks', watch.log says red: $((HoverLog 'red') -gt $before)"
  $before = HoverLog 'clean'
  [void][K]::SetCursorPos($safeAt[0], $safeAt[1])
  $ok = Until 20 { $script:marks = HoverMarks; (HoverLog 'clean') -gt $before -and $script:marks -eq 'clear' }
  Shot 'hover-safe'
  Check 'hover-safe' $ok "resting on a link to an honest site: overlay marks '$marks' (one quiet mark)"
  [void][K]::SetCursorPos($safeAt[0], $safeAt[1] + 150)
  $ok = Until 10 { $script:marks = HoverMarks; $script:marks -eq '' }
  Check 'hover-gone' $ok "pointer moved off the link: overlay marks '$marks'"
} else { Check 'hover-scam' $false 'the test page''s links were not found on screen'; Shot 'hover-no-links' }
Check 'hover-log-private' (-not ((Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) -match 'link under the pointer: \S*\s*https?:')) 'watch.log says whether a hovered link was flagged, never its address'

# 4d. Where a download came from: two harmless copies of whoami.exe, each with the Zone.Identifier stream a browser
# writes, made beside Downloads and moved in whole. "ZoomInstaller.exe" from a look-alike site is flagged before it
# is run, naming zoom.us; "ZoomInstallerFull.exe" from Zoom's own download server is left alone.
$dl = Join-Path $env:USERPROFILE 'Downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
$stage = Join-Path $env:TEMP 'dl-source'; New-Item -ItemType Directory -Force $stage | Out-Null
function Arrive($name, $hostUrl, $referrer) {
  $f = Join-Path $stage $name
  Copy-Item "$env:WINDIR\System32\whoami.exe" $f -Force
  Set-Content -LiteralPath $f -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`nReferrerUrl=$referrer`r`nHostUrl=$hostUrl"
  Move-Item $f (Join-Path $dl $name) -Force
  Say "  $name in Downloads, its stream: $((Get-Content -LiteralPath (Join-Path $dl $name) -Stream Zone.Identifier) -join ' | ')"
}
function Recent($name) { return (Cdp 'main' "JSON.stringify(process.mainModule.require('./downloads').recent().find((d) => d.name === '$name') || null)").value | ConvertFrom-Json }
Arrive 'ZoomInstallerFull.exe' 'https://cdn.zoom.us/prod/6.2.5.48557/ZoomInstallerFull.exe' 'https://zoom.us/download'
Arrive 'ZoomInstaller.exe' 'https://zoom-download-free.site/files/ZoomInstaller.exe' 'https://zoom-download-free.site/'
$ok = Until 90 { (AppLog) -match 'download source: ZoomInstallerFull\.exe from Zoom.s own site' }
$r = Recent 'ZoomInstallerFull.exe'
Check 'download-source-genuine' ($ok -and $r -and -not $r.badge) "from cdn.zoom.us: logged as Zoom's own ($ok), listed as '$($r.label)' with badge '$($r.badge)'"
$ok = Until 90 { (AppLog) -match 'download source: ZoomInstaller\.exe not from Zoom.s own site' }
$r = Recent 'ZoomInstaller.exe'
Check 'download-source-fake' ($ok -and $r.label -eq 'Possible fake installer' -and $r.reason -eq 'This says it is Zoom, but it came from zoom-download-free.site, not zoom.us. Get Zoom from zoom.us.') "from the look-alike: '$($r.label)' ($($r.badge)): $($r.reason)"
# The site itself, by the fast check on this computer: any program from a site Sentinel flags is flagged with it.
Arrive 'FreeVideoConverter.exe' 'https://paypa1-secure-login.com/download/FreeVideoConverter.exe' 'https://paypa1-secure-login.com/'
$ok = Until 90 { (AppLog) -match 'download source: FreeVideoConverter\.exe[^\r\n]*its site is flagged' }
$r = Recent 'FreeVideoConverter.exe'
Check 'download-source-site' ($ok -and $r.label -eq 'From a dangerous site' -and $r.badge -in @('orange', 'red') -and $r.reason -match '^This came from paypa1-secure-login\.com, which Sentinel flags: ') "from a listed scam site: '$($r.label)' ($($r.badge)): $($r.reason)"
Check 'download-source-private' (-not ((AppLog) -match 'download source:[^\r\n]*(https?:|zoom-download-free|cdn\.zoom|paypa1)')) 'app.log names the file, never where it came from'

# 5. Tech-support scam shield: the real AnyDesk, downloaded and started.
$dl = Join-Path $env:USERPROFILE 'Downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
$anydesk = Join-Path $dl 'AnyDesk.exe'
try { Invoke-WebRequest 'https://download.anydesk.com/AnyDesk.exe' -OutFile $anydesk -UseBasicParsing -TimeoutSec 120; Say "AnyDesk downloaded: $((Get-Item $anydesk).Length) bytes" } catch { Say "AnyDesk could not be downloaded: $_" }
if (Test-Path $anydesk) {
  Check 'remote-download-scanned' (Until 90 { (AppLog) -match 'download scanned: AnyDesk\.exe' }) 'app.log: download scanned: AnyDesk.exe'
  Start-Process $anydesk
  $ok = Until 60 { (AppLog) -match 'tech-support scam shield: AnyDesk started' }
  Start-Sleep 3; Shot 'anydesk'
  Check 'remote-noticed' $ok "app.log: $(([regex]::Match((AppLog), 'tech-support scam shield: AnyDesk started[^\r\n]*')).Value)"
  $g = (Cdp 'guard.html' 'location.search + document.body.innerText.slice(0, 160)').value
  Check 'remote-question' ($g -match 'mode=remote') "the shield's window: $g"
  # The neutral way out comes before "End the connection"; trusting is a quiet link, and only a second step.
  $b = (Cdp 'guard.html' "[...document.querySelectorAll('#row button')].map((x) => x.textContent).join('|')").value
  Check 'remote-buttons' ($b -eq 'I use AnyDesk myself|Not now|End the connection') "buttons, left to right: $b"
  # The shield's window opens softly: the mask springs in and the words settle after it.
  $n = @(90, 220, 900 | ForEach-Object { Frame 'guard.html' '1' $_ "motion-guard-$($_)ms" })
  Check 'motion-guard' (($n | Measure-Object -Minimum).Minimum -gt 0) "animations paused mid-spring in the shield's window, per frame: $($n -join ', ')"
  # Under a parent lock, "I use it myself" needs the PIN.
  [void](Info "lockSet('2468')")
  [void](Press 'I use AnyDesk myself'); Start-Sleep 1
  $t = (Cdp 'guard.html' "document.getElementById('lead').textContent").value
  Check 'remote-trust-second-step' ($t -match '^Only if nobody asked you to install it') "the second step: $t"
  [void](Press 'Yes, stop asking'); Start-Sleep 2
  $t = (Cdp 'guard.html' "document.getElementById('title').textContent").value
  $trusted = @((Info 'info()').remoteGuard.trusted).Count
  Check 'remote-trust-locked' ($t -eq 'Parent lock is on' -and $trusted -eq 0) "with the lock on: '$t', programs trusted: $trusted"
  [void](Info "lockUnlock('2468')"); [void](Info 'lockRemove()')
  [void](Press 'Back'); Start-Sleep 1
  # "End the connection", checked afterwards against what is really running, then the recovery guide.
  [void](Press 'End the connection')
  $ok = Until 30 { (Cdp 'guard.html' "document.getElementById('title').textContent").value -eq 'What to do now' }
  Check 'remote-ended' ($ok -and -not (Get-Process AnyDesk -ErrorAction SilentlyContinue) -and (AppLog) -match 'ending AnyDesk at the person.s request worked') "AnyDesk ended: $((Get-Process AnyDesk -ErrorAction SilentlyContinue | Measure-Object).Count) left"
  Shot 'anydesk-ended'
  [void](Press 'Open the recovery guide')
  $u = ''
  # Signed in, the guide inside the app; signed out (as on this runner), the website's, which needs no account.
  $ok = Until 30 { $script:u = (Cdp '127.0.0.1:4782' 'location.pathname + location.search').value; $script:u -match '^(/app)?/recover\?happened=remote$' }
  Check 'remote-recovery-guide' $ok "the app shows: $u"
  Get-Process AnyDesk -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} else { Check 'remote-noticed' $false 'AnyDesk could not be downloaded on this runner' }

# 5a. A connection in a remote-control program that was already running (as an installed one always is). Stand-ins:
# copies of ping.exe named like TeamViewer's and AnyDesk's programs, and a line added to AnyDesk's connection log.
$ping = "$env:WINDIR\System32\PING.EXE"
$standin = Join-Path $env:TEMP 'remote-standins'; New-Item -ItemType Directory -Force $standin | Out-Null
Copy-Item $ping (Join-Path $dl 'TeamViewer.exe')
[void](Until 90 { (AppLog) -match 'download scanned: TeamViewer\.exe' })
$tv = Start-Process (Join-Path $dl 'TeamViewer.exe') -ArgumentList '-n', '900', '127.0.0.1' -WindowStyle Hidden -PassThru
$ok = Until 60 { (AppLog) -match 'tech-support scam shield: TeamViewer started' }
Check 'session-start-first' $ok 'TeamViewer (a stand-in) started: asked about the start'
[void](Press 'Not now'); Start-Sleep 5
Copy-Item $ping (Join-Path $standin 'TeamViewer_Desktop.exe')
$tvd = Start-Process (Join-Path $standin 'TeamViewer_Desktop.exe') -ArgumentList '-n', '900', '127.0.0.1' -WindowStyle Hidden -PassThru
$ok = Until 60 { (AppLog) -match 'tech-support scam shield: someone connected to TeamViewer' }
# The shield's window changes its question a moment after the log line.
$t = ''
[void](Until 15 { $script:t = (Cdp 'guard.html' "document.getElementById('title').textContent").value; $script:t -match 'ask to connect to this computer' })
Check 'session-process' ($ok -and $t -match 'ask to connect to this computer') "TeamViewer's connection program appeared while it ran: logged ($ok), the shield asks: '$t'"
[void](Press 'Not now')
foreach ($p in @($tv, $tvd)) { if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
Copy-Item $ping (Join-Path $standin 'AnyDesk.exe')
$ad = Start-Process (Join-Path $standin 'AnyDesk.exe') -ArgumentList '-n', '900', '127.0.0.1' -WindowStyle Hidden -PassThru
[void](Until 60 { ([regex]::Matches((AppLog), 'tech-support scam shield: AnyDesk started')).Count -ge 2 })
[void](Press 'Not now'); Start-Sleep 20
New-Item -ItemType Directory -Force "$env:APPDATA\AnyDesk" | Out-Null
Add-Content "$env:APPDATA\AnyDesk\connection_trace.txt" 'Incoming    2026-10-07, 12:00    User    123456789    123456789'
$ok = Until 60 { (AppLog) -match 'tech-support scam shield: someone connected to AnyDesk' }
Check 'session-trace' $ok 'AnyDesk (a stand-in) kept running and its connection log changed: the shield asks'
[void](Press 'Not now')
if ($ad) { Stop-Process -Id $ad.Id -Force -ErrorAction SilentlyContinue }

# 5b. A page shaped like a fake virus alert, full screen in Edge, on an address that reads like one.
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 defender-virusalert-helpline.test"
Say "Edge in front: $(FreshEdge 'http://defender-virusalert-helpline.test:47910/alert.html')"
[K]::Tap(0x7A)   # F11: full screen
$ok = Until 45 { [K]::Tap(0x11); (AppLog) -match 'flagged page took the whole screen' }
Shot 'escape'
$verdict = (Get-Content "$data\logs\watch.log" -ErrorAction SilentlyContinue | Select-String 'defender-virusalert' | Select-Object -Last 1)
Say "live scanning's verdict: $verdict"
Check 'escape-offered' $ok 'app.log: a flagged page took the whole screen; offered a way out'
# When no way out is offered: what Sentinel knows of the page and its windows.
if (-not $ok) {
  $d = (Cdp 'main' "(() => { const m = process.mainModule; const e = m.require('electron'); const o = m.require('./overlay'); const s = m.require('./watch').status(); const ws = e.BrowserWindow.getAllWindows().map((w) => w.webContents.getURL().split('/').pop().split('?')[0] + ' ' + JSON.stringify(w.getBounds()) + ' ' + w.isVisible()); return JSON.stringify({ full: o.isFullscreen(), window: s.window, current: s.current && { badge: s.current.badge, support: s.current.support }, display: e.screen.getPrimaryDisplay().bounds, ws }); })()")
  Say "  diag: $($d.value)$($d.error)"
  Get-Content "$data\logs\watch.log" -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag watch.log: $_" }
}
$g = (Cdp 'guard.html' "location.search + '|' + document.hasFocus() + '|' + document.body.getAttribute('role') + '|' + document.getElementById('title').textContent").value
Check 'escape-window' ($g -match 'mode=escape') "the shield's window: $g"
Check 'escape-words' ($g -match 'support=1' -and $g -match 'trying to scare you') 'a fake virus alert gets the scare-page words'
# The page holds the keyboard; the way out takes it, so Tab and Escape reach it. Escape is "Not now".
Check 'escape-focus' ($g -match '\|true\|alertdialog\|') 'the way out has the keyboard, as an alert dialog'
# Which window has the keyboard, and what the shield's page heard.
$fg = 0; [void][K]::GetWindowThreadProcessId([K]::GetForegroundWindow(), [ref]$fg)
Say "in front before Escape: $((Get-Process -Id $fg -ErrorAction SilentlyContinue).ProcessName)"
[void](Cdp 'guard.html' "(() => { window.heard = []; document.addEventListener('keydown', (e) => window.heard.push(e.key), true); return 1; })()")
[K]::Tap(0x1B)
Start-Sleep 1
[void](Cdp 'guard.html' 'String(window.heard)')
Check 'escape-key' (Until 10 { [string](Cdp 'guard.html' '1').error -match 'no window' }) 'Escape closed it without doing anything'
[K]::Tap(0x7A)
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 5c. Any other flagged page in full screen (a video, say) gets plain words, not "fake virus alert".
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 paypal-account-verify-login.test"
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', 'http://paypal-account-verify-login.test:47910/plain.html')"
[K]::Tap(0x7A)
$ok = Until 45 { [K]::Tap(0x11); ([regex]::Matches((AppLog), 'flagged page took the whole screen')).Count -ge 2 }
Shot 'escape-neutral'
$g = (Cdp 'guard.html' "location.search + '|' + document.body.innerText").value
Check 'escape-neutral' ($ok -and $g -match 'mode=escape' -and $g -notmatch 'support=1' -and $g -match 'A flagged page fills the screen' -and $g -notmatch 'virus alert|no real company') "the shield's window: $(([string]$g).Substring(0, [Math]::Min(200, ([string]$g).Length)))"
[K]::Tap(0x1B); Start-Sleep 1
[K]::Tap(0x7A)
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 5c2. "Did you type anything?": 5c's look-alike again, now a sign-in page with a password box (scripts/e2e-chat/signin.html,
# a harmless stand-in), then Edge closed. One calm question asks whether a password was typed there; Yes opens the
# recovery guide with the password ticked. Asked once per site, and the logs never say which.
function BoxLines { return ([regex]::Matches((Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) + '', 'typed check: the flagged page has a password box')).Count }
function AskLines { return ([regex]::Matches((AppLog), 'typed check: a flagged page with a password box was closed; asking once')).Count }
function CloseEdge { Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [void]$_.CloseMainWindow() } }
$boxes = BoxLines; $asks = AskLines
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', 'http://paypal-account-verify-login.test:47910/signin.html')"
$ok = Until 60 { [K]::Tap(0x11); (BoxLines) -gt $boxes }
Say "live scanning's verdict: $(Get-Content "$data\logs\watch.log" -ErrorAction SilentlyContinue | Select-String 'paypal-account-verify-login\.test:47910/signin' | Select-Object -Last 1)"
Check 'typed-box-seen' $ok 'watch.log: the flagged page has a password box'
if (-not $ok) { Get-Content "$data\logs\watch.log" -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag watch.log: $_" } }
# The warning on this PayPal look-alike leads to the real paypal.com (brands.js), not to anything made from the page.
$pb = ''
[void](Until 20 { $script:pb = [string](Cdp 'warn.html' "document.getElementById('real').textContent").value; $script:pb -ne '' })
Check 'real-site-brand' ($pb -eq 'Go to the real paypal.com') "the warning on a PayPal look-alike offers: '$pb'"
[void](Cdp 'warn.html' 'window.close(), 1')
CloseEdge
$asked = Until 30 { (AskLines) -gt $asks }
$q = ''
$shown = $asked -and (Until 20 { $script:q = [string](Cdp 'guard.html' "location.search + '|' + document.getElementById('title').textContent + '|' + document.body.innerText").value; $script:q -match 'mode=typed' })
Shot 'typed-question'
Check 'typed-asked' ($asked -and $shown -and $q -match 'happened=password' -and $q -match '\|Did you type a password on that page\?\|') "Edge closed on the flagged sign-in page: $(([string]$q).Substring(0, [Math]::Min(300, ([string]$q).Length)) -replace '\s+', ' ')"
Check 'typed-calm-words' ($q -match 'Sentinel never sees what you type' -and $q -notmatch [char]0x2014) 'it says nothing typed is seen, in plain words'
$pressed = $shown -and (Press 'Yes, I did')
$guide = ''
$opened = $pressed -and (Until 30 { $script:guide = [string](Cdp '127.0.0.1:4782' "location.pathname + location.search + '|' + Boolean((document.querySelector('[data-recover-picks] input[value=password]') || {}).checked)").value; $script:guide -match 'recover\?happened=password\|true$' })
Shot 'typed-recover'
Check 'typed-yes-recover' $opened "Yes opened the recovery guide with the password ticked: $guide"
Check 'typed-question-gone' (Until 10 { [string](Cdp 'guard.html' '1').error -match 'no window' }) 'the question closed after Yes'
# The same site again, closed again: not asked twice.
$boxes = BoxLines; $asks = AskLines
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', 'http://paypal-account-verify-login.test:47910/signin.html')"
$seenAgain = Until 60 { [K]::Tap(0x11); (BoxLines) -gt $boxes }
[void](Cdp 'warn.html' 'window.close(), 1')
CloseEdge
Start-Sleep 20
Check 'typed-once' ($seenAgain -and (AskLines) -eq $asks -and [string](Cdp 'guard.html' '1').error -match 'no window') "the box seen again: $seenAgain; asked again: $((AskLines) -ne $asks)"
Check 'typed-log-private' (-not ((AppLog) + (Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) -match 'typed check:[^\r\n]*(\.test|https?:)')) 'the logs say a box was seen and a question asked, never where'
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 5d. Your sites: a small credit union's site added (the call Live protection's form makes), then in Edge the real site
# and an address made to look like it, both mapped to a harmless local page. The real one is left alone, the copy is
# called what it is.
$r = Info "addMySite('harbourcu.test')"
Check 'my-sites-add' ((@($r) | ForEach-Object { $_.host }) -contains 'harbourcu.test') "the list: $($r | ConvertTo-Json -Compress)"
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 harbourcu.test`r`n127.0.0.1 harbourcu-secure-login.test"
function WatchLine($pattern) { return [string](Get-Content "$data\logs\watch.log" -ErrorAction SilentlyContinue | Select-String $pattern | Select-Object -Last 1) }
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', 'http://harbourcu.test:47910/plain.html')"
$ok = Until 45 { [bool](WatchLine 'msedge \S+ .* http://harbourcu\.test:47910/') }
$real = WatchLine 'msedge \S+ .* http://harbourcu\.test:47910/'
Check 'my-sites-real-site' ($ok -and $real -notmatch ' (orange|red) ') "the real site: $real"
# A fresh Edge, as in 5c: a tab added to a window already open is not always reported as a new page.
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', 'http://harbourcu-secure-login.test:47910/plain.html')"
$ok = Until 45 { [bool](WatchLine 'msedge (orange|red) .* http://harbourcu-secure-login\.test:47910/') }
Say "the copy: $(WatchLine 'harbourcu-secure-login\.test:47910/')"
$w = ''
$ok = $ok -and (Until 30 { $script:w = [string](Cdp 'warn.html' "document.body.innerText").value; $script:w -match 'This is not harbourcu\.test\. You usually go to harbourcu\.test' })
Shot 'my-sites-warning'
Check 'my-sites-lookalike' $ok "the warning: $($w.Substring(0, [Math]::Min(300, $w.Length)) -replace '\s+', ' ')"
# Warnings that lead to the real site: the warning offers the person's own site, and pressing it opens exactly that
# address, kept by the app when the warning was made. The browser's opening is stood in for in the main process, so
# nothing else comes to the front; the log says that it was opened, never which.
$rb = [string](Cdp 'warn.html' "(document.getElementById('realRow').hidden ? 'hidden' : 'shown') + '|' + document.getElementById('real').textContent").value
Check 'real-site-offered' ($rb -eq 'shown|Go to the real harbourcu.test') "the warning's button: $rb"
$stub = (Cdp 'main' "(() => { const s = process.mainModule.require('electron').shell; global.e2eOpened = []; global.e2eOpen = s.openExternal; s.openExternal = (u) => { global.e2eOpened.push(String(u)); return Promise.resolve(); }; return s.openExternal !== global.e2eOpen; })()").value
[void](Cdp 'warn.html' "document.getElementById('real').click(), 1")
$opened = ''
[void](Until 15 { $script:opened = [string](Cdp 'main' 'JSON.stringify(global.e2eOpened)').value; $script:opened -ne '[]' })
[void](Cdp 'main' "(() => { if (global.e2eOpen) process.mainModule.require('electron').shell.openExternal = global.e2eOpen; return 1; })()")
Check 'real-site-opens' ($stub -and $opened -eq '["https://harbourcu.test/"]' -and (AppLog) -match 'warning: opened the real site' -and (AppLog) -notmatch 'opened the real site[^\r\n]*harbourcu') "stood in: $stub; opened: $opened"
Check 'real-site-closes' (Until 10 { [string](Cdp 'warn.html' '1').error -match 'no window' }) 'the warning closed after the button'
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 5e. Before you pay: a shop's checkout. A young shop (registered 3 weeks ago) gets a calm card beside the page, found
# by its address (/checkout/) and, on another page, by its title alone; a shop registered years ago gets nothing. Both
# shops are harmless local pages behind a hosts mapping. Their ages are put where an earlier lookup would have left
# them (scripts/e2e-pay.js): live scanning here is fast, and fast looks nothing up.
Say (node (Join-Path $PSScriptRoot 'e2e-pay.js') "$data\sentinel.db")
# 5d's warning is still open: out of the way, so the photographs show the card.
[void](Cdp 'warn.html' 'window.close(), 1')
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 youngshop.test`r`n127.0.0.1 oldshop.test"
function PayCard { return [string](Cdp 'overlay.html' "(document.getElementById('pay').classList.contains('is-on') ? 'on|' : 'off|') + document.getElementById('payText').textContent").value }
function PayLog { return ([regex]::Matches((Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) + '', 'before you pay: shown')).Count }
function Shop($url) {
  Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', $url)"
  [void][K]::SetCursorPos(400, 500)
}
$c = ''
$before = PayLog
Shop 'http://youngshop.test:47910/checkout/'
$ok = Until 45 { [K]::Tap(0x11); $script:c = PayCard; $script:c -match '^on\|This shop.s address was registered 3 weeks ago\. Pay with a credit card or PayPal, not a bank transfer, gift card or crypto' }
Shot 'pay-young-shop'
Check 'pay-young-checkout' ($ok -and (PayLog) -gt $before) "a young shop's /checkout/: the card '$c', watch.log says shown: $((PayLog) -gt $before)"
if (-not $ok) { Say "  diag: $(WatchLine 'youngshop\.test')"; Get-Content "$data\logs\watch.log" -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag watch.log: $_" } }
$before = PayLog
Shop 'http://youngshop.test:47910/order.html'
$ok = Until 45 { [K]::Tap(0x11); $script:c = PayCard; $script:c -match '^on\|This shop.s address was registered 3 weeks ago' }
Check 'pay-young-by-title' ($ok -and (PayLog) -gt $before) "a young shop's page titled Secure Checkout (an address that says nothing): the card '$c'"
$before = PayLog
Shop 'http://oldshop.test:47910/checkout/'
$ok = Until 45 { [bool](WatchLine 'msedge \S+ .* http://oldshop\.test:47910/checkout/') }
Start-Sleep 5
$c = PayCard
Shot 'pay-old-shop'
Check 'pay-old-shop-nothing' ($ok -and $c -match '^off\|' -and (PayLog) -eq $before) "a shop registered 9 years ago: checked $ok, the card '$c', shown again: $((PayLog) -ne $before)"
Check 'pay-log-private' (-not ((Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) -match 'before you pay:[^\r\n]*(\.test|https?:)')) 'watch.log says the card was shown, never where'
# 5e2. Pay pause: 1b's gift card page again, now that Sentinel warned about pages and chat messages in the last hour.
# The shield's window says the one thing, without taking the keyboard from the browser; "I am buying this for myself"
# closes it, and the same site does not get it twice. Then a crypto ATM locator on another site, just after the call
# check said "Hang up" (the call the app's call page makes through its bridge): the pause names that sign.
$before = PauseLines 'a gift card page, after'
Say "Edge in front: $(FreshEdge 'http://giftshop.test:47910/gift-cards/')"
$ok = Until 45 { [K]::Tap(0x11); (PauseLines 'a gift card page, after') -gt $before }
$q = ''
$shown = $ok -and (Until 20 { $script:q = [string](Cdp 'guard.html' "location.search + '|' + document.body.innerText").value; $script:q -match 'mode=pause' })
Start-Sleep 1
Shot 'pay-pause-gift'
Say "  app.log: $(([regex]::Matches((AppLog), 'pay pause: [^\r\n]*') | ForEach-Object { $_.Value }) -join ' / ')"
Check 'pay-pause-shown' ($shown -and $q -match 'No real company, government office or bank asks to be paid in gift cards or crypto\.' -and $q -match 'Buying gift cards' -and $q -match 'call your bank on the number on the back of your card' -and $q -match 'in the last hour' -and $q -notmatch [char]0x2014) "the shield's window: $(([string]$q).Substring(0, [Math]::Min(500, ([string]$q).Length)) -replace '\s+', ' ')"
$b = (Cdp 'guard.html' "[...document.querySelectorAll('#row button')].map((x) => x.textContent).join('|')").value
Check 'pay-pause-one-button' ($b -eq 'I am buying this for myself') "buttons: $b"
$fg = 0; [void][K]::GetWindowThreadProcessId([K]::GetForegroundWindow(), [ref]$fg)
$front = (Get-Process -Id $fg -ErrorAction SilentlyContinue).ProcessName
Check 'pay-pause-no-block' ($front -eq 'msedge') "in front while the pause shows: $front"
[void](Press 'I am buying this for myself')
Check 'pay-pause-closed' (Until 10 { [string](Cdp 'guard.html' '1').error -match 'no window' }) '"I am buying this for myself" closed it'
$again = PauseLines 'a gift card page, already shown for this site'
Say "Edge in front: $(FreshEdge 'http://giftshop.test:47910/gift-cards/')"
$ok = Until 45 { [K]::Tap(0x11); (PauseLines 'a gift card page, already shown for this site') -gt $again }
Start-Sleep 3
Check 'pay-pause-once' ($ok -and [string](Cdp 'guard.html' '1').error -match 'no window') "the same site again: noticed $ok, and no window"
[void](Info 'callHangUp()')
$before = PauseLines 'a crypto page, after the call check said hang up; shown'
Say "Edge in front: $(FreshEdge 'http://coinshop.test:47910/bitcoin-atm/')"
$ok = Until 45 { [K]::Tap(0x11); (PauseLines 'a crypto page, after the call check said hang up; shown') -gt $before }
$q = ''
$shown = $ok -and (Until 20 { $script:q = [string](Cdp 'guard.html' "location.search + '|' + document.body.innerText").value; $script:q -match 'mode=pause' })
Start-Sleep 1
Shot 'pay-pause-crypto'
Check 'pay-pause-crypto-call' ($shown -and $q -match 'Sending crypto' -and $q -match 'the call check said to hang up in the last hour') "a crypto ATM locator after Hang up: $(([string]$q).Substring(0, [Math]::Min(500, ([string]$q).Length)) -replace '\s+', ' ')"
[void](Press 'I am buying this for myself')
[void](Until 10 { [string](Cdp 'guard.html' '1').error -match 'no window' })
# A wallet whose address says nothing (/home.html) and whose title says "Send Bitcoin": known by the window's title.
$before = PauseLines 'a crypto page, after the call check said hang up; shown'
Say "Edge in front: $(FreshEdge 'http://walletapp.test:47910/home.html')"
$ok = Until 45 { [K]::Tap(0x11); (PauseLines 'a crypto page, after the call check said hang up; shown') -gt $before }
$q = ''
$shown = $ok -and (Until 20 { $script:q = [string](Cdp 'guard.html' "location.search + '|' + document.body.innerText").value; $script:q -match 'mode=pause' })
Start-Sleep 1
Shot 'pay-pause-by-title'
Check 'pay-pause-by-title' ($shown -and $q -match 'Sending crypto') "a page titled Send Bitcoin at /home.html: noticed $ok, $(([string]$q).Substring(0, [Math]::Min(300, ([string]$q).Length)) -replace '\s+', ' ')"
[void](Press 'I am buying this for myself')
Check 'pay-pause-log-private' (-not ((AppLog) -match 'pay pause:[^\r\n]*(\.test|https?:)')) 'app.log says which kind of page and sign, never where'
# 5f. Your week: what sections 2 to 5e did reaches the week, as numbers only. The app counts chat messages, the stopped
# command, the wallet swap and AnyDesk's download on this computer and hands them over (week() hands them over at once);
# live scanning's pages and the look-alike of 5d are counted by the scanner. Asked before section 6 ends the app.
$cs = (Info 'info()')
$seenChat = $cs.chatSafety.seen.discord.checked + $cs.chatSafety.seen.roblox.checked + $cs.textSafety.seen.checked
$w = Info 'week()'
$c = $w.weeks[-1].counts
Say "  your week: $($c | ConvertTo-Json -Compress) caught $($w.weeks[-1].caught): $($w.weeks[-1].headline) / $($w.weeks[-1].biggest)"
Check 'week-app-counts' ($c.commands_stopped -ge 1 -and $c.wallet_swaps -ge 1 -and $c.files_checked -ge 1 -and $c.chat_checked -ge $seenChat -and $c.chat_flagged -ge 3) "stopped $($c.commands_stopped), wallet swaps $($c.wallet_swaps), files checked $($c.files_checked), chat checked $($c.chat_checked) (the app saw $seenChat) and flagged $($c.chat_flagged)"
Check 'week-live-counts' ($c.live_links -ge 3 -and $c.live_flagged -ge 2 -and $c.lookalikes -ge 1) "live links $($c.live_links), flagged $($c.live_flagged), look-alikes $($c.lookalikes)"
Check 'week-biggest' ($w.weeks[-1].biggest -match 'wallet address') "biggest catch: $($w.weeks[-1].biggest)"
Check 'week-numbers-only' (-not (($w | ConvertTo-Json -Depth 6) -match 'AnyDesk|1A1zP1|harbourcu|powershell|https?:')) 'the week holds no file, address, command or link'
# 5g. Check something on screen: the shortcut (Windows key + Alt + S) over Edge showing a scam text with a link and a
# callback number, and a QR code to a listed scam (made here with another encoder, as verify-web's codes are). A box
# is drawn over them with the mouse, and the verdict card names all three. Then the shortcut again, and Escape.
python -m pip install --quiet --disable-pip-version-check qrcode pillow 2>&1 | Out-Null
python -c "import qrcode, sys; qrcode.make(sys.argv[1], box_size=6, border=4).save(sys.argv[2])" 'https://paypa1-secure-login.com/account' (Join-Path $PSScriptRoot 'e2e-chat\snip-qr.png')
Say "QR code made: $(Test-Path (Join-Path $PSScriptRoot 'e2e-chat\snip-qr.png'))"
function SnipKey { [K]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); [K]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [K]::Tap(0x53); [K]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero); [K]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero) }
function SnipGone { return [string](Cdp 'snip.html' '1').error -match 'no window' }
function SnipLines { return ([regex]::Matches((AppLog), 'check on screen: ')).Count }
$s = (Info 'info()').snip
Check 'snip-shortcut' ($s.enabled -and $s.registered -and $s.key -eq 'Super+Alt+S') "on by default, its shortcut registered: $($s | ConvertTo-Json -Compress -Depth 3)"
# Nothing else over the page: 5d's warning is put away, and a fresh Edge profile offers no "Restore pages".
[void](Cdp 'warn.html' "window.sentinelDesktop.warnAction('close'), 1")
# 5e's shop is still open in another Edge, and Front would pick it: FreshEdge closes it first.
Say "Edge in front: $(FreshEdge '--no-first-run', '--no-default-browser-check', '--start-maximized', "--user-data-dir=$env:RUNNER_TEMP\snip-profile", 'http://127.0.0.1:47910/snip.html')"
Start-Sleep 2
# Where the page is on screen, as Windows describes it to screen readers.
$A = [Windows.Automation.AutomationElement]
$doc = $A::FromHandle([K]::GetForegroundWindow()).FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Document)))
$at = $(if ($doc) { $doc.Current.BoundingRectangle } else { $null })
Say "the page on screen: $at"
SnipKey
$open = Until 20 { (Cdp 'snip.html' 'document.readyState').value -eq 'complete' }
Start-Sleep 1
Shot 'snip-sheet'
Check 'snip-opens' $open 'the shortcut opened the sheet over the screen'
if (-not $open) { (AppLog) -split "`n" | Select-String 'check on screen' | Select-Object -Last 5 | ForEach-Object { Say "  diag app.log: $_" } }
if ($open -and $at) {
  $x1 = [int]$at.X + 8; $y1 = [int]$at.Y + 8
  $x2 = [int]([Math]::Min($at.X + 740, $at.X + $at.Width - 10)); $y2 = [int]([Math]::Min($at.Y + 300, $at.Y + $at.Height - 10))
  [void][K]::SetCursorPos($x1, $y1); Start-Sleep -Milliseconds 300
  [K]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  for ($i = 1; $i -le 12; $i++) { [void][K]::SetCursorPos([int]($x1 + ($x2 - $x1) * $i / 12), [int]($y1 + ($y2 - $y1) * $i / 12)); Start-Sleep -Milliseconds 40 }
  [K]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Say "box drawn from $x1,$y1 to $x2,$y2"
  $card = ''
  $ok = Until 60 { $script:card = [string](Cdp 'snip.html' "(() => { const c = document.getElementById('card'); return c.dataset.level + '|' + c.dataset.pending + '|' + c.innerText.replace(/\s+/g, ' '); })()").value; $script:card -match '^danger\|\|' }
  Start-Sleep 1
  Shot 'snip-verdict'
  Check 'snip-verdict' $ok "the card: $($card.Substring(0, [Math]::Min(600, $card.Length)))"
  Check 'snip-finds-message' ($card -match 'This message (looks like|may be) a scam') 'the text itself is judged a scam'
  Check 'snip-finds-qr' ($card -match 'The QR code leads to a dangerous site: paypa1-secure-login\.com') 'the QR code was read and its link checked'
  Check 'snip-finds-phone' ($card -match 'A number to call back: [^|]*876') 'the callback number is named'
  # Only the screen check's own lines: 5d's download from the same look-alike site is logged by name, as it should be.
  $snipLog = ((AppLog) -split "`n" | Select-String 'check on screen') -join ' / '
  Check 'snip-log-private' ($snipLog -and $snipLog -notmatch 'redeliver|paypa1|555-0142') "app.log says only that a check happened: $snipLog"
  [K]::Tap(0x1B)
  Check 'snip-escape-card' (Until 10 { SnipGone }) 'Escape put the verdict away'
} else { Check 'snip-verdict' $false 'no sheet, or the page was not found on screen' }
# Escape before a box is drawn: nothing is read.
$lines = SnipLines
SnipKey
$open = Until 20 { (Cdp 'snip.html' 'document.readyState').value -eq 'complete' }
Start-Sleep 1
[K]::Tap(0x1B)
Check 'snip-escape' ($open -and (Until 10 { SnipGone }) -and (SnipLines) -eq $lines) "opened: $open; Escape closed it and nothing was read"
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 6. Parent lock, through the app's own window (the same calls its Parent lock panel makes).
$r = Info "lockSet('2468')"
Check 'lock-set' ($r.set -and $r.locked) "set with a PIN: $($r | ConvertTo-Json -Compress)"
$r = Cdp '127.0.0.1:4782' 'window.sentinelDesktop.setChatSafety(false)'
Check 'lock-refuses' ($r.error -match 'Locked by a parent') "chat safety off without the PIN: $($r.error)"
Check 'lock-kept-on' ((Info 'info()').chatSafety.enabled -eq $true) 'chat safety is still on'
$r = Cdp '127.0.0.1:4782' 'window.sentinelDesktop.setWalletGuard(false)'
Check 'lock-wallet-guard' ($r.error -match 'Locked by a parent' -and (Info 'info()').walletGuard -eq $true) "wallet guard off without the PIN: $($r.error)"
$r = Cdp '127.0.0.1:4782' "window.sentinelDesktop.lockUnlock('1357')"
Check 'lock-wrong-pin' ($r.error -match 'Wrong PIN') "a wrong PIN: $($r.error)"
$r = Info "lockUnlock('2468')"
Check 'lock-unlock' ($r.set -and -not $r.locked) 'the right PIN opens it'
Check 'lock-record' (($r.record | ForEach-Object { $_.text }) -contains 'Tried to switch chat safety off without the PIN') "record: $(($r.record | ForEach-Object { $_.text }) -join '; ')"
$r = Info 'setChatSafety(false)'
Check 'lock-open-switch' ($r.enabled -eq $false) 'chat safety off with the lock open'
[void](Info 'setChatSafety(true)')
[void](Info 'lockRelock()')
# Ended from Task Manager while locked: the parent's record says so at the next start.
Start-Sleep 2
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue; Start-Sleep 3
[void](StartSentinel); Start-Sleep 10
$r = Info "lockUnlock('2468')"
Check 'lock-stopped-without-pin' (($r.record | ForEach-Object { $_.text }) -match 'stopped without the PIN') "record after being ended: $(($r.record | ForEach-Object { $_.text }) -join '; ')"
# The parent lock from section 6 comes off first: pairing another account would need its PIN.
[void](Info "lockUnlock('2468')"); [void](Info 'lockRemove()')

# 7. The browser checkup and "Check my texts", as the app's own pages show them, signed in to this computer's
# account. A Vivaldi profile laid out as Vivaldi keeps it: three add-ons from the store, and one loaded from a folder
# that can read every site and its cookies. The flagged one is listed; the three clean ones fold behind one line.
$viv = "$env:LOCALAPPDATA\Vivaldi\User Data\Default"
New-Item -ItemType Directory -Force $viv | Out-Null
[IO.File]::WriteAllText("$viv\Preferences", '{"profile":{"name":"Checkup e2e"}}')
$crx = 'https://clients2.google.com/service/update2/crx'
$addons = @{
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa = @{ location = 1; manifest = @{ name = 'Dark Reader E2E'; version = '1'; update_url = $crx; permissions = @('storage') } }
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb = @{ location = 1; manifest = @{ name = 'Tab Notes E2E'; version = '1'; update_url = $crx; permissions = @('storage') } }
  cccccccccccccccccccccccccccccccc = @{ location = 1; manifest = @{ name = 'Word Count E2E'; version = '1'; update_url = $crx; permissions = @('storage') } }
  dddddddddddddddddddddddddddddddd = @{ location = 4; path = "$env:RUNNER_TEMP\coupon-e2e"; manifest = @{ name = 'Coupon Helper E2E'; version = '1'; permissions = @('cookies'); host_permissions = @('<all_urls>') } }
}
[IO.File]::WriteAllText("$viv\Secure Preferences", (@{ extensions = @{ settings = $addons } } | ConvertTo-Json -Depth 8 -Compress))
$r = Cdp '127.0.0.1:4782' "(async () => { const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.status); const a = { email: 'checkup-e2e@example.com', password: 'Checkup-Sentinel-2026!' }; return [await post('/api/v1/auth/signup', Object.assign({ firstName: 'Alex', ageConfirmed: true, termsAccepted: true }, a)), await post('/api/v1/auth/login', a)].join(','); })()"
Check 'app-signed-in' ($r.value -match ',200$') "sign-up, sign-in: $($r.value)"
[void](Cdp '127.0.0.1:4782' "(location.href = '/app/checkup', 1)")
$ok = Until 30 { (Cdp '127.0.0.1:4782' "(() => { const b = document.querySelector('[data-run-checkup]'); if (b) b.click(); return Boolean(b); })()").value -eq $true }
$c = ''
$ok = $ok -and (Until 90 { $script:c = (Cdp '127.0.0.1:4782' "(() => { const p = [...document.querySelectorAll('[data-checkup-out] .panel')].find((x) => (x.querySelector('h2') || {}).textContent === 'Vivaldi'); if (!p) return ''; const d = p.querySelector('details[data-clean-addons]'); const names = (els) => [...els].map((b) => b.textContent).sort().join('/'); return [d ? d.querySelector('summary').textContent.trim() : 'no fold', d && d.open ? 'open' : 'closed', names([...p.querySelectorAll('ul.list b')].filter((b) => !b.closest('details'))), d ? names(d.querySelectorAll('b')) : '', /and you can add it back/.test(document.querySelector('[data-checkup-out]').textContent)].join('|'); })()").value; [bool]$script:c })
Shot 'checkup'
Check 'checkup-folds-clean-addons' ($ok -and $c -eq '3 more add-ons, nothing to look at|closed|Coupon Helper E2E|Dark Reader E2E/Tab Notes E2E/Word Count E2E|true') "Vivaldi: $c"
[void](Cdp '127.0.0.1:4782' "(location.href = '/app/protection', 1)")
$t = ''
$ok = Until 30 { $script:t = (Cdp '127.0.0.1:4782' "(document.getElementById('text-safety') || {}).textContent || ''").value; [bool]$script:t }
Check 'texts-english-only' ($ok -and $t -match 'English scam texts' -and $t -match 'English texts for now' -and $t -match 'left-to-right') "Check my texts panel: $(([string]$t).Substring(0, [Math]::Min(200, ([string]$t).Length)))"

# 4c, seen in the app (signed in since 7; the restart before it emptied the list): a Discord installer someone
# uploaded to a Discord chat arrives, and Recent downloads lists it as a fake, with the real site named.
# The account signed in for the checkup (above) is new, so download protection is off for it (a Pro feature): it is
# given Pro too, and download protection started again.
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
[void](Cdp 'main' "(process.mainModule.require('./downloads').restart(), 1)")
$ok = Until 30 { (Cdp 'main' "process.mainModule.require('./downloads').status().active").value -eq $true }
Say "download protection for the new account: $((Cdp 'main' "JSON.stringify(process.mainModule.require('./downloads').status())").value)"
Arrive 'DiscordSetup.exe' 'https://cdn.discordapp.com/attachments/1180000000000000000/1190000000000000000/DiscordSetup.exe' 'https://discord.com/channels/@me'
[void](Until 90 { (AppLog) -match 'download source: DiscordSetup\.exe not from Discord.s own site' })
[void](Cdp '127.0.0.1:4782' "(location.href = '/app/protection#downloads', 1)")
if (-not (Until 60 { (Cdp '127.0.0.1:4782' "(document.getElementById('downloads') || {}).textContent || ''").value -match 'Possible fake installer' })) {
  Say "  the app shows: $((Cdp '127.0.0.1:4782' "location.href + ' | ' + document.body.innerText.slice(0, 300)").value)"
}
[void](Cdp '127.0.0.1:4782' "(document.getElementById('downloads').scrollIntoView(), 1)"); Start-Sleep 1
Shot 'download-source'
$t = [string](Cdp '127.0.0.1:4782' "(document.getElementById('downloads') || {}).innerText || ''").value
Check 'download-source-listed' ($t -match 'Possible fake installer' -and $t -match 'This says it is Discord, but it came from cdn\.discordapp\.com, not discord\.com\. Get Discord from discord\.com\.') "Recent downloads: $(($t.Substring(0, [Math]::Min(300, $t.Length))) -replace '\s+', ' ')"

# 7b. Your sites, in Live protection: a site added with the form is listed as added by you (5d proves the warning).
$ok = Until 30 { (Cdp '127.0.0.1:4782' "Boolean(document.querySelector('[data-my-sites-add]'))").value -eq $true }
[void](Cdp '127.0.0.1:4782' "(() => { const f = document.querySelector('[data-my-sites-add]'); f.elements.host.value = 'harbourcu.test'; f.requestSubmit(); return 1; })()")
$s = ''
$ok = $ok -and (Until 30 { $script:s = [string](Cdp '127.0.0.1:4782' "(document.getElementById('my-sites') || {}).innerText || ''").value; $script:s -match 'harbourcu\.test\s+Added by you' })
[void](Cdp '127.0.0.1:4782' "(document.getElementById('my-sites').scrollIntoView(), 1)"); Start-Sleep 1
Shot 'my-sites'
Check 'my-sites-added' $ok "Your sites panel: $($s.Substring(0, [Math]::Min(300, $s.Length)) -replace '\s+', ' ')"

# 7c. "Scan with Sentinel" in the right-click menu for files: registered for this Windows user by the installed app,
# and its own command line, run as Explorer runs it on a harmless file, opens the file scan with the verdict.
$menuKey = 'HKCU:\Software\Classes\*\shell\SentinelScan'
$menuLabel = [string](Get-ItemProperty -LiteralPath $menuKey -ErrorAction SilentlyContinue).'(default)'
$menuCmd = [string](Get-ItemProperty -LiteralPath "$menuKey\command" -ErrorAction SilentlyContinue).'(default)'
Check 'menu-registered' ($menuLabel -eq 'Scan with Sentinel' -and $menuCmd -eq "`"$exe`" `"--scan-file=%1`"") "label '$menuLabel', command '$menuCmd'"
$menuFile = Join-Path $env:RUNNER_TEMP 'right click e2e\Shopping list.txt'
New-Item -ItemType Directory -Force (Split-Path $menuFile) | Out-Null
[IO.File]::WriteAllText($menuFile, "Milk`r`nBread`r`nApples`r`n")
if ($menuCmd -match '^"([^"]+)"\s+(.+)$') { Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2].Replace('%1', $menuFile) }
$v = ''
$ok = Until 60 { $script:v = [string](Cdp '127.0.0.1:4782' "location.pathname + '|' + ((document.querySelector('[data-out] [data-result]') || {}).innerText || '').replace(/\s+/g, ' ')").value; $script:v -match '^/app/threats\|.*Shopping list\.txt' }
Shot 'right-click-verdict'
Check 'menu-scan-verdict' $ok "the app shows: $($v.Substring(0, [Math]::Min(300, $v.Length)))"
Check 'menu-log-private' ((AppLog) -match 'right-click menu: a file was handed over' -and (AppLog) -notmatch 'Shopping list') 'app.log says a file was handed over, not which'
$r = Info 'setScanMenu(false)'
$off = -not (Test-Path -LiteralPath $menuKey)
$r = Info 'setScanMenu(true)'
Check 'menu-switch' ($off -and (Test-Path -LiteralPath "$menuKey\command") -and $r.enabled) "off took it out of the menu: $off; on put it back: $(Test-Path -LiteralPath "$menuKey\command")"

# 8. Signing out: it ends the session (and the window the checks drive), so it comes last.
[void](Info "lockSet('2468')"); [void](Info "lockUnlock('2468')")
$em = "e2e-lock-$(Get-Random)@example.com"
$r = Cdp '127.0.0.1:4782' "(async () => { const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.status); return (await post('/api/v1/auth/signup', { email: '$em', password: 'Quiet-river-lock-7Kq2', firstName: 'Ada', ageConfirmed: true, termsAccepted: true })) + ' ' + (await post('/api/v1/auth/login', { email: '$em', password: 'Quiet-river-lock-7Kq2' })); })()"
[void](Cdp '127.0.0.1:4782' "location.href = '/app'; 1")
$paired = Until 40 { [bool](Info 'info()').pairedUserId }
Check 'signout-paired' $paired "signed in to the web app and paired (signup and sign-in: $($r.value))"
[void](Info 'lockRelock()')
# The button answers only once the app has finished starting (a restarted scanner took 18 s once): it is pressed
# until it asks to be pressed again, then pressed again, and the answer is waited for.
$click = "(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); let b = null; for (let i = 0; i < 30; i++) { b = document.querySelector('[data-signout]'); if (b) { b.click(); await wait(300); if (b.getAttribute('aria-label') === 'Press again to sign out') break; } await wait(500); } b.click(); for (let i = 0; i < 20 && location.pathname.startsWith('/app') && !document.querySelector('.toast'); i++) await wait(500); return location.pathname + '|' + [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '); })()"
$r = (Cdp '127.0.0.1:4782' $click).value
$me = (Cdp '127.0.0.1:4782' "fetch('/api/v1/auth/me').then((x) => x.status)").value
Check 'signout-locked' ($r -match '^/app[^|]*\|.*Still signed in\. Locked by a parent' -and $me -eq 200 -and [bool](Info 'info()').pairedUserId) "locked: '$r', web app session $me"
[void](Info "lockUnlock('2468')")
[void](Cdp '127.0.0.1:4782' $click)
Check 'signout-open' (Until 20 { -not (Info 'info()').pairedUserId }) 'with the lock open, signing out goes through'
[void](Info 'lockRemove()')

if ($pages) { Stop-Process -Id $pages.Id -Force -ErrorAction SilentlyContinue }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 60 | ForEach-Object { Say "  $_" }
# 9. Uninstalling takes "Scan with Sentinel" out of the right-click menu. The uninstaller hands itself to a copy in
# the temp folder, so its end is waited for by the key going.
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue; Start-Sleep 3
Start-Process (Join-Path (Split-Path $exe) 'Uninstall Sentinel.exe') -ArgumentList '/S' -Wait
Check 'menu-uninstall' (Until 60 { -not (Test-Path -LiteralPath $menuKey) }) "the key after uninstall: $(Test-Path -LiteralPath $menuKey); Sentinel.exe left: $(Test-Path $exe)"
Say "checks failed: $failed"
exit [int]($failed -gt 0)
