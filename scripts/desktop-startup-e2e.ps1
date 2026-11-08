# Other programs' startup entries, end to end, on a GitHub-hosted Windows desktop: Discord, Teams, Slack, Spotify,
# GitHub Desktop and VS Code start at login the way they really do (a Squirrel Update.exe or their own program in
# %LOCALAPPDATA%, with arguments, from the Run key, the Startup folder and a scheduled task). Sentinel, installed from
# this commit with Defense on, must look at them, leave every one exactly as it was, and say nothing alarming about
# them. Never runs on a person's computer.
param([string]$Installer = '', [string]$Out = 'e2e-startup')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
function Say($s) { $l = "$(Get-Date -Format HH:mm:ss) $s"; Add-Content "$Out\run.txt" $l; Write-Host $l }
$failed = 0
function Check($name, $ok, $detail) {
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) ${name}: $detail"
  if (-not $ok) { $script:failed++ }
  Say $line; Add-Content "$Out\results.txt" $line
}
function Until($seconds, [scriptblock]$test) { $end = (Get-Date).AddSeconds($seconds); while ((Get-Date) -lt $end) { if (& $test) { return $true }; Start-Sleep 2 }; return [bool](& $test) }

# A small program signed by its maker stands in for each app's own (Git for Windows' git.exe, signed and on every
# runner): what Sentinel judges is a signed program in %LOCALAPPDATA% started with arguments, as the real ones are.
$signed = "$env:ProgramFiles\Git\cmd\git.exe"
Say "stand-in: $signed, signature $((Get-AuthenticodeSignature $signed).Status) by $((Get-AuthenticodeSignature $signed).SignerCertificate.Subject)"
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# A fresh runner has no Run key yet (the first run's entries were never written): made, never overwritten.
if (-not (Test-Path $run)) { New-Item -Path $run | Out-Null }
$startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
New-Item -ItemType Directory -Force $startup | Out-Null
$apps = @(
  @{ Name = 'Discord'; Exe = "$env:LOCALAPPDATA\Discord\Update.exe"; Args = '--processStart Discord.exe' },
  @{ Name = 'com.squirrel.Teams.Teams'; Exe = "$env:LOCALAPPDATA\Microsoft\Teams\Update.exe"; Args = '--processStart "Teams.exe" --process-start-args "--system-initiated"' },
  @{ Name = 'Spotify'; Exe = "$env:LOCALAPPDATA\Spotify\Spotify.exe"; Args = '--autostart --minimized' },
  @{ Name = 'Visual Studio Code'; Exe = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"; Args = '--startup' }
)
# Added after Sentinel is watching, so the change itself is what it hears.
$late = @{ Name = 'com.squirrel.slack.slack'; Exe = "$env:LOCALAPPDATA\slack\Update.exe"; Args = '--processStart "slack.exe" --process-start-args "--startup"' }
$lnkExe = "$env:LOCALAPPDATA\GitHubDesktop\Update.exe"
function Place($app) {
  New-Item -ItemType Directory -Force (Split-Path $app.Exe) | Out-Null
  Copy-Item $signed $app.Exe -Force
  Set-ItemProperty -Path $run -Name $app.Name -Value "`"$($app.Exe)`" $($app.Args)"
}
function Shortcut($path, $target, $arguments) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($path); $s.TargetPath = $target; $s.Arguments = $arguments; $s.Save()
}
foreach ($a in $apps) { Place $a }
$set = @($apps | Where-Object { (Get-ItemProperty $run -ErrorAction SilentlyContinue).($_.Name) })
Check 'entries-set' ($set.Count -eq $apps.Count) "Run values written before Sentinel is installed: $($set.Count) of $($apps.Count)"
New-Item -ItemType Directory -Force (Split-Path $lnkExe) | Out-Null
Copy-Item $signed $lnkExe -Force
Shortcut "$startup\GitHub Desktop.lnk" $lnkExe '--processStart GitHubDesktop.exe'
Register-ScheduledTask -TaskName 'Discord Update Check' -Action (New-ScheduledTaskAction -Execute "$env:LOCALAPPDATA\Discord\Update.exe" -Argument '--checkForUpdate') -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Force | Out-Null

# What everything is before Sentinel: compared at the end.
function Snapshot {
  $s = [ordered]@{}
  $values = @((Get-ItemProperty $run).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Name -notmatch 'Sentinel' })
  foreach ($p in $values) { $s["run:$($p.Name)"] = [string]$p.Value }
  foreach ($f in Get-ChildItem $startup -File) { $s["startup:$($f.Name)"] = (Get-FileHash $f.FullName).Hash }
  foreach ($e in @($apps + $late) | ForEach-Object { $_.Exe }) { if (Test-Path $e) { $s["file:$e"] = (Get-FileHash $e).Hash } }
  $s["file:$lnkExe"] = (Get-FileHash $lnkExe).Hash
  $t = Get-ScheduledTask -TaskName 'Discord Update Check' -ErrorAction SilentlyContinue
  $s['task:Discord Update Check'] = if ($t) { "$($t.State) $($t.Actions[0].Execute) $($t.Actions[0].Arguments)" } else { 'gone' }
  return $s
}

Start-Process $Installer -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed -> $((Get-Item $exe).VersionInfo.ProductVersion)"
$data = "$env:APPDATA\Sentinel"
New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"liveScanning":false,"openAtLogin":false}')
Start-Process $exe -ArgumentList '--hidden'
$up = Until 180 { try { (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }
Check 'start' $up 'the installed app started and its scanner answers'
# Sentinel's own login entry is its own; everything else is snapshotted now, with Sentinel running.
$before = Snapshot
Say "before: $($before | ConvertTo-Json -Compress)"

# Defense's first look at startup entries waits 75 s after it starts (not while the computer is still starting up).
$log = "$data\logs\app.log"
$first = Until 150 { Test-Path "$data\defense-vetted.json" }
Say "first look written: $first"
# Then a new entry and a new shortcut while it watches: Slack added to the Run key, a Teams shortcut in the Startup folder.
Place $late
Shortcut "$startup\Microsoft Teams.lnk" "$env:LOCALAPPDATA\Microsoft\Teams\Update.exe" '--processStart "Teams.exe"'
# And an unsigned helper some program puts in the Startup folder, whose contents look bad to the on-device scan (the
# inert sample the unit tests use): warning signs, no proof. Sentinel may tell the person; it must not move it.
$helper = "$startup\MacroHelper.exe"
node -e "require('fs').writeFileSync(process.argv[1], require(process.argv[2]).fakeStealerExe())" $helper (Join-Path $PSScriptRoot '..\tests\fixtures.js')
$before["run:$($late.Name)"] = [string](Get-ItemProperty $run).($late.Name)
$before["file:$($late.Exe)"] = (Get-FileHash $late.Exe).Hash
$before['startup:Microsoft Teams.lnk'] = (Get-FileHash "$startup\Microsoft Teams.lnk").Hash
$heard = Until 120 { (Get-Content $log -Raw -ErrorAction SilentlyContinue) -match 'new startup entry HKCU Run\\com\.squirrel\.slack\.slack' }
Start-Sleep 20

$vetted = Get-Content "$data\defense-vetted.json" -Raw -ErrorAction SilentlyContinue
$looked = @(@($apps + $late) | ForEach-Object { $_.Exe } | Where-Object { $vetted -and $vetted.ToLower().Contains($_.ToLower().Replace('\', '\\')) })
Check 'looked-at' ($looked.Count -eq ($apps.Count + 1)) "programs Defense read and found clean: $($looked.Count) of $($apps.Count + 1) ($($looked -join ', '))"
Check 'heard-new-entry' $heard 'the Slack entry added while Sentinel ran was noticed'

$after = Snapshot
$changed = @($before.Keys | Where-Object { $before[$_] -ne $after[$_] } | ForEach-Object { "$_ was '$($before[$_])' now '$($after[$_])'" })
Check 'untouched' ($changed.Count -eq 0) "every Run value, Startup shortcut, program and the scheduled task as they were: $(if ($changed.Count) { $changed -join '; ' } else { "$($before.Count) compared" })"

$ledger = @()
try { $ledger = @(Get-Content "$data\defense.json" -Raw | ConvertFrom-Json) } catch { }
$alarms = @($ledger | Where-Object { $_.kind -in 'threat', 'suspect', 'noted' -and $_.name -ne 'MacroHelper.exe' })
Check 'nothing-alarming' ($alarms.Count -eq 0) "Defense entries about the six apps: $($alarms.Count) $(($alarms | ForEach-Object { "$($_.kind) $($_.name): $($_.label)" }) -join '; ')"
$h = @($ledger | Where-Object { $_.name -eq 'MacroHelper.exe' })
Check 'startup-arrival-left' ((Test-Path $helper) -and -not ($h | Where-Object { $_.quarantined -or $_.kind -eq 'threat' })) "the helper that appeared in the Startup folder is still there: $(Test-Path $helper); Defense said: $(($h | ForEach-Object { "$($_.kind) $($_.label): $(($_.actions | ForEach-Object { $_.did }) -join ', ')" }) -join '; ')"
$text = Get-Content $log -Raw -ErrorAction SilentlyContinue
$bad = @(($text -split "`n") | Where-Object { $_ -match 'Discord|Teams|slack|Spotify|Code\.exe|GitHub ?Desktop|Update\.exe' -and $_ -match 'threat|suspect|quarantin|removed|ended|flagged' })
Check 'log-calm' ($bad.Count -eq 0) "app.log lines about a Defense response: $($bad.Count) $($bad -join ' | ')"

Say '--- app.log'; Get-Content $log -ErrorAction SilentlyContinue | Select-Object -Last 40 | ForEach-Object { Say "  $_" }
Get-Process Sentinel -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Say "checks failed: $failed"
exit [int]($failed -gt 0)
