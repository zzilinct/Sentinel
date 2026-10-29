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
. (Join-Path $PSScriptRoot 'desktop-e2e-lib.ps1')
Say "screen: $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds); per-monitor aware: $aware; scaling (now|recommended|largest): $([Qa]::Scale()); modes: $([Qa]::Modes())"

# "Scan with Sentinel" as Explorer runs it: the shell's own verb on the file. A file Explorer could not hand over this
# way (gone, or a path too long for the shell) gets the registered command line itself.
function RightClick($file) {
  try { Start-Process -FilePath $file -Verb SentinelScan -ErrorAction Stop; return 'verb' } catch {
    Start-Process -FilePath $exe -ArgumentList "`"--scan-file=$file`""; return "command ($($_.Exception.Message))"
  }
}
$scanExpr = "[document.getElementById('label').textContent, document.getElementById('name').textContent, document.getElementById('lead').textContent, document.getElementById('found').innerText.replace(/\s+/g, ' ')].join('|')"

# 1. Install, signed out, live scanning on. A first start puts "Scan with Sentinel" in the right-click menu.
Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
Feed $Installer; PointUpdater
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
  Say "scaling ${tag}%: set -> $r, now|recommended|largest: $now; screen $([Qa]::GetSystemMetrics(0))x$([Qa]::GetSystemMetrics(1))"
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
  Check "scale-$tag-warning" ($ok -and $f.ok) "the warning ('$rb'): inside $($f.view), out of view '$($f.outOfView)', $($f.wide), window $($f.bounds) in $($f.work), frameless $($f.frameless), cut off or scrolling '$($f.cut)'"
  # Put away with the keyboard alone, once clicked into: Tab stays on its buttons, Escape closes it.
  $k = KeyboardDismiss 'warn.html'
  Check "scale-$tag-warning-keyboard" ($k.focused -and $k.tab -and $k.closed) "clicked into: has the keyboard $($k.focused), Tab to '$($k.tab)', Escape closed it $($k.closed)"
  if (-not $k.closed) { [void](Cdp 'warn.html' 'window.close(), 1') }
  # Closed: "Did you type anything?"
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

# 5. Signed in (with "Stay signed in", ticked by default on the sign-in page): the right-click hands the file to the app's own scan, with the window brought forward from the tray.
StopSentinel
[void](StartSentinel); Start-Sleep 10
$r = Cdp '127.0.0.1:4782' "(async () => { const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (x) => x.status + (x.ok ? '' : ' ' + (await x.text()).slice(0, 160))); const a = { email: 'qa-desktop-$(Get-Random)@example.com', password: 'Amber-kettle-river-58Tq' }; return [await post('/api/v1/auth/signup', Object.assign({ firstName: 'Sam', ageConfirmed: true, termsAccepted: true }, a)), await post('/api/v1/auth/login', Object.assign({ staySignedIn: true }, a))].join(','); })()"
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
# Signed in and started cold from the right-click: the app opens on the file's answer. Sentinel is quit the way a person
# quits it, not ended: ended within half a minute of signing in, the browser part never wrote "Stay signed in" to disk.
[void](Cdp 'main' "(process.mainModule.require('electron').app.quit(), 1)")
[void](Until 30 { -not (Get-Process Sentinel -ErrorAction SilentlyContinue) })
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
