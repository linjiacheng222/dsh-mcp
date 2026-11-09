# Build the GUI-subsystem settings elevation helper.
#
# The helper has an embedded requireAdministrator manifest so Windows shows the
# native UAC prompt instead of a PowerShell console window.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
  throw "C# compiler not found: $csc"
}
$source = Join-Path $PSScriptRoot 'settings-elevate-gui.cs'
$manifest = Join-Path $PSScriptRoot 'settings-elevate.manifest'
$output = Join-Path $root 'lib\settings-elevate.exe'
$web = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Web.Extensions.dll'
$forms = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Windows.Forms.dll'
$drawing = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Drawing.dll'

& $csc `
  /nologo `
  /target:winexe `
  /platform:anycpu `
  /optimize+ `
  /win32manifest:$manifest `
  /r:$web `
  /r:$forms `
  /r:$drawing `
  /out:$output `
  $source
if ($LASTEXITCODE -ne 0) {
  throw "csc failed with exit code $LASTEXITCODE"
}
Write-Output "Built $output"
