[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
Set-Location -LiteralPath $workspaceRoot

& bun install
if ($LASTEXITCODE -ne 0) { throw "bun install failed" }

& node ".agents\skills\test-studi\scripts\sync-studi-qa-codex-auth.mjs" --import
if ($LASTEXITCODE -ne 0) { Write-Warning "No usable QA Codex cache. Build and non-agent tests can continue; agent flows need device login." }

& bun run build
if ($LASTEXITCODE -ne 0) { throw "bun run build failed" }
