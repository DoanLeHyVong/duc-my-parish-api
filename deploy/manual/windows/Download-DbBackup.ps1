param(
  [Parameter(Mandatory=$true)][string]$HostName,
  [Parameter(Mandatory=$true)][string]$BackupName,
  [Parameter(Mandatory=$true)][string]$DestinationDirectory
)
$ErrorActionPreference = 'Stop'
if ($BackupName -notmatch '^ducmy-([0-9a-f]{40})-\d{8}T\d{6}Z\.sql$') { throw 'Invalid backup name.' }
$releaseSha = $Matches[1]
$destination = [IO.Path]::GetFullPath($DestinationDirectory)
$workspace = [IO.Path]::GetFullPath('D:\AppGLV')
$parent = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($destination))
while ($null -ne $parent) {
  if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup path must not pass through a junction or symlink.' }
  if (Test-Path -LiteralPath (Join-Path $parent.FullName '.git')) { throw 'Backup path must not be inside a Git repository.' }
  $parent = $parent.Parent
}
if ($destination -eq $workspace -or $destination.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Store SQL backups outside D:\AppGLV and all Git repositories.'
}
if ($destination.TrimEnd([IO.Path]::DirectorySeparatorChar) -eq [IO.Path]::GetPathRoot($destination).TrimEnd([IO.Path]::DirectorySeparatorChar)) {
  throw 'Choose a dedicated backup directory, not a drive root.'
}
if (Test-Path -LiteralPath $destination) { throw 'Choose a new dedicated backup directory; existing directories will not have ACLs changed.' }
New-Item -ItemType Directory -Path $destination | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $destination -AclObject $acl

$remote = "deploy@${HostName}:/var/backups/ducmy/$BackupName"
foreach ($suffix in @('', '.sha256', '.manifest')) {
  & scp -o StrictHostKeyChecking=yes "${remote}${suffix}" $destination
  if ($LASTEXITCODE -ne 0) { throw "SCP failed for backup artifact$suffix." }
}
$dump = Join-Path $destination $BackupName
$checksum = Join-Path $destination ($BackupName + '.sha256')
$manifestFile = Join-Path $destination ($BackupName + '.manifest')
$expectedLine = (Get-Content -LiteralPath $checksum -Raw).Trim()
if ($expectedLine -notmatch '^([0-9a-f]{64})  ([^/\\\s]+)$' -or $Matches[2] -ne $BackupName) { throw 'Invalid checksum manifest.' }
$expected = $Matches[1]
$actual = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected -or (Get-Item -LiteralPath $dump).Length -eq 0) { throw 'Downloaded SQL SHA-256 mismatch or empty file.' }
$lines = @(Get-Content -LiteralPath $manifestFile)
if ($lines.Count -ne 4 -or $lines[0] -ne "release_sha=$releaseSha" -or $lines[1] -ne "backup_sha256=$expected" -or $lines[2] -notmatch '^challenge=[0-9a-f]{64}$' -or $lines[3] -notmatch '^created_unix=\d+$') {
  throw 'Downloaded backup manifest does not match this release.'
}
$receipt = Join-Path $destination ($BackupName + '.copy-receipt')
[IO.File]::WriteAllText($receipt, "release_sha=$releaseSha`nbackup_sha256=$expected`n$($lines[2])`n", [Text.Encoding]::ASCII)
& scp -o StrictHostKeyChecking=yes $receipt "${remote}.copy-receipt"
if ($LASTEXITCODE -ne 0) { throw 'Could not send copy receipt to VPS.' }
Write-Output "Verified Windows SQL copy: $BackupName. Keep the dump outside Git and protected by this directory ACL."
