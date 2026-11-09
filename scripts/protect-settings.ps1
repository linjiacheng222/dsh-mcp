# Protect the DSH MCP gateway settings with a Windows ACL.
#
# After protection, the current user can read the settings directory/file but
# cannot write them. Administrators and SYSTEM keep full control. The plugin
# therefore relies on the operating-system file boundary when it saves settings;
# there is no plugin-level elevation flag or admin-required API response.
#
# Usage (run from a normal PowerShell; the owner can set the ACL):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\protect-settings.ps1 `
#     -SettingsPath "$env:DSH_HOME\dsh-mcp-gateway\settings.json"
#
# To undo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\protect-settings.ps1 `
#     -SettingsPath "...\settings.json" -Unprotect

param(
  [Parameter(Mandatory = $true)][string]$SettingsPath,
  [switch]$Unprotect
)

$ErrorActionPreference = 'Stop'
$settings = (Resolve-Path -LiteralPath $SettingsPath).Path
$directory = Split-Path -Parent $settings
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($Unprotect) {
  icacls $settings /reset | Out-Null
  icacls $directory /reset | Out-Null
  Write-Output "Unprotected $settings and $directory"
  exit 0
}

if (-not (Test-Path -LiteralPath $settings -PathType Leaf)) {
  throw "settings file not found: $settings"
}

# Removing inheritance is what makes the directory read-only for the normal
# token: atomic writes create a temporary file in this directory, so protecting
# only the target file would allow rename-replacement to bypass the ACL.
icacls $directory /inheritance:r /grant:r `
  '*S-1-5-32-544:(F)' `
  '*S-1-5-18:(F)' `
  "${user}:(RX)" | Out-Null

icacls $settings /inheritance:r /grant:r `
  '*S-1-5-32-544:(F)' `
  '*S-1-5-18:(F)' `
  "${user}:(R)" | Out-Null

Write-Output "Protected $settings and $directory (user $user is read-only)"
Write-Output 'The DSH process must run as administrator to save settings.'
