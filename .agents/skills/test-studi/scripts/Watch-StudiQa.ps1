param([Parameter(Mandatory)][string]$ReceiptPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
$owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($receipt.processId)"
if (-not $owned -or $owned.ExecutablePath -ne $receipt.executable -or -not $owned.CommandLine.Contains($receipt.profilePath)) { exit 0 }
$process = [Diagnostics.Process]::GetProcessById($receipt.processId)
# Open the handle while the process exists so ExitCode remains available later.
$null = $process.Handle
$process.WaitForExit()
$exitReceipt = [ordered]@{
  processId = $receipt.processId
  profilePath = $receipt.profilePath
  exitedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  exitCode = $process.ExitCode
}
$exitReceipt | ConvertTo-Json -Compress | Set-Content -LiteralPath "$ReceiptPath.exit-$($receipt.processId).json" -Encoding UTF8
$relay = Get-CimInstance Win32_Process -Filter "ProcessId = $($receipt.clerkHandoffProcessId)"
if ($relay -and $relay.CommandLine.Contains((Join-Path $PSScriptRoot 'clerk-qa-handoff.mjs')) -and $relay.CommandLine.Contains(([uri]$receipt.clerkClaimUrl).Port.ToString())) {
  Stop-Process -Id $relay.ProcessId -ErrorAction SilentlyContinue
}
