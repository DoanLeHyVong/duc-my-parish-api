param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$Checksum,
  [Parameter(Mandatory=$true)][string]$HostName
)
$ErrorActionPreference = 'Stop'
if ((git branch --show-current) -ne 'main') { throw 'Run from reviewed main branch.' }
$sha = (git rev-parse HEAD).Trim()
if ((Split-Path $Archive -Leaf) -ne "ducmy-api-$sha.tar.gz") { throw 'Artifact does not match main HEAD.' }
$expected = (Get-Content -LiteralPath $Checksum -Raw).Split(' ')[0].Trim().ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'SHA-256 mismatch.' }
& scp -o StrictHostKeyChecking=yes $Archive "deploy@${HostName}:/opt/ducmy/api/incoming/"
if ($LASTEXITCODE -ne 0) { throw 'Archive transfer failed.' }
& scp -o StrictHostKeyChecking=yes $Checksum "deploy@${HostName}:/opt/ducmy/api/incoming/"
if ($LASTEXITCODE -ne 0) { throw 'Checksum transfer failed.' }
Write-Output 'Transfer complete. Run api-release.sh --prepare explicitly, verify the SQL copy on Windows, perform the disposable restore check, then run --release.'
