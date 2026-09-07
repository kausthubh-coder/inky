[CmdletBinding()]
param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$')]
  [string]$ProfileName = "profile",
  [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
$receiptPath = Join-Path $workspaceRoot ".agents\studi-qa\runs\$ProfileName.json"
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.workspaceRoot -ne $workspaceRoot) { throw "Receipt belongs to another worktree" }
foreach ($ownedId in @($receipt.processId, $receipt.clerkHandoffProcessId)) {
  $ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ownedId"
  if (-not $ownedProcess) { continue }
  if ($ownedId -eq $receipt.processId) {
    $matchesOwner = $ownedProcess.ExecutablePath -eq $receipt.executable -and $ownedProcess.CommandLine.Contains($receipt.profilePath)
  } else {
    $matchesOwner = $ownedProcess.CommandLine.Contains((Join-Path $PSScriptRoot "clerk-qa-handoff.mjs")) -and $ownedProcess.CommandLine.Contains(([uri]$receipt.clerkClaimUrl).Port.ToString())
  }
  if (-not $matchesOwner -or $ownedProcess.CreationDate.ToUniversalTime() -gt ([datetime]$receipt.startedAtUtc).ToUniversalTime().AddSeconds(10)) {
    throw "Process $ownedId no longer matches this QA run; refusing to stop it"
  }
  if (-not $DryRun) {
    if ($ownedId -eq $receipt.processId) {
      # Electron owns a tray; Chromium Browser.close cannot quit it.
      $inspectorOwners = @(Get-NetTCPConnection -State Listen -LocalPort ([uri]$receipt.mainInspectorEndpoint).Port -ErrorAction SilentlyContinue)
      if ($inspectorOwners.OwningProcess -notcontains $ownedId) { throw "Inspector no longer belongs to this QA app" }
      & node (Join-Path $PSScriptRoot "close-studi-qa.mjs") $receipt.mainInspectorEndpoint
      if ($LASTEXITCODE -ne 0) { throw "QA app did not close cleanly; leaving the receipt for diagnosis" }
      Wait-Process -Id $ownedId -Timeout 15 -ErrorAction SilentlyContinue
      if (Get-Process -Id $ownedId -ErrorAction SilentlyContinue) { throw "QA app is still quitting; receipt retained" }
    } else { Stop-Process -Id $ownedId -ErrorAction SilentlyContinue }
  }
}
if (-not $DryRun) { Remove-Item -LiteralPath $receiptPath }
[ordered]@{ stopped = -not [bool]$DryRun; profilePath = $receipt.profilePath } | ConvertTo-Json -Compress
