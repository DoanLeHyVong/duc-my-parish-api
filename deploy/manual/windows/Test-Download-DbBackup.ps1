$ErrorActionPreference = 'Stop'
$sha = 'a' * 40
$name = "ducmy-$sha-20261112T000000Z.sql"
$root = Join-Path $env:TEMP ('ducmy-download-test-' + [guid]::NewGuid().ToString('N'))
$remoteDir = Join-Path $root 'remote'
$localDir = Join-Path $root 'local'
New-Item -ItemType Directory -Path $remoteDir -Force | Out-Null
$global:mockRemoteDir = $remoteDir
$global:mockUploads = 0
function scp {
  $argsList = @($args)
  $src = $argsList[-2]
  $dst = $argsList[-1]
  if ($src -like 'deploy@*') {
    $base = ($src -split '/')[-1]
    Copy-Item -LiteralPath (Join-Path $global:mockRemoteDir $base) -Destination $dst
  } else {
    $global:mockUploads++
    Copy-Item -LiteralPath $src -Destination (Join-Path $global:mockRemoteDir (($dst -split '/')[-1]))
  }
  $global:LASTEXITCODE = 0
}
try {
  $dump = Join-Path $remoteDir $name
  [IO.File]::WriteAllText($dump, 'CREATE TABLE example(id int);', [Text.Encoding]::ASCII)
  $hash = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$dump.sha256", "$hash  $name`n", [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText("$dump.manifest", "release_sha=$sha`nbackup_sha256=$hash`nchallenge=$('b' * 64)`ncreated_unix=1`n", [Text.Encoding]::ASCII)
  try {
    & (Join-Path $PSScriptRoot 'Download-DbBackup.ps1') -HostName 'test-host' -BackupName $name -DestinationDirectory $localDir | Out-Null
  } catch {
    Write-Output $_.ScriptStackTrace
    throw
  }
  if ($global:mockUploads -ne 1 -or -not (Test-Path -LiteralPath "$dump.copy-receipt")) { throw 'No verified receipt was uploaded.' }
  Remove-Item -LiteralPath "$dump.copy-receipt" -Force
  $global:mockUploads = 0
  [IO.File]::AppendAllText("$dump.sha256", 'tamper', [Text.Encoding]::ASCII)
  try {
    & (Join-Path $PSScriptRoot 'Download-DbBackup.ps1') -HostName 'test-host' -BackupName $name -DestinationDirectory (Join-Path $root 'second-copy') | Out-Null
    throw 'Tampered manifest was accepted.'
  } catch {
    if ($_.Exception.Message -eq 'Tampered manifest was accepted.') { throw }
  }
  if ($global:mockUploads -ne 0) { throw 'A receipt was uploaded for a tampered manifest.' }
  'PowerShell download contract PASS'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force
}
