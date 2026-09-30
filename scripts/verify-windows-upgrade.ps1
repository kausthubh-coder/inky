param(
  [Parameter(Mandatory=$true)][string]$Artifacts,
  [ValidateSet('setup','updater')][string]$Mode = 'setup',
  [string]$Output = 'native-proof/windows'
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_EVENT_NAME -ne 'workflow_dispatch') {
  throw 'Installer proof requires a disposable GitHub-hosted Windows manual run'
}
$candidateDirectory = (Resolve-Path -LiteralPath $Artifacts).Path
$outputDirectory = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$baselineDirectory = Join-Path $env:RUNNER_TEMP ('studi-baseline-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $baselineDirectory | Out-Null
$profileDirectory = Join-Path $env:RUNNER_TEMP ('studi-upgrade-profile-' + [guid]::NewGuid())
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-PackageIdentity([string]$Directory) {
  $packages = @(Get-ChildItem -LiteralPath $Directory -Filter '*-full.nupkg')
  if ($packages.Count -ne 1) { throw 'Expected exactly one full package' }
  $zip = [IO.Compression.ZipFile]::OpenRead($packages[0].FullName)
  try {
    $specs = @($zip.Entries | Where-Object FullName -Match '^[^/]+\.nuspec$')
    if ($specs.Count -ne 1) { throw 'Package identity is ambiguous' }
    $reader = [IO.StreamReader]::new($specs[0].Open())
    try { [xml]$spec = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $id = $spec.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='id']").InnerText
    $version = $spec.SelectSingleNode("//*[local-name()='metadata']/*[local-name()='version']").InnerText
    if ($id -ne 'studi' -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected Studi package identity' }
    return @{ Id=$id; Version=$version }
  } finally { $zip.Dispose() }
}
function Run-Installer([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(180000)) { throw 'Installer timed out' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
function Stop-InstalledApp([string]$Root) {
  $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and $_.Name -eq 'Studi.exe' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
function Assert-InstalledBytes([string]$Directory, [string]$AppDirectory) {
  $package = @(Get-ChildItem -LiteralPath $Directory -Filter '*-full.nupkg')[0]
  $zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
  try {
    foreach ($relative in @('Studi.exe', 'resources/app.asar')) {
      $entries = @($zip.Entries | Where-Object { $_.FullName -eq ('lib/net45/' + $relative) })
      if ($entries.Count -ne 1) { throw "Missing unique packaged file: $relative" }
      $stream = $entries[0].Open()
      try { $expected = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
      $actual = (Get-FileHash -LiteralPath (Join-Path $AppDirectory $relative) -Algorithm SHA256).Hash
      if ($expected -ne $actual) { throw "Installed bytes differ from candidate package: $relative" }
    }
  } finally { $zip.Dispose() }
}
$candidate = Read-PackageIdentity $candidateDirectory
if ([version]$candidate.Version -le [version]'0.1.10') { throw 'Candidate must be newer than v0.1.10' }
$installRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA $candidate.Id))
if (Test-Path -LiteralPath $installRoot) { throw 'Studi is already installed; refusing to touch it' }
if (Get-Process Studi -ErrorAction SilentlyContinue) { throw 'Studi is already running' }
& gh release download v0.1.10 --repo kausthubh-coder/inky --pattern Studi-Setup.exe --pattern '*-full.nupkg' --pattern SHA256SUMS.txt --dir $baselineDirectory
if ($LASTEXITCODE -ne 0) { throw 'Baseline download failed' }
foreach ($file in Get-ChildItem -LiteralPath $baselineDirectory | Where-Object Name -ne 'SHA256SUMS.txt') {
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $line = Get-Content -LiteralPath (Join-Path $baselineDirectory 'SHA256SUMS.txt') | Where-Object { $_ -match ('^' + $hash + '\s+\*?' + [regex]::Escape($file.Name) + '$') }
  if (-not $line) { throw "Baseline checksum mismatch: $($file.Name)" }
}
$baseline = Read-PackageIdentity $baselineDirectory
if ($baseline.Id -ne $candidate.Id -or $baseline.Version -ne '0.1.10') { throw 'Baseline package identity mismatch' }
try {
  Run-Installer (Join-Path $baselineDirectory 'Studi-Setup.exe') @('--silent')
  Stop-InstalledApp $installRoot
  $baselineExe = Join-Path $installRoot 'app-0.1.10/Studi.exe'
  & node scripts/verify-windows-launch.mjs $baselineExe $profileDirectory '0.1.10' seed $outputDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Baseline installed launch failed' }
  Stop-InstalledApp $installRoot
  if ($Mode -eq 'setup') {
    Run-Installer (Join-Path $candidateDirectory 'Studi-Setup.exe') @('--silent')
  } else {
    Run-Installer (Join-Path $installRoot 'Update.exe') @('--update', ('"' + $candidateDirectory + '"'))
  }
  Stop-InstalledApp $installRoot
  $candidateExe = Join-Path $installRoot ('app-' + $candidate.Version + '/Studi.exe')
  Assert-InstalledBytes $candidateDirectory (Split-Path -Parent $candidateExe)
  & node scripts/verify-windows-launch.mjs $candidateExe $profileDirectory $candidate.Version verify $outputDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Candidate installed launch or persistence failed' }
  Stop-InstalledApp $installRoot
  & node scripts/verify-windows-launch.mjs $candidateExe $profileDirectory $candidate.Version verify (Join-Path $outputDirectory 'restart')
  if ($LASTEXITCODE -ne 0) { throw 'Candidate restart failed' }
  $assets = @(Get-ChildItem -LiteralPath $candidateDirectory -File | ForEach-Object { @{name=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
  $receipt = @{checkId='windows-installed-upgrade'; status='passed'; sourceRevision=$env:GITHUB_SHA; artifactRunId=[long]$env:GITHUB_RUN_ID; mode=$Mode; assets=$assets; observations=@(
    @{status='passed'; expected='Published v0.1.10 installed and saved a setting through production IPC'; observed='Verified published hashes, installed version and saved disabled analytics/replay'},
    @{status='passed'; expected='Exact candidate upgrades the installed app and retains the setting through restart'; observed="Installed $($candidate.Version) via $Mode, verified production renderer/auth IPC, privacy preferences and second launch"}
  ); limits=@('Signed-out disposable Windows runner; full authenticated homework/credential migration requires separate live evidence')}
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDirectory 'windows-installed-upgrade.json')
} finally {
  Stop-InstalledApp $installRoot
}
