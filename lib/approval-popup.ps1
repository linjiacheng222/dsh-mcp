param(
  [Parameter(Mandatory = $true)][string]$ApprovalId,
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [Parameter(Mandatory = $false)][string]$Title = 'DSH MCP Approval',
  [Parameter(Mandatory = $true)][string]$BodyBase64
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms | Out-Null

$body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($BodyBase64))
$result = [System.Windows.Forms.MessageBox]::Show(
  $body,
  $Title,
  [System.Windows.Forms.MessageBoxButtons]::YesNo,
  [System.Windows.Forms.MessageBoxIcon]::Warning,
  [System.Windows.Forms.MessageBoxDefaultButton]::Button2
)

$decision = if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { 'allow' } else { 'deny' }
$payload = @{ decision = $decision } | ConvertTo-Json -Compress

try {
  Invoke-RestMethod -Uri $ApiUrl -Method Post `
    -Headers @{ 'X-DSH-MCP-UI' = '1' } `
    -ContentType 'application/json' `
    -Body $payload `
    -TimeoutSec 10 | Out-Null
} catch {
  # A timeout or a decision already made in the DSH window is not an error here.
}
