# What Sentinel's PowerShell readers cost, and what happens when one dies, measured in the installed app on a GitHub
# Windows desktop, never on a person's computer. Numbers go to run.txt; limits are checks in results.txt.
#   rest      chat safety, texts and live scanning on, nothing to read in front
#   roblox    a game whose backdrop moves behind a chat box that does not change, then its Esc menu
#   discord   a chat left open, nothing new arriving
#   a dead reader, a hung reader, one that keeps dying, a game Windows shows as black: what the protection page says
param([string]$Installer = '', [string]$Out = 'e2e-reader-cost')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
. (Join-Path $PSScriptRoot 'desktop-e2e-lib.ps1')

function Readers { $ids = @(Get-Process Sentinel -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.ParentProcessId }) }
# The chat reader starts with its script on its input, not on its command line.
function ChatReader { return @(Readers | Where-Object { [string]$_.CommandLine -match 'OpenStandardInput' }) }
function CpuOf($list) { $t = 0.0; foreach ($r in $list) { $p = Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue; if ($p) { $t += $p.CPU } }; return $t }
function MemOf($list) { $t = 0; foreach ($r in $list) { $p = Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue; if ($p) { $t += $p.WorkingSet64 } }; return [math]::Round($t / 1MB) }
# Percent of one core used by all the readers over $seconds. A reader that started or ended inside the window counts for what it used while seen.
function Cost($label, $seconds) {
  $list = Readers; $a = CpuOf $list; $ca = CpuOf (ChatReader)
  Start-Sleep $seconds
  $b = CpuOf $list; $cb = CpuOf (ChatReader)
  $pct = [math]::Round(($b - $a) / $seconds * 100, 2)
  $line = "cost ${label}: $($list.Count) readers, $pct% of one core, chat reader $([math]::Round(($cb - $ca) / $seconds * 100, 2))%, $(MemOf $list) MB"
  Say $line; Add-Content "$Out\cost.txt" $line
  return $pct
}
function Chat { return (Info 'info()').chatSafety }
function Page($path) { [void](Cdp '127.0.0.1:4782' "(location.href = '$path', 1)"); [void](Until 30 { (Cdp '127.0.0.1:4782' "location.pathname + '|' + document.readyState + '|' + Boolean(document.querySelector('main'))").value -match "^$([regex]::Escape($path.Split('?')[0].Split('#')[0]))\|complete\|true" }); Start-Sleep 2 }
function Line { return [string](Cdp '127.0.0.1:4782' "(document.querySelector('[data-chat-seen]') || {}).textContent").value }
# The panel as a person sees it: the app's window at desktop and phone width, light and dark.
function PanelShots($name) {
  $win = "process.mainModule.require('electron').BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('127.0.0.1:4782'))"
  foreach ($size in @(@(1280, 860, 'desktop'), @(390, 800, 'phone'))) {
    [void](Cdp 'main' "(() => { const w = $win; w.setMinimumSize(320, 400); w.unmaximize(); w.setSize($($size[0]), $($size[1])); w.show(); w.moveTop(); return 1; })()")
    foreach ($theme in 'light', 'dark') {
      [void](Cdp '127.0.0.1:4782' "(document.documentElement.setAttribute('data-theme', '$theme'), document.querySelector('#chat-safety').scrollIntoView({ block: 'start' }), 1)")
      Start-Sleep 1
      Shot "$name-$($size[2])-$theme"
    }
  }
}

Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds)"
Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
Feed $Installer; PointUpdater
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"autoScan":true,"openAtLogin":false,"chatSafety":true,"textSafety":true}')
$pagesLog = Join-Path $Out 'pages.log'
$pages = Start-Process python -ArgumentList '-u', '-m', 'http.server', '47910', '--directory', (Join-Path $PSScriptRoot 'e2e-chat') -PassThru -NoNewWindow -RedirectStandardError $pagesLog -RedirectStandardOutput "$pagesLog.out"
function PagesDiag($page) { Get-Content $pagesLog -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag pages.log: $_" } }
$warm = Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\warm-profile", 'about:blank' -PassThru
[void](Until 180 { [bool](Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) })
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Process $exe -ArgumentList '--hidden'
if (-not (WaitUp)) { Check 'start' $false 'the installed app did not start'; Shot 'not-started'; exit 1 }
Start-Sleep 15
Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db")
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue; Start-Sleep 3
Check 'restart' (StartSentinel) 'started with its debugging port'
Page '/app/protection'
# Start-up (lists, compiling) is over before anything is measured.
Start-Sleep 60
[K]::ShowWindow([K]::GetForegroundWindow(), 6) | Out-Null   # nothing of Sentinel's in front
Start-Sleep 5

# 1. At rest.
Say "readers at rest: $((Readers | ForEach-Object { "$($_.ProcessId):$(if ([string]$_.CommandLine -match 'OpenStandardInput') { 'chat' } else { 'other' })" }) -join ' ')"
$rest = Cost 'rest' 60
Check 'rest-under-limit' ($rest -lt 1.5) "the readers together use $rest% of one core at rest (limit 1.5%)"
Check 'rest-no-chat-reader' ((ChatReader).Count -eq 0) "chat readers running with nothing to read: $((ChatReader).Count)"

# 2. A game: the backdrop moves, the chat does not.
$chromeDir = "$env:ProgramFiles\Google\Chrome\Application"
New-Item -ItemType HardLink -Path "$chromeDir\Discord.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
New-Item -ItemType HardLink -Path "$chromeDir\RobloxPlayerBeta.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
$rlogs = "$env:LOCALAPPDATA\Roblox\logs"; New-Item -ItemType Directory -Force $rlogs | Out-Null
Set-Content -Path "$rlogs\0.0.1_e2e_Player_last.log" -Value "2026-10-07T12:00:00.000Z,0.0,1,6 [FLog::Output] ! Joining game 'x' place 123 at 10.0.0.1" -Encoding ascii
Say "Roblox in front: $(Fake 'RobloxPlayerBeta' 'roblox.html?moving')"
$ok = Until 40 { (Chat).seen.roblox.checked -ge 1 }
Shot 'roblox-moving'
Check 'roblox-read' $ok "its chat was read: $((Chat).seen.roblox.checked) messages"
$game = Cost 'game' 45
$chatGame = (Get-Content "$Out\cost.txt" | Select-Object -Last 1)
[K]::Tap(0x1B)
$menu = Until 8 { (Cdp 'chat.html' "getComputedStyle(document.getElementById('badge')).display + '|' + document.body.className").value -notmatch '^none' }
Shot 'roblox-esc-menu'
Check 'esc-menu-badge' $menu "the badge shows with the game's Esc menu open: $menu"
[K]::Tap(0x1B)
Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# 3. A game Windows shows as black: the app says it cannot see it, not that the chat is closed.
Say "A black game in front: $(Fake 'RobloxPlayerBeta' 'roblox.html?black')"
$black = Until 20 { (Chat).seen.blind -eq 'roblox' }
Page '/app/protection'
Say "  the panel: $(Line)"
Check 'black-game-told' ($black -and (Line) -match 'cannot see') "seen.blind $((Chat).seen.blind); the panel: $(Line)"
Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3

# 4. A chat left open.
Say "Discord in front: $(Fake 'Discord' 'discord.html')"
$ok = Until 40 { (Chat).seen.discord.checked -ge 3 }
Check 'discord-read' $ok "its chat was read: $((Chat).seen.discord.checked) messages"
$idleChat = Cost 'discord' 45

# 5. The reader is killed while it reads: it comes back by itself, and the page says what happened meanwhile.
$before = @(ChatReader | ForEach-Object { $_.ProcessId })
Check 'reader-running' ($before.Count -eq 1) "chat readers with Discord in front: $($before.Count)"
foreach ($id in $before) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
$said = $false; [void](Until 3 { $script:said = (Chat).reader -eq 'restarting'; $script:said })
Page '/app/protection'
$told = Line
Say "  the panel, reader killed: $told"
$back = Until 30 { $n = @(ChatReader | ForEach-Object { $_.ProcessId }); $n.Count -eq 1 -and $before -notcontains $n[0] -and (Chat).reader -eq 'ok' }
Check 'reader-comes-back' $back "killed: state said restarting $said, then a new reader; state now $((Chat).reader)"
Check 'reader-death-told' ($told -match 'not being watched|stopped') "the panel while it was gone: $told"

# 6. A reader that keeps dying stops being called on: the switch stays on, and the page, the tray and the log say so.
$end = (Get-Date).AddSeconds(90); $kills = 0
while ((Get-Date) -lt $end -and (Chat).reader -ne 'stopped') { foreach ($r in ChatReader) { Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue; $kills++ }; Start-Sleep 1 }
$state = (Chat).reader
Check 'reader-stopped-told' ($state -eq 'stopped') "after $kills kills the state is $state; the switch still says on: $((Chat).enabled)"
Page '/app/protection'
Say "  the panel, reader failing: $(Line)"
Check 'reader-stopped-words' ((Line) -match 'cannot read') "the panel: $(Line)"
PanelShots 'reader-stopped'
Say "  app.log: $((AppLog) -split "`n" | Where-Object { $_ -match 'chat safety' } | Select-Object -Last 6)"
Check 'reader-log-private' ((AppLog) -notmatch 'free robux|robux-gen') 'nothing a chat said is in the log'

$out = Join-Path $Out 'results.txt'
Say "failed: $failed"
Stop-Process -Name Sentinel -Force -ErrorAction SilentlyContinue
Stop-Process -Id $pages.Id -Force -ErrorAction SilentlyContinue
exit $(if ($failed) { 1 } else { 0 })
