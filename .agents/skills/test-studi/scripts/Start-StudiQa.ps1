[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 9222,

  [string]$ProfileParent = [System.IO.Path]::GetTempPath(),

  [ValidateRange(1, 60)]
  [int]$ReadinessTimeoutSeconds = 15,

  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$profileParentPath = [System.IO.Path]::GetFullPath($ProfileParent)
if ($profileParentPath.Contains('"')) {
  throw "ProfileParent cannot contain a quote character."
}

$runId = "studi-e2e-qa-{0}-{1}" -f ([DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")), ([Guid]::NewGuid().ToString("N").Substring(0, 8))
$profilePath = Join-Path $profileParentPath $runId
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

New-Item -ItemType Directory -Path $profilePath -ErrorAction Stop | Out-Null
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
