# Automatic updates, end to end, on a GitHub-hosted Windows desktop (never a person's computer): install the release
# before the latest, start it the way Windows starts it at sign-in (in the tray), touch nothing, and wait for it to
# update itself to the latest release and come back running. Logs go to $Out.
param([string]$Out = 'update-e2e', [int]$Minutes = 15)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
function Say($s) { $line = "$(Get-Date -Format HH:mm:ss) $s"; Write-Output $line; Add-Content -Path "$Out\run.txt" -Value $line -Encoding utf8 }

# Authenticated with the workflow's own token when there is one: anonymous calls from a shared runner hit the limit.
$headers = @{}
if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }
$releases = @(Invoke-RestMethod 'https://api.github.com/repos/zzilinct/Sentinel/releases?per_page=10' -Headers $headers) | ForEach-Object { $_ }
$stable = @($releases | Where-Object { -not $_.draft -and -not $_.prerelease })
if ($stable.Count -lt 2) { Say 'could not list the releases'; exit 1 }
$latest = $stable[0].tag_name; $previous = $stable[1].tag_name
Say "latest $latest, installing the one before it: $previous"
$setup = "$env:RUNNER_TEMP\Sentinel-Setup-old.exe"
Invoke-WebRequest "https://github.com/zzilinct/Sentinel/releases/download/$previous/Sentinel-Setup.exe" -OutFile $setup -UseBasicParsing
Start-Process $setup -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
Say "installed: $((Get-Item $exe).VersionInfo.ProductVersion)"

$data = "$env:APPDATA\Sentinel"; New-Item -ItemType Directory -Force $data | Out-Null
[IO.File]::WriteAllText("$data\settings.json", '{"openAtLogin":false}')
Start-Process $exe -ArgumentList '--hidden'

$want = $latest.TrimStart('v')
$deadline = (Get-Date).AddMinutes($Minutes)
$updated = $false
while ((Get-Date) -lt $deadline -and -not $updated) {
  Start-Sleep 15
  $v = (Get-Item $exe -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
  $running = @(Get-Process Sentinel -ErrorAction SilentlyContinue).Count
  Say "installed $v, Sentinel processes: $running"
  # Windows reports four parts ("1.6.14.0").
  if ($v -and ($v -eq $want -or $v -eq "$want.0") -and $running -gt 0) { $updated = $true }
}
Start-Sleep 10
$windows = @(Get-Process Sentinel -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle }).Count
Say "updated to $want and running again: $updated; Sentinel windows showing: $windows (should be 0: it comes back in the tray)"
Copy-Item "$data\logs\*.log" $Out -ErrorAction SilentlyContinue
Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-String 'updat|installing|ready' | ForEach-Object { Say "  $_" }
if (-not $updated) { exit 1 }
