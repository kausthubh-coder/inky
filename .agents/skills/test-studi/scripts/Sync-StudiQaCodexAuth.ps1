[CmdletBinding()]
param(
  [Parameter(Mandatory, ParameterSetName = "Import")]
  [switch]$Import,

  [Parameter(Mandatory, ParameterSetName = "Export")]
  [switch]$Export,

  [switch]$CopySecret,

  [string]$ProfilePath,

  [string]$CachePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
$nodeScript = Join-Path $PSScriptRoot "sync-studi-qa-codex-auth.mjs"
$nodeArgs = @($nodeScript)

if ($Import) { $nodeArgs += "--import" }
if ($Export) { $nodeArgs += "--export" }
if ($CopySecret) { $nodeArgs += "--copy-secret" }
if ($ProfilePath) { $nodeArgs += @("--profile", $ProfilePath) }
if ($CachePath) { $nodeArgs += @("--cache", $CachePath) }

& node @nodeArgs
exit $LASTEXITCODE
