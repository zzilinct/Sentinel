# Automatic updates, end to end, on a GitHub-hosted Windows desktop (never a person's computer). Two ways:
#   -Installer A -Next B  this commit built as two versions: A installed and in use, live scanning on, a browser left in
#                         front and nobody touching anything; B offered on a feed served on the runner. A must install B
#                         by itself (a browser in front is no reason to wait for ever), download only what changed (the
#                         block maps), come back in the tray without taking the browser's place in front, and remove
#                         the downloaded installer afterwards.
#   neither               the release before the latest, started in the tray as Windows starts it at sign-in, must
#                         update itself to the latest release.
# Logs go to $Out; exits 1 when a check failed.
param([string]$Out = 'update-e2e', [int]$Minutes = 20, [string]$Installer = '', [string]$Next = '')
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
$Out = (Resolve-Path $Out).Path
function Say($s) { $line = "$(Get-Date -Format HH:mm:ss) $s"; Write-Output $line; Add-Content -Path "$Out\run.txt" -Value $line -Encoding utf8 }
$failed = @()
function Check($name, $ok, $detail) { Say "$(if ($ok) { 'PASS' } else { 'FAIL' }) ${name}: $detail"; if (-not $ok) { $script:failed += $name } }
Add-Type -Namespace U -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);'
function FrontName { $p = 0; [void][U.W]::GetWindowThreadProcessId([U.W]::GetForegroundWindow(), [ref]$p); try { (Get-Process -Id $p).ProcessName } catch { '' } }

$exe = "$env:LOCALAPPDATA\Programs\Sentinel\Sentinel.exe"
$data = "$env:APPDATA\Sentinel"
$cache = "$env:LOCALAPPDATA\sentinel-desktop-updater"
$local = $Installer -and $Next
if ($local) {
  Start-Process $Installer -ArgumentList '/S' -Wait
  $from = (Get-Item $exe).VersionInfo.ProductVersion
  $want = (Get-Item $Next).VersionInfo.ProductVersion
  Say "installed $from; the feed offers $want"
  Check 'differential-base' (Test-Path "$cache\installer.exe") "the installer kept itself as $cache\installer.exe (what a differential download starts from)"
  # The feed: the next version's installer, its block map and latest.yml as electron-builder wrote them, and this
  # version's block map, as the two releases publish them.
  $feed = Join-Path $env:RUNNER_TEMP 'update-feed'; New-Item -ItemType Directory -Force $feed | Out-Null
  foreach ($f in @($Next, "$Next.blockmap", (Join-Path (Split-Path $Next) 'latest.yml'), "$Installer.blockmap")) { Copy-Item $f $feed }
  $feedLog = Join-Path $Out 'feed.log'
  $server = Start-Process node -ArgumentList (Join-Path $PSScriptRoot 'update-feed.js'), $feed, '47930', $feedLog -PassThru -NoNewWindow
  [IO.File]::WriteAllText((Join-Path (Split-Path $exe) 'resources\app-update.yml'), "provider: generic`nurl: http://127.0.0.1:47930/`nupdaterCacheDirName: sentinel-desktop-updater`nuseMultipleRangeRequest: false`n")
  New-Item -ItemType Directory -Force $data | Out-Null
  [IO.File]::WriteAllText("$data\settings.json", '{"openAtLogin":false,"liveScanning":true}')
  # A browser left in front, as when someone walks away from it.
  $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  Start-Process $edge -ArgumentList '--no-first-run', '--start-maximized', "--user-data-dir=$env:RUNNER_TEMP\edge-update", 'about:blank'
  Start-Sleep 8
  $w = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($w) { [void][U.W]::ShowWindow($w.MainWindowHandle, 3); [void][U.W]::SetForegroundWindow($w.MainWindowHandle) }
  Start-Process $exe -ArgumentList '--hidden'
  Start-Sleep 5
  $frontBefore = FrontName
  Say "in front: $frontBefore"
} else {
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
  $from = (Get-Item $exe).VersionInfo.ProductVersion
  $want = $latest.TrimStart('v')
  Say "installed: $from"
  New-Item -ItemType Directory -Force $data | Out-Null
  [IO.File]::WriteAllText("$data\settings.json", '{"openAtLogin":false}')
  Start-Process $exe -ArgumentList '--hidden'
}

$t0 = Get-Date
$deadline = (Get-Date).AddMinutes($Minutes)
$updated = $false
while ((Get-Date) -lt $deadline -and -not $updated) {
  Start-Sleep 15
  $v = (Get-Item $exe -ErrorAction SilentlyContinue).VersionInfo.ProductVersion
  $running = @(Get-Process Sentinel -ErrorAction SilentlyContinue).Count
  Say "installed $v, Sentinel processes: $running"
  # Any newer version counts: a release published while this runs is the one the app should take.
  if ($v -and [version]$v -gt [version]$from -and [version]$v -ge [version]$want -and $running -gt 0) { $updated = $true; $want = $v }
}
Start-Sleep 20
$windows = @(Get-Process Sentinel -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle }).Count
Check 'updated' $updated "from $from to $want by itself in about $([int]((Get-Date) - $t0).TotalMinutes) min"
Check 'back-in-tray' ($updated -and $windows -eq 0) "Sentinel windows showing: $windows (it comes back in the tray)"
if ($local) {
  $frontAfter = FrontName
  Check 'focus-kept' ($frontBefore -eq 'msedge' -and $frontAfter -eq 'msedge') "in front before the update: $frontBefore, after: $frontAfter (the browser left in front must still be)"
  # The download: only the blocks that changed, by the feed's own count of the installer's bytes it sent.
  $size = (Get-Item $Next).Length
  $sent = 0; Get-Content $feedLog -ErrorAction SilentlyContinue | ForEach-Object { $f = $_ -split ' '; if ($f[0] -eq (Split-Path $Next -Leaf)) { $sent += [int64]$f[2] } }
  Check 'differential' ($sent -gt 0 -and $sent -lt $size * 0.9) ("downloaded {0:N1} MB of the {1:N1} MB installer ({2:N0}%)" -f ($sent / 1MB), ($size / 1MB), ($sent * 100 / [math]::Max(1, $size)))
  # Removed at once, or half a minute later when the finishing installer still held it.
  Start-Sleep 40
  $left = @(Get-ChildItem $cache -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { "$($_.FullName.Substring($cache.Length + 1)) ($([math]::Round($_.Length / 1MB)) MB)" })
  Check 'download-removed' (-not (Test-Path "$cache\pending")) "updater cache after the update: $($left -join ', ')"
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
Copy-Item "$data\logs\*.log" $Out -ErrorAction SilentlyContinue
Get-Content "$data\logs\app.log" -ErrorAction SilentlyContinue | Select-String 'updat|installing|ready|Full:|differential|downloaded installer' | ForEach-Object { Say "  $_" }
if ($failed.Count) { Say "failed: $($failed -join ', ')"; exit 1 }
