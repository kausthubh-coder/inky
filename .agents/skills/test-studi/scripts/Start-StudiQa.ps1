[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 9222,

  [ValidateRange(0, 65535)]
  [int]$ClerkHandoffPort = 0,

  [string]$ProfileParent = [System.IO.Path]::GetTempPath(),

  [ValidateRange(1, 60)]
  [int]$ReadinessTimeoutSeconds = 30,

  [switch]$Persistent,

  [switch]$ResetPersistent,

  [switch]$ImportCodexAuth,

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
$clerkHandoffScript = Join-Path $PSScriptRoot "clerk-qa-handoff.mjs"

foreach ($requiredPath in @($electronPath, $mainPath, $rendererPath, $clerkHandoffScript)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Built Studi artifact is missing: $requiredPath. Run bun run build first."
  }
}

if (-not (Test-PortAvailable -CandidatePort $Port)) {
  throw "CDP port $Port is already in use. Choose another loopback port and configure the Electron Playwright MCP to match."
}

if ($ClerkHandoffPort -eq 0) {
  $ClerkHandoffPort = if ($Port -lt 65535) { $Port + 1 } else { 9223 }
}
if ($ClerkHandoffPort -eq $Port -or -not (Test-PortAvailable -CandidatePort $ClerkHandoffPort)) {
  throw "Clerk handoff port $ClerkHandoffPort is unavailable. Choose a different loopback port."
}

if ($Persistent) {
  $profilePath = Join-Path $workspaceRoot ".agents\studi-qa\profile"
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
$clerkHandoffEndpoint = "http://127.0.0.1:$ClerkHandoffPort/publish"
$clerkClaimUrl = "http://127.0.0.1:$ClerkHandoffPort/claim"
$launchArguments = @(
  ".",
  "--user-data-dir=$profilePath",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$Port",
  "--studi-qa-clerk-handoff=$clerkHandoffEndpoint"
)

if ($DryRun) {
  [ordered]@{
    schemaVersion = 1
    dryRun = $true
    persistent = [bool]$Persistent
    profileReused = [bool]($Persistent -and $profileHadData)
    profileReset = $profileReset
    importCodexAuth = [bool]$ImportCodexAuth
    workspaceRoot = $workspaceRoot
    executable = $electronPath
    profilePath = $profilePath
    cdpEndpoint = $cdpEndpoint
    clerkClaimUrl = $clerkClaimUrl
    launchArguments = $launchArguments
    processId = $null
    cdpReady = $null
  } | ConvertTo-Json -Depth 4 -Compress
  return
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Container)) {
  New-Item -ItemType Directory -Path $profilePath -ErrorAction Stop | Out-Null
}

$codexAuthImported = $false
$codexAuthMissing = $false
if ($ImportCodexAuth) {
  $syncScript = Join-Path $PSScriptRoot "Sync-StudiQaCodexAuth.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -Import -ProfilePath $profilePath | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $codexAuthImported = $true
  } else {
    $codexAuthMissing = $true
  }
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$handoffProcess = Start-Process -FilePath $nodePath -WorkingDirectory $workspaceRoot -ArgumentList @($clerkHandoffScript, "--port", "$ClerkHandoffPort", "--clerk-host", "novel-eel-63.clerk.accounts.dev") -WindowStyle Hidden -PassThru
$handoffDeadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
$handoffReady = $false
do {
  $handoffProcess.Refresh()
  if ($handoffProcess.HasExited) { break }
  try {
    $handoffHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$ClerkHandoffPort/health" -TimeoutSec 1
    if ($handoffHealth.ready) { $handoffReady = $true; break }
  } catch {
    Start-Sleep -Milliseconds 100
  }
} while ([DateTimeOffset]::UtcNow -lt $handoffDeadline)
if (-not $handoffReady) {
  if (-not $handoffProcess.HasExited) { Stop-Process -Id $handoffProcess.Id -Force }
  throw "The isolated Clerk handoff did not become ready."
}

$nativeArguments = '. --user-data-dir="{0}" --remote-debugging-address=127.0.0.1 --remote-debugging-port={1} --studi-qa-clerk-handoff="{2}"' -f $profilePath, $Port, $clerkHandoffEndpoint
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
  importCodexAuth = [bool]$ImportCodexAuth
  codexAuthImported = $codexAuthImported
  codexAuthMissing = $codexAuthMissing
  cdpEndpoint = $cdpEndpoint
  clerkClaimUrl = $clerkClaimUrl
  clerkHandoffProcessId = $handoffProcess.Id
  launchArguments = $launchArguments
  processId = $process.Id
  startedAtUtc = $startedAt.ToString("o")
  cdpReady = $cdpReady
  processExited = $process.HasExited
}
$receipt | ConvertTo-Json -Depth 4 -Compress

if (-not $cdpReady) {
  if (-not $handoffProcess.HasExited) { Stop-Process -Id $handoffProcess.Id -Force }
  exit 2
}
