[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
Set-Location -LiteralPath $workspaceRoot

& bun install
if ($LASTEXITCODE -ne 0) { throw "bun install failed" }

$authPath = Join-Path $workspaceRoot ".agents\studi-qa\codex-auth\auth.json"
if (Test-Path -LiteralPath $authPath -PathType Leaf) {
  & node ".agents\skills\test-studi\scripts\sync-studi-qa-codex-auth.mjs" --import | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The Studi QA Codex cache could not be hydrated" }
}

& bun run build
if ($LASTEXITCODE -ne 0) { throw "bun run build failed" }
