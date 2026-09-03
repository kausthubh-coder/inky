[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$electronPath = Join-Path $workspaceRoot "node_modules\electron\dist\electron.exe"
$mainPath = Join-Path $workspaceRoot "dist\electron\main.js"
$rendererPath = Join-Path $workspaceRoot "dist\client\index.html"
$profilePath = Join-Path $workspaceRoot ".agents\studi-fresh\profile"

foreach ($requiredPath in @($electronPath, $mainPath, $rendererPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Built Studi artifact is missing: $requiredPath. Run bun run build first."
  }
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -eq "electron.exe" -and
    $_.CommandLine -and
    $_.CommandLine -like "*$workspaceRoot*"
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

if (Test-Path -LiteralPath $profilePath) {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
}

New-Item -ItemType Directory -Path $profilePath -ErrorAction Stop | Out-Null

$nativeArguments = '. --user-data-dir="{0}"' -f $profilePath
$process = Start-Process -FilePath $electronPath -WorkingDirectory $workspaceRoot -ArgumentList $nativeArguments -PassThru

Write-Host "Studi started fresh."
Write-Host "profile: $profilePath"
Write-Host "pid: $($process.Id)"
