#requires -Version 5.1
<#
Local backup health check. Reads the last scheduled backup status and writes a
visible alert file and Windows Task Scheduler failure when the last success is
missing, failed or older than the threshold.

This is a local alert mechanism. Email delivery is optional and only works when
RESEND_API_KEY, RESEND_FROM_EMAIL and OWNER_NOTIFICATION_EMAIL are available in
the user or process environment. The existing Cloudflare backup monitor remains
the canonical production alert path when configured.
#>
param(
  [string]$Master = 'C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER',
  [int]$StaleHours = 26
)

$ErrorActionPreference = 'Stop'
$alertDir = Join-Path $Master '08 BACKUPS & ARCHIVE\ALERTS'
$statusFile = Join-Path $alertDir 'LAST-RUN.json'
$healthFile = Join-Path $alertDir 'HEALTH.json'
New-Item -ItemType Directory -Path $alertDir -Force | Out-Null
$now = (Get-Date).ToUniversalTime()
$result = [ordered]@{
  checkedAt = $now.ToString('o')
  status = 'missing'
  ageHours = $null
  lastSuccessAt = $null
  lastRunOk = $false
  d1Status = $null
  message = ''
}

try {
  if (Test-Path -LiteralPath $statusFile) {
    $last = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
    $result.lastRunOk = [bool]$last.ok
    $result.lastSuccessAt = $last.finishedAt
    $result.d1Status = $last.d1.status
    if ($last.ok -and $last.finishedAt) {
      $age = ($now - ([datetime]$last.finishedAt).ToUniversalTime()).TotalHours
      $result.ageHours = [Math]::Round($age, 2)
      $result.status = if ($age -gt $StaleHours) { 'stale' } else { 'healthy' }
    } else {
      $result.status = 'failed'
    }
  }
  if ($result.status -ne 'healthy') {
    $result.message = "Backup health is $($result.status). Last success: $($result.lastSuccessAt). D1: $($result.d1Status)."
    $alertFile = Join-Path $alertDir ("BACKUP-ALERT-{0}.txt" -f $now.ToString('yyyyMMdd-HHmmss'))
    Set-Content -LiteralPath $alertFile -Encoding UTF8 -Value @(
      'SPARKLING STANDARD BACKUP ALERT',
      "Checked: $($now.ToString('o'))",
      "Status: $($result.status)",
      "Last success: $($result.lastSuccessAt)",
      "Age hours: $($result.ageHours)",
      "D1 status: $($result.d1Status)",
      '',
      'Inspect 08 BACKUPS & ARCHIVE\ALERTS\LAST-RUN.json and the newest file in SCHEDULED\logs.',
      'Do not assume the disaster-recovery requirement is met until a verified restore passes.'
    )
    Write-Output $result.message
    exit 1
  }
  Write-Output "Backup healthy; last success $($result.lastSuccessAt)."
} finally {
  ($result | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $healthFile -Encoding UTF8
}
