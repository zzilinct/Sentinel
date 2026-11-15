# The release build's Electron fuses, on a GitHub-hosted Windows runner (desktop-e2e.yml "fuses", and release.yml
# before anything is published): no other program can run code as Sentinel through ELECTRON_RUN_AS_NODE, NODE_OPTIONS
# or --inspect, and the app still starts and answers. Never runs on a person's computer.
# -Control runs the same checks on Electron's own unfused exe, where each must find the door open: a check that cannot
# fail proves nothing.
param([string]$App = 'desktop/dist/win-unpacked/Sentinel.exe', [string]$Out = 'e2e-fuses', [switch]$Control)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
$App = (Resolve-Path $App).Path
$failed = 0
function Say($s) { $l = "$(Get-Date -Format HH:mm:ss) $s"; Add-Content "$Out\run.txt" $l; Write-Host $l }
function Check($name, $ok, $detail) {
  if ($Control -and $name -ne 'starts-and-answers') { $ok = -not $ok }
  $line = "$(if ($ok) { 'PASS' } else { 'FAIL' }) ${name}: $detail"
  if (-not $ok) { $script:failed++ }
  Say $line; Add-Content "$Out\results.txt" $line
}
function Until($seconds, [scriptblock]$test) { $end = (Get-Date).AddSeconds($seconds); while ((Get-Date) -lt $end) { if (& $test) { return $true }; Start-Sleep 2 }; return [bool](& $test) }
function Up { try { return (Invoke-WebRequest 'http://127.0.0.1:47821/api/v1/auth/config' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { return $false } }
$proc = [IO.Path]::GetFileNameWithoutExtension($App)
function StopApp { Get-Process $proc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; [void](Until 20 { -not (Get-Process $proc -ErrorAction SilentlyContinue) }) }

# What the exe itself says.
$read = (& npx --prefix desktop --no-install @electron/fuses read --app $App 2>&1 | Out-String)
Set-Content "$Out\fuses.txt" $read
foreach ($fuse in 'RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments') {
  Check "fuse-$fuse-off" ($read -match "$fuse is Disabled") (($read -split "`n" | Where-Object { $_ -match $fuse }) -join ' ').Trim()
}

# A program that sets NODE_OPTIONS to load its own code, and asks for the inspector: Sentinel starts as itself,
# answers, runs none of it and opens no inspector.
$marker = Join-Path $Out 'ran.txt'
$evil = Join-Path $Out 'evil.js'
Set-Content $evil "require('fs').writeFileSync($(ConvertTo-Json $marker), 'ran')"
$env:NODE_OPTIONS = "--require `"$evil`""
Start-Process $App -ArgumentList '--inspect=9334'
$env:NODE_OPTIONS = $null
if ($Control) { [void](Until 30 { Test-Path $marker }) } else { Check 'starts-and-answers' (Until 120 { Up }) 'http://127.0.0.1:47821 answers' }
$inspector = [bool](Get-NetTCPConnection -LocalPort 9334 -State Listen -ErrorAction SilentlyContinue)
Check 'no-inspector' (-not $inspector) "port 9334 listening: $inspector"
Check 'no-node-options' (-not (Test-Path $marker)) "code given in NODE_OPTIONS ran: $(Test-Path $marker)"
StopApp
Remove-Item $marker -ErrorAction SilentlyContinue

# ELECTRON_RUN_AS_NODE: the exe is not a Node any program can hand a script to.
$env:ELECTRON_RUN_AS_NODE = '1'
Start-Process $App -ArgumentList "`"$evil`""
$env:ELECTRON_RUN_AS_NODE = $null
[void](Until 15 { Test-Path $marker })
Check 'no-run-as-node' (-not (Test-Path $marker)) "a script handed to the exe ran: $(Test-Path $marker)"
StopApp

Say "$failed failed"
exit $failed
