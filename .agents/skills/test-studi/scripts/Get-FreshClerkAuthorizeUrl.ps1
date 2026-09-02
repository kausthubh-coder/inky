[CmdletBinding(DefaultParameterSetName = "Poll")]
param(
  [Parameter(Mandatory, ParameterSetName = "Poll")]
  [DateTimeOffset]$StartedAfterUtc,

  [Parameter(Mandatory, ParameterSetName = "Validate")]
  [string]$CandidateAuthorizationUrl,

  [ValidateRange(1, 60)]
  [int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-QueryParameters {
  param([System.Uri]$Uri)

  $parameters = @{}
  foreach ($part in $Uri.Query.TrimStart('?').Split('&', [System.StringSplitOptions]::RemoveEmptyEntries)) {
    $pieces = $part.Split('=', 2)
    $name = [System.Uri]::UnescapeDataString($pieces[0].Replace('+', ' '))
    $value = if ($pieces.Count -eq 2) { [System.Uri]::UnescapeDataString($pieces[1].Replace('+', ' ')) } else { "" }
    $parameters[$name] = $value
  }
  return $parameters
}

function Get-ValidatedReceipt {
  param(
    [string]$AuthorizationUrl,
    [string]$ExpectedClerkHost,
    [AllowNull()][object]$Process
  )

  $uri = $null
  if (-not [System.Uri]::TryCreate($AuthorizationUrl, [System.UriKind]::Absolute, [ref]$uri)) { return $null }
  if ($uri.Scheme -ne "https" -or $uri.Host -ne $ExpectedClerkHost -or $uri.AbsolutePath -ne "/oauth/authorize") { return $null }

  $query = Read-QueryParameters -Uri $uri
  foreach ($requiredName in @("redirect_uri", "state", "nonce", "code_challenge", "code_challenge_method")) {
    if (-not $query.ContainsKey($requiredName) -or [string]::IsNullOrWhiteSpace($query[$requiredName])) { return $null }
  }
  if ($query["code_challenge_method"] -ne "S256") { return $null }

  $redirectUri = $null
  if (-not [System.Uri]::TryCreate($query["redirect_uri"], [System.UriKind]::Absolute, [ref]$redirectUri)) { return $null }
  if ($redirectUri.Scheme -ne "http" -or $redirectUri.Host -ne "127.0.0.1" -or $redirectUri.AbsolutePath -ne "/callback" -or $redirectUri.Port -lt 1) { return $null }

  $processId = $null
  $browserProcess = "validation-only"
  $processCreatedAtUtc = $null
  if ($null -ne $Process) {
    $processId = [int]$Process.ProcessId
    $browserProcess = [string]$Process.Name
    $processCreatedAtUtc = ([DateTimeOffset]$Process.CreationDate).ToUniversalTime().ToString("o")
  }

  return [ordered]@{
    schemaVersion = 1
    authorizationUrl = $uri.AbsoluteUri
    clerkHost = $uri.Host
    redirectHost = $redirectUri.Host
    redirectPort = $redirectUri.Port
    redirectPath = $redirectUri.AbsolutePath
    pkceMethod = "S256"
    hasState = $true
    hasNonce = $true
    browserProcess = $browserProcess
    processId = $processId
    processCreatedAtUtc = $processCreatedAtUtc
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")
  }
}

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\..\.."))
$configPath = Join-Path $workspaceRoot "electron\auth\config.ts"
$config = Get-Content -Raw -LiteralPath $configPath
$issuerMatch = [regex]::Match($config, 'clerkIssuer:\s*"https://(?<host>[a-z0-9.-]+)"', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $issuerMatch.Success) {
  throw "Could not read the configured Clerk issuer host from electron/auth/config.ts."
}
$expectedClerkHost = $issuerMatch.Groups["host"].Value.ToLowerInvariant()

if ($PSCmdlet.ParameterSetName -eq "Validate") {
  $receipt = Get-ValidatedReceipt -AuthorizationUrl $CandidateAuthorizationUrl -ExpectedClerkHost $expectedClerkHost -Process $null
  if ($null -eq $receipt) { throw "The candidate is not a valid Studi Clerk S256 authorization URL with a loopback callback." }
  $receipt | ConvertTo-Json -Depth 4 -Compress
  return
}

$browserNames = @("chrome.exe", "msedge.exe", "firefox.exe", "zen.exe", "brave.exe")
$urlPattern = 'https://[^\s"'']+/oauth/authorize\?[^\s"'']+'
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)

do {
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $browserNames -contains $_.Name.ToLowerInvariant() -and
      $null -ne $_.CreationDate -and
      ([DateTimeOffset]$_.CreationDate).ToUniversalTime() -ge $StartedAfterUtc.ToUniversalTime() -and
      -not [string]::IsNullOrWhiteSpace($_.CommandLine)
    } |
    Sort-Object CreationDate -Descending

  foreach ($process in $processes) {
    foreach ($match in [regex]::Matches($process.CommandLine, $urlPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
      $receipt = Get-ValidatedReceipt -AuthorizationUrl $match.Value -ExpectedClerkHost $expectedClerkHost -Process $process
      if ($null -ne $receipt) {
        $receipt | ConvertTo-Json -Depth 4 -Compress
        return
      }
    }
  }
  Start-Sleep -Milliseconds 100
} while ([DateTimeOffset]::UtcNow -lt $deadline)

throw "No fresh validated Studi Clerk authorization URL appeared before the timeout."
