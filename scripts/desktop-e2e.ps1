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
# Ask one of Sentinel's windows (by part of its address) to evaluate an expression. Single quotes only inside it.
function Cdp($part, $expr) { $j = node (Join-Path $PSScriptRoot 'e2e-cdp.js') $(if ($part -eq 'main') { 9334 } else { 9333 }) $part $expr; Say "  cdp $part -> $(([string]$j).Substring(0, [Math]::Min(400, ([string]$j).Length)))"; return ($j | ConvertFrom-Json) }
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
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"autoScan":true,"openAtLogin":false,"chatSafety":true,"textSafety":true}')
$pages = Start-Process python -ArgumentList '-m', 'http.server', '47910', '--directory', (Join-Path $PSScriptRoot 'e2e-chat') -PassThru -WindowStyle Hidden
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
  Start-Process "$chromeDir\$name.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\$name-profile", '--start-maximized', "--app=http://127.0.0.1:47910/$page"
  Start-Sleep 8
  return (Front $name)
}
Say "Discord in front: $(Fake 'Discord' 'discord.html')"
$seen = $null
$ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.discord.flagged -ge 2 }
Shot 'discord'
Check 'chat-discord-read' ($seen.discord.checked -ge 3) "messages checked in Discord: $($seen.discord.checked) (3 on screen)"
Check 'chat-discord-flagged' $ok "messages flagged in Discord: $($seen.discord.flagged) (the phone number and the secret)"
$o = (Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + getComputedStyle(document.getElementById('badge')).display + '|' + document.body.className").value
Check 'chat-discord-overlay' ($o -match '^[1-9]\d*\|(?!none)') "chat overlay over Discord (warnings|badge|app): $o"
Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# 3. Chat safety in "Roblox": in a game (its log says so), the chat box read with the text recogniser.
$rlogs = "$env:LOCALAPPDATA\Roblox\logs"; New-Item -ItemType Directory -Force $rlogs | Out-Null
Set-Content -Path "$rlogs\0.0.1_e2e_Player_last.log" -Value "2026-10-07T12:00:00.000Z,0.0,1,6 [FLog::Output] ! Joining game 'x' place 123 at 10.0.0.1" -Encoding ascii
Say "Roblox in front: $(Fake 'RobloxPlayerBeta' 'roblox.html')"
$ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.roblox.flagged -ge 1 }
Shot 'roblox'
Check 'chat-roblox-read' ($seen.roblox.checked -ge 1) "messages checked in Roblox: $($seen.roblox.checked) (2 on screen)"
Check 'chat-roblox-flagged' $ok "messages flagged in Roblox: $($seen.roblox.flagged) (the free Robux offer)"
$o = (Cdp 'chat.html' "document.querySelectorAll('#cards .card').length + '|' + document.body.className").value
Check 'chat-roblox-overlay' ($o -match '^[1-9]\d*\|roblox in-game') "chat overlay over Roblox (warnings|app): $o"
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
  Get-Process AnyDesk -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} else { Check 'remote-noticed' $false 'AnyDesk could not be downloaded on this runner' }

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
$g = (Cdp 'guard.html' 'location.search').value
Check 'escape-window' ($g -match 'mode=escape') "the shield's window: $g"
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
[void](Info 'lockRemove()')

if ($pages) { Stop-Process -Id $pages.Id -Force -ErrorAction SilentlyContinue }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 60 | ForEach-Object { Say "  $_" }
Say "checks failed: $failed"
exit [int]($failed -gt 0)
