[CmdletBinding()]
param(
  [ValidateRange(0, 65535)]
  [int]$Port = 0,

  [ValidateRange(0, 65535)]
  [int]$ClerkHandoffPort = 0,

  [string]$ProfileParent = [System.IO.Path]::GetTempPath(),

  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$')]
  [string]$ProfileName = "profile",

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
if ($ProfileName -in @('runs', 'codex-auth')) { throw "ProfileName is reserved for QA tooling" }

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return $listener.LocalEndpoint.Port
  } finally { $listener.Stop() }
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

if ($Port -eq 0) { $Port = Get-FreePort }
if (-not (Test-PortAvailable -CandidatePort $Port)) {
  throw "CDP port $Port is already in use. Choose another loopback port and configure the Electron Playwright MCP to match."
}

if ($ClerkHandoffPort -eq 0) {
  do { $ClerkHandoffPort = Get-FreePort } while ($ClerkHandoffPort -eq $Port)
}
if ($ClerkHandoffPort -eq $Port -or -not (Test-PortAvailable -CandidatePort $ClerkHandoffPort)) {
  throw "Clerk handoff port $ClerkHandoffPort is unavailable. Choose a different loopback port."
}

if ($Persistent) {
  foreach ($ancestor in @((Join-Path $workspaceRoot '.agents'), (Join-Path $workspaceRoot '.agents\studi-qa'))) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "QA parent directories must not be linked" }
  }
  $profilePath = Join-Path $workspaceRoot ".agents\studi-qa\$ProfileName"
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
if ($profileExisted -and ((Get-Item -LiteralPath $profilePath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "QA profiles must not be linked or shared across worktrees" }
$profileHadData = $profileExisted -and @(Get-ChildItem -LiteralPath $profilePath -Force -ErrorAction SilentlyContinue).Count -gt 0
$profileReset = $false

# Unpackaged Electron does not take the installed app's single-instance lock.
# Refuse concurrent use of the same Chromium/SQLite profile explicitly.
$profileOwner = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=") -and $_.CommandLine.Contains($profilePath)
}
if ($profileOwner) { throw "QA profile is already running: $profilePath. Reuse its receipt or choose -ProfileName." }

$receiptPath = Join-Path $workspaceRoot ".agents\studi-qa\runs\$ProfileName.json"
if (-not $Persistent) {
  $ProfileName = $runId
  $receiptPath = Join-Path $workspaceRoot ".agents\studi-qa\runs\$ProfileName.json"
}
if (-not $DryRun) {
  New-Item -ItemType Directory -Path (Split-Path $receiptPath) -Force | Out-Null
  # Hold an exclusive launcher lock until exit, including reset and auth import.
  # A second launch racing this one cannot pass both the lock and process check.
  $launchLock = [IO.File]::Open("$receiptPath.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  trap { if ($launchLock) { $launchLock.Dispose() }; throw $_ }
  $profileOwner = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=") -and $_.CommandLine.Contains($profilePath)
  }
  if ($profileOwner) { throw "QA profile was just launched by another task: $profilePath" }
}
$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
try {
  $identityHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes("$($workspaceRoot.ToLowerInvariant())|$($ProfileName.ToLowerInvariant())"))).Replace('-', '').Substring(0, 12).ToLowerInvariant()
} finally { $hashAlgorithm.Dispose() }
$testEmail = "studi.qa.$identityHash+clerk_test@example.com"
$clerkConfig = Get-Content -LiteralPath (Join-Path $workspaceRoot "dist\electron\auth\config.js") -Raw
if ($clerkConfig -notmatch 'clerkIssuer:\s*"https://([a-z0-9.-]+\.clerk\.accounts\.dev)"') {
  throw "Built artifact must configure a development Clerk issuer."
}
$clerkHost = $Matches[1]

if (-not $DryRun -and $Persistent -and $ResetPersistent -and $profileExisted) {
  $expectedQaRoot = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot ".agents\studi-qa")) + [System.IO.Path]::DirectorySeparatorChar
  if (-not [System.IO.Path]::GetFullPath($profilePath).StartsWith($expectedQaRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Reset target is outside this worktree's QA directory" }
  if ((Get-Item -LiteralPath $profilePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to reset a linked profile" }
  Remove-Item -LiteralPath $profilePath -Recurse -Force
  $profileExisted = $false
  $profileHadData = $false
  $profileReset = $true
}

$cdpEndpoint = "http://127.0.0.1:$Port"
$clerkHandoffEndpoint = "http://127.0.0.1:$ClerkHandoffPort/publish"
$clerkClaimUrl = "http://127.0.0.1:$ClerkHandoffPort/claim"
do { $mainInspectorPort = Get-FreePort } while ($mainInspectorPort -eq $Port -or $mainInspectorPort -eq $ClerkHandoffPort)
$mainInspectorEndpoint = "http://127.0.0.1:$mainInspectorPort"
$launchArguments = @(
  ".",
  "--inspect=127.0.0.1:$mainInspectorPort",
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
    resetRequested = [bool]$ResetPersistent
    testEmail = $testEmail
    receiptPath = $receiptPath
    importCodexAuth = [bool]$ImportCodexAuth
    workspaceRoot = $workspaceRoot
    executable = $electronPath
    profilePath = $profilePath
    cdpEndpoint = $cdpEndpoint
    mainInspectorEndpoint = $mainInspectorEndpoint
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
$handoffProcess = Start-Process -FilePath $nodePath -WorkingDirectory $workspaceRoot -ArgumentList @(('"{0}"' -f $clerkHandoffScript), "--port", "$ClerkHandoffPort", "--clerk-host", $clerkHost) -WindowStyle Hidden -PassThru
$handoffDeadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
$handoffReady = $false
do {
  $handoffProcess.Refresh()
  if ($handoffProcess.HasExited) { break }
  try {
    $handoffHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$ClerkHandoffPort/health" -TimeoutSec 1
    if ($handoffHealth.ready -and $handoffHealth.processId -eq $handoffProcess.Id) { $handoffReady = $true; break }
  } catch {
    Start-Sleep -Milliseconds 100
  }
} while ([DateTimeOffset]::UtcNow -lt $handoffDeadline)
if (-not $handoffReady) {
  if (-not $handoffProcess.HasExited) { Stop-Process -Id $handoffProcess.Id -Force }
  throw "The isolated Clerk handoff did not become ready."
}

# Fingerprint imported modules and assets too: the entry point can stay unchanged
# while a rebuilt coordinator or renderer bundle contains the fix being tested.
$buildRoot = Join-Path $workspaceRoot 'dist'
$buildManifest = @(Get-ChildItem -LiteralPath $buildRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
  $relativeBuildPath = $_.FullName.Substring($buildRoot.Length + 1).Replace('\', '/')
  '{0} {1}' -f $relativeBuildPath, (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}) -join "`n"
$buildHasher = [System.Security.Cryptography.SHA256]::Create()
try {
  $buildTreeSha256 = [BitConverter]::ToString($buildHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($buildManifest))).Replace('-', '').ToLowerInvariant()
} finally { $buildHasher.Dispose() }

$nativeArguments = '. --user-data-dir="{0}" --remote-debugging-address=127.0.0.1 --remote-debugging-port={1} --studi-qa-clerk-handoff="{2}" --inspect=127.0.0.1:{3}' -f $profilePath, $Port, $clerkHandoffEndpoint, $mainInspectorPort
$startedAt = [DateTimeOffset]::UtcNow
try {
  $process = Start-Process -FilePath $electronPath -WorkingDirectory $workspaceRoot -ArgumentList $nativeArguments -WindowStyle Hidden -PassThru
} catch {
  Stop-Process -Id $handoffProcess.Id -Force -ErrorAction SilentlyContinue
  throw
}

$deadline = [DateTimeOffset]::UtcNow.AddSeconds($ReadinessTimeoutSeconds)
$cdpReady = $false
do {
  $process.Refresh()
  if ($process.HasExited) { break }
  try {
    $response = Invoke-RestMethod -Uri "$cdpEndpoint/json/version" -TimeoutSec 1
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($response.webSocketDebuggerUrl -and ($listeners.OwningProcess -contains $process.Id)) {
      $cdpReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 200
  }
} while ([DateTimeOffset]::UtcNow -lt $deadline)

$receipt = [ordered]@{
  schemaVersion = 1
  testEmail = $testEmail
  profileName = $ProfileName
  receiptPath = $receiptPath
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
  mainInspectorEndpoint = $mainInspectorEndpoint
  clerkClaimUrl = $clerkClaimUrl
  clerkHandoffProcessId = $handoffProcess.Id
  launchArguments = $launchArguments
  processId = $process.Id
  startedAtUtc = $startedAt.ToString("o")
  buildMainSha256 = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash.ToLowerInvariant()
  buildRendererSha256 = (Get-FileHash -LiteralPath $rendererPath -Algorithm SHA256).Hash.ToLowerInvariant()
  buildTreeSha256 = $buildTreeSha256
  cdpReady = $cdpReady
  processExited = $process.HasExited
}
if ($cdpReady) {
  New-Item -ItemType Directory -Path (Split-Path $receiptPath) -Force | Out-Null
  $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
  $watchScript = Join-Path $PSScriptRoot 'Watch-StudiQa.ps1'
  $watchArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ReceiptPath "{1}"' -f $watchScript, $receiptPath
  Start-Process -FilePath powershell.exe -ArgumentList $watchArguments -WindowStyle Hidden | Out-Null
}
$receipt | ConvertTo-Json -Depth 4 -Compress
if ($launchLock) { $launchLock.Dispose() }

if (-not $cdpReady) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  if (-not $handoffProcess.HasExited) { Stop-Process -Id $handoffProcess.Id -Force }
  exit 2
}
