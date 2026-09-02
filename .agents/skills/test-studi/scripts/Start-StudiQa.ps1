[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 9222,

  [string]$ProfileParent = [System.IO.Path]::GetTempPath(),

  [ValidateRange(1, 60)]
  [int]$ReadinessTimeoutSeconds = 15,

  [switch]$Persistent,

  [switch]$ResetPersistent,

  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($ResetPersistent -and -not $Persistent) {
  throw "-ResetPersistent requires -Persistent."
}

function Test-PortAvailable {
  param([int]$CandidatePort)

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
  try {
    $listener.Start()
    return $true
  } catch [System.Net.Sockets.SocketException] {
    return $false
  } finally {
    $listener.Stop()
  }
}

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
$electronPath = Join-Path $workspaceRoot "node_modules\electron\dist\electron.exe"
$mainPath = Join-Path $workspaceRoot "dist\electron\main.js"
$rendererPath = Join-Path $workspaceRoot "dist\client\index.html"

foreach ($requiredPath in @($electronPath, $mainPath, $rendererPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Built Studi artifact is missing: $requiredPath. Run npm run build first."
  }
}

if (-not (Test-PortAvailable -CandidatePort $Port)) {
  throw "CDP port $Port is already in use. Choose another loopback port and configure the Electron Playwright MCP to match."
}

if ($Persistent) {
  $profilePath = Join-Path $workspaceRoot ".studi-qa\profile"
} else {
  $profileParentPath = [System.IO.Path]::GetFullPath($ProfileParent)
  if ($profileParentPath.Contains('"')) {
    throw "ProfileParent cannot contain a quote character."
  }
  $runId = "studi-e2e-qa-{0}-{1}" -f ([DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
  $profilePath = Join-Path $profileParentPath $runId
}

if ($profilePath.Contains('"')) {
  throw "Profile path cannot contain a quote character."
}

$profileExisted = Test-Path -LiteralPath $profilePath -PathType Container
$profileHadData = $profileExisted -and @(Get-ChildItem -LiteralPath $profilePath -Force -ErrorAction SilentlyContinue).Count -gt 0
$profileReset = $false

if ($Persistent -and $ResetPersistent -and $profileExisted) {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
  $profileExisted = $false
  $profileHadData = $false
  $profileReset = $true
}

$cdpEndpoint = "http://127.0.0.1:$Port"
$launchArguments = @(
  ".",
  "--user-data-dir=$profilePath",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$Port"
)

if ($DryRun) {
  [ordered]@{
    schemaVersion = 1
    dryRun = $true
    persistent = [bool]$Persistent
    profileReused = [bool]($Persistent -and $profileHadData)
    profileReset = $profileReset
    workspaceRoot = $workspaceRoot
    executable = $electronPath
    profilePath = $profilePath
    cdpEndpoint = $cdpEndpoint
    launchArguments = $launchArguments
    processId = $null
    cdpReady = $null
  } | ConvertTo-Json -Depth 4 -Compress
  return
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Container)) {
  New-Item -ItemType Directory -Path $profilePath -ErrorAction Stop | Out-Null
}

$nativeArguments = '. --user-data-dir="{0}" --remote-debugging-address=127.0.0.1 --remote-debugging-port={1}' -f $profilePath, $Port
$startedAt = [DateTimeOffset]::UtcNow
$process = Start-Process -FilePath $electronPath -WorkingDirectory $workspaceRoot -ArgumentList $nativeArguments -PassThru

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($ReadinessTimeoutSeconds)
$cdpReady = $false
do {
  $process.Refresh()
  if ($process.HasExited) { break }
  try {
    $response = Invoke-RestMethod -Uri "$cdpEndpoint/json/version" -TimeoutSec 1
    if ($response.webSocketDebuggerUrl) {
      $cdpReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 200
  }
} while ([DateTimeOffset]::UtcNow -lt $deadline)

$receipt = [ordered]@{
  schemaVersion = 1
  dryRun = $false
  persistent = [bool]$Persistent
  profileReused = [bool]($Persistent -and $profileHadData)
  profileReset = $profileReset
  workspaceRoot = $workspaceRoot
  executable = $electronPath
  profilePath = $profilePath
  profileOwnedByHelper = $true
  cdpEndpoint = $cdpEndpoint
  launchArguments = $launchArguments
  processId = $process.Id
  startedAtUtc = $startedAt.ToString("o")
  cdpReady = $cdpReady
  processExited = $process.HasExited
}
$receipt | ConvertTo-Json -Depth 4 -Compress

if (-not $cdpReady) {
  exit 2
}
