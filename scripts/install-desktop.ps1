$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'
$appExe = Join-Path $appDir 'DeepSeek Harness.exe'
$dshCommand = Join-Path $appDir 'resources\runtime\cli\bin\dsh.cmd'
$desktopNode = Join-Path $appDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$portableNode = Join-Path (Split-Path -Parent $projectDir) '.tools\node-v24.14.0-win-x64\node.exe'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$storageDir = Join-Path $env:USERPROFILE '.dsh\storages\evoforge-desktop'
$tarball = Join-Path $projectDir 'artifacts\dsh-plugin-evoforge-0.1.0.tgz'

if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $appExe }) {
  throw 'Exit Harness using Application > Quit before running this installer.'
}
foreach ($required in @($dshCommand,$tarball,(Join-Path $profileDir 'package.json'),(Join-Path $profileDir 'cordis.patch.yml'))) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required file missing: $required" }
}
$runtimeVersion = (& $dshCommand --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $runtimeVersion -notin @('0.2.0-rc.2','0.2.1-alpha.1')) {
  throw "Harness runtime has not been verified: $runtimeVersion"
}
$backupDir = Join-Path $projectDir ('artifacts\desktop-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
foreach ($filename in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
  $source = Join-Path $profileDir $filename
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $backupDir }
}
# Profile already disables automatic peer installation; Desktop provides the verified peers.
& $dshCommand plugin --profile desktop add $tarball
if ($LASTEXITCODE -ne 0) { throw "Official plugin installation failed; backup: $backupDir" }
$nodeExe = if (Test-Path -LiteralPath $portableNode) { $portableNode } else { $desktopNode }
& $nodeExe (Join-Path $PSScriptRoot 'configure-desktop.mjs') $profileDir $storageDir
if ($LASTEXITCODE -ne 0) { throw "Plugin installed, account configuration failed; backup: $backupDir" }
Write-Output "Installation saved. Restart Harness to check activation. Data: $storageDir"
Write-Output "Backup: $backupDir"
