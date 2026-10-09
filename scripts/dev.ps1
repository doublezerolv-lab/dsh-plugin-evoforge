param([ValidateSet('check','demo','benchmark','build','typecheck','test','install','pack')][string]$Task = 'check')
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$workspaceDir = Split-Path -Parent $projectDir
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$portableNode = Join-Path $workspaceDir '.tools/node-v24.14.0-win-x64/node.exe'
$desktopNode = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
if ($nodeCommand) { $nodeDir = Split-Path -Parent $nodeCommand.Source }
elseif (Test-Path -LiteralPath $portableNode) { $nodeDir = Split-Path -Parent $portableNode }
elseif (Test-Path -LiteralPath $desktopNode) { $nodeDir = Split-Path -Parent $desktopNode }
else { throw 'Install Node.js 22+ or prepare the workspace portable Node.js distribution.' }
$env:Path = $nodeDir + ';' + $env:Path
foreach ($dockerBinDir in @(
  (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin'),
  (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin')
)) {
  if (Test-Path -LiteralPath (Join-Path $dockerBinDir 'docker.exe')) {
    $env:Path = $dockerBinDir + ';' + $env:Path
    break
  }
}
Push-Location -LiteralPath $projectDir
try {
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd is required; use a full Node.js distribution.' }
  if ($Task -eq 'install') { & npm.cmd ci --ignore-scripts --no-audit --no-fund }
  elseif ($Task -eq 'pack') { & npm.cmd pack --pack-destination artifacts }
  else { & npm.cmd run $Task }
  exit $LASTEXITCODE
} finally { Pop-Location }
