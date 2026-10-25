# Real-use QA of the Windows app's core (round 1.17.5) on a GitHub-hosted Windows desktop, never a person's computer.
# Three parts, each on its own runner:
#   -Part install  the silent install, the first start, the start at login, the tray menu, every switch in Live
#                  protection really switching its protection off and on, the parent lock in the tray, signing out and
#                  in, a crash of each kind, the scanner's port taken, the network gone.
#   -Part use      live scanning in Edge and Chrome on real honest sites and local stand-in scams (the warning, its
#                  buttons, how long a verdict takes), download protection on harmless files of many kinds, chat
#                  safety on the Discord and Roblox stand-ins, ten idle minutes, and 125% and 150% display scaling.
#   -Part update   the updater, from a feed served on the runner with a newer build of this commit (-Next), then
#                  uninstalling and what is left behind.
# Everything that looks dangerous is a harmless stand-in. Results go to $Out\results.txt; exits 1 when a check failed.
param([string]$Installer = '', [string]$Next = '', [string]$Part = 'install', [string]$Out = 'e2e-core-qa')
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
. (Join-Path $PSScriptRoot 'desktop-e2e-lib.ps1')
Say "part $Part; screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds); scaling: $([Qa]::Scale())"

$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
$chromeDir = "$env:ProgramFiles\Google\Chrome\Application"
$dl = Join-Path $env:USERPROFILE 'Downloads'; New-Item -ItemType Directory -Force $dl | Out-Null
$pagesLog = Join-Path $Out 'pages.log'
$pages = Start-Process python -ArgumentList '-u', '-m', 'http.server', '47910', '--directory', (Join-Path $PSScriptRoot 'e2e-chat') -PassThru -NoNewWindow -RedirectStandardError $pagesLog -RedirectStandardOutput "$pagesLog.out"
function PagesDiag($page) { Get-Content $pagesLog -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { Say "  diag pages.log: $_" } }
Add-Content "$env:WINDIR\System32\drivers\etc\hosts" "`r`n127.0.0.1 paypal-account-verify-login.test`r`n127.0.0.1 paypal-resolution-center-secure.test`r`n127.0.0.1 defender-virusalert-helpline.test`r`n127.0.0.1 amazon-giftcard-claim-reward.test`r`n127.0.0.1 microsoft-account-unlock-verify.test`r`n127.0.0.1 paypal-wallet-limited-review.test`r`n127.0.0.1 apple-id-locked-support.test"

# What a person can see of Sentinel, outside its windows.
function Settings { try { return (Get-Content "$data\settings.json" -Raw | ConvertFrom-Json) } catch { return $null } }
function RunEntry { $k = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue; if (-not $k) { return $null }; foreach ($p in $k.PSObject.Properties) { if ([string]$p.Value -match 'Sentinel\.exe') { return @{ name = $p.Name; command = [string]$p.Value } } }; return $null }
function Approved($name) { $b = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -ErrorAction SilentlyContinue).$name; if ($b) { return [int]$b[0] } else { return 0 } }
# Sentinel's processes and the PowerShell helpers it started (the live scanning reader, the chat reader, the clipboard).
function Helpers { $ids = @(Get-Process Sentinel -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }); return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.ParentProcessId }) }
function Everything { return @(Get-Process Sentinel -ErrorAction SilentlyContinue) + @(Helpers | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }) }
function Footprint($when) {
  $ps = Everything
  $r = @{ n = $ps.Count; mb = [math]::Round((($ps | Measure-Object WorkingSet64 -Sum).Sum) / 1MB); priv = [math]::Round((($ps | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB); cpu = [math]::Round((($ps | Measure-Object CPU -Sum).Sum), 1) }
  Say "footprint ${when}: $($r.n) processes, $($r.mb) MB in memory ($($r.priv) MB private), $($r.cpu) s of processor time so far"
  $cmd = @{}; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(Sentinel|powershell)\.exe$' } | ForEach-Object { $cmd[[int]$_.ProcessId] = [string]$_.CommandLine }
  foreach ($p in $ps) {
    $c = $cmd[[int]$p.Id]
    $role = if ($p.ProcessName -eq 'powershell') { 'helper ' + $(if ($c -match 'EncodedCommand') { 'encoded' } else { ($c -split ' ' | Select-Object -Last 1) }) } elseif ($c -match '--type=([a-z-]+)') { $Matches[1] + $(if ($c -match '--utility-sub-type=([^\s]+)') { " ($($Matches[1]))" } else { '' }) } else { 'main' }
    Say ("  {0,-44} {1,6} MB {2,6} MB private {3,8} s" -f $role, [math]::Round($p.WorkingSet64 / 1MB), [math]::Round($p.PrivateMemorySize64 / 1MB), [math]::Round($p.CPU, 1))
  }
  return $r
}
function Quit { [void](Cdp 'main' "(process.mainModule.require('electron').app.quit(), 1)"); return (Until 30 { -not (Get-Process Sentinel -ErrorAction SilentlyContinue) }) }
function Page($path) { [void](Cdp '127.0.0.1:4782' "(location.href = '$path', 1)"); [void](Until 30 { (Cdp '127.0.0.1:4782' "location.pathname + '|' + document.readyState + '|' + Boolean(document.querySelector('main'))").value -match "^$([regex]::Escape($path.Split('?')[0].Split('#')[0]))\|complete\|true" }); Start-Sleep 2 }
function Toasts { return [string](Cdp '127.0.0.1:4782' "[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ')").value }
function DlLines($name) { return ([regex]::Matches((AppLog), "download scanned: $([regex]::Escape($name)) ")).Count }
function Recent($name) { return (Cdp 'main' "JSON.stringify(process.mainModule.require('./downloads').recent().find((d) => d.name === '$name') || null)").value | ConvertFrom-Json }
function GuardMode { return [string](Cdp 'guard.html' 'location.search').value }
function WatchLog { return (Get-Content "$data\logs\watch.log" -Raw -ErrorAction SilentlyContinue) + '' }

# The tray's menu, as Sentinel last built it: Tray.setContextMenu is watched from here on, and the menu rebuilt.
$trayHook = "(() => { const e = process.mainModule.require('electron'); if (!global.qaTrayHooked) { global.qaTrayHooked = true; const o = e.Tray.prototype.setContextMenu; e.Tray.prototype.setContextMenu = function (m) { global.qaTray = m; return o.call(this, m); }; } process.mainModule.require('./updater').check(); return 1; })()"
function TrayItems { return [string](Cdp 'main' "global.qaTray ? global.qaTray.items.filter((i) => i.type !== 'separator').map((i) => i.label + (i.type === 'checkbox' ? (i.checked ? ' [x]' : ' [ ]') : '') + (i.enabled ? '' : ' (grey)')).join(' / ') : 'no menu'").value }
# A click on a tray line, as Windows hands it to Electron (a checkbox ticks or unticks first).
function TrayClick($label) { return [string](Cdp 'main' "(() => { const i = global.qaTray && global.qaTray.items.find((x) => x.label.startsWith('$label')); if (!i) return 'no such line'; i.click(); return i.label + (i.type === 'checkbox' ? ' ' + i.checked : ''); })()").value }
function AppWindow { return [string](Cdp 'main' "(() => { const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('127.0.0.1:4782')); return w ? (w.isVisible() ? 'shown' : 'hidden') + '|' + w.webContents.getURL().replace(/^http:..127.0.0.1:\d+/, '') : 'none'; })()").value }
function HideApp { [void](Cdp 'main' "(process.mainModule.require('electron').BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('127.0.0.1:4782')).forEach((w) => w.hide()), 1)") }

# A switch in Live protection, pressed as a person presses it; returns what it shows afterwards.
function Flip($sel, [bool]$want) {
  $r = [string](Cdp '127.0.0.1:4782' "(() => { const s = document.querySelector('$sel'); if (!s) return 'none'; s.scrollIntoView({ block: 'center' }); if (s.checked !== $(([string]$want).ToLower())) s.click(); return String(s.checked); })()").value
  Start-Sleep 3
  return $r
}
function Shown($sel) { return [string](Cdp '127.0.0.1:4782' "(() => { const s = document.querySelector('$sel'); return s ? String(s.checked) : 'none'; })()").value }
function Arrive($name, [scriptblock]$make) {
  $stage = Join-Path $env:RUNNER_TEMP 'stage'; New-Item -ItemType Directory -Force $stage | Out-Null
  $f = Join-Path $stage $name
  & $make $f
  Move-Item -LiteralPath $f (Join-Path $dl $name) -Force
}
function Text($s) { return { param($p) [IO.File]::WriteAllText($p, $s) }.GetNewClosure() }

$swapper = Join-Path $env:RUNNER_TEMP 'swapper.ps1'
$btcA = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; $btcB = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'
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
Start-Sleep 8
'@.Replace('__A__', $btcA).Replace('__B__', $btcB) | Set-Content -Path $swapper -Encoding utf8
function Swap { $sw = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $swapper -WindowStyle Hidden -PassThru; Start-Sleep 4; $c = ((Get-Clipboard -Raw) + '').Trim(); [void]$sw.WaitForExit(15000); return $c }

# A file's version as the app says it (1.17.4, not Windows' 1.17.4.0).
function Ver($file) { try { return ([version](Get-Item $file).VersionInfo.ProductVersion).ToString(3) } catch { return '' } }
function Install {
  $t0 = Get-Date
  Start-Process $Installer -ArgumentList '/S' -Wait
  $script:installSeconds = [int]((Get-Date) - $t0).TotalSeconds
  $script:version = Ver $exe
  Say "installed $script:version in $script:installSeconds s"
  PointUpdater
}
function Pro { Say (node (Join-Path $PSScriptRoot 'e2e-pro.js') "$data\sentinel.db") }

# ------------------------------------------------------------------------------------------------------------ install
if ($Part -eq 'install') {
  # 1. The silent install: where it puts things, and whether Windows lists it.
  Install
  Feed $Installer
  $startLnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Sentinel.lnk"
  $deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sentinel.lnk'
  $listed = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -match '^Sentinel' } | Select-Object -First 1
  Check 'install-silent' ((Test-Path $exe) -and $installSeconds -le 120) "Sentinel.exe there: $(Test-Path $exe), $installSeconds s"
  Check 'install-shortcuts' ((Test-Path $startLnk) -and (Test-Path $deskLnk)) "Start menu: $(Test-Path $startLnk), desktop: $(Test-Path $deskLnk)"
  Check 'install-listed' ($listed -and $listed.DisplayVersion -eq $version) "Installed apps: '$($listed.DisplayName)' $($listed.DisplayVersion), publisher '$($listed.Publisher)', icon '$($listed.DisplayIcon)', size $($listed.EstimatedSize) KB"
  Start-Sleep 5
  Say "running after a silent install: $(@(Get-Process Sentinel -ErrorAction SilentlyContinue).Count) process(es); settings.json there: $(Test-Path "$data\settings.json")"

  # 2. The first start, from the Start menu, as a person does after installing. Nothing set beforehand.
  $t0 = Get-Date
  Start-Process $startLnk
  $w = $null
  $shown = Until 60 { $script:w = SentinelWindows | Where-Object { $_ -match '\|\d+,\d+,(\d{4}|[5-9]\d\d),' } | Select-Object -First 1; [bool]$script:w }
  $tookWindow = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $up = WaitUp
  $tookUp = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Start-Sleep 8
  $w = SentinelWindows
  Shot 'first-start'
  Check 'first-window' ($shown -and $tookWindow -le 10) "a window after $tookWindow s: $($w -join ' / ')"
  Check 'first-scanner' ($up -and $tookUp -le 60) "the scanner answers after $tookUp s"
  $run = RunEntry
  Check 'first-login-item' ($run -and $run.command -match [regex]::Escape($exe) -and $run.command -match '--hidden' -and (Approved $run.name) -in 0, 2) "startup entry '$($run.name)': $($run.command); Task Manager says $(if ((Approved $run.name) -eq 3) { 'disabled' } else { 'enabled' })"
  Check 'first-menu' (Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\SentinelScan\command') 'Scan with Sentinel is in the right-click menu'
  Say "settings after the first start: $((Get-Content "$data\settings.json" -Raw -ErrorAction SilentlyContinue) -replace '"secret:[^"]+":\s*"[^"]*"', '"secret:…"' -replace '\s+', ' ')"
  StopSentinel
  Pro

  # 3. The start at sign-in: exactly the command Windows runs from the startup entry. In the tray, no window, protecting.
  if ($run -and $run.command -match '^"([^"]+)"\s*(.*)$') {
    $t0 = Get-Date
    Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2]
    $up = WaitUp
    $took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Start-Sleep 20
    $ws = SentinelWindows
    Shot 'login-start'
    Check 'login-start-hidden' ($up -and -not @($ws).Count) "scanner after $took s; windows on screen: $(@($ws).Count) $($ws -join ' / ')"
    Check 'login-start-logged' ((AppLog) -match 'starting Sentinel [\d.]+ \(hidden\)') 'app.log: started hidden'
    StopSentinel
  } else { Check 'login-start-hidden' $false "no startup entry to run: $($run.command)" }

  Check 'restart' (StartSentinel) 'started with its debugging port'
  Start-Sleep 12
  # 4. Signing in on the app's own sign-in page, as a person types it (signing out comes last).
  $em = "core-qa-$(Get-Random)@example.com"; $pw = 'Lantern-orchard-62Wb'
  $r = Cdp '127.0.0.1:4782' "(async () => { const r = await fetch('/api/v1/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '$em', password: '$pw', firstName: 'Robin', ageConfirmed: true, termsAccepted: true }) }); await fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return r.status; })()"
  Say "an account made: $($r.value)"
  [void](Cdp '127.0.0.1:4782' "(location.href = '/login', 1)"); Start-Sleep 4
  $fill = { param($p) "(() => { const f = document.querySelector('[data-form]'); f.elements.email.value = '$em'; f.elements.password.value = '$p'; f.querySelector('button[type=submit]').click(); return 1; })()" }
  [void](Cdp '127.0.0.1:4782' (& $fill 'Not-the-password-1'))
  $msg = ''
  [void](Until 15 { $script:msg = [string](Cdp '127.0.0.1:4782' "[...document.querySelectorAll('.banner, [data-error]')].map((e) => e.textContent.trim()).filter(Boolean).join(' / ')").value; [bool]$script:msg })
  Shot 'signin-wrong'
  Check 'signin-wrong-password' ($msg -and $msg -notmatch 'HTTP|undefined|null|Error:|\{') "a wrong password says: '$msg'"
  [void](Cdp '127.0.0.1:4782' (& $fill $pw))
  $paired = Until 40 { [bool](Info 'info()').pairedUserId }
  Check 'signin' $paired "signed in on the sign-in page: the app is at $(AppWindow), paired $paired"
  $dlIn = Until 30 { (Info 'info()').downloads.active -or (Info 'info()').downloads.reason }
  Say "download protection for a new free account: $((Info 'info()').downloads | ConvertTo-Json -Compress)"
  # Signed in survives a normal quit and start.
  [void](Quit); [void](StartSentinel); Start-Sleep 10
  $still = (Cdp '127.0.0.1:4782' "fetch('/api/v1/auth/me').then((x) => x.status)").value
  Check 'signin-kept' ($still -eq 200 -and [bool](Info 'info()').pairedUserId) "after quitting and starting again: session $still, paired $([bool](Info 'info()').pairedUserId)"
  # Pro for the new account (download protection is a Pro feature), as a person who pays would have it.
  Pro
  [void](Cdp 'main' "(process.mainModule.require('./downloads').restart(), 1)")
  [void](Until 30 { (Info 'info()').downloads.active })

  # 4b. The tray menu, line by line, and what each line really does.
  [void](Cdp 'main' $trayHook)
  [void](Until 20 { (TrayItems) -match 'up to date|Check for updates' })
  $items = TrayItems
  $i = Info 'info()'
  Say "tray: $items"
  Check 'tray-lines' ($items -match '^Open Sentinel / ' -and $items -match 'Quit Sentinel$' -and $items -match 'Start with my computer \[x\]') "the menu: $items"
  Check 'tray-download-line' (($items -match 'Download protection: on') -eq [bool]$i.downloads.active) "says '$(([regex]::Match($items, '(Download protection[^/]*|Sign in to turn on download protection|[^/]*download protection[^/]*)')).Value.Trim())', download protection active: $($i.downloads.active)"
  Check 'tray-update-line' ($items -match "Sentinel $([regex]::Escape($version)) is up to date") "update line: $(([regex]::Match($items, '[^/]*(update|Update)[^/]*')).Value.Trim())"
  HideApp
  Say "tray click: $(TrayClick 'Open Sentinel')"
  $front = ''
  $ok = Until 10 { $script:front = (SentinelWindows | Where-Object { $_ -match '^front\|' }) -join ''; [bool]$script:front }
  Check 'tray-open' $ok "Open Sentinel: in front '$front'"
  Say "tray click: $(TrayClick 'Scan a file')"
  $ok = Until 15 { (AppWindow) -match '^shown\|/app/threats' }
  Check 'tray-scan-file' $ok "Scan a file...: $(AppWindow)"
  Say "tray click: $(TrayClick 'Is this call a scam')"
  $ok = Until 15 { (AppWindow) -match '^shown\|/app/call' }
  Check 'tray-call' $ok "Is this call a scam?: $(AppWindow)"
  # The app open on Live protection while the tray changes things: the switches there should follow.
  Page '/app/protection'
  Say "tray click: $(TrayClick 'Chat safety')"
  $ok = Until 15 { $c = (Info 'info()').chatSafety; $c.enabled -and $c.running }
  Check 'tray-chat-on' $ok "Chat safety ticked in the tray: reading $ok; the app's switch shows $(Shown '[data-chat-safety]')"
  Say "tray click: $(TrayClick 'Chat safety')"
  $ok = Until 15 { $c = (Info 'info()').chatSafety; -not $c.enabled -and -not $c.running }
  Check 'tray-chat-off' ($ok -and (Shown '[data-chat-safety]') -eq 'false') "unticked: stopped reading $ok; the app's switch shows $(Shown '[data-chat-safety]')"
  Say "tray click: $(TrayClick 'Start with my computer')"
  Start-Sleep 3
  Check 'tray-login-off' (-not (RunEntry) -and (Settings).openAtLogin -eq $false) "unticked: startup entry $(if (RunEntry) { 'still there' } else { 'gone' }); the app's switch shows $(Shown '[data-login]')"
  Check 'tray-login-app-follows' ((Shown '[data-login]') -eq 'false') "the app's Start with my computer switch, open while the tray changed it: $(Shown '[data-login]')"
  Say "tray click: $(TrayClick 'Start with my computer')"
  Start-Sleep 3
  Check 'tray-login-on' ([bool](RunEntry)) "ticked again: startup entry $(if (RunEntry) { 'back' } else { 'missing' })"
  Say "tray click: $(TrayClick 'Auto scanning')"
  Start-Sleep 3
  Check 'tray-auto-app-follows' ((Settings).autoScan -eq $true -and (Shown '[data-auto-scan]') -eq 'true') "Auto scanning ticked in the tray: saved $((Settings).autoScan); the app's switch shows $(Shown '[data-auto-scan]')"
  Say "tray click: $(TrayClick 'Auto scanning')"
  Say "tray click: $(TrayClick 'Check my texts')"
  $ok = Until 15 { (Info 'info()').textSafety.running }
  Check 'tray-texts' ($ok -and (Shown '[data-text-safety]') -eq 'true') "Check my texts ticked: reading $ok; the app's switch shows $(Shown '[data-text-safety]')"
  Say "tray click: $(TrayClick 'Check my texts')"
  Say "tray click: $(TrayClick 'Start scanning')"
  $ok = Until 30 { $s = (Info 'info()').live; $s.enabled -and $s.active }
  Start-Sleep 5
  Shot 'tray-start-scanning'
  Check 'tray-start-scanning' $ok "Start scanning: live scanning on and active $ok; a browser was brought up: $([bool](Get-Process msedge, chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }))"
  Say "tray: $(TrayItems)"
  Say "tray click: $(TrayClick 'Stop scanning')"
  $ok = Until 15 { $s = (Info 'info()').live; -not $s.enabled -and -not $s.active }
  Check 'tray-stop-scanning' ($ok -and (TrayItems) -match 'Start scanning') "Stop scanning: off $ok; the menu now: $(TrayItems)"
  Get-Process msedge, chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # 5. Every switch in Live protection, pressed in the app, and its protection really off, then really on again.
  Page '/app/protection'
  Shot 'protection-page'
  # Download protection: a file arriving while it is off is not looked at; on again, the next one is.
  Say "download protection: $(Flip '[data-dl]' $false); toast: $(Toasts)"
  Arrive 'switch off.txt' (Text 'Milk and eggs')
  Start-Sleep 15
  $offOk = (DlLines 'switch off.txt') -eq 0 -and -not (Info 'info()').downloads.active
  Say "download protection: $(Flip '[data-dl]' $true); toast: $(Toasts)"
  Arrive 'switch on.txt' (Text 'Bread and butter')
  $onOk = Until 60 { (DlLines 'switch on.txt') -ge 1 }
  Check 'switch-downloads' ($offOk -and $onOk) "off: the file that arrived was left alone $offOk; on: the next one was scanned $onOk"
  [void](Cdp '127.0.0.1:4782' 'location.reload(), 1'); Start-Sleep 6
  Check 'switch-downloads-kept' ((Shown '[data-dl]') -eq 'true') "after a reload the switch shows $(Shown '[data-dl]')"
  # Defense.
  Say "defense: $(Flip '[data-defense]' $false)"
  $off = (Cdp 'main' "process.mainModule.require('./defense').status().active").value
  Say "defense: $(Flip '[data-defense]' $true)"
  $on = Until 20 { (Cdp 'main' "process.mainModule.require('./defense').status().active").value -eq $true }
  Check 'switch-defense' ($off -eq $false -and $on) "off: watching $off; on again: watching $on"
  # Check links I copy (off unless turned on): a copied scam link is checked only while it is on.
  $lines = { ([regex]::Matches((AppLog), 'copied link checked')).Count }
  Say "copied links: $(Flip '[data-clip]' $true)"
  $n0 = & $lines; Set-Clipboard -Value 'http://paypa1-secure-login.com/account/verify'
  $onOk = Until 15 { (& $lines) -gt $n0 }
  Say "copied links: $(Flip '[data-clip]' $false)"
  $n1 = & $lines; Set-Clipboard -Value 'http://paypa1-secure-login.com/account/confirm'; Start-Sleep 8
  Check 'switch-copied-links' ($onOk -and (& $lines) -eq $n1) "on: checked $onOk ($(([regex]::Match((AppLog), 'copied link checked[^\r\n]*')).Value)); off: left alone $((& $lines) -eq $n1)"
  # Stop pasted commands: a ClickFix-shaped command copied with a browser in front.
  Say "Edge in front: $(FreshEdge 'http://127.0.0.1:47910/plain.html')"
  Say "command shield: $(Flip '[data-shield]' $false)"
  Say "Edge in front: $(Front 'msedge')"
  $cmd = 'powershell -w hidden -enc ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Write-Output hi'))
  Set-Clipboard -Value $cmd; Start-Sleep 5
  $offOk = ((Get-Clipboard -Raw) + '').Trim() -eq $cmd
  Say "command shield: $(Flip '[data-shield]' $true)"
  Say "Edge in front: $(Front 'msedge')"
  Set-Clipboard -Value ($cmd + ' ');
  $onOk = Until 10 { ((Get-Clipboard -Raw) + '') -like 'Sentinel stopped a command*' }
  Check 'switch-command-shield' ($offOk -and $onOk) "off: the command stayed on the clipboard $offOk; on: stopped $onOk"
  # Wallet guard: an address swapped on the clipboard straight after it was copied.
  Say "wallet guard: $(Flip '[data-wallet-guard]' $false)"
  Set-Clipboard -Value 'a shopping list'; Start-Sleep 12
  $offClip = Swap
  Say "wallet guard: $(Flip '[data-wallet-guard]' $true)"
  Set-Clipboard -Value 'a shopping list'; Start-Sleep 12
  $onClip = Swap
  Check 'switch-wallet-guard' ($offClip -eq $btcB -and $onClip -eq $btcA) "off: the swapped address stayed $($offClip -eq $btcB); on: the copied one was put back $($onClip -eq $btcA)"
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # Check something on screen: its shortcut is held only while it is on.
  $key = (Info 'info()').snip.key
  Say "check on screen: $(Flip '[data-snip]' $false)"
  $off = (Cdp 'main' "process.mainModule.require('electron').globalShortcut.isRegistered('$key')").value
  Say "check on screen: $(Flip '[data-snip]' $true)"
  $on = (Cdp 'main' "process.mainModule.require('electron').globalShortcut.isRegistered('$key')").value
  Check 'switch-snip' ($off -eq $false -and $on -eq $true) "the shortcut $key held: off $off, on $on"
  # Chat safety and Check my texts: the reader runs only while one of them is on.
  Say "chat safety: $(Flip '[data-chat-safety]' $true)"
  $on = Until 15 { (Info 'info()').chatSafety.running }
  $readers = @(Helpers).Count
  Say "chat safety: $(Flip '[data-chat-safety]' $false)"
  $off = Until 15 { -not (Info 'info()').chatSafety.running }
  Check 'switch-chat-safety' ($on -and $off -and @(Helpers).Count -lt $readers) "on: reading $on ($readers helpers); off: stopped $off ($(@(Helpers).Count) helpers)"
  Say "texts: $(Flip '[data-text-safety]' $true)"
  $on = Until 15 { (Info 'info()').textSafety.running }
  Say "texts: $(Flip '[data-text-safety]' $false)"
  $off = Until 15 { -not (Info 'info()').textSafety.running }
  Check 'switch-texts' ($on -and $off) "on: reading $on; off: stopped $off"
  # The tech-support scam shield.
  Say "shield: $(Flip '[data-remote-guard]' $false)"
  $off = (Info 'info()').remoteGuard.enabled
  Say "shield: $(Flip '[data-remote-guard]' $true)"
  Check 'switch-shield' ($off -eq $false -and (Info 'info()').remoteGuard.enabled -eq $true) "off: $off; on: $((Info 'info()').remoteGuard.enabled)"
  # Start with my computer.
  Say "login: $(Flip '[data-login]' $false)"
  $off = -not (RunEntry)
  Say "login: $(Flip '[data-login]' $true)"
  Check 'switch-login' ($off -and [bool](RunEntry)) "off: the startup entry went $off; on: it came back $([bool](RunEntry))"
  # Live scanning: Stop scanning takes the browser reader away; Start scanning brings it back.
  Say "live: $(TrayClick 'Start scanning')"
  [void](Until 30 { (Info 'info()').live.active })
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Page '/app/protection'
  $h0 = @(Helpers).Count
  [void](Cdp '127.0.0.1:4782' "(document.querySelector('[data-live-toggle]').click(), 1)")
  $off = Until 15 { -not (Info 'info()').live.active }
  Start-Sleep 3
  $h1 = @(Helpers).Count
  Check 'switch-live' ($off -and $h1 -lt $h0) "Stop scanning: inactive $off; helpers $h0 then $h1"
  # Auto scanning: on, a browser opening starts fast scanning by itself; off, nothing starts.
  Say "auto: $(Flip '[data-auto-scan]' $true)"
  Start-Process msedge -ArgumentList '--no-first-run', 'http://127.0.0.1:47910/plain.html'
  $on = Until 30 { (Info 'info()').live.enabled }
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $closed = Until 40 { -not (Info 'info()').live.enabled }
  Page '/app/protection'
  Say "auto: $(Flip '[data-auto-scan]' $false)"
  Start-Process msedge -ArgumentList '--no-first-run', 'http://127.0.0.1:47910/plain.html'
  Start-Sleep 20
  $stayed = -not (Info 'info()').live.enabled
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Check 'switch-auto-scan' ($on -and $closed -and $stayed) "on: a browser opening started scanning $on, closing it stopped it $closed; off: nothing started $stayed"

  # 6. The parent lock, met in the tray: a switch off and Quit are refused there, and the app opens on Parent lock.
  Page '/app/protection'
  [void](Info "lockSet('2468')")
  [void](Info 'setChatSafety(true)'); Start-Sleep 2
  [void](Cdp 'main' $trayHook); Start-Sleep 3
  HideApp
  Say "tray click (locked): $(TrayClick 'Chat safety')"
  Start-Sleep 3
  Check 'lock-tray-switch' ((Info 'info()').chatSafety.enabled -and (TrayItems) -match 'Chat safety \(Roblox and Discord\) \[x\]' -and (AppWindow) -match '^shown\|/app/protection#parent-lock') "chat safety still on: $((Info 'info()').chatSafety.enabled); the menu: $(TrayItems); the app: $(AppWindow)"
  HideApp
  Say "tray click (locked): $(TrayClick 'Quit Sentinel')"
  Start-Sleep 5
  Check 'lock-tray-quit' ((@(MainProcs).Count -eq 1) -and (AppWindow) -match '^shown\|/app/protection#parent-lock') "still running: $(@(MainProcs).Count) main process; the app: $(AppWindow)"
  Shot 'lock-tray'
  [void](Info "lockUnlock('2468')"); [void](Info 'lockRemove()'); [void](Info 'setChatSafety(false)')

  # 8. Crashes. A mistake in Sentinel's own code is written down and Sentinel carries on.
  [void](Cdp 'main' "(setTimeout(() => { throw new Error('core-qa: a mistake on purpose'); }), 1)")
  Start-Sleep 3
  Check 'crash-js-logged' ((AppLog) -match 'uncaught exception: Error: core-qa: a mistake on purpose' -and @(MainProcs).Count -eq 1) "logged: $((AppLog) -match 'core-qa: a mistake on purpose'); still running: $(@(MainProcs).Count)"
  # The scanner process dies: it is started again, and the app with it.
  $svc = Get-CimInstance Win32_Process -Filter "Name='Sentinel.exe'" | Where-Object { $_.CommandLine -match 'utility-sub-type=node\.mojom\.NodeService' } | Select-Object -First 1
  Say "the scanner process: $($svc.ProcessId)"
  if ($svc) { Stop-Process -Id $svc.ProcessId -Force }
  $t0 = Get-Date
  $back = Until 60 { try { (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
  Check 'crash-scanner-back' $back "the scanner answered again after $([int]((Get-Date) - $t0).TotalSeconds) s; server.log: $(([regex]::Matches((Get-Content "$data\logs\server.log" -Raw), 'server exited with code[^\r\n]*|restarting in[^\r\n]*') | Select-Object -Last 2 | ForEach-Object { $_.Value }) -join ' / ')"
  # The app's window: its page process ends (out of memory, a graphics driver). The person should not be left with a blank window.
  Page '/app'
  [void](Cdp 'main' "(process.mainModule.require('electron').BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('127.0.0.1:4782')).webContents.forcefullyCrashRenderer(), 1)")
  Start-Sleep 8
  $alive = (Cdp '127.0.0.1:4782' "document.readyState + '|' + Boolean(document.querySelector('main'))").value
  Shot 'crash-app-window'
  Check 'crash-window-back' ($alive -match '^complete\|true') "the app's page after its process ended: '$alive'; app.log: $(([regex]::Matches((AppLog), '[^\r\n]*(page|window)[^\r\n]*(gone|crash|ended)[^\r\n]*') | Select-Object -Last 1).Value)"
  # The live scanning overlay's page process ends while scanning.
  Say "live: $(TrayClick 'Start scanning')"; [void](Until 30 { (Info 'info()').live.window }); Start-Sleep 5
  [void](Cdp 'main' "(process.mainModule.require('electron').BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('overlay.html')).webContents.forcefullyCrashRenderer(), 1)")
  Start-Sleep 3
  Say "Edge in front: $(Front 'msedge')"
  Start-Sleep 5
  [K]::Tap(0x11)
  $ov = (Cdp 'overlay.html' "document.readyState + '|' + Boolean(window.sentinelIsland)").value
  Check 'crash-overlay-back' ($ov -match '^complete\|true') "the overlay's page after its process ended: '$ov'"
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # Sentinel itself is ended (Task Manager, or a crash): does the next start say so, and does anything bring it back?
  $before = Starts
  StopSentinel
  Start-Sleep 60
  Say "  a minute after Sentinel was ended: $(@(MainProcs).Count) Sentinel running (it comes back at the next sign-in)"
  [void](StartSentinel); Start-Sleep 8
  Check 'crash-main-logged' ((AppLog) -match 'the last run did not quit normally') "the next start's log: $(((AppLog) -split "`n" | Select-Object -Last 6) -join ' | ')"

  # 9. The scanner's port taken by another program: Sentinel moves to the next one. Still signed in? Still reachable?
  [void](Quit)
  $squat = Start-Process python -ArgumentList '-m', 'http.server', '47821', '--bind', '127.0.0.1' -PassThru -NoNewWindow -RedirectStandardError (Join-Path $Out 'squat.log') -RedirectStandardOutput (Join-Path $Out 'squat.out.log')
  Start-Sleep 3
  Check 'port-restart' (StartSentinel) 'started with port 47821 taken'
  Start-Sleep 10
  $origin = (Info 'info()').origin
  $me = (Cdp '127.0.0.1:4782' "fetch('/api/v1/auth/me').then((x) => x.status)").value
  Shot 'port-taken'
  Check 'port-moved' ($origin -match ':4782[2-5]$') "the scanner is at $origin; the app's window: $(AppWindow)"
  Say "  a session from 47821 on ${origin}: $me (the browser companion is allowed 47821 only)"
  # Every port Sentinel tries taken: the person is told plainly, and it recovers by itself once one is free.
  [void](Quit)
  $squats = @(47822, 47823, 47824, 47825 | ForEach-Object { Start-Process python -ArgumentList '-m', 'http.server', "$_", '--bind', '127.0.0.1' -PassThru -WindowStyle Hidden })
  Start-Sleep 3
  Start-Process $exe -ArgumentList '--remote-debugging-port=9333', '--inspect=9334'
  $err = ''
  $ok = Until 60 { $script:err = [string](Cdp 'error.html' 'document.body.innerText').value; [bool]$script:err }
  Start-Sleep 2
  Shot 'ports-all-taken'
  Check 'ports-all-taken-told' ($ok -and $err -match 'Another program is using') "the error page says: $(($err -replace '\s+', ' ').Substring(0, [Math]::Min(300, ($err -replace '\s+', ' ').Length)))"
  @($squat) + $squats | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  $t0 = Get-Date
  $back = Until 150 { (Cdp '127.0.0.1:4782' '1').value -eq 1 }
  Check 'ports-recovered' $back "once the ports were free, the app came back by itself after $([int]((Get-Date) - $t0).TotalSeconds) s"
  Shot 'ports-recovered'

  # 10. The network gone (for Sentinel: a firewall rule, so the runner keeps its own connection). Local checks carry on.
  [void](Quit)
  New-NetFirewallRule -DisplayName 'core-qa no network for Sentinel' -Direction Outbound -Program $exe -Action Block -RemoteAddress Internet | Out-Null
  Check 'offline-start' (StartSentinel) 'started with no network'
  Start-Sleep 10
  Say "live: $(TrayClick 'Start scanning')"
  [void](Cdp 'main' $trayHook)
  Say "Edge in front: $(FreshEdge 'http://paypal-account-verify-login.test:47910/signin.html')"
  $t0 = Get-Date
  $ok = Until 60 { [K]::Tap(0x11); [bool](Cdp 'warn.html' '1').value }
  $took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  Shot 'offline-warning'
  Check 'offline-warning' $ok "a look-alike sign-in page with no network: warned $ok after $took s"
  [void](Cdp 'warn.html' 'window.close(), 1')
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  [void](Cdp 'main' "process.mainModule.require('./updater').check().then(() => 1)"); Start-Sleep 20
  Say "  updater with no network: $((Cdp 'main' "JSON.stringify(process.mainModule.require('./updater').status())").value); tray: $(TrayItems)"
  Remove-NetFirewallRule -DisplayName 'core-qa no network for Sentinel'

  # 10b. Signing out: both presses on the account button.
  Page '/app'
  $click = "(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); let b = null; for (let i = 0; i < 30; i++) { b = document.querySelector('[data-signout]'); if (b) { b.click(); await wait(300); if (b.getAttribute('aria-label') === 'Press again to sign out') break; } await wait(500); } b.click(); return 1; })()"
  [void](Cdp '127.0.0.1:4782' $click)
  $out = Until 20 { -not (Info 'info()').pairedUserId }
  Start-Sleep 4
  $where = AppWindow
  $after = Info 'info()'
  Shot 'signed-out'
  Check 'signout' ($out -and $where -match '/login') "signed out: unpaired $out; the app shows $where"
  Check 'signout-still-protected' ($after.deviceProtection -and $after.live -and $after.defense.enabled) "protection carries on under this computer's own account: $($after.deviceProtection); defense $($after.defense.active); downloads '$($after.downloads.reason)'"


  # 11. Quit from the tray: everything Sentinel started goes with it.
  [void](Cdp 'main' $trayHook); Start-Sleep 3
  Say "tray click: $(TrayClick 'Quit Sentinel')"
  $gone = Until 30 { -not (Get-Process Sentinel -ErrorAction SilentlyContinue) }
  Start-Sleep 3
  $left = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'EncodedCommand|sentinel' -and $_.ParentProcessId -ne $PID })
  Check 'quit-all-gone' ($gone -and -not $left.Count) "Sentinel gone $gone; helpers left behind: $($left.Count)"
}

# ---------------------------------------------------------------------------------------------------------------- use
if ($Part -eq 'use') {
  Install
  Feed $Installer
  New-Item -ItemType Directory -Force $data | Out-Null
  [IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"openAtLogin":false}')
  Start-Process $exe -ArgumentList '--hidden'
  Check 'start' (WaitUp) 'the installed app started and its scanner answers'
  Start-Sleep 15
  Pro
  StopSentinel
  Check 'restart' (StartSentinel) 'started with its debugging port'
  Start-Sleep 10
  # Signed in, with Pro, as most people who download Sentinel are.
  $r = Cdp '127.0.0.1:4782' "(async () => { const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.status); const a = { email: 'core-use-$(Get-Random)@example.com', password: 'Willow-harbour-83Pn' }; return [await post('/api/v1/auth/signup', Object.assign({ firstName: 'Kim', ageConfirmed: true, termsAccepted: true }, a)), await post('/api/v1/auth/login', Object.assign({ staySignedIn: true }, a))].join(','); })()"
  [void](Cdp '127.0.0.1:4782' "(location.href = '/app', 1)")
  Check 'signed-in' (Until 40 { [bool](Info 'info()').pairedUserId }) "sign-up, sign-in: $($r.value)"
  Pro
  [void](Cdp 'main' "(process.mainModule.require('./downloads').restart(), 1)")
  [void](Until 30 { (Info 'info()').downloads.active })
  HideApp

  # 1. Live scanning in Edge: real honest sites, typed into the address bar. Each should be checked and left alone.
  $honest = @(
    'https://en.wikipedia.org/wiki/Phishing', 'https://www.bbc.com/news', 'https://www.amazon.com/gift-cards/b?node=2238192011',
    'https://www.paypal.com/signin', 'https://accounts.google.com/', 'https://login.microsoftonline.com/', 'https://www.coinbase.com/',
    'https://github.com/login', 'https://www.irs.gov/', 'https://www.chase.com/'
  )
  function Visit($url) {
    # A site's own prompt (Chase asks to reach other apps) holds the keyboard: Escape first, as a person would.
    [K]::Tap(0x1B); [K]::Tap(0x11)
    [System.Windows.Forms.SendKeys]::SendWait('^l'); Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait($url); Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  function Verdict($browser, $url) {
    $re = "[^\r\n]* $browser [^\r\n]*https?://$([regex]::Escape(([Uri]$url).Host))[^\r\n]*"
    $n0 = ([regex]::Matches((WatchLog), $re)).Count
    $t0 = Get-Date
    Visit $url
    $script:line = $null
    $ok = Until 40 { [K]::Tap(0x11); $m = [regex]::Matches((WatchLog), $re); if ($m.Count -gt $n0) { $script:line = $m[$m.Count - 1].Value }; $m.Count -gt $n0 }
    return @{ ok = $ok; took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1); line = $script:line; warned = [bool](Cdp 'warn.html' '1').value }
  }
  function Sites($browser, $list) {
    $slow = @(); $wrong = @(); $times = @()
    foreach ($u in $list) {
      $v = Verdict $browser $u
      Say "  $browser $u -> $($v.took) s: $($v.line); warning window: $($v.warned)"
      if (-not $v.ok) { $slow += $u } else { $times += $v.took }
      if ($v.line -match " (red|orange) " -or $v.warned) { $wrong += "$u ($($v.line))"; [void](Cdp 'warn.html' 'window.close(), 1') }
    }
    Shot "$browser-honest"
    $avg = $(if ($times.Count) { [math]::Round(($times | Measure-Object -Average).Average, 1) } else { 0 })
    Check "$browser-honest-quiet" (-not $wrong.Count) "flagged or warned: $($wrong -join '; ')"
    Check "$browser-honest-checked" ($slow.Count -le 1) "checked $($times.Count) of $($list.Count), on average $avg s from Enter to the verdict (max $(($times | Measure-Object -Maximum).Maximum) s); not checked in 40 s: $($slow -join ', ')"
  }
  Say "Edge in front: $(FreshEdge 'about:blank')"
  Sites 'msedge' $honest
  # A search: marks beside the results.
  Visit 'https://duckduckgo.com/?q=paypal+login+help'
  $marks = ''
  $ok = Until 30 { [K]::Tap(0x11); $script:marks = [string](Cdp 'overlay.html' "[...document.querySelectorAll('#marks .mark')].map((n) => n.dataset.state || 'pending').join(',')").value; $script:marks -match 'clear|scam|warn' }
  Shot 'edge-search-marks'
  Check 'msedge-search-marks' $ok "marks beside the results: $marks"
  # When there are none: what Edge was showing (a real search engine may answer a runner with a check page) and what
  # live scanning last read, so a missing mark is told apart from a page with no results to mark.
  if (-not $ok) {
    Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { Say "  diag: Edge shows '$($_.MainWindowTitle)'" }
    (WatchLog) -split "`n" | Select-Object -Last 8 | ForEach-Object { Say "  diag watch.log: $_" }
  }
  # Stand-in scams: how long until the warning, and every button on it.
  function Warned($url) {
    $t0 = Get-Date
    Visit $url
    $ok = Until 40 { [K]::Tap(0x11); [bool](Cdp 'warn.html' '1').value }
    $took = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Start-Sleep 1
    $w = [string](Cdp 'warn.html' "document.body.innerText.replace(/\s+/g, ' ')").value
    return @{ ok = $ok; took = $took; words = $w }
  }
  $w = Warned 'http://paypal-account-verify-login.test:47910/signin.html'
  Shot 'edge-warning'
  $f = Fit 'warn.html' 'warning'
  Check 'msedge-scam-warned' ($w.ok -and $w.took -le 10) "a PayPal look-alike sign-in: warned after $($w.took) s: $($w.words)"
  Check 'warning-fits' $f.ok "inside $($f.view), out of view '$($f.outOfView)', on screen $($f.onScreen)"
  Check 'warning-names-browser' ($w.words -match 'Microsoft Edge') 'the warning names the browser it is about'
  [void](Cdp 'warn.html' "(document.getElementById('details').click(), 1)")
  $ok = Until 15 { (AppWindow) -match '^shown\|/app/scan\?url=' }
  $res = ''
  [void](Until 30 { $script:res = [string](Cdp '127.0.0.1:4782' "((document.querySelector('[data-out]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 200)").value; $script:res -match 'Phishing|Dangerous|Suspicious|scam' })
  Shot 'warning-open-in-sentinel'
  Check 'warning-open-in-sentinel' ($ok -and -not [bool](Cdp 'warn.html' '1').value) "Open in Sentinel: $(AppWindow); it shows: $res"
  HideApp
  Say "Edge in front: $(Front 'msedge')"
  $w = Warned 'http://paypal-resolution-center-secure.test:47910/signin.html'
  $real = [string](Cdp 'warn.html' "document.getElementById('real').textContent").value
  $n0 = ([regex]::Matches((WatchLog), 'https://www\.paypal\.com/')).Count
  [void](Cdp 'warn.html' "(document.getElementById('real').click(), 1)")
  $ok = Until 30 { [K]::Tap(0x11); ([regex]::Matches((WatchLog), 'https://www\.paypal\.com/')).Count -gt $n0 }
  Shot 'warning-real-site'
  Check 'warning-real-site' ($real -match 'paypal\.com' -and $ok) "'$real' opened the real site in the browser: $ok"
  Say "Edge in front: $(Front 'msedge')"
  $w = Warned 'http://microsoft-account-unlock-verify.test:47910/signin.html'
  [void](Cdp 'warn.html' "(document.getElementById('recover').click(), 1)")
  $ok = Until 15 { (AppWindow) -match '^shown\|(/app)?/recover\?happened=password' }
  Check 'warning-recover' ($w.ok -and $ok) "warned $($w.ok) after $($w.took) s; Open the recovery guide: $(AppWindow)"
  HideApp
  Say "Edge in front: $(Front 'msedge')"
  $w = Warned 'http://amazon-giftcard-claim-reward.test:47910/plain.html'
  Say "  an Amazon gift card look-alike: warned $($w.ok) after $($w.took) s: $($w.words)"
  if ($w.ok) {
    [void](Cdp 'warn.html' "(document.getElementById('close').click(), 1)")
    Check 'warning-got-it' (Until 10 { -not [bool](Cdp 'warn.html' '1').value }) 'Got it closes the warning'
  }
  # The pay pause on a real gift card page, now that pages were flagged: it is about that page, and leaves with it.
  Say "Edge in front: $(Front 'msedge')"
  Visit 'https://www.amazon.com/gift-cards/b?node=2238192011'
  $shown = Until 40 { [K]::Tap(0x11); (GuardMode) -match 'mode=pause' }
  Shot 'pay-pause'
  Visit 'https://en.wikipedia.org/wiki/Banana_bread'
  $gone = Until 20 { [K]::Tap(0x11); (GuardMode) -notmatch 'mode=pause' }
  Shot 'pay-pause-after-leaving'
  Check 'pay-pause-leaves-with-page' ($shown -and $gone) "shown on the gift card page $shown; gone once another site was open $gone"
  if ($shown -and -not $gone) { [void](Cdp 'guard.html' "window.sentinelDesktop.guardAction('dismiss'), 1") }
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # 2. The same in Chrome, with its own profile, as a person who uses Chrome.
  Start-Process "$chromeDir\chrome.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\chrome-core", '--start-maximized', 'about:blank'
  Start-Sleep 10
  Say "Chrome in front: $(Front 'chrome')"
  Sites 'chrome' @('https://en.wikipedia.org/wiki/Phishing', 'https://www.paypal.com/signin', 'https://accounts.google.com/', 'https://www.amazon.com/gift-cards/b?node=2238192011')
  $w = Warned 'http://paypal-wallet-limited-review.test:47910/signin.html'
  Shot 'chrome-warning'
  Check 'chrome-scam-warned' ($w.ok -and $w.took -le 10 -and $w.words -match 'Chrome') "a PayPal look-alike in Chrome: warned after $($w.took) s: $($w.words)"
  [void](Cdp 'warn.html' 'window.close(), 1')
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # 3. Download protection on harmless files of many kinds, each as it lands in Downloads.
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  function Zip($p, $entries) { $z = [IO.Compression.ZipFile]::Open($p, 'Create'); foreach ($k in $entries.Keys) { $e = $z.CreateEntry($k); $s = New-Object IO.StreamWriter($e.Open()); $s.Write($entries[$k]); $s.Dispose() }; $z.Dispose() }
  function Picture($p, $fmt) { $b = New-Object System.Drawing.Bitmap 320, 200; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::SteelBlue); $g.FillEllipse([System.Drawing.Brushes]::Gold, 100, 40, 120, 120); $g.Dispose(); $b.Save($p, $fmt); $b.Dispose() }
  function Bytes($p, $head, $kb) { $r = New-Object byte[] ($kb * 1KB); (New-Object Random 3).NextBytes($r); [Text.Encoding]::ASCII.GetBytes($head).CopyTo($r, 0); [IO.File]::WriteAllBytes($p, $r) }
  $pdf = "%PDF-1.4`n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 44>>stream`nBT /F1 18 Tf 20 100 Td (Rent receipt) Tj ET`nendstream endobj`ntrailer<</Root 1 0 R>>`n%%EOF"
  $docx = @{ '[Content_Types].xml' = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'; 'word/document.xml' = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Minutes of the meeting</w:t></w:r></w:p></w:body></w:document>' }
  $xlsx = @{ '[Content_Types].xml' = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'; 'xl/workbook.xml' = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' }
  $files = [ordered]@{
    'Rent receipt.pdf' = { param($p) [IO.File]::WriteAllText($p, $pdf) }
    'Meeting minutes.docx' = { param($p) Zip $p $docx }
    'Household budget.xlsx' = { param($p) Zip $p $xlsx }
    'Beach.jpg' = { param($p) Picture $p ([System.Drawing.Imaging.ImageFormat]::Jpeg) }
    'Chart.png' = { param($p) Picture $p ([System.Drawing.Imaging.ImageFormat]::Png) }
    'Wave.gif' = { param($p) Picture $p ([System.Drawing.Imaging.ImageFormat]::Gif) }
    'Song.mp3' = { param($p) Bytes $p 'ID3' 300 }
    'Clip.mp4' = { param($p) Bytes $p '    ftypisom' 2048 }
    'Notes.txt' = (Text "Call the dentist on Tuesday.`r`nBuy stamps.")
    'Contacts.csv' = (Text "name,phone`r`nAlex,555-0100`r`nSam,555-0101")
    'Recipe.html' = (Text '<!doctype html><title>Recipe</title><h1>Banana bread</h1><p>Three ripe bananas.</p>')
    'Settings.json' = (Text '{"theme":"dark","fontSize":14}')
    'Dinner.ics' = (Text "BEGIN:VCALENDAR`r`nVERSION:2.0`r`nBEGIN:VEVENT`r`nSUMMARY:Dinner`r`nDTSTART:20261020T190000Z`r`nEND:VEVENT`r`nEND:VCALENDAR")
    'Letter.eml' = (Text "From: Aunt May <may@example.com>`r`nTo: you@example.com`r`nSubject: Sunday lunch`r`n`r`nSee you at one o'clock.")
    'Photos.zip' = { param($p) Zip $p @{ 'a.txt' = 'one'; 'b.txt' = 'two' } }
    'Fonts.ttf' = { param($p) Copy-Item "$env:WINDIR\Fonts\arial.ttf" $p }
    'Notepad copy.exe' = { param($p) Copy-Item "$env:WINDIR\System32\notepad.exe" $p }
    'version copy.dll' = { param($p) Copy-Item "$env:WINDIR\System32\version.dll" $p }
    'Backup photos.bat' = (Text "@echo off`r`nxcopy `"%USERPROFILE%\Pictures`" `"D:\Backup\Pictures`" /E /I /Y`r`necho Done.")
    'Tidy downloads.ps1' = (Text "Get-ChildItem `"`$env:USERPROFILE\Downloads`" -Filter *.tmp | Remove-Item`r`nWrite-Output 'Tidied'")
  }
  $quiet = @(); $flagged = @(); $missed = @()
  foreach ($k in $files.Keys) {
    Arrive $k $files[$k]
    $ok = Until 60 { (DlLines $k) -ge 1 }
    $line = ([regex]::Match((AppLog), "download scanned: $([regex]::Escape($k)) [^\r\n]*")).Value
    $r = Recent $k
    Say "  $k -> $line; badge '$($r.badge)'"
    if (-not $ok) { $missed += $k } elseif ($r.badge) { $flagged += "$k ($($r.label): $($r.reason))" } else { $quiet += $k }
  }
  Check 'downloads-all-scanned' (-not $missed.Count) "scanned $($files.Count - $missed.Count) of $($files.Count); not scanned in 60 s: $($missed -join ', ')"
  Check 'downloads-harmless-clear' (-not $flagged.Count) "flagged: $($flagged -join '; ')"
  # Real downloads in Chrome, from a page on this runner: the part-file is not scanned, the finished file once.
  $site = Join-Path $env:RUNNER_TEMP 'dlsite'; New-Item -ItemType Directory -Force $site | Out-Null
  Zip (Join-Path $site 'Holiday plans.zip') @{ 'plan.txt' = 'Train at nine' }
  Zip (Join-Path $site 'Club newsletter.docx') $docx
  $dsrv = Start-Process python -ArgumentList '-m', 'http.server', '47911', '--bind', '127.0.0.1', '--directory', $site -PassThru -WindowStyle Hidden
  Start-Sleep 2
  foreach ($n in 'Holiday plans.zip', 'Club newsletter.docx') {
    Start-Process "$chromeDir\chrome.exe" -ArgumentList '--no-first-run', '--no-default-browser-check', "--user-data-dir=$env:RUNNER_TEMP\chrome-core", "http://127.0.0.1:47911/$([Uri]::EscapeDataString($n))"
    $ok = Until 60 { (DlLines $n) -ge 1 }
    Start-Sleep 8
    Check "downloads-chrome-$(($n -split '\.')[-1])" ($ok -and (DlLines $n) -eq 1 -and (AppLog) -notmatch 'download scanned: [^\r\n]*crdownload' -and -not (Recent $n).badge) "a real Chrome download of '$n': scanned $(DlLines $n) time(s), part-file scanned: $((AppLog) -match 'download scanned: [^\r\n]*crdownload'), badge '$((Recent $n).badge)'"
  }
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $dsrv.Id -Force -ErrorAction SilentlyContinue
  Page '/app/protection#downloads'
  $t = [string](Cdp '127.0.0.1:4782' "(document.getElementById('downloads') || {}).innerText || ''").value
  [void](Cdp '127.0.0.1:4782' "(document.getElementById('downloads').scrollIntoView(), 1)"); Start-Sleep 1
  Shot 'recent-downloads'
  Check 'downloads-listed' ($t -match 'Clear' -and $t -notmatch 'Quarantine') "Recent downloads: $(($t -replace '\s+', ' ').Substring(0, [Math]::Min(400, ($t -replace '\s+', ' ').Length)))"
  HideApp

  # 4. Chat safety on the Discord and Roblox stand-ins (Chrome under their names), on, then off.
  New-Item -ItemType HardLink -Path "$chromeDir\Discord.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
  New-Item -ItemType HardLink -Path "$chromeDir\RobloxPlayerBeta.exe" -Target "$chromeDir\chrome.exe" -Force | Out-Null
  [void](Info 'setChatSafety(true)')
  Say "Discord in front: $(Fake 'Discord' 'discord.html')"
  $seen = $null
  $ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.discord.flagged -ge 2 }
  Shot 'discord'
  Check 'chat-discord' $ok "Discord: $($seen.discord.checked) checked, $($seen.discord.flagged) flagged"
  Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $rlogs = "$env:LOCALAPPDATA\Roblox\logs"; New-Item -ItemType Directory -Force $rlogs | Out-Null
  Set-Content -Path "$rlogs\0.0.1_core_Player_last.log" -Value "2026-10-14T12:00:00.000Z,0.0,1,6 [FLog::Output] ! Joining game 'x' place 123 at 10.0.0.1" -Encoding ascii
  Say "Roblox in front: $(Fake 'RobloxPlayerBeta' 'roblox.html')"
  $ok = Until 40 { $script:seen = (Info 'info()').chatSafety.seen; $script:seen.roblox.flagged -ge 1 }
  Shot 'roblox'
  Check 'chat-roblox' $ok "Roblox: $($seen.roblox.checked) checked, $($seen.roblox.flagged) flagged"
  Get-Process RobloxPlayerBeta -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  [void](Info 'setChatSafety(false)')
  $before = (Info 'info()').chatSafety.seen.discord.checked
  Say "Discord in front, chat safety off: $(Fake 'Discord' 'discord.html')"
  Start-Sleep 15
  $after = (Info 'info()').chatSafety.seen.discord.checked
  $cards = [string](Cdp 'main' "(() => { const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('chat.html')); return w ? (w.isVisible() ? 'shown' : 'hidden') : 'none'; })()").value
  Shot 'discord-off'
  Check 'chat-off-reads-nothing' ($after -eq $before -and -not ((Info 'info()').chatSafety.running) -and $cards -ne 'shown') "chat safety off: messages checked $before then $after; the chat overlay: $cards"
  Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # 5. Ten quiet minutes, live scanning on and nothing in front: what Sentinel costs at rest, and whether it grows.
  Get-Process msedge, chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # A fresh install first fetches its threat lists (a quarter of an hour, in a worker): that is not rest. Waited out,
  # and what it cost written down.
  $c0 = @(Everything | Measure-Object CPU -Sum).Sum; $t0 = Get-Date
  $done = Until 1500 { (Get-Content "$data\logs\server.log" -Raw -ErrorAction SilentlyContinue) -match '\((\d+)/\1, \d+ s\)' }
  Say ("first threat lists fetched: $done, after a further {0:N0} s, using {1:N0} s of processor time; server.log: {2}" -f ((Get-Date) - $t0).TotalSeconds, (@(Everything | Measure-Object CPU -Sum).Sum - $c0), ((Get-Content "$data\logs\server.log" -ErrorAction SilentlyContinue | Select-String 'feed ' | Select-Object -Last 2) -join ' / '))
  for ($i = 0; $i -lt 18; $i++) {
    $a = @(Everything | Measure-Object CPU -Sum).Sum; Start-Sleep 20; $b = @(Everything | Measure-Object CPU -Sum).Sum
    Say ("settling: {0:N1} s of processor time in 20 s" -f ($b - $a))
    if (($b - $a) -lt 0.6) { break }
  }
  $f0 = Footprint 'before ten idle minutes'
  $t0 = Get-Date
  Start-Sleep 600
  $f1 = Footprint 'after ten idle minutes'
  $secs = ((Get-Date) - $t0).TotalSeconds
  $pct = [math]::Round(($f1.cpu - $f0.cpu) / $secs * 100, 2)
  Check 'idle-cpu' ($pct -le 1.5) "$([math]::Round($f1.cpu - $f0.cpu, 1)) s of processor time in $([int]$secs) s: $pct% of one core"
  Check 'idle-memory' (($f1.priv - $f0.priv) -le 40) "private memory $($f0.priv) MB then $($f1.priv) MB; in use $($f0.mb) MB then $($f1.mb) MB; processes $($f0.n) then $($f1.n)"

  # 6. 125% and 150% display scaling: the app's Live protection page, the warning, and the marks on a search.
  $modes = [Qa]::Modes()
  foreach ($s in @(@{ pct = 125; w = 1366; h = 768 }, @{ pct = 150; w = 1920; h = 1080 })) {
    $tag = "$($s.pct)"
    if ($modes -match "(^|,)$($s.w)x$($s.h)(,|$)") { [void][Qa]::Resolution($s.w, $s.h) }
    Start-Sleep 3
    [void][Qa]::SetScale($s.pct); Start-Sleep 5
    Check "scale-$tag-set" ([Qa]::Scale() -match "^$($s.pct)\|") "the display is at $([Qa]::Scale()), $([Qa]::GetSystemMetrics(0))x$([Qa]::GetSystemMetrics(1))"
    StopSentinel; [void](StartSentinel); Start-Sleep 10
    Page '/app/protection'
    $f = Fit '127.0.0.1:4782' "protection-$tag"
    $wide = [string](Cdp '127.0.0.1:4782' "[...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => e.tagName + '.' + e.className).join(', ')").value
    Shot "scale-$tag-protection"
    Check "scale-$tag-protection" ($f.onScreen -and -not $wide) "Live protection: window $($f.bounds) in $($f.work), wider than the window: '$wide'"
    HideApp
    Say "Edge in front: $(FreshEdge 'https://duckduckgo.com/?q=paypal+login+help')"
    $marks = ''
    $ok = Until 30 { [K]::Tap(0x11); $script:marks = [string](Cdp 'overlay.html' "[...document.querySelectorAll('#marks .mark')].map((n) => n.dataset.state || 'pending').join(',')").value; $script:marks -match 'clear|scam|warn' }
    Start-Sleep 3
    # Where each mark is against the result it belongs to: the overlay's window and the link, both in screen pixels.
    $place = [string](Cdp 'main' "(() => { const e = process.mainModule.require('electron'); const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('overlay.html')); return JSON.stringify({ b: w.getBounds(), s: e.screen.getDisplayMatching(w.getBounds()).scaleFactor }); })()").value
    Say "  overlay window: $place; marks: $marks"
    Shot "scale-$tag-search"
    Check "scale-$tag-marks" $ok "marks beside the results at ${tag}%: $marks"
    $w = Warned 'http://paypal-account-verify-login.test:47910/signin.html?scale'
    $f = Fit 'warn.html' "warning-$tag"
    Shot "scale-$tag-warning"
    Check "scale-$tag-warning" ($w.ok -and $f.ok) "the warning: inside $($f.view), out of view '$($f.outOfView)', window $($f.bounds) in $($f.work)"
    [void](Cdp 'warn.html' 'window.close(), 1')
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  [void][Qa]::SetScale(100)
  Start-Sleep 5

  # 7. Signed out, "Open in Sentinel" on a warning still says why, without asking for an account first.
  [void](Info 'clearToken()')
  [void](Cdp '127.0.0.1:4782' "fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => 1)")
  HideApp
  Say "Edge in front: $(FreshEdge 'about:blank')"
  $w = Warned 'http://apple-id-locked-support.test:47910/signin.html'
  [void](Cdp 'warn.html' "(document.getElementById('details').click(), 1)")
  $res = ''
  $ok = Until 30 { $script:res = [string](Cdp '127.0.0.1:4782' "location.pathname + '|' + ((document.querySelector('[data-out]') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 200)").value; $script:res -match '^/[^|]*\|.*(Phishing|Dangerous|Suspicious|scam)' }
  Shot 'warning-open-signed-out'
  Check 'warning-open-signed-out' ($w.ok -and $ok) "signed out, Open in Sentinel shows: $res"
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# ------------------------------------------------------------------------------------------------------------- update
if ($Part -eq 'update') {
  # 1. This commit installed and in use: signed in, live scanning and chat safety on, then tucked away in the tray.
  Install
  Feed $Installer
  New-Item -ItemType Directory -Force $data | Out-Null
  [IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":true,"chatSafety":true}')
  Check 'start' (StartSentinel) 'the installed app started with its debugging port'
  Start-Sleep 10
  $em = "core-update-$(Get-Random)@example.com"
  $r = Cdp '127.0.0.1:4782' "(async () => { const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.status); const a = { email: '$em', password: 'Copper-meadow-41Lx' }; return [await post('/api/v1/auth/signup', Object.assign({ firstName: 'Jo', ageConfirmed: true, termsAccepted: true }, a)), await post('/api/v1/auth/login', Object.assign({ staySignedIn: true }, a))].join(','); })()"
  [void](Cdp '127.0.0.1:4782' "(location.href = '/app', 1)")
  $paired = Until 40 { [bool](Info 'info()').pairedUserId }
  Check 'signed-in' $paired "sign-up, sign-in: $($r.value)"
  $pairedId = (Info 'info()').pairedUserId
  $runBefore = RunEntry
  # Quit as a person does (so the session is written), then the start at sign-in: in the tray, no debugging port.
  [void](Quit)
  Start-Process $exe -ArgumentList '--hidden'
  Check 'tray-start' (WaitUp) 'started in the tray'

  # 2. A newer build of this commit appears on the feed. Nobody touches anything.
  Feed $Next
  $want = Ver $Next
  $t0 = Get-Date
  $updated = $false
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-Date) -lt $deadline -and -not $updated) {
    Start-Sleep 15
    $v = Ver $exe
    $updated = $v -eq $want -and @(MainProcs).Count -ge 1
    Say "installed $v, Sentinel processes: $(@(Get-Process Sentinel -ErrorAction SilentlyContinue).Count); $(((AppLog) -split "`n" | Where-Object { $_ -match 'updat' } | Select-Object -Last 1))"
  }
  $took = [int]((Get-Date) - $t0).TotalMinutes
  $up = WaitUp
  Start-Sleep 15
  $ws = SentinelWindows
  Shot 'after-update'
  Check 'update-installed' $updated "from $version to $want by itself in about $took min (it waits for two idle minutes)"
  Check 'update-back-in-tray' ($up -and -not @($ws).Count) "running again and its scanner answers: $up; windows on screen: $(@($ws).Count) $($ws -join ' / ')"
  $s = Settings
  Check 'update-kept-settings' ($s.liveScanning -eq $true -and $s.chatSafety -eq $true -and $s.pairedUserId -eq $pairedId) "live scanning $($s.liveScanning), chat safety $($s.chatSafety), still paired with the same account $($s.pairedUserId -eq $pairedId)"
  $runAfter = RunEntry
  Check 'update-kept-startup' ($runAfter -and $runAfter.command -eq $runBefore.command -and (Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\SentinelScan\command')) "startup entry $($runAfter.command); right-click menu there"
  Check 'update-logged' ((AppLog) -match "updated to $([regex]::Escape($want))") "app.log: $(((AppLog) -split "`n" | Where-Object { $_ -match 'updat|installing' } | Select-Object -Last 4) -join ' | ')"
  $listed = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -match '^Sentinel' } | Select-Object -First 1
  Check 'update-listed' ($listed.DisplayVersion -eq $want) "Installed apps lists $($listed.DisplayVersion)"
  # The session kept: the new copy, opened, is still signed in (the window, once, with its debugging port).
  StopSentinel
  [void](StartSentinel); Start-Sleep 10
  $me = (Cdp '127.0.0.1:4782' "fetch('/api/v1/auth/me').then((x) => x.status)").value
  Check 'update-still-signed-in' ($me -eq 200) "the web app's session after the update: $me"
  $cache = "$env:LOCALAPPDATA\sentinel-desktop-updater"
  Say "updater cache after the update: $(if (Test-Path $cache) { "$([math]::Round(((Get-ChildItem $cache -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)) MB in $(@(Get-ChildItem $cache -Recurse -File).Count) files" } else { 'none' })"
  [void](Quit)

  # 3. Uninstalling, from Installed apps (its own uninstaller, silently), while Sentinel runs in the tray.
  Start-Process $exe -ArgumentList '--hidden'; [void](WaitUp)
  $un = [string]$listed.QuietUninstallString
  if (-not $un) { $un = "`"$(Join-Path (Split-Path $exe) 'Uninstall Sentinel.exe')`" /S" }
  Say "uninstalling: $un"
  if ($un -match '^"([^"]+)"\s*(.*)$') { Start-Process -FilePath $Matches[1] -ArgumentList $Matches[2] -Wait }
  [void](Until 60 { -not (Test-Path $exe) })
  Start-Sleep 10
  $left = @()
  if (Get-Process Sentinel -ErrorAction SilentlyContinue) { $left += "Sentinel still running" }
  if (Test-Path (Split-Path $exe)) { $left += "install folder: $((Get-ChildItem (Split-Path $exe) -Recurse -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ', ')" }
  foreach ($l in @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Sentinel.lnk", (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sentinel.lnk'))) { if (Test-Path $l) { $left += $l } }
  if (RunEntry) { $left += "startup entry: $((RunEntry).command)" }
  if (Test-Path -LiteralPath 'HKCU:\Software\Classes\*\shell\SentinelScan') { $left += 'right-click menu' }
  if (Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -match '^Sentinel' }) { $left += 'listed in Installed apps' }
  if (Test-Path $cache) { $left += "downloaded updates: $([math]::Round(((Get-ChildItem $cache -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)) MB in $cache" }
  Check 'uninstall-clean' (-not $left.Count) "left behind: $($left -join '; ')"
  Say "kept on purpose (the person's own data, for a reinstall): $data $(if (Test-Path $data) { "$([math]::Round(((Get-ChildItem $data -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1MB)) MB: $((Get-ChildItem $data -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ', ')" } else { 'gone' })"
}

if ($pages) { Stop-Process -Id $pages.Id -Force -ErrorAction SilentlyContinue }
Say '--- app.log'; Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-Object -Last 80 | ForEach-Object { Say "  $_" }
Get-Process Sentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Say "checks failed: $failed"
exit [int]($failed -gt 0)
