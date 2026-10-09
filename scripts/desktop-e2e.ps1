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
function Press($label) { return (Cdp 'guard.html' "(() => { const b = [...document.querySelectorAll('#row button')].find((x) => x.textContent === '$label'); if (b) b.click(); return Boolean(b); })()").value }
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

# 2. Chat safety in "Discord": Chrome under the name Discord.exe, showing a page with Discord's message list.
$chromeDir = "$env:ProgramFiles\Google\Chrome\Application"
New-Item -ItemType HardLink -Path "$chromeDir\Discord.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
New-Item -ItemType HardLink -Path "$chromeDir\RobloxPlayerBeta.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
New-Item -ItemType HardLink -Path "$chromeDir\PhoneExperienceHost.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
function Fake($name, $page) {
  $fp = Start-Process "$chromeDir\$name.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\$name-profile", '--start-maximized', "--app=http://127.0.0.1:47910/$page" -PassThru
  Start-Sleep 8
  $r = Front $name
  if (-not $r) { FakeDiag $name $fp $page }
  return $r
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

# 4a. The live-scanning corner as an island, over Edge: the mask springs open into a card with the words, a new
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
$t = (Cdp 'guard.html' "document.getElementById('title').textContent").value
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
Start-Process msedge -ArgumentList 'http://defender-virusalert-helpline.test:47910/alert.html'
Start-Sleep 8
Say "Edge in front: $(Front 'msedge')"
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
Start-Process msedge -ArgumentList '--no-first-run', '--no-default-browser-check', 'http://paypal-account-verify-login.test:47910/plain.html'
Start-Sleep 8
Say "Edge in front: $(Front 'msedge')"
[K]::Tap(0x7A)
$ok = Until 45 { [K]::Tap(0x11); ([regex]::Matches((AppLog), 'flagged page took the whole screen')).Count -ge 2 }
Shot 'escape-neutral'
$g = (Cdp 'guard.html' "location.search + '|' + document.body.innerText").value
Check 'escape-neutral' ($ok -and $g -match 'mode=escape' -and $g -notmatch 'support=1' -and $g -match 'A flagged page fills the screen' -and $g -notmatch 'virus alert|no real company') "the shield's window: $(([string]$g).Substring(0, [Math]::Min(200, ([string]$g).Length)))"
[K]::Tap(0x1B); Start-Sleep 1
[K]::Tap(0x7A)
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 6. Parent lock, through the app's own window (the same calls its Parent lock panel makes).
$r = Info "lockSet('2468')"
Check 'lock-set' ($r.set -and $r.locked) "set with a PIN: $($r | ConvertTo-Json -Compress)"
$r = Cdp '127.0.0.1:4782' 'window.sentinelDesktop.setChatSafety(false)'
Check 'lock-refuses' ($r.error -match 'Locked by a parent') "chat safety off without the PIN: $($r.error)"
Check 'lock-kept-on' ((Info 'info()').chatSafety.enabled -eq $true) 'chat safety is still on'
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
Say "checks failed: $failed"
exit [int]($failed -gt 0)
